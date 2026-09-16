#!/usr/bin/env python3
"""Extract deterministic KG edge candidates from processed Python learning chunks."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AI_CORE = ROOT / "services" / "ai-core-python"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(AI_CORE))

from app.kg_extraction import (  # noqa: E402
    CANDIDATES_PATH,
    CHUNKS_PATH,
    extract_candidates_from_chunks,
    load_chunks,
    write_candidates_jsonl,
)
from scripts.corpus_sources import all_source_ids, source_by_id  # noqa: E402


GENERATED_DIR = ROOT / "kg" / "generated"


def chunks_path_for_source(source_id: str) -> Path:
    return ROOT / source_by_id(source_id).processed_dir / "chunks.jsonl"


def candidates_path_for_source(source_id: str) -> Path:
    return GENERATED_DIR / f"{source_id}-candidates.jsonl"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract rule-based educational KG candidate edges from Python learning chunks.",
    )
    parser.add_argument("--source", choices=all_source_ids() + ["all"], default="all", help="Corpus source to extract. Defaults to all.")
    parser.add_argument("--input", type=Path, default=None, help="Input chunks JSONL path. Overrides --source when set.")
    parser.add_argument("--output", type=Path, default=CANDIDATES_PATH, help="Output candidates JSONL path.")
    parser.add_argument("--no-source-files", action="store_true", help="Do not write per-source candidate JSONL files.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    source_counts: dict[str, int] = {}
    candidate_counts: dict[str, int] = {}
    if args.input is not None:
        chunks = load_chunks(args.input)
        candidates = extract_candidates_from_chunks(chunks)
        for candidate in candidates:
            source_id = candidate.get("source_id") or "unknown"
            candidate_counts[source_id] = candidate_counts.get(source_id, 0) + 1
    else:
        selected_source_ids = all_source_ids() if args.source == "all" else [args.source]
        all_candidates: list[dict] = []
        for source_id in selected_source_ids:
            source_chunks = load_chunks(chunks_path_for_source(source_id))
            source_counts[source_id] = len(source_chunks)
            source_candidates = extract_candidates_from_chunks(source_chunks)
            candidate_counts[source_id] = len(source_candidates)
            all_candidates.extend(source_candidates)
            if not args.no_source_files:
                write_candidates_jsonl(source_candidates, candidates_path_for_source(source_id))
        candidates_by_id = {candidate["candidate_id"]: candidate for candidate in all_candidates}
        candidates = sorted(candidates_by_id.values(), key=lambda row: row["candidate_id"])
    write_candidates_jsonl(candidates, args.output)
    print(
        json.dumps(
            {
                "source": args.source,
                "input": str(args.input) if args.input is not None else None,
                "output": str(args.output),
                "candidate_count": len(candidates),
                "source_chunk_counts": source_counts,
                "source_candidate_counts": candidate_counts,
            },
            ensure_ascii=False,
            indent=2,
        ),
    )


if __name__ == "__main__":
    main()
