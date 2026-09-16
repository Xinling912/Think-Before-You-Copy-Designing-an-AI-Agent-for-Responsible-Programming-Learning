"""Catalog-guided candidate extraction for Python learning KG edges."""

from __future__ import annotations

import hashlib
import itertools
import json
from pathlib import Path
import re
from functools import lru_cache
from typing import Any, Iterable

from app.kg_catalog import CatalogEdge, CatalogNode, CatalogSearchHit, load_kg_catalog
from app.kg_llm_extraction import extract_llm_candidates_from_chunk, merge_llm_candidates


REPO_ROOT = Path(__file__).resolve().parents[3]
CHUNKS_PATH = REPO_ROOT / "data" / "processed" / "python-docs-3.14.6" / "chunks.jsonl"
CANDIDATES_PATH = REPO_ROOT / "kg" / "generated" / "candidates.jsonl"
DETERMINISTIC_CREATED_AT = "2026-07-03T00:00:00Z"
MAX_EVIDENCE_LENGTH = 320
MAX_NODE_HITS_PER_CHUNK = 12
MIN_NODE_HIT_SCORE = 0.08

REQUIRED_FIELD_ORDER = (
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
)
REQUIRED_FIELDS = set(REQUIRED_FIELD_ORDER)


def candidate_id_for(chunk_id: str, subject: str, predicate: str, object_: str) -> str:
    raw = "\x1f".join([chunk_id, subject, predicate, object_])
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"kgcand_{digest}"


def load_chunks(path: Path = CHUNKS_PATH) -> list[dict]:
    chunks: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            chunks.append(json.loads(line))
    return chunks


def extract_candidates_from_chunk(chunk: dict) -> list[dict]:
    text = str(chunk.get("text") or "")
    if not text.strip():
        return []

    catalog = extraction_catalog()
    context = _chunk_context(chunk)
    hits = _dedup_hits(catalog.search(context, top_k=MAX_NODE_HITS_PER_CHUNK, min_score=MIN_NODE_HIT_SCORE))
    if len(hits) < 2:
        return []

    source_id = str(chunk.get("source_id") or "python-docs-3.14.6")
    source_chunk_id = str(chunk.get("chunk_id") or chunk.get("id") or "")
    source_url = str(chunk.get("source_url") or "")
    source_license_note = str(
        chunk.get("source_license_note")
        or chunk.get("license_note")
        or "python-software-foundation-documentation-license"
    )

    candidates: dict[str, dict] = {}
    for first, second in itertools.combinations(hits, 2):
        relation = _relation_for_pair(catalog.edges, first.node, second.node)
        if relation is None:
            continue
        subject, predicate, object_ = relation
        evidence = _find_evidence(text, first.node, second.node)
        if not evidence:
            continue
        confidence = _candidate_confidence(first.score, second.score)
        candidate_id = candidate_id_for(source_chunk_id, subject, predicate, object_)
        candidates[candidate_id] = {
            "candidate_id": candidate_id,
            "source_id": source_id,
            "source_chunk_id": source_chunk_id,
            "source_url": source_url,
            "source_license_note": source_license_note,
            "subject": subject,
            "predicate": predicate,
            "object": object_,
            "confidence": confidence,
            "evidence_text": evidence,
            "status": "auto_extracted",
            "created_at": DETERMINISTIC_CREATED_AT,
        }

    return sorted(candidates.values(), key=_candidate_sort_key)


@lru_cache(maxsize=1)
def extraction_catalog():
    return load_kg_catalog(generated_dir=REPO_ROOT / "kg" / "__not_used_for_extraction__")


def extract_candidates_from_chunks(chunks: Iterable[dict]) -> list[dict]:
    candidates: dict[str, dict] = {}
    for chunk in chunks:
        for candidate in extract_candidates_from_chunk(chunk):
            candidates.setdefault(candidate["candidate_id"], candidate)
    return sorted(candidates.values(), key=_candidate_sort_key)


def extract_seed_and_llm_candidates_from_chunks(
    chunks: Iterable[dict],
    chat_provider: Any | None = None,
) -> list[dict]:
    seed_candidates: list[dict] = []
    llm_candidates: list[dict] = []
    for chunk in chunks:
        seed_candidates.extend(extract_candidates_from_chunk(chunk))
        if chat_provider is not None:
            llm_candidates.extend(extract_llm_candidates_from_chunk(chunk, chat_provider))
    return sorted(
        [
            *seed_candidates,
            *merge_llm_candidates(llm_candidates),
        ],
        key=_candidate_sort_key,
    )


def write_candidates_jsonl(candidates: Iterable[dict], path: Path = CANDIDATES_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(_ordered_candidate(row), ensure_ascii=False) for row in candidates]
    content = "\n".join(lines)
    if content:
        content += "\n"
    path.write_text(content, encoding="utf-8")


def _chunk_context(chunk: dict) -> str:
    return "\n".join(
        [
            str(chunk.get("title") or ""),
            " > ".join(str(item) for item in chunk.get("heading_path", []) or []),
            str(chunk.get("text") or ""),
        ],
    )


def _dedup_hits(hits: list[CatalogSearchHit]) -> list[CatalogSearchHit]:
    result: list[CatalogSearchHit] = []
    seen: set[str] = set()
    for hit in hits:
        node_id = hit.node.node_id
        if node_id in seen:
            continue
        if hit.node.node_type not in {"Concept", "ErrorType", "Misconception", "Function", "Statement", "Practice"}:
            continue
        seen.add(node_id)
        result.append(hit)
    return result


def _relation_for_pair(edges: list[CatalogEdge], first: CatalogNode, second: CatalogNode) -> tuple[str, str, str] | None:
    direct = _catalog_edge_between(edges, first.node_id, second.node_id)
    if direct is not None:
        return direct.source, direct.predicate, direct.target
    reverse = _catalog_edge_between(edges, second.node_id, first.node_id)
    if reverse is not None:
        return reverse.source, reverse.predicate, reverse.target
    return None


def _catalog_edge_between(edges: list[CatalogEdge], source: str, target: str) -> CatalogEdge | None:
    matches = [edge for edge in edges if edge.source == source and edge.target == target]
    if not matches:
        return None
    return sorted(matches, key=lambda edge: (-edge.weight, edge.origin, edge.predicate))[0]


def _candidate_confidence(first_score: float, second_score: float) -> float:
    raw = 0.42 + min(first_score, 4.0) * 0.06 + min(second_score, 4.0) * 0.04
    return round(min(0.92, max(0.45, raw)), 2)


def _find_evidence(text: str, first: CatalogNode, second: CatalogNode, max_length: int = MAX_EVIDENCE_LENGTH) -> str:
    first_terms = _node_terms(first)
    second_terms = _node_terms(second)
    for segment in _candidate_segments(text):
        if _segment_matches(segment, first_terms) and _segment_matches(segment, second_terms):
            evidence = _trim_evidence_window(segment, [*first_terms, *second_terms], max_length)
            if _is_readable_evidence(evidence):
                return evidence
    return ""


def _node_terms(node: CatalogNode) -> list[str]:
    terms = [
        node.label,
        node.node_id.split(":", 1)[-1].replace("_", " "),
        *node.aliases,
        *node.evidence_texts[:3],
    ]
    return [term for term in terms if term and len(term.strip()) > 1]


def _candidate_segments(text: str) -> list[str]:
    code_blocks = re.findall(r"```.*?```", text, flags=re.DOTALL)
    prose = re.sub(r"```.*?```", "\n", text, flags=re.DOTALL)
    pieces = [
        piece.strip()
        for piece in re.split(r"(?<=[.!?。！？])\s+|\n{2,}", prose)
        if piece.strip()
    ]
    return [*pieces, *[block.strip() for block in code_blocks if block.strip()]]


def _segment_matches(segment: str, terms: list[str]) -> bool:
    lower = segment.lower()
    return any(term.lower() in lower for term in terms)


def _trim_evidence_window(segment: str, terms: list[str], max_length: int) -> str:
    if len(segment) <= max_length:
        return segment
    lower = segment.lower()
    positions = [lower.find(term.lower()) for term in terms if term and lower.find(term.lower()) >= 0]
    center = min(positions) if positions else 0
    start = max(0, center - max_length // 3)
    end = min(len(segment), start + max_length)
    start = _previous_boundary(segment, start)
    end = _next_boundary(segment, end)
    return _trim_to_length(segment[start:end].strip(), max_length)


def _trim_to_length(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    return text[:max_length].rstrip()


def _previous_boundary(text: str, start: int) -> int:
    if start <= 0:
        return 0
    candidates = [text.rfind(mark, 0, start) for mark in [". ", "\n", "。", "；", "; "]]
    boundary = max(candidates)
    return boundary + 1 if boundary >= 0 else start


def _next_boundary(text: str, end: int) -> int:
    if end >= len(text):
        return len(text)
    candidates = [text.find(mark, end) for mark in [". ", "\n", "。", "；", "; "] if text.find(mark, end) >= 0]
    return min(candidates) + 1 if candidates else end


def _is_readable_evidence(text: str) -> bool:
    return bool(text.strip()) and _has_balanced_code_fences(text)


def _has_balanced_code_fences(text: str) -> bool:
    return text.count("```") in {0, 2}


def _ordered_candidate(candidate: dict) -> dict:
    return {field: candidate[field] for field in REQUIRED_FIELD_ORDER}


def _candidate_sort_key(candidate: dict) -> tuple[str, str, str, str, str]:
    return (
        candidate["candidate_id"],
        candidate["source_chunk_id"],
        candidate["subject"],
        candidate["predicate"],
        candidate["object"],
    )
