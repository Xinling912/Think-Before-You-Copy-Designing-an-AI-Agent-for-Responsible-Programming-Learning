from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Iterable

import yaml

from app.curriculum_kg import CurriculumPath
from app.kg_catalog import KGCatalog


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CATEGORIES_PATH = REPO_ROOT / "kg" / "categories.yaml"


@dataclass(frozen=True)
class KGCategory:
    category_id: str
    label_zh: str
    label_en: str
    description_zh: str
    description_en: str
    color: str
    surface_color: str
    anchor_x: float
    anchor_y: float
    order: int


def load_categories(path: Path = DEFAULT_CATEGORIES_PATH) -> tuple[KGCategory, ...]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    categories = tuple(
        KGCategory(
            category_id=str(item["id"]),
            label_zh=str(item["label_zh"]),
            label_en=str(item["label_en"]),
            description_zh=str(item["description_zh"]),
            description_en=str(item["description_en"]),
            color=str(item["color"]),
            surface_color=str(item["surface_color"]),
            anchor_x=float(item["anchor_x"]),
            anchor_y=float(item["anchor_y"]),
            order=int(item["order"]),
        )
        for item in data.get("categories", [])
    )
    return tuple(sorted(categories, key=lambda category: category.order))


def unique_relations(catalog: KGCatalog) -> list[dict]:
    grouped: dict[tuple[str, str, str], dict[str, set[str]]] = {}
    for edge in catalog.edges:
        key = (edge.source, edge.predicate, edge.target)
        provenance = grouped.setdefault(
            key,
            {
                "origins": set(),
                "source_ids": set(),
                "source_chunk_ids": set(),
                "source_urls": set(),
                "evidence_texts": set(),
            },
        )
        _add_nonempty(provenance["origins"], edge.origin)
        _add_nonempty(provenance["source_ids"], edge.source_id)
        _add_nonempty(provenance["source_chunk_ids"], edge.source_chunk_id)
        _add_nonempty(provenance["source_urls"], edge.source_url)
        _add_nonempty(provenance["evidence_texts"], edge.evidence_text)

    relations: list[dict] = []
    for source, predicate, target in sorted(grouped):
        source_category_id = _node_category_id(catalog, source)
        target_category_id = _node_category_id(catalog, target)
        provenance = grouped[(source, predicate, target)]
        relations.append(
            {
                "key": f"{source}|{predicate}|{target}",
                "source": source,
                "type": predicate,
                "target": target,
                "source_category_id": source_category_id,
                "target_category_id": target_category_id,
                "is_cross_category": source_category_id != target_category_id,
                "origins": sorted(provenance["origins"]),
                "source_ids": sorted(provenance["source_ids"]),
                "source_chunk_ids": sorted(provenance["source_chunk_ids"]),
                "source_urls": sorted(provenance["source_urls"]),
                "evidence_texts": sorted(provenance["evidence_texts"]),
            }
        )
    return relations


def aggregate_visual_edges(relations: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for relation in relations:
        grouped.setdefault((relation["source"], relation["target"]), []).append(relation)

    visual_edges: list[dict] = []
    for source, target in sorted(grouped):
        pair_relations = grouped[(source, target)]
        source_category_id = str(pair_relations[0].get("source_category_id") or "")
        target_category_id = str(pair_relations[0].get("target_category_id") or "")
        provenance = {
            field: _sorted_union(pair_relations, field)
            for field in ("origins", "source_ids", "source_chunk_ids", "source_urls", "evidence_texts")
        }
        visual_edges.append(
            {
                "key": f"{source}|{target}",
                "source": source,
                "target": target,
                "source_category_id": source_category_id,
                "target_category_id": target_category_id,
                "is_cross_category": source_category_id != target_category_id,
                "relation_types": sorted({str(relation["type"]) for relation in pair_relations}),
                "relation_count": len(pair_relations),
                "provenance_count": _provenance_count(provenance),
                **provenance,
            }
        )
    return visual_edges


def build_graph_integrity(
    catalog: KGCatalog,
    categories: Iterable[KGCategory],
    relations: list[dict],
    paths: Iterable[CurriculumPath],
) -> dict:
    category_ids = {category.category_id for category in categories}
    uncategorized_node_ids = sorted(
        node.node_id
        for node in catalog.nodes.values()
        if not node.category_id or node.category_id not in category_ids
    )

    node_id_counts = Counter(node.node_id for node in catalog.nodes.values())
    duplicate_node_ids = sorted(
        {
            *catalog.duplicate_node_ids,
            *(node_id for node_id, count in node_id_counts.items() if count > 1),
        }
    )
    known_node_ids = set(catalog.nodes)
    dangling_relation_keys = sorted(
        str(relation["key"])
        for relation in relations
        if relation.get("source") not in known_node_ids or relation.get("target") not in known_node_ids
    )

    relation_key_counts = Counter(str(relation["key"]) for relation in relations)
    duplicate_relation_keys = sorted(key for key, count in relation_key_counts.items() if count > 1)

    path_id_counts: Counter[str] = Counter()
    invalid_path_ids: set[str] = set()
    for path in paths:
        path_id_counts[path.path_id] += 1
        node_ids = (*path.upstream, *path.focus, *path.downstream)
        if any(node_id not in known_node_ids for node_id in node_ids):
            invalid_path_ids.add(path.path_id)
    invalid_path_ids.update(path_id for path_id, count in path_id_counts.items() if count > 1)

    errors = {
        "uncategorized_node_ids": uncategorized_node_ids,
        "duplicate_node_ids": duplicate_node_ids,
        "dangling_relation_keys": dangling_relation_keys,
        "duplicate_relation_keys": duplicate_relation_keys,
        "invalid_path_ids": sorted(invalid_path_ids),
    }
    return {"valid": not any(errors.values()), **errors}


def graph_version(catalog: KGCatalog, relations: list[dict]) -> str:
    payload = "\n".join(
        [
            *sorted(catalog.nodes),
            "--relations--",
            *(str(relation["key"]) for relation in relations),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _node_category_id(catalog: KGCatalog, node_id: str) -> str:
    node = catalog.nodes.get(node_id)
    return node.category_id if node is not None else ""


def _add_nonempty(values: set[str], value: object) -> None:
    cleaned = str(value).strip() if value is not None else ""
    if cleaned:
        values.add(cleaned)


def _sorted_union(records: Iterable[dict], field: str) -> list[str]:
    return sorted(
        {
            str(value)
            for record in records
            for value in record.get(field, [])
            if value is not None and str(value).strip()
        }
    )


def _provenance_count(provenance: dict[str, list[str]]) -> int:
    for field in ("source_chunk_ids", "source_ids", "source_urls", "origins"):
        if provenance[field]:
            return len(provenance[field])
    return 0
