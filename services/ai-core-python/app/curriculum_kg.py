from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONCEPTS_PATH = REPO_ROOT / "kg" / "concepts.yaml"
DEFAULT_PATHS_PATH = REPO_ROOT / "kg" / "learning_paths.yaml"


@dataclass(frozen=True)
class CurriculumPath:
    path_id: str
    label: str
    topic: str
    upstream: tuple[str, ...]
    focus: tuple[str, ...]
    downstream: tuple[str, ...]
    source_id: str
    source_url: str
    evidence_chunk_ids: tuple[str, ...]


@dataclass(frozen=True)
class CatalogValidationReport:
    node_count: int
    path_count: int
    invalid_nodes: list[str]
    invalid_paths: list[str]


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _node_records(concepts_path: Path) -> list[dict[str, Any]]:
    return list(_read_yaml(concepts_path).get("concepts", []) or [])


def _path_records(paths_path: Path) -> list[dict[str, Any]]:
    return list(_read_yaml(paths_path).get("paths", []) or [])


def _required_text(record: dict[str, Any], field: str) -> str:
    value = record.get(field)
    return str(value).strip() if value is not None else ""


def validate_curriculum_catalog(
    *,
    concepts_path: Path = DEFAULT_CONCEPTS_PATH,
    paths_path: Path = DEFAULT_PATHS_PATH,
) -> CatalogValidationReport:
    nodes = _node_records(concepts_path)
    paths = _path_records(paths_path)
    invalid_nodes: list[str] = []
    invalid_paths: list[str] = []
    node_ids: set[str] = set()

    for node in nodes:
        node_id = _required_text(node, "id")
        if not node_id:
            invalid_nodes.append("missing node id")
            continue
        if node_id in node_ids:
            invalid_nodes.append(f"duplicate node id: {node_id}")
        node_ids.add(node_id)
        for field in ("label_en", "source", "source_url", "evidence_chunk_id"):
            if not _required_text(node, field):
                invalid_nodes.append(f"{node_id}: missing {field}")
        aliases = node.get("aliases", [])
        if not isinstance(aliases, list) or not any(str(alias).strip() for alias in aliases):
            invalid_nodes.append(f"{node_id}: missing aliases")

    path_ids: dict[str, str] = {}
    sequences: dict[tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]], str] = {}
    for path in paths:
        path_id = _required_text(path, "id")
        if not path_id:
            invalid_paths.append("missing path id")
            continue
        if path_id in path_ids:
            invalid_paths.append(f"duplicate path id: {path_id}")
        path_ids[path_id] = path_id
        for field in ("label_en", "topic", "source_id", "source_url"):
            if not _required_text(path, field):
                invalid_paths.append(f"{path_id}: missing {field}")

        groups: list[tuple[str, ...]] = []
        for field in ("upstream", "focus", "downstream"):
            raw_group = path.get(field, [])
            group = tuple(str(item).strip() for item in raw_group if str(item).strip()) if isinstance(raw_group, list) else ()
            groups.append(group)
            if not group:
                invalid_paths.append(f"{path_id}: empty {field}")
            for node_id in group:
                if node_id not in node_ids:
                    invalid_paths.append(f"{path_id}: unknown node {node_id}")

        evidence = path.get("evidence_chunk_ids", [])
        if not isinstance(evidence, list) or not any(str(item).strip() for item in evidence):
            invalid_paths.append(f"{path_id}: missing evidence_chunk_ids")

        sequence = (groups[0], groups[1], groups[2])
        if all(groups):
            previous_path_id = sequences.get(sequence)
            if previous_path_id:
                invalid_paths.append(f"duplicate path sequence: {path_id} duplicates {previous_path_id}")
            else:
                sequences[sequence] = path_id

    if paths and len(paths) != 160 and concepts_path == DEFAULT_CONCEPTS_PATH and paths_path == DEFAULT_PATHS_PATH:
        invalid_paths.append(f"expected 160 paths, found {len(paths)}")

    return CatalogValidationReport(
        node_count=len(nodes),
        path_count=len(paths),
        invalid_nodes=invalid_nodes,
        invalid_paths=invalid_paths,
    )


def load_curriculum_paths(
    *,
    concepts_path: Path = DEFAULT_CONCEPTS_PATH,
    paths_path: Path = DEFAULT_PATHS_PATH,
) -> list[CurriculumPath]:
    report = validate_curriculum_catalog(concepts_path=concepts_path, paths_path=paths_path)
    if report.invalid_nodes or report.invalid_paths:
        errors = "; ".join([*report.invalid_nodes, *report.invalid_paths])
        raise ValueError(f"Invalid curriculum KG catalog: {errors}")

    return _parse_curriculum_paths(paths_path)


def load_curriculum_paths_for_diagnostics(
    *,
    paths_path: Path = DEFAULT_PATHS_PATH,
) -> list[CurriculumPath]:
    """Parse path records without rejecting invalid catalog references.

    This loader is only for integrity reporting. Normal curriculum consumers
    must use ``load_curriculum_paths``, which retains strict catalog validation.
    """
    return _parse_curriculum_paths(paths_path)


def _parse_curriculum_paths(paths_path: Path) -> list[CurriculumPath]:
    return [
        CurriculumPath(
            path_id=str(path["id"]),
            label=str(path["label_en"]),
            topic=str(path["topic"]),
            upstream=tuple(path["upstream"]),
            focus=tuple(path["focus"]),
            downstream=tuple(path["downstream"]),
            source_id=str(path["source_id"]),
            source_url=str(path["source_url"]),
            evidence_chunk_ids=tuple(path["evidence_chunk_ids"]),
        )
        for path in _path_records(paths_path)
    ]


def find_curriculum_paths(
    query: str,
    concept_hints: list[str] | None = None,
    *,
    concepts_path: Path = DEFAULT_CONCEPTS_PATH,
    paths_path: Path = DEFAULT_PATHS_PATH,
) -> list[CurriculumPath]:
    paths = load_curriculum_paths(concepts_path=concepts_path, paths_path=paths_path)
    nodes = {str(node["id"]): node for node in _node_records(concepts_path)}
    hints = {hint for hint in concept_hints or [] if hint}

    def score(path: CurriculumPath) -> tuple[int, int]:
        focus_score = sum(node_match_score(node_id, nodes.get(node_id, {}), query, hints) for node_id in path.focus)
        all_score = sum(
            node_match_score(node_id, nodes.get(node_id, {}), query, hints)
            for node_id in (*path.upstream, *path.focus, *path.downstream)
        )
        return focus_score, all_score

    scored_paths = [(path, *score(path)) for path in paths]
    ranked_paths = sorted(scored_paths, key=lambda item: (-item[1], -item[2], item[0].path_id))
    if not ranked_paths or (ranked_paths[0][1] == 0 and ranked_paths[0][2] == 0):
        return []
    return [path for path, _, _ in ranked_paths]


def curriculum_path_payload(
    query: str,
    concept_hints: list[str] | None = None,
) -> dict[str, Any] | None:
    paths = find_curriculum_paths(query, concept_hints)
    if not paths:
        return None
    selected = paths[0]
    return {
        "path_id": selected.path_id,
        "path_label": selected.label,
        "topic": selected.topic,
        "upstream": list(selected.upstream),
        "focus": list(selected.focus),
        "downstream": list(selected.downstream),
        "source_id": selected.source_id,
        "source_url": selected.source_url,
        "evidence_chunk_ids": list(selected.evidence_chunk_ids),
    }


def normalize_search_text(value: str) -> str:
    normalized_characters = (character.lower() if character.isalnum() else " " for character in str(value))
    return " ".join("".join(normalized_characters).split())


def searchable_node_terms(node_id: str, node: dict[str, Any]) -> set[str]:
    _, separator, suffix = node_id.partition(":")
    node_suffix = suffix if separator else node_id
    candidates = [node_suffix, str(node.get("label_en") or ""), *(node.get("aliases") or [])]
    return {normalized for candidate in candidates if (normalized := normalize_search_text(candidate))}


def node_match_score(node_id: str, node: dict[str, Any], query: str, hints: set[str]) -> int:
    normalized_query = normalize_search_text(query)
    normalized_hints = {normalize_search_text(hint) for hint in hints if hint}
    terms = searchable_node_terms(node_id, node)

    if node_id in hints:
        return 100
    if terms & normalized_hints:
        return 90
    if not normalized_query:
        return 0
    if normalized_query in terms:
        return 80

    padded_query = f" {normalized_query} "
    for term in terms:
        has_unicode_substring = any(not character.isascii() for character in term) and term in normalized_query
        if f" {term} " in padded_query or has_unicode_substring:
            return 70

    namespace, separator, _ = node_id.partition(":")
    namespace_tokens = set(normalize_search_text(namespace).split()) if separator else set()
    query_tokens = set(normalized_query.split())
    if any((set(term.split()) - namespace_tokens) & query_tokens for term in terms):
        return 60
    return 0


def _normalize_search_text(value: str) -> str:
    return normalize_search_text(value)


def _node_matches(node_id: str, node: dict[str, Any], query: str, hints: set[str]) -> int:
    return node_match_score(node_id, node, query, hints)
