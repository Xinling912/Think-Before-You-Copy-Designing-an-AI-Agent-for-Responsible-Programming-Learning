from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from app.kg import shortest_learning_path
from app.kg_catalog import KGCatalog, CatalogSearchHit, load_kg_catalog
from app.curriculum_kg import curriculum_path_payload
from app.turn_resolution import TurnResolution


class InvalidFocusNodeIdError(ValueError):
    def __init__(self, requested_focus_node_id: str) -> None:
        self.requested_focus_node_id = requested_focus_node_id
        super().__init__(f"Unknown KG focus node: {requested_focus_node_id}")


def validate_requested_focus_node_id(
    requested_focus_node_id: str | None,
    catalog: KGCatalog | None = None,
) -> None:
    if requested_focus_node_id is None:
        return
    catalog = catalog or load_kg_catalog()
    if requested_focus_node_id not in catalog.nodes:
        raise InvalidFocusNodeIdError(requested_focus_node_id)


def ground_resolved_turn(
    resolution: TurnResolution,
    understanding: Any,
    *,
    historical_concept_ids: list[str] | None = None,
    grounder: Any | None = None,
) -> dict:
    """Ground only the subject approved by turn arbitration."""

    selected_node_id = (
        resolution.selected_node.node_id
        if resolution.selected_node.usage == "used"
        else None
    )
    grounding_function = grounder or ground_question
    return grounding_function(
        resolution.resolved_question,
        current_concept_hints=list(understanding.concept_hints),
        historical_concept_ids=list(historical_concept_ids or []),
        requested_focus_node_id=selected_node_id,
    )


def ground_question(
    question: str,
    catalog: KGCatalog | None = None,
    *,
    chat_provider: Any | None = None,
    top_k: int = 8,
    current_concept_hints: list[str] | None = None,
    historical_concept_ids: list[str] | None = None,
    requested_focus_node_id: str | None = None,
) -> dict:
    catalog = catalog or load_kg_catalog()
    validate_requested_focus_node_id(requested_focus_node_id, catalog)
    current_concept_hints = current_concept_hints or []
    historical_concept_ids = historical_concept_ids or []
    curriculum_hints = [requested_focus_node_id] if requested_focus_node_id else current_concept_hints
    curriculum_path = curriculum_path_payload(question, curriculum_hints)
    candidates = _current_question_candidates(
        question,
        catalog,
        current_concept_hints=current_concept_hints,
        historical_concept_ids=historical_concept_ids,
        top_k=top_k,
    )

    if requested_focus_node_id is not None:
        result = _grounded_result(
            question,
            catalog,
            candidates,
            [requested_focus_node_id],
            method="explicit_focus",
            confidence=1.0,
            reason="Selected from the caller's validated explicit KG focus.",
            source_node_id=requested_focus_node_id,
            target_node_id=requested_focus_node_id,
        )
        result["focus_source"] = "explicit"
        result["requested_focus_node_id"] = requested_focus_node_id
        if curriculum_path:
            result["curriculum_path"] = curriculum_path
        return result

    if not candidates:
        result = _gap_result(question, [])
        result["focus_source"] = "current_question"
        result["requested_focus_node_id"] = None
        if curriculum_path:
            result["curriculum_path"] = curriculum_path
        return result

    if chat_provider is not None:
        provider_result = _ask_provider(question, candidates, chat_provider)
        selected_ids = _valid_selected_ids(provider_result, candidates, catalog)
        if selected_ids:
            result = _grounded_result(
                question,
                catalog,
                candidates,
                selected_ids,
                method="qwen_kg_grounding",
                confidence=float(provider_result.get("confidence", candidates[0].score)),
                reason=str(provider_result.get("reason") or "Provider selected source-backed KG node IDs."),
                source_node_id=str(provider_result.get("source_node_id") or selected_ids[0]),
                target_node_id=str(provider_result.get("target_node_id") or selected_ids[-1]),
            )
            if curriculum_path:
                result["curriculum_path"] = curriculum_path
            result["focus_source"] = "current_question"
            result["requested_focus_node_id"] = None
            return result
        invalid_ids = provider_result.get("selected_node_ids") or []
        fallback = _fallback_result(question, catalog, candidates)
        fallback["reason"] = f"Provider selected node IDs outside the candidate set: {invalid_ids}; used catalog similarity fallback."
        if curriculum_path:
            fallback["curriculum_path"] = curriculum_path
        fallback["focus_source"] = "current_question"
        fallback["requested_focus_node_id"] = None
        return fallback

    result = _fallback_result(question, catalog, candidates)
    if curriculum_path:
        result["curriculum_path"] = curriculum_path
    result["focus_source"] = "current_question"
    result["requested_focus_node_id"] = None
    return result


def _current_question_candidates(
    question: str,
    catalog: KGCatalog,
    *,
    current_concept_hints: list[str],
    historical_concept_ids: list[str],
    top_k: int,
) -> list[CatalogSearchHit]:
    candidates = catalog.search(question, top_k=top_k)
    exact_current_ids = list(dict.fromkeys(node_id for node_id in current_concept_hints if node_id in catalog.nodes))
    if exact_current_ids:
        maximum_score = max((candidate.score for candidate in candidates), default=0.0)
        by_id = {candidate.node.node_id: candidate for candidate in candidates}
        boosted: list[CatalogSearchHit] = []
        for offset, node_id in enumerate(exact_current_ids):
            existing = by_id.pop(node_id, None)
            boosted.append(
                CatalogSearchHit(
                    node=catalog.nodes[node_id],
                    score=maximum_score + 10.0 - (offset * 0.001),
                    matched_text=existing.matched_text if existing else catalog.nodes[node_id].label,
                    method=existing.method if existing else "current_concept_hint",
                )
            )
        candidates = boosted + [candidate for candidate in candidates if candidate.node.node_id in by_id]

    history_rank = {node_id: index for index, node_id in enumerate(historical_concept_ids)}
    indexed = list(enumerate(candidates))
    indexed.sort(
        key=lambda item: (
            -item[1].score,
            0 if item[1].node.node_id in history_rank else 1,
            history_rank.get(item[1].node.node_id, item[0]),
            item[0],
        )
    )
    return [candidate for _, candidate in indexed[:top_k]]


def _fallback_result(question: str, catalog: KGCatalog, candidates: list[CatalogSearchHit]) -> dict:
    source_node_id, target_node_id, selected_ids = _fallback_source_and_target(
        candidates,
        allow_error_target=_question_mentions_error_signal(question),
    )
    return _grounded_result(
        "",
        catalog,
        candidates,
        selected_ids,
        method="catalog_similarity_fallback",
        confidence=candidates[0].score,
        reason="Selected by catalog lexical similarity fallback.",
        source_node_id=source_node_id,
        target_node_id=target_node_id,
    )


def _fallback_source_and_target(candidates: list[CatalogSearchHit], *, allow_error_target: bool) -> tuple[str, str, list[str]]:
    usable_candidates = candidates if allow_error_target else [
        hit for hit in candidates if hit.node.node_type not in {"ErrorType", "Misconception"}
    ]
    if not usable_candidates:
        usable_candidates = candidates
    top_ids = [hit.node.node_id for hit in usable_candidates[:4]]
    if not allow_error_target:
        source_id = usable_candidates[0].node.node_id
        return source_id, source_id, top_ids
    target_hit = next(
        (
            hit
            for hit in candidates
            if hit.node.node_type in {"ErrorType", "Misconception"}
        ),
        None,
    )
    source_hit = next(
        (
            hit
            for hit in candidates
            if target_hit is None or hit.node.node_id != target_hit.node.node_id
        ),
        candidates[0],
    )
    target_id = target_hit.node.node_id if target_hit is not None else top_ids[-1]
    source_id = source_hit.node.node_id
    selected_ids = []
    for node_id in [source_id, *top_ids, target_id]:
        if node_id not in selected_ids:
            selected_ids.append(node_id)
    return source_id, target_id, selected_ids


def _question_mentions_error_signal(question: str) -> bool:
    normalized = question.lower()
    return bool(
        re.search(r"\b[A-Za-z_][A-Za-z0-9_]*Error\b", question)
        or any(
            marker in normalized or marker in question
            for marker in ("traceback", "exception", "debug", "报错", "错误", "异常", "失败")
        )
    )


def _grounded_result(
    question: str,
    catalog: KGCatalog,
    candidates: list[CatalogSearchHit],
    selected_ids: list[str],
    *,
    method: str,
    confidence: float,
    reason: str,
    source_node_id: str,
    target_node_id: str,
) -> dict:
    del question
    if source_node_id not in catalog.nodes:
        source_node_id = selected_ids[0]
    if target_node_id not in catalog.nodes:
        target_node_id = selected_ids[-1]
    path, path_edges = shortest_learning_path(source_node_id, target_node_id, catalog=catalog)
    topic_node = catalog.get_node(selected_ids[0])
    return {
        "topic_id": selected_ids[0],
        "topic_label": topic_node.label,
        "source_node_id": source_node_id,
        "target_node_id": target_node_id,
        "selected_node_ids": selected_ids,
        "candidate_nodes": [_candidate_payload(hit) for hit in candidates],
        "path": path,
        "path_edges": path_edges,
        "method": method,
        "confidence": confidence,
        "reason": reason,
        "kg_gap": False,
    }


def _gap_result(question: str, candidates: list[CatalogSearchHit]) -> dict:
    digest = hashlib.sha256(question.encode("utf-8")).hexdigest()[:12]
    return {
        "topic_id": f"kg_gap:{digest}",
        "topic_label": "KG gap",
        "source_node_id": None,
        "target_node_id": None,
        "selected_node_ids": [],
        "candidate_nodes": [_candidate_payload(hit) for hit in candidates],
        "path": [],
        "path_edges": [],
        "method": "catalog_similarity_fallback",
        "confidence": 0.0,
        "reason": "No source-backed KG catalog candidate supported the question.",
        "kg_gap": True,
    }


def _ask_provider(question: str, candidates: list[CatalogSearchHit], chat_provider: Any) -> dict:
    prompt = _grounding_prompt(question, candidates)
    if hasattr(chat_provider, "chat"):
        raw = chat_provider.chat(prompt)
    elif callable(chat_provider):
        raw = chat_provider(prompt)
    else:
        raise TypeError("chat_provider must expose chat(prompt) or be callable")
    if isinstance(raw, dict):
        return raw
    return _parse_json_object(str(raw))


def _grounding_prompt(question: str, candidates: list[CatalogSearchHit]) -> str:
    rows = [
        {
            "node_id": hit.node.node_id,
            "label": hit.node.label,
            "aliases": list(hit.node.aliases),
            "evidence_texts": list(hit.node.evidence_texts[:2]),
            "score": hit.score,
        }
        for hit in candidates
    ]
    return (
        "Select only KG node IDs from the provided candidates. "
        "Return JSON with selected_node_ids, source_node_id, target_node_id, confidence, reason.\n"
        f"Question: {question}\nCandidates: {json.dumps(rows, ensure_ascii=False)}"
    )


def _valid_selected_ids(provider_result: dict, candidates: list[CatalogSearchHit], catalog: KGCatalog) -> list[str]:
    candidate_ids = {hit.node.node_id for hit in candidates}
    selected = provider_result.get("selected_node_ids") or []
    if isinstance(selected, str):
        selected = [selected]
    result = [str(node_id) for node_id in selected if str(node_id) in candidate_ids and str(node_id) in catalog.nodes]
    if len(result) != len(selected):
        return []
    return result


def _candidate_payload(hit: CatalogSearchHit) -> dict:
    return {
        "node_id": hit.node.node_id,
        "label": hit.node.label,
        "node_type": hit.node.node_type,
        "aliases": list(hit.node.aliases),
        "source_ids": list(hit.node.source_ids),
        "source_chunk_ids": list(hit.node.source_chunk_ids),
        "source_urls": list(hit.node.source_urls),
        "evidence_texts": list(hit.node.evidence_texts),
        "confidence": hit.node.confidence,
        "origin": hit.node.origin,
        "score": hit.score,
        "matched_text": hit.matched_text,
    }


def _parse_json_object(raw: str) -> dict:
    text = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1)
    return json.loads(text)
