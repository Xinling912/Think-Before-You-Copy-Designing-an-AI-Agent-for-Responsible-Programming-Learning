from __future__ import annotations

import pytest


@pytest.mark.parametrize(
    ("message", "expected_signal"),
    [
        ("不要直接给答案，让我自己试", "negated"),
        ("别给完整代码，只给我提示", "negated"),
        ("不要直接给结论，解释 list[4] 为什么报错", "negated"),
        ("Do not give me the final answer; give me a hint", "negated"),
        ("No complete answer, hint only", "negated"),
        ("不要把代码写完给我", "negated"),
        ("Don't complete this function for me", "negated"),
        ("你会直接给答案吗？", "meta_or_quoted"),
        ("老师说“直接给答案”是什么意思？", "meta_or_quoted"),
        ("“把这个函数写完给我”是什么意思？", "meta_or_quoted"),
        (
            "The teacher wrote 'Just give me the final answer'; what does it mean?",
            "meta_or_quoted",
        ),
        ("Can you provide direct answers?", "meta_or_quoted"),
        ("你会帮学生写完代码吗？", "meta_or_quoted"),
        ("Are you able to complete code for students?", "meta_or_quoted"),
        ("请直接给我完整答案，不要再提示", "positive"),
        ("把这个 Python 函数写完给我", "positive"),
        ("不要再提示了，把代码写完给我", "positive"),
        ("不要再提示了把代码写完给我", "positive"),
        ("别解释了，把这个 Python 函数写完给我", "positive"),
        ("帮我写完代码", "positive"),
        ("写完这个 Python 函数给我", "positive"),
        ("Just give me the final answer", "positive"),
        ("为什么 list[4] 报错？", "absent"),
        ("请告诉我代码是什么意思", "absent"),
        ("请展示代码示例", "absent"),
        ("告诉我答案为什么是 4", "absent"),
        ("我已经写完这个 Python 函数，想理解它的复杂度", "absent"),
        ("写完代码后应该怎么测试？", "absent"),
        ("After I complete the code, how should I test it?", "absent"),
        ("When I finish the function, what should I learn next?", "absent"),
    ],
)
def test_classify_direct_answer_teaching_signal(message, expected_signal):
    from app.teaching_intent import classify_direct_answer_teaching_signal

    assert classify_direct_answer_teaching_signal(message) == expected_signal


@pytest.mark.parametrize(
    ("positive_request", "wrapped_message", "expected_signal"),
    [
        ("直接给我完整答案", "不要直接给我完整答案", "negated"),
        (
            "直接给我完整答案",
            "老师说“直接给我完整答案”是什么意思？",
            "meta_or_quoted",
        ),
        ("直接给我完整答案", "你会直接给我完整答案吗？", "meta_or_quoted"),
        (
            "直接给我完整答案",
            "如果你直接给我完整答案，我就学不到了",
            "absent",
        ),
        ("帮我写完代码", "不要帮我把代码写完给我", "negated"),
        ("帮我写完代码", "老师说“帮我写完代码”是什么意思？", "meta_or_quoted"),
        ("帮我写完代码", "你会帮学生写完代码吗？", "meta_or_quoted"),
        (
            "帮我写完代码",
            "如果你帮我写完代码，我就学不到东西了",
            "absent",
        ),
        (
            "Give me the final answer",
            "I don't want you to give me the final answer",
            "negated",
        ),
        (
            "Give me the final answer",
            "The teacher wrote 'Give me the final answer'; what does it mean?",
            "meta_or_quoted",
        ),
        (
            "Give me the final answer",
            "Are you able to give me the final answer?",
            "meta_or_quoted",
        ),
        (
            "Give me the final answer",
            "If you give me the final answer, I will not learn",
            "absent",
        ),
        (
            "Help me complete the code",
            "Don't help me complete the code",
            "negated",
        ),
        (
            "Help me complete the code",
            "The teacher wrote 'Help me complete the code'; what does it mean?",
            "meta_or_quoted",
        ),
        (
            "Help me complete the code",
            "Could the tutor help me complete code?",
            "meta_or_quoted",
        ),
        (
            "Help me complete the code",
            "If you help me complete the code, I will not learn",
            "absent",
        ),
    ],
)
def test_supported_positive_requests_are_overridden_by_semantic_wrappers(
    positive_request,
    wrapped_message,
    expected_signal,
):
    from app.teaching_intent import classify_direct_answer_teaching_signal

    assert classify_direct_answer_teaching_signal(positive_request) == "positive"
    assert classify_direct_answer_teaching_signal(wrapped_message) == expected_signal


@pytest.mark.parametrize(
    ("request_in_antecedent", "request_in_consequent"),
    [
        (
            "如果你直接给我完整答案，我就学不到了",
            "如果你知道答案，就直接给我完整答案",
        ),
        (
            "如果你帮我写完代码，我就学不到东西了",
            "如果可以，把这个 Python 函数写完给我",
        ),
        (
            "If you give me the final answer, I will not learn",
            "If you know the solution, give me the final answer",
        ),
        (
            "If you help me complete the code, I will not learn",
            "If possible, help me complete the code",
        ),
        (
            "When you give me the complete answer, I will not learn",
            "When you are ready, give me the complete answer",
        ),
    ],
)
def test_conditional_wrapper_applies_only_to_antecedent_request_span(
    request_in_antecedent,
    request_in_consequent,
):
    from app.teaching_intent import classify_direct_answer_teaching_signal

    assert classify_direct_answer_teaching_signal(request_in_antecedent) == "absent"
    assert classify_direct_answer_teaching_signal(request_in_consequent) == "positive"
