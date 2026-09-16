from __future__ import annotations

import json

import pytest

from app.query_understanding import (
    fallback_understanding,
    normalize_understanding_payload,
    understand_resolved_question,
)


class FakeChatProvider:
    provider = "fake"
    model = "fake-rewriter"

    def __init__(self, content: str) -> None:
        self.content = content
        self.calls = 0
        self.messages: list[dict[str, str]] = []

    def chat(self, messages, temperature=None, max_tokens=None):
        self.calls += 1
        self.messages = messages
        return self.content


def test_understand_resolved_question_enriches_without_owning_navigation():
    provider = FakeChatProvider(
        json.dumps(
            {
                "intent": "unknown",
                "raw_message": "RAW OLD HISTORY",
                "retrieval_query": "Python dictionary key lookup and missing keys",
                "concept_hints": ["Concept:dict", "Concept:key"],
                "needs_code": False,
                "risk": "normal",
            }
        )
    )

    result = understand_resolved_question(
        "dictionary 的 key 怎么取？",
        "concept_question",
        chat_provider=provider,
    )

    assert provider.calls == 1
    assert result.intent == "concept_question"
    assert result.raw_message == "dictionary 的 key 怎么取？"
    assert result.retrieval_query == "Python dictionary key lookup and missing keys"
    assert "Concept:dict" in result.concept_hints
    assert "RAW OLD HISTORY" not in result.retrieval_query
    assert "conversation_relation" not in provider.messages[0]["content"]
    assert "selected_node" not in provider.messages[0]["content"]


def test_resolved_question_is_the_only_retrieval_input():
    raw_history = "Earlier we discussed tuple and list internals."
    provider = FakeChatProvider(
        json.dumps(
            {
                "retrieval_query": "Python len function return value",
                "concept_hints": ["Concept:len"],
                "needs_code": False,
                "risk": "normal",
            }
        )
    )

    result = understand_resolved_question(
        "Python 的 len 是什么意思？",
        "concept_question",
        chat_provider=provider,
    )

    user_prompt = provider.messages[1]["content"]
    assert "Python 的 len 是什么意思？" in user_prompt
    assert raw_history not in user_prompt
    assert raw_history not in result.retrieval_query


def test_model_cannot_replace_resolved_question_or_intent():
    provider = FakeChatProvider(
        json.dumps(
            {
                "intent": "unknown",
                "raw_message": "len",
                "retrieval_query": "Python len usage",
                "concept_hints": ["Concept:len"],
                "needs_code": False,
                "risk": "normal",
            }
        )
    )

    result = understand_resolved_question(
        "dictionary 的 key 怎么取？",
        "concept_question",
        chat_provider=provider,
    )

    assert result.intent == "concept_question"
    assert result.raw_message == "dictionary 的 key 怎么取？"


@pytest.mark.parametrize(
    ("resolved_question", "resolved_intent", "model_risk", "expected_risk"),
    [
        (
            "dictionary 的 key 怎么取？",
            "concept_question",
            "direct_answer_dependency",
            "normal",
        ),
        (
            "把这个 Python 函数写完给我",
            "direct_answer_request",
            "normal",
            "direct_answer_dependency",
        ),
    ],
)
def test_model_cannot_replace_resolved_intent_risk(
    resolved_question,
    resolved_intent,
    model_risk,
    expected_risk,
):
    provider = FakeChatProvider(
        json.dumps(
            {
                "retrieval_query": "Python learning query",
                "concept_hints": [],
                "needs_code": False,
                "risk": model_risk,
            }
        )
    )

    result = understand_resolved_question(
        resolved_question,
        resolved_intent,
        chat_provider=provider,
    )

    assert result.risk == expected_risk


@pytest.mark.parametrize(
    ("message", "final_intent", "model_risk", "expected_risk"),
    [
        (
            "请直接给我完整答案",
            "concept_question",
            "direct_answer_dependency",
            "normal",
        ),
        (
            "Python list 怎么用？",
            "direct_answer_request",
            "normal",
            "direct_answer_dependency",
        ),
    ],
)
def test_normalized_payload_derives_risk_from_final_intent(
    message,
    final_intent,
    model_risk,
    expected_risk,
):
    result = normalize_understanding_payload(
        message,
        {
            "route": "python_learning",
            "intent": final_intent,
            "retrieval_query": "Python learning query",
            "concept_hints": [],
            "risk": model_risk,
        },
        chat_model="fake-rewriter",
    )

    assert result.risk == expected_risk


def test_model_disabled_uses_deterministic_resolved_question_rewrite():
    result = understand_resolved_question(
        "为什么 list[4] 报 IndexError？",
        "error_debugging",
        allow_llm=False,
    )

    assert result.intent == "error_debugging"
    assert result.route == "python_learning"
    assert "为什么 list[4] 报 IndexError？" in result.retrieval_query
    assert "ErrorType:IndexError" in result.concept_hints
    assert result.fallback_reason == "llm_disabled"


def test_invalid_rewrite_falls_back_to_resolved_question_only():
    provider = FakeChatProvider("not-json")

    result = understand_resolved_question(
        "dictionary 怎么添加键值对？",
        "concept_question",
        chat_provider=provider,
    )

    assert provider.calls == 1
    assert "dictionary 怎么添加键值对？" in result.retrieval_query
    assert result.llm_fallback is True
    assert result.fallback_reason == "invalid_json"


@pytest.mark.parametrize(
    ("resolved_intent", "expected_route"),
    [
        ("greeting", "greeting"),
        ("off_topic", "off_topic"),
        ("unknown", "python_unclear"),
        ("unresolved", "python_unclear"),
    ],
)
def test_non_retrieval_resolution_skips_successful_provider(
    resolved_intent,
    expected_route,
):
    provider = FakeChatProvider(
        json.dumps(
            {
                "retrieval_query": "Python list poisoned query",
                "concept_hints": ["Concept:list"],
            }
        )
    )

    result = understand_resolved_question(
        "你好" if resolved_intent == "greeting" else "No Python target.",
        resolved_intent,
        chat_provider=provider,
        allow_llm=True,
    )

    assert provider.calls == 0
    assert result.route == expected_route
    assert result.retrieval_query == ""
    assert result.concept_hints == []
    assert result.llm_used is False


@pytest.mark.parametrize(
    ("message", "expected_intent"),
    [
        ("不要直接给答案，让我自己试", "concept_question"),
        ("别给完整代码，只给我提示", "syntax_question"),
        ("不要直接给结论，解释 list[4] 为什么报错", "error_debugging"),
        ("不要帮我把代码写完给我", "syntax_question"),
        ("Don't help me complete the code", "concept_question"),
        ("I don't want you to give me the final answer", "concept_question"),
    ],
)
def test_fallback_understanding_preserves_intent_for_negated_direct_answer_wording(
    message,
    expected_intent,
):
    result = fallback_understanding(message)

    assert result.intent == expected_intent
    assert result.risk == "normal"


@pytest.mark.parametrize(
    "message",
    [
        "你会直接给答案吗？",
        "老师说“直接给答案”是什么意思？",
        "Can you provide direct answers?",
        "The teacher wrote 'Just give me the final answer'; what does it mean?",
        "你会帮学生写完代码吗？",
        "Are you able to complete code for students?",
        "Are you able to give me the final answer?",
        "Could the tutor help me complete code?",
    ],
)
def test_fallback_understanding_does_not_treat_meta_or_quoted_wording_as_request(
    message,
):
    result = fallback_understanding(message)

    assert result.intent != "direct_answer_request"
    assert result.risk == "normal"


@pytest.mark.parametrize(
    "message",
    [
        "把这个 Python 函数写完给我",
        "不要再提示了，把代码写完给我",
        "不要再提示了把代码写完给我",
        "别解释了，把这个 Python 函数写完给我",
        "帮我写完代码",
        "写完这个 Python 函数给我",
    ],
)
def test_fallback_understanding_identifies_positive_completion_request(message):
    result = fallback_understanding(message)

    assert result.intent == "direct_answer_request"
    assert result.risk == "direct_answer_dependency"


@pytest.mark.parametrize(
    "message",
    [
        "如果你知道答案，就直接给我完整答案",
        "如果可以，把这个 Python 函数写完给我",
        "If you know the solution, give me the final answer",
        "If possible, help me complete the code",
        "When you are ready, give me the complete answer",
    ],
)
def test_fallback_understanding_preserves_conditional_consequent_request(message):
    result = fallback_understanding(message)

    assert result.intent == "direct_answer_request"
    assert result.risk == "direct_answer_dependency"


@pytest.mark.parametrize(
    "message",
    [
        "请告诉我代码是什么意思",
        "请展示代码示例",
        "告诉我答案为什么是 4",
        "我已经写完这个 Python 函数，想理解它的复杂度",
        "写完代码后应该怎么测试？",
        "After I complete the code, how should I test it?",
        "When I finish the function, what should I learn next?",
        "如果你直接给我完整答案，我就学不到了",
        "如果你帮我写完代码，我就学不到东西了",
    ],
)
def test_fallback_understanding_does_not_promote_explanation_or_examples(message):
    result = fallback_understanding(message)

    assert result.intent != "direct_answer_request"
    assert result.risk == "normal"
