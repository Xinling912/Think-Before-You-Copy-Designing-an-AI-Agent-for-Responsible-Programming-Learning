from __future__ import annotations

import math
from hashlib import sha1
from datetime import datetime, timezone
from typing import Any


DEFAULT_MEMORY_TOPIC = "general_python_learning"


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def overlap(left: list[str], right: list[str]) -> bool:
    return bool(set(left) & set(right))


def _strong_concept_overlap(left: list[str], right: list[str]) -> bool:
    shared = set(left) & set(right)
    return len(shared) >= 2


def _same_memory_theme(memory: dict[str, Any], candidate: dict[str, Any]) -> bool:
    return memory.get("topic") == candidate.get("topic") or _strong_concept_overlap(
        memory.get("concepts", []),
        candidate.get("concepts", []),
    )


def _active(memory: dict[str, Any]) -> bool:
    return memory.get("status", "active") == "active"


def _candidate_is_salient(candidate: dict[str, Any]) -> tuple[bool, str | None]:
    content = str(candidate.get("content", "")).strip()
    if len(content) < 8:
        return False, "candidate_memory_too_short"
    if float(candidate.get("salience", 1.0)) < 0.2:
        return False, "candidate_not_salient"
    return True, None


def _noop_operation(
    reason: str = "no_salient_candidate",
    topic: str = DEFAULT_MEMORY_TOPIC,
) -> dict[str, Any]:
    return {
        "operation": "NOOP",
        "reason": reason,
        "memory_type": "none",
        "topic": topic,
        "concepts": [],
        "content": "",
    }


def _put_identity(target: dict[str, Any], source: dict[str, Any]) -> None:
    learner_id = source.get("learner_id")
    session_id = source.get("session_id")
    if learner_id and learner_id != "unknown":
        target["learner_id"] = learner_id
    if session_id and session_id != "unknown":
        target["session_id"] = session_id


def _copy_candidate_contract(target: dict[str, Any], candidate: dict[str, Any]) -> None:
    _put_identity(target, candidate)
    for key in ("confidence", "source", "evidence_span", "salience"):
        if candidate.get(key) is not None:
            target[key] = candidate.get(key)


def memorybank_effective_score(
    strength: int,
    use_count: int,
    days_since_last_used: float,
) -> float:
    if strength < 1:
        strength = 1
    if use_count < 0:
        use_count = 0
    if days_since_last_used < 0:
        days_since_last_used = 0

    retention = math.exp(-float(days_since_last_used) / float(strength))
    reinforcement = 1 + math.log1p(float(use_count)) * 0.15
    return retention * reinforcement


def compute_effective_score(
    *,
    strength: int,
    use_count: int,
    days_since_last_used: float,
) -> float:
    return memorybank_effective_score(strength, use_count, days_since_last_used)


def derive_memory_state(learner_memory: list[dict[str, Any]]) -> dict[str, Any]:
    active = [memory for memory in learner_memory if _active(memory)]
    active_risks: list[str] = []
    mastered_concepts: list[str] = []
    misconceptions: list[dict[str, Any]] = []
    for memory in active:
        if memory.get("topic") == "learning_strategy_direct_answer_dependency":
            active_risks.append("direct_answer_dependency")
        if memory.get("memory_type") == "mastery":
            mastered_concepts.extend(memory.get("concepts", []))
        if memory.get("memory_type") == "misconception":
            misconceptions.append(
                {
                    "topic": memory.get("topic"),
                    "concepts": memory.get("concepts", []),
                    "content": memory.get("content"),
                }
            )
    return {
        "active_risks": _unique(active_risks),
        "mastered_concepts": _unique(mastered_concepts),
        "misconceptions": misconceptions,
        "retrieved_memory_count": len(active),
    }


def reinforce_retrieved_memories(memories: list[dict[str, Any]], now_iso: str) -> list[dict[str, Any]]:
    reinforced: list[dict[str, Any]] = []
    for memory in memories:
        updated = dict(memory)
        updated["use_count"] = int(updated.get("use_count", 0)) + 1
        updated["last_used_at"] = now_iso
        updated["effective_score"] = compute_effective_score(
            strength=int(updated.get("strength", 1)),
            use_count=int(updated["use_count"]),
            days_since_last_used=0,
        )
        reinforced.append(updated)
    return reinforced


def build_reflection_summary(
    *,
    topic: str,
    recent_messages: list[dict[str, Any]],
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    evidence = evidence or {}
    combined_messages = " ".join(str(message.get("content", "")) for message in recent_messages)
    if _mentions_uncertainty(combined_messages):
        retrospective = "学生表达了不确定或卡住，需要继续确认薄弱概念，再选择检索证据和教学技能。"
    else:
        retrospective = "本轮需要根据学生表达、检索证据和教学技能记录学习进展。"
    prospective = "下一轮优先要求学生先说出自己的判断，再要求复述依据和下一步检查动作。"
    if evidence.get("teach_back_required"):
        prospective = "下一轮优先要求学生用自己的话复述规则、依据和检查动作，并根据复述决定是否迁移练习。"
    return {
        "topic": topic,
        "prospective": prospective,
        "retrospective": retrospective,
        "evidence": dict(evidence),
    }


def _mentions_direct_answer_request(message: str) -> bool:
    normalized = message.lower()
    markers = [
        "direct answer",
        "full answer",
        "complete answer",
        "直接答案",
        "直接给",
        "完整答案",
        "全部答案",
        "直接告诉",
        "给我答案",
        "给我完整",
    ]
    return any(marker in normalized or marker in message for marker in markers)


def _mentions_uncertainty(message: str) -> bool:
    normalized = message.lower()
    return any(
        marker in normalized or marker in message
        for marker in ["不知道", "不懂", "不会", "没懂", "看不懂", "没思路", "confused", "stuck"]
    )


def _mentions_problem_signal(message: str, workflow_evidence: dict[str, Any]) -> bool:
    normalized = message.lower()
    intent = str(workflow_evidence.get("intent", "")).lower()
    return (
        _mentions_uncertainty(message)
        or "debug" in intent
        or "error" in intent
        or any(marker in normalized or marker in message for marker in ["报错", "错误", "异常", "不对", "失败", "error"])
    )


def extract_memory_candidates(
    learner_id: str | None,
    session_id: str | None,
    student_message: str,
    agent_message: str,
    topic: str,
    concepts: list[str],
    allow_llm: bool = False,
    workflow_evidence: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    del allow_llm
    candidates: list[dict[str, Any]] = []
    normalized_concepts = _unique(concepts)
    workflow_evidence = workflow_evidence or {}
    teach_back_score = workflow_evidence.get("teach_back_score")
    try:
        numeric_teach_back_score = float(teach_back_score)
    except (TypeError, ValueError):
        numeric_teach_back_score = 0.0
    mastery_evaluated = (
        workflow_evidence.get("state") == "teach_back_evaluated"
        and numeric_teach_back_score >= 0.8
    )

    if mastery_evaluated:
        mastery_concepts = _unique(normalized_concepts)
        candidate = {
            "memory_type": "mastery",
            "topic": topic or DEFAULT_MEMORY_TOPIC,
            "concepts": mastery_concepts,
            "content": "学生完成了一次有效复述，能把规则、例子和下一步检查动作联系起来。",
            "reason": "teach_back_score_meets_mastery_threshold",
            "salience": 0.95,
            "confidence": numeric_teach_back_score,
            "source": "teach_back_evaluator",
            "evidence_span": student_message,
            "status": "active",
            "evidence": {
                "student_message": student_message,
                "agent_message": agent_message,
                "workflow_evidence": workflow_evidence,
            },
        }
        _put_identity(candidate, {"learner_id": learner_id, "session_id": session_id})
        candidates.append(candidate)

    if not mastery_evaluated and _mentions_problem_signal(student_message, workflow_evidence):
        misconception_concepts = _unique(normalized_concepts)
        candidate = {
            "memory_type": "misconception",
            "topic": topic or DEFAULT_MEMORY_TOPIC,
            "concepts": misconception_concepts,
            "content": "学生在当前主题上表达不确定，需要先诊断已知条件、操作步骤和实际结果。",
            "reason": "student_reports_uncertainty",
            "salience": 0.75,
            "confidence": 0.75,
            "source": "deterministic_rule",
            "evidence_span": student_message,
            "status": "active",
            "evidence": {
                "student_message": student_message,
                "agent_message": agent_message,
            },
        }
        _put_identity(candidate, {"learner_id": learner_id, "session_id": session_id})
        candidates.append(candidate)

    if _mentions_direct_answer_request(student_message):
        candidate = {
            "memory_type": "preference",
            "topic": "learning_strategy_direct_answer_dependency",
            "concepts": _unique(normalized_concepts + ["Concept:direct_answer_dependency"]),
            "content": "学生请求直接或完整答案，存在过度依赖直接答案的学习风险。",
            "reason": "student_requests_direct_or_full_answer",
            "salience": 0.8,
            "confidence": 0.8,
            "source": "deterministic_rule",
            "evidence_span": student_message,
            "status": "active",
            "evidence": {
                "student_message": student_message,
                "agent_message": agent_message,
            },
        }
        _put_identity(candidate, {"learner_id": learner_id, "session_id": session_id})
        candidates.append(candidate)

    return candidates


def _add_operation(candidate: dict[str, Any]) -> dict[str, Any]:
    operation = {
        "operation": "ADD",
        "memory_type": candidate.get("memory_type"),
        "topic": candidate.get("topic"),
        "concepts": candidate.get("concepts", []),
        "content": candidate.get("content"),
        "reason": candidate.get("reason", "new_topic_memory"),
    }
    _copy_candidate_contract(operation, candidate)
    return operation


def _update_operation(candidate: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    merged_content = f"{memory.get('content', '')} {candidate.get('content', '')}".strip()
    concepts = sorted(set(memory.get("concepts", []) + candidate.get("concepts", [])))
    operation = {
        "operation": "UPDATE",
        "target_memory_id": memory.get("memory_id"),
        "memory_type": candidate.get("memory_type"),
        "topic": candidate.get("topic"),
        "concepts": concepts,
        "content": merged_content,
        "reason": "same_topic_and_overlapping_concepts",
    }
    _copy_candidate_contract(operation, candidate)
    return operation


def _delete_operation(candidate: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    operation = {
        "operation": "DELETE",
        "target_memory_id": memory.get("memory_id"),
        "memory_type": candidate.get("memory_type"),
        "topic": candidate.get("topic"),
        "concepts": sorted(set(memory.get("concepts", []) + candidate.get("concepts", []))),
        "content": candidate.get("content"),
        "reason": "mastery_contradicts_active_misconception",
    }
    _copy_candidate_contract(operation, candidate)
    return operation


def decide_memory_operations(
    candidates: list[dict[str, Any]],
    existing_memories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not candidates:
        return [_noop_operation()]

    operations: list[dict[str, Any]] = []

    for candidate in candidates:
        salient, reason = _candidate_is_salient(candidate)
        if not salient:
            operations.append(_noop_operation(reason or "candidate_not_salient"))
            continue

        if candidate.get("memory_type") == "mastery":
            contradicted = next(
                (
                    memory
                    for memory in existing_memories
                    if _active(memory)
                    and memory.get("memory_type") == "misconception"
                    and _same_memory_theme(memory, candidate)
                ),
                None,
            )
            if contradicted:
                operations.append(_delete_operation(candidate, contradicted))
                continue

        matched = next(
            (
                memory
                for memory in existing_memories
                if _active(memory)
                and memory.get("memory_type") == candidate.get("memory_type")
                and _same_memory_theme(memory, candidate)
            ),
            None,
        )
        if matched:
            operations.append(_update_operation(candidate, matched))
        else:
            operations.append(_add_operation(candidate))

    return operations


def decide_memory_operation(
    candidate: dict[str, Any],
    existing_memories: list[dict[str, Any]],
) -> dict[str, Any]:
    operations = decide_memory_operations([candidate], existing_memories)
    return operations[0] if operations else {"operation": "NOOP", "reason": "no_candidate"}


def build_prospective_memory_plan(
    topic: str,
    query_concepts: list[str],
    learner_memory: list[dict[str, Any]],
    topic_summaries: list[dict[str, Any]],
) -> dict[str, Any]:
    selected: list[dict[str, Any]] = []
    for memory in learner_memory:
        if not _active(memory):
            continue
        same_topic = memory.get("topic") == topic
        concept_match = overlap(memory.get("concepts", []), query_concepts)
        if not same_topic and not concept_match:
            continue
        scored = dict(memory)
        if scored.get("effective_score") is None:
            scored["effective_score"] = memorybank_effective_score(
                int(memory.get("strength", 1)),
                int(memory.get("use_count", 0)),
                float(memory.get("days_since_last_used", 0)),
            )
        selected.append(scored)

    selected.sort(key=lambda item: item.get("effective_score", 0), reverse=True)
    selected_topic_summary = next(
        (summary for summary in topic_summaries if summary.get("topic") == topic),
        None,
    )
    selected_ids = [
        memory.get("memory_id")
        for memory in selected
        if memory.get("memory_id")
    ]
    concept_text = ", ".join(query_concepts) if query_concepts else "current query concepts"
    plan_text = (
        f"Use selected memories for {concept_text}; start with diagnosed weak concepts, "
        "ask for a brief student prediction, then connect feedback to the retrieved evidence."
    )

    return {
        "topic": topic,
        "selected_memory_ids": selected_ids,
        "selected_memories": selected,
        "selected_topic_summary": selected_topic_summary,
        "prospective_memory_plan": plan_text,
    }


def retrospective_memory_use(
    plan: dict[str, Any],
    used_memory_ids: list[str],
    verification_reason: str = "model_reported_used_memory_ids",
) -> dict[str, Any]:
    selected_ids = plan.get("selected_memory_ids", [])
    selected_id_set = set(selected_ids)
    verified_used_ids = [memory_id for memory_id in used_memory_ids if memory_id in selected_id_set]
    unused_ids = [
        memory_id
        for memory_id in selected_ids
        if memory_id not in set(verified_used_ids)
    ]
    refinement = (
        "Keep retrieval weighting for selected memories that were used."
        if verified_used_ids
        else "Reduce reliance on selected memories for this query shape."
    )
    if unused_ids:
        refinement += " Review unused selected memories for overly broad topic or concept matching."

    return {
        "selected_memory_ids": selected_ids,
        "used_memory_ids": verified_used_ids,
        "unused_selected_memory_ids": unused_ids,
        "verification_reason": verification_reason,
        "retrospective_memory_use": (
            f"Used {len(verified_used_ids)} of {len(selected_ids)} selected memories for "
            f"{plan.get('topic', 'unknown_topic')}."
        ),
        "retrieval_refinement": refinement,
    }


def build_or_update_topic_summary(
    topic: str,
    existing_summary: dict[str, Any] | None,
    memory_updates: list[dict[str, Any]],
    used_memory_ids: list[str],
) -> dict[str, Any]:
    existing_summary = existing_summary or {}
    weak_concepts = set(existing_summary.get("weak_concepts", []))
    mastered_concepts = set(existing_summary.get("mastered_concepts", []))
    source_memory_ids = set(existing_summary.get("source_memory_ids", [])) | set(used_memory_ids)

    for update in memory_updates:
        if update.get("topic") != topic:
            continue

        memory_id = update.get("memory_id") or update.get("target_memory_id")
        if memory_id:
            source_memory_ids.add(memory_id)

        concepts = set(update.get("concepts", []))
        memory_type = update.get("memory_type")
        operation = update.get("operation")

        if memory_type == "misconception" and operation in {"ADD", "UPDATE"}:
            weak_concepts |= concepts
        if memory_type == "mastery" or operation == "DELETE":
            mastered_concepts |= concepts
            weak_concepts -= concepts

    if weak_concepts:
        next_action = "Target weak concepts with a short diagnostic question before explanation."
    elif mastered_concepts:
        next_action = "Increase challenge level and ask the learner to transfer the concept."
    else:
        next_action = "Gather more evidence before adapting instruction."

    summary_text = (
        f"Topic {topic}: weak concepts={sorted(weak_concepts)}; "
        f"mastered concepts={sorted(mastered_concepts)}."
    )
    return {
        "topic": topic,
        "topic_summary": summary_text,
        "weak_concepts": sorted(weak_concepts),
        "mastered_concepts": sorted(mastered_concepts),
        "next_teaching_action": next_action,
        "source_memory_ids": sorted(source_memory_ids),
    }


def generate_learning_facts(
    learner_id: str,
    episode_id: int,
    topic: str,
    memory_updates: list[dict[str, Any]],
    turn_key: str = "",
) -> list[dict[str, Any]]:
    valid_from = datetime.now(timezone.utc).isoformat()
    facts: list[dict[str, Any]] = []
    try:
        source_episode_id = int(episode_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("source_episode_id/episode_id must be an integer") from exc
    if source_episode_id <= 0:
        raise ValueError("source_episode_id/episode_id must be a positive integer")

    def build_fact(
        update: dict[str, Any],
        predicate: str,
        object_value: str,
        index: int,
    ) -> dict[str, Any]:
        update_topic = update.get("topic") or topic
        confidence = float(update.get("confidence") or update.get("salience") or 0.8)
        source_memory_id = update.get("target_memory_id") or update.get("memory_id")
        payload = {
            "operation": update.get("operation"),
            "memory_type": update.get("memory_type"),
            "topic": update_topic,
            "concepts": update.get("concepts", []),
            "content": update.get("content"),
            "reason": update.get("reason"),
            "source_memory_id": source_memory_id,
            "target_memory_id": update.get("target_memory_id"),
            "source": update.get("source"),
            "evidence_span": update.get("evidence_span"),
        }
        fact_key = "|".join(
            [
                learner_id,
                str(source_episode_id),
                predicate,
                object_value,
                str(index),
                str(source_memory_id or ""),
                str(turn_key or ""),
            ]
        )
        return {
            "fact_id": f"fact_{sha1(fact_key.encode('utf-8')).hexdigest()[:16]}",
            "learner_id": learner_id,
            "subject": f"Learner:{learner_id}",
            "predicate": predicate,
            "object": object_value,
            "confidence": confidence,
            "source_episode_id": source_episode_id,
            "valid_from": valid_from,
            "valid_to": None,
            "status": "active",
            "payload": payload,
        }

    for index, update in enumerate(memory_updates):
        operation = update.get("operation")
        memory_type = update.get("memory_type")
        update_topic = update.get("topic") or topic

        if operation in {"ADD", "UPDATE"} and memory_type == "misconception":
            facts.append(
                build_fact(
                    update,
                    "has_misconception",
                    f"Misconception:{update_topic}",
                    index,
                )
            )
        elif operation == "DELETE" or memory_type == "mastery":
            facts.append(
                build_fact(
                    update,
                    "resolved_misconception",
                    f"Misconception:{update_topic}",
                    index,
                )
            )
            if update.get("concepts"):
                facts.append(
                    build_fact(
                        update,
                        "has_mastery",
                        f"Mastery:{update_topic}",
                        index,
                    )
                )

    return facts


def build_memory_context(
    *,
    recent_messages: list[dict[str, Any]],
    task_state: dict[str, Any],
    learner_memory: list[dict[str, Any]],
    retrieved_memory_ids: list[str] | None = None,
    topic_summaries: list[dict[str, Any]] | None = None,
    reading_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    active_memories = [
        memory
        for memory in learner_memory
        if _active(memory)
    ]
    active_ids = [
        memory.get("memory_id")
        for memory in active_memories
        if memory.get("memory_id")
    ]
    context = {
        "short_term_count": len(recent_messages),
        "mid_term_state_keys": sorted(task_state.keys()),
        "long_term_count": len(active_memories),
        "retrieved_memory_ids": retrieved_memory_ids if retrieved_memory_ids is not None else active_ids,
        "active_topics": sorted(
            {
                str(memory.get("topic"))
                for memory in active_memories
                if memory.get("topic")
            }
        ),
    }

    if topic_summaries is not None or reading_plan is not None:
        plan_topic = (reading_plan or {}).get("topic") or task_state.get("topic")
        query_concepts = (reading_plan or {}).get("query_concepts") or task_state.get("query_concepts", [])
        prospective = build_prospective_memory_plan(
            topic=plan_topic,
            query_concepts=query_concepts,
            learner_memory=active_memories,
            topic_summaries=topic_summaries or [],
        ) if plan_topic else None
        context["rmm"] = {
            "reading_plan": reading_plan,
            "topic_summary_count": len(topic_summaries or []),
            "prospective_memory_plan": prospective,
        }

    return context


def candidate_memory_from_exchange(
    *,
    message: str,
    concept_hints: list[str],
    kg_path: list[str],
    learner_id: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any] | None:
    concepts = _unique(concept_hints + kg_path)
    candidates = extract_memory_candidates(
        learner_id=learner_id,
        session_id=session_id,
        student_message=message,
        agent_message="",
        topic=_topic_from_concepts(concepts),
        concepts=concepts,
    )
    if candidates:
        return candidates[0]

    if _mentions_uncertainty(message):
        candidate = {
            "memory_type": "misconception",
            "topic": _topic_from_concepts(concepts),
            "concepts": concepts,
            "content": "学生表示不理解当前主题，需要从已知条件、操作步骤和实际结果继续诊断。",
            "reason": "student_reports_uncertainty",
            "salience": 0.7,
            "confidence": 0.7,
            "source": "deterministic_rule",
            "evidence_span": message,
        }
        _put_identity(candidate, {"learner_id": learner_id, "session_id": session_id})
        return candidate
    return None


def _topic_from_concepts(concepts: list[str]) -> str:
    return concepts[0] if concepts else DEFAULT_MEMORY_TOPIC
