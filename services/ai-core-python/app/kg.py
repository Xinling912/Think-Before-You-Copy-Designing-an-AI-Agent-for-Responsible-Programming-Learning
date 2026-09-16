from dataclasses import dataclass
from heapq import heappop, heappush
import json
from pathlib import Path
import re
from typing import Iterable

import yaml

from app.kg_catalog import DEFAULT_GENERATED_DIR, KGCatalog, load_kg_catalog
from app.curriculum_kg import load_curriculum_paths_for_diagnostics
from app.kg_visualization import (
    aggregate_visual_edges,
    build_graph_integrity,
    graph_version,
    load_categories,
    unique_relations,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
CONCEPTS_PATH = REPO_ROOT / "kg" / "concepts.yaml"
EDGES_PATH = REPO_ROOT / "kg" / "edges.yaml"
MIN_GENERATED_EDGE_CONFIDENCE = 0.75


@dataclass(frozen=True)
class GraphStep:
    next_node: str
    weight: float
    edge: dict
    traversal: str


def load_concepts() -> dict[str, dict]:
    data = yaml.safe_load(CONCEPTS_PATH.read_text(encoding="utf-8"))
    return {item["id"]: item for item in data["concepts"]}


def load_edges() -> list[dict]:
    return load_kg_catalog().graph_edges()


def load_generated_candidate_edges(path: Path | None = None) -> list[dict]:
    paths = [path] if path is not None else sorted(DEFAULT_GENERATED_DIR.glob("*candidates.jsonl"))
    edges: list[dict] = []
    for candidate_path in paths:
        if candidate_path is None or not candidate_path.is_file():
            continue
        edges.extend(_read_candidate_edges(candidate_path))
    return edges


def _read_candidate_edges(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    edges: list[dict] = []
    artifact_path = path.relative_to(REPO_ROOT).as_posix() if path.is_relative_to(REPO_ROOT) else path.as_posix()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        candidate = json.loads(line)
        confidence = float(candidate.get("confidence", 0))
        source = candidate.get("subject")
        target = candidate.get("object")
        if confidence < MIN_GENERATED_EDGE_CONFIDENCE:
            continue
        edges.append(
            {
                "from": source,
                "type": candidate.get("predicate", "related_to"),
                "to": target,
                "weight": max(0.05, round(1 - confidence + 0.1, 4)),
                "source": artifact_path,
                "candidate_id": candidate.get("candidate_id"),
                "source_id": candidate.get("source_id"),
                "source_chunk_id": candidate.get("source_chunk_id"),
                "source_url": candidate.get("source_url"),
                "source_license_note": candidate.get("source_license_note"),
                "evidence_text": candidate.get("evidence_text"),
                "confidence": confidence,
            },
        )
    return edges


def build_adjacency(edges: list[dict]) -> dict[str, list[GraphStep]]:
    adjacency: dict[str, list[GraphStep]] = {}
    for edge in edges:
        weight = float(edge.get("weight", 1))
        if edge.get("origin") in {"generated", "merged"}:
            weight += 3.0
        source = edge["from"]
        target = edge["to"]
        adjacency.setdefault(source, []).append(
            GraphStep(next_node=target, weight=weight, edge=edge, traversal="forward"),
        )
        adjacency.setdefault(target, []).append(
            GraphStep(next_node=source, weight=weight, edge=edge, traversal="reverse"),
        )
    return adjacency


def normalize_target(value: str) -> str:
    if ":" in value:
        return value
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*Error", value):
        return f"ErrorType:{value}"
    slug = re.sub(r"[^a-z0-9_\u4e00-\u9fff]+", "_", value.strip().lower()).strip("_")
    return f"Concept:{slug}" if slug else value


def shortest_learning_path(
    source: str,
    target: str,
    catalog: KGCatalog | None = None,
) -> tuple[list[str], list[dict]]:
    catalog = catalog or load_kg_catalog()
    concepts = catalog.nodes
    edges = catalog.graph_edges()
    source = normalize_target(source)
    target = normalize_target(target)

    missing = [node for node in [source, target] if node not in concepts]
    if missing:
        raise ValueError(f"Missing KG nodes: {', '.join(missing)}")

    adjacency = build_adjacency(edges)
    queue: list[tuple[float, int, str, list[str], list[dict]]] = []
    heappush(queue, (0, 0, source, [source], []))
    best_cost: dict[str, float] = {source: 0}
    counter = 0

    while queue:
        cost, _, node, path, path_edges = heappop(queue)
        if node == target:
            return path, path_edges
        if cost > best_cost.get(node, float("inf")):
            continue
        for step in adjacency.get(node, []):
            next_cost = cost + step.weight
            if next_cost >= best_cost.get(step.next_node, float("inf")):
                continue
            best_cost[step.next_node] = next_cost
            counter += 1
            edge_payload = {
                "from": step.edge["from"],
                "to": step.edge["to"],
                "type": step.edge["type"],
                "weight": step.weight,
                "traversal": step.traversal,
                "source": step.edge.get("source", "kg/edges.yaml"),
                "candidate_id": step.edge.get("candidate_id"),
                "source_id": step.edge.get("source_id"),
                "source_chunk_id": step.edge.get("source_chunk_id"),
                "source_url": step.edge.get("source_url"),
                "evidence_text": step.edge.get("evidence_text"),
                "confidence": step.edge.get("confidence"),
            }
            heappush(
                queue,
                (
                    next_cost,
                    counter,
                    step.next_node,
                    [*path, step.next_node],
                    [*path_edges, edge_payload],
                ),
            )

    return [], []


def reason_between(
    source: str,
    target: str,
    *,
    concepts_path: Path = CONCEPTS_PATH,
    edges_path: Path = EDGES_PATH,
    generated_dir: Path = DEFAULT_GENERATED_DIR,
) -> dict:
    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)
    normalized_source = normalize_target(source)
    normalized_target = normalize_target(target)
    path, path_edges = shortest_learning_path(normalized_source, normalized_target, catalog=catalog)

    return {
        "target": target,
        "normalized_target": normalized_target,
        "source": normalized_source,
        "normalized_source": normalized_source,
        "algorithm": "weighted-multi-hop-graph-search",
        "path": path,
        "path_edges": path_edges,
        "explanation": "The path is computed from kg/concepts.yaml, kg/edges.yaml, and all kg/generated/*candidates.jsonl evidence edges using weighted multi-hop graph search over teaching relationships.",
    }


def reason_about_target(target: str, source: str | None = None) -> dict:
    return reason_between(source or target, target)


OVERVIEW_PATHS = [
    ["Concept:list", "Concept:index", "Concept:zero_based_index", "Concept:valid_index_range", "ErrorType:IndexError"],
    ["Concept:len", "Concept:valid_index_range", "Concept:index", "ErrorType:IndexError"],
    ["Misconception:index_starts_at_one", "ErrorType:IndexError", "Concept:index"],
    ["Concept:slice", "Concept:index", "Concept:list"],
    ["Concept:range", "Concept:for_loop", "Concept:list"],
    ["Concept:enumerate", "Concept:for_loop", "Concept:list"],
    ["Concept:list", "Concept:type", "Concept:object"],
    ["Concept:while_loop", "Concept:if_statement", "Concept:match_statement", "Concept:case_pattern"],
    ["Misconception:assignment_vs_equality", "Concept:variable"],
]


def build_kg_overview() -> dict:
    catalog = load_kg_catalog()
    categories = load_categories()
    relations = unique_relations(catalog)
    visual_edges = aggregate_visual_edges(relations)
    curriculum_paths = load_curriculum_paths_for_diagnostics()
    integrity = build_graph_integrity(catalog, categories, relations, curriculum_paths)

    in_degree: dict[str, int] = {node_id: 0 for node_id in catalog.nodes}
    out_degree: dict[str, int] = {node_id: 0 for node_id in catalog.nodes}
    for relation in relations:
        if relation["source"] in out_degree:
            out_degree[relation["source"]] += 1
        if relation["target"] in in_degree:
            in_degree[relation["target"]] += 1

    node_path_ids: dict[str, list[str]] = {node_id: [] for node_id in catalog.nodes}
    for path in curriculum_paths:
        for node_id in {*path.upstream, *path.focus, *path.downstream}:
            if node_id in node_path_ids:
                node_path_ids[node_id].append(path.path_id)

    nodes = [
        {
            "node_id": node.node_id,
            "label": node.label,
            "node_type": node.node_type,
            "origin": node.origin,
            "aliases": list(node.aliases[:6]),
            "source_ids": list(node.source_ids[:4]),
            "source_chunk_ids": list(node.source_chunk_ids[:3]),
            "source_urls": list(node.source_urls[:2]),
            "evidence_summary": _first_nonempty(node.evidence_texts),
            "confidence": node.confidence,
            "category_id": node.category_id,
            "unique_in_degree": in_degree[node.node_id],
            "unique_out_degree": out_degree[node.node_id],
            "unique_relation_degree": in_degree[node.node_id] + out_degree[node.node_id],
            "path_ids": sorted(node_path_ids[node.node_id]),
        }
        for node in sorted(
            catalog.nodes.values(),
            key=lambda node: (
                -(in_degree[node.node_id] + out_degree[node.node_id]),
                node.node_type,
                node.node_id,
            ),
        )
    ]

    paths = [_curriculum_overview_path_record(path, catalog) for path in curriculum_paths]
    category_records = _category_overview_records(categories, catalog, relations)
    counts = {
        "nodes": len(nodes),
        "categories": len(category_records),
        "curated_relation_triples": sum("curated" in relation["origins"] for relation in relations),
        "unique_relation_triples": len(relations),
        "visual_directed_pairs": len(visual_edges),
        "internal_relation_triples": sum(not relation["is_cross_category"] for relation in relations),
        "cross_category_relation_triples": sum(relation["is_cross_category"] for relation in relations),
        "paths": len(paths),
        "raw_edge_records": len(catalog.edges),
    }

    return {
        "version": graph_version(catalog, relations),
        "counts": counts,
        "integrity": integrity,
        "categories": category_records,
        "nodes": nodes,
        "relations": relations,
        "visual_edges": visual_edges,
        "paths": paths,
    }


def _category_overview_records(categories, catalog: KGCatalog, relations: list[dict]) -> list[dict]:
    node_counts = {category.category_id: 0 for category in categories}
    internal_counts = {category.category_id: 0 for category in categories}
    outgoing_counts = {category.category_id: 0 for category in categories}
    incoming_counts = {category.category_id: 0 for category in categories}

    for node in catalog.nodes.values():
        if node.category_id in node_counts:
            node_counts[node.category_id] += 1
    for relation in relations:
        source_category_id = relation["source_category_id"]
        target_category_id = relation["target_category_id"]
        if source_category_id == target_category_id:
            if source_category_id in internal_counts:
                internal_counts[source_category_id] += 1
        else:
            if source_category_id in outgoing_counts:
                outgoing_counts[source_category_id] += 1
            if target_category_id in incoming_counts:
                incoming_counts[target_category_id] += 1

    return [
        {
            "id": category.category_id,
            "label_zh": category.label_zh,
            "label_en": category.label_en,
            "description_zh": category.description_zh,
            "description_en": category.description_en,
            "color": category.color,
            "surface_color": category.surface_color,
            "anchor": {"x": category.anchor_x, "y": category.anchor_y},
            "order": category.order,
            "node_count": node_counts[category.category_id],
            "internal_relation_count": internal_counts[category.category_id],
            "outgoing_relation_count": outgoing_counts[category.category_id],
            "incoming_relation_count": incoming_counts[category.category_id],
        }
        for category in categories
    ]


def _curriculum_overview_path_record(path, catalog: KGCatalog) -> dict:
    node_ids = [*path.upstream, *path.focus, *path.downstream]
    category_ids = _unique_strings(
        catalog.nodes[node_id].category_id
        for node_id in node_ids
        if node_id in catalog.nodes and catalog.nodes[node_id].category_id
    )
    relations = [
        {
            "from": source,
            "to": target,
            "type": "requires" if target in path.focus else "extends_to" if source in path.focus else "related_to",
            "traversal": "forward",
        }
        for source, target in zip(node_ids, node_ids[1:])
    ]
    return {
        "path_id": path.path_id,
        "label": path.label,
        "topic": path.topic,
        "path": node_ids,
        "upstream": list(path.upstream),
        "focus": list(path.focus),
        "downstream": list(path.downstream),
        "category_ids": category_ids,
        "crosses_category_boundary": len(category_ids) > 1,
        "focus_node_ids": list(path.focus),
        "hop_count": len(node_ids) - 1,
        "relations": relations,
        "evidence_summary": "",
        "source_url": path.source_url,
        "source_urls": [path.source_url],
        "source_id": path.source_id,
        "evidence_chunk_ids": list(path.evidence_chunk_ids),
    }


def _overview_path_record(path: list[str], catalog: KGCatalog, index: int) -> dict | None:
    if any(node_id not in catalog.nodes for node_id in path):
        return None
    relations: list[dict] = []
    evidence_texts: list[str] = []
    source_urls: list[str] = []
    for source, target in zip(path, path[1:]):
        edge = _find_edge_between(catalog, source, target)
        relation = {
            "from": source,
            "to": target,
            "type": edge.get("type", "related_to") if edge else "related_to",
            "traversal": edge.get("traversal", "inferred") if edge else "inferred",
        }
        if edge:
            for key in ["evidence_text", "source_url"]:
                value = edge.get(key)
                if value and key == "evidence_text":
                    evidence_texts.append(str(value))
                if value and key == "source_url":
                    source_urls.append(str(value))
        relations.append(relation)
    return {
        "path_id": f"kg-path-{index:02d}",
        "path": path,
        "hop_count": len(path) - 1,
        "relations": relations,
        "evidence_summary": _first_nonempty(evidence_texts),
        "source_urls": _unique_strings(source_urls)[:2],
    }


def _find_edge_between(catalog: KGCatalog, source: str, target: str) -> dict | None:
    for edge in catalog.graph_edges():
        if edge.get("from") == source and edge.get("to") == target:
            edge["traversal"] = "forward"
            return edge
        if edge.get("from") == target and edge.get("to") == source:
            edge["traversal"] = "reverse"
            return edge
    return None


def _first_nonempty(values: Iterable[str]) -> str:
    for value in values:
        cleaned = str(value).strip()
        if cleaned:
            return cleaned
    return ""


def _unique_strings(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
