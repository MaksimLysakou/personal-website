from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET

from scripts.build_site import ROOT, SITE, build


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.links = []
        self.meta = {}
        self.headings = 0
        self.canonical = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self.links.append(attrs.get("href"))
        if tag == "meta":
            self.meta[attrs.get("name", attrs.get("property"))] = attrs.get("content")
        if tag == "h1":
            self.headings += 1
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href")


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("index.html", "robots.txt"):
            shutil.copy2(ROOT / name, self.root / name)
        shutil.copytree(ROOT / "templates", self.root / "templates")
        (self.root / "content/blog").mkdir(parents=True)

    def article(self, slug="first-note", *, title="First & best", status="published", day="2026-09-01", body="<p>A useful idea.</p>", extra=""):
        path = self.root / "content/blog" / f"{slug}.html"
        path.write_text(f'<article data-title="{title}" data-description="A concise summary." data-date="{day}" data-status="{status}" lang="en" {extra}>{body}</article>', encoding="utf-8")
        return path

    def build(self, **kwargs):
        return build(self.root, today=date(2026, 9, 7), **kwargs)

    def read(self, path):
        return (self.root / "_site" / path).read_text(encoding="utf-8")

    def sitemap(self):
        return [node.text for node in ET.fromstring(self.read("sitemap.xml")).iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]

    def test_empty_blog_has_no_navigation_or_sitemap_entry(self):
        self.build()
        self.assertNotIn('/blog/', Document(self.read("index.html")).links)
        self.assertEqual(Document(self.read("blog/index.html")).meta["robots"], "noindex, follow")
        self.assertEqual(self.sitemap(), [SITE + "/"])

    def test_drafts_future_posts_and_template_never_publish(self):
        self.article("draft-note", status="draft")
        self.article("future-note", day="2099-01-01")
        self.article("_template")
        self.assertEqual(self.build(), [])
        self.assertFalse((self.root / "_site/content").exists())
        for slug in ("draft-note", "future-note", "_template"):
            self.assertFalse((self.root / "_site/blog" / slug).exists())
        self.assertNotIn('/blog/', Document(self.read("index.html")).links)

    def test_published_html_metadata_links_and_sitemap(self):
        body = '<h2>Details</h2><pre><code>&lt;Component&gt;{{literal}}</code></pre><p>Full text.</p>'
        self.article(body=body, extra='data-updated="2026-09-04"')
        self.build()
        source = self.read("blog/first-note/index.html")
        doc = Document(source)
        self.assertIn(body, source)
        self.assertEqual(doc.headings, 1)
        self.assertEqual(doc.canonical, SITE + "/blog/first-note/")
        self.assertEqual(doc.meta["robots"], "index, follow")
        self.assertEqual(doc.meta["description"], "A concise summary.")
        self.assertEqual(doc.meta["article:modified_time"], "2026-09-04")
        self.assertIn('/blog/', Document(self.read("index.html")).links)
        self.assertIn('/blog/first-note/', Document(self.read("blog/index.html")).links)
        self.assertIn('/#about', doc.links)
        self.assertIn(SITE + "/blog/first-note/", self.sitemap())
        data = json.loads(source.split('<script type="application/ld+json">')[1].split('</script>')[0])
        self.assertEqual(data["headline"], "First & best")
        self.assertEqual(data["@type"], "BlogPosting")
        self.assertEqual(data["datePublished"], "2026-09-01")

    def test_newest_first_and_rebuild_removes_unpublished_pages(self):
        first = self.article("older-note", day="2026-09-01")
        latest = self.article("latest-note", day="2026-09-06")
        self.build()
        listing = self.read("blog/index.html")
        self.assertLess(listing.index('/blog/latest-note/'), listing.index('/blog/older-note/'))
        first.unlink()
        latest.unlink()
        self.build()
        self.assertFalse((self.root / "_site/blog/latest-note").exists())
        self.assertFalse((self.root / "_site/blog/older-note").exists())
        self.assertNotIn('/blog/', Document(self.read("index.html")).links)

    def test_preview_drafts_is_noindex(self):
        self.article(status="draft")
        self.build(drafts=True)
        for page in ("index.html", "blog/index.html", "blog/first-note/index.html"):
            self.assertIn("noindex", Document(self.read(page)).meta["robots"])
        self.assertNotIn(SITE + "/blog/first-note/", self.sitemap())

    def test_invalid_metadata_fails_without_replacing_good_build(self):
        self.article()
        self.build()
        original = self.read("blog/first-note/index.html")
        self.article(day="2026-02-30")
        with self.assertRaisesRegex(ValueError, "invalid date"):
            self.build()
        self.assertEqual(self.read("blog/first-note/index.html"), original)

    def test_unsafe_slug_duplicate_h1_and_unknown_status_fail(self):
        path = self.article("Bad_Slug")
        with self.assertRaisesRegex(ValueError, "filename"):
            self.build()
        path.unlink()
        self.article(body="<h1>Duplicate heading</h1>")
        with self.assertRaisesRegex(ValueError, "h1"):
            self.build()
        self.article(status="publshed")
        with self.assertRaisesRegex(ValueError, "data-status"):
            self.build()

    def test_metadata_cannot_break_html_or_json_ld(self):
        self.article(title='An &quot;idea&quot; &amp; &lt;/script&gt;', body='<p>Пример текста.</p>')
        self.build()
        source = self.read("blog/first-note/index.html")
        self.assertIn("&lt;/script&gt;", source)
        raw = source.split('<script type="application/ld+json">')[1].split('</script>')[0]
        self.assertEqual(json.loads(raw)["headline"], 'An "idea" & </script>')


if __name__ == "__main__":
    unittest.main()
