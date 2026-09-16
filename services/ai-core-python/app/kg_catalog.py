from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
import json
from pathlib import Path
import re
from typing import Iterable

import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONCEPTS_PATH = REPO_ROOT / "kg" / "concepts.yaml"
DEFAULT_EDGES_PATH = REPO_ROOT / "kg" / "edges.yaml"
DEFAULT_GENERATED_DIR = REPO_ROOT / "kg" / "generated"
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "for",
    "how",
    "in",
    "is",
    "of",
    "or",
    "the",
    "to",
    "what",
    "why",
}


@dataclass(frozen=True)
class CatalogNode:
    node_id: str
    label: str
    node_type: str
    category_id: str = ""
    aliases: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()
    source_chunk_ids: tuple[str, ...] = ()
    source_urls: tuple[str, ...] = ()
    evidence_texts: tuple[str, ...] = ()
    confidence: float = 1.0
    origin: str = "manual"


@dataclass(frozen=True)
class CatalogEdge:
    source: str
    predicate: str
    target: str
    weight: float = 1.0
    origin: str = "manual"
    candidate_id: str | None = None
    source_id: str | None = None
    source_chunk_id: str | None = None
    source_url: str | None = None
    source_license_note: str | None = None
    evidence_text: str | None = None
    confidence: float | None = None
    artifact_path: str = "kg/edges.yaml"

    def as_graph_edge(self) -> dict:
        return {
            "from": self.source,
            "type": self.predicate,
            "to": self.target,
            "weight": self.weight,
            "source": self.artifact_path,
            "origin": self.origin,
            "candidate_id": self.candidate_id,
            "source_id": self.source_id,
            "source_chunk_id": self.source_chunk_id,
            "source_url": self.source_url,
            "source_license_note": self.source_license_note,
            "evidence_text": self.evidence_text,
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class CatalogSearchHit:
    node: CatalogNode
    score: float
    matched_text: str
    method: str = "catalog_similarity_fallback"


def load_kg_catalog(
    concepts_path: Path = DEFAULT_CONCEPTS_PATH,
    edges_path: Path = DEFAULT_EDGES_PATH,
    generated_dir: Path = DEFAULT_GENERATED_DIR,
) -> "KGCatalog":
    nodes: dict[str, CatalogNode] = {}
    edges: list[CatalogEdge] = []

    manual_nodes = _load_manual_nodes(concepts_path)
    manual_node_id_counts = Counter(node.node_id for node in manual_nodes)
    duplicate_node_ids = sorted(
        node_id for node_id, count in manual_node_id_counts.items() if count > 1
    )
    for node in manual_nodes:
        nodes[node.node_id] = node

    for edge in _load_manual_edges(edges_path):
        edges.append(edge)
    manual_edge_weights = {_edge_key(edge): edge.weight for edge in edges}

    for path in _candidate_paths(generated_dir):
        origin = "merged" if path.name in {"candidates.jsonl", "llm-candidates.jsonl"} else "generated"
        artifact_path = f"kg/generated/{path.name}"
        for candidate in _read_jsonl(path):
            edge = _edge_from_candidate(candidate, artifact_path=artifact_path, origin=origin)
            if edge is None:
                continue
            nodes[edge.source] = _merge_node(
                nodes.get(edge.source),
                _node_from_candidate(edge.source, candidate, origin=origin),
            )
            nodes[edge.target] = _merge_node(
                nodes.get(edge.target),
                _node_from_candidate(edge.target, candidate, origin=origin),
            )
            if _edge_key(edge) in manual_edge_weights:
                edge = replace(edge, weight=max(edge.weight, manual_edge_weights[_edge_key(edge)] + 1.0))
            edges.append(edge)

    return KGCatalog(nodes=nodes, edges=edges, duplicate_node_ids=duplicate_node_ids)


class KGCatalog:
    def __init__(
        self,
        nodes: dict[str, CatalogNode],
        edges: Iterable[CatalogEdge],
        duplicate_node_ids: Iterable[str] = (),
    ) -> None:
        self.nodes = dict(nodes)
        self.edges = list(edges)
        self.duplicate_node_ids = tuple(sorted(set(duplicate_node_ids)))

    def get_node(self, node_id: str) -> CatalogNode:
        return self.nodes[node_id]

    def source_ids(self) -> set[str]:
        return {
            source_id
            for node in self.nodes.values()
            for source_id in node.source_ids
            if source_id
        }

    def graph_edges(self) -> list[dict]:
        return [edge.as_graph_edge() for edge in self.edges]

    def search(self, query: str, top_k: int = 8, min_score: float = 0.05) -> list[CatalogSearchHit]:
        query_tokens = _tokens(query)
        if not query_tokens:
            return []

        hits: list[CatalogSearchHit] = []
        for node in self.nodes.values():
            matched_text = self._search_document_for(node)
            score = _lexical_score(query, query_tokens, node, matched_text)
            score += self._outgoing_evidence_boost(node.node_id, query_tokens)
            if score >= min_score:
                hits.append(CatalogSearchHit(node=node, score=score, matched_text=matched_text))

        hits.sort(key=lambda hit: (-hit.score, hit.node.node_id))
        return hits[:top_k]

    def _search_document_for(self, node: CatalogNode) -> str:
        edge_texts: list[str] = []
        for edge in self.edges:
            if edge.source == node.node_id or edge.target == node.node_id:
                edge_texts.extend(
                    text
                    for text in [
                        edge.predicate,
                        edge.source_id,
                        edge.source_chunk_id,
                        edge.source_url,
                        edge.evidence_text,
                    ]
                    if text
                )
        return " ".join(
            [
                node.node_id,
                node.label,
                *node.aliases,
                *node.source_ids,
                *node.source_chunk_ids,
                *node.source_urls,
                *node.evidence_texts,
                *edge_texts,
            ]
        )

    def _outgoing_evidence_boost(self, node_id: str, query_tokens: set[str]) -> float:
        for edge in self.edges:
            if edge.source != node_id:
                continue
            edge_tokens = _tokens(" ".join([edge.predicate, edge.evidence_text or ""]))
            if query_tokens & edge_tokens:
                return 0.75
        return 0.0


def _candidate_paths(generated_dir: Path) -> list[Path]:
    paths: list[Path] = []
    curated_path = generated_dir.parent / "curated_candidate_edges.jsonl"
    if curated_path.is_file():
        paths.append(curated_path)
    if generated_dir.is_dir():
        paths.extend(sorted(path for path in generated_dir.glob("*candidates.jsonl") if path.is_file()))
    return paths


def _load_manual_nodes(path: Path) -> list[CatalogNode]:
    if not path.is_file():
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    nodes: list[CatalogNode] = []
    for item in data.get("concepts", []) or []:
        node_id = str(item["id"])
        label_en = str(item.get("label_en") or "")
        label_zh = str(item.get("label_zh") or "")
        label = label_en or label_zh or _label_from_id(node_id)
        aliases = _unique(
            [
                *(str(alias) for alias in item.get("aliases", []) or []),
                label_en,
                label_zh,
            ]
        )
        source = str(item.get("source") or "")
        source_url = str(item.get("source_url") or "")
        evidence_chunk_id = str(item.get("evidence_chunk_id") or "")
        nodes.append(
            CatalogNode(
                node_id=node_id,
                label=label,
                node_type=_node_type_from_id(node_id),
                category_id=str(item.get("category_id") or ""),
                aliases=aliases,
                source_ids=(source,) if source else (),
                source_chunk_ids=(evidence_chunk_id,) if evidence_chunk_id else (),
                source_urls=(source_url,) if source_url else (),
                confidence=1.0,
                origin="curated",
            )
        )
    return nodes


def _load_manual_edges(path: Path) -> list[CatalogEdge]:
    if not path.is_file():
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    edges: list[CatalogEdge] = []
    for item in data.get("edges", []) or []:
        edges.append(
            CatalogEdge(
                source=str(item["from"]),
                predicate=str(item["type"]),
                target=str(item["to"]),
                weight=float(item.get("weight", 1)),
                origin="curated",
                confidence=1.0,
                artifact_path="kg/edges.yaml",
            )
        )
    return edges


def _read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def _edge_from_candidate(candidate: dict, artifact_path: str, origin: str) -> CatalogEdge | None:
    subject = str(candidate.get("subject") or "")
    object_ = str(candidate.get("object") or "")
    if not subject or not object_:
        return None
    confidence = float(candidate.get("confidence", 0) or 0)
    return CatalogEdge(
        source=subject,
        predicate=str(candidate.get("predicate") or "related_to"),
        target=object_,
        weight=max(0.05, round(1 - confidence + 0.1, 4)) if confidence else 1.0,
        origin=origin,
        candidate_id=str(candidate.get("candidate_id") or "") or None,
        source_id=str(candidate.get("source_id") or "") or None,
        source_chunk_id=str(candidate.get("source_chunk_id") or "") or None,
        source_url=str(candidate.get("source_url") or "") or None,
        source_license_note=str(candidate.get("source_license_note") or "") or None,
        evidence_text=str(candidate.get("evidence_text") or "") or None,
        confidence=confidence,
        artifact_path=artifact_path,
    )


def _edge_key(edge: CatalogEdge) -> tuple[str, str, str]:
    return (edge.source, edge.predicate, edge.target)


def _node_from_candidate(node_id: str, candidate: dict, origin: str) -> CatalogNode:
    role = "subject" if candidate.get("subject") == node_id else "object"
    aliases = candidate.get(f"{role}_aliases") or candidate.get("aliases") or []
    label = str(candidate.get(f"{role}_label") or _label_from_id(node_id))
    confidence = float(candidate.get("confidence", 0) or 0)
    return CatalogNode(
        node_id=node_id,
        label=label,
        node_type=_node_type_from_id(node_id),
        aliases=tuple(str(alias) for alias in aliases),
        source_ids=_tuple_if_present(candidate.get("source_id")),
        source_chunk_ids=_tuple_if_present(candidate.get("source_chunk_id")),
        source_urls=_tuple_if_present(candidate.get("source_url")),
        evidence_texts=_tuple_if_present(candidate.get("evidence_text")),
        confidence=confidence,
        origin=origin,
    )


def _merge_node(existing: CatalogNode | None, incoming: CatalogNode) -> CatalogNode:
    if existing is None:
        return incoming
    return CatalogNode(
        node_id=existing.node_id,
        label=existing.label if existing.origin in {"manual", "curated"} else incoming.label or existing.label,
        node_type=existing.node_type,
        category_id=existing.category_id,
        aliases=_unique([*existing.aliases, *incoming.aliases]),
        source_ids=_unique([*existing.source_ids, *incoming.source_ids]),
        source_chunk_ids=_unique([*existing.source_chunk_ids, *incoming.source_chunk_ids]),
        source_urls=_unique([*existing.source_urls, *incoming.source_urls]),
        evidence_texts=_unique([*existing.evidence_texts, *incoming.evidence_texts]),
        confidence=max(existing.confidence, incoming.confidence),
        origin=_merge_origin(existing.origin, incoming.origin),
    )


def _merge_origin(existing: str, incoming: str) -> str:
    order = {"curated": 3, "manual": 3, "generated": 2, "merged": 1}
    return existing if order.get(existing, 0) >= order.get(incoming, 0) else incoming


def _unique(values: Iterable[str]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return tuple(result)


def _tuple_if_present(value: object) -> tuple[str, ...]:
    if value is None or value == "":
        return ()
    return (str(value),)


def _label_from_id(node_id: str) -> str:
    suffix = node_id.split(":", 1)[-1]
    if re.search(r"[a-z]_[a-z]", suffix):
        return suffix.replace("_", " ").replace("-", " ")
    return suffix.replace("-", " ")


def _node_type_from_id(node_id: str) -> str:
    return node_id.split(":", 1)[0] if ":" in node_id else "Concept"


def _tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]+", text.lower().replace(".", "_"))
        if token and token not in STOPWORDS
    }


def _lexical_score(query: str, query_tokens: set[str], node: CatalogNode, document: str) -> float:
    doc_tokens = _tokens(document)
    overlap = query_tokens & doc_tokens
    score = float(len(overlap))
    query_lower = query.lower()
    label_lower = node.label.lower()
    if label_lower and label_lower in query_lower:
        score += 4.0
    for alias in node.aliases:
        if alias.lower() in query_lower:
            score += 3.0
    for token in query_tokens:
        if token and token in label_lower:
            score += 1.5 if len(token) > 3 else 0.0
    if query_lower in document.lower():
        score += 2.0
    return score
