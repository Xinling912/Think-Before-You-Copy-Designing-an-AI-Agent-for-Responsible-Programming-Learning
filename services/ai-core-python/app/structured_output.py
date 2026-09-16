from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable, Generic, TypeVar

from pydantic import ValidationError


ValidatedT = TypeVar("ValidatedT")
TokenUsage = dict[str, int | bool]


class StructuredValidationError(ValueError):
    def __init__(self, validation_errors: list[str]):
        self.validation_errors = [str(error) for error in validation_errors]
        super().__init__("; ".join(self.validation_errors))


class StructuredOutputFailure(RuntimeError):
    def __init__(
        self,
        *,
        error: str,
        validation_errors: list[str],
        provider: str,
        model: str,
        token_usage: TokenUsage,
    ):
        self.error = error
        self.validation_errors = list(validation_errors)
        self.provider = provider
        self.model = model
        self.token_usage = dict(token_usage)
        super().__init__(error)


@dataclass(frozen=True)
class ValidatedStructuredOutput(Generic[ValidatedT]):
    value: ValidatedT
    provider: str
    model: str
    token_usage: TokenUsage


def extract_first_balanced_json_object(raw: str) -> dict[str, Any]:
    for start, character in enumerate(raw):
        if character != "{":
            continue
        depth = 0
        in_string = False
        escaped = False
        for end in range(start, len(raw)):
            current = raw[end]
            if in_string:
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == '"':
                    in_string = False
                continue
            if current == '"':
                in_string = True
            elif current == "{":
                depth += 1
            elif current == "}":
                depth -= 1
                if depth == 0:
                    candidate = raw[start : end + 1]
                    try:
                        parsed = json.loads(candidate)
                    except json.JSONDecodeError:
                        break
                    if isinstance(parsed, dict):
                        return parsed
                    break
    raise StructuredValidationError(["response did not contain a valid JSON object"])


def request_validated_json_with_one_repair(
    *,
    chat_provider: Any,
    messages: list[dict[str, str]],
    validator: Callable[[dict[str, Any]], ValidatedT],
    failure_code: str,
    temperature: float,
    max_tokens: int | None = None,
) -> ValidatedStructuredOutput[ValidatedT]:
    provider_name = str(getattr(chat_provider, "provider", "") or "unknown")
    token_usage = _empty_usage()

    first_response = chat_provider.chat_with_usage(
        deepcopy(messages),
        temperature=temperature,
        max_tokens=max_tokens,
    )
    _add_usage(token_usage, getattr(first_response, "usage", None))
    last_model = str(getattr(first_response, "model", "") or getattr(chat_provider, "model", "") or "unknown")
    validated, validation_errors = _validate_response(first_response.content, validator)
    if not validation_errors:
        return ValidatedStructuredOutput(
            value=validated,
            provider=provider_name,
            model=last_model,
            token_usage=token_usage,
        )

    repair_messages = deepcopy(messages)
    repair_messages.append(
        {
            "role": "user",
            "content": _repair_message(first_response.content, validation_errors),
        },
    )
    try:
        repair_response = chat_provider.chat_with_usage(
            repair_messages,
            temperature=0.0,
            max_tokens=max_tokens,
        )
    except Exception as exc:
        raise StructuredOutputFailure(
            error=failure_code,
            validation_errors=validation_errors,
            provider=provider_name,
            model=last_model,
            token_usage=token_usage,
        ) from exc

    _add_usage(token_usage, getattr(repair_response, "usage", None))
    last_model = str(getattr(repair_response, "model", "") or last_model)
    validated, repair_errors = _validate_response(repair_response.content, validator)
    if repair_errors:
        raise StructuredOutputFailure(
            error=failure_code,
            validation_errors=repair_errors,
            provider=provider_name,
            model=last_model,
            token_usage=token_usage,
        )
    return ValidatedStructuredOutput(
        value=validated,
        provider=provider_name,
        model=last_model,
        token_usage=token_usage,
    )


def _validate_response(
    raw: str,
    validator: Callable[[dict[str, Any]], ValidatedT],
) -> tuple[ValidatedT | None, list[str]]:
    try:
        payload = extract_first_balanced_json_object(raw)
        return validator(payload), []
    except StructuredValidationError as exc:
        return None, list(exc.validation_errors)
    except ValidationError as exc:
        return None, _pydantic_validation_errors(exc)
    except (TypeError, ValueError) as exc:
        return None, [str(exc)]


def _pydantic_validation_errors(exc: ValidationError) -> list[str]:
    ordered_errors = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()))
        message = str(error.get("msg") or "validation failed")
        ordered_errors.append(f"{location}: {message}" if location else message)
    return ordered_errors


def _repair_message(raw: str, validation_errors: list[str]) -> str:
    ordered_errors = "\n".join(f"- {error}" for error in validation_errors)
    return (
        "Return one corrected JSON object only.\n"
        "Validation errors, in order:\n"
        f"{ordered_errors}\n"
        "Previous response:\n"
        f"{raw}"
    )


def _empty_usage() -> TokenUsage:
    return {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "usage_unavailable": True,
    }


def _add_usage(total: TokenUsage, raw_usage: object) -> None:
    usage = raw_usage if isinstance(raw_usage, dict) else {}
    prompt_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or prompt_tokens + completion_tokens)
    total["prompt_tokens"] = int(total["prompt_tokens"]) + prompt_tokens
    total["completion_tokens"] = int(total["completion_tokens"]) + completion_tokens
    total["total_tokens"] = int(total["total_tokens"]) + total_tokens
    total["usage_unavailable"] = int(total["total_tokens"]) <= 0
