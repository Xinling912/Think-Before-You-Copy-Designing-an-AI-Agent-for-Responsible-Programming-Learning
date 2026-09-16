from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import SessionStepRequest, TokenChargeDecisionResponse


client = TestClient(app)


def _valid_payload() -> dict:
    return {
        "message": "直接告诉我答案",
        "recent_messages": [],
        "active_topic": "Concept:list",
        "selected_node_id": "Concept:list",
    }


def test_token_charge_endpoint_serializes_valid_decision(monkeypatch):
    monkeypatch.setattr(
        "app.main.decide_token_charge",
        lambda request: TokenChargeDecisionResponse(
            chargeable=True,
            reason_code="direct_solution_request",
            confidence=0.98,
            decision_source="llm",
            model="qwen-max",
        ),
    )

    response = client.post("/internal/token-charge/decision", json=_valid_payload())

    assert response.status_code == 200
    assert response.json() == {
        "chargeable": True,
        "reason_code": "direct_solution_request",
        "confidence": 0.98,
        "decision_source": "llm",
        "model": "qwen-max",
    }


def test_token_charge_endpoint_rejects_empty_message(monkeypatch):
    called = False

    def should_not_call(request):
        nonlocal called
        called = True

    monkeypatch.setattr("app.main.decide_token_charge", should_not_call)
    payload = _valid_payload()
    payload["message"] = "   "

    response = client.post("/internal/token-charge/decision", json=payload)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_token_charge_request"
    assert called is False


def test_token_charge_endpoint_rejects_ninth_recent_message():
    payload = _valid_payload()
    payload["recent_messages"] = [
        {"role": "student", "content": f"message {index}"}
        for index in range(9)
    ]

    response = client.post("/internal/token-charge/decision", json=payload)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_token_charge_request"


def test_token_charge_endpoint_rejects_invalid_recent_message_role():
    payload = _valid_payload()
    payload["recent_messages"] = [{"role": "system", "content": "hidden"}]

    response = client.post("/internal/token-charge/decision", json=payload)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_token_charge_request"


def test_token_charge_endpoint_rejects_extra_request_property():
    payload = _valid_payload()
    payload["unexpected"] = True

    response = client.post("/internal/token-charge/decision", json=payload)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_token_charge_request"


@pytest.mark.parametrize("payload", [[], None])
def test_token_charge_endpoint_rejects_non_object_payload(payload):
    response = client.post("/internal/token-charge/decision", json=payload)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_token_charge_request"


def test_session_step_request_declares_and_validates_gateway_charge_decision():
    payload = {
        "session_id": "session-token-contract",
        "client_turn_id": "turn-token-contract",
        "message": "解释 list",
        "token_charge_decision": {
            "chargeable": False,
            "reason_code": "ordinary_tutoring_request",
            "confidence": 0.96,
            "decision_source": "llm",
            "model": "qwen-max",
        },
    }

    parsed = SessionStepRequest.model_validate(payload)

    assert parsed.token_charge_decision is not None
    assert parsed.token_charge_decision.reason_code == "ordinary_tutoring_request"

    invalid_payload = {
        **payload,
        "token_charge_decision": {
            **payload["token_charge_decision"],
            "chargeable": True,
        },
    }
    response = client.post("/ai/session/step", json=invalid_payload)

    assert response.status_code == 422
