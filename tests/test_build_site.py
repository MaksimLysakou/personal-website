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
        self.images = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self.links.append(attrs.get("href"))
        if tag == "img":
            self.images.append(attrs)
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

    def external_article(self, slug="external-note", *, url="https://fively.dev/expertise/example/", **kwargs):
        (self.root / "img").mkdir(exist_ok=True)
        (self.root / "img/external.png").write_bytes(b"image fixture")
        return self.article(slug, body="", extra=(
            f'data-type="external" data-url="{url}" data-source="Fively" '
            'data-cover="/img/external.png" data-cover-alt="Article cover"'), **kwargs)

    def read(self, path):
        return (self.root / "_site" / path).read_text(encoding="utf-8")

    def sitemap(self):
        return [node.text for node in ET.fromstring(self.read("sitemap.xml")).iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]

    def test_empty_blog_has_no_navigation_or_sitemap_entry(self):
        self.build()
        self.assertNotIn('/blog/', Document(self.read("index.html")).links)
        self.assertEqual(Document(self.read("blog/index.html")).meta["robots"], "noindex, follow")
        self.assertEqual(self.sitemap(), [SITE + "/"])

    def test_experience_updates_at_the_start_of_each_year(self):
        for today, years in ((date(2026, 12, 31), 9), (date(2027, 1, 1), 10)):
            with self.subTest(today=today):
                build(self.root, today=today)
                home = self.read("index.html")
                self.assertEqual(home.count(f'<span data-experience-years>{years}</span>'), 2)
                self.assertNotIn("{{experience_years}}", home)
                self.assertIn("since January 2017", Document(home).meta["description"])

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

    def test_cover_is_shared_by_article_listing_and_social_metadata(self):
        (self.root / "img").mkdir()
        for name in ("cover.webp", "cover-small.webp"):
            (self.root / "img" / name).write_bytes(b"image fixture")
        self.article(extra='data-cover="/img/cover.webp" data-cover-small="/img/cover-small.webp" data-cover-alt="Robot &amp; developer" data-cover-caption="A shared idea."')
        self.build()
        source = self.read("blog/first-note/index.html")
        doc = Document(source)
        image = next(img for img in doc.images if img.get("src") == "/img/cover.webp")
        self.assertEqual(image["alt"], "Robot & developer")
        self.assertIn("/img/cover-small.webp 600w", image["srcset"])
        self.assertEqual(doc.meta["og:image"], SITE + "/img/cover.webp")
        self.assertIn("A shared idea.", source)
        self.assertTrue(any(img.get("src") == "/img/cover.webp" for img in Document(self.read("blog/index.html")).images))
        self.assertTrue((self.root / "_site/img/cover.webp").exists())
        self.article()
        self.build()
        self.assertNotIn("article-cover", self.read("blog/first-note/index.html"))
        self.assertNotIn("entry-cover", self.read("blog/index.html"))

    def test_missing_cover_or_alt_fails_before_replacing_output(self):
        self.article()
        self.build()
        original = self.read("blog/first-note/index.html")
        for extra, message in [
            ('data-cover="/img/missing.webp"', "data-cover-alt"),
            ('data-cover="/img/missing.webp" data-cover-alt="Missing"', "existing file"),
        ]:
            self.article(extra=extra)
            with self.assertRaisesRegex(ValueError, message):
                self.build()
            self.assertEqual(self.read("blog/first-note/index.html"), original)

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

    def test_external_card_links_to_original_without_local_page(self):
        destination = 'https://fively.dev/expertise/example/?a=1&b="two"'
        self.external_article(url='https://fively.dev/expertise/example/?a=1&amp;b=&quot;two&quot;')
        self.build()
        listing = self.read("blog/index.html")
        self.assertEqual(Document(listing).links.count(destination), 2)
        self.assertIn('class="blog-entry blog-entry--with-cover blog-entry--external"', listing)
        self.assertIn("Fively ↗", listing)
        self.assertNotIn("min read", listing)
        self.assertTrue(any(img.get("src") == "/img/external.png" for img in Document(listing).images))
        self.assertFalse((self.root / "_site/blog/external-note").exists())
        self.assertIn('/blog/', Document(self.read("index.html")).links)
        self.assertEqual(self.sitemap(), [SITE + "/", SITE + "/blog/"])

    def test_external_and_internal_posts_share_sorting_and_remove_old_pages(self):
        self.article("older", day="2026-09-01")
        self.article("newer", day="2026-09-06")
        self.build()
        self.assertTrue((self.root / "_site/blog/newer/index.html").exists())
        self.external_article("newer", day="2026-09-06")
        self.build()
        listing = self.read("blog/index.html")
        self.assertLess(listing.index('https://fively.dev/expertise/example/'), listing.index('/blog/older/'))
        self.assertIn("min read", listing)
        self.assertFalse((self.root / "_site/blog/newer").exists())
        self.assertIn(SITE + "/blog/older/", self.sitemap())
        self.assertNotIn(SITE + "/blog/newer/", self.sitemap())

    def test_external_drafts_and_future_posts_follow_publication_rules(self):
        self.external_article("draft-external", status="draft")
        self.external_article("future-external", day="2099-01-01")
        self.build()
        self.assertNotIn('https://fively.dev/expertise/example/', Document(self.read("blog/index.html")).links)
        self.assertNotIn('/blog/', Document(self.read("index.html")).links)
        self.build(drafts=True)
        listing = self.read("blog/index.html")
        self.assertEqual(Document(listing).links.count('https://fively.dev/expertise/example/'), 4)
        self.assertIn("noindex", Document(listing).meta["robots"])
        self.assertEqual(listing.count("Draft preview"), 2)
        self.assertEqual(self.sitemap(), [SITE + "/"])
        self.assertFalse((self.root / "_site/blog/draft-external").exists())

    def test_external_validation_preserves_last_good_build(self):
        self.external_article()
        self.build()
        original = self.read("blog/index.html")
        for url in ("", "/relative", "//fively.dev/post", "javascript:alert(1)",
                    "https:///missing-host", "https://user:pass@fively.dev/", "https://fively.dev:wrong/",
                    "https://fively.dev/with space", "https://fively.dev/&#10;bad", "https://fively.dev\\bad"):
            with self.subTest(url=url):
                self.external_article(url=url)
                with self.assertRaisesRegex(ValueError, "data-url"):
                    self.build()
                self.assertEqual(self.read("blog/index.html"), original)
        for extra, message in (
            ('data-type="externl"', "data-type"),
            ('data-url="https://fively.dev/"', "data-type=external"),
            ('data-type="external" data-url="https://fively.dev/"', "data-cover"),
        ):
            self.article("external-note", extra=extra)
            with self.assertRaisesRegex(ValueError, message):
                self.build()
            self.assertEqual(self.read("blog/index.html"), original)

    def test_external_source_defaults_to_domain(self):
        path = self.external_article()
        path.write_text(path.read_text().replace(' data-source="Fively"', ''))
        self.build()
        self.assertIn("fively.dev ↗", self.read("blog/index.html"))


if __name__ == "__main__":
    unittest.main()
