from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Protocol

from app.dashscope import DashScopeAPIError, DashScopeChatProvider, DashScopeConfigurationError
from app.teaching_intent import classify_direct_answer_teaching_signal


class ChatProvider(Protocol):
    provider: str
    model: str

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        ...


@dataclass(frozen=True)
class QueryUnderstandingResult:
    intent: str
    raw_message: str
    retrieval_query: str
    concept_hints: list[str]
    needs_code: bool
    risk: str
    llm_used: bool
    llm_fallback: bool
    chat_model: str
    fallback_reason: str | None = None
    route: str = "python_learning"
    conversation_reply: str = ""


QUERY_UNDERSTANDING_SYSTEM_PROMPT = """你是 ResponsibleEduAgent 的 Python 学习检索改写器。
你的任务不是回答学生问题，而是把学生原始输入改写成更适合检索 Python 教材语料和知识图谱的查询。
只输出 JSON，不输出 Markdown，不输出解释。
JSON 字段必须是 intent, raw_message, retrieval_query, concept_hints, needs_code, risk。
intent 只能取 error_debugging, concept_question, syntax_question, direct_answer_request, greeting, off_topic, unknown。
concept_hints 可以是模型认为相关的 KG node_id、Python 术语、错误类型或代码符号；不要被固定概念集合限制。
如果学生要求直接给答案或代写，risk 写 direct_answer_dependency。
"""


QUERY_UNDERSTANDING_SYSTEM_PROMPT = """You are the structured intent router for ResponsibleEduAgent, a Python learning tutor.
Return JSON only. Do not include Markdown or explanation.

Required JSON fields: route, intent, raw_message, retrieval_query, concept_hints, needs_code, risk, conversation_reply.
route must be exactly one of greeting, off_topic, python_unclear, python_learning.
- greeting: return a warm short conversation_reply in the student's language that invites a Python learning question.
- off_topic: return a concise, natural, helpful conversation_reply in the student's language. Do not invent real-time facts. End with one light sentence that the tutor can also help with Python when relevant.
- python_unclear: ask one focused clarification in conversation_reply.
- python_learning: set conversation_reply to an empty string and create a retrieval_query plus concept_hints.

intent is a teaching intent for python_learning and must be one of error_debugging, concept_question, syntax_question, direct_answer_request, unknown. For greeting or off_topic, use greeting or off_topic. For python_unclear, use unknown.
concept_hints can include KG node IDs, Python terms, error types, or code symbols. If a student requests a direct answer or code completion, set risk to direct_answer_dependency.
Negated requests for direct answers, quoted direct-answer wording, and capability or meta questions about direct answers are not direct_answer_request.
"""


RESOLVED_QUESTION_SYSTEM_PROMPT = """You are a retrieval-query enricher for a Python learning tutor.
The caller has already resolved the user's conversational intent and question.
Do not reinterpret the intent, choose a topic, or make any conversational decision.
Return JSON only with retrieval_query, concept_hints, needs_code, and risk.
The retrieval query must be based only on the supplied resolved question.
"""


def build_query_understanding_messages(message: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": QUERY_UNDERSTANDING_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "请把下面学生输入改写成检索查询，并返回 JSON。\n"
                f"学生输入：{message}"
            ),
        },
    ]


def build_resolved_question_messages(
    resolved_question: str,
    resolved_intent: str,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": RESOLVED_QUESTION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Resolved intent: {resolved_intent}\n"
                f"Resolved question: {resolved_question}\n"
                "Enrich this question for Python KG and textbook retrieval."
            ),
        },
    ]


def fallback_understanding(
    message: str,
    fallback_reason: str | None = None,
    chat_model: str = "fallback-rules",
) -> QueryUnderstandingResult:
    intent = _infer_intent(message)
    retrieval_query = ""
    concept_hints: list[str] = []
    needs_code = _mentions_code_need(message)
    risk = _risk_for_intent(intent)

    return QueryUnderstandingResult(
        intent=intent,
        raw_message=message,
        retrieval_query=retrieval_query,
        concept_hints=concept_hints,
        needs_code=needs_code,
        risk=risk,
        llm_used=False,
        llm_fallback=True,
        chat_model=chat_model,
        fallback_reason=fallback_reason,
        route="python_unclear",
    )


def _infer_intent(message: str) -> str:
    if _is_greeting(message):
        return "greeting"
    if re.search(r"\b[A-Za-z_][A-Za-z0-9_]*Error\b", message) or any(token in message for token in ["报错", "错误", "异常"]):
        return "error_debugging"
    if classify_direct_answer_teaching_signal(message) == "positive":
        return "direct_answer_request"
    if _mentions_code_need(message):
        return "syntax_question"
    if message.strip():
        return "concept_question"
    return "unknown"


def _risk_for_intent(intent: str) -> str:
    return (
        "direct_answer_dependency"
        if intent == "direct_answer_request"
        else "normal"
    )


def _is_greeting(message: str) -> bool:
    normalized = re.sub(r"[^\w\u4e00-\u9fff]+", " ", message.lower()).strip()
    if not normalized:
        return False
    greeting_phrases = {
        "hello",
        "hi",
        "hey",
        "hello there",
        "what can i say",
        "what should i say",
        "ni hao",
        "你好",
        "您好",
    }
    if normalized in greeting_phrases:
        return True
    return normalized.startswith(("hello ", "hi ", "hey ")) and not _has_python_learning_signal(message)


def _has_python_learning_signal(message: str) -> bool:
    normalized = message.lower()
    python_terms = {
        "python",
        "list",
        "dict",
        "tuple",
        "set",
        "string",
        "index",
        "len",
        "range",
        "for",
        "while",
        "if",
        "else",
        "elif",
        "def",
        "class",
        "return",
        "import",
        "switch",
        "match",
        "error",
        "exception",
        "traceback",
        "syntax",
        "function",
        "variable",
        "loop",
    }
    chinese_terms = ["报错", "错误", "异常", "代码", "列表", "字典", "循环", "函数", "变量", "索引", "参数"]
    if re.search(r"\b[A-Za-z_][A-Za-z0-9_]*Error\b", message):
        return True
    if any(re.search(rf"(?<![A-Za-z0-9_]){re.escape(term)}(?![A-Za-z0-9_])", normalized) for term in python_terms):
        return True
    return any(term in message for term in chinese_terms)


def _mentions_code_need(message: str) -> bool:
    normalized = message.lower()
    return any(token in normalized for token in ["代码", "怎么写", "写法", "syntax", "example", "示例", "用法"])


def _build_generic_retrieval_query(message: str) -> str:
    compact = " ".join(str(message).split())
    if not compact:
        return "Python beginner tutorial concept explanation"
    return f"Python beginner tutorial {compact} official docs examples"


def _extract_candidate_terms(message: str) -> list[str]:
    terms: list[str] = []
    for error_name in re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*Error\b", message):
        terms.append(f"ErrorType:{error_name}")
    for code_name in re.findall(r"`([^`]+)`", message):
        terms.append(f"Term:{_slug(code_name)}")
    for identifier in re.findall(r"[A-Za-z_][A-Za-z0-9_]{1,}", message):
        if identifier.lower() in {"python", "error"}:
            continue
        terms.append(f"Term:{_slug(identifier)}")
    for phrase in re.findall(r"[\u4e00-\u9fff]{2,}", message):
        terms.append(f"Term:{_slug(phrase)}")
    return _unique(terms)[:8]


def _slug(value: str) -> str:
    value = value.strip().lower()
    slug = re.sub(r"[^a-z0-9_\u4e00-\u9fff]+", "_", value)
    return re.sub(r"_+", "_", slug).strip("_") or "unknown"


def extract_json_object(content: str) -> dict:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped).strip()
        stripped = re.sub(r"```$", "", stripped).strip()
    match = re.search(r"\{.*\}", stripped, flags=re.DOTALL)
    if not match:
        raise ValueError("No JSON object found.")
    return json.loads(match.group(0))


def normalize_understanding_payload(message: str, payload: dict, chat_model: str) -> QueryUnderstandingResult:
    fallback = fallback_understanding(message, chat_model=chat_model)
    route = str(payload.get("route") or "").strip()
    if not route and str(payload.get("intent") or "") in {
        "error_debugging",
        "concept_question",
        "syntax_question",
        "direct_answer_request",
    }:
        route = "python_learning"
    if route not in {"greeting", "off_topic", "python_unclear", "python_learning"}:
        route = "python_unclear"
    intent = str(payload.get("intent") or fallback.intent)
    if intent not in {"error_debugging", "concept_question", "syntax_question", "direct_answer_request", "greeting", "off_topic", "unknown"}:
        intent = fallback.intent
    if route == "greeting":
        intent = "greeting"
    elif route == "off_topic":
        intent = "off_topic"
    elif route == "python_unclear":
        intent = "unknown"
    concepts = payload.get("concept_hints")
    if not isinstance(concepts, list):
        concepts = fallback.concept_hints
    concept_hints = _unique([str(concept).strip() for concept in concepts if str(concept).strip()]) or fallback.concept_hints
    retrieval_query = str(payload.get("retrieval_query") or "")
    if route == "python_learning":
        retrieval_query = retrieval_query or _build_generic_retrieval_query(message)
        retrieval_query, concept_hints = enrich_rewrite_with_project_rules(
            message=message,
            intent=intent,
            retrieval_query=retrieval_query,
            concept_hints=concept_hints,
        )
    else:
        retrieval_query = ""
        concept_hints = []

    return QueryUnderstandingResult(
        intent=intent,
        raw_message=str(payload.get("raw_message") or message),
        retrieval_query=retrieval_query,
        concept_hints=concept_hints,
        needs_code=bool(payload.get("needs_code", fallback.needs_code)),
        risk=_risk_for_intent(intent),
        llm_used=True,
        llm_fallback=False,
        chat_model=chat_model,
        route=route,
        conversation_reply=str(payload.get("conversation_reply") or "").strip(),
    )


def enrich_rewrite_with_project_rules(
    *,
    message: str,
    intent: str,
    retrieval_query: str,
    concept_hints: list[str],
) -> tuple[str, list[str]]:
    hints = list(dict.fromkeys(concept_hints))
    query_terms = [retrieval_query.strip() or _build_generic_retrieval_query(message)]
    for term in _extract_candidate_terms(message):
        if term not in hints:
            hints.append(term)
    normalized_message = message.lower()
    keyword_concepts = {
        "list": "Concept:list",
        "index": "Concept:index",
        "len": "Concept:len",
        "range": "Concept:range",
        "for": "Concept:for_loop",
        "while": "Concept:while_loop",
        "if": "Concept:if_statement",
        "function": "Concept:function",
        "parameter": "Concept:parameter",
        "argument": "Concept:argument",
        "nameerror": "ErrorType:NameError",
        "typeerror": "ErrorType:TypeError",
        "syntaxerror": "ErrorType:SyntaxError",
        "indexerror": "ErrorType:IndexError",
    }
    chinese_keyword_concepts = {
        "循环": "Concept:while_loop" if "while" in normalized_message else "Concept:for_loop",
        "列表": "Concept:list",
        "索引": "Concept:index",
        "参数": "Concept:parameter",
        "函数": "Concept:function",
        "赋值": "Concept:assignment",
    }
    for keyword, concept in keyword_concepts.items():
        if re.search(rf"\b{re.escape(keyword)}\b", normalized_message) and concept not in hints:
            hints.insert(0, concept)
    for keyword, concept in chinese_keyword_concepts.items():
        if keyword in message and concept not in hints:
            hints.insert(0, concept)
    normalized_query = query_terms[0].lower()
    if intent == "error_debugging" and not any(token in normalized_query for token in ("debug", "error", "traceback", "exception")):
        query_terms.append("Python debugging traceback exception")
    if intent == "syntax_question" and "syntax" not in query_terms[0].lower():
        query_terms.append("Python syntax examples")
    return " ".join(_unique(query_terms)), hints


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def get_chat_provider() -> ChatProvider:
    return DashScopeChatProvider()


def _fallback_resolved_question(
    resolved_question: str,
    resolved_intent: str,
    *,
    fallback_reason: str,
    chat_model: str = "fallback-rules",
) -> QueryUnderstandingResult:
    non_retrieval_intents = {"greeting", "off_topic", "unknown", "unresolved"}
    retrieval_query = ""
    concept_hints: list[str] = []
    route = (
        "python_unclear"
        if resolved_intent in {"unknown", "unresolved"}
        else resolved_intent
    )
    if resolved_intent not in non_retrieval_intents:
        retrieval_query = _build_generic_retrieval_query(resolved_question)
        retrieval_query, concept_hints = enrich_rewrite_with_project_rules(
            message=resolved_question,
            intent=resolved_intent,
            retrieval_query=retrieval_query,
            concept_hints=[],
        )
        route = "python_learning"
    return QueryUnderstandingResult(
        intent=resolved_intent,
        raw_message=resolved_question,
        retrieval_query=retrieval_query,
        concept_hints=concept_hints,
        needs_code=_mentions_code_need(resolved_question),
        risk=_risk_for_intent(resolved_intent),
        llm_used=False,
        llm_fallback=True,
        chat_model=chat_model,
        fallback_reason=fallback_reason,
        route=route,
    )


def understand_resolved_question(
    resolved_question: str,
    resolved_intent: str,
    chat_provider: ChatProvider | None = None,
    allow_llm: bool = True,
) -> QueryUnderstandingResult:
    """Enrich an already-arbitrated question without conversational authority."""

    if resolved_intent in {"greeting", "off_topic", "unknown", "unresolved"}:
        return _fallback_resolved_question(
            resolved_question,
            resolved_intent,
            fallback_reason="non_retrieval_intent",
        )

    if not allow_llm:
        return _fallback_resolved_question(
            resolved_question,
            resolved_intent,
            fallback_reason="llm_disabled",
        )

    try:
        provider = chat_provider or get_chat_provider()
    except DashScopeConfigurationError:
        return _fallback_resolved_question(
            resolved_question,
            resolved_intent,
            fallback_reason="missing_api_key",
            chat_model="qwen3.7-max",
        )

    try:
        content = provider.chat(
            build_resolved_question_messages(resolved_question, resolved_intent),
            temperature=0.0,
            max_tokens=500,
        )
        payload = extract_json_object(content)
        retrieval_query = str(payload.get("retrieval_query") or "").strip()
        if not retrieval_query:
            raise ValueError("retrieval_query is required")
        concepts = payload.get("concept_hints")
        concept_hints = (
            _unique([str(value).strip() for value in concepts if str(value).strip()])
            if isinstance(concepts, list)
            else []
        )
        retrieval_query, concept_hints = enrich_rewrite_with_project_rules(
            message=resolved_question,
            intent=resolved_intent,
            retrieval_query=retrieval_query,
            concept_hints=concept_hints,
        )
        return QueryUnderstandingResult(
            intent=resolved_intent,
            raw_message=resolved_question,
            retrieval_query=retrieval_query,
            concept_hints=concept_hints,
            needs_code=bool(
                payload.get("needs_code", _mentions_code_need(resolved_question))
            ),
            risk=_risk_for_intent(resolved_intent),
            llm_used=True,
            llm_fallback=False,
            chat_model=provider.model,
            route="python_learning",
        )
    except (DashScopeAPIError, json.JSONDecodeError, ValueError):
        return _fallback_resolved_question(
            resolved_question,
            resolved_intent,
            fallback_reason="invalid_json",
            chat_model=provider.model,
        )


def understand_query(
    message: str,
    chat_provider: ChatProvider | None = None,
    allow_llm: bool = True,
) -> QueryUnderstandingResult:
    if not allow_llm:
        return fallback_understanding(message, fallback_reason="llm_disabled")

    try:
        provider = chat_provider or get_chat_provider()
    except DashScopeConfigurationError as exc:
        return fallback_understanding(message, fallback_reason="missing_api_key", chat_model="qwen3.7-max")

    try:
        content = provider.chat(
            build_query_understanding_messages(message),
            temperature=0.0,
            max_tokens=500,
        )
        payload = extract_json_object(content)
        return normalize_understanding_payload(message, payload, chat_model=provider.model)
    except (DashScopeAPIError, json.JSONDecodeError, ValueError) as exc:
        reason = "invalid_json" if isinstance(exc, (json.JSONDecodeError, ValueError)) else "provider_error"
        return fallback_understanding(message, fallback_reason=reason, chat_model=provider.model)
