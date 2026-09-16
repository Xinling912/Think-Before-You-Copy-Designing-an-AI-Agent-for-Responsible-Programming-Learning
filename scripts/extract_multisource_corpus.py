#!/usr/bin/env python3
"""Extract Think Python, PY4E, and Runoob HTML into ordered section/chunk JSONL corpora."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.corpus_sources import CorpusSource, external_source_ids, source_by_id


MAX_CHUNK_CHARS = 2500
CODE_FENCE_RE = re.compile(r"```python\n.*?\n```", re.DOTALL)
BLOCK_TAGS = {"p", "li", "dt", "dd", "td", "th", "caption", "blockquote"}
SKIP_TAGS = {"script", "style", "noscript", "nav", "header", "footer"}
NOISE_IDS = {"comments", "postcomments", "ai-info", "ad-336280", "token-plan-links", "runoobvote-id-21438"}
NOISE_CLASSES = {"previous-next-links", "design", "sidebar-box", "sidebar-tree", "article-heading-ad", "navigation"}
NOISE_TITLES = {"Previous", "Next", "Navigation", "Table of Contents", "上一篇", "下一篇", "用户笔记"}


def clean_ws(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_inline(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def clean_section_text(text: str) -> str:
    return clean_ws(text)


def split_large_unit(unit: str, max_chars: int) -> list[str]:
    if len(unit) <= max_chars:
        return [unit]
    sentences = re.split(r"(?<=[.!?。！？])\s+", unit)
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for sentence in sentences:
        if not sentence:
            continue
        if current and current_len + len(sentence) + 1 > max_chars:
            chunks.append(" ".join(current))
            current = []
            current_len = 0
        if len(sentence) > max_chars:
            if current:
                chunks.append(" ".join(current))
                current = []
                current_len = 0
            words = sentence.split()
            word_chunk: list[str] = []
            word_len = 0
            for word in words:
                if len(word) > max_chars:
                    if word_chunk:
                        chunks.append(" ".join(word_chunk))
                        word_chunk = []
                        word_len = 0
                    for start in range(0, len(word), max_chars):
                        chunks.append(word[start : start + max_chars])
                    continue
                extra = len(word) + (1 if word_chunk else 0)
                if word_chunk and word_len + extra > max_chars:
                    chunks.append(" ".join(word_chunk))
                    word_chunk = []
                    word_len = 0
                word_chunk.append(word)
                word_len += extra
            if word_chunk:
                chunks.append(" ".join(word_chunk))
        else:
            current.append(sentence)
            current_len += len(sentence) + 1
    if current:
        chunks.append(" ".join(current))
    return chunks or [unit[:max_chars]]


def split_chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    units: list[str] = []
    last_end = 0
    for match in CODE_FENCE_RE.finditer(text):
        prose = text[last_end : match.start()]
        for unit in prose.split("\n\n"):
            unit = clean_ws(unit)
            if unit:
                units.extend(split_large_unit(unit, max_chars))
        units.append(match.group(0).strip())
        last_end = match.end()
    for unit in text[last_end:].split("\n\n"):
        unit = clean_ws(unit)
        if unit:
            units.extend(split_large_unit(unit, max_chars))

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for unit in units:
        extra = len(unit) + (1 if current else 0)
        if current and current_len + extra > max_chars:
            chunks.append(clean_ws("\n\n".join(current)))
            current = []
            current_len = 0
        current.append(unit)
        current_len += extra
    if current:
        chunks.append(clean_ws("\n\n".join(current)))
    return chunks


def slug(text: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", text.lower()).strip("-")
    return value[:90] or "section"


def stable_id(*parts: str) -> str:
    return hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()[:12]


class EducationalHTMLParser(HTMLParser):
    def __init__(self, source: CorpusSource) -> None:
        super().__init__(convert_charrefs=True)
        self.source = source
        self.in_main = source.source_id == "think-python-2e"
        self.main_depth = 0
        self.skip_depth = 0
        self.in_pre = False
        self.pre_buffer: list[str] = []
        self.in_title = False
        self.title_buffer: list[str] = []
        self.heading_level: int | None = None
        self.heading_buffer: list[str] = []
        self.block_depth = 0
        self.block_buffer: list[str] = []
        self.page_title = ""
        self.sections: list[dict] = []
        self.current_section: dict | None = None
        self.heading_stack: list[tuple[int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        element_id = attrs_dict.get("id", "")
        classes = set((attrs_dict.get("class") or "").split())

        if self.skip_depth:
            self.skip_depth += 1
            return
        if tag in SKIP_TAGS or element_id in NOISE_IDS or classes & NOISE_CLASSES:
            self.skip_depth = 1
            return

        if self.source.source_id == "runoob-python3" and tag == "div" and element_id == "content":
            self.in_main = True
            self.main_depth = 1
            return
        if self.source.source_id == "py4e-html3" and tag == "main" and element_id == "main-content":
            self.in_main = True
            self.main_depth = 1
            return
        if self.in_main and self.main_depth:
            self.main_depth += 1

        if tag == "title":
            self.in_title = True
            self.title_buffer = []
        if not self.in_main:
            return
        if tag in {"h1", "h2", "h3", "h4"}:
            self.flush_block()
            self.heading_level = int(tag[1])
            self.heading_buffer = []
        elif tag == "pre":
            self.flush_block()
            self.in_pre = True
            self.pre_buffer = []
        elif tag in BLOCK_TAGS:
            if self.block_depth == 0:
                self.block_buffer = []
            self.block_depth += 1
        elif tag == "br":
            if self.in_pre:
                self.pre_buffer.append("\n")
            elif self.block_depth:
                self.block_buffer.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if tag == "title":
            self.in_title = False
            self.page_title = clean_inline(" ".join(self.title_buffer))
        if not self.in_main:
            return
        if tag in {"h1", "h2", "h3", "h4"} and self.heading_level is not None:
            title = clean_inline(" ".join(self.heading_buffer))
            if title and title not in NOISE_TITLES:
                self.start_section(self.heading_level, title)
            self.heading_level = None
            self.heading_buffer = []
        elif tag == "pre" and self.in_pre:
            code = "".join(self.pre_buffer).strip("\n")
            if code:
                self.ensure_section()
                self.current_section["units"].append(f"```python\n{code}\n```")
            self.in_pre = False
            self.pre_buffer = []
        elif tag in BLOCK_TAGS and self.block_depth:
            self.block_depth -= 1
            if self.block_depth == 0:
                self.flush_block()
        if self.main_depth:
            self.main_depth -= 1
            if self.main_depth == 0 and self.source.source_id != "think-python-2e":
                self.in_main = False

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        if self.in_title:
            self.title_buffer.append(data)
            return
        if not self.in_main:
            return
        if self.in_pre:
            self.pre_buffer.append(data)
        elif self.heading_level is not None:
            self.heading_buffer.append(data)
        elif self.block_depth:
            self.block_buffer.append(data)

    def flush_block(self) -> None:
        if not self.block_buffer:
            return
        text = clean_inline(" ".join(self.block_buffer))
        self.block_buffer = []
        if not text or text in NOISE_TITLES:
            return
        if any(marker in text for marker in ("上一篇", "下一篇", "用户笔记", "点我分享笔记")):
            return
        self.ensure_section()
        self.current_section["units"].append(text)

    def start_section(self, level: int, title: str) -> None:
        self.finish_section()
        while self.heading_stack and self.heading_stack[-1][0] >= level:
            self.heading_stack.pop()
        self.heading_stack.append((level, title))
        self.current_section = {
            "level": level,
            "title": title,
            "heading_path": [item[1] for item in self.heading_stack],
            "units": [],
        }

    def ensure_section(self) -> None:
        if self.current_section is None:
            title = self.page_title or self.source.display_name
            self.current_section = {
                "level": 1,
                "title": title,
                "heading_path": [title],
                "units": [],
            }

    def finish_section(self) -> None:
        if self.current_section is None:
            return
        text = clean_section_text("\n\n".join(self.current_section["units"]))
        if text:
            section = dict(self.current_section)
            section["text"] = text
            section.pop("units", None)
            self.sections.append(section)
        self.current_section = None

    def close(self) -> None:
        self.flush_block()
        self.finish_section()
        super().close()


def extract_source_sections_from_html(
    source: CorpusSource,
    source_url: str,
    raw_html_path: str,
    html_text: str,
    page_index: int,
) -> list[dict]:
    parser = EducationalHTMLParser(source)
    parser.feed(html_text)
    parser.close()
    page_title = parser.page_title or Path(raw_html_path).stem
    doc_slug = slug(source_url.removeprefix("https://").removeprefix("http://"))
    records: list[dict] = []
    for section_offset, section in enumerate(parser.sections, start=1):
        section_index = page_index * 1000 + section_offset
        title = section["title"]
        section_id = slug("/".join(section["heading_path"]) or title)
        records.append(
            {
                "source_id": source.source_id,
                "doc_id": f"{source.source_id}/{doc_slug}",
                "section_id": section_id,
                "section_index": section_index,
                "level": section["level"],
                "title": title,
                "heading_path": section["heading_path"],
                "page_title": page_title,
                "source_url": source_url,
                "raw_html_path": raw_html_path,
                "text": section["text"],
                "char_count": len(section["text"]),
                "source_license_note": source.license_note,
            },
        )
    return records


def chunk_records(section: dict) -> list[dict]:
    pieces = split_chunk_text(section["text"])
    records = []
    for index, text in enumerate(pieces, start=1):
        flags = [section["source_id"].replace("-", "_")]
        if "```" in text:
            flags.append("has_code")
        if len(text) < 120:
            flags.append("short")
        if len(pieces) > 1:
            flags.append("split_from_long_section")
        if section["source_id"] == "runoob-python3":
            flags.append("beginner_friendly_source")
        seed = f"{section['source_id']}\x1f{section['doc_id']}\x1f{section['section_id']}\x1f{index}\x1f{text[:80]}"
        records.append(
            {
                "source_id": section["source_id"],
                "chunk_id": f"{section['source_id']}-{stable_id(seed)}",
                "doc_id": section["doc_id"],
                "section_id": section["section_id"],
                "section_index": section["section_index"],
                "chunk_index": index,
                "chunk_total": len(pieces),
                "title": section["title"],
                "heading_path": section["heading_path"],
                "source_url": section["source_url"],
                "raw_html_path": section["raw_html_path"],
                "text": text,
                "char_count": len(text),
                "code_block_count": text.count("```python"),
                "quality_flags": flags,
                "source_license_note": section["source_license_note"],
            },
        )
    return records


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def extract_source(source: CorpusSource) -> dict:
    raw_manifest_path = ROOT / source.raw_dir / "source_manifest.json"
    raw_manifest = read_json(raw_manifest_path)
    sections: list[dict] = []
    for page_index, page in enumerate(raw_manifest.get("pages", []), start=1):
        raw_path = page["local_file"]
        html_text = (ROOT / raw_path).read_text(encoding="utf-8", errors="ignore")
        sections.extend(
            extract_source_sections_from_html(
                source=source,
                source_url=page["url"],
                raw_html_path=raw_path,
                html_text=html_text,
                page_index=page_index,
            ),
        )
    chunks = [chunk for section in sections for chunk in chunk_records(section)]
    out_dir = ROOT / source.processed_dir
    write_jsonl(out_dir / "sections.jsonl", sections)
    write_jsonl(out_dir / "chunks.jsonl", chunks)
    manifest = {
        "source_id": source.source_id,
        "display_name": source.display_name,
        "start_url": source.start_url,
        "language": source.language,
        "license_note": source.license_note,
        "publish_full_text": source.publish_full_text,
        "raw_manifest": str(raw_manifest_path.relative_to(ROOT)),
        "section_count": len(sections),
        "chunk_count": len(chunks),
        "files": {
            "sections_jsonl": str((out_dir / "sections.jsonl").relative_to(ROOT)),
            "chunks_jsonl": str((out_dir / "chunks.jsonl").relative_to(ROOT)),
        },
    }
    (out_dir / "source_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract external Python learning HTML into section/chunk corpora.")
    parser.add_argument("--source", choices=external_source_ids() + ["all"], required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_ids = external_source_ids() if args.source == "all" else [args.source]
    for source_id in source_ids:
        manifest = extract_source(source_by_id(source_id))
        print(f"{source_id}: {manifest['section_count']} sections, {manifest['chunk_count']} chunks")


if __name__ == "__main__":
    main()
