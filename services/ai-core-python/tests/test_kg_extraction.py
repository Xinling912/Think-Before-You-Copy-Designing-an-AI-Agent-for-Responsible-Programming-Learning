import json
from pathlib import Path

import yaml

from app.kg_extraction import (
    CANDIDATES_PATH,
    REQUIRED_FIELDS,
    candidate_id_for,
    extract_candidates_from_chunk,
    extract_candidates_from_chunks,
    load_chunks,
)
from scripts.corpus_sources import all_source_ids, source_by_id
from scripts import extract_kg_candidates


ROOT = Path(__file__).resolve().parents[3]


def chunk_with(text: str, chunk_id: str = "chunk-1", source_id: str = "python-docs-3.14.6") -> dict:
    return {
        "source_id": source_id,
        "chunk_id": chunk_id,
        "source_url": "https://docs.python.org/3/tutorial/introduction.html#lists",
        "source_license_note": "python-software-foundation-documentation-license",
        "title": "Sample",
        "heading_path": ["Sample"],
        "text": text,
    }


def relation_tuples(candidates: list[dict]) -> set[tuple[str, str, str]]:
    return {(row["subject"], row["predicate"], row["object"]) for row in candidates}


def concept_ids() -> set[str]:
    concepts_path = ROOT / "kg" / "concepts.yaml"
    return {
        row["id"]
        for row in yaml.safe_load(concepts_path.read_text(encoding="utf-8"))["concepts"]
    }


def assert_known_nodes(candidates: list[dict]) -> None:
    known = concept_ids()
    unknown = sorted({
        node
        for row in candidates
        for node in (row["subject"], row["object"])
        if node not in known
    })
    assert unknown == []


def assert_required_candidate_shape(candidate: dict, source_text: str) -> None:
    assert REQUIRED_FIELDS == {
        "candidate_id",
        "source_id",
        "source_chunk_id",
        "source_url",
        "source_license_note",
        "subject",
        "predicate",
        "object",
        "confidence",
        "evidence_text",
        "status",
        "created_at",
    }
    assert set(candidate) == REQUIRED_FIELDS
    assert candidate["candidate_id"].startswith("kgcand_")
    assert candidate["source_id"]
    assert candidate["source_chunk_id"]
    assert candidate["source_url"].startswith("https://")
    assert candidate["source_license_note"]
    assert 0 < candidate["confidence"] <= 1
    assert candidate["evidence_text"]
    assert candidate["evidence_text"] in source_text
    assert len(candidate["evidence_text"]) <= 320
    assert candidate["evidence_text"].count("```") in {0, 2}
    assert candidate["status"] == "auto_extracted"
    assert candidate["created_at"] == "2026-07-03T00:00:00Z"


def test_catalog_guided_extraction_uses_matched_nodes_and_existing_kg_edges() -> None:
    text = (
        "Like strings (and all other built-in sequence types), lists can be "
        "indexed and sliced:\n>>> squares[0]\n1\n>>> squares[-3:]\n[9, 16, 25]"
    )

    candidates = extract_candidates_from_chunk(chunk_with(text))

    relations = relation_tuples(candidates)
    assert relations
    nodes = {node for relation in relations for node in (relation[0], relation[2])}
    assert {"Concept:list", "Concept:index", "Concept:slice"}.issubset(nodes)
    assert_known_nodes(candidates)
    for candidate in candidates:
        assert_required_candidate_shape(candidate, text)


def test_catalog_guided_extraction_does_not_emit_edges_for_unrelated_text() -> None:
    text = "This section explains virtual environments, package installation, and shell activation."

    assert extract_candidates_from_chunk(chunk_with(text)) == []


def test_candidate_ids_are_stable_and_relation_specific() -> None:
    text = "Like strings, lists can be indexed and sliced."
    chunk = chunk_with(text, "stable-chunk")

    first = extract_candidates_from_chunk(chunk)
    second = extract_candidates_from_chunk(chunk)

    first_ids = [row["candidate_id"] for row in first]
    second_ids = [row["candidate_id"] for row in second]
    assert first_ids == second_ids
    assert len(first_ids) == len(set(first_ids))
    assert first_ids[0] == candidate_id_for(
        "stable-chunk",
        first[0]["subject"],
        first[0]["predicate"],
        first[0]["object"],
    )


def test_script_writes_stable_deduped_jsonl(tmp_path: Path) -> None:
    text = "Like strings, lists can be indexed and sliced."
    input_path = tmp_path / "chunks.jsonl"
    output_path = tmp_path / "candidates.jsonl"
    duplicated = chunk_with(text, "dup-chunk")
    input_path.write_text(
        "\n".join(json.dumps(row) for row in [duplicated, duplicated]) + "\n",
        encoding="utf-8",
    )

    extract_kg_candidates.main(["--input", str(input_path), "--output", str(output_path)])

    rows = [
        json.loads(line)
        for line in output_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert rows
    assert len(rows) == len({row["candidate_id"] for row in rows})
    assert [row["candidate_id"] for row in rows] == sorted(row["candidate_id"] for row in rows)
    for row in rows:
        assert_required_candidate_shape(row, text)


def test_real_multisource_corpus_extracts_known_nodes_and_readable_evidence() -> None:
    chunks = [
        chunk
        for source_id in all_source_ids()
        for chunk in load_chunks(ROOT / source_by_id(source_id).processed_dir / "chunks.jsonl")
    ]
    chunks_by_id = {str(row["chunk_id"]): str(row["text"]) for row in chunks}

    candidates = extract_candidates_from_chunks(chunks)

    assert len(candidates) >= 20
    assert len(candidates) == len({row["candidate_id"] for row in candidates})
    assert {row["source_id"] for row in candidates} == set(all_source_ids())
    assert_known_nodes(candidates)
    for row in candidates:
        assert_required_candidate_shape(row, chunks_by_id[row["source_chunk_id"]])


def test_generated_artifact_matches_extractor_output_and_schema() -> None:
    rows = [
        json.loads(line)
        for line in CANDIDATES_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    chunks = [
        chunk
        for source_id in all_source_ids()
        for chunk in load_chunks(ROOT / source_by_id(source_id).processed_dir / "chunks.jsonl")
    ]
    expected = extract_candidates_from_chunks(chunks)

    assert rows == expected
    assert len(rows) >= 20
    assert {row["source_id"] for row in rows} == set(all_source_ids())
    assert_known_nodes(rows)
    for row in rows:
        assert set(row) == REQUIRED_FIELDS
        assert row["created_at"] == "2026-07-03T00:00:00Z"
