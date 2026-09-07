#!/usr/bin/env python3
"""Build a crawlable static blog from HTML articles. Standard library only."""
import argparse
from dataclasses import dataclass
from datetime import date, datetime, timezone
from functools import partial
from html import escape
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import shutil
from threading import Lock
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://maksim.lysakou.dev"
AUTHOR = {"@type": "Person", "name": "Maksim Lysakou", "url": SITE + "/"}
NAV_MARKER = "<!-- BLOG_NAV -->"
MONTHS = "January February March April May June July August September October November December".split()


class ArticleParser(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.offsets = [0]
        for line in source.splitlines(keepends=True):
            self.offsets.append(self.offsets[-1] + len(line))
        self.attrs = None
        self.start = self.end = None
        self.words = []
        self.article_count = 0
        self.has_h1 = False
        self.feed(source)
        self.close()

    def source_offset(self):
        line, column = self.getpos()
        return self.offsets[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag == "article":
            self.article_count += 1
            if self.attrs is None:
                self.attrs = dict(attrs)
                self.start = self.source_offset() + len(self.get_starttag_text())
        if tag == "h1":
            self.has_h1 = True

    def handle_endtag(self, tag):
        if tag == "article":
            self.end = self.source_offset()

    def handle_data(self, data):
        self.words.extend(data.split())


@dataclass
class Post:
    slug: str
    title: str
    description: str
    published: date
    updated: date
    lang: str
    tags: list
    body: str
    reading_time: int
    is_public: bool

    @property
    def path(self):
        return f"/blog/{self.slug}/"


def read_posts(root, today, drafts=False):
    posts = []
    for source in sorted((root / "content/blog").glob("*.html")):
        if source.name.startswith("_"):
            continue
        parser = ArticleParser(source.read_text(encoding="utf-8"))
        attrs = parser.attrs or {}
        status = attrs.get("data-status", "draft")
        if status not in {"draft", "published"}:
            raise ValueError(f"{source.name}: data-status must be draft or published")
        if status == "draft" and not drafts:
            continue
        if parser.article_count != 1 or parser.end is None:
            raise ValueError(f"{source.name}: use exactly one complete <article> wrapper")
        if parser.has_h1:
            raise ValueError(f"{source.name}: h1 is generated from data-title; use h2 in the body")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", source.stem):
            raise ValueError(f"{source.name}: use a lowercase, hyphen-separated filename")
        for field in ("data-title", "data-description", "data-date"):
            if not attrs.get(field, "").strip():
                raise ValueError(f"{source.name}: missing {field}")
        try:
            for field in ("data-date", "data-updated"):
                if attrs.get(field) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", attrs[field]):
                    raise ValueError("use YYYY-MM-DD")
            published = date.fromisoformat(attrs["data-date"])
            updated = date.fromisoformat(attrs.get("data-updated") or attrs["data-date"])
        except ValueError as error:
            raise ValueError(f"{source.name}: invalid date ({error})") from error
        if updated < published:
            raise ValueError(f"{source.name}: data-updated cannot precede data-date")
        is_public = status == "published" and published <= today
        if not is_public and not drafts:
            continue
        lang = attrs.get("lang", "en")
        if not re.fullmatch(r"[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*", lang):
            raise ValueError(f"{source.name}: invalid language code")
        body = parser.source[parser.start:parser.end].strip()
        if not body or not parser.words:
            raise ValueError(f"{source.name}: article body is empty")
        posts.append(Post(source.stem, attrs["data-title"].strip(),
                          attrs["data-description"].strip(), published, updated,
                          lang, [tag.strip() for tag in attrs.get("data-tags", "").split(",") if tag.strip()],
                          body, max(1, math.ceil(len(parser.words) / 220)), is_public))
    return sorted(posts, key=lambda post: (post.published, post.slug), reverse=True)


def render(root, template, **values):
    source = (root / "templates" / template).read_text(encoding="utf-8")
    # One pass preserves literal {{expressions}} in authored HTML and code samples.
    return re.sub(r"\{\{(\w+)\}\}", lambda match: str(values[match[1]]), source)


def json_ld(value):
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")


def display_date(value):
    return f"{value.day} {MONTHS[value.month - 1]} {value.year}"


def build(root=ROOT, *, today=None, drafts=False):
    today = today or datetime.now(timezone.utc).date()
    posts = read_posts(root, today, drafts)
    home = (root / "index.html").read_text(encoding="utf-8")
    if home.count(NAV_MARKER) != 1:
        raise ValueError("index.html must contain exactly one <!-- BLOG_NAV --> marker")
    blog_link = '<a href="/blog/">Blog</a>' if posts else ""
    home = home.replace(NAV_MARKER, blog_link)
    if posts:
        home = home.replace('<div class="nav-menu"', '<div class="nav-menu has-blog"')
    if drafts:
        home = home.replace("</head>", '<meta name="robots" content="noindex, nofollow" /></head>')
    header = re.search(r"<header\b.*?</header>", home, re.S).group()
    footer = re.search(r"<footer\b.*?</footer>", home, re.S).group()
    header = re.sub(r'href="#([^"]*)"', lambda m: f'href="/{"#" + m[1] if m[1] else ""}"', header)
    footer = footer.replace('href="#"', 'href="/"')
    header = header.replace('href="/blog/"', 'href="/blog/" aria-current="page"')

    def page(content, *, title, description, path, data, lang="en", article_meta="", indexable=True):
        return render(root, "page.html", content=content, header=header, footer=footer,
                      title=escape(title), description=escape(description), canonical=SITE + path,
                      lang=escape(lang), robots="index, follow" if indexable and not drafts else "noindex, follow",
                      og_type="article" if article_meta else "website", article_meta=article_meta,
                      structured_data=json_ld(data))

    files = {"index.html": home}
    entries = []
    for post in posts:
        tags = "".join(f'<span>{escape(tag)}</span>' for tag in post.tags)
        notice = '<p class="draft-notice">Draft preview — not published</p>' if not post.is_public else ""
        entries.append(f'''<article class="blog-entry">
          <div class="entry-date"><time datetime="{post.published}">{display_date(post.published)}</time><span>{post.reading_time} min read</span></div>
          <div class="entry-content">{notice}<div class="article-topics">{tags}</div>
            <h2><a href="{post.path}">{escape(post.title)} <span aria-hidden="true">↗</span></a></h2>
            <p>{escape(post.description)}</p></div></article>''')
        updated = (f'<span>Updated <time datetime="{post.updated}">{display_date(post.updated)}</time></span>'
                   if post.updated != post.published else "")
        article = render(root, "article.html", title=escape(post.title), description=escape(post.description),
                         date=post.published, display_date=display_date(post.published), tags=tags,
                         reading_time=post.reading_time, body=post.body, updated=updated, preview_notice=notice)
        metadata = (f'<meta property="article:published_time" content="{post.published}" />\n'
                    f'<meta property="article:modified_time" content="{post.updated}" />')
        data = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": post.title,
                "description": post.description, "datePublished": str(post.published),
                "dateModified": str(post.updated), "inLanguage": post.lang, "author": AUTHOR,
                "url": SITE + post.path, "mainEntityOfPage": SITE + post.path}
        files[f"blog/{post.slug}/index.html"] = page(article, title=f"{post.title} | Maksim Lysakou",
                    description=post.description, path=post.path, data=data, lang=post.lang,
                    article_meta=metadata, indexable=post.is_public)
    empty = '<div class="blog-empty"><span class="expertise-icon" aria-hidden="true">✳</span><h2>Good things take a little time.</h2><p>No articles yet. In the meantime, explore what I’m building.</p><a class="text-link" href="/#startups">Explore my projects ↗</a></div>'
    listing = render(root, "blog.html", articles="\n".join(entries) if entries else empty)
    files["blog/index.html"] = page(listing, title="Blog | Maksim Lysakou",
                description="Notes on engineering, building with AI, and turning ideas into products that matter.",
                path="/blog/", indexable=bool(posts),
                data={"@context": "https://schema.org", "@type": "Blog", "name": "Maksim Lysakou — Blog",
                      "url": SITE + "/blog/", "author": AUTHOR})
    sitemap = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    paths = [("/", None)]
    public_posts = [post for post in posts if post.is_public]
    if public_posts and not drafts:
        paths.append(("/blog/", max(post.updated for post in public_posts)))
        paths.extend((post.path, post.updated) for post in public_posts)
    for path, updated in paths:
        url = ET.SubElement(sitemap, "url")
        ET.SubElement(url, "loc").text = SITE + path
        if updated:
            ET.SubElement(url, "lastmod").text = str(updated)
    ET.indent(sitemap)
    files["sitemap.xml"] = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(sitemap, encoding="unicode") + "\n"
    files["robots.txt"] = (root / "robots.txt").read_text(encoding="utf-8")
    files["CNAME"] = "maksim.lysakou.dev\n"
    files[".nojekyll"] = ""
    # Only deploy public output; article sources, drafts, tests and templates stay out.
    output = root / "_site"
    if output.exists():
        shutil.rmtree(output)
    output.mkdir()
    for asset in ("css", "js", "img"):
        if (root / asset).exists():
            shutil.copytree(root / asset, output / asset)
    for relative, contents in files.items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(contents, encoding="utf-8")
    return posts


def fingerprint(root):
    sources = [root / "index.html", root / "robots.txt"]
    for directory in ("templates", "content", "css", "js", "img"):
        sources.extend(path for path in (root / directory).rglob("*") if path.is_file())
    return [(str(path), path.stat().st_mtime_ns, path.stat().st_size) for path in sorted(sources)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true", help="Preview locally; rebuild after edits on refresh")
    parser.add_argument("--drafts", action="store_true", help="Include drafts locally; mark all HTML pages noindex")
    parser.add_argument("--port", type=int, default=4174)
    args = parser.parse_args()
    posts = build(drafts=args.drafts)
    print(f"Built _site: {len(posts)} article(s){' (draft preview, noindex)' if args.drafts else ''}.", flush=True)
    if args.serve:
        last_build = fingerprint(ROOT)
        lock = Lock()

        class PreviewHandler(SimpleHTTPRequestHandler):
            def do_GET(self):
                nonlocal last_build
                with lock:
                    current = fingerprint(ROOT)
                    if current != last_build:
                        try:
                            build(drafts=args.drafts)
                            last_build = current
                        except ValueError as error:
                            self.send_error(500, str(error))
                            return
                    super().do_GET()

        server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(PreviewHandler, directory=str(ROOT / "_site")))
        print(f"Preview: http://127.0.0.1:{args.port} (refresh after editing)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
