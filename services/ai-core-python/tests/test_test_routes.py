from __future__ import annotations

from fastapi.testclient import TestClient

from app.dashscope import DashScopeAPIError
from app.main import app
from app.schemas import (
    TestJudgeResponse as JudgeResponseSchema,
    TestQuestionGenerationResponse as QuestionGenerationResponseSchema,
)
from app.structured_output import StructuredOutputFailure


client = TestClient(app)


def _catalog() -> list[dict[str, str]]:
    return [
        {
            "id": f"topic_{index:02d}",
            "label": f"Topic {index:02d}",
            "summary": f"Beginner summary {index:02d}.",
            "icon": f"Icon{index:02d}",
        }
        for index in range(20)
    ]


def _question_request() -> dict:
    catalog = _catalog()
    return {
        "catalog": catalog,
        "selected_topic": catalog[0],
        "current_progress": 0,
        "level": 1,
        "difficulty_prompt": "Exact difficulty.",
        "recent_questions": [],
    }


def _judge_request() -> dict:
    return {
        "topic_id": "topic_00",
        "level": 1,
        "question_format": "multiple_choice",
        "question_text": "What does assignment do?",
        "options": ["Binds a name", "Deletes data", "Imports code", "Stops Python"],
        "expected_answer": "Binds a name",
        "accepted_equivalents": ["It binds the name"],
        "grading_rubric": ["Accept name binding"],
        "student_answer": "It binds the name",
    }


def _question_response() -> QuestionGenerationResponseSchema:
    return QuestionGenerationResponseSchema(
        topic_id="topic_00",
        level=1,
        question_format="multiple_choice",
        question_text="What does assignment do?",
        options=["Binds a name", "Deletes data", "Imports code", "Stops Python"],
        expected_answer="Binds a name",
        accepted_equivalents=["It binds the name"],
        grading_rubric=["Accept name binding"],
        beginner_difficulty=True,
        kg_grounding={"selected_node_ids": [], "kg_gap": True},
        provider="dashscope",
        model="qwen-test",
        token_usage={"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
    )


def _judge_response() -> JudgeResponseSchema:
    return JudgeResponseSchema(
        is_correct=True,
        score=1.0,
        reason="The answer matches.",
        feedback="Correct answer.",
        provider="dashscope",
        model="qwen-judge",
        token_usage={"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
    )


def test_internal_question_and_judge_routes_return_success_contracts(monkeypatch):
    monkeypatch.setattr("app.main.generate_test_question", lambda request: _question_response())
    monkeypatch.setattr("app.main.judge_test_answer", lambda request: _judge_response())

    question = client.post("/internal/tests/question", json=_question_request())
    judgment = client.post("/internal/tests/judge", json=_judge_request())

    assert question.status_code == 200
    assert question.json() == _question_response().model_dump(mode="json")
    assert judgment.status_code == 200
    assert judgment.json() == _judge_response().model_dump(mode="json")
    assert "progress" not in judgment.json()
    assert "increment" not in judgment.json()


def test_invalid_internal_request_returns_400_without_ai_call(monkeypatch):
    called = False

    def should_not_call(request):
        nonlocal called
        called = True

    monkeypatch.setattr("app.main.generate_test_question", should_not_call)
    payload = _question_request()
    payload["selected_topic"] = {**payload["selected_topic"], "summary": "Mismatch"}

    response = client.post("/internal/tests/question", json=payload)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_test_question_request"
    assert response.json()["validation_errors"]
    assert called is False


def test_unrepaired_validation_failure_is_top_level_502_with_usage(monkeypatch):
    failure = StructuredOutputFailure(
        error="generation_failed",
        validation_errors=["topic_id must equal selected_topic.id"],
        provider="dashscope",
        model="qwen-repair",
        token_usage={"prompt_tokens": 8, "completion_tokens": 10, "total_tokens": 18, "usage_unavailable": False},
    )
    monkeypatch.setattr("app.main.generate_test_question", lambda request: (_ for _ in ()).throw(failure))

    response = client.post("/internal/tests/question", json=_question_request())

    assert response.status_code == 502
    assert response.json() == {
        "error": "generation_failed",
        "validation_errors": ["topic_id must equal selected_topic.id"],
        "provider": "dashscope",
        "model": "qwen-repair",
        "token_usage": {"prompt_tokens": 8, "completion_tokens": 10, "total_tokens": 18, "usage_unavailable": False},
    }


def test_provider_failure_is_top_level_502_with_empty_usage(monkeypatch):
    monkeypatch.setattr(
        "app.main.judge_test_answer",
        lambda request: (_ for _ in ()).throw(DashScopeAPIError("provider unavailable")),
    )

    response = client.post("/internal/tests/judge", json=_judge_request())

    assert response.status_code == 502
    assert response.json()["error"] == "provider_failed"
    assert response.json()["provider"] == "dashscope"
    assert response.json()["validation_errors"] == []
    assert response.json()["token_usage"] == {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "usage_unavailable": True,
    }


def test_private_test_routes_are_never_registered_under_ai_prefix():
    paths = {route.path for route in app.routes}

    assert "/internal/tests/question" in paths
    assert "/internal/tests/judge" in paths
    assert not any(path.startswith("/ai/tests/") for path in paths)
    assert client.post("/ai/tests/question", json=_question_request()).status_code == 404
    assert client.post("/ai/tests/judge", json=_judge_request()).status_code == 404


def test_invalid_requested_focus_returns_422_from_step_and_stream():
    payload = {
        "session_id": "invalid-focus",
        "client_turn_id": "invalid-focus-turn",
        "message": "teach me functions",
        "requested_focus_node_id": "Concept:not_in_catalog",
    }

    step = client.post("/ai/session/step", json=payload)
    stream = client.post("/ai/session/step/stream", json=payload)

    for response in (step, stream):
        assert response.status_code == 422
        assert response.json() == {
            "error": "invalid_focus_node_id",
            "requested_focus_node_id": "Concept:not_in_catalog",
        }
