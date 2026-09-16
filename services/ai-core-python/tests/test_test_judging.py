from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import pytest

from app.dashscope import DashScopeChatResponse
from app.schemas import TestJudgeRequest as JudgeRequestSchema
from app.structured_output import StructuredOutputFailure, StructuredValidationError
from app.test_center import (
    build_judge_messages,
    judge_test_answer,
    validate_test_judgment,
)


class FakeJudgeProvider:
    provider = "dashscope"

    def __init__(self, responses: list[str], usages: list[dict[str, int | bool]] | None = None):
        self.responses = responses
        self.usages = usages or [
            {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5, "usage_unavailable": False}
            for _ in responses
        ]
        self.calls: list[dict[str, Any]] = []

    def chat_with_usage(self, messages, temperature=None, max_tokens=None) -> DashScopeChatResponse:
        index = len(self.calls)
        self.calls.append(
            {
                "messages": deepcopy(messages),
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        return DashScopeChatResponse(
            content=self.responses[index],
            model=f"judge-model-{index + 1}",
            usage=self.usages[index],
        )


def _judge_request() -> JudgeRequestSchema:
    return JudgeRequestSchema(
        topic_id="variables_names_assignment",
        level=1,
        question_format="multiple_choice",
        question_text="What does assigning a value to a variable do?",
        options=["Binds the name", "Deletes it", "Imports code", "Stops Python"],
        expected_answer="It binds the variable name to the value.",
        accepted_equivalents=["The name refers to the value.", "It assigns the value to the name."],
        grading_rubric=["Accept an answer that identifies name-to-value binding.", "Reject unrelated syntax claims."],
        student_answer="It makes the variable refer to the value.",
    )


def _judgment_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "is_correct": True,
        "score": 1.0,
        "reason": "The response correctly describes name-to-value binding.",
        "feedback": "Correct. You identified how assignment binds a name.",
    }
    payload.update(overrides)
    return payload


def test_judge_prompt_contains_all_persisted_private_fields_and_student_answer():
    request = _judge_request()

    prompt = "\n".join(message["content"] for message in build_judge_messages(request))

    for value in (
        request.topic_id,
        request.question_text,
        request.expected_answer,
        *request.options,
        *request.accepted_equivalents,
        *request.grading_rubric,
        request.student_answer,
    ):
        assert value in prompt
    assert f'"level":{request.level}' in prompt
    assert f'"question_format":"{request.question_format}"' in prompt
    assert "Do not reveal the complete expected answer" in prompt
    assert "English feedback" in prompt


@pytest.mark.parametrize(
    "payload",
    [
        _judgment_payload(),
        _judgment_payload(
            is_correct=False,
            score=0.0,
            reason="The response describes deletion instead of assignment.",
            feedback="Review how assignment connects a variable name with a value.",
        ),
    ],
)
def test_judge_returns_correct_and_incorrect_private_results_without_progress(payload):
    provider = FakeJudgeProvider(
        [json.dumps(payload)],
        [{"prompt_tokens": 6, "completion_tokens": 4, "total_tokens": 10, "usage_unavailable": False}],
    )

    response = judge_test_answer(_judge_request(), chat_provider=provider)

    assert response.model_dump(mode="json") == {
        **payload,
        "provider": "dashscope",
        "model": "judge-model-1",
        "token_usage": {
            "prompt_tokens": 6,
            "completion_tokens": 4,
            "total_tokens": 10,
            "usage_unavailable": False,
        },
    }
    assert "progress" not in type(response).model_fields
    assert "increment" not in type(response).model_fields
    assert len(provider.calls) == 1
    assert provider.calls[0]["temperature"] == 0.0


@pytest.mark.parametrize(
    ("judge_request", "field", "leaking_text"),
    [
        (
            _judge_request().model_copy(update={"expected_answer": "42", "accepted_equivalents": []}),
            "feedback",
            "The complete expected answer is 42.",
        ),
        (
            _judge_request(),
            "feedback",
            "Review this: it binds the variable name to the value.",
        ),
        (
            _judge_request(),
            "reason",
            "The accepted response is: the name refers to the value.",
        ),
        (
            _judge_request(),
            "feedback",
            "Remember that it binds the variable name to a value.",
        ),
    ],
)
def test_incorrect_judgment_rejects_embedded_or_substantial_private_answer_leakage(
    judge_request,
    field,
    leaking_text,
):
    payload = _judgment_payload(
        is_correct=False,
        score=0.0,
        reason="The answer does not satisfy the rubric.",
        feedback="Review the relevant Python operation and try again.",
    )
    payload[field] = leaking_text

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_test_judgment(payload, judge_request)

    assert (
        f"incorrect {field} must not reveal the complete expected answer or an accepted equivalent"
        in exc_info.value.validation_errors
    )


def test_incorrect_judgment_allows_non_leaking_feedback_and_tiny_generic_private_answer():
    request = _judge_request().model_copy(update={"expected_answer": "a", "accepted_equivalents": ["it"]})
    payload = _judgment_payload(
        is_correct=False,
        score=0.0,
        reason="The response selects an unrelated operation.",
        feedback="Review it carefully and choose a valid option.",
    )

    judgment = validate_test_judgment(payload, request)

    assert judgment.feedback == payload["feedback"]


@pytest.mark.parametrize("feedback", ["A is correct.", "Option B was correct.", "The second option is correct."])
def test_multiple_choice_feedback_rejects_option_labels_and_positions(feedback):
    payload = _judgment_payload(feedback=feedback)

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_test_judgment(payload, _judge_request())

    assert exc_info.value.validation_errors == [
        "multiple-choice feedback must describe the submitted answer without option letters or positions",
    ]


@pytest.mark.parametrize(
    ("invalid_payload", "expected_errors"),
    [
        (_judgment_payload(is_correct="true"), ["is_correct: Input should be a valid boolean"]),
        (_judgment_payload(score=1.1), ["score: Input should be less than or equal to 1"]),
        (_judgment_payload(reason=""), ["reason: String should have at least 1 character"]),
        (_judgment_payload(feedback=""), ["feedback: String should have at least 1 character"]),
        (
            _judgment_payload(feedback="Review 中文 feedback."),
            ["feedback must not contain CJK characters"],
        ),
        (_judgment_payload(feedback="12345"), ["feedback must contain an ASCII letter"]),
        (
            _judgment_payload(
                is_correct=False,
                score=0.0,
                feedback="  IT BINDS THE VARIABLE NAME TO THE VALUE.  ",
            ),
            ["incorrect feedback must not reveal the complete expected answer or an accepted equivalent"],
        ),
        (
            _judgment_payload(
                is_correct=False,
                score=0.0,
                feedback=" the NAME   refers to the VALUE. ",
            ),
            ["incorrect feedback must not reveal the complete expected answer or an accepted equivalent"],
        ),
    ],
)
def test_invalid_judgment_repairs_once_with_exact_errors_and_usage(invalid_payload, expected_errors):
    provider = FakeJudgeProvider(
        [json.dumps(invalid_payload, ensure_ascii=False), json.dumps(_judgment_payload())],
        [
            {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7, "usage_unavailable": False},
            {"prompt_tokens": 5, "completion_tokens": 6, "total_tokens": 11, "usage_unavailable": False},
        ],
    )

    response = judge_test_answer(_judge_request(), chat_provider=provider)

    assert len(provider.calls) == 2
    assert provider.calls[0]["temperature"] == 0.0
    assert provider.calls[1]["temperature"] == 0.0
    repair_text = provider.calls[1]["messages"][-1]["content"]
    positions = [repair_text.index(error) for error in expected_errors]
    assert positions == sorted(positions)
    assert all(repair_text.count(error) == 1 for error in expected_errors)
    assert response.token_usage == {
        "prompt_tokens": 8,
        "completion_tokens": 10,
        "total_tokens": 18,
        "usage_unavailable": False,
    }


def test_second_invalid_judgment_stops_after_two_calls_and_sums_usage():
    invalid = json.dumps(_judgment_payload(feedback="12345"))
    provider = FakeJudgeProvider(
        [invalid, invalid],
        [
            {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7, "usage_unavailable": False},
            {"prompt_tokens": 5, "completion_tokens": 6, "total_tokens": 11, "usage_unavailable": False},
        ],
    )

    with pytest.raises(StructuredOutputFailure) as exc_info:
        judge_test_answer(_judge_request(), chat_provider=provider)

    assert len(provider.calls) == 2
    assert exc_info.value.error == "judging_failed"
    assert exc_info.value.validation_errors == ["feedback must contain an ASCII letter"]
    assert exc_info.value.token_usage == {
        "prompt_tokens": 8,
        "completion_tokens": 10,
        "total_tokens": 18,
        "usage_unavailable": False,
    }
