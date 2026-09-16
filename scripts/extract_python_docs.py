#!/usr/bin/env python3
"""Extract the local Python tutorial and glossary archive into JSONL corpora."""

from __future__ import annotations

import hashlib
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DOC_ROOT = ROOT / "data/raw/python-docs-3.14.6/html/python-3.14-docs-html"
OUT_DIR = ROOT / "data/processed/python-docs-3.14.6"
BASE_URL = "https://docs.python.org/3/"
VERSION = "3.14.6"
NOISE_TITLES = {"Previous topic", "Next topic", "This page", "Navigation", "Table of Contents"}
MAX_CHUNK_CHARS = 2500
CODE_FENCE_RE = re.compile(r"```python\n.*?\n```", re.DOTALL)


TUTORIAL_FILES = [
    "tutorial/appetite.html",
    "tutorial/interpreter.html",
    "tutorial/introduction.html",
    "tutorial/controlflow.html",
    "tutorial/datastructures.html",
    "tutorial/modules.html",
    "tutorial/inputoutput.html",
    "tutorial/errors.html",
    "tutorial/classes.html",
    "tutorial/stdlib.html",
    "tutorial/stdlib2.html",
    "tutorial/venv.html",
    "tutorial/whatnow.html",
    "tutorial/interactive.html",
    "tutorial/floatingpoint.html",
    "tutorial/appendix.html",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def slug(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", text.lower()).strip("-")
    return cleaned[:80] or "section"


def clean_ws(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_inline(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_prose_text(text: str) -> str:
    text = clean_ws(text)
    text = re.sub(r"\b([a-z_][\w]*)\s*\.\s+([a-z_][\w]*)", r"\1.\2", text)
    text = re.sub(r"([a-z0-9)\]])\.(list\.)", r"\1. \2", text)
    text = re.sub(r"\b([a-z_][\w]*)\s*\.\s+([a-z_][\w]*)", r"\1.\2", text)
    for method in ["append", "extend", "insert", "remove", "pop", "clear", "index", "count", "sort", "reverse", "copy"]:
        text = re.sub(rf"\.?\s*list\.\s*{method}\s*\(", f"\nlist.{method} (", text)
    text = re.sub(r"([.!?])([A-Z])", r"\1 \2", text)
    text = re.sub(r"\s+([,.;:)\]])", r"\1", text)
    text = re.sub(r"([(\[])\s+", r"\1", text)
    text = re.sub(r"\s+/", "/", text)
    text = re.sub(r"/\s+", "/ ", text)
    return clean_ws(text)


def normalize_doc_text(text: str) -> str:
    parts: list[str] = []
    last_end = 0
    for match in CODE_FENCE_RE.finditer(text):
        prose = text[last_end:match.start()]
        normalized_prose = normalize_prose_text(prose)
        if normalized_prose:
            parts.append(normalized_prose)
        parts.append(match.group(0).strip())
        last_end = match.end()

    trailing_prose = normalize_prose_text(text[last_end:])
    if trailing_prose:
        parts.append(trailing_prose)

    return clean_ws("\n\n".join(parts))


def split_large_unit(unit: str, max_chars: int) -> list[str]:
    if len(unit) <= max_chars:
        return [unit]

    sentences = re.split(r"(?<=[.!?。！？])\s+", unit)
    parts: list[str] = []
    current: list[str] = []
    current_len = 0
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) > max_chars:
            if current:
                parts.append(" ".join(current))
                current = []
                current_len = 0
            words = sentence.split()
            word_chunk: list[str] = []
            word_len = 0
            for word in words:
                if word_chunk and word_len + len(word) + 1 > max_chars:
                    parts.append(" ".join(word_chunk))
                    word_chunk = []
                    word_len = 0
                word_chunk.append(word)
                word_len += len(word) + 1
            if word_chunk:
                parts.append(" ".join(word_chunk))
            continue
        if current and current_len + len(sentence) + 1 > max_chars:
            parts.append(" ".join(current))
            current = []
            current_len = 0
        current.append(sentence)
        current_len += len(sentence) + 1

    if current:
        parts.append(" ".join(current))
    return parts or [unit[:max_chars]]


def split_chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    if len(text) <= max_chars:
        return [text]

    units: list[str] = []
    last_end = 0
    for match in CODE_FENCE_RE.finditer(text):
        prose = text[last_end:match.start()]
        for unit in prose.split("\n"):
            unit = clean_ws(unit)
            if unit:
                units.extend(split_large_unit(unit, max_chars))
        units.append(match.group(0).strip())
        last_end = match.end()

    trailing_prose = text[last_end:]
    for unit in trailing_prose.split("\n"):
        unit = clean_ws(unit)
        if unit:
            units.extend(split_large_unit(unit, max_chars))

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for unit in units:
        extra = len(unit) + (1 if current else 0)
        if current and current_len + extra > max_chars:
            chunks.append(clean_ws("\n".join(current)))
            current = []
            current_len = 0
        current.append(unit)
        current_len += extra

    if current:
        chunks.append(clean_ws("\n".join(current)))
    return chunks


def quality_flags(chunk_text: str, source_url: str, chunk_total: int) -> list[str]:
    flags = ["official_source"]
    if "```" in chunk_text:
        flags.append("has_code")
    if len(chunk_text) < 120:
        flags.append("short")
    if chunk_total > 1:
        flags.append("split_from_long_section")
    if source_url.startswith(BASE_URL):
        flags.append("python_docs")
    return flags


class BodyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_main = False
        self.skip_depth = 0
        self.current_tag: str | None = None
        self.title: str = ""
        self.heading_level: int | None = None
        self.heading_id: str | None = None
        self.heading_text: list[str] = []
        self.sections: list[dict] = []
        self.current_section: dict | None = None
        self.code_buffer: list[str] | None = None
        self.section_id_stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        classes = set((attrs_dict.get("class") or "").split())

        if tag == "div" and "body" in classes and attrs_dict.get("role") == "main":
            self.in_main = True
            return

        if not self.in_main:
            if tag == "title":
                self.current_tag = "title"
            return

        if tag == "a" and "headerlink" in classes:
            self.skip_depth += 1
            return

        if tag in {"nav", "script", "style"}:
            self.skip_depth += 1
            return

        if tag == "section":
            self.section_id_stack.append(attrs_dict.get("id") or "")
            return

        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.heading_level = int(tag[1])
            self.heading_id = attrs_dict.get("id")
            self.heading_text = []
            self.current_tag = tag
            return

        if tag == "pre":
            self.code_buffer = []
            self.current_tag = "pre"
            return

        if tag in {"p", "li", "dt", "dd"}:
            self.current_tag = tag

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            self.skip_depth -= 1
            return

        if not self.in_main:
            if tag == "title":
                self.current_tag = None
            return

        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"} and self.heading_level:
            title = clean_ws("".join(self.heading_text))
            if title:
                self.current_section = {
                    "section_id": self.heading_id or next((id_ for id_ in reversed(self.section_id_stack) if id_), "") or slug(title),
                    "level": self.heading_level,
                    "title": title,
                    "text_parts": [],
                    "code_blocks": [],
                }
                self.sections.append(self.current_section)
            self.heading_level = None
            self.heading_id = None
            self.heading_text = []
            self.current_tag = None
            return

        if tag == "section" and self.section_id_stack:
            self.section_id_stack.pop()
            return

        if tag == "pre" and self.code_buffer is not None:
            code = "".join(self.code_buffer).strip("\n")
            if code and self.current_section:
                self.current_section["code_blocks"].append(code)
                self.current_section["text_parts"].append(f"\n```python\n{code}\n```\n")
            self.code_buffer = None
            self.current_tag = None
            return

        if tag in {"p", "li", "dt", "dd"}:
            if self.current_section:
                self.current_section["text_parts"].append("\n")
            self.current_tag = None

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return

        if not self.in_main:
            if self.current_tag == "title":
                self.title += data
            return

        if self.heading_level:
            self.heading_text.append(data)
            return

        if self.code_buffer is not None:
            self.code_buffer.append(data)
            return

        if self.current_tag in {"p", "li", "dt", "dd"} and self.current_section:
            text = clean_inline(data)
            if text:
                self.current_section["text_parts"].append(text)


class GlossaryParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_glossary = False
        self.skip_depth = 0
        self.current_term: list[str] | None = None
        self.current_definition: list[str] | None = None
        self.pending_terms: list[dict] = []
        self.records: list[dict] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        classes = set((attrs_dict.get("class") or "").split())
        if tag == "dl" and "glossary" in classes:
            self.in_glossary = True
            return
        if not self.in_glossary:
            return
        if tag == "a" and "headerlink" in classes:
            self.skip_depth += 1
            return
        if tag in {"script", "style"}:
            self.skip_depth += 1
            return
        if tag == "dt":
            self.current_term = []
            self.pending_terms.append({"term_id": attrs_dict.get("id") or "", "term": ""})
            return
        if tag == "dd":
            self.current_definition = []
            return
        if tag == "pre" and self.current_definition is not None:
            self.current_definition.append("\n```python\n")

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if not self.in_glossary:
            return
        if tag == "dt" and self.current_term is not None:
            term = clean_ws("".join(self.current_term))
            if self.pending_terms:
                self.pending_terms[-1]["term"] = term
            self.current_term = None
            return
        if tag == "dd" and self.current_definition is not None:
            definition = clean_ws(" ".join(self.current_definition))
            for term_record in self.pending_terms:
                term = term_record["term"]
                term_id = term_record["term_id"]
                if term:
                    self.records.append({
                        "term": term,
                        "term_id": term_id,
                        "definition": definition,
                        "source_url": f"{BASE_URL}glossary.html#{term_id}",
                        "html_path": "data/raw/python-docs-3.14.6/html/python-3.14-docs-html/glossary.html",
                        "page_title": "Glossary",
                        "version": VERSION,
                        "source": "Python official documentation",
                        "license": "Python Software Foundation License",
                    })
            self.pending_terms = []
            self.current_definition = None
            return
        if tag == "pre" and self.current_definition is not None:
            self.current_definition.append("\n```\n")

    def handle_data(self, data: str) -> None:
        if self.skip_depth or not self.in_glossary:
            return
        if self.current_term is not None:
            self.current_term.append(data)
            return
        if self.current_definition is not None:
            text = clean_inline(data)
            if text:
                self.current_definition.append(text)


def parse_html(path: Path) -> tuple[str, list[dict]]:
    parser = BodyParser()
    parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
    title = clean_ws(parser.title).replace(" — Python 3.14.6 documentation", "")
    sections = []
    heading_stack: list[tuple[int, str]] = []
    for section in parser.sections:
        if section["title"] in NOISE_TITLES:
            continue
        heading_stack = [(level, text) for level, text in heading_stack if level < section["level"]]
        heading_stack.append((section["level"], section["title"]))
        section["heading_path"] = [text for _, text in heading_stack]
        text = normalize_doc_text(" ".join(section.pop("text_parts")))
        if not text:
            continue
        section["text"] = text
        sections.append(section)
    return title, sections


def iter_records() -> Iterable[dict]:
    for rel in TUTORIAL_FILES:
        path = DOC_ROOT / rel
        title, sections = parse_html(path)
        for index, section in enumerate(sections, start=1):
            source_url = f"{BASE_URL}{rel}"
            if section["section_id"]:
                source_url += f"#{section['section_id']}"
            yield {
                "doc_id": rel.replace("/", ":").replace(".html", ""),
                "section_index": index,
                "section_id": section["section_id"],
                "level": section["level"],
                "title": section["title"],
                "heading_path": section["heading_path"],
                "page_title": title,
                "source_url": source_url,
                "html_path": str(path.relative_to(ROOT)),
                "text": section["text"],
                "code_blocks": section["code_blocks"],
                "version": VERSION,
                "source": "Python official documentation",
                "license": "Python Software Foundation License",
            }


def chunk_records(section: dict) -> list[dict]:
    chunk_texts = split_chunk_text(section["text"])
    records: list[dict] = []
    chunk_total = len(chunk_texts)
    for chunk_index, chunk_text in enumerate(chunk_texts, start=1):
        chunk_id_seed = f"{section['doc_id']}:{section['section_id']}:{section['section_index']}:{chunk_index}"
        title = section["title"]
        records.append({
            "chunk_id": "python-docs-3.14.6-" + hashlib.sha1(chunk_id_seed.encode()).hexdigest()[:12],
            "doc_id": section["doc_id"],
            "section_id": section["section_id"],
            "section_index": section["section_index"],
            "chunk_index": chunk_index,
            "chunk_total": chunk_total,
            "title": title,
            "heading_path": section["heading_path"],
            "source_url": section["source_url"],
            "text": chunk_text,
            "char_count": len(chunk_text),
            "code_block_count": chunk_text.count("```python"),
            "quality_flags": quality_flags(chunk_text, section["source_url"], chunk_total),
            "version": section["version"],
            "source": section["source"],
            "license": section["license"],
        })
    return records


def chunk_record(section: dict) -> dict:
    chunk_text = section["text"]
    chunk_id_seed = f"{section['doc_id']}:{section['section_id']}:{section['section_index']}:1"
    return {
        "chunk_id": "python-docs-3.14.6-" + hashlib.sha1(chunk_id_seed.encode()).hexdigest()[:12],
        "doc_id": section["doc_id"],
        "section_id": section["section_id"],
        "section_index": section["section_index"],
        "chunk_index": 1,
        "chunk_total": 1,
        "title": section["title"],
        "heading_path": section["heading_path"],
        "source_url": section["source_url"],
        "text": chunk_text,
        "char_count": len(chunk_text),
        "code_block_count": len(section["code_blocks"]),
        "quality_flags": quality_flags(chunk_text, section["source_url"], 1),
        "version": section["version"],
        "source": section["source"],
        "license": section["license"],
    }


def extract_glossary() -> list[dict]:
    path = DOC_ROOT / "glossary.html"
    parser = GlossaryParser()
    parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
    return parser.records


def write_jsonl(path: Path, records: Iterable[dict]) -> int:
    count = 0
    with path.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    return count


def main() -> None:
    if not DOC_ROOT.exists():
        raise SystemExit(f"Missing Python docs root: {DOC_ROOT}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sections = list(iter_records())
    chunks = [chunk for section in sections for chunk in chunk_records(section)]
    glossary_terms = extract_glossary()

    section_count = write_jsonl(OUT_DIR / "sections.jsonl", sections)
    chunk_count = write_jsonl(OUT_DIR / "chunks.jsonl", chunks)
    glossary_count = write_jsonl(OUT_DIR / "glossary_terms.jsonl", glossary_terms)

    manifest = {
        "name": "python-docs-tutorial-glossary",
        "version": VERSION,
        "download_url": "https://docs.python.org/3/archives/python-3.14-docs-html.zip",
        "raw_archive": "data/raw/python-docs-3.14.6/archive/python-3.14-docs-html.zip",
        "raw_archive_sha256": sha256(ROOT / "data/raw/python-docs-3.14.6/archive/python-3.14-docs-html.zip"),
        "raw_html_root": "data/raw/python-docs-3.14.6/html/python-3.14-docs-html",
        "processed_outputs": {
            "sections_jsonl": "data/processed/python-docs-3.14.6/sections.jsonl",
            "chunks_jsonl": "data/processed/python-docs-3.14.6/chunks.jsonl",
            "glossary_terms_jsonl": "data/processed/python-docs-3.14.6/glossary_terms.jsonl",
        },
        "counts": {
            "sections": section_count,
            "chunks": chunk_count,
            "glossary_terms": glossary_count,
        },
        "license": "Python Software Foundation License",
        "source_home": "https://docs.python.org/3/",
        "source_tutorial": "https://docs.python.org/3/tutorial/index.html",
        "source_glossary": "https://docs.python.org/3/glossary.html",
    }
    (OUT_DIR / "source_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "data/raw/python-docs-3.14.6/source_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
