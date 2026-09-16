import copy
import datetime
import hashlib
import re
import uuid
from typing import Any, Iterator

from app.conversation_events import ConversationEvent
from app.conversation_projection import (
    ConversationProjection,
    TopicFrame,
    TopicPedagogyState,
    apply_events,
)
from app.kg_catalog import KGCatalog, load_kg_catalog
from app.kg_grounding import (
    ground_question,
    ground_resolved_turn as _ground_resolved_turn,
    validate_requested_focus_node_id,
)
from app.memory import (
    build_memory_context,
    build_or_update_topic_summary,
    build_prospective_memory_plan,
    decide_memory_operations,
    extract_memory_candidates,
    generate_learning_facts,
    retrospective_memory_use,
)
from app.pedagogy import (
    apply_direct_answer_entitlement,
    decide_next_teaching_action,
    recover_workflow_evidence,
    select_topic_state,
)
from app.schemas import TokenChargeDecisionResponse
from app.rag import search_chunks
from app.query_understanding import (
    QueryUnderstandingResult,
    understand_query,
    understand_resolved_question,
)
from app.response_contract import (
    StructuredTeachingAnswer,
    build_response_contract,
    render_teaching_response,
)
from app.dashscope import DashScopeAPIError, DashScopeChatProvider, DashScopeConfigurationError
from app.turn_resolution import TurnResolution, resolve_turn


BASELINE_MODES = {"no_rag", "rag_only", "rag_kg", "rag_kg_skills", "full_memory"}
MAX_SHORT_TERM_MESSAGES = 12
MAX_CONTEXT_TEXT_CHARS = 360
MAX_RAG_SOURCE_TEXT_CHARS = 700
MAX_CONTEXT_ITEMS = 8
_DEFAULT_UNDERSTAND_QUERY = understand_query


TEACHING_SYSTEM_PROMPT = """你是 ResponsibleEduAgent 的 Python 编程学习教练。
你的目标是促进学生理解，而不是直接替学生完成答案。
必须遵守：
1. 如果 allow_direct_answer 是 false，不要直接给完整答案或代写代码。
2. 优先让学生先判断、回忆、解释。
3. 必须回应 student_message 的具体内容，不能只复述 workflow 模板。
4. 不能重复 recent_messages 中最近一条助手回复；如果学生反问、困惑或吐槽，先承认上一句没说清楚，再换一种问法。
5. 回复必须围绕 KG path 和 RAG source，不要泛泛聊天。
6. 中文回复，最多 160 字。
7. 结尾提出一个具体小问题，便于 teach-back。
"""


TEACHING_SYSTEM_PROMPT += (
    "\nLanguage rule: reply in the same natural language as student_message. "
    "If student_message is English, reply entirely in English. "
    "If student_message is Chinese, reply in Chinese. "
    "This language rule overrides any earlier Chinese-only default.\n"
    "Return only the teaching answer body. Never emit Selected Node:, "
    "Topic Transition:, Previous Context:, or Resumed Context: metadata; "
    "the application renders those audit lines deterministically.\n"
)


def _prefers_chinese(message: str) -> bool:
    content = message or ""
    if re.search(r"[\u4e00-\u9fff]", content):
        return True
    if re.search(r"[A-Za-z]", content):
        return False
    return bool(re.search(r"[？！，。；：]", content))


def _response_language(message: str) -> str:
    return "Chinese" if _prefers_chinese(message) else "English"


def _response_matches_language(message: str, response: str) -> bool:
    if _prefers_chinese(message):
        return _prefers_chinese(response)
    return not _prefers_chinese(response)


def validate_direct_answer_delivery(message: str, response: str) -> dict[str, bool | str]:
    language = _response_language(message)
    marker = "直接答案：" if language == "Chinese" else "Direct answer:"
    question_free = "?" not in response and "？" not in response
    valid = bool(response.startswith(marker) and question_free)
    return {
        "valid": valid,
        "language": language,
        "marker": marker,
        "question_free": question_free,
    }


def _language_compatible_skill_prompt(message: str, skill_action: dict) -> str:
    prompt = str(skill_action.get("prompt") or "").strip()
    if not prompt:
        return ""
    if _prefers_chinese(message):
        return prompt
    if _prefers_chinese(prompt):
        return ""
    return prompt


def fallback_teaching_prompt(message: str, query_understanding: QueryUnderstandingResult) -> str:
    if not _prefers_chinese(message):
        normalized = message.lower()
        if "don't know" in normalized or "do not know" in normalized or "not sure" in normalized:
            return "Before giving a full answer, write one known condition, the operation you tried, and the actual result. Then we can locate the stuck point."
        if "error" in normalized or "exception" in normalized or "fail" in normalized:
            return "First identify the error type, the exact line that triggers it, and the result you expected. We will use these three facts to locate the cause."
        if query_understanding.intent == "direct_answer_request":
            return "I will not give the complete answer immediately. First tell me what you have tried and which step feels uncertain."
        return "Before I explain, make a quick guess: which Python concept, syntax rule, or runtime result might this question relate to?"

    normalized = message.lower()
    if "不知道" in message or "不懂" in message or "不会" in message:
        return "先别急着要完整答案。请你把已知条件、正在执行的操作、实际结果各写一句，我再帮你定位卡点。"
    if "报错" in message or "error" in normalized or "异常" in message:
        return "先把报错类型、触发报错的那一行、你期望的结果写出来，我们用这三项定位原因。"
    if query_understanding.intent == "direct_answer_request":
        return "我先不直接给完整答案。请你先说出你已经尝试过什么，以及最不确定的一步。"
    return "在我解释之前，请你先猜一下：这个问题可能和哪个 Python 概念、语句或运行结果有关？"


def model_unavailable_prompt(
    *,
    message: str,
    skill_action: dict,
    recent_messages: list[dict],
    fallback_reason: str,
) -> str:
    previous_agent_prompts = [
        str(item.get("content", "")).strip()
        for item in recent_messages
        if item.get("role") in {"agent", "assistant", "teacher"} and str(item.get("content", "")).strip()
    ]
    workflow_prompt = str(skill_action.get("prompt") or "").strip()
    student_is_confused = _student_is_confused(message)
    if (
        workflow_prompt
        and workflow_prompt not in previous_agent_prompts
        and not student_is_confused
        and (_prefers_chinese(message) or not _prefers_chinese(workflow_prompt))
    ):
        return workflow_prompt

    if not _prefers_chinese(message):
        reason_label = "The model service did not return an available response"
        if fallback_reason == "missing_api_key":
            reason_label = "The model service did not receive a DashScope key"
        return (
            f"{reason_label}, so I will not repeat the previous answer as if the conversation were normal. "
            "To continue debugging, please provide one observable fact: the exact error text, the runtime output, or the line that triggers the issue."
        )

    reason_label = "模型服务没有返回可用回复"
    if fallback_reason == "missing_api_key":
        reason_label = "模型服务没有拿到 DashScope key"
    return (
        f"{reason_label}，我不会重复上一句来假装正常对话。"
        "为了继续定位，请直接补充一个可观察事实：实际报错原文、运行输出，或触发问题的那一行。"
    )


def build_teaching_messages(
    message: str,
    query_understanding: QueryUnderstandingResult,
    kg_result: dict,
    rag_sources: list[dict],
    allow_direct_answer: bool,
    baseline_mode: str,
    recent_messages: list[dict],
    task_state: dict,
    last_evidence: dict,
    learner_memory: list[dict],
    memory_context: dict,
    skill_action: dict,
) -> list[dict[str, str]]:
    compact_task_state = _compact_task_state(task_state)
    compact_last_evidence = _compact_last_evidence(last_evidence)
    compact_memory_context = _compact_memory_context(memory_context)
    compact_skill_action = _compact_skill_action(skill_action)
    compact_sources = [
        {
            "title": source.get("title"),
            "chunk_id": source.get("chunk_id"),
            "url": source.get("source_url"),
            "text": _short_context_text(source.get("text") or "", MAX_RAG_SOURCE_TEXT_CHARS),
        }
        for source in rag_sources[:2]
    ]
    compact_messages = [
        {
            "role": item.get("role"),
            "content": _short_context_text(item.get("content", ""), 240),
        }
        for item in recent_messages[-6:]
    ]
    compact_memory = [
        {
            "memory_id": item.get("memory_id"),
            "memory_type": item.get("memory_type"),
            "topic": item.get("topic"),
            "content": _short_context_text(item.get("content", ""), 240),
        }
        for item in learner_memory[:5]
    ]
    last_agent_prompt = next(
        (
            _short_context_text(item.get("content", ""), 240)
            for item in reversed(recent_messages)
            if item.get("role") in {"agent", "assistant", "teacher"} and item.get("content")
        ),
        "",
    )
    direct_answer_instruction = (
        "This is a paid direct-answer turn. Return one answer-only response. "
        "Start exactly with 'Direct answer:' for English or '直接答案：' for Chinese. "
        "Answer the current Python question, then give only concise supporting explanation. "
        "Do not ask any question, request confidence, request teach-back, propose an exercise, "
        "or introduce an unrelated concept. This instruction overrides every teaching-question instruction."
        if allow_direct_answer
        else "This is guided tutoring. Follow the workflow teaching action."
    )
    return [
        {"role": "system", "content": TEACHING_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"student_message: {message}\n"
                f"response_language: {_response_language(message)}\n"
                f"baseline_mode: {baseline_mode}\n"
                f"intent: {query_understanding.intent}\n"
                f"rewritten_query: {query_understanding.retrieval_query}\n"
                f"allow_direct_answer: {str(allow_direct_answer).lower()}\n"
                f"kg_topic: {kg_result.get('topic_label') or kg_result.get('topic_id')}\n"
                f"selected_focus_node: {kg_result.get('requested_focus_node_id')}\n"
                f"selected_kg_nodes: {kg_result.get('selected_node_ids') or []}\n"
                f"kg_gap: {kg_result.get('kg_gap')}\n"
                f"kg_path: {' -> '.join(kg_result.get('path', []))}\n"
                f"rag_sources: {compact_sources}\n"
                f"recent_messages: {compact_messages}\n"
                f"task_state: {compact_task_state}\n"
                f"last_evidence: {compact_last_evidence}\n"
                f"learner_memory: {compact_memory}\n"
                f"memory_context: {compact_memory_context}\n"
                f"skill_action/workflow: {compact_skill_action}\n"
                f"last_agent_prompt_do_not_repeat: {last_agent_prompt}\n"
                "You must reply in response_language. If response_language is English, all natural-language output must be English. "
                "If response_language is Chinese, reply in Chinese. "
                "When selected_focus_node is present, answer the learner's message about that selected Python concept; "
                "do not discard it because the message is referential, brief, casual, or mentions another topic. "
                f"direct_answer_output_contract: {direct_answer_instruction}\n"
                "请生成下一句教学回复。必须服从 skill_action/workflow；如果 workflow 不允许直接答案，不要给完整答案。"
                "必须针对 student_message 和 recent_messages 自然回应，不能重复 last_agent_prompt_do_not_repeat。"
            ),
        },
    ]


def _short_context_text(value: object, limit: int = MAX_CONTEXT_TEXT_CHARS) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    if len(text) <= limit:
        return text
    return f"[omitted {len(text)} chars]"


def _limited_list(values: object, limit: int = MAX_CONTEXT_ITEMS) -> list:
    if not isinstance(values, list):
        return []
    return values[:limit]


def _clean_dict(values: dict) -> dict:
    return {key: value for key, value in values.items() if value not in (None, "", [], {})}


def _nested_dict(container: dict, key: str) -> dict:
    value = container.get(key)
    return value if isinstance(value, dict) else {}


def _first_present(*values):
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _compact_task_state(task_state: dict) -> dict:
    if not isinstance(task_state, dict):
        return {}
    keys = (
        "scenario",
        "topic",
        "current_concept",
        "workflow_state",
        "active_gate_id",
        "primary_skill_id",
        "hint_level",
        "next_required_action",
        "confidence_before_required",
        "confidence_after_required",
        "teach_back_required",
        "last_intent",
        "last_rewritten_query",
    )
    compact = {key: task_state.get(key) for key in keys if key in task_state}
    if isinstance(task_state.get("query_concepts"), list):
        compact["query_concepts"] = _limited_list(task_state["query_concepts"])
    if isinstance(task_state.get("last_rag_chunk_ids"), list):
        compact["last_rag_chunk_ids"] = _limited_list(task_state["last_rag_chunk_ids"], 5)
    return _clean_dict(compact)


def _compact_last_evidence(last_evidence: dict) -> dict:
    if not isinstance(last_evidence, dict):
        return {}
    evidence = _nested_dict(last_evidence, "evidence")
    skill_state = _first_present(
        _nested_dict(last_evidence, "pedagogical_workflow"),
        _nested_dict(last_evidence, "skill_state"),
        _nested_dict(last_evidence, "workflow"),
        _nested_dict(evidence, "pedagogical_workflow"),
        _nested_dict(evidence, "skill_state"),
    ) or {}
    kg_path = _first_present(last_evidence.get("kg_path"), evidence.get("kg_path"), last_evidence.get("path"))
    rag_sources = last_evidence.get("rag_sources")
    if not isinstance(rag_sources, list):
        rag_sources = evidence.get("rag_sources") if isinstance(evidence.get("rag_sources"), list) else []
    compact_sources = [
        {
            "chunk_id": source.get("chunk_id"),
            "title": source.get("title"),
            "url": source.get("source_url") or source.get("url"),
            "score": source.get("score"),
        }
        for source in rag_sources[:3]
        if isinstance(source, dict)
    ]
    return _clean_dict(
        {
            "confidence_before": _first_present(last_evidence.get("confidence_before"), evidence.get("confidence_before")),
            "confidence_after": _first_present(last_evidence.get("confidence_after"), evidence.get("confidence_after")),
            "state": _first_present(skill_state.get("state"), last_evidence.get("state")),
            "active_gate_id": _first_present(skill_state.get("active_gate_id"), last_evidence.get("active_gate_id")),
            "hint_level": _first_present(skill_state.get("hint_level"), last_evidence.get("hint_level")),
            "next_required_action": _first_present(skill_state.get("next_required_action"), last_evidence.get("next_required_action")),
            "teach_back_required": _first_present(skill_state.get("teach_back_required"), last_evidence.get("teach_back_required")),
            "fallback_reason": _first_present(last_evidence.get("fallback_reason"), evidence.get("fallback_reason")),
            "rag_fallback_reason": _first_present(last_evidence.get("rag_fallback_reason"), evidence.get("rag_fallback_reason")),
            "kg_path": _limited_list(kg_path),
            "rag_sources": compact_sources,
            "last_agent_prompt": _short_context_text(last_evidence.get("prompt") or evidence.get("prompt") or "", 220),
        }
    )


def _compact_memory_context(memory_context: dict) -> dict:
    if not isinstance(memory_context, dict):
        return {}
    rmm = _nested_dict(memory_context, "rmm")
    plan = _nested_dict(rmm, "prospective_memory_plan")
    selected_memory_ids = _first_present(
        memory_context.get("retrieved_memory_ids"),
        plan.get("selected_memory_ids"),
        memory_context.get("selected_memory_ids"),
    )
    topic_summaries = memory_context.get("topic_summaries")
    compact_summaries = []
    if isinstance(topic_summaries, list):
        compact_summaries = [
            {
                "topic": summary.get("topic"),
                "weak_concepts": _limited_list(summary.get("weak_concepts"), 5),
                "mastered_concepts": _limited_list(summary.get("mastered_concepts"), 5),
                "summary": _short_context_text(summary.get("topic_summary") or summary.get("summary"), 180),
            }
            for summary in topic_summaries[:3]
            if isinstance(summary, dict)
        ]
    return _clean_dict(
        {
            "short_term_count": _first_present(
                memory_context.get("short_term_count"),
                len(memory_context.get("short_term_messages", [])) if isinstance(memory_context.get("short_term_messages"), list) else None,
            ),
            "long_term_count": _first_present(
                memory_context.get("long_term_count"),
                len(memory_context.get("long_term_memories", [])) if isinstance(memory_context.get("long_term_memories"), list) else None,
            ),
            "task_state": _compact_task_state(_nested_dict(memory_context, "task_state")),
            "selected_memory_ids": _limited_list(selected_memory_ids),
            "rmm": _clean_dict(
                {
                    "selected_memory_ids": _limited_list(plan.get("selected_memory_ids")),
                    "plan": _short_context_text(
                        plan.get("plan")
                        or plan.get("prospective_plan")
                        or plan.get("reading_plan")
                        or "",
                        260,
                    ),
                }
            ),
            "topic_summaries": compact_summaries,
        }
    )


def _compact_skill_action(skill_action: dict) -> dict:
    if not isinstance(skill_action, dict):
        return {}
    keys = (
        "skill_id",
        "primary_skill_id",
        "active_gate_id",
        "state",
        "prompt_key",
        "hint_level",
        "next_required_action",
        "allow_direct_answer",
        "requires_student_attempt",
        "confidence_before_required",
        "confidence_after_required",
        "teach_back_required",
        "teach_back_score",
    )
    compact = {key: skill_action.get(key) for key in keys if key in skill_action}
    compact["prompt"] = _short_context_text(skill_action.get("prompt") or "", 280)
    workflow_trace = skill_action.get("workflow_trace")
    if isinstance(workflow_trace, list):
        compact["workflow_trace"] = [
            {
                "skill_id": item.get("skill_id"),
                "status": item.get("status"),
            }
            for item in workflow_trace[:8]
            if isinstance(item, dict)
        ]
    return _clean_dict(compact)


def _unavailable_token_usage(model: str = "qwen3.7-max") -> dict:
    return {
        "model": model,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "usage_unavailable": True,
    }


def _chat_with_optional_usage(provider, messages: list[dict[str, str]], *, temperature: float, max_tokens: int) -> tuple[str, dict]:
    if hasattr(provider, "chat_with_usage"):
        response = provider.chat_with_usage(messages, temperature=temperature, max_tokens=max_tokens)
        usage = dict(getattr(response, "usage", {}) or {})
        total_tokens = int(usage.get("total_tokens") or 0)
        return str(getattr(response, "content", "")).strip(), {
            "model": str(getattr(response, "model", None) or getattr(provider, "model", "qwen3.7-max")),
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "total_tokens": total_tokens,
            "usage_unavailable": bool(usage.get("usage_unavailable", total_tokens <= 0)),
        }
    prompt = provider.chat(messages, temperature=temperature, max_tokens=max_tokens)
    return str(prompt).strip(), _unavailable_token_usage(str(getattr(provider, "model", "qwen3.7-max")))


def generate_teaching_response(
    *,
    message: str,
    query_understanding: QueryUnderstandingResult,
    kg_result: dict,
    rag_sources: list[dict],
    stage: str,
    allow_direct_answer: bool,
    baseline_mode: str = "full_memory",
    recent_messages: list[dict] | None = None,
    task_state: dict | None = None,
    last_evidence: dict | None = None,
    learner_memory: list[dict] | None = None,
    memory_context: dict | None = None,
    skill_action: dict | None = None,
) -> dict:
    skill_action = skill_action or {}
    fallback_prompt = _language_compatible_skill_prompt(message, skill_action) or fallback_teaching_prompt(message, query_understanding)
    try:
        provider = DashScopeChatProvider()
        messages = build_teaching_messages(
            message,
            query_understanding,
            kg_result,
            rag_sources,
            allow_direct_answer,
            baseline_mode,
            recent_messages or [],
            task_state or {},
            last_evidence or {},
            learner_memory or [],
            memory_context or {},
            skill_action,
        )
        prompt, token_usage = _chat_with_optional_usage(
            provider,
            messages,
            temperature=0.2,
            max_tokens=300,
        )
        if not _response_matches_language(message, prompt):
            return {
                "prompt": fallback_prompt,
                "teaching_strategy": "retrieve-first-with-evidence",
                "llm_used": True,
                "llm_fallback": True,
                "fallback_reason": "response_language_mismatch",
                "fallback_detail": None,
                "guardrail_reason": None,
                "llm_guardrail_triggered": False,
                "chat_model": provider.model,
                "token_usage": token_usage,
            }
        if allow_direct_answer:
            contract = validate_direct_answer_delivery(message, prompt)
            if not contract["valid"]:
                repaired_prompt = _repair_direct_answer_delivery(
                    provider=provider,
                    messages=messages,
                    blocked_prompt=prompt,
                )
                repaired_contract = validate_direct_answer_delivery(message, repaired_prompt)
                if repaired_contract["valid"]:
                    return {
                        "prompt": repaired_prompt,
                        "teaching_strategy": "retrieve-first-with-evidence",
                        "llm_used": True,
                        "llm_fallback": False,
                        "fallback_reason": None,
                        "fallback_detail": None,
                        "guardrail_reason": "direct_answer_delivered",
                        "llm_guardrail_triggered": True,
                        "chat_model": provider.model,
                        "token_usage": token_usage,
                        "direct_answer_contract": {
                            **repaired_contract,
                            "repair_attempted": True,
                        },
                    }
                return {
                    "prompt": repaired_prompt or prompt,
                    "teaching_strategy": "retrieve-first-with-evidence",
                    "llm_used": True,
                    "llm_fallback": False,
                    "fallback_reason": "direct_answer_not_delivered",
                    "fallback_detail": None,
                    "guardrail_reason": "direct_answer_not_delivered",
                    "llm_guardrail_triggered": True,
                    "chat_model": provider.model,
                    "token_usage": token_usage,
                    "direct_answer_contract": {
                        **repaired_contract,
                        "repair_attempted": True,
                    },
                }
            return {
                "prompt": prompt,
                "teaching_strategy": "retrieve-first-with-evidence",
                "llm_used": True,
                "llm_fallback": False,
                "fallback_reason": None,
                "fallback_detail": None,
                "guardrail_reason": "direct_answer_delivered",
                "llm_guardrail_triggered": False,
                "chat_model": provider.model,
                "token_usage": token_usage,
                "direct_answer_contract": {
                    **contract,
                    "repair_attempted": False,
                },
            }
        if _violates_direct_answer_guardrail(prompt, allow_direct_answer):
            repaired_prompt = _repair_direct_answer_guardrail(
                provider=provider,
                messages=messages,
                blocked_prompt=prompt,
                fallback_prompt=fallback_prompt,
                allow_direct_answer=allow_direct_answer,
            )
            if repaired_prompt and not _violates_direct_answer_guardrail(repaired_prompt, allow_direct_answer):
                return {
                    "prompt": repaired_prompt,
                    "teaching_strategy": "retrieve-first-with-evidence",
                    "llm_used": True,
                    "llm_fallback": False,
                    "fallback_reason": None,
                    "fallback_detail": None,
                    "guardrail_reason": "direct_answer_repaired",
                    "llm_guardrail_triggered": True,
                    "chat_model": provider.model,
                    "token_usage": token_usage,
                }
            return {
                "prompt": fallback_prompt,
                "teaching_strategy": "retrieve-first-with-evidence",
                "llm_used": True,
                "llm_fallback": True,
                "fallback_reason": "direct_answer_blocked",
                "fallback_detail": None,
                "guardrail_reason": "direct_answer_blocked",
                "llm_guardrail_triggered": True,
                "chat_model": provider.model,
                "token_usage": token_usage,
            }
        return {
            "prompt": prompt,
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "fallback_detail": None,
            "guardrail_reason": None,
            "llm_guardrail_triggered": False,
            "chat_model": provider.model,
            "token_usage": token_usage,
        }
    except DashScopeConfigurationError as exc:
        resilient_fallback = model_unavailable_prompt(
            message=message,
            skill_action=skill_action,
            recent_messages=recent_messages or [],
            fallback_reason="missing_api_key",
        )
        return {
            "prompt": resilient_fallback,
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "missing_api_key",
            "fallback_detail": _safe_provider_error(exc),
            "guardrail_reason": None,
            "llm_guardrail_triggered": False,
            "chat_model": query_understanding.chat_model,
            "token_usage": _unavailable_token_usage(query_understanding.chat_model),
        }
    except DashScopeAPIError as exc:
        resilient_fallback = model_unavailable_prompt(
            message=message,
            skill_action=skill_action,
            recent_messages=recent_messages or [],
            fallback_reason="provider_error",
        )
        return {
            "prompt": resilient_fallback,
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "provider_error",
            "fallback_detail": _safe_provider_error(exc),
            "guardrail_reason": None,
            "llm_guardrail_triggered": False,
            "chat_model": query_understanding.chat_model,
            "token_usage": _unavailable_token_usage(query_understanding.chat_model),
        }


def _repair_direct_answer_guardrail(
    *,
    provider: DashScopeChatProvider,
    messages: list[dict[str, str]],
    blocked_prompt: str,
    fallback_prompt: str,
    allow_direct_answer: bool,
) -> str:
    if allow_direct_answer:
        return blocked_prompt
    repair_messages = [
        *messages,
        {"role": "assistant", "content": blocked_prompt},
        {
            "role": "user",
            "content": (
                "上一句违反了 allow_direct_answer=false：它直接给出了答案、原因、修复方式或完整结论。"
                "请把它改写成一句自然的教学引导：回应学生的具体困惑；不要给最终结论；不要给完整代码；"
                "只提出一个可操作的小问题，引导学生自己判断。"
                f"如果不确定，就用这个 workflow prompt 的语义重写，但不要逐字重复：{fallback_prompt}"
            ),
        },
    ]
    return provider.chat(repair_messages, temperature=0.1, max_tokens=220)


def _repair_direct_answer_delivery(
    *,
    provider: DashScopeChatProvider,
    messages: list[dict[str, str]],
    blocked_prompt: str,
) -> str:
    repair_messages = [
        *messages,
        {"role": "assistant", "content": blocked_prompt},
        {
            "role": "user",
            "content": (
                "The student explicitly requested a direct answer for this turn. "
                "Replace the previous reply with one complete answer-only response. "
                "Start with 'Direct answer:' in English or '直接答案：' in Chinese, "
                "then give a concise explanation. Do not ask any question, request confidence, "
                "request teach-back, or add an exercise."
            ),
        },
    ]
    return provider.chat(repair_messages, temperature=0.1, max_tokens=260)


def _violates_direct_answer_guardrail(prompt: str, allow_direct_answer: bool) -> bool:
    if allow_direct_answer:
        return False
    return _looks_like_direct_answer(prompt)


def _direct_answer_given_after_generation(
    mode: str,
    skill_action: dict,
    prompt: str,
    direct_answer_contract: dict | None = None,
) -> bool:
    if not skill_action.get("allow_direct_answer"):
        return False
    return bool((direct_answer_contract or {}).get("valid"))


def _looks_like_direct_answer(prompt: str) -> bool:
    normalized = _compact_answer_text(prompt)
    if not normalized:
        return False
    explicit_answer_markers = (
        "答案是",
        "完整代码",
        "直接把代码写成",
        "最终代码如下",
        "结论是",
        "正确做法是",
    )
    english_direct_answer_markers = ("direct answer:", "the answer is", "answer:")
    if any(marker in normalized for marker in explicit_answer_markers) or any(
        marker in prompt.lower() for marker in english_direct_answer_markers
    ):
        return True
    coaching_prefixes = ("请你先", "请先", "先把", "先看", "你觉得", "试着", "请写出", "请判断")
    if normalized.startswith(coaching_prefixes) and not any(marker in normalized for marker in explicit_answer_markers):
        return False

    has_step_by_step_solution = (
        ("第一步" in normalized and "第二步" in normalized)
        or ("step1" in normalized and "step2" in normalized)
    ) and any(marker in normalized for marker in ("所以", "因此", "最后", "最终", "then", "therefore"))
    has_replacement_answer = any(marker in normalized for marker in ("改成", "替换为", "删除", "添加", "use", "replace")) and any(
        marker in normalized for marker in ("就可以", "即可", "就能", "will", "then")
    )
    has_code_or_value_claim = bool(
        re.search(r"(```|`[^`]+`|\[[^\]]+\]|\b\w+\([^)]*\)|==|!=|<=|>=|=|->)", prompt)
    ) or bool(re.search(r"\d", prompt))
    has_causal_claim = any(
        marker in normalized
        for marker in ("因为", "所以", "因此", "导致", "原因是", "意味着", "because", "therefore", "so")
    )
    has_result_claim = any(
        marker in normalized
        for marker in ("输出", "结果是", "返回", "报错", "错误", "异常", "prints", "returns", "raises", "error")
    )
    has_conclusive_explanation = (
        any(marker in normalized for marker in ("结论", "最终原因", "根本原因", "正确做法", "theanswer", "thefix"))
        and (has_causal_claim or has_result_claim)
    )
    ends_with_question = prompt.strip().endswith(("?", "？"))
    has_compact_solution_claim = (
        len(normalized) >= 24
        and has_code_or_value_claim
        and (has_causal_claim or has_result_claim)
        and not ends_with_question
    )
    return (
        has_step_by_step_solution
        or has_replacement_answer
        or has_conclusive_explanation
        or has_compact_solution_claim
    )


def _compact_answer_text(prompt: str) -> str:
    return re.sub(r"[\s`，。；：:、,.!?！？;（）()\[\]【】《》<>-]+", "", prompt or "").lower()


def _student_is_confused(message: str) -> bool:
    normalized = (message or "").strip().lower()
    return bool(
        re.search(r"[?？]{2,}", normalized)
        or any(marker in normalized for marker in ("不知道", "不懂", "不会", "没懂", "看不懂", "你在说啥", "什么意思"))
    )


def _safe_provider_error(exc: Exception) -> str:
    detail = str(exc).strip()
    detail = re.sub(r"sk-[A-Za-z0-9._-]+", "sk-***", detail)
    detail = re.sub(r"Bearer\s+[A-Za-z0-9._-]+", "Bearer ***", detail)
    return _short_context_text(detail, 360)


def normalize_baseline_mode(mode: str) -> str:
    return mode if mode in BASELINE_MODES else "full_memory"


def baseline_config(mode: str) -> dict:
    return {
        "use_rag": mode != "no_rag",
        "use_kg": mode in {"rag_kg", "rag_kg_skills", "full_memory"},
        "use_skills": mode in {"rag_kg_skills", "full_memory"},
        "use_memory": mode == "full_memory",
        "skill_id": {
            "no_rag": "baseline/no-rag",
            "rag_only": "baseline/rag-only",
            "rag_kg": "baseline/rag-kg",
            "rag_kg_skills": "student-learning/retrieve-first-gate",
            "full_memory": "student-learning/retrieve-first-gate",
        }[mode],
    }


def empty_kg_result(topic_id: str = "kg_disabled", topic_label: str = "KG disabled") -> dict:
    return {
        "topic_id": topic_id,
        "topic_label": topic_label,
        "source_node_id": None,
        "target_node_id": None,
        "selected_node_ids": [],
        "candidate_nodes": [],
        "path": [],
        "path_edges": [],
        "algorithm": "disabled",
        "method": "disabled",
        "confidence": 0.0,
        "kg_gap": topic_id.startswith("kg_gap:"),
        "explanation": "KG disabled by baseline mode.",
    }


def empty_rag_result(fallback_reason: str | None = None) -> dict:
    return {
        "retrieval_mode": "disabled",
        "kg_guided": False,
        "fallback_reason": fallback_reason,
        "index": {
            "backend": "disabled",
            "embedding_provider": None,
            "embedding_model": None,
            "document_count": 0,
        },
        "reranker": {
            "enabled": False,
            "provider": None,
            "model": None,
            "candidate_count": 0,
        },
        "chunks": [],
    }


def reason_about_target(*args, **kwargs) -> dict:
    """Compatibility shim for older tests; runtime uses KG grounding directly."""
    from app.kg import reason_about_target as kg_reason_about_target

    return kg_reason_about_target(*args, **kwargs)


def normalize_rag_sources(rag_result: dict) -> list[dict]:
    return [
        {
            "chunk_id": chunk["chunk_id"],
            "source_id": chunk.get("source_id"),
            "source": chunk["source"],
            "source_license_note": chunk.get("source_license_note"),
            "text": chunk.get("text", ""),
            "concepts": chunk["concepts"],
            "score": chunk["score"],
            "embedding_score": chunk.get("embedding_score"),
            "rerank_score": chunk.get("rerank_score"),
            "title": chunk["title"],
            "heading_path": chunk["heading_path"],
            "source_url": chunk["source_url"],
        }
        for chunk in rag_result["chunks"]
    ]


def build_memory_updates(
    *,
    message: str,
    agent_message: str,
    query_understanding: QueryUnderstandingResult,
    topic: str,
    kg_path: list[str],
    learner_memory: list[dict],
    learner_id: str,
    session_id: str,
    workflow_evidence: dict | None = None,
) -> list[dict]:
    concepts = _unique(query_understanding.concept_hints + kg_path)
    candidates = extract_memory_candidates(
        learner_id=learner_id,
        session_id=session_id,
        student_message=message,
        agent_message=agent_message,
        topic=topic,
        concepts=concepts,
        workflow_evidence=workflow_evidence,
    )
    if not candidates:
        fallback = fallback_memory_candidate_from_exchange(
            message=message,
            concept_hints=query_understanding.concept_hints,
            topic=topic,
            kg_path=kg_path,
            learner_id=learner_id,
            session_id=session_id,
        )
        candidates = [fallback] if fallback else []
    return decide_memory_operations(candidates, existing_memories=learner_memory)


def fallback_memory_candidate_from_exchange(
    *,
    message: str,
    concept_hints: list[str],
    topic: str,
    kg_path: list[str],
    learner_id: str | None = None,
    session_id: str | None = None,
) -> dict | None:
    concepts = _unique(concept_hints + kg_path)
    if any(marker in message for marker in ("不知道", "不懂", "不会", "没懂", "看不懂", "没思路")):
        candidate = {
            "memory_type": "misconception",
            "topic": topic,
            "concepts": concepts,
            "content": "学生表示不理解当前 Python 主题，需要从已知条件、操作步骤和实际结果继续诊断。",
            "reason": "student_reports_uncertainty",
            "salience": 0.7,
            "confidence": 0.7,
            "source": "deterministic_rule",
            "evidence_span": message,
        }
        if learner_id and learner_id != "unknown":
            candidate["learner_id"] = learner_id
        if session_id and session_id != "unknown":
            candidate["session_id"] = session_id
        return candidate
    return None


def build_next_recent_messages(recent_messages: list[dict], message: str, prompt: str) -> list[dict]:
    next_messages = [
        {"role": str(item.get("role", "")), "content": str(item.get("content", ""))}
        for item in recent_messages
        if item.get("role") and item.get("content")
    ]
    next_messages.extend(
        [
            {"role": "student", "content": message},
            {"role": "agent", "content": prompt},
        ]
    )
    return next_messages[-MAX_SHORT_TERM_MESSAGES:]


def build_next_task_state(
    *,
    task_state: dict,
    topic: str,
    query_understanding: QueryUnderstandingResult,
    kg_path: list[str],
    rag_sources: list[dict],
    skill_state: dict,
    memory_updates: list[dict],
) -> dict:
    query_concepts = _unique(query_understanding.concept_hints + kg_path)
    next_state = dict(task_state)
    next_state.update(
        {
            "topic": topic,
            "last_intent": query_understanding.intent,
            "last_rewritten_query": query_understanding.retrieval_query,
            "query_concepts": query_concepts,
            "current_concept": _current_concept(query_concepts, task_state),
            "workflow_state": skill_state.get("state"),
            "active_gate_id": skill_state.get("active_gate_id"),
            "primary_skill_id": skill_state.get("primary_skill_id"),
            "hint_level": skill_state.get("hint_level"),
            "next_required_action": skill_state.get("next_required_action"),
            "confidence_before_required": skill_state.get("confidence_before_required"),
            "confidence_after_required": skill_state.get("confidence_after_required"),
            "teach_back_required": skill_state.get("teach_back_required"),
            "last_rag_chunk_ids": [source.get("chunk_id") for source in rag_sources[:3]],
            "memory_update_count": len(memory_updates),
        }
    )
    return next_state


def build_session_context(
    *,
    next_recent_messages: list[dict],
    next_task_state: dict,
    memory_used: bool,
    memory_reading_plan: dict | None,
    memory_updates: list[dict],
    topic_summary_update: dict | None,
    learning_facts: list[dict],
) -> dict:
    return {
        "short_term_memory": {
            "policy": "sliding_window",
            "max_messages": MAX_SHORT_TERM_MESSAGES,
            "message_count": len(next_recent_messages),
            "messages": next_recent_messages,
        },
        "mid_term_memory": {
            "policy": "task_state",
            "topic": next_task_state.get("topic"),
            "workflow_state": next_task_state.get("workflow_state"),
            "task_state": next_task_state,
        },
        "long_term_memory": {
            "memory_policy": "mem0_memorybank_rmm_zep" if memory_used else "disabled",
            "selected_memory_ids": (memory_reading_plan or {}).get("selected_memory_ids", []),
            "memory_update_count": len(memory_updates),
            "topic_summary_update": topic_summary_update,
            "learning_fact_count": len(learning_facts),
        },
    }


def _current_concept(query_concepts: list[str], task_state: dict) -> str | None:
    if task_state.get("current_concept"):
        return task_state.get("current_concept")
    return query_concepts[0] if query_concepts else None


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _verified_used_memory_ids(model_payload: dict, selected_ids: list[str]) -> tuple[list[str], str]:
    reported_ids = model_payload.get("used_memory_ids")
    if not isinstance(reported_ids, list):
        return [], "model_did_not_report_usage"

    selected_id_set = set(selected_ids)
    return (
        [memory_id for memory_id in reported_ids if memory_id in selected_id_set],
        "model_reported_used_memory_ids",
    )


def build_memory_reinforcement(memory_reading_plan: dict | None) -> list[dict]:
    if not memory_reading_plan:
        return []
    reinforcements = []
    for memory_id in memory_reading_plan.get("selected_memory_ids", []):
        if memory_id:
            reinforcements.append(
                {
                    "operation": "REINFORCE",
                    "memory_id": memory_id,
                    "use_count_delta": 1,
                    "strength_delta": 1,
                    "reason": "selected_by_rmm_prospective_plan",
                }
            )
    return reinforcements


def select_topic_summary(topic: str, topic_summaries: list[dict]) -> dict | None:
    return next((summary for summary in topic_summaries if summary.get("topic") == topic), None)


def _topic_from_query(query_understanding: QueryUnderstandingResult, message: str) -> str:
    for hint in query_understanding.concept_hints:
        if hint:
            return hint
    digest = hashlib.sha256(message.encode("utf-8")).hexdigest()[:12]
    return f"kg_gap:{digest}"


def _normalize_grounding_result(raw_grounding: dict, query_understanding: QueryUnderstandingResult, message: str) -> dict:
    topic_id = str(raw_grounding.get("topic_id") or _topic_from_query(query_understanding, message))
    topic_label = str(raw_grounding.get("topic_label") or topic_id)
    return {
        **raw_grounding,
        "topic_id": topic_id,
        "topic_label": topic_label,
        "path": list(raw_grounding.get("path") or raw_grounding.get("selected_node_ids") or []),
        "path_edges": list(raw_grounding.get("path_edges") or []),
        "algorithm": raw_grounding.get("algorithm") or raw_grounding.get("method") or "catalog-grounding",
        "kg_gap": bool(raw_grounding.get("kg_gap", False)),
    }


def _contextual_grounding_terms(
    task_state: dict,
    recent_messages: list[dict],
    last_evidence: dict,
) -> list[str]:
    terms: list[str] = []

    if isinstance(task_state, dict):
        terms.extend(_node_ids_from_value(task_state.get("current_concept")))
        terms.extend(_node_ids_from_value(task_state.get("query_concepts")))
        terms.extend(_node_ids_from_value(task_state.get("topic")))
        terms.extend(_node_ids_from_value(task_state.get("last_kg_path")))

    if isinstance(last_evidence, dict):
        evidence = _nested_dict(last_evidence, "evidence")
        kg_grounding = _nested_dict(last_evidence, "kg_grounding") or _nested_dict(evidence, "kg_grounding")
        for value in (
            last_evidence.get("kg_path"),
            evidence.get("kg_path"),
            kg_grounding.get("path"),
            kg_grounding.get("selected_node_ids"),
            last_evidence.get("concept_hints"),
            evidence.get("concept_hints"),
        ):
            terms.extend(_node_ids_from_value(value))

    for item in recent_messages[-4:]:
        role = str(item.get("role", ""))
        content = str(item.get("content", "")).strip()
        if role in {"student", "user"} and content:
            terms.append(_short_context_text(content, 220))
        elif _student_is_confused(content):
            terms.append(_short_context_text(content, 120))

    return _unique(terms)[:MAX_CONTEXT_ITEMS]


def _node_ids_from_value(value: object) -> list[str]:
    if isinstance(value, str):
        return [value] if _looks_like_kg_node_id(value) else []
    if isinstance(value, list):
        node_ids: list[str] = []
        for item in value:
            node_ids.extend(_node_ids_from_value(item))
        return node_ids
    if isinstance(value, dict):
        node_ids: list[str] = []
        for item in value.values():
            node_ids.extend(_node_ids_from_value(item))
        return node_ids
    return []


def _looks_like_kg_node_id(value: str) -> bool:
    text = str(value or "")
    return not text.startswith("kg_gap:") and bool(re.match(r"^[A-Za-z][A-Za-z0-9_-]*:[^\s]+$", text))


def _kg_node_query_label(node_id: str) -> str:
    suffix = str(node_id or "").split(":", 1)[-1]
    return re.sub(r"[_-]+", " ", suffix).strip()


def _trace_node(node_id: str) -> dict:
    node_id = str(node_id or "")
    node_type = node_id.split(":", 1)[0] if ":" in node_id else "Concept"
    return {
        "id": node_id,
        "label": _kg_node_query_label(node_id) or node_id,
        "type": node_type,
    }


def _trace_paths(kg_result: dict) -> list[dict]:
    path = [str(node_id) for node_id in kg_result.get("path") or []]
    if not path:
        return []
    relations: list[str] = []
    for edge in kg_result.get("path_edges") or []:
        if isinstance(edge, dict):
            relations.append(str(edge.get("relation") or edge.get("label") or edge.get("edge_type") or "RELATED_TO"))
        else:
            relations.append("RELATED_TO")
    if len(relations) < max(0, len(path) - 1):
        relations.extend(["RELATED_TO"] * (len(path) - 1 - len(relations)))
    return [
        {
            "nodes": path,
            "relations": relations[: max(0, len(path) - 1)],
            "label": " -> ".join(_kg_node_query_label(node_id) or node_id for node_id in path),
        },
    ]


def _trace_kg_grounding(kg_result: dict, *, catalog: KGCatalog | None = None) -> dict:
    focus_source = str(kg_result.get("focus_source") or "current_question")
    requested_focus_node_id = kg_result.get("requested_focus_node_id")
    if kg_result.get("method") == "onboarding_gate":
        return {
            "selected_node_ids": [],
            "nodes": [],
            "paths": [],
            "upstream": [],
            "current": [],
            "downstream": [],
            "focus_source": focus_source,
            "requested_focus_node_id": requested_focus_node_id,
            "knowledge_path_view": {
                "upstream": [],
                "current": [],
                "downstream": [],
                "edges": [],
                "focus_node_ids": [],
            },
        }

    selected = [str(node_id) for node_id in kg_result.get("selected_node_ids") or []]
    requested_current = str(requested_focus_node_id) if requested_focus_node_id else ""
    topic_current = str(kg_result.get("topic_id") or "")
    current = next(
        (
            [node_id]
            for node_id in (requested_current, topic_current, *selected)
            if _looks_like_kg_node_id(node_id)
        ),
        [],
    )
    catalog = catalog or load_kg_catalog()
    upstream, downstream, edges = _directed_kg_neighborhood(current, catalog)
    node_ids = _unique([*upstream, *current, *downstream])
    curriculum_path = kg_result.get("curriculum_path") if isinstance(kg_result.get("curriculum_path"), dict) else None
    curriculum_node_ids = set()
    if curriculum_path:
        for key in ("upstream", "focus", "downstream"):
            if isinstance(curriculum_path.get(key), list):
                curriculum_node_ids.update(str(node_id) for node_id in curriculum_path[key])
    curriculum_highlighted = bool(current and current[0] in curriculum_node_ids)
    if curriculum_highlighted:
        for edge in edges:
            edge["curriculum_highlighted"] = edge["from"] in curriculum_node_ids and edge["to"] in curriculum_node_ids

    view = {
        "upstream": [_trace_node(node_id) for node_id in upstream],
        "current": [_trace_node(node_id) for node_id in current],
        "downstream": [_trace_node(node_id) for node_id in downstream],
        "edges": edges,
        "focus_node_ids": current,
        "focus_source": focus_source,
        "requested_focus_node_id": requested_focus_node_id,
    }
    if curriculum_highlighted:
        view.update(
            {
                "path_id": curriculum_path.get("path_id"),
                "path_label": curriculum_path.get("path_label"),
                "source_url": curriculum_path.get("source_url"),
            }
        )

    trace = {
        "selected_node_ids": selected,
        "nodes": [_trace_node(node_id) for node_id in node_ids],
        "paths": _trace_paths(kg_result),
        "upstream": upstream,
        "current": current,
        "downstream": downstream,
        "focus_source": focus_source,
        "requested_focus_node_id": requested_focus_node_id,
        "knowledge_path_view": view,
    }
    if curriculum_highlighted:
        trace["curriculum_path"] = curriculum_path
    return trace


def _directed_kg_neighborhood(
    current: list[str],
    catalog: KGCatalog,
    *,
    limit: int = 5,
) -> tuple[list[str], list[str], list[dict]]:
    if not current:
        return [], [], []
    current_id = current[0]
    incoming = [edge for edge in catalog.edges if edge.target == current_id and edge.source != current_id]
    outgoing = [edge for edge in catalog.edges if edge.source == current_id and edge.target != current_id]
    upstream = _unique([edge.source for edge in incoming])[:limit]
    upstream_set = set(upstream)
    downstream = [node_id for node_id in _unique([edge.target for edge in outgoing]) if node_id not in upstream_set][:limit]
    downstream_set = set(downstream)
    edge_payloads: list[dict] = []
    seen_edges: set[tuple[str, str, str]] = set()
    neighborhood_edges = [(edge, "upstream_to_current") for edge in incoming if edge.source in upstream_set]
    neighborhood_edges.extend(
        (edge, "current_to_downstream") for edge in outgoing if edge.target in downstream_set
    )
    for edge, segment in neighborhood_edges:
        key = (edge.source, edge.predicate, edge.target)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        edge_payloads.append(
            {
                "from": edge.source,
                "to": edge.target,
                "type": edge.predicate,
                "relation": edge.predicate,
                "segment": segment,
            }
        )
    return upstream, downstream, edge_payloads


def _trace_rag_evidence(rag_sources: list[dict]) -> list[dict]:
    evidence = []
    for index, source in enumerate(rag_sources, start=1):
        heading_path = source.get("heading_path") or []
        if isinstance(heading_path, list):
            heading = " > ".join(str(item) for item in heading_path)
        else:
            heading = str(heading_path)
        evidence.append(
            {
                "rank": index,
                "title": str(source.get("title") or source.get("chunk_id") or f"Evidence {index}"),
                "source": str(source.get("source") or source.get("source_id") or ""),
                "heading_path": heading,
                "url": str(source.get("source_url") or ""),
                "score": float(source.get("rerank_score") or source.get("score") or 0),
                "snippet": str(source.get("text") or "")[:520],
            },
        )
    return evidence


def build_learning_trace(
    *,
    session_id: str,
    episode_id: int | None,
    message: str,
    query_understanding: QueryUnderstandingResult,
    kg_result: dict,
    rag_sources: list[dict],
    skill_state: dict,
    direct_answer_given: bool,
    teaching_response: dict,
) -> dict:
    return {
        "session_id": session_id,
        "turn_id": str(episode_id or ""),
        "message_id": "",
        "query_understanding": {
            "original_question": message,
            "intent": query_understanding.intent,
            "route": query_understanding.route,
            "rewritten_query": query_understanding.retrieval_query,
            "concept_hints": query_understanding.concept_hints,
        },
        "kg_grounding": _trace_kg_grounding(kg_result),
        "rag_evidence": _trace_rag_evidence(rag_sources),
        "teaching_decision": {
            "skill": str(skill_state.get("primary_skill_id") or skill_state.get("skill_id") or ""),
            "hint_level": int(skill_state.get("hint_level") or 0),
            "direct_answer": bool(direct_answer_given),
        },
        "token_usage": teaching_response.get("token_usage") or _unavailable_token_usage(str(teaching_response.get("chat_model") or "qwen3.7-max")),
        "answer": str(teaching_response.get("prompt") or ""),
    }


def _stream_status(query: str, kg: str, rag: str, response: str) -> dict:
    return {
        "query_understanding": query,
        "kg_grounding": kg,
        "rag_evidence": rag,
        "guided_response": response,
    }


def _stream_event(event_type: str, *, session_id: str, episode_id: int | None, **payload: Any) -> dict:
    return {
        "type": event_type,
        "session_id": session_id,
        "turn_id": str(episode_id or ""),
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
        **payload,
    }


def ground_resolved_turn(
    resolution: TurnResolution,
    understanding: QueryUnderstandingResult,
    *,
    historical_concept_ids: list[str] | None = None,
) -> dict:
    return _ground_resolved_turn(
        resolution,
        understanding,
        historical_concept_ids=historical_concept_ids,
        grounder=ground_question,
    )


def _understand_after_resolution(resolution: TurnResolution) -> QueryUnderstandingResult:
    # Existing integrations patch ``understand_query``; retain that seam while the
    # production path uses the authority-safe resolved-question API.
    if understand_query is not _DEFAULT_UNDERSTAND_QUERY:
        return understand_query(resolution.resolved_question)
    return understand_resolved_question(
        resolution.resolved_question,
        resolution.resolved_intent,
    )


def _event_timestamp(
    *,
    session_id: str,
    client_turn_id: str,
    starting_sequence: int,
) -> str:
    seed = f"{session_id}\0{client_turn_id}\0{starting_sequence}".encode("utf-8")
    microseconds = int.from_bytes(hashlib.sha256(seed).digest()[:8], "big") % 1_000_000
    instant = datetime.datetime(2020, 1, 1, tzinfo=datetime.UTC) + datetime.timedelta(
        seconds=starting_sequence,
        microseconds=microseconds,
    )
    return instant.isoformat().replace("+00:00", "Z")


def _bounded_topic_summary(
    resolution: TurnResolution,
    understanding: QueryUnderstandingResult,
    kg_result: dict,
    next_required_action: str | None,
) -> str:
    topic_label = str(
        kg_result.get("topic_label")
        or resolution.selected_node.label
        or (understanding.concept_hints[0] if understanding.concept_hints else "")
        or "Python"
    )
    chinese = bool(re.search(r"[\u4e00-\u9fff]", resolution.resolved_question))
    question = " ".join(
        re.sub(r"[.!?。！？]+", " ", resolution.resolved_question).split()
    )
    action = str(next_required_action or ("等待下一步" if chinese else "await next step"))
    topic_label = " ".join(re.sub(r"[.!?。！？]+", " ", topic_label).split())
    topic_label = topic_label or ("Python 主题" if chinese else "Python topic")
    question = question or ("当前未决问题" if chinese else "current unresolved question")

    if chinese:
        prefixes = ("学习：", "。未决问题：", "。下一步：", "。")
    else:
        prefixes = ("Learning: ", ". Unresolved: ", ". Next: ", ".")
    fixed_length = sum(len(part) for part in prefixes) + len(action)
    available = 240 - fixed_length
    if available < 2:
        raise ValueError("next_required_action is too long for the 240-character topic summary")
    label_budget = min(72, max(1, available // 3))
    question_budget = available - label_budget

    def compact(value: str, budget: int) -> str:
        if len(value) <= budget:
            return value
        if budget == 1:
            return "…"
        return value[: budget - 1].rstrip() + "…"

    return "".join(
        (
            prefixes[0],
            compact(topic_label, label_budget),
            prefixes[1],
            compact(question, question_budget),
            prefixes[2],
            action,
            prefixes[3],
        )
    )


def _topic_pedagogy_state(skill_state: dict) -> dict:
    return TopicPedagogyState(
        workflow_state=str(skill_state.get("state") or ""),
        active_gate_id=skill_state.get("active_gate_id"),
        hint_level=int(skill_state.get("hint_level") or 0),
        next_required_action=skill_state.get("next_required_action"),
        confidence_before=_coerce_optional_confidence(skill_state.get("confidence_before")),
        confidence_after=_coerce_optional_confidence(skill_state.get("confidence_after")),
        teach_back_required=bool(skill_state.get("teach_back_required")),
    ).model_dump(mode="json")


def _coerce_optional_confidence(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric > 1:
            numeric /= 5
        return max(0.0, min(1.0, numeric))
    return None


def _new_topic_frame(
    resolution: TurnResolution,
    understanding: QueryUnderstandingResult,
    kg_result: dict,
    *,
    created_at: str,
) -> dict:
    authoritative_topic_id, authoritative_topic_label = _initialized_topic_identity(
        resolution,
        understanding,
    )
    canonical_topic = str(
        authoritative_topic_id
        or kg_result.get("topic_id")
        or (understanding.concept_hints[0] if understanding.concept_hints else "")
        or resolution.selected_node.node_id
        or resolution.target_topic_id
    )
    topic_label = str(
        authoritative_topic_label
        or kg_result.get("topic_label")
        or resolution.selected_node.label
        or canonical_topic.partition(":")[2]
        or canonical_topic
    )
    return TopicFrame(
        topic_id=str(resolution.active_topic_after),
        canonical_topic=canonical_topic,
        topic_label=topic_label,
        aliases=list(dict.fromkeys([topic_label, canonical_topic.partition(":")[2]])),
        status="active",
        summary="",
        unresolved_question=resolution.resolved_question,
        turn_ids=[],
        active_kg_focus_node_id=(
            resolution.selected_node.node_id
            if resolution.selected_node.usage == "used"
            else canonical_topic if canonical_topic.startswith(("Concept:", "ErrorType:", "Misconception:")) else None
        ),
        last_kg_path=[],
        last_rag_chunk_ids=[],
        pedagogy_state=TopicPedagogyState(),
        created_at=created_at,
        last_active_at=created_at,
    ).model_dump(mode="json")


def _initialized_topic_identity(
    resolution: TurnResolution,
    understanding: QueryUnderstandingResult,
) -> tuple[str | None, str | None]:
    if resolution.workflow_action != "initialize":
        return None, None
    if resolution.selected_node.usage == "used" and resolution.selected_node.node_id:
        return resolution.selected_node.node_id, resolution.selected_node.label
    transition = resolution.topic_transition
    if transition is None:
        return None, None
    label = transition.to_label.strip()
    normalized_label = re.sub(r"[\s-]+", "_", label.lower())
    for hint in understanding.concept_hints:
        hint_text = str(hint).strip()
        namespace, separator, namespaced_value = hint_text.partition(":")
        suffix = namespaced_value if separator else hint_text
        normalized_suffix = re.sub(r"[\s-]+", "_", suffix.lower())
        if normalized_suffix == normalized_label and namespace in {"Concept", "ErrorType"}:
            return hint_text, label
    prefix = "ErrorType" if label.endswith("Error") else "Concept"
    return f"{prefix}:{normalized_label}", label


def build_completed_turn_events(
    *,
    session_id: str,
    client_turn_id: str,
    projection: ConversationProjection,
    resolution: TurnResolution,
    requested_focus_node_id: str | None,
    understanding: QueryUnderstandingResult,
    kg_result: dict,
    rag_sources: list[dict],
    skill_state: dict | None,
    answer: str,
) -> list[ConversationEvent]:
    """Build one complete, ordered event batch for projection replay."""

    payloads: list[tuple[str, dict[str, Any]]] = [
        ("user_message_received", {"message": resolution.original_message}),
    ]
    if requested_focus_node_id is not None:
        payloads.append(
            (
                "kg_node_selected",
                {
                    "node_id": requested_focus_node_id,
                    "usage": resolution.selected_node.usage,
                    "reason": resolution.selected_node.reason,
                },
            )
        )
    payloads.append(("turn_resolved", {"resolution": resolution.model_dump(mode="json")}))

    topic_id = resolution.active_topic_after
    timestamp = _event_timestamp(
        session_id=session_id,
        client_turn_id=client_turn_id,
        starting_sequence=projection.last_sequence,
    )
    if resolution.workflow_action == "initialize" and topic_id is not None:
        if resolution.active_topic_before is not None:
            payloads.append(
                (
                    "topic_suspended",
                    {
                        "topic_id": resolution.active_topic_before,
                        "last_active_at": timestamp,
                    },
                )
            )
        payloads.append(
            (
                "topic_created",
                {
                    "topic": _new_topic_frame(
                        resolution,
                        understanding,
                        kg_result,
                        created_at=timestamp,
                    )
                },
            )
        )
    elif resolution.workflow_action == "restore" and topic_id is not None:
        if resolution.active_topic_before is not None and resolution.active_topic_before != topic_id:
            payloads.append(
                (
                    "topic_suspended",
                    {
                        "topic_id": resolution.active_topic_before,
                        "last_active_at": timestamp,
                    },
                )
            )
        payloads.append(
            (
                "topic_resumed",
                {
                    "topic_id": topic_id,
                    "navigation": (
                        "back"
                        if resolution.conversation_relation == "resume_previous"
                        else "named"
                    ),
                    "last_active_at": timestamp,
                },
            )
        )

    if resolution.workflow_action in {"initialize", "continue"} and topic_id is not None:
        payloads.append(
            (
                "retrieval_completed",
                {
                    "topic_id": topic_id,
                    "last_kg_path": list(kg_result.get("path") or []),
                    "last_rag_chunk_ids": [
                        str(source.get("chunk_id"))
                        for source in rag_sources
                        if source.get("chunk_id")
                    ][:3],
                    "active_kg_focus_node_id": (
                        resolution.selected_node.node_id
                        if resolution.selected_node.usage == "used"
                        else kg_result.get("topic_id")
                    ),
                },
            )
        )
        if resolution.conversation_relation != "clarify_current":
            payloads.append(
                (
                    "pedagogy_advanced",
                    {
                        "topic_id": topic_id,
                        "pedagogy_state": _topic_pedagogy_state(skill_state or {}),
                    },
                )
            )

    committed_payload: dict[str, Any] = {
        "topic_id": (
            topic_id
            if resolution.workflow_action != "preserve_without_advance"
            else None
        ),
        "answer": answer,
    }
    if topic_id is not None and resolution.workflow_action != "preserve_without_advance":
        committed_payload["turn_id"] = client_turn_id
        committed_payload["last_active_at"] = timestamp
    if topic_id is not None and resolution.workflow_action in {"initialize", "continue"}:
        committed_payload["unresolved_question"] = resolution.resolved_question
        committed_payload["summary"] = _bounded_topic_summary(
            resolution,
            understanding,
            kg_result,
            (skill_state or {}).get("next_required_action"),
        )
    payloads.append(("assistant_response_committed", committed_payload))

    events: list[ConversationEvent] = []
    for ordinal, (event_type, payload) in enumerate(payloads, start=1):
        events.append(
            ConversationEvent(
                event_id=str(uuid.uuid4()),
                session_id=session_id,
                client_turn_id=client_turn_id,
                ordinal=ordinal,
                sequence=projection.last_sequence + ordinal,
                event_type=event_type,
                payload=payload,
                created_at=timestamp,
            )
        )
    return events


def _compatibility_task_state(projection: ConversationProjection) -> dict:
    if projection.active_topic_id is None:
        return {}
    frame = projection.topics.get(projection.active_topic_id)
    if frame is None:
        return {}
    pedagogy = frame.pedagogy_state.model_dump(mode="json")
    return _clean_dict(
        {
            "topic": frame.canonical_topic,
            "current_concept": frame.active_kg_focus_node_id or frame.canonical_topic,
            "workflow_state": pedagogy.get("workflow_state"),
            "active_gate_id": pedagogy.get("active_gate_id"),
            "hint_level": pedagogy.get("hint_level"),
            "next_required_action": pedagogy.get("next_required_action"),
            "confidence_before": pedagogy.get("confidence_before"),
            "confidence_after": pedagogy.get("confidence_after"),
            "teach_back_required": pedagogy.get("teach_back_required"),
            "last_kg_path": list(frame.last_kg_path),
            "last_rag_chunk_ids": list(frame.last_rag_chunk_ids),
        }
    )


def _transition_context_summary(
    projection: ConversationProjection,
    resolution: TurnResolution,
) -> str | None:
    transition = resolution.topic_transition
    if transition is None:
        return None
    topic_id = (
        resolution.active_topic_before
        if transition.kind == "switch"
        else resolution.active_topic_after
    )
    if topic_id is None:
        return None
    frame = projection.topics.get(topic_id)
    if frame is None:
        return None
    summary = frame.summary.strip()
    return summary or None


def _replace_latest_agent_message(response: dict, rendered_prompt: str) -> None:
    next_messages = response.get("next_recent_messages")
    if not isinstance(next_messages, list):
        return
    for item in reversed(next_messages):
        if isinstance(item, dict) and item.get("role") == "agent":
            item["content"] = rendered_prompt
            return


def _finalize_conversation_state(
    response: dict,
    *,
    session_id: str,
    client_turn_id: str,
    projection: ConversationProjection,
    resolution: TurnResolution,
    requested_focus_node_id: str | None,
    understanding: QueryUnderstandingResult,
    kg_result: dict,
    rag_sources: list[dict],
    skill_state: dict | None,
) -> dict:
    structured_answer = StructuredTeachingAnswer(
        answer_body=str(response.get("prompt") or ""),
    )
    context_summary = _transition_context_summary(projection, resolution)
    response_contract = build_response_contract(
        answer=structured_answer,
        resolution=resolution,
        context_summary=context_summary,
    )
    rendered_prompt = render_teaching_response(
        answer_body=structured_answer,
        resolution=resolution,
        context_summary=context_summary,
    )
    response["prompt"] = rendered_prompt
    response["response_contract"] = response_contract
    _replace_latest_agent_message(response, rendered_prompt)
    response.setdefault("evidence", {})["response_contract"] = response_contract
    response.setdefault("learning_trace", {})["response_contract"] = response_contract
    response["learning_trace"]["answer"] = rendered_prompt
    events = build_completed_turn_events(
        session_id=session_id,
        client_turn_id=client_turn_id,
        projection=projection,
        resolution=resolution,
        requested_focus_node_id=requested_focus_node_id,
        understanding=understanding,
        kg_result=kg_result,
        rag_sources=rag_sources,
        skill_state=skill_state,
        answer=rendered_prompt,
    )
    next_projection = apply_events(projection, events)
    event_payload = [event.model_dump(mode="json") for event in events]
    projection_payload = next_projection.model_dump(mode="json")
    resolution_payload = resolution.model_dump(mode="json")
    response["conversation_events"] = event_payload
    response["next_conversation_projection"] = projection_payload
    response["turn_resolution"] = resolution_payload
    response["next_task_state"] = _compatibility_task_state(next_projection)
    response.setdefault("evidence", {})["conversation_events"] = event_payload
    response["evidence"]["next_conversation_projection"] = projection_payload
    response["evidence"]["turn_resolution"] = resolution_payload
    response["evidence"]["next_task_state"] = response["next_task_state"]
    mid_term = response.get("session_context", {}).get("mid_term_memory")
    if isinstance(mid_term, dict):
        mid_term["task_state"] = response["next_task_state"]
        mid_term["topic"] = response["next_task_state"].get("topic")
        mid_term["workflow_state"] = response["next_task_state"].get("workflow_state")
    response.setdefault("learning_trace", {})["turn_resolution"] = resolution_payload
    return response


def _is_onboarding_intent(query_understanding: QueryUnderstandingResult) -> bool:
    return query_understanding.route != "python_learning"


def _onboarding_prompt(message: str, query_understanding: QueryUnderstandingResult) -> str:
    conversation_reply = query_understanding.conversation_reply
    if conversation_reply and _response_matches_language(message, conversation_reply):
        return conversation_reply
    if query_understanding.route == "python_unclear":
        if _prefers_chinese(message):
            return "我还不能确定你想学习哪个 Python 概念。请告诉我一个具体问题、报错信息或代码片段。"
        return "I cannot identify the Python learning target yet. Please share one specific question, error message, or code snippet."
    if query_understanding.route == "off_topic":
        if _prefers_chinese(message):
            return "没问题。如果你有 Python 学习问题，欢迎随时告诉我。"
        return "No problem. If you have a Python learning question, feel free to ask."
    if _prefers_chinese(message):
        return "你好，请告诉我你遇到的 Python 问题、报错信息或代码片段，我会一步步引导你理解。"
    return "Hi. Please describe the Python question, error message, or code snippet you want to work on, and I will guide you step by step."


def _llm_preserved_context_reply(
    *,
    message: str,
    topic_label: str,
    recent_messages: list[dict] | None,
) -> tuple[str, dict] | None:
    """Reply to a non-advancing turn with a context-aware LLM response.

    Returns (reply, token_usage) or None when the LLM is unavailable or the
    language check keeps failing, so the caller can fall back to the static
    preserved-context template.
    """
    history: list[dict[str, str]] = []
    for item in (recent_messages or [])[-6:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if role in {"student", "agent"} and content:
            history.append({"role": "user" if role == "student" else "assistant", "content": content})
    language_name = "中文" if _response_language(message) == "Chinese" else "English"
    system_prompt = (
        "你是一名 Python 编程学习助教，正在和学生围绕一段具体的代码或报错进行学习对话。"
        f"当前对话聚焦的内容是：{topic_label}。"
        "学生刚发来的这条消息不会推进学习进度（可能是对讲解方式的要求、澄清或情绪表达）。"
        f"请用{language_name}、结合上面的最近对话和当前学习内容，直接回应学生的诉求，"
        "2 到 4 句话，口吻自然；必须体现出你记得刚才讨论的具体代码或报错；"
        "禁止说「我们正在学习…」「这条消息不会改变当前学习主题」这类模板句；"
        "不要提及「主题」「知识点」「知识图谱」等内部术语；"
        "如果学生在追问刚才的代码或报错，就围绕那段代码和报错解释，最后自然地把对话接回刚才的内容。"
    )
    messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": message}]
    try:
        provider = DashScopeChatProvider()
        reply, token_usage = _chat_with_optional_usage(provider, messages, temperature=0.3, max_tokens=260)
    except (DashScopeAPIError, DashScopeConfigurationError):
        return None
    if reply and _response_matches_language(message, reply):
        return reply, token_usage
    retry_messages = [
        *messages,
        {"role": "assistant", "content": reply or ""},
        {"role": "user", "content": f"请改用{language_name}重新回答，要求不变。"},
    ]
    try:
        reply, token_usage = _chat_with_optional_usage(provider, retry_messages, temperature=0.2, max_tokens=260)
    except (DashScopeAPIError, DashScopeConfigurationError):
        return None
    if reply and _response_matches_language(message, reply):
        return reply, token_usage
    return None


def _preserved_context_prompt(
    message: str,
    topic_label: str,
    query_understanding: QueryUnderstandingResult,
) -> str:
    """Answer a non-retrieval turn without pretending the active topic disappeared."""
    if _prefers_chinese(message):
        return (
            f"我仍记得我们正在学习 {topic_label}。这条消息不会改变当前学习主题；"
            "如果你是在问刚才的内容，请说出你想进一步了解的部分。"
        )
    if query_understanding.route == "off_topic":
        return (
            f"I still have our current Python topic as {topic_label}. "
            "This side question does not replace it; when you are ready, we can continue from the same point."
        )
    return (
        f"I still have our current Python topic as {topic_label}. "
        "If you mean something from that topic, name the part you want me to explain and we will continue from there."
    )


def _onboarding_session_response(
    *,
    session_id: str,
    episode_id: int | None,
    message: str,
    stage: str,
    baseline_mode: str,
    query_understanding: QueryUnderstandingResult,
    resolution: TurnResolution,
    recent_messages: list[dict] | None = None,
    retained_topic_state: dict | None = None,
    memory_enabled: bool = False,
) -> dict:
    retained_topic_state = retained_topic_state or {}
    retained_frame = retained_topic_state.get("topic_frame") or {}
    retained_task_state = dict(retained_topic_state.get("task_state") or {})
    retained_topic_id = str(retained_frame.get("canonical_topic") or "").strip() or None
    retained_topic_label = str(retained_frame.get("topic_label") or "").strip() or retained_topic_id
    retained_path = list(retained_frame.get("last_kg_path") or [])
    retained_focus_node_id = retained_frame.get("active_kg_focus_node_id") or retained_topic_id
    context_retained = bool(retained_topic_id and resolution.active_topic_after)
    kg_result = empty_kg_result(
        topic_id=retained_topic_id if context_retained else query_understanding.intent,
        topic_label=retained_topic_label if context_retained else query_understanding.intent,
    )
    kg_result["topic_id"] = retained_topic_id if context_retained else None
    kg_result["topic_label"] = (
        retained_topic_label if context_retained else query_understanding.route.replace("_", " ").title()
    )
    kg_result["selected_node_ids"] = [retained_focus_node_id] if context_retained and retained_focus_node_id else []
    kg_result["path"] = retained_path
    kg_result["algorithm"] = "skipped"
    kg_result["method"] = "preserved_context" if context_retained else "onboarding_gate"
    kg_result["explanation"] = (
        "The active Python learning context is retained; this turn does not advance the KG and RAG workflow."
        if context_retained
        else "This message does not enter the Python KG and RAG workflow."
    )
    llm_reply: tuple[str, dict] | None = None
    if context_retained and resolution.ambiguity_reason != "no_previous_topic":
        llm_reply = _llm_preserved_context_reply(
            message=message,
            topic_label=retained_topic_label or retained_topic_id or "当前内容",
            recent_messages=recent_messages,
        )
    if llm_reply is not None:
        prompt_text, prompt_token_usage = llm_reply
        prompt_chat_model = str(prompt_token_usage.get("model") or query_understanding.chat_model)
        prompt_llm_used = True
        prompt_llm_fallback = False
        prompt_fallback_reason = None
    else:
        prompt_text = (
            resolution.resolved_question
            if resolution.ambiguity_reason == "no_previous_topic"
            else _preserved_context_prompt(message, retained_topic_label or retained_topic_id, query_understanding)
            if context_retained
            else _onboarding_prompt(message, query_understanding)
        )
        prompt_chat_model = query_understanding.chat_model
        prompt_llm_used = query_understanding.llm_used
        prompt_llm_fallback = query_understanding.llm_fallback
        prompt_fallback_reason = query_understanding.fallback_reason
        prompt_token_usage = _unavailable_token_usage(query_understanding.chat_model)
    teaching_response = {
        "prompt": prompt_text,
        "chat_model": prompt_chat_model,
        "llm_used": prompt_llm_used,
        "llm_fallback": prompt_llm_fallback,
        "fallback_reason": prompt_fallback_reason,
        "token_usage": prompt_token_usage,
        "teaching_strategy": "onboarding",
    }
    skill_state = {
        "skill_id": "student-learning/retrieve-first-gate",
        "primary_skill_id": "student-learning/retrieve-first-gate",
        "active_gate_id": retained_task_state.get("active_gate_id") if context_retained else "onboarding_gate",
        "hint_level": retained_task_state.get("hint_level", 0) if context_retained else 0,
        "direct_answer_given": False,
    }
    next_recent_messages = build_next_recent_messages(recent_messages or [], message, teaching_response["prompt"])
    next_task_state = retained_task_state if context_retained else {}
    session_context = build_session_context(
        next_recent_messages=next_recent_messages,
        next_task_state=next_task_state,
        memory_used=memory_enabled,
        memory_reading_plan=None,
        memory_updates=[],
        topic_summary_update=None,
        learning_facts=[],
    )
    learning_trace = build_learning_trace(
        session_id=session_id,
        episode_id=episode_id,
        message=message,
        query_understanding=query_understanding,
        kg_result=kg_result,
        rag_sources=[],
        skill_state=skill_state,
        direct_answer_given=False,
        teaching_response=teaching_response,
    )
    return {
        "session_id": session_id,
        "stage": stage,
        "baseline_mode": baseline_mode,
        "skill_id": skill_state["skill_id"],
        "primary_skill_id": skill_state["primary_skill_id"],
        "active_gate_id": skill_state["active_gate_id"],
        "skill_state": skill_state,
        "pedagogical_workflow": skill_state,
        "workflow_trace": [],
        "state": "context_preserved" if context_retained else "onboarding",
        "hint_level": skill_state["hint_level"],
        "next_required_action": (
            retained_task_state.get("next_required_action") or "continue_current_topic"
            if context_retained
            else "ask_python_question"
        ),
        "allow_direct_answer": False,
        "requires_student_attempt": False,
        "direct_answer_given": False,
        "confidence_before_required": False,
        "confidence_after_required": False,
        "teach_back_required": False,
        "teach_back_score": None,
        "teach_back_feedback": "",
        "prompt": teaching_response["prompt"],
        "learning_trace": learning_trace,
        "intent": query_understanding.intent,
        "route": query_understanding.route,
        "rewritten_query": query_understanding.retrieval_query,
        "concept_hints": query_understanding.concept_hints,
        "needs_code": query_understanding.needs_code,
        "risk": query_understanding.risk,
        "chat_model": teaching_response["chat_model"],
        "llm_used": teaching_response["llm_used"],
        "llm_fallback": teaching_response["llm_fallback"],
        "fallback_reason": teaching_response["fallback_reason"],
        "fallback_detail": None,
        "guardrail_reason": None,
        "llm_guardrail_triggered": False,
        "token_usage": teaching_response["token_usage"],
        "teaching_strategy": teaching_response["teaching_strategy"],
        "kg_path": retained_path,
        "kg_path_edges": [],
        "kg_algorithm": kg_result["algorithm"],
        "kg_topic_id": kg_result.get("topic_id"),
        "kg_topic_label": kg_result.get("topic_label"),
        "kg_gap": kg_result.get("kg_gap"),
        "kg_grounding": kg_result,
        "rag_sources": [],
        "rag_retrieval_mode": "skipped",
        "rag_kg_guided": False,
        "rag_fallback_reason": "context_preserved_no_retrieval" if context_retained else "onboarding_gate",
        "rag_index": empty_rag_result()["index"],
        "rag_reranker": empty_rag_result()["reranker"],
        "memory_used": memory_enabled and context_retained,
        "memory_context": session_context if context_retained else {},
        "memory_reading_plan": None,
        "memory_reinforcement": [],
        "retrospective_memory_use": None,
        "memory_updates": [],
        "topic_summary_update": None,
        "learning_facts": [],
        "next_recent_messages": next_recent_messages,
        "next_task_state": next_task_state,
        "session_context": session_context,
        "hint_ladder": [],
        "evidence": {
            "topic": retained_topic_id if context_retained else query_understanding.intent,
            "kg_grounding": kg_result,
            "baseline_mode": baseline_mode,
            "primary_skill_id": skill_state["primary_skill_id"],
            "active_gate_id": skill_state["active_gate_id"],
            "cognitive_gate": "onboarding",
            "student_attempt_required": False,
            "direct_answer_given": False,
            "intent": query_understanding.intent,
            "route": query_understanding.route,
            "rewritten_query": query_understanding.retrieval_query,
            "concept_hints": query_understanding.concept_hints,
            "rag_fallback_reason": "context_preserved_no_retrieval" if context_retained else "onboarding_gate",
            "context_retained": context_retained,
            "retained_topic_id": retained_topic_id if context_retained else None,
            "chat_model": teaching_response["chat_model"],
            "llm_used": teaching_response["llm_used"],
            "llm_fallback": teaching_response["llm_fallback"],
            "fallback_reason": teaching_response["fallback_reason"],
            "token_usage": teaching_response["token_usage"],
            "teaching_strategy": teaching_response["teaching_strategy"],
        },
    }
    return response


def iter_session_step_events(
    session_id: str,
    message: str,
    stage: str,
    client_turn_id: str | None = None,
    conversation_projection: dict[str, Any] | ConversationProjection | None = None,
    learner_id: str | None = None,
    baseline_mode: str = "full_memory",
    recent_messages: list[dict] | None = None,
    task_state: dict | None = None,
    last_evidence: dict | None = None,
    learner_memory: list[dict] | None = None,
    topic_summaries: list[dict] | None = None,
    episode_id: int | None = None,
    requested_focus_node_id: str | None = None,
    token_charge_decision: TokenChargeDecisionResponse | None = None,
) -> Iterator[dict]:
    validate_requested_focus_node_id(requested_focus_node_id)
    yield _stream_event(
        "trace_started",
        session_id=session_id,
        episode_id=episode_id,
        status=_stream_status("running", "waiting", "waiting", "waiting"),
    )

    response = next_session_step(
        session_id=session_id,
        client_turn_id=client_turn_id,
        conversation_projection=conversation_projection,
        message=message,
        stage=stage,
        learner_id=learner_id,
        baseline_mode=baseline_mode,
        recent_messages=recent_messages,
        task_state=task_state,
        last_evidence=last_evidence,
        learner_memory=learner_memory,
        topic_summaries=topic_summaries,
        episode_id=episode_id,
        requested_focus_node_id=requested_focus_node_id,
        token_charge_decision=token_charge_decision,
    )
    learning_trace = response.get("learning_trace", {})
    query_understanding = learning_trace.get("query_understanding", {})
    yield _stream_event(
        "query_understanding_done",
        session_id=session_id,
        episode_id=episode_id,
        query_understanding={
            "original_question": query_understanding.get("original_question", message),
            "intent": query_understanding.get("intent", response.get("intent")),
            "route": query_understanding.get("route"),
            "rewritten_query": query_understanding.get("rewritten_query", response.get("rewritten_query", "")),
            "concept_hints": query_understanding.get("concept_hints", response.get("concept_hints", [])),
        },
        status=_stream_status("finish", "running", "waiting", "waiting"),
    )
    yield _stream_event(
        "kg_grounding_done",
        session_id=session_id,
        episode_id=episode_id,
        kg_grounding=learning_trace.get("kg_grounding", {}),
        status=_stream_status("finish", "finish", "running", "waiting"),
    )
    yield _stream_event(
        "rag_evidence_done",
        session_id=session_id,
        episode_id=episode_id,
        rag_evidence=learning_trace.get("rag_evidence", []),
        status=_stream_status("finish", "finish", "finish", "running"),
    )
    yield _stream_event(
        "guided_response_done",
        session_id=session_id,
        episode_id=episode_id,
        teaching_decision=learning_trace.get("teaching_decision", {}),
        answer=str(response.get("prompt") or ""),
        status=_stream_status("finish", "finish", "finish", "finish"),
    )
    yield _stream_event(
        "trace_completed_payload",
        session_id=session_id,
        episode_id=episode_id,
        response=response,
    )


def _continue_active_topic_for_ai_approved_direct_answer(
    resolution: TurnResolution,
    projection: ConversationProjection,
    direct_answer_entitlement: bool,
) -> TurnResolution:
    """Reuse the active topic when the model approves a direct-answer request."""
    if (
        not direct_answer_entitlement
        or resolution.workflow_action != "preserve_without_advance"
        or not projection.active_topic_id
    ):
        return resolution
    frame = projection.topics.get(projection.active_topic_id)
    if frame is None:
        return resolution
    anchored_question = f"Python {frame.topic_label}: {resolution.original_message}"
    return resolution.model_copy(
        update={
            "resolved_question": anchored_question,
            "resolved_intent": "direct_answer_request",
            "conversation_relation": "continue",
            "active_topic_before": frame.topic_id,
            "active_topic_after": frame.topic_id,
            "target_topic_id": frame.topic_id,
            "workflow_action": "continue",
            "retrieval_query": anchored_question,
            "resolution_confidence": 1.0,
            "ambiguity_reason": None,
        }
    )


def next_session_step(
    session_id: str,
    message: str,
    stage: str,
    client_turn_id: str | None = None,
    conversation_projection: dict[str, Any] | ConversationProjection | None = None,
    learner_id: str | None = None,
    baseline_mode: str = "full_memory",
    recent_messages: list[dict] | None = None,
    task_state: dict | None = None,
    last_evidence: dict | None = None,
    learner_memory: list[dict] | None = None,
    topic_summaries: list[dict] | None = None,
    episode_id: int | None = None,
    requested_focus_node_id: str | None = None,
    token_charge_decision: TokenChargeDecisionResponse | None = None,
) -> dict:
    validate_requested_focus_node_id(requested_focus_node_id)
    canonical_projection = (
        conversation_projection
        if isinstance(conversation_projection, ConversationProjection)
        else ConversationProjection.model_validate(conversation_projection or {})
    )
    effective_client_turn_id = client_turn_id or f"legacy-{uuid.uuid4()}"
    direct_answer_entitlement = bool(
        token_charge_decision and token_charge_decision.chargeable
    )
    resolution = resolve_turn(
        message,
        canonical_projection,
        requested_focus_node_id,
        recent_messages or [],
    )
    resolution = _continue_active_topic_for_ai_approved_direct_answer(
        resolution,
        canonical_projection,
        direct_answer_entitlement,
    )
    topic_state = select_topic_state(resolution, canonical_projection)
    mode = normalize_baseline_mode(baseline_mode)
    config = baseline_config(mode)
    effective_learner_id = learner_id or "anonymous-demo"
    recent_messages = recent_messages or []
    task_state = topic_state.get("task_state") or {}
    last_evidence = topic_state.get("last_evidence") or {}
    workflow_evidence = recover_workflow_evidence(last_evidence)
    learner_memory = learner_memory or []
    topic_summaries = topic_summaries or []
    active_learner_memory = learner_memory if config["use_memory"] else []
    if resolution.workflow_action == "preserve_without_advance":
        query_understanding = QueryUnderstandingResult(
            intent=resolution.resolved_intent,
            raw_message=resolution.resolved_question,
            retrieval_query="",
            concept_hints=[],
            needs_code=False,
            risk="normal",
            llm_used=False,
            llm_fallback=True,
            chat_model="fallback-rules",
            fallback_reason="non_retrieval_intent",
            route=(
                "off_topic"
                if resolution.conversation_relation == "off_topic"
                else "greeting"
                if resolution.conversation_relation == "greeting"
                else "python_unclear"
            ),
        )
        response = _onboarding_session_response(
            session_id=session_id,
            episode_id=episode_id,
            message=message,
            stage=stage,
            baseline_mode=baseline_mode,
            query_understanding=query_understanding,
            resolution=resolution,
            recent_messages=recent_messages,
            retained_topic_state=topic_state,
            memory_enabled=config["use_memory"],
        )
        return _finalize_conversation_state(
            response,
            session_id=session_id,
            client_turn_id=effective_client_turn_id,
            projection=canonical_projection,
            resolution=resolution,
            requested_focus_node_id=requested_focus_node_id,
            understanding=query_understanding,
                kg_result=response.get("kg_grounding") or empty_kg_result(
                    topic_id=resolution.resolved_intent,
                    topic_label=resolution.resolved_intent,
                ),
            rag_sources=[],
            skill_state=None,
        )

    query_understanding = _understand_after_resolution(resolution)
    contextual_terms = []
    if topic_state.get("topic_frame"):
        frame = topic_state["topic_frame"]
        contextual_terms = _unique(
            list(frame.get("last_kg_path") or [])
            + [
                value
                for value in (
                    frame.get("active_kg_focus_node_id"),
                    frame.get("canonical_topic"),
                )
                if value
            ]
        )
    if config["use_kg"] or requested_focus_node_id is not None:
        kg_result = _normalize_grounding_result(
            ground_resolved_turn(
                resolution,
                query_understanding,
                historical_concept_ids=_node_ids_from_value(contextual_terms),
            ),
            query_understanding,
            resolution.resolved_question,
        )
    else:
        initialized_topic_id, initialized_topic_label = _initialized_topic_identity(
            resolution,
            query_understanding,
        )
        topic_id = (
            initialized_topic_id
            or (topic_state.get("topic_frame") or {}).get("canonical_topic")
            or _topic_from_query(query_understanding, resolution.resolved_question)
        )
        kg_result = empty_kg_result(
            topic_id=topic_id,
            topic_label=initialized_topic_label or topic_id,
        )
    topic = str(
        (topic_state.get("topic_frame") or {}).get("canonical_topic")
        or kg_result.get("topic_id")
        or _topic_from_query(query_understanding, resolution.resolved_question)
    )
    rag_concepts = _unique(
        list(kg_result.get("path") or [])
        + list(kg_result.get("selected_node_ids") or [])
        + query_understanding.concept_hints
    ) if config["use_kg"] else []
    rag_fallback_reason = None
    if config["use_rag"]:
        try:
            rag_result = search_chunks(resolution.retrieval_query, concepts=rag_concepts, top_k=3)
        except DashScopeConfigurationError:
            rag_fallback_reason = "missing_api_key"
            rag_result = empty_rag_result(fallback_reason=rag_fallback_reason)
        except DashScopeAPIError:
            rag_fallback_reason = "provider_error"
            rag_result = empty_rag_result(fallback_reason=rag_fallback_reason)
    else:
        rag_result = empty_rag_result()
    rag_sources = normalize_rag_sources(rag_result)
    query_concepts = _unique(query_understanding.concept_hints + kg_result["path"])
    reading_plan_input = {
        "topic": topic,
        "query": query_understanding.retrieval_query,
        "query_concepts": query_concepts,
        "stage": stage,
        "baseline_mode": mode,
    }
    memory_reading_plan = (
        build_prospective_memory_plan(
            topic=topic,
            query_concepts=query_concepts,
            learner_memory=active_learner_memory,
            topic_summaries=topic_summaries,
        )
        if config["use_memory"]
        else None
    )
    selected_learner_memory = (
        memory_reading_plan.get("selected_memories", [])
        if memory_reading_plan
        else []
    )
    selected_memory_ids = (
        memory_reading_plan.get("selected_memory_ids", [])
        if memory_reading_plan
        else []
    )
    task_state_for_memory = {
        **task_state,
        "topic": topic,
        "query_concepts": query_concepts,
    }
    memory_context = build_memory_context(
        recent_messages=recent_messages,
        task_state=task_state_for_memory,
        learner_memory=active_learner_memory,
        retrieved_memory_ids=selected_memory_ids,
        topic_summaries=topic_summaries if config["use_memory"] else None,
        reading_plan=reading_plan_input if config["use_memory"] else None,
    )
    pedagogy_recent_messages = (
        [] if resolution.workflow_action == "initialize" else recent_messages
    )
    skill_action = decide_next_teaching_action(
        skill_id=config["skill_id"],
        message=message,
        stage=stage,
        recent_messages=pedagogy_recent_messages,
        task_state=task_state,
        last_evidence=last_evidence,
    )
    skill_action = apply_direct_answer_entitlement(
        skill_action,
        direct_answer_entitlement,
    )
    allow_direct_answer = bool(skill_action["allow_direct_answer"])
    teaching_response = generate_teaching_response(
        message=message,
        query_understanding=query_understanding,
        kg_result=kg_result,
        rag_sources=rag_sources,
        stage=stage,
        allow_direct_answer=allow_direct_answer,
        baseline_mode=mode,
        recent_messages=recent_messages,
        task_state=task_state,
        last_evidence=last_evidence,
        learner_memory=selected_learner_memory,
        memory_context=memory_context,
        skill_action=skill_action,
    )
    verified_used_memory_ids, memory_use_verification_reason = _verified_used_memory_ids(
        teaching_response,
        selected_memory_ids,
    )
    advances_learning_state = resolution.conversation_relation != "clarify_current"
    memory_updates = (
        build_memory_updates(
            message=message,
            agent_message=teaching_response["prompt"],
            query_understanding=query_understanding,
            topic=topic,
            kg_path=kg_result["path"],
            learner_memory=active_learner_memory,
            learner_id=effective_learner_id,
            session_id=session_id,
            workflow_evidence={
                **workflow_evidence,
                **skill_action,
                "intent": query_understanding.intent,
                "risk": query_understanding.risk,
            },
        )
        if config["use_memory"] and advances_learning_state
        else []
    )
    direct_answer_given = _direct_answer_given_after_generation(
        mode,
        skill_action,
        teaching_response["prompt"],
        teaching_response.get("direct_answer_contract"),
    )
    answered_concept = ""
    answer_scope = ""
    if direct_answer_given:
        answered_concept = str(
            kg_result.get("requested_focus_node_id")
            or (kg_result.get("selected_node_ids") or [topic])[0]
            or topic
        )
        answer_scope = query_understanding.retrieval_query
    skill_state = {
        **skill_action,
        "direct_answer_given": direct_answer_given,
    }
    llm_guardrail_triggered = bool(teaching_response.get("llm_guardrail_triggered"))
    guardrail_reason = teaching_response.get("guardrail_reason")
    memory_reinforcement = (
        build_memory_reinforcement(memory_reading_plan)
        if config["use_memory"] and advances_learning_state
        else []
    )
    memory_retrospective = (
        retrospective_memory_use(
            memory_reading_plan or {"topic": topic, "selected_memory_ids": []},
            verified_used_memory_ids,
            verification_reason=memory_use_verification_reason,
        )
        if config["use_memory"] and advances_learning_state
        else None
    )
    topic_summary_update = (
        build_or_update_topic_summary(
            topic=topic,
            existing_summary=select_topic_summary(topic, topic_summaries),
            memory_updates=memory_updates,
            used_memory_ids=verified_used_memory_ids,
        )
        if config["use_memory"] and advances_learning_state
        else None
    )
    source_episode_id = int(episode_id) if episode_id is not None else max(1, len(recent_messages) + 1)
    learning_facts = (
        generate_learning_facts(
            learner_id=effective_learner_id,
            episode_id=source_episode_id,
            topic=topic,
            memory_updates=memory_updates,
            turn_key=effective_client_turn_id,
        )
        if config["use_memory"] and advances_learning_state and memory_updates
        else []
    )
    next_recent_messages = build_next_recent_messages(recent_messages, message, teaching_response["prompt"])
    next_task_state = build_next_task_state(
        task_state=task_state,
        topic=topic,
        query_understanding=query_understanding,
        kg_path=kg_result["path"],
        rag_sources=rag_sources,
        skill_state=skill_state,
        memory_updates=memory_updates,
    )
    session_context = build_session_context(
        next_recent_messages=next_recent_messages,
        next_task_state=next_task_state,
        memory_used=config["use_memory"],
        memory_reading_plan=memory_reading_plan,
        memory_updates=memory_updates,
        topic_summary_update=topic_summary_update,
        learning_facts=learning_facts,
    )

    public_skill_state = copy.deepcopy(skill_state)
    public_pedagogical_workflow = copy.deepcopy(skill_state)
    public_workflow_trace = copy.deepcopy(skill_state["workflow_trace"])
    evidence_skill_state = copy.deepcopy(skill_state)
    evidence_workflow = copy.deepcopy(skill_state)
    evidence_pedagogical_workflow = copy.deepcopy(skill_state)
    evidence_workflow_trace = copy.deepcopy(skill_state["workflow_trace"])
    cognitive_gate = "retrieval" if config["use_skills"] else "skipped"
    learning_trace = build_learning_trace(
        session_id=session_id,
        episode_id=episode_id,
        message=message,
        query_understanding=query_understanding,
        kg_result=kg_result,
        rag_sources=rag_sources,
        skill_state=skill_state,
        direct_answer_given=direct_answer_given,
        teaching_response=teaching_response,
    )

    response = {
        "session_id": session_id,
        "stage": stage,
        "baseline_mode": mode,
        "skill_id": skill_state["skill_id"],
        "primary_skill_id": skill_state["primary_skill_id"],
        "active_gate_id": skill_state["active_gate_id"],
        "skill_state": public_skill_state,
        "pedagogical_workflow": public_pedagogical_workflow,
        "workflow_trace": public_workflow_trace,
        "state": skill_state["state"],
        "hint_level": skill_state["hint_level"],
        "next_required_action": skill_state["next_required_action"],
        "allow_direct_answer": allow_direct_answer,
        "direct_answer_entitlement": direct_answer_entitlement,
        "requires_student_attempt": skill_state["requires_student_attempt"],
        "direct_answer_given": direct_answer_given,
        "direct_answer_contract": teaching_response.get("direct_answer_contract"),
        "answered_concept": answered_concept,
        "answer_scope": answer_scope,
        "confidence_before_required": skill_state["confidence_before_required"],
        "confidence_after_required": skill_state["confidence_after_required"],
        "teach_back_required": skill_state["teach_back_required"],
        "teach_back_score": skill_state["teach_back_score"],
        "teach_back_feedback": skill_state["teach_back_feedback"],
        "prompt": teaching_response["prompt"],
        "learning_trace": learning_trace,
        "intent": query_understanding.intent,
        "rewritten_query": query_understanding.retrieval_query,
        "concept_hints": query_understanding.concept_hints,
        "needs_code": query_understanding.needs_code,
        "risk": query_understanding.risk,
        "chat_model": teaching_response["chat_model"],
        "llm_used": teaching_response["llm_used"],
        "llm_fallback": teaching_response["llm_fallback"],
        "fallback_reason": teaching_response["fallback_reason"],
        "fallback_detail": teaching_response.get("fallback_detail"),
        "guardrail_reason": guardrail_reason,
        "llm_guardrail_triggered": llm_guardrail_triggered,
        "token_usage": teaching_response.get("token_usage") or _unavailable_token_usage(str(teaching_response.get("chat_model") or "qwen3.7-max")),
        "teaching_strategy": teaching_response["teaching_strategy"],
        "kg_path": kg_result["path"],
        "kg_path_edges": kg_result["path_edges"],
        "kg_algorithm": kg_result["algorithm"],
        "kg_topic_id": kg_result.get("topic_id"),
        "kg_topic_label": kg_result.get("topic_label"),
        "kg_gap": kg_result.get("kg_gap"),
        "kg_grounding": kg_result,
        "rag_sources": rag_sources,
        "rag_retrieval_mode": rag_result["retrieval_mode"],
        "rag_kg_guided": rag_result["kg_guided"],
        "rag_fallback_reason": rag_fallback_reason,
        "rag_index": rag_result["index"],
        "rag_reranker": rag_result["reranker"],
        "memory_used": config["use_memory"],
        "memory_context": memory_context,
        "memory_reading_plan": memory_reading_plan,
        "memory_reinforcement": memory_reinforcement,
        "retrospective_memory_use": memory_retrospective,
        "memory_updates": memory_updates,
        "topic_summary_update": topic_summary_update,
        "learning_facts": learning_facts,
        "next_recent_messages": next_recent_messages,
        "next_task_state": next_task_state,
        "session_context": session_context,
        "hint_ladder": [
            {
                "level": 1,
                "skill_id": "student-learning/progressive-hint-ladder",
                "prompt": "先圈出相关概念或代码片段，再说出你认为的卡点。",
            },
            {
                "level": 2,
                "skill_id": "student-learning/stuck-and-error-diagnosis-coach",
                "prompt": "把已知条件、操作步骤、实际结果分开写，再对照检索证据。",
            },
        ],
        "evidence": {
            "topic": topic,
            "kg_topic_id": kg_result.get("topic_id"),
            "kg_topic_label": kg_result.get("topic_label"),
            "kg_gap": kg_result.get("kg_gap"),
            "kg_grounding": kg_result,
            "baseline_mode": mode,
            "primary_skill_id": skill_state["primary_skill_id"],
            "active_gate_id": skill_state["active_gate_id"],
            "cognitive_gate": cognitive_gate,
            "student_attempt_required": skill_state["requires_student_attempt"],
            "direct_answer_entitlement": direct_answer_entitlement,
            "confidence_before": workflow_evidence.get("confidence_before"),
            "direct_answer_given": direct_answer_given,
            "direct_answer_contract": teaching_response.get("direct_answer_contract"),
            "answered_concept": answered_concept,
            "answer_scope": answer_scope,
            "teach_back": "required" if skill_state["teach_back_required"] else "not_required",
            "skill_state": evidence_skill_state,
            "workflow": evidence_workflow,
            "pedagogical_workflow": evidence_pedagogical_workflow,
            "workflow_trace": evidence_workflow_trace,
            "hint_level": skill_state["hint_level"],
            "next_required_action": skill_state["next_required_action"],
            "confidence_before_required": skill_state["confidence_before_required"],
            "confidence_after_required": skill_state["confidence_after_required"],
            "teach_back_required": skill_state["teach_back_required"],
            "teach_back_score": skill_state["teach_back_score"],
            "memory_used": config["use_memory"],
            "memory_context": memory_context,
            "memory_reading_plan": memory_reading_plan,
            "memory_reinforcement": memory_reinforcement,
            "retrospective_memory_use": memory_retrospective,
            "intent": query_understanding.intent,
            "rewritten_query": query_understanding.retrieval_query,
            "concept_hints": query_understanding.concept_hints,
            "next_recent_messages": next_recent_messages,
            "next_task_state": next_task_state,
            "session_context": session_context,
            "topic_summary_update": topic_summary_update,
            "learning_facts": learning_facts,
            "rag_fallback_reason": rag_fallback_reason,
            "chat_model": teaching_response["chat_model"],
            "llm_used": teaching_response["llm_used"],
            "llm_fallback": teaching_response["llm_fallback"],
            "fallback_reason": teaching_response["fallback_reason"],
            "fallback_detail": teaching_response.get("fallback_detail"),
            "guardrail_reason": guardrail_reason,
            "llm_guardrail_triggered": llm_guardrail_triggered,
            "token_usage": teaching_response.get("token_usage") or _unavailable_token_usage(str(teaching_response.get("chat_model") or "qwen3.7-max")),
            "teaching_strategy": teaching_response["teaching_strategy"],
        },
    }
    event_skill_state = {
        **(topic_state.get("pedagogy_state") or {}),
        **skill_state,
    }
    event_skill_state.setdefault(
        "state", (topic_state.get("pedagogy_state") or {}).get("workflow_state")
    )
    return _finalize_conversation_state(
        response,
        session_id=session_id,
        client_turn_id=effective_client_turn_id,
        projection=canonical_projection,
        resolution=resolution,
        requested_focus_node_id=requested_focus_node_id,
        understanding=query_understanding,
        kg_result=kg_result,
        rag_sources=rag_sources,
        skill_state=event_skill_state,
    )
