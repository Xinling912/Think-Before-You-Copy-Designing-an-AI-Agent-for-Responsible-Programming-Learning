from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable


DETERMINISTIC_LLM_CREATED_AT = "2026-07-08T00:00:00Z"
REQUIRED_LLM_FIELD_ORDER = (
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


def stable_node_id(label: str, node_type: str = "Concept") -> str:
    clean_type = _clean_node_type(node_type)
    label = label.strip()
    if ":" in label and label.split(":", 1)[0] in {"Concept", "ErrorType", "Misconception"}:
        return label
    if clean_type == "ErrorType" and re.fullmatch(r"[A-Za-z_]*Error", label):
        slug = label.replace(" ", "")
    else:
        normalized = label.lower().replace(".", "_").replace("-", "_")
        slug = re.sub(r"[^a-z0-9_]+", "_", normalized)
        slug = re.sub(r"_+", "_", slug).strip("_")
    return f"{clean_type}:{slug or 'unknown'}"


def extract_llm_candidates_from_chunk(chunk: dict, chat_provider: Any) -> list[dict]:
    text = str(chunk.get("text") or "")
    if not text.strip():
        return []

    payload = _ask_extraction_provider(chunk, chat_provider)
    concept_ids = _concept_id_map(payload.get("concepts", []), text)
    relation_rows = list(payload.get("relations", []) or [])
    relation_rows.extend(_prerequisite_relations(payload.get("prerequisites", []) or []))
    relation_rows.extend(_misconception_relations(payload.get("misconceptions", []) or []))

    candidates: dict[str, dict] = {}
    for relation in relation_rows:
        candidate = _candidate_from_relation(chunk, text, relation, concept_ids)
        if candidate is not None:
            candidates[candidate["candidate_id"]] = candidate
    return sorted(candidates.values(), key=_candidate_sort_key)


def merge_llm_candidates(candidates: Iterable[dict]) -> list[dict]:
    merged: dict[tuple[str, str, str, str, str], dict] = {}
    for candidate in candidates:
        key = (
            str(candidate.get("subject") or ""),
            str(candidate.get("predicate") or ""),
            str(candidate.get("object") or ""),
            str(candidate.get("source_id") or ""),
            str(candidate.get("source_chunk_id") or ""),
        )
        existing = merged.get(key)
        if existing is None or float(candidate.get("confidence", 0)) > float(existing.get("confidence", 0)):
            merged[key] = _ordered_candidate(candidate)
    return sorted(merged.values(), key=_candidate_sort_key)


def _ask_extraction_provider(chunk: dict, chat_provider: Any) -> dict:
    prompt = _extraction_prompt(str(chunk.get("text") or ""))
    if hasattr(chat_provider, "chat"):
        raw = chat_provider.chat(prompt)
    elif callable(chat_provider):
        raw = chat_provider(prompt)
    else:
        raise TypeError("chat_provider must expose chat(prompt) or be callable")
    if isinstance(raw, dict):
        return raw
    return _parse_json_object(str(raw))


def _extraction_prompt(text: str) -> str:
    return (
        "Extract beginner-relevant Python KG concepts and relations from this chunk. "
        "Return strict JSON with concepts, relations, prerequisites, misconceptions. "
        "Every relation must include an exact evidence_span copied from the chunk.\n"
        f"Chunk:\n{text}"
    )


def _concept_id_map(concepts: Iterable[dict], text: str) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for concept in concepts:
        label = str(concept.get("label") or concept.get("node_id") or "").strip()
        if not label:
            continue
        evidence_span = str(concept.get("evidence_span") or "")
        if evidence_span and evidence_span not in text:
            continue
        node_id = str(concept.get("node_id") or "") or stable_node_id(label, str(concept.get("node_type") or "Concept"))
        mapping[_norm_label(label)] = node_id
        mapping[_norm_label(node_id)] = node_id
        for alias in concept.get("aliases", []) or []:
            mapping[_norm_label(str(alias))] = node_id
    return mapping


def _candidate_from_relation(chunk: dict, text: str, relation: dict, concept_ids: dict[str, str]) -> dict | None:
    evidence_span = str(relation.get("evidence_span") or "")
    if not evidence_span or evidence_span not in text:
        return None

    subject_raw = str(relation.get("subject") or relation.get("source") or "").strip()
    object_raw = str(relation.get("object") or relation.get("target") or "").strip()
    predicate = str(relation.get("predicate") or relation.get("type") or "").strip()
    if not subject_raw or not object_raw or not predicate:
        return None

    subject = _resolve_node_id(subject_raw, concept_ids)
    object_ = _resolve_node_id(object_raw, concept_ids)
    source_chunk_id = str(chunk.get("chunk_id") or chunk.get("id") or "")
    candidate_id = _candidate_id_for(source_chunk_id, subject, predicate, object_)
    return _ordered_candidate(
        {
            "candidate_id": candidate_id,
            "source_id": str(chunk.get("source_id") or ""),
            "source_chunk_id": source_chunk_id,
            "source_url": str(chunk.get("source_url") or ""),
            "source_license_note": str(chunk.get("source_license_note") or chunk.get("license_note") or ""),
            "subject": subject,
            "predicate": predicate,
            "object": object_,
            "confidence": float(relation.get("confidence", 0.75) or 0.75),
            "evidence_text": evidence_span,
            "status": "llm_extracted",
            "created_at": DETERMINISTIC_LLM_CREATED_AT,
        }
    )


def _resolve_node_id(value: str, concept_ids: dict[str, str]) -> str:
    if ":" in value and value.split(":", 1)[0] in {"Concept", "ErrorType", "Misconception"}:
        return value
    mapped = concept_ids.get(_norm_label(value))
    if mapped:
        return mapped
    node_type = "ErrorType" if value.endswith("Error") else "Concept"
    return stable_node_id(value, node_type)


def _prerequisite_relations(rows: Iterable[dict]) -> list[dict]:
    relations: list[dict] = []
    for row in rows:
        subject = row.get("subject") or row.get("source") or row.get("concept")
        object_ = row.get("object") or row.get("target") or row.get("prerequisite")
        relations.append({**row, "subject": subject, "predicate": row.get("predicate") or "requires", "object": object_})
    return relations


def _misconception_relations(rows: Iterable[dict]) -> list[dict]:
    relations: list[dict] = []
    for row in rows:
        label = row.get("label") or row.get("misconception")
        target = row.get("target") or row.get("concept")
        if label and target:
            relations.append(
                {
                    **row,
                    "subject": stable_node_id(str(label), "Misconception"),
                    "predicate": row.get("predicate") or "misunderstands",
                    "object": target,
                }
            )
    return relations


def _ordered_candidate(candidate: dict) -> dict:
    return {field: candidate[field] for field in REQUIRED_LLM_FIELD_ORDER}


def _candidate_sort_key(candidate: dict) -> tuple[str, str, str, str, str]:
    return (
        str(candidate["candidate_id"]),
        str(candidate["source_chunk_id"]),
        str(candidate["subject"]),
        str(candidate["predicate"]),
        str(candidate["object"]),
    )


def _candidate_id_for(chunk_id: str, subject: str, predicate: str, object_: str) -> str:
    raw = "\x1f".join([chunk_id, subject, predicate, object_])
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"kgllm_{digest}"


def _clean_node_type(node_type: str) -> str:
    return node_type if node_type in {"Concept", "ErrorType", "Misconception"} else "Concept"


def _norm_label(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower().replace(".", "_").replace("-", "_"))


def _parse_json_object(raw: str) -> dict:
    text = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1)
    return json.loads(text)
