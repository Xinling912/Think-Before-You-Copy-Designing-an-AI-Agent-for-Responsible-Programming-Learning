import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.kg_catalog import load_kg_catalog
from app.kg_llm_extraction import (
    extract_llm_candidates_from_chunk,
    merge_llm_candidates,
    stable_node_id,
)


class FakeExtractionProvider:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.prompts: list[str] = []

    def chat(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return json.dumps(self.payload)


def chunk_with(text: str, chunk_id: str = "chunk-1", source_id: str = "python-docs-3.14.6") -> dict:
    return {
        "source_id": source_id,
        "chunk_id": chunk_id,
        "source_url": f"https://example.test/{chunk_id}",
        "source_license_note": "test-license",
        "text": text,
    }


def test_llm_extraction_accepts_dictionary_get_relation() -> None:
    text = "dict.get returns a default value when the key is missing; d[key] raises KeyError."
    provider = FakeExtractionProvider(
        {
            "concepts": [
                {"label": "dictionary get", "node_type": "Concept", "aliases": ["dict.get"], "evidence_span": "dict.get returns a default value"},
                {"label": "KeyError", "node_type": "ErrorType", "aliases": [], "evidence_span": "raises KeyError"},
            ],
            "relations": [
                {
                    "subject": "dictionary get",
                    "predicate": "prevents",
                    "object": "KeyError",
                    "evidence_span": "dict.get returns a default value when the key is missing; d[key] raises KeyError.",
                    "confidence": 0.86,
                }
            ],
        }
    )

    candidates = extract_llm_candidates_from_chunk(chunk_with(text), provider)

    assert [(row["subject"], row["predicate"], row["object"]) for row in candidates] == [
        ("Concept:dictionary_get", "prevents", "ErrorType:KeyError")
    ]
    assert candidates[0]["evidence_text"] == text
    assert candidates[0]["source_chunk_id"] == "chunk-1"


def test_llm_extraction_accepts_decorator_relation() -> None:
    text = "A decorator is a function that takes another function and extends its behavior."
    provider = FakeExtractionProvider(
        {
            "concepts": [
                {"label": "decorator", "node_type": "Concept", "aliases": ["@"], "evidence_span": "A decorator is a function"},
                {"label": "function", "node_type": "Concept", "aliases": [], "evidence_span": "takes another function"},
            ],
            "relations": [
                {
                    "subject": "decorator",
                    "predicate": "wraps",
                    "object": "function",
                    "evidence_span": "A decorator is a function that takes another function and extends its behavior.",
                    "confidence": 0.9,
                }
            ],
        }
    )

    candidates = extract_llm_candidates_from_chunk(chunk_with(text, "decorator-chunk"), provider)

    assert candidates[0]["subject"] == "Concept:decorator"
    assert candidates[0]["object"] == "Concept:function"
    assert candidates[0]["predicate"] == "wraps"


def test_llm_extraction_rejects_relation_without_evidence_span() -> None:
    provider = FakeExtractionProvider(
        {
            "concepts": [
                {"label": "file read", "node_type": "Concept", "evidence_span": "with open"},
                {"label": "context manager", "node_type": "Concept", "evidence_span": "with open"},
            ],
            "relations": [
                {
                    "subject": "file read",
                    "predicate": "uses",
                    "object": "context manager",
                    "confidence": 0.9,
                }
            ],
        }
    )

    candidates = extract_llm_candidates_from_chunk(
        chunk_with("Use with open(path) as f to ensure files are closed."),
        provider,
    )

    assert candidates == []


def test_llm_extraction_generates_stable_node_ids() -> None:
    assert stable_node_id("dictionary get", "Concept") == "Concept:dictionary_get"
    assert stable_node_id("floating-point representation error", "Concept") == "Concept:floating_point_representation_error"
    assert stable_node_id("KeyError", "ErrorType") == "ErrorType:KeyError"
    assert stable_node_id("missing key?", "Misconception") == "Misconception:missing_key"


def test_llm_extraction_merges_duplicate_nodes_across_sources() -> None:
    first = {
        "candidate_id": "a",
        "source_id": "python-docs-3.14.6",
        "source_chunk_id": "chunk-a",
        "source_url": "https://example.test/a",
        "source_license_note": "test-license",
        "subject": "Concept:dictionary_get",
        "predicate": "prevents",
        "object": "ErrorType:KeyError",
        "confidence": 0.8,
        "evidence_text": "dict.get can return a default.",
        "status": "llm_extracted",
        "created_at": "2026-07-08T00:00:00Z",
    }
    duplicate = {**first, "candidate_id": "b", "source_id": "think-python-2e"}

    merged = merge_llm_candidates([first, duplicate])

    assert len(merged) == 2
    assert {row["source_id"] for row in merged} == {"python-docs-3.14.6", "think-python-2e"}


def test_catalog_loads_llm_candidates_and_rule_candidates(tmp_path: Path) -> None:
    concepts_path = tmp_path / "concepts.yaml"
    edges_path = tmp_path / "edges.yaml"
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()
    concepts_path.write_text("concepts: []\n", encoding="utf-8")
    edges_path.write_text("edges: []\n", encoding="utf-8")

    rule_candidate = {
        "candidate_id": "rule-file",
        "source_id": "python-docs-3.14.6",
        "source_chunk_id": "rule-file-chunk",
        "source_url": "https://example.test/file",
        "subject": "Concept:file_read",
        "predicate": "uses",
        "object": "Concept:with_open",
        "confidence": 0.81,
        "evidence_text": "with open reads files and closes them.",
    }
    llm_candidates = [
        {
            "candidate_id": "llm-class",
            "source_id": "think-python-2e",
            "source_chunk_id": "class-chunk",
            "source_url": "https://example.test/class",
            "subject": "Concept:class",
            "predicate": "creates",
            "object": "Concept:object",
            "confidence": 0.91,
            "evidence_text": "A class defines the form of an object.",
        },
        {
            "candidate_id": "llm-function",
            "source_id": "py4e-html3",
            "source_chunk_id": "function-chunk",
            "source_url": "https://example.test/function",
            "subject": "Concept:function",
            "predicate": "accepts",
            "object": "Concept:parameter",
            "confidence": 0.88,
            "evidence_text": "A function can accept parameters.",
        },
        {
            "candidate_id": "llm-float",
            "source_id": "python-docs-3.14.6",
            "source_chunk_id": "float-chunk",
            "source_url": "https://example.test/float",
            "subject": "Concept:floating_point",
            "predicate": "can_have",
            "object": "Concept:representation_error",
            "confidence": 0.9,
            "evidence_text": "Floating point numbers have representation error.",
        },
    ]
    (generated_dir / "python-docs-3.14.6-candidates.jsonl").write_text(json.dumps(rule_candidate) + "\n", encoding="utf-8")
    (generated_dir / "think-python-2e-llm-candidates.jsonl").write_text(
        "\n".join(json.dumps(row) for row in llm_candidates) + "\n",
        encoding="utf-8",
    )

    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)

    for node_id in [
        "Concept:file_read",
        "Concept:with_open",
        "Concept:class",
        "Concept:object",
        "Concept:function",
        "Concept:parameter",
        "Concept:floating_point",
        "Concept:representation_error",
    ]:
        assert catalog.get_node(node_id).source_chunk_ids

    assert catalog.search("floating point representation", top_k=1)[0].node.node_id == "Concept:floating_point"
