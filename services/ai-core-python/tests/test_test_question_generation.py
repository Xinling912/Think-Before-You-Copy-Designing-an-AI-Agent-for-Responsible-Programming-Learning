from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import pytest
from pydantic import ValidationError

from app.dashscope import DashScopeAPIError, DashScopeChatResponse
from app.schemas import (
    GeneratedTestQuestion,
    TestJudgeRequest as JudgeRequestSchema,
    TestJudgeResponse as JudgeResponseSchema,
    TestJudgment as JudgmentSchema,
    TestQuestionGenerateRequest as QuestionGenerateRequestSchema,
    TestQuestionGenerationResponse as QuestionGenerationResponseSchema,
    TestTopic as TopicSchema,
)
from app.structured_output import (
    StructuredOutputFailure,
    StructuredValidationError,
    extract_first_balanced_json_object,
    request_validated_json_with_one_repair,
)
from app.test_center import (
    QUESTION_FORMAT_BY_LEVEL,
    build_question_messages,
    build_test_grounding,
    generate_test_question,
    validate_generated_question,
)


def _catalog() -> list[dict[str, str]]:
    return [
        {
            "id": f"topic_{index:02d}",
            "label": f"Topic {index:02d}",
            "summary": f"Complete beginner summary for topic {index:02d}.",
            "icon": f"Icon{index:02d}Outlined",
        }
        for index in range(20)
    ]


def _request_payload() -> dict[str, Any]:
    catalog = _catalog()
    return {
        "catalog": catalog,
        "selected_topic": deepcopy(catalog[4]),
        "current_progress": 0,
        "level": 1,
        "difficulty_prompt": "Generate one exact beginner question.",
        "recent_questions": ["A previous English question?"],
    }


def test_generation_request_accepts_exact_strict_contract():
    request = QuestionGenerateRequestSchema.model_validate(_request_payload())

    assert len(request.catalog) == 20
    assert request.selected_topic == request.catalog[4]
    assert request.level == request.current_progress + 1


@pytest.mark.parametrize(
    ("mutate", "expected_error"),
    [
        (lambda payload: payload.update(catalog=payload["catalog"][:-1]), "at least 20 items"),
        (lambda payload: payload["catalog"].append(deepcopy(payload["catalog"][-1])), "at most 20 items"),
        (lambda payload: payload["catalog"][1].update(id=payload["catalog"][0]["id"]), "twenty unique topic IDs"),
        (lambda payload: payload["catalog"][1].update(icon=payload["catalog"][0]["icon"]), "twenty unique icon keys"),
        (lambda payload: payload["selected_topic"].update(label="Mismatched label"), "selected_topic must exactly match"),
        (lambda payload: payload.update(level=2), "level must equal current_progress + 1"),
        (lambda payload: payload.update(recent_questions=[f"Question {i}" for i in range(11)]), "at most 10 items"),
        (lambda payload: payload.update(unexpected=True), "Extra inputs are not permitted"),
    ],
)
def test_generation_request_rejects_invalid_contract(mutate, expected_error):
    payload = _request_payload()
    mutate(payload)

    with pytest.raises(ValidationError) as exc_info:
        QuestionGenerateRequestSchema.model_validate(payload)

    assert expected_error in str(exc_info.value)


def test_all_test_contract_models_forbid_extra_fields_and_strip_strings():
    question = GeneratedTestQuestion(
        topic_id=" topic_04 ",
        level=1,
        question_format="multiple_choice",
        question_text=" What does assignment do? ",
        options=["Binds a value", "Deletes a value", "Imports a module", "Stops Python"],
        expected_answer="Binds a value",
        accepted_equivalents=["It binds a value"],
        grading_rubric=["The answer identifies value binding"],
        beginner_difficulty=True,
    )
    generation = QuestionGenerationResponseSchema(
        **question.model_dump(),
        kg_grounding={"selected_node_ids": []},
        provider=" dashscope ",
        model=" qwen-test ",
        token_usage={"total_tokens": 3},
    )
    persisted_question = question.model_dump(exclude={"beginner_difficulty"})
    judge_request = JudgeRequestSchema(**persisted_question, student_answer=" Binds a value ")
    judgment = JudgmentSchema(is_correct=True, score=1, reason=" Exact match ", feedback=" Correct answer. ")
    judge_response = JudgeResponseSchema(
        **judgment.model_dump(),
        provider="dashscope",
        model="qwen-test",
        token_usage={"total_tokens": 2},
    )

    assert question.topic_id == "topic_04"
    assert generation.provider == "dashscope"
    assert judge_request.student_answer == "Binds a value"
    assert judge_response.reason == "Exact match"
    for model in (
        TopicSchema,
        QuestionGenerateRequestSchema,
        GeneratedTestQuestion,
        QuestionGenerationResponseSchema,
        JudgeRequestSchema,
        JudgmentSchema,
        JudgeResponseSchema,
    ):
        assert model.model_config["extra"] == "forbid"
        assert model.model_config["str_strip_whitespace"] is True

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        JudgmentSchema.model_validate({**judgment.model_dump(), "progress": 1})
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        JudgeRequestSchema.model_validate(
            {**persisted_question, "student_answer": "Binds a value", "beginner_difficulty": True},
        )


class FakeChatProvider:
    provider = "dashscope"

    def __init__(self, responses: list[str | Exception], usages: list[dict[str, int | bool]] | None = None):
        self.responses = list(responses)
        self.usages = usages or [
            {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5, "usage_unavailable": False}
            for _ in responses
        ]
        self.calls: list[dict[str, Any]] = []

    def chat_with_usage(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> DashScopeChatResponse:
        call_index = len(self.calls)
        self.calls.append(
            {
                "messages": deepcopy(messages),
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        response = self.responses[call_index]
        if isinstance(response, Exception):
            raise response
        return DashScopeChatResponse(
            content=response,
            model=f"qwen-call-{call_index + 1}",
            usage=self.usages[call_index],
        )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ('prefix {"value": 2, "text": "a } brace"} suffix', {"value": 2, "text": "a } brace"}),
        ('```json\n{"value": 2}\n```', {"value": 2}),
    ],
)
def test_extracts_balanced_and_fenced_json(raw, expected):
    assert extract_first_balanced_json_object(raw) == expected


def _validated_payload(payload: dict[str, Any]) -> dict[str, Any]:
    errors = []
    if payload.get("value") != 2:
        errors.append("value must equal 2 exactly")
    if payload.get("mode") != "beginner":
        errors.append("mode must equal beginner exactly")
    if errors:
        raise StructuredValidationError(errors)
    return payload


def test_structured_output_returns_first_validated_result_and_usage_without_repair():
    provider = FakeChatProvider(
        ['answer: {"value": 2, "mode": "beginner"}'],
        [{"prompt_tokens": 4, "completion_tokens": 6, "total_tokens": 10, "usage_unavailable": False}],
    )

    result = request_validated_json_with_one_repair(
        chat_provider=provider,
        messages=[{"role": "user", "content": "Return JSON."}],
        validator=_validated_payload,
        failure_code="generation_failed",
        temperature=0.35,
        max_tokens=700,
    )

    assert result.value == {"value": 2, "mode": "beginner"}
    assert result.provider == "dashscope"
    assert result.model == "qwen-call-1"
    assert result.token_usage == {
        "prompt_tokens": 4,
        "completion_tokens": 6,
        "total_tokens": 10,
        "usage_unavailable": False,
    }
    assert len(provider.calls) == 1
    assert provider.calls[0]["temperature"] == 0.35
    assert provider.calls[0]["max_tokens"] == 700


def test_structured_output_repairs_once_with_exact_ordered_errors_and_summed_usage():
    ordered_errors = ["value must equal 2 exactly", "mode must equal beginner exactly"]
    provider = FakeChatProvider(
        ['{"value": 1, "mode": "advanced"}', '{"value": 2, "mode": "beginner"}'],
        [
            {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7, "usage_unavailable": False},
            {"prompt_tokens": 5, "completion_tokens": 6, "total_tokens": 11, "usage_unavailable": False},
        ],
    )
    initial_messages = [{"role": "system", "content": "JSON only."}]

    result = request_validated_json_with_one_repair(
        chat_provider=provider,
        messages=initial_messages,
        validator=_validated_payload,
        failure_code="generation_failed",
        temperature=0.35,
    )

    assert result.value["value"] == 2
    assert result.model == "qwen-call-2"
    assert result.token_usage == {
        "prompt_tokens": 8,
        "completion_tokens": 10,
        "total_tokens": 18,
        "usage_unavailable": False,
    }
    assert len(provider.calls) == 2
    assert provider.calls[0]["temperature"] == 0.35
    assert provider.calls[1]["temperature"] == 0.0
    assert len(provider.calls[1]["messages"]) == len(initial_messages) + 1
    repair_message = provider.calls[1]["messages"][-1]
    assert repair_message["role"] == "user"
    error_positions = [repair_message["content"].index(error) for error in ordered_errors]
    assert error_positions == sorted(error_positions)
    assert repair_message["content"].count(ordered_errors[0]) == 1
    assert repair_message["content"].count(ordered_errors[1]) == 1


def test_structured_output_stops_after_two_invalid_calls_and_reports_last_errors():
    provider = FakeChatProvider(
        ['{"value": 1, "mode": "advanced"}', '{"value": 1, "mode": "beginner"}'],
    )

    with pytest.raises(StructuredOutputFailure) as exc_info:
        request_validated_json_with_one_repair(
            chat_provider=provider,
            messages=[{"role": "user", "content": "Return JSON."}],
            validator=_validated_payload,
            failure_code="generation_failed",
            temperature=0.35,
        )

    failure = exc_info.value
    assert len(provider.calls) == 2
    assert failure.error == "generation_failed"
    assert failure.validation_errors == ["value must equal 2 exactly"]
    assert failure.model == "qwen-call-2"
    assert failure.token_usage["total_tokens"] == 10


def test_repair_provider_failure_preserves_first_response_usage_and_errors():
    provider = FakeChatProvider(
        ['{"value": 1, "mode": "advanced"}', DashScopeAPIError("repair provider unavailable")],
        [
            {"prompt_tokens": 7, "completion_tokens": 8, "total_tokens": 15, "usage_unavailable": False},
            {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "usage_unavailable": True},
        ],
    )

    with pytest.raises(StructuredOutputFailure) as exc_info:
        request_validated_json_with_one_repair(
            chat_provider=provider,
            messages=[{"role": "user", "content": "Return JSON."}],
            validator=_validated_payload,
            failure_code="generation_failed",
            temperature=0.35,
        )

    failure = exc_info.value
    assert len(provider.calls) == 2
    assert failure.validation_errors == [
        "value must equal 2 exactly",
        "mode must equal beginner exactly",
    ]
    assert failure.provider == "dashscope"
    assert failure.model == "qwen-call-1"
    assert failure.token_usage == {
        "prompt_tokens": 7,
        "completion_tokens": 8,
        "total_tokens": 15,
        "usage_unavailable": False,
    }
    assert isinstance(failure.__cause__, DashScopeAPIError)


def _generation_request(
    *,
    level: int = 1,
    recent_questions: list[str] | None = None,
) -> QuestionGenerateRequestSchema:
    payload = _request_payload()
    payload["current_progress"] = level - 1
    payload["level"] = level
    payload["difficulty_prompt"] = f"Exact difficulty instruction for level {level}."
    payload["recent_questions"] = recent_questions or []
    return QuestionGenerateRequestSchema.model_validate(payload)


def _valid_question_payload(
    request: QuestionGenerateRequestSchema | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    request = request or _generation_request()
    payload: dict[str, Any] = {
        "topic_id": request.selected_topic.id,
        "level": request.level,
        "question_format": QUESTION_FORMAT_BY_LEVEL[request.level],
        "question_text": "What does assigning a value to a Python variable do?",
        "options": [
            "It binds the name to the value.",
            "It deletes the value.",
            "It imports a module.",
            "It exits the program.",
        ] if request.level == 1 else [],
        "expected_answer": "It binds the name to the value.",
        "accepted_equivalents": ["The variable name refers to the value."],
        "grading_rubric": ["The answer identifies that assignment binds a name to a value."],
        "beginner_difficulty": True,
    }
    payload.update(overrides)
    return payload


def _grounding_payload(*, kg_gap: bool = False) -> dict[str, Any]:
    return {
        "selected_node_ids": [] if kg_gap else ["Concept:assignment", "Concept:variable"],
        "candidate_nodes": [{"node_id": "Concept:ignored"}],
        "path": [] if kg_gap else ["Concept:assignment", "Concept:variable"],
        "path_edges": [] if kg_gap else [{"source": "Concept:assignment", "target": "Concept:variable"}],
        "curriculum_path": [{"path_id": "beginner:variables"}],
        "kg_gap": kg_gap,
        "method": "must_not_escape",
        "reason": "must_not_escape",
    }


def test_validate_generated_question_normalizes_textual_rubric_objects():
    request = _generation_request()
    payload = _valid_question_payload(
        request,
        grading_rubric=[
            {"criterion": "Identify that assignment binds a name to a value."},
            {"description": "Reject unrelated syntax claims."},
        ],
    )

    question = validate_generated_question(payload, request)

    assert question.grading_rubric == [
        "Identify that assignment binds a name to a value.",
        "Reject unrelated syntax claims.",
    ]


def test_validate_generated_question_rejects_options_outside_level_one():
    request = _generation_request(level=2)
    payload = _valid_question_payload(
        request,
        options=["None", "Null", "Empty", "Zero"],
    )

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_generated_question(payload, request)

    assert exc_info.value.validation_errors == ["level 2 must not include options"]


def test_validate_generated_question_rejects_enumerated_choices_in_open_response_text():
    request = _generation_request(level=2)
    payload = _valid_question_payload(
        request,
        question_text=(
            "Which Python value represents the absence of a value?\n"
            "1. None\n"
            "2. Null\n"
            "3. Empty\n"
            "4. Zero"
        ),
    )

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_generated_question(payload, request)

    assert exc_info.value.validation_errors == [
        "levels 2 through 10 must not contain enumerated answer choices",
    ]


def test_validate_generated_question_accepts_one_line_open_response_syntax_question():
    request = _generation_request(level=3)
    payload = _valid_question_payload(
        request,
        question_text="Write the simplest Python expression that creates the string hello.",
        expected_answer='"hello"',
        accepted_equivalents=["'hello'"],
        grading_rubric=["The response is a string literal containing hello."],
    )

    question = validate_generated_question(payload, request)

    assert question.question_format == "syntax"
    assert question.options == []


def test_question_format_contract_matches_all_ten_levels():
    assert QUESTION_FORMAT_BY_LEVEL == {
        1: "multiple_choice",
        2: "terminology",
        3: "syntax",
        4: "code_reading",
        5: "output_prediction",
        6: "fill_blank",
        7: "scenario",
        8: "debugging",
        9: "correction",
        10: "transfer",
    }


def test_build_test_grounding_uses_only_selected_topic_text_and_retains_allowed_fields(monkeypatch):
    request = _generation_request()
    calls: list[tuple[str, Any]] = []

    def fake_ground_question(question: str, *, chat_provider: Any):
        calls.append((question, chat_provider))
        return _grounding_payload(kg_gap=True)

    monkeypatch.setattr("app.test_center.ground_question", fake_ground_question)

    grounding = build_test_grounding(request)

    assert calls == [(f"{request.selected_topic.label}\n{request.selected_topic.summary}", None)]
    assert grounding == {
        "selected_node_ids": [],
        "path": [],
        "path_edges": [],
        "curriculum_path": [{"path_id": "beginner:variables"}],
        "kg_gap": True,
    }


def test_question_prompt_contains_full_catalog_exact_fields_and_only_last_ten_recent_questions():
    request = _generation_request()
    twelve_recent = [f"Unique recent question {index:02d}?" for index in range(12)]
    request_with_unvalidated_history = request.model_copy(update={"recent_questions": twelve_recent})
    grounding = _grounding_payload(kg_gap=True)

    messages = build_question_messages(request_with_unvalidated_history, grounding)

    prompt = "\n".join(message["content"] for message in messages)
    exact_catalog = json.dumps(
        [topic.model_dump(mode="json") for topic in request.catalog],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    exact_recent = json.dumps(twelve_recent[-10:], ensure_ascii=False, separators=(",", ":"))
    assert exact_catalog in prompt
    assert request.selected_topic.summary in prompt
    assert request.difficulty_prompt in prompt
    assert f"Level: {request.level}" in prompt
    assert exact_recent in prompt
    assert twelve_recent[0] not in prompt
    assert twelve_recent[1] not in prompt
    assert "English only" in prompt
    assert "complete Python beginner" in prompt
    assert '"kg_gap":true' in prompt


def test_generate_question_returns_private_payload_kg_gap_and_usage(monkeypatch):
    request = _generation_request()
    payload = _valid_question_payload(request)
    provider = FakeChatProvider(
        [json.dumps(payload)],
        [{"prompt_tokens": 9, "completion_tokens": 11, "total_tokens": 20, "usage_unavailable": False}],
    )
    monkeypatch.setattr("app.test_center.ground_question", lambda *args, **kwargs: _grounding_payload(kg_gap=True))

    response = generate_test_question(request, chat_provider=provider)

    assert response.model_dump(mode="json") == {
        **payload,
        "kg_grounding": {
            "selected_node_ids": [],
            "path": [],
            "path_edges": [],
            "curriculum_path": [{"path_id": "beginner:variables"}],
            "kg_gap": True,
        },
        "provider": "dashscope",
        "model": "qwen-call-1",
        "token_usage": {
            "prompt_tokens": 9,
            "completion_tokens": 11,
            "total_tokens": 20,
            "usage_unavailable": False,
        },
    }
    assert len(provider.calls) == 1
    assert provider.calls[0]["temperature"] == 0.35


@pytest.mark.parametrize(
    ("invalid_response", "expected_errors"),
    [
        ("not JSON at all", ["response did not contain a valid JSON object"]),
        (
            json.dumps(_valid_question_payload(topic_id="topic_19")),
            ["topic_id must equal selected_topic.id"],
        ),
        (
            json.dumps(_valid_question_payload(level=2)),
            ["level must equal the requested level"],
        ),
        (
            json.dumps(_valid_question_payload(question_format="syntax")),
            ["question_format must equal multiple_choice for level 1"],
        ),
        (
            json.dumps(_valid_question_payload(question_text="中文题目"), ensure_ascii=False),
            ["question_text must not contain CJK characters", "question_text must contain an ASCII letter"],
        ),
        (
            json.dumps(_valid_question_payload(expected_answer="")),
            ["expected_answer: String should have at least 1 character"],
        ),
        (
            json.dumps(_valid_question_payload(question_text="Read this:\n```python\nx = 1\n```")),
            ["level 1 allows at most 0 fenced code lines"],
        ),
        (
            json.dumps(_valid_question_payload(question_text="  A PREVIOUS   ENGLISH QUESTION?  ")),
            ["question_text duplicates a recent question"],
        ),
        (
            json.dumps(_valid_question_payload(options=["One", "Two", "Three"])),
            ["level 1 requires exactly four distinct options"],
        ),
        (
            json.dumps(_valid_question_payload(beginner_difficulty=False)),
            ["beginner_difficulty must be true"],
        ),
    ],
)
def test_invalid_generation_response_is_repaired_once_with_exact_errors_and_usage(
    monkeypatch,
    invalid_response,
    expected_errors,
):
    request = _generation_request(recent_questions=["A previous English question?"])
    provider = FakeChatProvider(
        [invalid_response, json.dumps(_valid_question_payload(request))],
        [
            {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5, "usage_unavailable": False},
            {"prompt_tokens": 7, "completion_tokens": 8, "total_tokens": 15, "usage_unavailable": False},
        ],
    )
    monkeypatch.setattr("app.test_center.ground_question", lambda *args, **kwargs: _grounding_payload())

    response = generate_test_question(request, chat_provider=provider)

    assert len(provider.calls) == 2
    assert provider.calls[0]["temperature"] == 0.35
    assert provider.calls[1]["temperature"] == 0.0
    repair_text = provider.calls[1]["messages"][-1]["content"]
    positions = [repair_text.index(error) for error in expected_errors]
    assert positions == sorted(positions)
    assert all(repair_text.count(error) == 1 for error in expected_errors)
    assert response.token_usage["prompt_tokens"] == 9
    assert response.token_usage["completion_tokens"] == 11
    assert response.token_usage["total_tokens"] == 20


@pytest.mark.parametrize(
    ("level", "maximum"),
    [(1, 0), (2, 0), (3, 1), (4, 2), (5, 3), (6, 3), (8, 4), (9, 5), (10, 5)],
)
def test_fenced_code_line_maxima_trigger_repair(monkeypatch, level, maximum):
    request = _generation_request(level=level)
    code = "\n".join(f"line_{index} = {index}" for index in range(maximum + 1))
    invalid_payload = _valid_question_payload(
        request,
        question_text=f"Read this beginner code:\n```python\n{code}\n```",
    )
    provider = FakeChatProvider(
        [json.dumps(invalid_payload), json.dumps(_valid_question_payload(request))],
    )
    monkeypatch.setattr("app.test_center.ground_question", lambda *args, **kwargs: _grounding_payload())

    generate_test_question(request, chat_provider=provider)

    assert len(provider.calls) == 2
    assert f"level {level} allows at most {maximum} fenced code lines" in provider.calls[1]["messages"][-1]["content"]


def test_fenced_code_in_option_cannot_bypass_level_line_maximum(monkeypatch):
    request = _generation_request(level=1)
    invalid_payload = _valid_question_payload(
        request,
        options=[
            "Read this option:\n```python\nx = 1\n```",
            "It deletes the value.",
            "It imports a module.",
            "It exits the program.",
        ],
    )
    provider = FakeChatProvider(
        [json.dumps(invalid_payload), json.dumps(_valid_question_payload(request))],
    )
    monkeypatch.setattr("app.test_center.ground_question", lambda *args, **kwargs: _grounding_payload())

    generate_test_question(request, chat_provider=provider)

    assert len(provider.calls) == 2
    assert "level 1 allows at most 0 fenced code lines" in provider.calls[1]["messages"][-1]["content"]


@pytest.mark.parametrize(
    ("character", "unicode_block"),
    [
        ("\u1100", "hangul_jamo"),
        ("\U00020000", "cjk_extension_b"),
        ("\U0002F800", "cjk_compatibility_supplement"),
        ("\U000323B0", "cjk_extension_j"),
        ("\u3042", "hiragana"),
        ("\u30A2", "katakana"),
        ("\uFF76", "halfwidth_katakana"),
        ("\uAC00", "hangul_syllable"),
        ("\u3131", "hangul_compatibility_jamo"),
        ("\uFFA1", "halfwidth_hangul"),
    ],
)
def test_question_text_rejects_all_reviewed_cjk_ranges(character, unicode_block):
    del unicode_block
    request = _generation_request()
    invalid = _valid_question_payload(request, question_text=f"Question containing {character}")

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_generated_question(invalid, request)

    assert "question_text must not contain CJK characters" in exc_info.value.validation_errors


@pytest.mark.parametrize(
    ("character", "unicode_block"),
    [
        ("\u1100", "hangul_jamo"),
        ("\U00020000", "cjk_extension_b"),
        ("\U0002F800", "cjk_compatibility_supplement"),
        ("\U000323B0", "cjk_extension_j"),
        ("\u3042", "hiragana"),
        ("\u30A2", "katakana"),
        ("\uFF76", "halfwidth_katakana"),
        ("\uAC00", "hangul_syllable"),
        ("\u3131", "hangul_compatibility_jamo"),
        ("\uFFA1", "halfwidth_hangul"),
    ],
)
def test_option_text_rejects_all_reviewed_cjk_ranges(character, unicode_block):
    del unicode_block
    request = _generation_request()
    invalid = _valid_question_payload(
        request,
        options=[
            f"Option containing {character}",
            "It deletes the value.",
            "It imports a module.",
            "It exits the program.",
        ],
    )

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_generated_question(invalid, request)

    assert "options[0] must not contain CJK characters" in exc_info.value.validation_errors


@pytest.mark.parametrize(
    ("field", "french_text"),
    [
        ("question_text", "Quelle valeur affiche ce code Python ?"),
        ("question_text", "Que fait ce code Python ?"),
        ("question_text", "Quel est le resultat de ce code Python ?"),
        ("options[0]", "Cette reponse supprime la valeur."),
    ],
)
def test_learner_visible_text_rejects_french_latin_script_output(field, french_text):
    request = _generation_request()
    invalid = _valid_question_payload(request)
    if field == "question_text":
        invalid["question_text"] = french_text
    else:
        invalid["options"][0] = french_text

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_generated_question(invalid, request)

    assert f"{field} must be English" in exc_info.value.validation_errors


def test_english_validation_accepts_beginner_python_identifiers_and_code_options():
    request = _generation_request()
    valid = _valid_question_payload(
        request,
        question_text="Which option appends item to my_list?",
        options=[
            "my_list.append(item)",
            "my_list.remove(item)",
            "my_list.clear()",
            "len(my_list)",
        ],
    )

    question = validate_generated_question(valid, request)

    assert question.options[0] == "my_list.append(item)"


def test_generated_question_validation_reports_context_errors_in_stable_order():
    request = _generation_request()
    invalid = _valid_question_payload(
        topic_id="topic_19",
        level=2,
        question_format="syntax",
        question_text="中文",
        options=["One", "Two", "Three"],
        beginner_difficulty=False,
    )

    with pytest.raises(StructuredValidationError) as exc_info:
        validate_generated_question(invalid, request)

    assert exc_info.value.validation_errors == [
        "topic_id must equal selected_topic.id",
        "level must equal the requested level",
        "question_format must equal multiple_choice for level 1",
        "question_text must not contain CJK characters",
        "question_text must contain an ASCII letter",
        "level 1 requires exactly four distinct options",
        "beginner_difficulty must be true",
    ]


def test_second_invalid_generation_response_raises_without_third_call_and_sums_usage(monkeypatch):
    request = _generation_request()
    invalid = json.dumps(_valid_question_payload(topic_id="topic_19"))
    provider = FakeChatProvider(
        [invalid, invalid],
        [
            {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7, "usage_unavailable": False},
            {"prompt_tokens": 5, "completion_tokens": 6, "total_tokens": 11, "usage_unavailable": False},
        ],
    )
    monkeypatch.setattr("app.test_center.ground_question", lambda *args, **kwargs: _grounding_payload())

    with pytest.raises(StructuredOutputFailure) as exc_info:
        generate_test_question(request, chat_provider=provider)

    assert len(provider.calls) == 2
    assert exc_info.value.error == "generation_failed"
    assert exc_info.value.validation_errors == ["topic_id must equal selected_topic.id"]
    assert exc_info.value.token_usage == {
        "prompt_tokens": 8,
        "completion_tokens": 10,
        "total_tokens": 18,
        "usage_unavailable": False,
    }
