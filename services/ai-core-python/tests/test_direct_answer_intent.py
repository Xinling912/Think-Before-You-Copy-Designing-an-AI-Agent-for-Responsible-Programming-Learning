from __future__ import annotations

import pytest

from app.direct_answer_intent import DirectAnswerIntent, resolve_direct_answer_intent
from app.session import validate_direct_answer_delivery


@pytest.mark.parametrize(
    "message",
    [
        "直接给我答案",
        "请直接给我完整答案，不要再提示",
        "别绕了，告诉我这题的解法",
        "不要问我，直接把函数补全",
        "把这段代码写完给我",
        "Give me the answer directly.",
        "Tell me the final solution now.",
        "Stop hinting and solve this exercise for me.",
        "Complete this function for me.",
    ],
)
def test_explicit_direct_requests_are_deterministically_chargeable(message):
    result = resolve_direct_answer_intent(message, [], classifier=None)
    assert result.classification == "explicit_direct"
    assert result.chargeable is True
    assert result.source == "deterministic"


@pytest.mark.parametrize(
    "message, classification",
    [
        ("不要直接给我答案", "negated"),
        ("只给一个提示", "negated"),
        ("“直接给答案”是什么意思？", "meta_or_quoted"),
        ("你会直接给答案吗？", "meta_or_quoted"),
        ("Give me one hint.", "negated"),
        ("Can you give direct answers?", "meta_or_quoted"),
    ],
)
def test_hard_free_requests_override_direct_words(message, classification):
    result = resolve_direct_answer_intent(message, [], classifier=None)
    assert result.classification == classification
    assert result.chargeable is False


def test_contextual_referential_request_requires_positive_classifier():
    recent = [{"role": "student", "content": "这道 Python list 索引题为什么报错？"}]
    positive = lambda *_: DirectAnswerIntent(
        "ambiguous_direct", True, "context_resolved_direct_request", "llm"
    )
    negative = lambda *_: DirectAnswerIntent(
        "ordinary", False, "ordinary_tutoring_request", "llm"
    )

    assert resolve_direct_answer_intent("那就直接说吧", recent, positive).chargeable is True
    assert resolve_direct_answer_intent("那就直接说吧", recent, negative).chargeable is False


def test_direct_delivery_requires_language_marker_and_no_question():
    chinese = validate_direct_answer_delivery(
        "直接给我答案",
        "直接答案：索引 3 越界，因为三个元素只有 0、1、2。",
    )
    english = validate_direct_answer_delivery(
        "Give me the answer directly.",
        "Direct answer: Index 3 is out of range. Why?",
    )

    assert chinese["valid"] is True
    assert chinese["question_free"] is True
    assert english["valid"] is False
    assert english["question_free"] is False
