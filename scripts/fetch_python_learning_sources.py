#!/usr/bin/env python3
"""Fetch private-development copies of external Python learning HTML sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import ssl
import time
from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.parse import urljoin, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.corpus_sources import CorpusSource, external_source_ids, source_by_id


USER_AGENT = "ResponsibleEduAgent research corpus builder"
PY4E_HTML3_PATHS = [
    "A0-preface",
    "01-intro",
    "02-variables",
    "03-conditional",
    "04-functions",
    "05-iterations",
    "06-strings",
    "07-files",
    "08-lists",
    "09-dictionaries",
    "10-tuples",
    "11-regex",
    "12-network",
    "13-web",
    "14-objects",
    "15-database",
    "16-viz",
    "AA-contrib",
    "AB-copyright",
]


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict] = []
        self.depth_stack: list[str] = []
        self.in_runoob_leftcolumn = False
        self.in_py4e_main = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        element_id = attrs_dict.get("id", "")
        marker = ""
        if tag == "div" and element_id == "leftcolumn":
            self.in_runoob_leftcolumn = True
            marker = "runoob-leftcolumn"
        elif tag == "main" and element_id == "main-content":
            self.in_py4e_main = True
            marker = "py4e-main"
        self.depth_stack.append(marker)
        if tag != "a":
            return
        href = attrs_dict.get("href")
        if href:
            self.links.append(
                {
                    "href": href,
                    "in_runoob_leftcolumn": self.in_runoob_leftcolumn,
                    "in_py4e_main": self.in_py4e_main,
                },
            )

    def handle_endtag(self, tag: str) -> None:
        if not self.depth_stack:
            return
        marker = self.depth_stack.pop()
        if marker == "runoob-leftcolumn":
            self.in_runoob_leftcolumn = False
        elif marker == "py4e-main":
            self.in_py4e_main = False


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    return parsed._replace(fragment="", query="", path=path).geturl()


def local_html_path(source: CorpusSource, url: str) -> Path:
    parsed = urlparse(url)
    path = parsed.path.lstrip("/") or "index.html"
    if path.endswith("/"):
        path += "index.html"
    if not Path(path).suffix:
        path += "/index.html"
    return Path(source.raw_dir) / "html" / parsed.netloc / path


def discover_links(source: CorpusSource, base_url: str, html: str) -> list[str]:
    parser = LinkParser()
    parser.feed(html)
    links: set[str] = set()
    for link in parser.links:
        href = link["href"]
        try:
            absolute = normalize_url(urljoin(base_url, href))
        except ValueError:
            continue
        parsed = urlparse(absolute)
        if source.source_id == "think-python-2e":
            if (
                parsed.netloc == "greenteapress.com"
                and parsed.path.startswith("/thinkpython2/html/")
                and parsed.path.endswith(".html")
            ):
                links.add(absolute)
        elif source.source_id == "py4e-html3":
            if (
                link["in_py4e_main"]
                and parsed.netloc == "www.py4e.com"
                and parsed.path.startswith("/html3/")
                and not Path(parsed.path).name.startswith(".")
            ):
                links.add(absolute)
        elif source.source_id == "runoob-python3":
            if (
                link["in_runoob_leftcolumn"]
                and parsed.netloc == "www.runoob.com"
                and parsed.path.startswith("/python3/")
                and parsed.path.endswith(".html")
            ):
                links.add(absolute)
        elif source.source_id == "python-docs-3.14.6":
            if parsed.netloc == "docs.python.org" and parsed.path.startswith("/3/tutorial/") and parsed.path.endswith(".html"):
                links.add(absolute)
    return sorted(links)


def fetch_url(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    context = ssl._create_unverified_context()
    with urlopen(request, timeout=30, context=context) as response:
        return response.read()


def save_page(source: CorpusSource, url: str, body: bytes) -> dict:
    relative = local_html_path(source, url)
    full = ROOT / relative
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(body)
    return {
        "url": url,
        "local_file": str(relative),
        "sha256": sha256_bytes(body),
        "bytes": len(body),
    }


def crawl_source(source: CorpusSource, max_pages: int = 0, delay_seconds: float = 0.15) -> dict:
    queue = [normalize_url(source.start_url)]
    if source.source_id == "py4e-html3":
        queue.extend([f"https://www.py4e.com/html3/{path}" for path in PY4E_HTML3_PATHS])
    seen: set[str] = set()
    pages: list[dict] = []
    errors: list[dict] = []

    while queue:
        url = queue.pop(0)
        if url in seen:
            continue
        if max_pages and len(pages) >= max_pages:
            break
        seen.add(url)
        try:
            body = fetch_url(url)
        except HTTPError as exc:
            errors.append({"url": url, "error": f"HTTP {exc.code}"})
            continue
        except URLError as exc:
            errors.append({"url": url, "error": str(exc.reason)})
            continue
        pages.append(save_page(source, url, body))
        html = body.decode("utf-8", errors="ignore")
        for link in discover_links(source, url, html):
            if link not in seen and link not in queue:
                queue.append(link)
        if delay_seconds:
            time.sleep(delay_seconds)

    manifest = {
        "source_id": source.source_id,
        "display_name": source.display_name,
        "start_url": source.start_url,
        "language": source.language,
        "license_note": source.license_note,
        "publish_full_text": source.publish_full_text,
        "page_count": len(pages),
        "error_count": len(errors),
        "pages": pages,
        "errors": errors,
    }
    write_source_manifest(source, manifest)
    return manifest


def write_source_manifest(source: CorpusSource, manifest: dict) -> None:
    path = ROOT / source.raw_dir / "source_manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch private-development HTML copies of Python learning sources.")
    parser.add_argument("--source", choices=external_source_ids() + ["all"], required=True)
    parser.add_argument("--max-pages", type=int, default=0)
    parser.add_argument("--delay-seconds", type=float, default=0.15)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_ids = external_source_ids() if args.source == "all" else [args.source]
    for source_id in source_ids:
        source = source_by_id(source_id)
        manifest = crawl_source(source, max_pages=args.max_pages, delay_seconds=args.delay_seconds)
        print(f"{source.source_id} pages saved: {manifest['page_count']}")


if __name__ == "__main__":
    main()
