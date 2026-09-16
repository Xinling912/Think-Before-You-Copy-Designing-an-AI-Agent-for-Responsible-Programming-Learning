#!/usr/bin/env python3
"""Merge reviewed KG candidates into the project knowledge graph YAML files."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANDIDATES = ROOT / "kg" / "generated" / "candidates.jsonl"
DEFAULT_REVIEWS = ROOT / "services" / "api-gateway-go" / "responsible-edu-agent.db"
DEFAULT_CONCEPTS = ROOT / "kg" / "concepts.yaml"
DEFAULT_EDGES = ROOT / "kg" / "edges.yaml"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge approved KG candidates into KG YAML files.")
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--reviews", type=Path, default=DEFAULT_REVIEWS)
    parser.add_argument("--concepts", type=Path, default=DEFAULT_CONCEPTS)
    parser.add_argument("--edges", type=Path, default=DEFAULT_EDGES)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    candidates = load_candidates(args.candidates)
    reviews = load_reviews(args.reviews)
    concepts_doc = load_yaml_doc(args.concepts, "concepts")
    edges_doc = load_yaml_doc(args.edges, "edges")

    result = merge_candidates(candidates, reviews, concepts_doc, edges_doc)
    print_summary(result)

    if not args.dry_run:
        write_yaml_doc(args.concepts, concepts_doc)
        write_yaml_doc(args.edges, edges_doc)


def load_candidates(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def load_reviews(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                select candidate_id, status, reviewer_id, reviewer_note, reviewed_at
                from kg_candidate_reviews
                order by reviewed_at desc
                """,
            ).fetchall()
        except sqlite3.OperationalError:
            return {}
    reviews: dict[str, dict[str, Any]] = {}
    for row in rows:
        reviews.setdefault(row["candidate_id"], dict(row))
    return reviews


def load_yaml_doc(path: Path, root_key: str) -> dict[str, list[dict[str, Any]]]:
    if not path.exists():
        return {root_key: []}
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    value = loaded.get(root_key)
    if not isinstance(value, list):
        loaded[root_key] = []
    return loaded


def merge_candidates(
    candidates: list[dict[str, Any]],
    reviews: dict[str, dict[str, Any]],
    concepts_doc: dict[str, list[dict[str, Any]]],
    edges_doc: dict[str, list[dict[str, Any]]],
) -> dict[str, int]:
    known_concepts = {row.get("id") for row in concepts_doc["concepts"]}
    known_edges = {
        (row.get("from"), row.get("type"), row.get("to"))
        for row in edges_doc["edges"]
    }
    result = {
        "approved_candidates": 0,
        "new_concepts": 0,
        "new_edges": 0,
        "skipped_rejected": 0,
        "skipped_pending": 0,
    }

    for candidate in sorted(candidates, key=lambda row: str(row.get("candidate_id", ""))):
        review = reviews.get(str(candidate.get("candidate_id", "")))
        status = str((review or {}).get("status", "pending"))
        if status == "rejected":
            result["skipped_rejected"] += 1
            continue
        if status != "approved":
            result["skipped_pending"] += 1
            continue

        result["approved_candidates"] += 1
        for node_id in (candidate["subject"], candidate["object"]):
            if node_id not in known_concepts:
                concepts_doc["concepts"].append(concept_from_id(node_id))
                known_concepts.add(node_id)
                result["new_concepts"] += 1

        edge_key = (candidate["subject"], candidate["predicate"], candidate["object"])
        if edge_key in known_edges:
            continue
        edges_doc["edges"].append(edge_from_candidate(candidate, review or {}))
        known_edges.add(edge_key)
        result["new_edges"] += 1

    return result


def concept_from_id(node_id: str) -> dict[str, Any]:
    _, _, raw_label = node_id.partition(":")
    label = raw_label.replace("_", " ") or node_id
    return {
        "id": node_id,
        "label_zh": label,
        "label_en": label,
        "source": "kg-approved-candidate",
    }


def edge_from_candidate(candidate: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    return {
        "from": candidate["subject"],
        "type": candidate["predicate"],
        "to": candidate["object"],
        "weight": 1,
        "source": "python-official-docs",
        "source_candidate_id": candidate["candidate_id"],
        "source_chunk_id": candidate["source_chunk_id"],
        "source_url": candidate["source_url"],
        "evidence_text": candidate["evidence_text"],
        "confidence": candidate["confidence"],
        "review_status": "approved",
        "reviewer_id": review.get("reviewer_id", ""),
        "reviewed_at": review.get("reviewed_at", ""),
    }


def print_summary(result: dict[str, int]) -> None:
    for key in (
        "approved_candidates",
        "new_concepts",
        "new_edges",
        "skipped_rejected",
        "skipped_pending",
    ):
        print(f"{key}: {result[key]}")


def write_yaml_doc(path: Path, data: dict[str, list[dict[str, Any]]]) -> None:
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
