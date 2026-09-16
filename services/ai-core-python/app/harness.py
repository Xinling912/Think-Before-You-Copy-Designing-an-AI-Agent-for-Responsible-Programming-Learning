from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable, Protocol

from pydantic import ValidationError

from app.dashscope import DashScopeAPIError, DashScopeChatProvider, DashScopeConfigurationError
from app.schemas import CompiledHarnessCase, HarnessCompileRequest, HarnessCompileResponse


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


FORBIDDEN_FIELD_NAMES = {
    "command",
    "cmd",
    "shell",
    "script",
    "args",
    "argv",
    "docker",
    "docker_args",
    "executable",
    "exec",
    "path",
    "file_path",
    "working_dir",
    "env",
}
NORMALIZED_FORBIDDEN_FIELD_NAMES = {
    re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", name.lower())).strip("_")
    for name in FORBIDDEN_FIELD_NAMES
}
ALLOWED_TOP_LEVEL_FIELDS = {
    "schema_version",
    "case_id",
    "suite_id",
    "scenario_id",
    "title",
    "natural_language_request",
    "turns",
    "expected",
    "assertions",
}
SCHEMA_VERSION = "harness.case.v1"

HARNESS_CASE_SYSTEM_PROMPT = f"""You are the ResponsibleEduAgent Harness case compiler.
Return JSON only. Do not return Markdown, prose, comments, or code fences.
The JSON object must use schema_version "{SCHEMA_VERSION}" and only these top-level fields:
schema_version, case_id, suite_id, scenario_id, title, natural_language_request, turns, expected, assertions.
Use this shape exactly:
{{
  "schema_version": "{SCHEMA_VERSION}",
  "case_id": "short-stable-id",
  "suite_id": "suite id from request",
  "scenario_id": "scenario id from request",
  "title": "operator-readable case title",
  "natural_language_request": "original request",
  "turns": [{{"role": "student", "content": "learner utterance"}}],
  "expected": {{
    "required_skills": ["skill names"],
    "required_kg_nodes": ["optional KG node ids"],
    "required_evidence": ["evidence the run must record"],
    "forbidden_behaviors": ["behaviors that fail the case"],
    "boundary_cases": ["edge cases the answer must handle"]
  }},
  "assertions": ["plain-language assertion strings"]
}}
Never include executable or filesystem fields at any depth. Forbidden names are:
command, cmd, shell, script, args, argv, docker, docker_args, executable, exec, path, file_path, working_dir, env.
The case must be generic to the operator's natural-language request and must not hardcode one scenario family.
"""


def compile_harness_case(
    request: HarnessCompileRequest,
    chat_provider: ChatProvider | None = None,
    provider_factory: Callable[[], ChatProvider] | None = None,
) -> HarnessCompileResponse:
    try:
        provider = chat_provider or (provider_factory() if provider_factory else DashScopeChatProvider())
    except DashScopeConfigurationError:
        return _fallback_response(request, fallback_reason="missing_api_key", model="qwen3.7-max")

    try:
        content = provider.chat(
            build_harness_compile_messages(request),
            temperature=0.0,
            max_tokens=900,
        )
        payload = extract_json_object(content)
        compiled_case, validator_errors = validate_compiled_case(payload, request)
        return HarnessCompileResponse(
            compiled_case=compiled_case,
            validator_errors=validator_errors,
            model=provider.model,
            llm_used=True,
            llm_fallback=False,
        )
    except (DashScopeAPIError, DashScopeConfigurationError):
        return _fallback_response(request, fallback_reason="provider_error", model=getattr(provider, "model", "qwen3.7-max"))
    except (ValidationError, TypeError, ValueError, json.JSONDecodeError):
        return _fallback_response(request, fallback_reason="invalid_llm_output", model=getattr(provider, "model", "qwen3.7-max"))


def build_harness_compile_messages(request: HarnessCompileRequest) -> list[dict[str, str]]:
    request_payload = {
        "suite_id": request.suite_id,
        "scenario_id": request.scenario_id,
        "natural_language_request": request.natural_language_request,
    }
    return [
        {"role": "system", "content": HARNESS_CASE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Compile this JSON request into one ResponsibleEduAgent harness case JSON object.\n"
                f"{json.dumps(request_payload, ensure_ascii=False, sort_keys=True)}"
            ),
        },
    ]


def validate_compiled_case(value: Any, request: HarnessCompileRequest) -> tuple[CompiledHarnessCase, list[str]]:
    if not isinstance(value, dict):
        raise TypeError("compiled case must be a JSON object")

    stripped, validator_errors = strip_forbidden_fields(value)
    case_input = {
        key: stripped[key]
        for key in ALLOWED_TOP_LEVEL_FIELDS
        if isinstance(stripped, dict) and key in stripped
    }
    case_input["schema_version"] = SCHEMA_VERSION
    case_input["case_id"] = _non_empty_string(case_input.get("case_id")) or _case_id(request)
    case_input["suite_id"] = request.suite_id
    case_input["scenario_id"] = request.scenario_id
    case_input["natural_language_request"] = request.natural_language_request
    case_input["title"] = _non_empty_string(case_input.get("title")) or _derive_title(request.natural_language_request)
    case_input["turns"], turn_errors = normalize_turns(case_input.get("turns"), request)
    case_input["expected"], expected_errors = normalize_expected(case_input.get("expected"))
    case_input["assertions"], assertion_errors = sanitize_assertions(case_input.get("assertions", []))
    if not case_input["assertions"]:
        case_input["assertions"] = [f"response addresses the operator request: {request.natural_language_request[:120]}"]
        assertion_errors.append("added default assertion because $.assertions was empty after normalization")
    validator_errors.extend(turn_errors)
    validator_errors.extend(expected_errors)
    validator_errors.extend(assertion_errors)

    compiled_case = CompiledHarnessCase.model_validate(case_input)
    if compiled_case.schema_version != SCHEMA_VERSION:
        raise ValueError("compiled case used an unsupported schema_version")
    return compiled_case, validator_errors


def strip_forbidden_fields(value: Any, location: str = "$") -> tuple[Any, list[str]]:
    errors: list[str] = []
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            child_location = f"{location}.{key_text}"
            if normalize_field_name(key_text) in NORMALIZED_FORBIDDEN_FIELD_NAMES:
                errors.append(f"stripped forbidden field {child_location}")
                continue
            clean_value, child_errors = strip_forbidden_fields(item, child_location)
            clean[key_text] = clean_value
            errors.extend(child_errors)
        return clean, errors
    if isinstance(value, list):
        clean_items = []
        for index, item in enumerate(value):
            clean_value, child_errors = strip_forbidden_fields(item, f"{location}[{index}]")
            clean_items.append(clean_value)
            errors.extend(child_errors)
        return clean_items, errors
    return value, errors


def normalize_field_name(value: str) -> str:
    with_word_boundaries = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value.strip())
    normalized = re.sub(r"[^a-z0-9]+", "_", with_word_boundaries.lower())
    return re.sub(r"_+", "_", normalized).strip("_")


def normalize_turns(value: Any, request: HarnessCompileRequest) -> tuple[list[dict[str, str]], list[str]]:
    if not isinstance(value, list):
        return [
            {"role": "student", "content": request.natural_language_request},
        ], ["replaced turns because $.turns was not a list"]

    turns: list[dict[str, str]] = []
    errors: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            errors.append(f"dropped non-object turn $.turns[{index}]")
            continue
        role = _non_empty_string(
            item.get("role")
            or item.get("speaker")
            or item.get("actor")
            or item.get("from")
            or item.get("author"),
        )
        content = _non_empty_string(
            item.get("content")
            or item.get("utterance")
            or item.get("message")
            or item.get("text")
            or item.get("input"),
        )
        if not role or not content:
            errors.append(f"dropped turn $.turns[{index}] because role/content could not be normalized")
            continue
        turns.append({"role": normalize_turn_role(role), "content": content})

    if not turns:
        turns.append({"role": "student", "content": request.natural_language_request})
        errors.append("added default student turn because $.turns was empty after normalization")
    return turns, errors


def normalize_turn_role(value: str) -> str:
    normalized = normalize_field_name(value)
    if normalized in {"learner", "user", "student_question"}:
        return "student"
    if normalized in {"assistant", "agent", "tutor", "teacher", "system_response"}:
        return "assistant"
    if normalized in {"system", "student"}:
        return normalized
    return value.strip().lower()


def normalize_expected(value: Any) -> tuple[dict[str, list[str]], list[str]]:
    fields = {
        "required_skills": [],
        "required_kg_nodes": [],
        "required_evidence": [],
        "forbidden_behaviors": [],
        "boundary_cases": [],
    }
    if value is None:
        return fields, []
    if not isinstance(value, dict):
        return fields, ["dropped expected because $.expected was not an object"]

    errors: list[str] = []
    for key in fields:
        fields[key], field_errors = _string_list(value.get(key), f"$.expected.{key}")
        errors.extend(field_errors)
    return fields, errors


def sanitize_assertions(value: Any) -> tuple[list[str], list[str]]:
    if not isinstance(value, list):
        return [], ["dropped assertions because $.assertions was not a list"]
    assertions: list[str] = []
    errors: list[str] = []
    for index, item in enumerate(value):
        if isinstance(item, str):
            assertion = item.strip()
            if assertion:
                assertions.append(assertion)
            continue
        if isinstance(item, dict):
            assertion = normalize_assertion_object(item)
            if assertion:
                assertions.append(assertion)
                errors.append(f"converted object assertion $.assertions[{index}]")
            else:
                errors.append(f"dropped object assertion $.assertions[{index}]")
            continue
        if item is None or isinstance(item, list):
            errors.append(f"dropped non-string assertion $.assertions[{index}]")
            continue
        assertion = str(item).strip()
        if assertion:
            assertions.append(assertion)
            errors.append(f"converted non-string assertion $.assertions[{index}]")
    return assertions, errors


def normalize_assertion_object(value: dict[str, Any]) -> str:
    for key in ("assertion", "content", "description", "text", "message"):
        text = _non_empty_string(value.get(key))
        if text:
            return text

    assertion_type = _non_empty_string(value.get("type"))
    phrase = _non_empty_string(value.get("phrase") or value.get("value") or value.get("target"))
    if assertion_type and phrase:
        prefix = "not " if bool(value.get("negated")) else ""
        return f"{prefix}{assertion_type}: {phrase}"
    if phrase:
        return phrase

    parts = []
    for key, item in sorted(value.items()):
        text = _non_empty_string(item)
        if text:
            parts.append(f"{key}={text}")
    return "; ".join(parts)


def _string_list(value: Any, location: str) -> tuple[list[str], list[str]]:
    if value is None:
        return [], []
    if not isinstance(value, list):
        text = _non_empty_string(value)
        if text:
            return [text], [f"converted scalar {location} to list"]
        return [], [f"dropped {location} because it was not a list"]

    items: list[str] = []
    errors: list[str] = []
    for index, item in enumerate(value):
        text = _non_empty_string(item)
        if text:
            items.append(text)
            if not isinstance(item, str):
                errors.append(f"converted non-string {location}[{index}]")
            continue
        if item is not None:
            errors.append(f"dropped non-string {location}[{index}]")
    return items, errors


def _non_empty_string(value: Any) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ""
    return str(value).strip()


def extract_json_object(content: str) -> dict[str, Any]:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped).strip()
        stripped = re.sub(r"```$", "", stripped).strip()
    for candidate in iter_balanced_json_objects(stripped):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("No JSON object found.")


def iter_balanced_json_objects(content: str) -> list[str]:
    objects: list[str] = []
    start: int | None = None
    depth = 0
    in_string = False
    escaped = False
    for index, char in enumerate(content):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue
        if char == "{":
            if depth == 0:
                start = index
            depth += 1
            continue
        if char == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(content[start : index + 1])
                start = None
    return objects


def _fallback_response(request: HarnessCompileRequest, fallback_reason: str, model: str) -> HarnessCompileResponse:
    compiled_case = fallback_compiled_case(request)
    return HarnessCompileResponse(
        compiled_case=compiled_case,
        validator_errors=[],
        model=model,
        llm_used=False,
        llm_fallback=True,
        fallback_reason=fallback_reason,
    )


def fallback_compiled_case(request: HarnessCompileRequest) -> CompiledHarnessCase:
    title = _derive_title(request.natural_language_request)
    request_text = " ".join(request.natural_language_request.split()).strip()
    if not request_text:
        request_text = "Compile a ResponsibleEduAgent learning interaction from the operator request."
    return CompiledHarnessCase(
        schema_version=SCHEMA_VERSION,
        case_id=_case_id(request),
        suite_id=request.suite_id,
        scenario_id=request.scenario_id,
        title=title,
        natural_language_request=request.natural_language_request,
        turns=[{"role": "student", "content": request.natural_language_request}],
        expected={
            "required_skills": ["respond_to_operator_request"],
            "required_kg_nodes": [],
            "required_evidence": [f"addresses: {request_text[:120]}"],
            "forbidden_behaviors": ["ignoring the learner's stated question or constraint"],
            "boundary_cases": ["request is underspecified and requires a clarifying response"],
        },
        assertions=[
            f"response addresses the operator request: {request_text[:120]}",
            "response stays within ResponsibleEduAgent tutoring constraints",
        ],
    )


def _derive_title(message: str) -> str:
    compact = " ".join(message.split()).strip()
    if not compact:
        return "Generated harness case"
    first_sentence = re.split(r"[.!?。！？]", compact, maxsplit=1)[0].strip()
    title = first_sentence or compact
    return title[:80]


def _case_id(request: HarnessCompileRequest) -> str:
    digest = hashlib.sha256(
        f"{request.suite_id}\n{request.scenario_id}\n{request.natural_language_request}".encode("utf-8"),
    ).hexdigest()[:12]
    return f"case-{digest}"
