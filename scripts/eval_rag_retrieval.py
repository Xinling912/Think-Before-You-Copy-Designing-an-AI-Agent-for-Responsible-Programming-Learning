#!/usr/bin/env python3
"""Run semantic RAG smoke evaluations against the local FAISS index and DashScope reranker."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai-core-python"))

from app.rag import load_semantic_index, search_chunks  # noqa: E402


CASES = [
    {
        "query": "if怎么写啊",
        "top_titles": {"4.1. if Statements", "if 语句", "Conditional execution"},
    },
    {
        "query": "为什么我的 Python list 报 IndexError？",
        "top_titles": {
            "5.1. More on Lists",
            "10.2 Lists are mutable",
            "Lists are mutable",
            "8.2 len",
            "Index",
            "访问列表中的值",
        },
    },
    {
        "query": "怎么遍历列表",
        "top_titles": {
            "5.1. More on Lists",
            "4.2. for Statements",
            "5.6. Looping Techniques",
            "10.3 Traversing a list",
            "Traversing a list",
            "for 语句",
            "遍历技巧",
        },
    },
]


def main() -> None:
    load_semantic_index.cache_clear()
    for case in CASES:
        result = search_chunks(case["query"], top_k=5)
        if result["index"]["embedding_model"] != "text-embedding-v4":
            raise AssertionError("RAG eval must use DashScope text-embedding-v4")
        if result["reranker"]["model"] != "qwen3-rerank":
            raise AssertionError("RAG eval must use DashScope qwen3-rerank")
        top_title = result["chunks"][0]["title"]
        if top_title not in case["top_titles"]:
            raise AssertionError(
                f"Query {case['query']!r} expected top title in {case['top_titles']}, got {top_title!r}",
            )
        print(f"RAG eval passed: {case['query']} -> {top_title}")


if __name__ == "__main__":
    main()
