#!/usr/bin/env python3
"""Validate local research and Python docs corpus files."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
DOC_ROOT = ROOT / "data/raw/python-docs-3.14.6/html/python-3.14-docs-html"
TUTORIAL_FILES = {
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
}
STRUCTURAL_HEADINGS = {
    "2. Using the Python Interpreter",
    "2.2. The Interpreter and Its Environment",
    "10. Brief tour of the standard library",
    "12. Virtual Environments and Packages",
    "16. Appendix",
}


def require_file(path: str) -> Path:
    full = ROOT / path
    if not full.is_file():
        raise AssertionError(f"Missing required file: {path}")
    if full.stat().st_size == 0:
        raise AssertionError(f"Required file is empty: {path}")
    return full


def load_json(path: str) -> dict:
    return json.loads(require_file(path).read_text(encoding="utf-8"))


def read_jsonl(path: str) -> list[dict]:
    full = require_file(path)
    return [json.loads(line) for line in full.read_text(encoding="utf-8").splitlines() if line.strip()]


def normalize_for_compare(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def html_ids(path: Path) -> set[str]:
    html = path.read_text(encoding="utf-8", errors="ignore")
    return set(re.findall(r"""id=["']([^"']+)["']""", html))


def assert_official_url_anchor(source_url: str, allowed_paths: set[str], ids_by_path: dict[str, set[str]]) -> None:
    parsed = urlparse(source_url)
    rel_path = parsed.path.removeprefix("/3/")
    if rel_path not in allowed_paths:
        raise AssertionError(f"Unexpected Python docs source path: {source_url}")
    if parsed.fragment and parsed.fragment not in ids_by_path[rel_path]:
        raise AssertionError(f"Source URL anchor is not present in raw official HTML: {source_url}")


def main() -> None:
    python_manifest = load_json("data/processed/python-docs-3.14.6/source_manifest.json")
    if python_manifest["version"] != "3.14.6":
        raise AssertionError("Python docs corpus must be pinned to 3.14.6")

    require_file("data/raw/python-docs-3.14.6/archive/python-3.14-docs-html.zip")
    require_file("data/raw/python-docs-3.14.6/html/python-3.14-docs-html/tutorial/datastructures.html")
    require_file("data/raw/python-docs-3.14.6/html/python-3.14-docs-html/glossary.html")

    chunks = read_jsonl("data/processed/python-docs-3.14.6/chunks.jsonl")
    sections = read_jsonl("data/processed/python-docs-3.14.6/sections.jsonl")
    glossary = read_jsonl("data/processed/python-docs-3.14.6/glossary_terms.jsonl")
    ids_by_tutorial_path = {rel: html_ids(DOC_ROOT / rel) for rel in TUTORIAL_FILES}
    glossary_ids = html_ids(DOC_ROOT / "glossary.html")

    if len(chunks) < 100:
        raise AssertionError(f"Expected at least 100 Python docs chunks, found {len(chunks)}")
    if len(glossary) < 100:
        raise AssertionError(f"Expected at least 100 glossary terms, found {len(glossary)}")

    chunks_by_section: dict[tuple[str, str, int], list[dict]] = {}
    for chunk in chunks:
        key = (chunk["doc_id"], chunk["section_id"], chunk["section_index"])
        chunks_by_section.setdefault(key, []).append(chunk)

    for section in sections:
        assert_official_url_anchor(section["source_url"], TUTORIAL_FILES, ids_by_tutorial_path)
        key = (section["doc_id"], section["section_id"], section["section_index"])
        section_chunks = sorted(chunks_by_section.get(key, []), key=lambda item: item["chunk_index"])
        if not section_chunks:
            raise AssertionError(f"Section has no chunks: {section['title']}")
        reconstructed = "\n".join(chunk["text"] for chunk in section_chunks)
        if normalize_for_compare(reconstructed) != normalize_for_compare(section["text"]):
            raise AssertionError(f"Chunk split lost or changed text for section: {section['title']}")

    heading_path_titles = {title for section in sections for title in section.get("heading_path", [])}
    missing_structural_headings = sorted(STRUCTURAL_HEADINGS - heading_path_titles)
    if missing_structural_headings:
        raise AssertionError(f"Structural heading_path parents are missing: {missing_structural_headings}")

    for chunk in chunks:
        assert_official_url_anchor(chunk["source_url"], TUTORIAL_FILES, ids_by_tutorial_path)

    noise_titles = {"Previous topic", "Next topic", "This page", "Navigation", "Table of Contents"}
    noisy_chunks = [chunk for chunk in chunks if chunk["title"] in noise_titles]
    if noisy_chunks:
        examples = ", ".join(f"{chunk['title']}:{chunk['source_url']}" for chunk in noisy_chunks[:5])
        raise AssertionError(f"Navigation noise must not be included as chunks: {examples}")

    overlong_chunks = [chunk for chunk in chunks if chunk["char_count"] > 3200]
    if overlong_chunks:
        examples = ", ".join(f"{chunk['title']}={chunk['char_count']}" for chunk in overlong_chunks[:5])
        raise AssertionError(f"Chunks over 3200 characters must be split: {examples}")

    list_chunk = next((c for c in chunks if c["title"] == "5.1. More on Lists"), None)
    if not list_chunk:
        raise AssertionError("Missing Python docs chunk: 5.1. More on Lists")
    required_terms = ["list", "IndexError", "zero-based index"]
    missing_terms = [term for term in required_terms if term not in list_chunk["text"]]
    if missing_terms:
        raise AssertionError(f"List chunk missing terms: {missing_terms}")
    if not list_chunk.get("heading_path"):
        raise AssertionError("List chunk must include heading_path")
    if "official_source" not in list_chunk.get("quality_flags", []):
        raise AssertionError("List chunk must include official_source quality flag")

    text_chunks = [c for c in chunks if c["title"] == "3.1.2. Text"]
    text_content = "\n".join(chunk["text"] for chunk in sorted(text_chunks, key=lambda item: item["chunk_index"]))
    if '>>> print("""\\\n... Usage: thingy [OPTIONS]' not in text_content:
        raise AssertionError("3.1.2 Text triple-quote example must preserve prompt newlines")
    if '>>> print("""\\... Usage: thingy [OPTIONS]' in text_content:
        raise AssertionError("3.1.2 Text triple-quote example must not collapse prompt lines")

    glossary_terms = {entry["term"]: entry for entry in glossary}
    for term in ["list", "sequence", "slice", "iterator"]:
        if term not in glossary_terms:
            raise AssertionError(f"Missing glossary term: {term}")
        definition = glossary_terms[term].get("definition", "")
        if not definition:
            raise AssertionError(f"Glossary term must include definition: {term}")

    for entry in glossary:
        parsed = urlparse(entry["source_url"])
        if parsed.path != "/3/glossary.html":
            raise AssertionError(f"Unexpected glossary source path: {entry['source_url']}")
        if parsed.fragment not in glossary_ids:
            raise AssertionError(f"Glossary source URL anchor is not present in raw official HTML: {entry['source_url']}")

    paper_manifest = load_json("data/raw/papers/source_manifest.json")
    if len(paper_manifest["papers"]) != 4:
        raise AssertionError("Expected four research papers in manifest")

    for paper in paper_manifest["papers"]:
        require_file(paper["local_file"])
        if not paper.get("sha256"):
            raise AssertionError(f"Missing sha256 for paper: {paper['id']}")
        if not paper.get("doi"):
            raise AssertionError(f"Missing DOI for paper: {paper['id']}")

    print("Corpus checks passed.")


if __name__ == "__main__":
    main()
