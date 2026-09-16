from __future__ import annotations

import json
import re
from typing import Any, Protocol

from app.dashscope import DashScopeChatProvider
from app.direct_answer_intent import DirectAnswerIntent, resolve_direct_answer_intent
from app.schemas import (
    TokenChargeDecisionRequest,
    TokenChargeDecisionResponse,
    TokenChargeReasonCode,
)
from app.structured_output import extract_first_balanced_json_object


class ChatProvider(Protocol):
    provider: str
    model: str

    def chat_with_usage(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Any:
        ...


TOKEN_CHARGE_SYSTEM_PROMPT = """You classify whether one learner chat turn consumes the direct-answer token budget.
Return exactly one JSON object and no Markdown, explanation, or additional fields.

Required fields:
- chargeable: boolean
- reason_code: exactly one of direct_solution_request, direct_code_completion_request, context_resolved_direct_request, negated_direct_request, meta_direct_answer_question, ordinary_tutoring_request, casual_or_off_topic
- confidence: number from 0 through 1
- decision_source: exactly "llm"
- model: your model identifier

Charge only an imperative or semantically equivalent request to reveal the completed solution, correct answer, or completed code for a Python learning task while bypassing hints, attempts, or guided reasoning. Recognize the request by meaning rather than exact wording, grammar, or word order. Explanations, examples, hints, debugging help, corrections, conceptual answers, greetings, casual conversation, off-topic conversation, topic navigation, and KG node selection are free.

Context authority rules, in priority order:
1. Interpret the exact current message first.
2. Use recent messages only to resolve an omitted object or pronoun.
3. Never turn a negation, quotation, or meta-question into a chargeable request because history discussed direct answers.
4. Never classify a casual concise-answer request as completion of a Python learning task.
5. KG selection alone never makes a turn chargeable.
"""


_NEGATED_DIRECT_PATTERNS = (
    r"(?:不要|别)(?:再)?(?:给|告诉)(?:我)?(?:完整|正确|最终)?答案",
    r"不要(?:再)?直接(?:给(?:我)?)?(?:完整|正确|最终)?答案",
    r"不要(?:再)?直接(?:告诉)(?:我)?(?:完整|正确|最终)?答案",
    r"别直接(?:给(?:我)?|告诉(?:我)?)(?:完整|正确|最终)?答案",
    r"不需要(?:完整|正确|最终)?答案",
    r"只(?:要|给)(?:我)?(?:一个)?提示",
    r"不要(?:把|将).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)",
    r"别(?:把|将).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)",
    r"(?:不要|别)(?:再)?(?:帮我|替我|为我).{0,8}(?:写完|补全|完成).{0,8}(?:函数|代码)",
    r"(?:不要|别)(?:再)?(?:帮我|替我|为我).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)",
    r"do not (?:just )?give me (?:the )?(?:full |final |correct )?answer",
    r"don['’]t (?:just )?give me (?:the )?(?:full |final |correct )?answer",
    r"do not (?:finish|complete) (?:the|this|my)?\s*(?:function|code)",
    r"don['’]t (?:finish|complete) (?:the|this|my)?\s*(?:function|code)",
    r"no full answer",
    r"hint only",
    r"only (?:give me )?(?:a )?hint",
)

_META_OR_QUOTATION_PATTERNS = (
    r"(?:你|系统|ai).{0,8}(?:会|能|可以).{0,8}(?:直接)?(?:给|告诉)(?:我)?.{0,6}(?:完整|正确|最终)?答案.{0,3}[吗么?？]",
    r"(?:你|系统|ai).{0,8}(?:会|能|可以).{0,8}直接(?:给|告诉).{0,6}答案.{0,3}[吗么?？]",
    r"can (?:you|the system|ai).{0,12}(?:give|provide).{0,12}direct answers?\??",
    r"(?:老师|他|她|别人).{0,8}(?:说|写).{0,4}[“\"']?.{0,8}直接给答案",
    r"[“\"']\s*(?:直接给答案|just give me the (?:final )?answer)\s*[”\"']",
    r"[“\"'].{0,40}(?:答案|函数|代码|answer|function|code).{0,40}[”\"'].{0,12}(?:是什么意思|什么意思|意味着|mean)",
)

_CASUAL_OR_KG_HARD_FREE_PATTERNS = (
    r"直接(?:说|告诉(?:我)?).{0,12}(?:你叫|你的名字|叫什么名字|your name)",
    r"(?:选择|点击|点了|选了).{0,18}(?:kg|知识图谱)?.{0,12}(?:节点|node)",
    r"(?:换成|改成|切换到).{0,12}(?:讲|学习|topic)?",
)

_EXPLICIT_COMPLETION_PATTERNS = (
    r"直接(?:给(?:我)?|告诉(?:我)?|说)(?:这道题的|这个问题的)?(?:完整|正确|最终)?答案",
    r"(?:给|告诉)(?:我)?(?:这道题的|这个问题的)?(?:完整|正确|最终)答案",
    r"(?:这道题的|这个问题的)?(?:完整|正确|最终)?答案.{0,8}(?:给我|告诉我)",
    r"(?:帮我|把|替我).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)",
    r"(?:写完|补全|完成).{0,8}(?:函数|代码).{0,4}(?:给我)?",
    r"just give me (?:the )?(?:full |final |correct )?answer",
    r"give me (?:the )?(?:full |final |correct )?answer",
    r"solve (?:this|the exercise|it) for me",
    r"complete (?:the|this|my)?\s*(?:function|code)(?: for me)?",
    r"finish (?:the|this|my)?\s*(?:function|code)(?: for me)?",
)


def build_token_charge_messages(request: TokenChargeDecisionRequest) -> list[dict[str, str]]:
    payload = request.model_dump(mode="json")
    return [
        {"role": "system", "content": TOKEN_CHARGE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": "Classify this request JSON only:\n" + json.dumps(payload, ensure_ascii=False),
        },
    ]


def deterministic_token_charge_decision(message: str) -> TokenChargeDecisionResponse:
    return _decision_from_intent(resolve_direct_answer_intent(message, [], None))


def decide_token_charge(
    request: TokenChargeDecisionRequest,
    chat_provider: ChatProvider | None = None,
) -> TokenChargeDecisionResponse:
    recent_messages = [item.model_dump(mode="json") for item in request.recent_messages]
    llm_result: list[TokenChargeDecisionResponse] = []

    def classify_ambiguous(_message: str, _recent: list[dict[str, str]]) -> DirectAnswerIntent | None:
        try:
            provider = chat_provider or DashScopeChatProvider()
            response = provider.chat_with_usage(
                build_token_charge_messages(request), temperature=0.0, max_tokens=180
            )
            content = str(getattr(response, "content", "") or "")
            model = str(
                getattr(response, "model", "") or getattr(provider, "model", "") or ""
            ).strip()
            result = TokenChargeDecisionResponse.model_validate(
                extract_first_balanced_json_object(content)
            )
            if (
                not result.chargeable
                or result.decision_source != "llm"
                or result.confidence < 0.80
                or not model
            ):
                return None
            llm_result.append(result.model_copy(update={"model": model}))
            return DirectAnswerIntent(
                "ambiguous_direct", True, "context_resolved_direct_request", "llm"
            )
        except Exception:
            return None

    intent = resolve_direct_answer_intent(
        request.message, recent_messages, classify_ambiguous
    )
    if intent.classification == "ambiguous_direct" and llm_result:
        return llm_result[0]
    return _decision_from_intent(intent)


def _decision_from_intent(intent: DirectAnswerIntent) -> TokenChargeDecisionResponse:
    if intent.chargeable:
        return _fallback(True, "deterministic_direct_request")
    if intent.reason_code in {"negated_direct_request", "meta_direct_answer_question"}:
        return _fallback(False, intent.reason_code)
    return _fallback(False, "deterministic_free_default")


def _matches_any(message: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pattern, message, flags=re.IGNORECASE) for pattern in patterns)


def _deterministic_hard_free_decision(
    message: str,
) -> TokenChargeDecisionResponse | None:
    normalized = " ".join(str(message).casefold().split())
    if _matches_any(normalized, _NEGATED_DIRECT_PATTERNS):
        return _fallback(False, "negated_direct_request")
    if _contains_quoted_completion(normalized):
        return _fallback(False, "meta_direct_answer_question")
    if _matches_any(normalized, _META_OR_QUOTATION_PATTERNS):
        return _fallback(False, "meta_direct_answer_question")
    if (
        _matches_any(normalized, _CASUAL_OR_KG_HARD_FREE_PATTERNS)
        and not _matches_any(normalized, _EXPLICIT_COMPLETION_PATTERNS)
    ):
        return _fallback(False, "deterministic_free_default")
    return None


def _request_hard_free_decision(
    request: TokenChargeDecisionRequest,
) -> TokenChargeDecisionResponse | None:
    message_decision = _deterministic_hard_free_decision(request.message)
    if message_decision is not None:
        return message_decision
    selected_node_id = str(request.selected_node_id or "").strip().casefold()
    current_message = str(request.message).strip().casefold()
    if selected_node_id and current_message == selected_node_id:
        return _fallback(False, "deterministic_free_default")
    return None


def _contains_quoted_completion(message: str) -> bool:
    quoted_segments: list[str] = []
    for pattern in (
        r"“([^”]+)”",
        r'"([^"]+)"',
        r"‘([^’]+)’",
        r"'([^']+)'",
    ):
        quoted_segments.extend(re.findall(pattern, message))
    return any(
        _matches_any(segment, _EXPLICIT_COMPLETION_PATTERNS)
        for segment in quoted_segments
    )


def _fallback(
    chargeable: bool,
    reason_code: TokenChargeReasonCode,
) -> TokenChargeDecisionResponse:
    return TokenChargeDecisionResponse(
        chargeable=chargeable,
        reason_code=reason_code,
        confidence=1.0,
        decision_source="deterministic_fallback",
        model="deterministic-rules",
    )
