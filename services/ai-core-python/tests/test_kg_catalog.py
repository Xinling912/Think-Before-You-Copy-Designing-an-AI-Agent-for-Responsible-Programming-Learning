import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.kg import reason_between
from app.kg_catalog import load_kg_catalog


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def make_catalog_fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    concepts_path = tmp_path / "concepts.yaml"
    edges_path = tmp_path / "edges.yaml"
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()

    concepts_path.write_text(
        """
concepts:
  - id: Concept:python
    label_en: Python
    label_zh: Python
    aliases: [interpreter]
    source: manual-source
""",
        encoding="utf-8",
    )
    edges_path.write_text("edges: []\n", encoding="utf-8")

    sources = {
        "python-docs-3.14.6": ("Concept:dictionary_get", "Concept:KeyError", "dict.get avoids KeyError when a key is missing."),
        "runoob-python3": ("Concept:decorator", "Concept:function", "Decorators wrap functions without changing call sites."),
        "think-python-2e": ("Concept:file_read", "Concept:file_object", "Reading files uses file objects and close operations."),
        "py4e-html3": ("Concept:floating_point", "Concept:rounding_error", "Floating-point values can have representation error."),
    }
    for source_id, (subject, object_, evidence) in sources.items():
        write_jsonl(
            generated_dir / f"{source_id}-candidates.jsonl",
            [
                {
                    "candidate_id": f"cand-{source_id}",
                    "source_id": source_id,
                    "source_chunk_id": f"{source_id}-chunk-1",
                    "source_url": f"https://example.test/{source_id}",
                    "source_license_note": "test-license",
                    "subject": subject,
                    "predicate": "explains",
                    "object": object_,
                    "confidence": 0.91,
                    "evidence_text": evidence,
                    "status": "auto_extracted",
                    "created_at": "2026-07-08T00:00:00Z",
                }
            ],
        )

    write_jsonl(
        generated_dir / "candidates.jsonl",
        [
            {
                "candidate_id": "merged-dict-path",
                "source_id": "merged-source",
                "source_chunk_id": "merged-chunk",
                "source_url": "https://example.test/merged",
                "source_license_note": "test-license",
                "subject": "Concept:dictionary_get",
                "predicate": "contrasts_with",
                "object": "Concept:key_lookup",
                "confidence": 0.88,
                "evidence_text": "d[key] performs key lookup while dict.get can provide a default.",
                "status": "auto_extracted",
                "created_at": "2026-07-08T00:00:00Z",
            }
        ],
    )

    return concepts_path, edges_path, generated_dir


def test_catalog_loads_all_four_sources(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = make_catalog_fixture(tmp_path)

    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)

    assert {
        "python-docs-3.14.6",
        "runoob-python3",
        "think-python-2e",
        "py4e-html3",
    }.issubset(catalog.source_ids())


def test_catalog_creates_nodes_from_candidate_subjects_and_objects(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = make_catalog_fixture(tmp_path)

    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)

    assert catalog.get_node("Concept:dictionary_get").origin == "generated"
    assert catalog.get_node("Concept:key_lookup").origin == "merged"
    assert catalog.get_node("Concept:decorator").label == "decorator"


def test_catalog_preserves_source_chunk_id_and_source_url(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = make_catalog_fixture(tmp_path)

    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)
    node = catalog.get_node("Concept:floating_point")

    assert node.source_ids == ("py4e-html3",)
    assert node.source_chunk_ids == ("py4e-html3-chunk-1",)
    assert node.source_urls == ("https://example.test/py4e-html3",)
    assert node.evidence_texts == ("Floating-point values can have representation error.",)
    assert node.confidence == 0.91


def test_catalog_search_can_find_dictionary_nodes_without_manual_yaml_entry(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = make_catalog_fixture(tmp_path)

    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)
    results = catalog.search("dict.get default missing key", top_k=3)

    assert results[0].node.node_id == "Concept:dictionary_get"
    assert any(hit.node.node_id == "Concept:key_lookup" for hit in results)


def test_catalog_search_can_find_decorator_nodes_without_manual_yaml_entry(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = make_catalog_fixture(tmp_path)

    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)
    results = catalog.search("wrap function decorator", top_k=3)

    assert results[0].node.node_id == "Concept:decorator"
    assert "explains" in results[0].matched_text


def test_catalog_search_uses_manual_chinese_labels(tmp_path: Path) -> None:
    concepts_path = tmp_path / "concepts.yaml"
    edges_path = tmp_path / "edges.yaml"
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()
    concepts_path.write_text(
        """
concepts:
  - id: Concept:for_loop
    label_en: for loop
    label_zh: for 循环
    source: manual-source
  - id: Concept:while_loop
    label_en: while loop
    label_zh: while 循环
    source: manual-source
""",
        encoding="utf-8",
    )
    edges_path.write_text("edges: []\n", encoding="utf-8")

    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)
    results = catalog.search("while 循环怎么理解？", top_k=2)

    assert results[0].node.node_id == "Concept:while_loop"


def test_reason_between_uses_generated_nodes(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = make_catalog_fixture(tmp_path)

    result = reason_between(
        "Concept:dictionary_get",
        "Concept:key_lookup",
        concepts_path=concepts_path,
        edges_path=edges_path,
        generated_dir=generated_dir,
    )

    assert result["source"] == "Concept:dictionary_get"
    assert result["target"] == "Concept:key_lookup"
    assert result["path"] == ["Concept:dictionary_get", "Concept:key_lookup"]
    assert result["path_edges"][0]["source"] == "kg/generated/candidates.jsonl"
