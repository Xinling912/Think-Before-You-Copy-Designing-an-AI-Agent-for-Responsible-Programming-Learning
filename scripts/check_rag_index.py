#!/usr/bin/env python3
"""Validate checked-in semantic RAG index metadata for all corpus sources."""

from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.corpus_sources import CORPUS_SOURCES, MULTISOURCE_INDEX_ID, all_source_ids  # noqa: E402


INDEX_ROOT = ROOT / "data" / "indexes"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def processed_chunk_count(source_id: str) -> int:
    chunks_path = ROOT / CORPUS_SOURCES[source_id].processed_dir / "chunks.jsonl"
    if not chunks_path.is_file():
        raise AssertionError(f"Missing processed chunks for {source_id}: {chunks_path.relative_to(ROOT)}")
    return len([line for line in chunks_path.read_text(encoding="utf-8").splitlines() if line.strip()])


def validate_index(index_name: str, expected_source_ids: list[str]) -> dict:
    index_dir = INDEX_ROOT / index_name
    manifest_path = index_dir / "manifest.json"
    docstore_path = index_dir / "docstore.jsonl"
    faiss_path = index_dir / "faiss.index"
    for path in [manifest_path, docstore_path, faiss_path]:
        if not path.is_file():
            raise AssertionError(f"Missing RAG index file: {path.relative_to(ROOT)}")
        if path.stat().st_size == 0:
            raise AssertionError(f"RAG index file is empty: {path.relative_to(ROOT)}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_count = sum(processed_chunk_count(source_id) for source_id in expected_source_ids)
    expected = {
        "retrieval_mode": "semantic-vector-rerank",
        "backend": "faiss-flat-ip",
        "embedding_provider": "dashscope",
        "embedding_model": "text-embedding-v4",
        "dimensions": 1024,
        "document_count": expected_count,
        "version": index_name,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise AssertionError(f"{index_name} manifest {key} must be {value!r}, got {manifest.get(key)!r}")

    if manifest.get("source_ids") != expected_source_ids:
        raise AssertionError(
            f"{index_name} source_ids must be {expected_source_ids!r}, got {manifest.get('source_ids')!r}",
        )
    for source_id in expected_source_ids:
        count = processed_chunk_count(source_id)
        if manifest.get("source_counts", {}).get(source_id) != count:
            raise AssertionError(f"{index_name} source_counts[{source_id}] must be {count}")

    lines = read_jsonl(docstore_path)
    if len(lines) != manifest["document_count"]:
        raise AssertionError(
            f"{index_name} docstore count must match manifest: {len(lines)} != {manifest['document_count']}",
        )
    allowed = set(expected_source_ids)
    for row in lines:
        if "chunk" not in row or "embedding_text" not in row:
            raise AssertionError(f"{index_name} docstore entries must include chunk and embedding_text")
        source_id = row["chunk"].get("source_id")
        if source_id not in allowed:
            raise AssertionError(f"{index_name} docstore contains unexpected source_id: {source_id!r}")
    if (index_dir / "local_vector_index.json").exists():
        raise AssertionError(f"Legacy local_vector_index.json must not exist in {index_dir.relative_to(ROOT)}")
    return {
        "index_name": index_name,
        "document_count": len(lines),
        "source_ids": expected_source_ids,
    }


def main() -> None:
    results = [validate_index(source_id, [source_id]) for source_id in all_source_ids()]
    results.append(validate_index(MULTISOURCE_INDEX_ID, all_source_ids()))
    print("RAG index checks passed.")
    for result in results:
        print(f"{result['index_name']}: {result['document_count']} chunks from {', '.join(result['source_ids'])}")


if __name__ == "__main__":
    main()
