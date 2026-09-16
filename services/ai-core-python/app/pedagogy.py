from __future__ import annotations

import re

from app.conversation_projection import ConversationProjection
from app.turn_resolution import TurnResolution


WORKFLOW_KEYS = (
    "primary_skill_id",
    "active_gate_id",
    "skill_id",
    "state",
    "hint_level",
    "requires_student_attempt",
    "allow_direct_answer",
    "direct_answer_given",
    "next_required_action",
    "prompt",
    "prompt_key",
    "confidence_before_required",
    "confidence_before",
    "confidence_after_required",
    "teach_back_required",
    "teach_back_score",
    "teach_back_feedback",
    "stuck_detected",
    "repeated_prompt_blocked",
    "decision_reason",
    "workflow_trace",
)


STUCK_MARKERS = ("不知道", "不懂", "不会", "还是不懂", "没懂", "看不懂", "不会判断", "没思路")
ATTEMPT_MARKERS = (
    "我觉得",
    "我认为",
    "我猜",
    "我理解",
    "因为",
    "所以",
    "尝试",
    "试过",
    "代码",
    "执行",
    "操作",
    "=",
    "print(",
    "报错",
    "异常",
    "输出",
    "结果",
)

PRIMARY_WORKFLOW_SKILL_ID = "student-learning/adaptive-python-workflow"
RETRIEVE_FIRST_SKILL_ID = "student-learning/retrieve-first-gate"
CONFIDENCE_CALIBRATION_SKILL_ID = "student-learning/confidence-calibration-check"
STUCK_DIAGNOSIS_SKILL_ID = "student-learning/stuck-and-error-diagnosis-coach"
PROGRESSIVE_HINT_SKILL_ID = "student-learning/progressive-hint-ladder"
TEACH_BACK_SKILL_ID = "student-learning/teach-back-evaluator"

HINT_PROMPTS = {
    1: "先把你认为相关的概念或代码片段圈出来：你觉得问题卡在哪一步？",
    2: "把已知条件、正在执行的操作、实际结果分三行写出来，我们先定位差异。",
    3: "用一个更小的例子复现同类现象，再对照教材证据判断规则。",
    4: "现在可以给解释：把规则、例子和你原来的代码对应起来，再说出下一步怎么改。",
}

RETRIEVE_FIRST_PROMPT = "在我解释完整答案前，请你先判断一下：这个问题可能和哪个 Python 概念、语句或运行结果有关？"
CONFIDENCE_BEFORE_PROMPT = "先做个信心校准：你现在对定位这个问题的信心是 1-5 中的几分？"
CONFIDENCE_AFTER_PROMPT = "请再给一个 1-5 的信心分数：现在你对这个问题的原因有多确定？"
TEACH_BACK_PROMPT = "你抓到关键点了。请用自己的话复述一遍：规则是什么、例子说明了什么、你下一步会怎么检查？"
DIAGNOSIS_PROMPT = "我们先定位问题：请分别写出已知条件、你执行的操作、实际结果这三项。"

RECOVERY_CONTAINER_KEYS = ("last_evidence", "evidence", "skill_state", "workflow", "pedagogical_workflow")
RECOVERABLE_WORKFLOW_KEYS = tuple(dict.fromkeys(WORKFLOW_KEYS + ("confidence_before", "retrieve_first_done")))


def apply_direct_answer_entitlement(skill_action: dict, entitlement: bool) -> dict:
    """Allow a paid direct answer for this turn without changing future policy selection."""
    if not entitlement:
        return dict(skill_action)

    return {
        **skill_action,
        "state": "direct_answer_allowed",
        "hint_level": 0,
        "requires_student_attempt": False,
        "allow_direct_answer": True,
        "direct_answer_given": False,
        "next_required_action": "none",
        "prompt": "Return an answer-only direct response for the current question.",
        "prompt_key": "token_direct_answer_strict",
        "preempted_policy": {
            "state": skill_action.get("state"),
            "active_gate_id": skill_action.get("active_gate_id"),
            "prompt_key": skill_action.get("prompt_key"),
            "next_required_action": skill_action.get("next_required_action"),
        },
    }


def select_topic_state(
    resolution: TurnResolution,
    projection: ConversationProjection,
) -> dict:
    """Select the sole workflow state allowed to influence this turn."""

    topic_id = resolution.active_topic_after
    frame = projection.topics.get(topic_id) if topic_id else None
    frame_payload = frame.model_dump(mode="json") if frame is not None else None
    pedagogy_state = (
        frame.pedagogy_state.model_dump(mode="json")
        if frame is not None and resolution.workflow_action != "initialize"
        else {}
    )
    task_state = {}
    last_evidence = {}
    if pedagogy_state:
        task_state = {
            "topic": frame.canonical_topic,
            "current_concept": frame.active_kg_focus_node_id or frame.canonical_topic,
            "workflow_state": pedagogy_state.get("workflow_state"),
            "active_gate_id": pedagogy_state.get("active_gate_id"),
            "hint_level": pedagogy_state.get("hint_level", 0),
            "next_required_action": pedagogy_state.get("next_required_action"),
            "teach_back_required": pedagogy_state.get("teach_back_required", False),
            "last_rag_chunk_ids": list(frame.last_rag_chunk_ids),
        }
        last_evidence = {
            **pedagogy_state,
            "state": pedagogy_state.get("workflow_state"),
            "confidence_before": pedagogy_state.get("confidence_before"),
            "confidence_after": pedagogy_state.get("confidence_after"),
        }
    return {
        "topic_id": topic_id,
        "topic_frame": frame_payload,
        "pedagogy_state": pedagogy_state,
        "task_state": task_state,
        "last_evidence": last_evidence,
        "advance_pedagogy": resolution.workflow_action != "preserve_without_advance",
    }


def decide_next_teaching_action(
    skill_id: str,
    message: str,
    stage: str = "start",
    recent_messages: list[dict] | None = None,
    task_state: dict | None = None,
    last_evidence: dict | None = None,
) -> dict:
    recent_messages = recent_messages or []
    task_state = task_state or {}
    last_evidence = last_evidence or {}
    workflow_evidence = recover_workflow_evidence(last_evidence)
    normalized = _normalize(message)
    stuck_detected = _is_stuck(normalized)
    previous_prompts = _previous_agent_prompts(recent_messages)
    incoming_hint_level = max(
        _coerce_int(task_state.get("hint_level"), default=0),
        _coerce_int(workflow_evidence.get("hint_level"), default=0),
    )
    if _is_expected_confidence_before_response(
        normalized,
        task_state,
        workflow_evidence,
    ):
        workflow_evidence = {
            **workflow_evidence,
            "confidence_before": int(normalized) / 5,
        }

    if not _uses_pedagogical_skills(skill_id):
        return _action(
            skill_id=skill_id,
            workflow_evidence=workflow_evidence,
            state="direct_answer_allowed",
            hint_level=0,
            requires_student_attempt=False,
            allow_direct_answer=True,
            direct_answer_given=False,
            next_required_action="answer_with_evidence",
            prompt="可以直接结合检索证据回答学生问题。",
            prompt_key="direct_answer_allowed",
            confidence_before_required=False,
            confidence_after_required=False,
            teach_back_required=False,
            teach_back_score=None,
            teach_back_feedback=None,
            stuck_detected=stuck_detected,
            repeated_prompt_blocked=False,
            decision_reason="baseline mode does not enable pedagogical skill gates",
        )

    if _is_teach_back_submission(stage, task_state, workflow_evidence):
        score, feedback = _score_teach_back(normalized)
        prompt = CONFIDENCE_AFTER_PROMPT if score >= 0.8 else f"{feedback} 请再用自己的话补上：规则、例子和下一步检查动作。"
        return _action(
            skill_id=TEACH_BACK_SKILL_ID,
            workflow_evidence=workflow_evidence,
            state="teach_back_evaluated",
            hint_level=incoming_hint_level,
            requires_student_attempt=False,
            allow_direct_answer=False,
            direct_answer_given=False,
            next_required_action="collect_confidence_after" if score >= 0.8 else "repair_teach_back",
            prompt=prompt,
            prompt_key="confidence_after" if score >= 0.8 else "repair_teach_back",
            confidence_before_required=False,
            confidence_after_required=score >= 0.8,
            teach_back_required=score < 0.8,
            teach_back_score=score,
            teach_back_feedback=feedback,
            stuck_detected=stuck_detected,
            repeated_prompt_blocked=False,
            decision_reason="evaluated student teach-back against rule, example, and next-action criteria",
        )

    if _should_retrieve_first(stage, recent_messages, task_state, workflow_evidence, normalized):
        prompt, repeated, prompt_key = _avoid_repeat(
            RETRIEVE_FIRST_PROMPT,
            "retrieve_first",
            previous_prompts,
            incoming_hint_level,
            workflow_evidence,
            allow_direct_answer=False,
        )
        return _action(
            skill_id=RETRIEVE_FIRST_SKILL_ID,
            workflow_evidence=workflow_evidence,
            state="retrieve_first",
            hint_level=0,
            requires_student_attempt=True,
            allow_direct_answer=False,
            direct_answer_given=False,
            next_required_action="student_attempt",
            prompt=prompt,
            prompt_key=prompt_key,
            confidence_before_required=False,
            confidence_after_required=False,
            teach_back_required=False,
            teach_back_score=None,
            teach_back_feedback=None,
            stuck_detected=stuck_detected,
            repeated_prompt_blocked=repeated,
            decision_reason="retrieve-first gate requires an initial student attempt before explanation",
        )

    if stuck_detected:
        next_level = min(max(incoming_hint_level + 1, 1), 4)
        prompt = DIAGNOSIS_PROMPT if next_level == 1 else HINT_PROMPTS[next_level]
        key = "diagnose_stuck" if next_level <= 2 else f"hint_level_{next_level}"
        allow_direct_answer = next_level >= 4
        prompt, repeated, prompt_key = _avoid_repeat(
            prompt,
            key,
            previous_prompts,
            next_level,
            workflow_evidence,
            allow_direct_answer=allow_direct_answer,
        )
        hint_level, state, active_gate_id, next_required_action = _sync_hint_decision(next_level, prompt_key)
        allow_direct_answer = allow_direct_answer and hint_level >= 4
        return _action(
            skill_id=active_gate_id,
            workflow_evidence=workflow_evidence,
            state=state,
            hint_level=hint_level,
            requires_student_attempt=True,
            allow_direct_answer=allow_direct_answer,
            direct_answer_given=False,
            next_required_action=next_required_action,
            prompt=prompt,
            prompt_key=prompt_key,
            confidence_before_required=False,
            confidence_after_required=False,
            teach_back_required=False,
            teach_back_score=None,
            teach_back_feedback=None,
            stuck_detected=True,
            repeated_prompt_blocked=repeated or bool(previous_prompts),
            decision_reason="student is stuck; escalate hint ladder without repeating the previous prompt",
        )

    if _needs_confidence_before(skill_id, workflow_evidence) and _is_confidence_gate_input(stage, stuck_detected, incoming_hint_level, normalized):
        prompt, repeated, prompt_key = _avoid_repeat(
            CONFIDENCE_BEFORE_PROMPT,
            "confidence_before",
            previous_prompts,
            incoming_hint_level,
            workflow_evidence,
            allow_direct_answer=False,
        )
        return _action(
            skill_id=CONFIDENCE_CALIBRATION_SKILL_ID,
            workflow_evidence=workflow_evidence,
            state="confidence_before_required",
            hint_level=incoming_hint_level,
            requires_student_attempt=True,
            allow_direct_answer=False,
            direct_answer_given=False,
            next_required_action="collect_confidence_before",
            prompt=prompt,
            prompt_key=prompt_key,
            confidence_before_required=True,
            confidence_after_required=False,
            teach_back_required=False,
            teach_back_score=None,
            teach_back_feedback=None,
            stuck_detected=stuck_detected,
            repeated_prompt_blocked=repeated,
            decision_reason="entering confidence calibration because pedagogical workflow has a student attempt but no confidence_before",
        )

    if _has_substantive_reasoning(normalized):
        prompt, repeated, prompt_key = _avoid_repeat(
            TEACH_BACK_PROMPT,
            "teach_back_required",
            previous_prompts,
            incoming_hint_level,
            workflow_evidence,
            allow_direct_answer=False,
        )
        return _action(
            skill_id=TEACH_BACK_SKILL_ID,
            workflow_evidence=workflow_evidence,
            state="teach_back_required",
            hint_level=incoming_hint_level,
            requires_student_attempt=True,
            allow_direct_answer=False,
            direct_answer_given=False,
            next_required_action="teach_back",
            prompt=prompt,
            prompt_key=prompt_key,
            confidence_before_required=False,
            confidence_after_required=False,
            teach_back_required=True,
            teach_back_score=None,
            teach_back_feedback=None,
            stuck_detected=stuck_detected,
            repeated_prompt_blocked=repeated,
            decision_reason="student supplied substantive reasoning, so require own-words teach-back",
        )

    if _has_student_attempt(normalized):
        hint_level = min(max(incoming_hint_level, 1), 3)
        prompt, repeated, prompt_key = _avoid_repeat(
            HINT_PROMPTS[hint_level],
            f"hint_level_{hint_level}",
            previous_prompts,
            hint_level,
            workflow_evidence,
            allow_direct_answer=False,
        )
        hint_level, state, active_gate_id, next_required_action = _sync_hint_decision(hint_level, prompt_key)
        return _action(
            skill_id=active_gate_id,
            workflow_evidence=workflow_evidence,
            state=state,
            hint_level=hint_level,
            requires_student_attempt=True,
            allow_direct_answer=False,
            direct_answer_given=False,
            next_required_action=next_required_action,
            prompt=prompt,
            prompt_key=prompt_key,
            confidence_before_required=False,
            confidence_after_required=False,
            teach_back_required=False,
            teach_back_score=None,
            teach_back_feedback=None,
            stuck_detected=False,
            repeated_prompt_blocked=repeated,
            decision_reason="student attempted the problem; move to targeted diagnosis",
        )

    next_level = min(max(incoming_hint_level + 1, 1), 4)
    allow_direct_answer = next_level >= 4
    prompt, repeated, prompt_key = _avoid_repeat(
        HINT_PROMPTS[next_level],
        f"hint_level_{next_level}",
        previous_prompts,
        next_level,
        workflow_evidence,
        allow_direct_answer=allow_direct_answer,
    )
    return _action(
        skill_id=PROGRESSIVE_HINT_SKILL_ID,
        workflow_evidence=workflow_evidence,
        state=f"hint_level_{next_level}",
        hint_level=next_level,
        requires_student_attempt=True,
        allow_direct_answer=allow_direct_answer,
        direct_answer_given=False,
        next_required_action="apply_hint",
        prompt=prompt,
        prompt_key=prompt_key,
        confidence_before_required=False,
        confidence_after_required=False,
        teach_back_required=False,
        teach_back_score=None,
        teach_back_feedback=None,
        stuck_detected=False,
        repeated_prompt_blocked=repeated,
        decision_reason="continue progressive hint ladder",
    )


def _action(**values: object) -> dict:
    workflow_evidence = values.pop("workflow_evidence", {}) or {}
    values.setdefault("confidence_before", workflow_evidence.get("confidence_before"))
    active_gate_id = str(values.get("active_gate_id") or values.get("skill_id") or "")
    values["active_gate_id"] = active_gate_id
    values["skill_id"] = active_gate_id
    values["primary_skill_id"] = values.get("primary_skill_id") or _primary_skill_id(active_gate_id)
    values["workflow_trace"] = _build_workflow_trace(values, workflow_evidence)
    return {key: values.get(key) for key in WORKFLOW_KEYS}


def _build_workflow_trace(action: dict, workflow_evidence: dict) -> list[dict[str, str]]:
    active_gate_id = str(action.get("active_gate_id") or "")
    if not _uses_pedagogical_skills(active_gate_id):
        return [
            {"skill_id": skill_id, "status": "skipped"}
            for skill_id in _workflow_skill_ids()
        ]

    state = str(action.get("state") or "")
    hint_level = _coerce_int(action.get("hint_level"), default=0)
    teach_back_score = action.get("teach_back_score")
    has_confidence_before = workflow_evidence.get("confidence_before") is not None

    retrieve_status = "active" if active_gate_id == RETRIEVE_FIRST_SKILL_ID else "passed"
    if active_gate_id == CONFIDENCE_CALIBRATION_SKILL_ID:
        confidence_status = "active"
    elif has_confidence_before:
        confidence_status = "passed"
    elif active_gate_id == RETRIEVE_FIRST_SKILL_ID:
        confidence_status = "pending"
    else:
        confidence_status = "pending"

    if active_gate_id == STUCK_DIAGNOSIS_SKILL_ID:
        stuck_status = "active"
    elif active_gate_id in {PROGRESSIVE_HINT_SKILL_ID, TEACH_BACK_SKILL_ID}:
        stuck_status = "passed"
    else:
        stuck_status = "waiting"

    if active_gate_id == PROGRESSIVE_HINT_SKILL_ID:
        hint_status = "active"
    elif active_gate_id == TEACH_BACK_SKILL_ID:
        hint_status = "passed"
    elif active_gate_id == STUCK_DIAGNOSIS_SKILL_ID and hint_level >= 3:
        hint_status = "passed"
    else:
        hint_status = "waiting"

    if active_gate_id == TEACH_BACK_SKILL_ID:
        if state == "teach_back_evaluated":
            teach_status = "passed" if _coerce_score(teach_back_score) >= 0.8 else "repair"
        else:
            teach_status = "active"
    else:
        teach_status = "waiting"

    return [
        {"skill_id": RETRIEVE_FIRST_SKILL_ID, "status": retrieve_status},
        {"skill_id": CONFIDENCE_CALIBRATION_SKILL_ID, "status": confidence_status},
        {"skill_id": STUCK_DIAGNOSIS_SKILL_ID, "status": stuck_status},
        {"skill_id": PROGRESSIVE_HINT_SKILL_ID, "status": hint_status},
        {"skill_id": TEACH_BACK_SKILL_ID, "status": teach_status},
    ]


def _workflow_skill_ids() -> tuple[str, str, str, str, str]:
    return (
        RETRIEVE_FIRST_SKILL_ID,
        CONFIDENCE_CALIBRATION_SKILL_ID,
        STUCK_DIAGNOSIS_SKILL_ID,
        PROGRESSIVE_HINT_SKILL_ID,
        TEACH_BACK_SKILL_ID,
    )


def _coerce_score(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _uses_pedagogical_skills(skill_id: str) -> bool:
    return skill_id.startswith("student-learning/")


def _primary_skill_id(skill_id: str) -> str:
    return PRIMARY_WORKFLOW_SKILL_ID if _uses_pedagogical_skills(skill_id) else skill_id


def recover_workflow_evidence(last_evidence: dict | None) -> dict:
    if not isinstance(last_evidence, dict):
        return {}

    containers = _workflow_evidence_containers(last_evidence)

    recovered = {}
    for key in RECOVERABLE_WORKFLOW_KEYS:
        for container in containers:
            if container.get(key) is not None:
                recovered[key] = container[key]
                break
    state = str(recovered.get("state") or "")
    if recovered.get("prompt_key") is None:
        recovered["prompt_key"] = _prompt_key_from_state(state)
    if recovered.get("hint_level") is None and state.startswith("hint_level_"):
        recovered["hint_level"] = state.removeprefix("hint_level_")
    return recovered


def _workflow_evidence_containers(value: dict) -> list[dict]:
    containers = []
    seen = set()

    def visit(candidate: object) -> None:
        if not isinstance(candidate, dict) or id(candidate) in seen:
            return
        seen.add(id(candidate))
        containers.append(candidate)
        for key in RECOVERY_CONTAINER_KEYS:
            visit(candidate.get(key))

    visit(value)
    return containers


def _prompt_key_from_state(state: str) -> str | None:
    if state in {"retrieve_first", "diagnose_stuck"} or state.startswith("hint_level_"):
        return state
    if state == "confidence_before_required":
        return "confidence_before"
    if state == "teach_back_required":
        return "teach_back_required"
    if state == "teach_back_evaluated":
        return "confidence_after"
    return None


def _normalize(message: str) -> str:
    return (message or "").strip().lower().replace(" ", "")


def _is_stuck(normalized_message: str) -> bool:
    return any(marker in normalized_message for marker in STUCK_MARKERS)


def _has_student_attempt(normalized_message: str) -> bool:
    if any(marker.lower().replace(" ", "") in normalized_message for marker in ATTEMPT_MARKERS):
        return True
    has_student_claim = any(marker in normalized_message for marker in ("我", "我的", "这里", "这段", "这个"))
    has_code_or_value = bool(re.search(r"(```|`[^`]+`|\[[^\]]+\]|\b\w+\([^)]*\)|==|!=|<=|>=|=|->|\d)", normalized_message))
    return has_student_claim and has_code_or_value


def _has_substantive_reasoning(normalized_message: str) -> bool:
    has_rule = any(marker in normalized_message for marker in ("规则", "条件", "约束", "要求", "应该", "必须", "不能", "需要", "会导致"))
    has_cause = any(marker in normalized_message for marker in ("因为", "所以", "原因", "导致"))
    has_example = any(marker in normalized_message for marker in ("比如", "例如", "假设", "例子", "代码", "输出", "结果", "现象"))
    has_next_action = any(marker in normalized_message for marker in ("检查", "验证", "运行", "调试", "改成", "修改", "下一步", "再试", "定位", "对照"))
    return (has_rule and has_cause) or (has_rule and has_example) or (has_example and has_next_action)


def _is_teach_back_submission(stage: str, task_state: dict, workflow_evidence: dict) -> bool:
    return (
        stage == "teach_back"
        or bool(task_state.get("teach_back_required"))
        or bool(workflow_evidence.get("teach_back_required"))
        or workflow_evidence.get("state") == "teach_back_required"
    )


def _score_teach_back(normalized_message: str) -> tuple[float, str]:
    points = 0
    if any(marker in normalized_message for marker in ("规则", "条件", "约束", "要求", "应该", "必须", "不能", "需要")):
        points += 1
    if any(marker in normalized_message for marker in ("因为", "所以", "原因", "导致")):
        points += 1
    if any(marker in normalized_message for marker in ("比如", "例如", "假设", "例子", "代码", "输出", "结果", "现象")):
        points += 1
    if any(marker in normalized_message for marker in ("检查", "验证", "运行", "调试", "下一步", "再试", "改成", "修改", "定位", "对照")):
        points += 1
    if any(marker in normalized_message for marker in ("教材", "文档", "来源", "证据", "kg", "rag")):
        points += 1

    score = min(points / 5, 1.0)
    if score >= 0.8:
        return score, "复述完整：包含规则、原因、例子、证据和下一步检查。"
    if score >= 0.4:
        return score, "复述有一部分关键点，但还需要补上例子或下一步检查。"
    return score, "复述还不够具体，需要明确规则、原因、例子和下一步动作。"


def _needs_confidence_before(skill_id: str, workflow_evidence: dict) -> bool:
    if workflow_evidence.get("confidence_before") is not None:
        return False
    return _uses_pedagogical_skills(skill_id)


def _is_expected_confidence_before_response(
    normalized_message: str,
    task_state: dict,
    workflow_evidence: dict,
) -> bool:
    if not re.fullmatch(r"[1-5]", normalized_message):
        return False
    state = str(
        workflow_evidence.get("state")
        or workflow_evidence.get("workflow_state")
        or task_state.get("workflow_state")
        or ""
    )
    next_action = str(
        workflow_evidence.get("next_required_action")
        or task_state.get("next_required_action")
        or ""
    )
    return (
        state == "confidence_before_required"
        or next_action == "collect_confidence_before"
    )


def _is_confidence_gate_input(stage: str, stuck_detected: bool, hint_level: int, normalized_message: str) -> bool:
    return stage != "start" or stuck_detected or hint_level > 0 or _has_student_attempt(normalized_message) or _has_substantive_reasoning(normalized_message)


def _should_retrieve_first(
    stage: str,
    recent_messages: list[dict],
    task_state: dict,
    workflow_evidence: dict,
    normalized_message: str,
) -> bool:
    if stage != "start":
        return False
    if _is_teach_back_submission(stage, task_state, workflow_evidence):
        return False
    if task_state.get("retrieve_first_done") or workflow_evidence.get("retrieve_first_done") or workflow_evidence.get("state"):
        return False
    if _previous_agent_prompts(recent_messages):
        return False
    if _is_stuck(normalized_message) or _has_student_attempt(normalized_message) or _has_substantive_reasoning(normalized_message):
        return False
    return True


def _previous_agent_prompts(recent_messages: list[dict]) -> list[str]:
    prompts = []
    for item in recent_messages:
        role = item.get("role")
        if role in {"agent", "assistant", "teacher"}:
            prompts.append(str(item.get("content", "")))
    return prompts


def _avoid_repeat(
    prompt: str,
    prompt_key: str,
    previous_prompts: list[str],
    hint_level: int,
    workflow_evidence: dict,
    *,
    allow_direct_answer: bool,
) -> tuple[str, bool, str]:
    if prompt not in previous_prompts and workflow_evidence.get("prompt_key") != prompt_key:
        return prompt, False, prompt_key
    max_fallback_level = 4 if allow_direct_answer else 3
    fallback_level = min(max(hint_level + 1, 1), max_fallback_level)
    fallback_prompt = HINT_PROMPTS.get(fallback_level, HINT_PROMPTS[4])
    fallback_key = f"hint_level_{fallback_level}"
    if fallback_prompt == prompt:
        fallback_prompt = "换个角度：把已知条件、操作步骤和实际结果并排写出来，再判断差异在哪里。"
    return fallback_prompt, True, fallback_key


def _sync_hint_decision(hint_level: int, prompt_key: str) -> tuple[int, str, str, str]:
    effective_level = _hint_level_from_prompt_key(prompt_key) or hint_level
    state = f"hint_level_{effective_level}" if prompt_key.startswith("hint_level_") else prompt_key
    active_gate_id = STUCK_DIAGNOSIS_SKILL_ID if effective_level <= 2 else PROGRESSIVE_HINT_SKILL_ID
    next_required_action = "diagnose_learning_gap" if effective_level <= 2 else "apply_hint"
    return effective_level, state, active_gate_id, next_required_action


def _hint_level_from_prompt_key(prompt_key: str) -> int | None:
    if not prompt_key.startswith("hint_level_"):
        return None
    return _coerce_int(prompt_key.removeprefix("hint_level_"), default=0) or None


def _coerce_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
