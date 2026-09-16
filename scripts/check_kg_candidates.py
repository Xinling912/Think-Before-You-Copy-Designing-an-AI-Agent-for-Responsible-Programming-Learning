#!/usr/bin/env python3
"""Validate generated educational KG candidates and their source evidence."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
AI_CORE = ROOT / "services" / "ai-core-python"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(AI_CORE))

from app.kg_extraction import REQUIRED_FIELDS  # noqa: E402
from scripts.corpus_sources import all_source_ids, source_by_id  # noqa: E402


MERGED_CANDIDATES = ROOT / "kg" / "generated" / "candidates.jsonl"


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        raise AssertionError(f"Missing JSONL file: {path.relative_to(ROOT)}")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def concept_ids() -> set[str]:
    concepts_path = ROOT / "kg" / "concepts.yaml"
    data = yaml.safe_load(concepts_path.read_text(encoding="utf-8"))
    return {row["id"] for row in data["concepts"]}


def chunks_by_id(source_id: str) -> dict[str, dict]:
    path = ROOT / source_by_id(source_id).processed_dir / "chunks.jsonl"
    return {row["chunk_id"]: row for row in read_jsonl(path)}


def source_candidate_path(source_id: str) -> Path:
    return ROOT / "kg" / "generated" / f"{source_id}-candidates.jsonl"


def validate_candidate(candidate: dict, known_nodes: set[str], chunks: dict[str, dict]) -> None:
    if set(candidate) != REQUIRED_FIELDS:
        missing = sorted(REQUIRED_FIELDS - set(candidate))
        extra = sorted(set(candidate) - REQUIRED_FIELDS)
        raise AssertionError(f"KG candidate field mismatch: missing={missing}, extra={extra}")
    if not candidate["candidate_id"].startswith("kgcand_"):
        raise AssertionError(f"Unexpected candidate_id: {candidate['candidate_id']}")
    if candidate["subject"] not in known_nodes:
        raise AssertionError(f"Unknown candidate subject: {candidate['subject']}")
    if candidate["object"] not in known_nodes:
        raise AssertionError(f"Unknown candidate object: {candidate['object']}")
    if not 0 < float(candidate["confidence"]) <= 1:
        raise AssertionError(f"Invalid candidate confidence: {candidate['confidence']}")
    source_id = candidate["source_id"]
    if source_id not in all_source_ids():
        raise AssertionError(f"Unknown candidate source_id: {source_id}")
    source_chunk_id = candidate["source_chunk_id"]
    if source_chunk_id not in chunks:
        raise AssertionError(f"Candidate source chunk does not exist: {source_chunk_id}")
    evidence = candidate["evidence_text"]
    if not evidence or len(evidence) > 320:
        raise AssertionError(f"Candidate evidence must be non-empty and <= 320 chars: {candidate['candidate_id']}")
    if evidence not in chunks[source_chunk_id]["text"]:
        raise AssertionError(f"Candidate evidence not found in source chunk: {candidate['candidate_id']}")
    if not candidate["source_url"].startswith("http"):
        raise AssertionError(f"Candidate source_url must be public URL: {candidate['source_url']}")
    if not candidate["source_license_note"]:
        raise AssertionError(f"Candidate missing source_license_note: {candidate['candidate_id']}")
    if candidate["status"] != "auto_extracted":
        raise AssertionError(f"Candidate status must be auto_extracted: {candidate['status']}")


def main() -> None:
    known_nodes = concept_ids()
    merged = read_jsonl(MERGED_CANDIDATES)
    if not merged:
        raise AssertionError("Merged KG candidates must not be empty.")
    merged_ids = [row["candidate_id"] for row in merged]
    if len(merged_ids) != len(set(merged_ids)):
        raise AssertionError("Merged KG candidates contain duplicate candidate_id values.")

    all_chunks: dict[str, dict] = {}
    source_counts: dict[str, int] = {}
    for source_id in all_source_ids():
        chunks = chunks_by_id(source_id)
        all_chunks.update(chunks)
        source_rows = read_jsonl(source_candidate_path(source_id))
        if not source_rows:
            raise AssertionError(f"{source_id} must produce at least one KG candidate.")
        if any(row["source_id"] != source_id for row in source_rows):
            raise AssertionError(f"{source_id} candidate file contains another source_id.")
        source_counts[source_id] = len(source_rows)

    for candidate in merged:
        validate_candidate(candidate, known_nodes, all_chunks)

    if len(merged) != sum(source_counts.values()):
        raise AssertionError(
            f"Merged KG candidate count must equal per-source sum: {len(merged)} != {sum(source_counts.values())}",
        )

    print("KG candidate checks passed.")
    for source_id in all_source_ids():
        print(f"{source_id}: {source_counts[source_id]} candidates")
    print(f"merged: {len(merged)} candidates")


if __name__ == "__main__":
    main()
