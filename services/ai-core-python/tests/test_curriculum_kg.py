from pathlib import Path
import sys

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.curriculum_kg import (
    DEFAULT_CONCEPTS_PATH,
    _node_records,
    curriculum_path_payload,
    load_curriculum_paths,
    node_match_score,
    validate_curriculum_catalog,
)
from app.kg_catalog import load_kg_catalog


def load_nodes() -> list[dict]:
    return _node_records(DEFAULT_CONCEPTS_PATH)


def node_record(node_id: str) -> dict:
    return next(
        (node for node in load_nodes() if node["id"] == node_id),
        {
            "id": node_id,
            "label_en": node_id.partition(":")[2].replace("_", " "),
            "aliases": [node_id.partition(":")[2]],
        },
    )


def function_node() -> dict:
    return node_record("Concept:function")


def test_curriculum_catalog_has_required_scale_and_provenance() -> None:
    report = validate_curriculum_catalog()

    assert report.node_count >= 83
    assert report.path_count == 160
    assert report.invalid_nodes == []
    assert report.invalid_paths == []


def test_every_curriculum_path_has_three_groups_and_source_evidence() -> None:
    for path in load_curriculum_paths():
        assert path.upstream
        assert path.focus
        assert path.downstream
        assert path.source_url.startswith("https://")
        assert path.evidence_chunk_ids


def test_curriculum_paths_have_no_duplicate_ids_or_three_group_sequences() -> None:
    paths = load_curriculum_paths()
    path_ids = [path.path_id for path in paths]
    sequences = [(path.upstream, path.focus, path.downstream) for path in paths]

    assert len(path_ids) == len(set(path_ids))
    assert len(sequences) == len(set(sequences))


def test_every_curriculum_path_transition_exists_in_the_runtime_graph() -> None:
    catalog = load_kg_catalog()
    directed_pairs = {(edge.source, edge.target) for edge in catalog.edges}

    for path in load_curriculum_paths():
        node_ids = [*path.upstream, *path.focus, *path.downstream]
        for source, target in zip(node_ids, node_ids[1:]):
            assert (source, target) in directed_pairs


def test_runtime_catalog_retains_official_provenance_for_all_curriculum_nodes() -> None:
    catalog = load_kg_catalog()

    for path in load_curriculum_paths():
        for node_id in [*path.upstream, *path.focus, *path.downstream]:
            node = catalog.get_node(node_id)
            assert node.origin == "curated"
            assert "python-official-documentation" in node.source_ids
            assert node.source_chunk_ids
            assert any(url.startswith("https://docs.python.org/") for url in node.source_urls)


@pytest.mark.parametrize(
    "node_id, query",
    [
        ("Concept:function", "function"),
        ("ErrorType:IndexError", "IndexError"),
        ("Misconception:off_by_one", "off by one"),
    ],
)
def test_node_suffix_matches_without_namespace(node_id: str, query: str) -> None:
    assert node_match_score(node_id, node_record(node_id), query, set()) >= 60


@pytest.mark.parametrize("prefix", ["concept", "errortype", "misconception"])
def test_node_type_prefix_never_matches_natural_language(prefix: str) -> None:
    assert all(node_match_score(node["id"], node, prefix, set()) == 0 for node in load_nodes())


def test_arbitrary_future_namespace_is_ignored() -> None:
    node_id = "FutureNamespace:future_topic"
    node = node_record(node_id)

    assert node_match_score(node_id, node, "futurenamespace", set()) == 0
    assert node_match_score(node_id, node, "future topic", set()) >= 60


def test_unicode_alias_is_preserved() -> None:
    assert node_match_score("Concept:function", function_node(), "函数是什么", set()) >= 60


@pytest.mark.parametrize("malformed_hint", ["Concept function", "Concept-function", "Concept_function"])
def test_full_id_hint_requires_exact_namespace_colon(malformed_hint: str) -> None:
    assert node_match_score("Concept:function", function_node(), "", {malformed_hint}) == 0


def test_ordinary_term_hint_keeps_unicode_normalization() -> None:
    assert node_match_score("Concept:function", function_node(), "", {"函数！"}) == 90


def test_zero_score_query_has_no_curriculum_path() -> None:
    assert curriculum_path_payload("weather on mars") is None


def test_validator_reports_duplicate_node_id(tmp_path: Path) -> None:
    concepts_path = tmp_path / "concepts.yaml"
    paths_path = tmp_path / "learning_paths.yaml"
    concepts_path.write_text(
        """
concepts:
  - id: Concept:variable
    label_en: variable
    aliases: [variable]
    source: python-official-tutorial
    source_url: https://docs.python.org/3/tutorial/introduction.html
    evidence_chunk_id: python-docs-test-1
  - id: Concept:variable
    label_en: variable duplicate
    aliases: [variable]
    source: python-official-tutorial
    source_url: https://docs.python.org/3/tutorial/introduction.html
    evidence_chunk_id: python-docs-test-2
""",
        encoding="utf-8",
    )
    paths_path.write_text("paths: []\n", encoding="utf-8")

    report = validate_curriculum_catalog(concepts_path=concepts_path, paths_path=paths_path)

    assert "duplicate node id: Concept:variable" in report.invalid_nodes


def test_validator_reports_duplicate_path_sequence(tmp_path: Path) -> None:
    concepts_path = tmp_path / "concepts.yaml"
    paths_path = tmp_path / "learning_paths.yaml"
    concepts_path.write_text(
        """
concepts:
  - id: Concept:a
    label_en: a
    aliases: [a]
    source: python-official-tutorial
    source_url: https://docs.python.org/3/tutorial/introduction.html
    evidence_chunk_id: python-docs-test-a
  - id: Concept:b
    label_en: b
    aliases: [b]
    source: python-official-tutorial
    source_url: https://docs.python.org/3/tutorial/introduction.html
    evidence_chunk_id: python-docs-test-b
  - id: Concept:c
    label_en: c
    aliases: [c]
    source: python-official-tutorial
    source_url: https://docs.python.org/3/tutorial/introduction.html
    evidence_chunk_id: python-docs-test-c
""",
        encoding="utf-8",
    )
    paths_path.write_text(
        """
paths:
  - id: path-one
    label_en: One
    topic: test
    upstream: [Concept:a]
    focus: [Concept:b]
    downstream: [Concept:c]
    source_id: python-official-tutorial
    source_url: https://docs.python.org/3/tutorial/introduction.html
    evidence_chunk_ids: [python-docs-test-path]
  - id: path-two
    label_en: Two
    topic: test
    upstream: [Concept:a]
    focus: [Concept:b]
    downstream: [Concept:c]
    source_id: python-official-tutorial
    source_url: https://docs.python.org/3/tutorial/introduction.html
    evidence_chunk_ids: [python-docs-test-path]
""",
        encoding="utf-8",
    )

    report = validate_curriculum_catalog(concepts_path=concepts_path, paths_path=paths_path)

    assert "duplicate path sequence: path-two duplicates path-one" in report.invalid_paths
