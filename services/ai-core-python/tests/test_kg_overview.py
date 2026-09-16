from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.curriculum_kg import load_curriculum_paths, load_curriculum_paths_for_diagnostics
from app.kg import build_kg_overview
from app.kg_catalog import load_kg_catalog
from app.main import app


def test_kg_overview_returns_visualization_contract():
    client = TestClient(app)

    response = client.get("/ai/kg/overview")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "version",
        "counts",
        "integrity",
        "categories",
        "nodes",
        "relations",
        "visual_edges",
        "paths",
    }
    assert body["counts"] == {
        "nodes": 83,
        "categories": 6,
        "curated_relation_triples": 364,
        "unique_relation_triples": 367,
        "visual_directed_pairs": 197,
        "internal_relation_triples": 312,
        "cross_category_relation_triples": 55,
        "paths": 160,
        "raw_edge_records": 3500,
    }
    assert body["integrity"]["valid"] is True
    assert len(body["categories"]) == 6
    assert len(body["nodes"]) == 83
    assert len(body["relations"]) == 367
    assert len(body["visual_edges"]) == 197
    assert len(body["paths"]) == 160
    node_ids = [node["node_id"] for node in body["nodes"]]
    category_ids = [category["id"] for category in body["categories"]]
    relation_keys = [relation["key"] for relation in body["relations"]]
    visual_edge_keys = [edge["key"] for edge in body["visual_edges"]]
    path_ids = [path["path_id"] for path in body["paths"]]
    assert len(set(node_ids)) == 83
    assert len(set(category_ids)) == 6
    assert [category["node_count"] for category in body["categories"]] == [10, 13, 16, 13, 13, 18]
    assert sum(category["node_count"] for category in body["categories"]) == 83
    assert all(node["category_id"] in category_ids for node in body["nodes"])
    assert len(set(relation_keys)) == 367
    assert len(set(visual_edge_keys)) == 197
    assert sum(edge["relation_count"] for edge in body["visual_edges"]) == 367
    assert all(
        relation["source"] in node_ids and relation["target"] in node_ids
        for relation in body["relations"]
    )
    assert len(set(path_ids)) == 160
    assert all(node_id in node_ids for path in body["paths"] for node_id in path["path"])

    node = body["nodes"][0]
    assert set(node) >= {
        "node_id",
        "label",
        "node_type",
        "origin",
        "aliases",
        "category_id",
        "unique_in_degree",
        "unique_out_degree",
        "unique_relation_degree",
        "path_ids",
    }
    assert isinstance(node["aliases"], list)
    assert node["unique_relation_degree"] == node["unique_in_degree"] + node["unique_out_degree"]
    assert isinstance(node["path_ids"], list)

    path = body["paths"][0]
    assert set(path) >= {
        "path_id",
        "path",
        "hop_count",
        "relations",
        "label",
        "topic",
        "source_url",
        "upstream",
        "focus",
        "downstream",
        "category_ids",
        "crosses_category_boundary",
        "focus_node_ids",
    }
    assert len(path["path"]) >= 2
    assert path["hop_count"] == len(path["path"]) - 1
    assert path["source_url"].startswith("https://")


def test_kg_overview_includes_index_error_path():
    client = TestClient(app)

    response = client.get("/ai/kg/overview")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert any("ErrorType:IndexError" in path["path"] for path in paths)


def test_kg_overview_reports_duplicate_node_ids_from_concepts_yaml(
    tmp_path: Path,
    monkeypatch,
):
    concepts_path = tmp_path / "concepts.yaml"
    edges_path = tmp_path / "edges.yaml"
    paths_path = tmp_path / "learning_paths.yaml"
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()
    concepts_path.write_text(
        """
concepts:
  - id: Concept:duplicate
    label_en: First definition
    label_zh: 第一个定义
    aliases: [first]
    category_id: program-foundations
    source: test-source
    source_url: https://example.test/first
    evidence_chunk_id: first-chunk
  - id: Concept:duplicate
    label_en: Second definition
    label_zh: 第二个定义
    aliases: [second]
    category_id: program-foundations
    source: test-source
    source_url: https://example.test/second
    evidence_chunk_id: second-chunk
""",
        encoding="utf-8",
    )
    edges_path.write_text("edges: []\n", encoding="utf-8")
    paths_path.write_text("paths: []\n", encoding="utf-8")

    monkeypatch.setattr(
        "app.kg.load_kg_catalog",
        lambda: load_kg_catalog(concepts_path, edges_path, generated_dir),
    )
    monkeypatch.setattr(
        "app.kg.load_curriculum_paths_for_diagnostics",
        lambda: load_curriculum_paths_for_diagnostics(paths_path=paths_path),
    )

    overview = build_kg_overview()

    assert overview["integrity"]["valid"] is False
    assert overview["integrity"]["duplicate_node_ids"] == ["Concept:duplicate"]


def test_kg_overview_reports_invalid_path_ids_from_learning_paths_yaml(
    tmp_path: Path,
    monkeypatch,
):
    concepts_path, edges_path, paths_path, generated_dir = _write_integrity_fixture(
        tmp_path,
        concepts="""
concepts:
  - id: Concept:a
    label_en: A
    aliases: [a]
    category_id: program-foundations
    source: test-source
    source_url: https://example.test/a
    evidence_chunk_id: chunk-a
  - id: Concept:b
    label_en: B
    aliases: [b]
    category_id: program-foundations
    source: test-source
    source_url: https://example.test/b
    evidence_chunk_id: chunk-b
""",
        paths="""
paths:
  - id: invalid-reference-path
    label_en: Invalid reference path
    topic: test
    upstream: [Concept:a]
    focus: [Concept:missing]
    downstream: [Concept:b]
    source_id: test-source
    source_url: https://example.test/path
    evidence_chunk_ids: [path-chunk]
""",
    )

    with pytest.raises(ValueError, match="unknown node Concept:missing"):
        load_curriculum_paths(concepts_path=concepts_path, paths_path=paths_path)

    monkeypatch.setattr(
        "app.kg.load_kg_catalog",
        lambda: load_kg_catalog(concepts_path, edges_path, generated_dir),
    )
    monkeypatch.setattr(
        "app.kg.load_curriculum_paths_for_diagnostics",
        lambda: load_curriculum_paths_for_diagnostics(paths_path=paths_path),
    )

    overview = build_kg_overview()

    assert overview["integrity"]["valid"] is False
    assert overview["integrity"]["invalid_path_ids"] == ["invalid-reference-path"]


def test_kg_overview_reports_duplicate_nodes_and_invalid_paths_together(
    tmp_path: Path,
    monkeypatch,
):
    concepts_path, edges_path, paths_path, generated_dir = _write_integrity_fixture(
        tmp_path,
        concepts="""
concepts:
  - id: Concept:duplicate
    label_en: First definition
    aliases: [first]
    category_id: program-foundations
    source: test-source
    source_url: https://example.test/first
    evidence_chunk_id: first-chunk
  - id: Concept:duplicate
    label_en: Second definition
    aliases: [second]
    category_id: program-foundations
    source: test-source
    source_url: https://example.test/second
    evidence_chunk_id: second-chunk
""",
        paths="""
paths:
  - id: invalid-reference-with-duplicate-node
    label_en: Invalid reference with duplicate node
    topic: test
    upstream: [Concept:duplicate]
    focus: [Concept:missing]
    downstream: [Concept:duplicate]
    source_id: test-source
    source_url: https://example.test/path
    evidence_chunk_ids: [path-chunk]
""",
    )

    with pytest.raises(ValueError, match="duplicate node id: Concept:duplicate"):
        load_curriculum_paths(concepts_path=concepts_path, paths_path=paths_path)

    monkeypatch.setattr(
        "app.kg.load_kg_catalog",
        lambda: load_kg_catalog(concepts_path, edges_path, generated_dir),
    )
    monkeypatch.setattr(
        "app.kg.load_curriculum_paths_for_diagnostics",
        lambda: load_curriculum_paths_for_diagnostics(paths_path=paths_path),
    )

    overview = build_kg_overview()

    assert overview["integrity"]["valid"] is False
    assert overview["integrity"]["duplicate_node_ids"] == ["Concept:duplicate"]
    assert overview["integrity"]["invalid_path_ids"] == [
        "invalid-reference-with-duplicate-node"
    ]


def _write_integrity_fixture(
    tmp_path: Path,
    *,
    concepts: str,
    paths: str,
) -> tuple[Path, Path, Path, Path]:
    concepts_path = tmp_path / "concepts.yaml"
    edges_path = tmp_path / "edges.yaml"
    paths_path = tmp_path / "learning_paths.yaml"
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()
    concepts_path.write_text(concepts, encoding="utf-8")
    edges_path.write_text("edges: []\n", encoding="utf-8")
    paths_path.write_text(paths, encoding="utf-8")
    return concepts_path, edges_path, paths_path, generated_dir
