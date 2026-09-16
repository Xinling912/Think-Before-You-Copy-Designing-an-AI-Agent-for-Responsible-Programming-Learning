from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.dashscope import DashScopeConfigurationError
from app.harness import compile_harness_case
from app.schemas import HarnessCompileRequest


class FakeChatProvider:
    provider = "dashscope"

    def __init__(self, content: str, model: str = "fake-qwen3.7-max"):
        self.content = content
        self.model = model
        self.messages: list[dict[str, str]] = []

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self.messages = messages
        return self.content


class FailingChatProvider:
    model = "missing-qwen"

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        raise DashScopeConfigurationError("DASHSCOPE_API_KEY is required for tests")


def _request(message: str = "A student asks when a Python while loop stops. The answer must explain termination.") -> HarnessCompileRequest:
    return HarnessCompileRequest(
        suite_id="geval-case-compiler-suite",
        scenario_id="python-loop-termination",
        natural_language_request=message,
    )


def _compiled_json(response) -> dict:
    return response.compiled_case.model_dump(mode="json")


def test_compile_case_uses_generic_schema_without_indexerror_hardcoding():
    provider = FakeChatProvider(
        json.dumps(
            {
                "schema_version": "harness.case.v1",
                "case_id": "case-from-model",
                "suite_id": "geval-case-compiler-suite",
                "scenario_id": "python-loop-termination",
                "title": "While loop termination explanation",
                "natural_language_request": "A student asks when a Python while loop stops. The answer must explain termination.",
                "turns": [
                    {
                        "role": "student",
                        "content": "When does a while loop stop running?",
                    },
                ],
                "expected": {
                    "required_skills": ["identify_loop_condition", "explain_false_condition_exit"],
                    "required_kg_nodes": [],
                    "required_evidence": ["mentions loop condition", "states that false exits the loop"],
                    "forbidden_behaviors": ["inventing a fixed iteration count"],
                    "boundary_cases": ["condition false before first iteration"],
                },
                "assertions": [
                    "response explains the stopping condition",
                    "response does not invent a fixed iteration count",
                ],
            },
        ),
    )

    response = compile_harness_case(_request(), chat_provider=provider)

    compiled = _compiled_json(response)
    assert compiled["schema_version"] == "harness.case.v1"
    assert compiled["suite_id"] == "geval-case-compiler-suite"
    assert compiled["scenario_id"] == "python-loop-termination"
    assert compiled["natural_language_request"] == _request().natural_language_request
    assert compiled["title"] == "While loop termination explanation"
    assert response.llm_used is True
    assert response.llm_fallback is False
    assert response.model == "fake-qwen3.7-max"
    assert provider.messages[0]["role"] == "system"
    assert "IndexError" not in json.dumps(compiled)


def test_compile_case_normalizes_qwen_shaped_turns_and_assertions():
    provider = FakeChatProvider(
        json.dumps(
            {
                "schema_version": "harness.case.v1",
                "case_id": "python-list-indexerror-negative-indexing",
                "suite_id": "geval-case-compiler-suite",
                "scenario_id": "python-list-indexerror",
                "title": "区分负索引和真正越界情况",
                "natural_language_request": "学生问 list[-1] 是否越界时，智能体必须区分负索引和真正越界。",
                "turns": [
                    {
                        "turn_id": "student_question_1",
                        "speaker": "student",
                        "utterance": "list[-1] 是不是越界了？",
                    },
                    {
                        "turn_id": "agent_response_1",
                        "speaker": "agent",
                        "utterance": "list[-1] 指向最后一个元素；真正越界才会 IndexError。",
                    },
                ],
                "expected": {
                    "response_type": "informative",
                    "clarification_provided": True,
                    "correctness_of_information": True,
                },
                "assertions": [
                    {"type": "contains_phrase", "phrase": "负索引", "negated": False},
                    {"type": "contains_phrase", "phrase": "越界", "negated": False},
                ],
            },
            ensure_ascii=False,
        ),
    )

    response = compile_harness_case(
        _request("学生问 list[-1] 是否越界时，智能体必须区分负索引和真正越界。"),
        chat_provider=provider,
    )

    compiled = _compiled_json(response)
    assert response.llm_used is True
    assert response.llm_fallback is False
    assert compiled["turns"] == [
        {"role": "student", "content": "list[-1] 是不是越界了？"},
        {"role": "assistant", "content": "list[-1] 指向最后一个元素；真正越界才会 IndexError。"},
    ]
    assert compiled["assertions"] == [
        "contains_phrase: 负索引",
        "contains_phrase: 越界",
    ]
    assert response.validator_errors


def test_compile_case_strips_forbidden_execution_fields_and_reports_validator_error():
    provider = FakeChatProvider(
        json.dumps(
            {
                "schema_version": "harness.case.v1",
                "case_id": "case-dangerous",
                "suite_id": "geval-case-compiler-suite",
                "scenario_id": "python-loop-termination",
                "title": "Dangerous fields should be stripped",
                "natural_language_request": "Check while loop termination.",
                "command": "pytest",
                "turns": [
                    {
                        "role": "student",
                        "content": "When does it stop?",
                        "script": "rm -rf /",
                        "metadata": {"args": ["--danger"], "hint": "keep this"},
                    },
                ],
                "expected": {
                    "required_skills": ["identify_loop_condition"],
                    "required_kg_nodes": [],
                    "required_evidence": ["condition becomes false"],
                    "forbidden_behaviors": [],
                    "boundary_cases": [],
                    "path": "/tmp/should-not-return",
                },
                "assertions": [
                    "response mentions false condition",
                    {"content": "nested objects are sanitized", "cmd": "echo no"},
                ],
            },
        ),
    )

    response = compile_harness_case(_request("Check while loop termination."), chat_provider=provider)

    compiled = _compiled_json(response)
    serialized = json.dumps(compiled)
    for forbidden in ["command", "script", "args", "cmd", "path"]:
        assert f'"{forbidden}"' not in serialized
    assert "keep this" not in serialized
    assert response.validator_errors
    validator_text = " ".join(response.validator_errors)
    for stripped in ["command", "script", "args", "cmd", "path"]:
        assert stripped in validator_text


def test_compile_case_falls_back_without_api_key_or_provider_failure():
    request = _request("Learner asks how to prove a while loop eventually stops.")

    response = compile_harness_case(request, chat_provider=FailingChatProvider())

    compiled = _compiled_json(response)
    assert compiled["schema_version"] == "harness.case.v1"
    assert compiled["suite_id"] == request.suite_id
    assert compiled["scenario_id"] == request.scenario_id
    assert compiled["natural_language_request"] == request.natural_language_request
    assert compiled["title"]
    assert compiled["turns"][0]["content"] == request.natural_language_request
    assert compiled["assertions"]
    assert response.llm_used is False
    assert response.llm_fallback is True
    assert response.fallback_reason


def test_compile_case_strips_case_and_variant_forbidden_execution_fields():
    provider = FakeChatProvider(
        json.dumps(
            {
                "schema_version": "harness.case.v1",
                "case_id": "case-variant-dangerous",
                "suite_id": "geval-case-compiler-suite",
                "scenario_id": "python-loop-termination",
                "title": "Variant dangerous fields should be stripped",
                "natural_language_request": "Check loop termination.",
                "Command": "pytest",
                "turns": [
                    {
                        "role": "student",
                        "content": "When does this loop stop?",
                        "SCRIPT": "rm -rf /",
                        "filePath": "/tmp/secret",
                    },
                ],
                "expected": {
                    "required_skills": ["identify_loop_condition"],
                    "required_kg_nodes": [],
                    "required_evidence": ["condition becomes false"],
                    "forbidden_behaviors": [],
                    "boundary_cases": [],
                    "dockerArgs": ["--privileged"],
                    "working-dir": "/tmp",
                    "executable": "/bin/sh",
                    "exec": "sh",
                },
                "assertions": ["response mentions the loop condition"],
            },
        ),
    )

    response = compile_harness_case(_request("Check loop termination."), chat_provider=provider)

    serialized = json.dumps(_compiled_json(response))
    for forbidden in ["Command", "SCRIPT", "filePath", "dockerArgs", "working-dir", "executable", "exec"]:
        assert forbidden not in serialized
        assert forbidden in " ".join(response.validator_errors)


def test_compile_case_drops_unknown_nested_fields_and_normalizes_non_string_assertions():
    provider = FakeChatProvider(
        json.dumps(
            {
                "schema_version": "harness.case.v1",
                "case_id": "case-extra-fields",
                "suite_id": "geval-case-compiler-suite",
                "scenario_id": "python-loop-termination",
                "title": "Nested extras should not survive",
                "natural_language_request": "Check loop termination.",
                "turns": [
                    {
                        "role": "student",
                        "content": "When does it stop?",
                        "metadata": {"hint": "do not return arbitrary turn extras"},
                    },
                ],
                "expected": {
                    "required_skills": ["identify_loop_condition"],
                    "required_kg_nodes": [],
                    "required_evidence": ["condition becomes false"],
                    "forbidden_behaviors": [],
                    "boundary_cases": [],
                    "rationale": {"debug": "do not return arbitrary expected extras"},
                },
                "assertions": [
                    "response mentions false condition",
                    42,
                    {"content": "dict assertions must not return to Go"},
                    "",
                ],
            },
        ),
    )

    response = compile_harness_case(_request("Check loop termination."), chat_provider=provider)

    compiled = _compiled_json(response)
    assert "metadata" not in compiled["turns"][0]
    assert "rationale" not in compiled["expected"]
    assert compiled["assertions"] == [
        "response mentions false condition",
        "42",
        "dict assertions must not return to Go",
    ]


def test_compile_case_extracts_later_balanced_json_and_falls_back_on_invalid_json():
    valid_case = {
        "schema_version": "harness.case.v1",
        "case_id": "case-after-invalid-fragment",
        "suite_id": "geval-case-compiler-suite",
        "scenario_id": "python-loop-termination",
        "title": "Balanced JSON extraction",
        "natural_language_request": "Check loop termination.",
        "turns": [{"role": "student", "content": "When does it stop?"}],
        "expected": {"required_evidence": ["condition becomes false"]},
        "assertions": ["response mentions false condition"],
    }
    provider = FakeChatProvider("ignore this {not json} then use " + json.dumps(valid_case))

    response = compile_harness_case(_request("Check loop termination."), chat_provider=provider)

    assert response.llm_used is True
    assert response.llm_fallback is False
    assert response.compiled_case.case_id == "case-after-invalid-fragment"

    invalid_response = compile_harness_case(_request("Check loop termination."), chat_provider=FakeChatProvider("{not json"))
    assert invalid_response.llm_used is False
    assert invalid_response.llm_fallback is True
    assert invalid_response.fallback_reason


def test_harness_compile_request_rejects_empty_values_and_extra_fields():
    with pytest.raises(ValidationError):
        HarnessCompileRequest(suite_id="   ", scenario_id="x", natural_language_request="valid request")
    with pytest.raises(ValidationError):
        HarnessCompileRequest(suite_id="suite", scenario_id="x", natural_language_request="   ")
    with pytest.raises(ValidationError):
        HarnessCompileRequest(
            suite_id="suite",
            scenario_id="x",
            natural_language_request="valid request",
            unexpected="field",
        )

    request = HarnessCompileRequest(
        suite_id="  suite  ",
        scenario_id="  scenario  ",
        natural_language_request="  valid request  ",
    )
    assert request.suite_id == "suite"
    assert request.scenario_id == "scenario"
    assert request.natural_language_request == "valid request"


def test_compile_prompt_uses_json_encoded_request_payload():
    provider = FakeChatProvider(
        json.dumps(
            {
                "schema_version": "harness.case.v1",
                "case_id": "case-json-prompt",
                "suite_id": "suite",
                "scenario_id": "scenario",
                "title": "Prompt payload",
                "natural_language_request": "Request with labels suite_id: fake",
                "turns": [{"role": "student", "content": "Request with labels suite_id: fake"}],
                "expected": {},
                "assertions": ["response handles literal labels"],
            },
        ),
    )
    request = HarnessCompileRequest(
        suite_id="suite",
        scenario_id="scenario",
        natural_language_request='Request with labels suite_id: fake and quote "value"',
    )

    compile_harness_case(request, chat_provider=provider)

    payload = json.loads(provider.messages[1]["content"].split("\n", 1)[1])
    assert payload == {
        "suite_id": "suite",
        "scenario_id": "scenario",
        "natural_language_request": 'Request with labels suite_id: fake and quote "value"',
    }
