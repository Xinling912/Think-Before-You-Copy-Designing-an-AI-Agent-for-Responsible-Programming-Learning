#!/usr/bin/env python3
"""Validate all Python learning corpus sources and lossless chunk splitting."""

from __future__ import annotations

import json
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.corpus_sources import CORPUS_SOURCES


NOISE_TITLES = {"Previous", "Next", "Navigation", "Table of Contents", "上一篇", "下一篇", "用户笔记", "Comments"}


def require_file(path: Path) -> Path:
    if not path.is_file():
        raise AssertionError(f"Missing required file: {path.relative_to(ROOT)}")
    if path.stat().st_size == 0:
        raise AssertionError(f"Required file is empty: {path.relative_to(ROOT)}")
    return path


def read_jsonl(path: Path) -> list[dict]:
    require_file(path)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def normalize_for_compare(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def reconstruct_section_text(chunks: list[dict]) -> str:
    return "\n\n".join(chunk["text"] for chunk in sorted(chunks, key=lambda row: row["chunk_index"]))


def validate_chunk_sequence(section_key: str, chunks: list[dict]) -> None:
    indexes = [chunk["chunk_index"] for chunk in sorted(chunks, key=lambda row: row["chunk_index"])]
    expected = list(range(1, len(indexes) + 1))
    if indexes != expected:
        raise AssertionError(f"Section {section_key} has non-contiguous chunk indexes: {indexes}")


def validate_source(source_id: str) -> dict:
    source = CORPUS_SOURCES[source_id]
    processed_dir = ROOT / source.processed_dir
    manifest_path = require_file(processed_dir / "source_manifest.json")
    sections = read_jsonl(processed_dir / "sections.jsonl")
    chunks = read_jsonl(processed_dir / "chunks.jsonl")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not sections:
        raise AssertionError(f"{source_id} has no sections")
    if not chunks:
        raise AssertionError(f"{source_id} has no chunks")

    chunks_by_section: dict[tuple[str, str, int], list[dict]] = {}
    for chunk in chunks:
        if chunk.get("title") in NOISE_TITLES:
            raise AssertionError(f"{source_id} contains navigation/noise chunk: {chunk['title']}")
        if int(chunk.get("char_count", len(chunk.get("text", "")))) > 3200:
            raise AssertionError(f"{source_id} has overlong chunk: {chunk.get('chunk_id')}")
        if chunk.get("source_id", source_id) != source_id:
            raise AssertionError(f"Unexpected source_id in chunk {chunk.get('chunk_id')}: {chunk.get('source_id')}")
        raw_path = chunk.get("raw_html_path") or chunk.get("html_path")
        if raw_path and not (ROOT / raw_path).is_file():
            raise AssertionError(f"Chunk raw html path is missing: {raw_path}")
        if source_id != "python-docs-3.14.6":
            for field in ["source_id", "source_url", "raw_html_path", "source_license_note"]:
                if not chunk.get(field):
                    raise AssertionError(f"{source_id} chunk missing field {field}: {chunk.get('chunk_id')}")
        key = (chunk["doc_id"], chunk["section_id"], chunk["section_index"])
        chunks_by_section.setdefault(key, []).append(chunk)

    for section in sections:
        key = (section["doc_id"], section["section_id"], section["section_index"])
        section_chunks = chunks_by_section.get(key, [])
        if not section_chunks:
            raise AssertionError(f"{source_id} section has no chunks: {section['title']}")
        validate_chunk_sequence(str(key), section_chunks)
        reconstructed = reconstruct_section_text(section_chunks)
        if normalize_for_compare(reconstructed) != normalize_for_compare(section["text"]):
            raise AssertionError(f"{source_id} chunk split changed text for section: {section['title']}")

    return {
        "source_id": source_id,
        "sections": len(sections),
        "chunks": len(chunks),
        "manifest": manifest,
    }


def main() -> None:
    results = [validate_source(source_id) for source_id in CORPUS_SOURCES]
    print("Multisource corpus checks passed.")
    for result in results:
        print(f"{result['source_id']}: {result['sections']} sections, {result['chunks']} chunks")


if __name__ == "__main__":
    main()
