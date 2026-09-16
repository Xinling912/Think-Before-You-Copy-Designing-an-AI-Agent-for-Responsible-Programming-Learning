#!/usr/bin/env python3
"""Build semantic RAG indexes with DashScope embeddings."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AI_CORE = ROOT / "services" / "ai-core-python"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(AI_CORE))

from app.dashscope import DashScopeConfigurationError  # noqa: E402
from app.rag import DEFAULT_INDEX_NAME, INDEX_DIR, build_semantic_index, index_dir_for, load_chunks  # noqa: E402
from scripts.corpus_sources import all_source_ids, source_by_id  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build FAISS index from processed Python learning chunks using DashScope embeddings.")
    parser.add_argument("--limit", type=int, default=0, help="Only index the first N chunks. Use 0 for all chunks.")
    parser.add_argument("--batch-size", type=int, default=10, help="DashScope embedding batch size.")
    parser.add_argument(
        "--source-id",
        action="append",
        choices=all_source_ids(),
        default=[],
        help="Corpus source to include. Repeat for multiple sources. Omit for all sources.",
    )
    parser.add_argument("--index-name", default=DEFAULT_INDEX_NAME, help="Index name under data/indexes.")
    parser.add_argument("--index-dir", type=Path, default=None, help="Override output directory for manifest/docstore/faiss.index.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_ids = args.source_id or all_source_ids()
    chunks = load_chunks(source_ids=source_ids)
    if args.limit > 0:
        chunks = chunks[:args.limit]
    index_name = args.index_name
    if args.index_dir is None and len(source_ids) == 1 and index_name == DEFAULT_INDEX_NAME:
        index_name = source_by_id(source_ids[0]).source_id
    index_dir = args.index_dir or index_dir_for(index_name)
    try:
        manifest = build_semantic_index(
            chunks=chunks,
            index_dir=index_dir,
            batch_size=args.batch_size,
            source_ids=source_ids,
            index_name=index_name,
        )
    except DashScopeConfigurationError as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
