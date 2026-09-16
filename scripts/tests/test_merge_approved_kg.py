import json
import sqlite3
from pathlib import Path

import yaml

from scripts import merge_approved_kg


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def create_review_db(path: Path) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute(
            """
            create table kg_candidate_reviews (
              candidate_id text not null unique,
              status text not null,
              reviewer_id text not null,
              reviewer_note text not null default '',
              reviewed_at text not null,
              created_at text not null,
              updated_at text not null
            )
            """,
        )
        conn.executemany(
            """
            insert into kg_candidate_reviews
              (candidate_id, status, reviewer_id, reviewer_note, reviewed_at, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "kgcand-approved",
                    "approved",
                    "reviewer-a",
                    "official evidence",
                    "2026-07-04T00:00:00Z",
                    "2026-07-04T00:00:00Z",
                    "2026-07-04T00:00:00Z",
                ),
                (
                    "kgcand-rejected",
                    "rejected",
                    "reviewer-a",
                    "too broad",
                    "2026-07-04T00:10:00Z",
                    "2026-07-04T00:10:00Z",
                    "2026-07-04T00:10:00Z",
                ),
            ],
        )


def test_merge_approved_kg_dry_run_reports_counts_without_writing(tmp_path: Path, capsys):
    candidates = tmp_path / "candidates.jsonl"
    reviews = tmp_path / "reviews.db"
    concepts = tmp_path / "concepts.yaml"
    edges = tmp_path / "edges.yaml"
    write_jsonl(
        candidates,
        [
            candidate("kgcand-approved", "Concept:list", "supports_operation", "Concept:index"),
            candidate("kgcand-rejected", "Concept:list", "supports_operation", "Concept:slice"),
            candidate("kgcand-pending", "Concept:list", "measured_by", "Concept:len"),
        ],
    )
    create_review_db(reviews)
    concepts.write_text("concepts:\n  - id: Concept:list\n    label_en: list\n", encoding="utf-8")
    edges.write_text("edges: []\n", encoding="utf-8")

    merge_approved_kg.main([
        "--candidates",
        str(candidates),
        "--reviews",
        str(reviews),
        "--concepts",
        str(concepts),
        "--edges",
        str(edges),
        "--dry-run",
    ])

    output = capsys.readouterr().out
    assert "approved_candidates: 1" in output
    assert "new_concepts: 1" in output
    assert "new_edges: 1" in output
    assert "skipped_rejected: 1" in output
    assert "skipped_pending: 1" in output
    assert yaml.safe_load(edges.read_text(encoding="utf-8")) == {"edges": []}


def test_merge_approved_kg_writes_source_grounded_edge_metadata(tmp_path: Path):
    candidates = tmp_path / "candidates.jsonl"
    reviews = tmp_path / "reviews.db"
    concepts = tmp_path / "concepts.yaml"
    edges = tmp_path / "edges.yaml"
    write_jsonl(
        candidates,
        [candidate("kgcand-approved", "Concept:list", "supports_operation", "Concept:index")],
    )
    create_review_db(reviews)
    concepts.write_text("concepts:\n  - id: Concept:list\n    label_en: list\n", encoding="utf-8")
    edges.write_text("edges: []\n", encoding="utf-8")

    merge_approved_kg.main([
        "--candidates",
        str(candidates),
        "--reviews",
        str(reviews),
        "--concepts",
        str(concepts),
        "--edges",
        str(edges),
    ])

    merged_concepts = yaml.safe_load(concepts.read_text(encoding="utf-8"))["concepts"]
    merged_edges = yaml.safe_load(edges.read_text(encoding="utf-8"))["edges"]
    assert any(row["id"] == "Concept:index" for row in merged_concepts)
    assert merged_edges == [
        {
            "from": "Concept:list",
            "type": "supports_operation",
            "to": "Concept:index",
            "weight": 1,
            "source": "python-official-docs",
            "source_candidate_id": "kgcand-approved",
            "source_chunk_id": "python-docs-3.14.6-demo",
            "source_url": "https://docs.python.org/3/tutorial/introduction.html#lists",
            "evidence_text": "Lists can be indexed.",
            "confidence": 0.92,
            "review_status": "approved",
            "reviewer_id": "reviewer-a",
            "reviewed_at": "2026-07-04T00:00:00Z",
        },
    ]


def candidate(candidate_id: str, subject: str, predicate: str, object_: str) -> dict:
    return {
        "candidate_id": candidate_id,
        "source_chunk_id": "python-docs-3.14.6-demo",
        "source_url": "https://docs.python.org/3/tutorial/introduction.html#lists",
        "subject": subject,
        "predicate": predicate,
        "object": object_,
        "confidence": 0.92,
        "evidence_text": "Lists can be indexed.",
        "status": "auto_extracted",
        "created_at": "2026-07-03T00:00:00Z",
    }
