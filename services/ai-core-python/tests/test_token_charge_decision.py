from __future__ import annotations

import json
from dataclasses import dataclass

import pytest

from app.schemas import TokenChargeDecisionRequest
from app.token_charge_decision import decide_token_charge, deterministic_token_charge_decision


class FakeChatProvider:
    provider = "fake"
    model = "fake-token-charge-model"

    def __init__(self, response: dict | str | Exception) -> None:
        self.response = response
        self.calls = 0
        self.messages: list[dict[str, str]] = []

    def chat_with_usage(self, messages, temperature=None, max_tokens=None):
        self.calls += 1
        self.messages = messages
        if isinstance(self.response, Exception):
            raise self.response
        content = self.response if isinstance(self.response, str) else json.dumps(self.response)
        return FakeChatResponse(content, "authoritative-provider-model", {"total_tokens": 13})


@dataclass(frozen=True)
class FakeChatResponse:
    content: str
    model: str
    usage: dict[str, int]


def request(message: str, recent_messages: list[dict[str, str]] | None = None) -> TokenChargeDecisionRequest:
    return TokenChargeDecisionRequest.model_validate(
        {"message": message, "recent_messages": recent_messages or []}
    )


@pytest.mark.parametrize(
    "message",
    [
        "直接给我答案，不要再提问。",
        "请直接给我完整答案，不要再提示。",
        "别绕了，告诉我这题的解法。",
        "不要问我，直接把函数补全。",
        "把这段代码写完给我。",
        "Give me the answer directly. Do not ask another question.",
        "Tell me the final solution now. Do not guide me.",
        "Stop hinting and solve this exercise for me.",
        "Complete this function for me.",
    ],
)
def test_explicit_direct_requests_charge_without_llm_classification(message):
    provider = FakeChatProvider(RuntimeError("must not be called"))

    result = decide_token_charge(request(message), provider)

    assert result.chargeable is True
    assert result.reason_code == "deterministic_direct_request"
    assert result.decision_source == "deterministic_fallback"
    assert provider.calls == 0


@pytest.mark.parametrize(
    "message, expected_reason",
    [
        ("不要直接给我答案，只给提示。", "negated_direct_request"),
        ("Give me one hint.", "negated_direct_request"),
        ("你会直接给答案吗？", "meta_direct_answer_question"),
        ("Can you give direct answers?", "meta_direct_answer_question"),
        ("老师说“直接给答案”是什么意思？", "meta_direct_answer_question"),
    ],
)
def test_hard_free_requests_never_call_llm_or_charge(message, expected_reason):
    provider = FakeChatProvider(RuntimeError("must not be called"))

    result = decide_token_charge(request(message), provider)

    assert result.chargeable is False
    assert result.reason_code == expected_reason
    assert provider.calls == 0


def test_ordinary_request_is_free_without_llm_classification():
    provider = FakeChatProvider(RuntimeError("must not be called"))

    result = decide_token_charge(request("为什么 list[4] 会报错？"), provider)

    assert result.chargeable is False
    assert result.reason_code == "deterministic_free_default"
    assert provider.calls == 0


def test_contextual_referential_request_uses_llm_after_task_antecedent():
    provider = FakeChatProvider(
        {
            "chargeable": True,
            "reason_code": "context_resolved_direct_request",
            "confidence": 0.93,
            "decision_source": "llm",
            "model": "fake-token-charge-model",
        }
    )
    result = decide_token_charge(
        request(
            "那就直接说吧",
            [{"role": "student", "content": "这道 Python list 索引题为什么报错？"}],
        ),
        provider,
    )

    assert result.chargeable is True
    assert result.reason_code == "context_resolved_direct_request"
    assert result.decision_source == "llm"
    assert provider.calls == 1


def test_contextual_referential_request_stays_free_when_llm_rejects_it():
    provider = FakeChatProvider(
        {
            "chargeable": False,
            "reason_code": "ordinary_tutoring_request",
            "confidence": 0.93,
            "decision_source": "llm",
            "model": "fake-token-charge-model",
        }
    )

    result = decide_token_charge(
        request("那就直接说吧", [{"role": "student", "content": "这道 Python list 索引题为什么报错？"}]),
        provider,
    )

    assert result.chargeable is False
    assert result.reason_code == "deterministic_free_default"
    assert provider.calls == 1


def test_referential_message_without_task_context_is_free_without_llm():
    provider = FakeChatProvider(RuntimeError("must not be called"))

    result = decide_token_charge(request("那就直接说吧"), provider)

    assert result.chargeable is False
    assert provider.calls == 0


def test_deterministic_entrypoint_uses_the_same_canonical_decision():
    assert deterministic_token_charge_decision("别问我了，把这道题的正确答案告诉我").chargeable is True
    assert deterministic_token_charge_decision("不要给我正确答案").chargeable is False
