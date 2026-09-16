import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app import session
from app.kg import shortest_learning_path
from app.query_understanding import QueryUnderstandingResult
from app.main import app
from app.schemas import TokenChargeDecisionResponse
from app.conversation_projection import ConversationProjection
from app.token_charge_decision import deterministic_token_charge_decision
from app.turn_resolution import (
    SelectedNodeResolution,
    TurnResolution,
    resolve_turn as resolve_turn_contract,
)


def topic_projection(
    *,
    canonical_topic="Concept:index",
    label="index",
    workflow_state="retrieve_first",
    active_gate_id="student-learning/retrieve-first-gate",
    hint_level=0,
    next_required_action="student_attempt",
    confidence_before=0.4,
    teach_back_required=False,
    last_kg_path=None,
):
    return {
        "schema_version": 1,
        "last_sequence": 1,
        "active_topic_id": "topic-current",
        "back_stack": [],
        "topics": {
            "topic-current": {
                "topic_id": "topic-current",
                "canonical_topic": canonical_topic,
                "topic_label": label,
                "aliases": [label],
                "status": "active",
                "summary": f"{label} summary",
                "unresolved_question": f"{label} question",
                "turn_ids": ["previous-turn"],
                "active_kg_focus_node_id": canonical_topic,
                "last_kg_path": list(last_kg_path or [canonical_topic]),
                "last_rag_chunk_ids": ["previous-chunk"],
                "pedagogy_state": {
                    "workflow_state": workflow_state,
                    "active_gate_id": active_gate_id,
                    "hint_level": hint_level,
                    "next_required_action": next_required_action,
                    "confidence_before": confidence_before,
                    "confidence_after": None,
                    "teach_back_required": teach_back_required,
                },
                "created_at": "2026-07-20T00:00:00Z",
                "last_active_at": "2026-07-20T00:00:00Z",
            }
        },
    }


def fake_search_chunks(query: str, concepts: list[str] | None = None, top_k: int = 5) -> dict:
    return {
        "retrieval_mode": "semantic-vector-rerank",
        "kg_guided": bool(concepts),
        "index": {
            "backend": "faiss-flat-ip",
            "embedding_provider": "dashscope",
            "embedding_model": "text-embedding-v4",
            "document_count": 169,
        },
        "reranker": {
            "enabled": True,
            "provider": "dashscope",
            "model": "qwen3-rerank",
            "candidate_count": 20,
        },
        "chunks": [
            {
                "chunk_id": "python-docs-3.14.6-list",
                "source": "python-official-docs",
                "concepts": ["Concept:list", "Concept:index"],
                "score": 0.91,
                "embedding_score": 0.77,
                "rerank_score": 0.91,
                "title": "5.1. More on Lists",
                "heading_path": ["5. Data Structures", "5.1. More on Lists"],
                "source_url": "https://docs.python.org/3/tutorial/datastructures.html#more-on-lists",
            },
        ],
    }


def fake_understand_index_error(message: str) -> QueryUnderstandingResult:
    return QueryUnderstandingResult(
        intent="debugging_question",
        raw_message=message,
        retrieval_query="Python list IndexError valid index range",
        concept_hints=["Concept:list", "Concept:index", "ErrorType:IndexError"],
        needs_code=True,
        risk="direct_answer_dependency",
        llm_used=False,
        llm_fallback=True,
        chat_model="qwen3.7-max",
    )


def test_session_first_step_uses_retrieve_first_gate(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="error_debugging",
            raw_message=message,
            retrieval_query="Python list index IndexError valid index range",
            concept_hints=["Concept:list", "Concept:index", "ErrorType:IndexError"],
            needs_code=False,
            risk="direct_answer_dependency",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert workflow["allow_direct_answer"] is False
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "为什么我的 Python list 报 IndexError？",
            "stage": "start",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["skill_id"] == "student-learning/retrieve-first-gate"
    assert body["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["active_gate_id"] == "student-learning/retrieve-first-gate"
    assert body["requires_student_attempt"] is True
    assert body["direct_answer_given"] is False
    assert body["allow_direct_answer"] is False
    assert body["skill_state"]["state"] == "retrieve_first"
    assert body["skill_state"]["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["skill_state"]["active_gate_id"] == "student-learning/retrieve-first-gate"
    assert body["skill_state"]["prompt_key"] == "retrieve_first"
    assert body["skill_state"]["allow_direct_answer"] is False
    assert body["skill_state"]["direct_answer_given"] is False
    assert body["workflow_trace"] == body["skill_state"]["workflow_trace"]
    assert body["pedagogical_workflow"]["workflow_trace"] == body["workflow_trace"]
    assert body["evidence"]["workflow_trace"] == body["workflow_trace"]
    first_trace = {item["skill_id"]: item["status"] for item in body["workflow_trace"]}
    assert first_trace == {
        "student-learning/retrieve-first-gate": "active",
        "student-learning/confidence-calibration-check": "pending",
        "student-learning/stuck-and-error-diagnosis-coach": "waiting",
        "student-learning/progressive-hint-ladder": "waiting",
        "student-learning/teach-back-evaluator": "waiting",
    }
    assert body["pedagogical_workflow"]["next_required_action"] == "student_attempt"
    assert body["pedagogical_workflow"]["hint_level"] == body["hint_level"]
    assert body["evidence"]["cognitive_gate"] == "retrieval"
    assert body["evidence"]["teach_back"] == "not_required"
    assert body["evidence"]["skill_state"]["state"] == "retrieve_first"
    assert body["evidence"]["pedagogical_workflow"]["allow_direct_answer"] is False
    assert body["evidence"]["hint_level"] == body["hint_level"]
    assert body["evidence"]["next_required_action"] == "student_attempt"
    assert body["evidence"]["confidence_before_required"] is False
    assert body["evidence"]["confidence_after_required"] is False
    assert body["evidence"]["teach_back_score"] is None
    assert body["evidence"]["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["evidence"]["active_gate_id"] == "student-learning/retrieve-first-gate"
    assert body["evidence"]["llm_guardrail_triggered"] is False
    assert body["kg_path"][-1] == "ErrorType:IndexError"
    assert body["kg_algorithm"] in {
        "catalog_similarity_fallback",
        "qwen_kg_grounding",
        "weighted-multi-hop-graph-search",
    }
    assert body["kg_topic_id"]
    assert body["rag_retrieval_mode"] == "semantic-vector-rerank"
    assert body["rag_kg_guided"] is True
    assert body["rag_index"]["embedding_model"] == "text-embedding-v4"
    assert body["rag_reranker"]["enabled"] is True
    assert body["rag_reranker"]["model"] == "qwen3-rerank"
    assert body["rag_sources"][0]["source"] == "python-official-docs"
    assert body["rag_sources"][0]["chunk_id"] != "python-list-index-001"
    assert body["rag_sources"][0]["score"] > 0
    assert body["rag_sources"][0]["rerank_score"] > 0
    assert body["rag_sources"][0]["source_url"].startswith("https://docs.python.org/3/")
    assert body["hint_ladder"][0]["level"] == 1


def test_session_step_uses_rewritten_query_and_qwen_teaching_response(monkeypatch):
    searched = {}

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        assert message == "我不知道索引是什么"
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python list index zero-based indexing valid index range",
            concept_hints=["Concept:list", "Concept:index", "Concept:zero_based_index"],
            needs_code=False,
            risk="direct_answer_dependency",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen3.7-max",
        )

    def fake_search_with_rewrite(query: str, concepts: list[str] | None = None, top_k: int = 5) -> dict:
        searched["query"] = query
        searched["concepts"] = concepts
        return fake_search_chunks(query, concepts, top_k)

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["query_understanding"].retrieval_query == "Python list index zero-based indexing valid index range"
        assert kwargs["allow_direct_answer"] is False
        assert kwargs["skill_action"]["allow_direct_answer"] is False
        return {
            "prompt": "索引是列表元素的位置编号。Python 从 0 开始数。先判断：3 个元素的列表，合法索引有哪些？",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
            "direct_answer_contract": {"valid": True, "question_free": True},
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_with_rewrite)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我不知道索引是什么",
            "stage": "start",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert searched["query"] == body["turn_resolution"]["retrieval_query"]
    assert set(body["kg_path"]) <= set(searched["concepts"])
    assert set(body["concept_hints"]) <= set(searched["concepts"])
    assert body["prompt"].startswith("索引是列表元素的位置编号")
    assert body["intent"] == "concept_question"
    assert body["rewritten_query"] == "Python list index zero-based indexing valid index range"
    assert body["chat_model"] == "qwen3.7-max"
    assert body["llm_used"] is True
    assert body["llm_fallback"] is False
    assert body["teaching_strategy"] == "retrieve-first-with-evidence"
    trace = body["learning_trace"]
    assert trace["query_understanding"]["intent"] == "concept_question"
    assert trace["query_understanding"]["rewritten_query"] == "Python list index zero-based indexing valid index range"
    assert trace["query_understanding"]["concept_hints"] == [
        "Concept:list",
        "Concept:index",
        "Concept:zero_based_index",
    ]
    assert trace["kg_grounding"]["selected_node_ids"]
    assert trace["kg_grounding"]["nodes"]
    assert trace["rag_evidence"][0]["title"]
    assert trace["rag_evidence"][0]["url"]
    assert trace["teaching_decision"]["direct_answer"] is False
    assert trace["answer"].startswith("索引是列表元素的位置编号")
    assert body["evidence"]["intent"] == "concept_question"
    assert body["evidence"]["rewritten_query"] == "Python list index zero-based indexing valid index range"
    assert body["evidence"]["chat_model"] == "qwen3.7-max"
    assert body["direct_answer_given"] is False
    assert body["skill_state"]["allow_direct_answer"] is False
    assert body["skill_state"]["direct_answer_given"] is False
    assert body["evidence"]["pedagogical_workflow"]["direct_answer_given"] is False


def test_session_step_stream_returns_ordered_real_events(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python list index zero-based indexing valid index range",
            concept_hints=["Concept:list", "Concept:index", "Concept:zero_based_index"],
            needs_code=False,
            risk="direct_answer_dependency",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        return {
            "prompt": "索引是列表元素的位置编号。Python 从 0 开始数。先判断：4 个元素的列表，合法索引有哪些？",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
            "direct_answer_contract": {"valid": True, "question_free": True},
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/ai/session/step/stream",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我不知道索引是什么",
            "stage": "start",
        },
    ) as response:
        assert response.status_code == 200
        events = [json.loads(line) for line in response.iter_lines() if line]

    assert [event["type"] for event in events] == [
        "trace_started",
        "query_understanding_done",
        "kg_grounding_done",
        "rag_evidence_done",
        "guided_response_done",
        "trace_completed_payload",
    ]
    assert events[1]["query_understanding"]["rewritten_query"] == "Python list index zero-based indexing valid index range"
    assert events[2]["kg_grounding"]["knowledge_path_view"]
    assert "current" in events[2]["kg_grounding"]["knowledge_path_view"]
    assert events[3]["rag_evidence"]
    assert events[4]["answer"].startswith("索引是列表元素的位置编号")
    assert events[5]["response"]["learning_trace"]["query_understanding"]["rewritten_query"] == "Python list index zero-based indexing valid index range"


def test_omitted_focus_preserves_recent_messages_and_normal_answer(monkeypatch):
    captured = {}
    real_ground_question = session.ground_question

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python function",
            concept_hints=["Concept:function"],
            needs_code=False,
            risk="normal",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        captured["recent_messages"] = kwargs["recent_messages"]
        return {
            "prompt": "A function groups reusable behavior. What would you name a function that adds two values?",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    def capturing_ground_question(
        question: str,
        *,
        current_concept_hints=None,
        historical_concept_ids=None,
        requested_focus_node_id=None,
    ) -> dict:
        captured["grounding_question"] = question
        captured["current_concept_hints"] = current_concept_hints or []
        captured["historical_concept_ids"] = historical_concept_ids or []
        return real_ground_question(
            question,
            current_concept_hints=current_concept_hints,
            historical_concept_ids=historical_concept_ids,
            requested_focus_node_id=requested_focus_node_id,
        )

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "ground_question", capturing_ground_question)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)

    response = TestClient(app).post(
        "/ai/session/step",
        json={
            "session_id": "focus-omitted",
            "client_turn_id": "legacy-test-turn",
            "message": "what is a function?",
            "recent_messages": [
                {"role": "student", "content": "Earlier we discussed Concept:set."},
                {"role": "agent", "content": "Sets contain unique values."},
            ],
            "task_state": {"current_concept": "Concept:set"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert captured["recent_messages"][0]["content"] == "Earlier we discussed Concept:set."
    assert captured["grounding_question"] == "what is a function?"
    assert captured["current_concept_hints"] == ["Concept:function"]
    assert captured["historical_concept_ids"] == []
    assert body["prompt"].startswith("A function groups reusable behavior.")
    assert [node["id"] for node in body["learning_trace"]["kg_grounding"]["knowledge_path_view"]["current"]] == ["Concept:function"]
    assert body["kg_grounding"]["requested_focus_node_id"] is None


def test_stream_and_non_stream_focus_views_match(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python set",
            concept_hints=["Concept:set"],
            needs_code=False,
            risk="normal",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        return {
            "prompt": "Let us focus on functions. What inputs should this function accept?",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    payload = {
        "session_id": "focus-parity",
            "client_turn_id": "legacy-test-turn",
        "message": "tell me about sets",
        "requested_focus_node_id": "Concept:function",
    }
    client = TestClient(app)

    non_stream = client.post("/ai/session/step", json=payload)
    with client.stream("POST", "/ai/session/step/stream", json=payload) as stream_response:
        events = [json.loads(line) for line in stream_response.iter_lines() if line]

    assert non_stream.status_code == 200
    assert stream_response.status_code == 200
    assert events[2]["kg_grounding"]["knowledge_path_view"] == non_stream.json()["learning_trace"]["kg_grounding"]["knowledge_path_view"]
    assert events[2]["kg_grounding"]["focus_source"] == "explicit"


def test_stream_reuses_single_current_question_grounding_without_explicit_focus(monkeypatch):
    understand_results = iter(
        [
            QueryUnderstandingResult(
                intent="concept_question",
                raw_message="what is a function?",
                retrieval_query="Python function",
                concept_hints=["Concept:function"],
                needs_code=False,
                risk="normal",
                llm_used=False,
                llm_fallback=True,
                chat_model="qwen3.7-max",
            ),
            QueryUnderstandingResult(
                intent="concept_question",
                raw_message="what is a function?",
                retrieval_query="Python set",
                concept_hints=["Concept:set"],
                needs_code=False,
                risk="normal",
                llm_used=False,
                llm_fallback=True,
                chat_model="qwen3.7-max",
            ),
        ]
    )
    understand_calls = 0

    def sequential_understand_query(message: str) -> QueryUnderstandingResult:
        nonlocal understand_calls
        understand_calls += 1
        return next(understand_results)

    def fake_generate_teaching_response(**kwargs):
        return {
            "prompt": "A function groups reusable behavior. What inputs should it accept?",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", sequential_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)

    with TestClient(app).stream(
        "POST",
        "/ai/session/step/stream",
        json={"session_id": "single-stream-grounding", "client_turn_id": "legacy-test-turn", "message": "what is a function?"},
    ) as response:
        events = [json.loads(line) for line in response.iter_lines() if line]

    streamed_view = events[2]["kg_grounding"]["knowledge_path_view"]
    completed_view = events[5]["response"]["learning_trace"]["kg_grounding"]["knowledge_path_view"]
    assert understand_calls == 1
    assert streamed_view == completed_view
    assert [node["id"] for node in streamed_view["current"]] == ["Concept:function"]


def test_session_step_augments_rewritten_query_with_dynamic_kg_path(monkeypatch):
    searched = {}

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="error_debugging",
            raw_message=message,
            retrieval_query="Python list IndexError causes and debugging",
            concept_hints=["Concept:list", "ErrorType:IndexError"],
            needs_code=True,
            risk="normal",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen3.7-max",
        )

    def fake_ground_question(question: str, **kwargs) -> dict:
        return {
            "topic_id": "Concept:list",
            "topic_label": "list",
            "source_node_id": "Concept:list",
            "target_node_id": "ErrorType:IndexError",
            "selected_node_ids": ["Concept:list", "ErrorType:IndexError"],
            "candidate_nodes": [],
            "path": [
                "Concept:list",
                "Concept:index",
                "Concept:zero_based_index",
                "Concept:valid_index_range",
                "ErrorType:IndexError",
            ],
            "path_edges": [],
            "method": "catalog_similarity_fallback",
            "confidence": 1.0,
            "reason": "test",
            "kg_gap": False,
        }

    def fake_search_with_augmented_query(query: str, concepts: list[str] | None = None, top_k: int = 5) -> dict:
        searched["query"] = query
        searched["concepts"] = concepts
        return fake_search_chunks(query, concepts, top_k)

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["query_understanding"].retrieval_query == "Python list IndexError causes and debugging"
        return {
            "prompt": kwargs["skill_action"]["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "ground_question", fake_ground_question)
    monkeypatch.setattr(session, "search_chunks", fake_search_with_augmented_query)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "为什么我的 Python list 报 IndexError？",
            "stage": "start",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert searched["query"] == body["turn_resolution"]["retrieval_query"]
    assert "zero based index" not in searched["query"]
    assert "valid index range" not in searched["query"]
    assert body["rewritten_query"] == "Python list IndexError causes and debugging"


def test_session_full_memory_attempt_requires_confidence_before(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="debugging_question",
            raw_message=message,
            retrieval_query="Python list IndexError valid index range",
            concept_hints=["Concept:list", "Concept:index"],
            needs_code=True,
            risk="direct_answer_dependency",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert kwargs["baseline_mode"] == "full_memory"
        assert workflow["state"] == "confidence_before_required"
        assert workflow["skill_id"] == "student-learning/confidence-calibration-check"
        assert workflow["primary_skill_id"] == "student-learning/adaptive-python-workflow"
        assert workflow["active_gate_id"] == "student-learning/confidence-calibration-check"
        assert workflow["allow_direct_answer"] is False
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "last_evidence": {},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["skill_id"] == "student-learning/confidence-calibration-check"
    assert body["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["active_gate_id"] == "student-learning/confidence-calibration-check"
    assert body["state"] == "confidence_before_required"
    assert body["confidence_before_required"] is True
    assert body["allow_direct_answer"] is False
    assert body["direct_answer_given"] is False
    assert body["next_required_action"] == "collect_confidence_before"
    assert body["evidence"]["pedagogical_workflow"]["state"] == "confidence_before_required"
    assert body["evidence"]["confidence_before_required"] is True


def test_session_full_memory_attempt_with_confidence_enters_diagnosis_skill(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert kwargs["baseline_mode"] == "full_memory"
        assert workflow["skill_id"] == "student-learning/stuck-and-error-diagnosis-coach"
        assert workflow["active_gate_id"] == "student-learning/stuck-and-error-diagnosis-coach"
        assert workflow["state"] == "hint_level_1"
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                confidence_before=0.6,
            ),
            "last_evidence": {"confidence_before": 3},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["skill_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert body["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["active_gate_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert body["state"] == "hint_level_1"
    assert body["next_required_action"] == "diagnose_learning_gap"
    assert body["direct_answer_given"] is False
    assert body["pedagogical_workflow"]["skill_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert body["pedagogical_workflow"]["prompt_key"] == "hint_level_1"
    assert body["hint_ladder"][0]["skill_id"] == "student-learning/progressive-hint-ladder"


def test_session_full_memory_correct_reasoning_requires_teach_back_skill(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert workflow["skill_id"] == "student-learning/teach-back-evaluator"
        assert workflow["state"] == "teach_back_required"
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "这个规则必须对照代码和结果，因为当前操作会导致异常；例如 list[2] 这个例子，下一步我会检查教材证据。",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                confidence_before=0.8,
            ),
            "last_evidence": {"confidence_before": 4},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["skill_id"] == "student-learning/teach-back-evaluator"
    assert body["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert body["state"] == "teach_back_required"
    assert body["teach_back_required"] is True
    assert body["next_required_action"] == "teach_back"
    assert body["direct_answer_given"] is False


def test_session_full_memory_teach_back_submission_uses_evaluator(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert workflow["skill_id"] == "student-learning/teach-back-evaluator"
        assert workflow["state"] == "teach_back_evaluated"
        assert workflow["confidence_after_required"] is True
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "规则是操作必须满足教材条件，因为当前代码导致异常；例如这个代码片段的结果和预期不一致，下一步检查文档证据。",
            "stage": "teach_back",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                workflow_state="teach_back_required",
                active_gate_id="student-learning/teach-back-evaluator",
                next_required_action="teach_back",
                confidence_before=0.8,
                teach_back_required=True,
            ),
            "task_state": {"teach_back_required": True},
            "last_evidence": {
                "evidence": {"confidence_before": 4},
                "pedagogical_workflow": {
                    "state": "teach_back_required",
                    "teach_back_required": True,
                    "prompt_key": "teach_back_required",
                },
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["skill_id"] == "student-learning/teach-back-evaluator"
    assert body["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert body["state"] == "teach_back_evaluated"
    assert body["teach_back_score"] >= 0.8
    assert body["confidence_after_required"] is True
    assert body["next_required_action"] == "collect_confidence_after"


def test_session_teach_back_task_state_start_stage_uses_evaluator(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert workflow["skill_id"] == "student-learning/teach-back-evaluator"
        assert workflow["state"] == "teach_back_evaluated"
        assert workflow["allow_direct_answer"] is False
        assert workflow["next_required_action"] == "repair_teach_back"
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "就是会报错",
            "stage": "start",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                workflow_state="teach_back_required",
                active_gate_id="student-learning/teach-back-evaluator",
                next_required_action="teach_back",
                confidence_before=0.6,
                teach_back_required=True,
            ),
            "task_state": {"teach_back_required": True},
            "last_evidence": {"confidence_before": 3},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert body["state"] == "teach_back_evaluated"
    assert body["teach_back_required"] is True
    assert body["allow_direct_answer"] is False
    assert body["direct_answer_given"] is False
    assert body["next_required_action"] == "repair_teach_back"


def test_session_rag_kg_skills_uses_pedagogical_gates(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert kwargs["baseline_mode"] == "rag_kg_skills"
        assert kwargs["learner_memory"] == []
        assert workflow["skill_id"] == "student-learning/confidence-calibration-check"
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "rag_kg_skills",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["baseline_mode"] == "rag_kg_skills"
    assert body["skill_id"] == "student-learning/confidence-calibration-check"
    assert body["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert body["active_gate_id"] == "student-learning/confidence-calibration-check"
    assert body["confidence_before_required"] is True
    assert body["memory_used"] is False


def test_session_no_rag_baseline_allows_direct_answer_without_pedagogical_gates(monkeypatch):
    def fail_if_search_called(*args, **kwargs):
        raise AssertionError("no_rag baseline must not call RAG search")

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["baseline_mode"] == "no_rag"
        assert kwargs["allow_direct_answer"] is True
        assert kwargs["skill_action"]["skill_id"] == "baseline/no-rag"
        assert kwargs["skill_action"]["direct_answer_given"] is False
        assert kwargs["kg_result"]["path"] == []
        assert kwargs["rag_sources"] == []
        return {
            "prompt": "No RAG direct answer",
            "teaching_strategy": "no-rag-answer",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fail_if_search_called)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "直接告诉我 IndexError 是什么",
            "baseline_mode": "no_rag",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["skill_id"] == "baseline/no-rag"
    assert body["primary_skill_id"] == "baseline/no-rag"
    assert body["active_gate_id"] == "baseline/no-rag"
    assert body["allow_direct_answer"] is True
    assert body["direct_answer_given"] is False
    assert body["evidence"]["direct_answer_given"] is False
    assert body["confidence_before_required"] is False
    assert body["evidence"]["cognitive_gate"] == "skipped"
    assert body["kg_path"] == []
    assert body["rag_sources"] == []
    trace = {item["skill_id"]: item["status"] for item in body["workflow_trace"]}
    assert trace == {
        "student-learning/retrieve-first-gate": "skipped",
        "student-learning/confidence-calibration-check": "skipped",
        "student-learning/stuck-and-error-diagnosis-coach": "skipped",
        "student-learning/progressive-hint-ladder": "skipped",
        "student-learning/teach-back-evaluator": "skipped",
    }
    assert body["skill_state"]["workflow_trace"] == body["workflow_trace"]
    assert body["pedagogical_workflow"]["workflow_trace"] == body["workflow_trace"]
    assert body["evidence"]["workflow_trace"] == body["workflow_trace"]


def test_session_public_workflow_structures_do_not_share_mutable_references(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)

    step = session.next_session_step(
        session_id="copy-check",
        message="为什么我的 Python list 报 IndexError？",
        stage="start",
        baseline_mode="full_memory",
    )

    assert step["skill_state"] == step["pedagogical_workflow"]
    assert step["skill_state"] == step["evidence"]["skill_state"]
    assert step["workflow_trace"] == step["skill_state"]["workflow_trace"]

    step["skill_state"]["state"] = "mutated"
    step["skill_state"]["workflow_trace"][0]["status"] = "mutated"

    assert step["pedagogical_workflow"]["state"] == "retrieve_first"
    assert step["evidence"]["skill_state"]["state"] == "retrieve_first"
    assert step["workflow_trace"][0]["status"] == "active"
    assert step["evidence"]["workflow_trace"][0]["status"] == "active"


def test_session_baseline_marks_direct_answer_given_from_generated_text(monkeypatch):
    def fail_if_search_called(*args, **kwargs):
        raise AssertionError("no_rag baseline must not call RAG search")

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["baseline_mode"] == "no_rag"
        assert kwargs["allow_direct_answer"] is True
        return {
            "prompt": "答案是：while 条件为假时循环停止，所以程序会继续执行后面的代码。",
            "teaching_strategy": "no-rag-answer",
            "direct_answer_contract": {"valid": True, "question_free": True},
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fail_if_search_called)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "直接告诉我 IndexError 是什么",
            "baseline_mode": "no_rag",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["skill_id"] == "baseline/no-rag"
    assert body["allow_direct_answer"] is True
    assert body["direct_answer_given"] is True
    assert body["evidence"]["direct_answer_given"] is True
    assert body["skill_state"]["direct_answer_given"] is True
    assert body["pedagogical_workflow"]["direct_answer_given"] is True
    assert body["evidence"]["pedagogical_workflow"]["direct_answer_given"] is True


def test_session_baseline_detects_synonym_direct_answer(monkeypatch):
    def fail_if_search_called(*args, **kwargs):
        raise AssertionError("no_rag baseline must not call RAG search")

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["baseline_mode"] == "no_rag"
        assert kwargs["allow_direct_answer"] is True
        return {
            "prompt": "print(len(data)) 会输出 3，因为 len 返回容器元素数量。请你判断这个结果来自哪条规则。",
            "teaching_strategy": "no-rag-answer",
            "direct_answer_contract": {"valid": True, "question_free": True},
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fail_if_search_called)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "直接告诉我 IndexError 是什么",
            "baseline_mode": "no_rag",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["direct_answer_given"] is True
    assert body["skill_state"]["direct_answer_given"] is True
    assert body["evidence"]["pedagogical_workflow"]["direct_answer_given"] is True


def test_session_baseline_detects_compact_range_direct_answer_variants(monkeypatch):
    direct_prompts = [
        "`print(len(data))` 输出 3，因为列表里有三个元素。",
        "第一步检查条件，第二步运行分支，所以结果返回 True。",
        "改成在条件满足时 break，就可以停止循环。",
        "函数调用 `items.append(1)` 返回 None，因为它原地修改对象。请你复述。",
    ]

    def fail_if_search_called(*args, **kwargs):
        raise AssertionError("no_rag baseline must not call RAG search")

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fail_if_search_called)
    client = TestClient(app)

    for prompt in direct_prompts:
        def fake_generate_teaching_response(**kwargs):
            assert kwargs["baseline_mode"] == "no_rag"
            assert kwargs["allow_direct_answer"] is True
            return {
                "prompt": prompt,
                "teaching_strategy": "no-rag-answer",
                "llm_used": True,
                "llm_fallback": False,
                "fallback_reason": None,
                "chat_model": "qwen3.7-max",
                "direct_answer_contract": {"valid": True, "question_free": True},
            }

        monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
        response = client.post(
            "/ai/session/step",
            json={
                "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
                "message": "直接告诉我 IndexError 是什么",
                "baseline_mode": "no_rag",
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["direct_answer_given"] is True, prompt
        assert body["skill_state"]["direct_answer_given"] is True, prompt
        assert body["evidence"]["pedagogical_workflow"]["direct_answer_given"] is True, prompt


def test_session_qwen_prompt_includes_skill_action_workflow(monkeypatch):
    captured = {}

    class FakeChatProvider:
        model = "qwen3.7-max"

        def chat(self, messages, temperature=None, max_tokens=None):
            captured["messages"] = messages
            captured["temperature"] = temperature
            captured["max_tokens"] = max_tokens
            return "Qwen 工作流约束回复"

        def chat_with_usage(self, messages, temperature=None, max_tokens=None):
            from app.dashscope import DashScopeChatResponse

            captured["messages"] = messages
            captured["temperature"] = temperature
            captured["max_tokens"] = max_tokens
            return DashScopeChatResponse(
                content="Qwen 工作流约束回复",
                model=self.model,
                usage={
                    "prompt_tokens": 120,
                    "completion_tokens": 30,
                    "total_tokens": 150,
                    "usage_unavailable": False,
                },
            )

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", FakeChatProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "为什么我的 Python list 报 IndexError？",
            "stage": "start",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                workflow_state="retrieve_first",
                active_gate_id="student-learning/retrieve-first-gate",
                hint_level=1,
                confidence_before=0.4,
            ),
            "recent_messages": [
                {"role": "student", "content": "为什么我的 list 报 IndexError？"},
                {"role": "agent", "content": "先写出长度和访问索引。"},
            ],
            "task_state": {"current_concept": "Concept:index", "hint_level": 1},
            "last_evidence": {
                "confidence_before": 2,
                "skill_state": {"state": "retrieve_first"},
            },
            "learner_memory": [
                {
                    "memory_id": "mem_index_001",
                    "memory_type": "misconception",
                    "topic": "Concept:index",
                    "concepts": ["Concept:list", "Concept:index", "ErrorType:IndexError"],
                    "content": "学生可能把 len(list) 当成最大合法索引。",
                }
            ],
        },
    )


    body = response.json()
    assert body["token_usage"]["total_tokens"] == 150
    assert body["learning_trace"]["token_usage"]["total_tokens"] == 150

    assert response.status_code == 200
    body = response.json()
    user_prompt = captured["messages"][1]["content"]
    assert "skill_action/workflow:" in user_prompt
    assert "student-learning/retrieve-first-gate" in user_prompt
    assert "'state': 'retrieve_first'" in user_prompt
    assert "recent_messages: [{'role': 'student', 'content': '为什么我的 list 报 IndexError？'}, {'role': 'agent', 'content': '先写出长度和访问索引。'}]" in user_prompt
    assert "task_state:" in user_prompt
    assert "'current_concept': 'Concept:list'" in user_prompt
    assert "'hint_level': 1" in user_prompt
    assert "last_evidence:" in user_prompt
    assert "'confidence_before': 0.4" in user_prompt
    assert "'state': 'retrieve_first'" in user_prompt
    assert "learner_memory:" in user_prompt
    assert "mem_index_001" in user_prompt
    assert "学生可能把 len(list) 当成最大合法索引。" in user_prompt
    assert "必须服从 skill_action/workflow" in user_prompt
    assert body["prompt"] == "Qwen 工作流约束回复"
    assert body["llm_used"] is True
    assert body["llm_guardrail_triggered"] is False
    assert captured["temperature"] == 0.2
    assert captured["max_tokens"] == 300


def test_session_off_topic_uses_model_reply_without_kg_or_rag(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="off_topic",
            raw_message=message,
            retrieval_query="",
            concept_hints=[],
            needs_code=False,
            risk="normal",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen3.7-max",
            route="off_topic",
            conversation_reply="It is sunny here in the demo. I can also help when you have a Python question.",
        )

    def should_not_run(*args, **kwargs):
        raise AssertionError("off-topic input must not enter KG or RAG")

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "ground_question", should_not_run)
    monkeypatch.setattr(session, "search_chunks", should_not_run)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={"session_id": "off-topic-session", "client_turn_id": "legacy-test-turn", "message": "How is the weather?", "stage": "start"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prompt"] == "No problem. If you have a Python learning question, feel free to ask."
    assert body["rag_sources"] == []
    assert body["kg_path"] == []


def test_session_onboarding_rejects_wrong_language_reply_and_preserves_llm_telemetry(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="greeting",
            raw_message=message,
            retrieval_query="",
            concept_hints=[],
            needs_code=False,
            risk="normal",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen-max",
            route="greeting",
            conversation_reply="你好！有什么关于Python的问题我可以帮助你吗？",
        )

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    response = TestClient(app).post(
        "/ai/session/step",
        json={"session_id": "english-greeting", "client_turn_id": "legacy-test-turn", "message": "hello？", "stage": "start"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prompt"] == (
        "Hi. Please describe the Python question, error message, or code snippet you want to work on, "
        "and I will guide you step by step."
    )
    assert body["llm_used"] is False
    assert body["llm_fallback"] is True
    assert body["fallback_reason"] == "non_retrieval_intent"
    assert body["rag_fallback_reason"] == "onboarding_gate"
    assert body["evidence"]["llm_used"] is False
    assert body["evidence"]["llm_fallback"] is True
    assert body["evidence"]["fallback_reason"] == "non_retrieval_intent"


def test_session_onboarding_keeps_language_compatible_chinese_reply(monkeypatch):
    reply = "你好！请告诉我你遇到的 Python 问题。"

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="greeting",
            raw_message=message,
            retrieval_query="",
            concept_hints=[],
            needs_code=False,
            risk="normal",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen-max",
            route="greeting",
            conversation_reply=reply,
        )

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    response = TestClient(app).post(
        "/ai/session/step",
        json={"session_id": "chinese-greeting", "client_turn_id": "legacy-test-turn", "message": "你好", "stage": "start"},
    )

    assert response.status_code == 200
    assert response.json()["prompt"] == "你好，请告诉我你遇到的 Python 问题、报错信息或代码片段，我会一步步引导你理解。"


def test_session_off_topic_rejects_wrong_language_model_reply(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="off_topic",
            raw_message=message,
            retrieval_query="",
            concept_hints=[],
            needs_code=False,
            risk="normal",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen-max",
            route="off_topic",
            conversation_reply="没问题。如果你有 Python 学习问题，欢迎随时告诉我。",
        )

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    response = TestClient(app).post(
        "/ai/session/step",
        json={
            "session_id": "english-off-topic",
            "client_turn_id": "legacy-test-turn",
            "message": "Let's talk about today's weather.",
            "stage": "start",
        },
    )

    assert response.status_code == 200
    assert response.json()["prompt"] == "No problem. If you have a Python learning question, feel free to ask."


def test_trace_kg_grounding_uses_curriculum_only_as_a_matching_highlight():
    trace = session._trace_kg_grounding(
        {
            "selected_node_ids": ["Concept:list", "Concept:index"],
            "path": ["Concept:list", "Concept:index"],
            "path_edges": [],
            "curriculum_path": {
                "path_id": "path-list-index-range",
                "path_label": "List index range",
                "upstream": ["Concept:variable", "Concept:sequence"],
                "focus": ["Concept:list", "Concept:index", "Concept:valid_index_range"],
                "downstream": ["ErrorType:IndexError", "Concept:debugging"],
                "source_url": "https://docs.python.org/3/tutorial/datastructures.html",
            },
        }
    )

    view = trace["knowledge_path_view"]
    assert [node["id"] for node in view["current"]] == ["Concept:list"]
    assert view["upstream"]
    assert view["downstream"]
    assert all("curriculum_highlighted" in edge for edge in view["edges"])
    assert trace["curriculum_path"]["path_id"] == "path-list-index-range"


def test_trace_kg_grounding_keeps_catalog_direction_when_shortest_path_was_reversed():
    path, path_edges = shortest_learning_path(
        "ErrorType:IndexError",
        "Concept:valid_index_range",
    )
    assert path == ["ErrorType:IndexError", "Concept:valid_index_range"]
    assert path_edges == [
        {
            **path_edges[0],
            "from": "Concept:valid_index_range",
            "to": "ErrorType:IndexError",
            "type": "prevents",
            "traversal": "reverse",
        }
    ]

    trace = session._trace_kg_grounding(
        {
            "selected_node_ids": ["Concept:valid_index_range"],
            "topic_id": "Concept:valid_index_range",
            "path": path,
            "path_edges": path_edges,
        }
    )

    assert {
        "from": "ErrorType:IndexError",
        "to": "Concept:valid_index_range",
        "type": "caused_by",
        "relation": "caused_by",
        "segment": "upstream_to_current",
    } in trace["knowledge_path_view"]["edges"]


def test_build_teaching_messages_compacts_large_evidence_and_memory_context():
    huge_marker = "RAW_EVIDENCE_SHOULD_NOT_BE_SENT_TO_QWEN"
    huge_text = huge_marker + ("x" * 9000)
    messages = session.build_teaching_messages(
        message="我还是不懂，list 长度 4 访问 list[4] 为什么不行？",
        query_understanding=fake_understand_index_error("我还是不懂"),
        kg_result={
            "topic_id": "Concept:list",
            "topic_label": "Python list",
            "requested_focus_node_id": "Concept:list",
            "selected_node_ids": ["Concept:list", "Concept:index"],
            "kg_gap": False,
            "path": ["Concept:list", "Concept:index", "Concept:valid_index_range"],
        },
        rag_sources=[
            {
                "title": "3.1.3. Lists",
                "source_url": "https://docs.python.org/3/tutorial/introduction.html#lists",
                "text": huge_text,
                "chunk_id": "chunk-list",
            },
        ],
        allow_direct_answer=False,
        baseline_mode="full_memory",
        recent_messages=[
            {"role": "student", "content": huge_text},
            {"role": "agent", "content": "先写出长度和访问索引。"},
        ],
        task_state={
            "current_concept": "Concept:index",
            "session_context": {"raw": huge_text},
        },
        last_evidence={
            "confidence_before": 2,
            "prompt": huge_text,
            "rag_sources": [{"text": huge_text, "chunk_id": "chunk-list"}],
            "memory_context": {"raw": huge_text},
            "pedagogical_workflow": {
                "state": "hint_level_2",
                "active_gate_id": "student-learning/progressive-hint-ladder",
                "hint_level": 2,
            },
        },
        learner_memory=[
            {
                "memory_id": "mem_index_001",
                "memory_type": "misconception",
                "topic": "Concept:index",
                "concepts": ["Concept:list", "Concept:index"],
                "content": huge_text,
            }
        ],
        memory_context={
            "short_term_messages": [{"content": huge_text}],
            "rmm": {
                "prospective_memory_plan": {
                    "selected_memory_ids": ["mem_index_001"],
                    "selected_memories": [{"content": huge_text}],
                    "plan": huge_text,
                }
            },
            "long_term_memories": [{"content": huge_text}],
        },
        skill_action={
            "skill_id": "student-learning/progressive-hint-ladder",
            "state": "hint_level_2",
            "prompt": huge_text,
            "workflow_trace": [{"skill_id": "student-learning/retrieve-first-gate", "status": "passed"}],
        },
    )

    user_prompt = messages[1]["content"]
    assert huge_marker not in user_prompt
    assert len(user_prompt) < 7000
    assert "last_evidence:" in user_prompt
    assert "confidence_before" in user_prompt
    assert "hint_level_2" in user_prompt
    assert "memory_context:" in user_prompt
    assert "mem_index_001" in user_prompt
    assert "selected_focus_node: Concept:list" in user_prompt
    assert "selected_kg_nodes: ['Concept:list', 'Concept:index']" in user_prompt


def test_session_fallback_uses_workflow_deterministic_prompt(monkeypatch):
    class FailingChatProvider:
        def __init__(self):
            raise session.DashScopeConfigurationError("missing key")

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", FailingChatProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                confidence_before=0.4,
            ),
            "last_evidence": {"confidence_before": 2},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["llm_fallback"] is True
    assert body["fallback_reason"] == "missing_api_key"
    assert body["prompt"] == body["skill_state"]["prompt"]
    assert body["skill_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert body["llm_guardrail_triggered"] is False


def test_session_missing_model_fallback_does_not_repeat_previous_agent_prompt(monkeypatch):
    class FailingChatProvider:
        def __init__(self):
            raise session.DashScopeConfigurationError("missing key")

    repeated_prompt = "用一个更小的例子复现同类现象，再对照教材证据判断规则。"
    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", FailingChatProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "？？？",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                workflow_state="hint_level_3",
                active_gate_id="student-learning/progressive-hint-ladder",
                hint_level=3,
                next_required_action="student_attempt",
                confidence_before=0.4,
            ),
            "recent_messages": [
                {"role": "student", "content": "list长度4，我访问list[4]，实际告诉我什么error我也看不懂"},
                {"role": "agent", "content": repeated_prompt},
            ],
            "last_evidence": {
                "skill_state": {
                    "state": "hint_level_3",
                    "hint_level": 3,
                    "prompt": repeated_prompt,
                    "prompt_key": "hint_level_3",
                }
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["llm_fallback"] is True
    assert body["fallback_reason"] == "missing_api_key"
    assert body["prompt"] != repeated_prompt
    assert "不会重复" in body["prompt"]
    assert "实际" in body["prompt"]


def test_session_provider_error_returns_sanitized_fallback_detail(monkeypatch):
    class FailingChatProvider:
        model = "qwen3.7-max"

        def chat(self, messages, temperature=None, max_tokens=None):
            raise session.DashScopeAPIError("DashScope HTTP 400 for key sk-secret-token: prompt too long")

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", FailingChatProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "？？？",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                confidence_before=0.4,
            ),
            "last_evidence": {"confidence_before": 2},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["llm_fallback"] is True
    assert body["fallback_reason"] == "provider_error"
    assert "HTTP 400" in body["fallback_detail"]
    assert "sk-secret-token" not in body["fallback_detail"]
    assert body["evidence"]["fallback_detail"] == body["fallback_detail"]


def test_session_falls_back_when_semantic_rag_missing_api_key(monkeypatch):
    def fake_search_missing_api_key(query: str, concepts: list[str] | None = None, top_k: int = 5) -> dict:
        raise session.DashScopeConfigurationError("DASHSCOPE_API_KEY is required for semantic RAG.")

    class FailingChatProvider:
        def __init__(self):
            raise session.DashScopeConfigurationError("missing key")

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_missing_api_key)
    monkeypatch.setattr(session, "DashScopeChatProvider", FailingChatProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "docker-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我的 list 长度是 2，为什么 list[2] 报 IndexError？",
            "stage": "hint",
            "baseline_mode": "full_memory",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["rag_sources"] == []
    assert body["rag_fallback_reason"] == "missing_api_key"
    assert body["evidence"]["rag_fallback_reason"] == "missing_api_key"
    assert body["llm_fallback"] is True
    assert body["fallback_reason"] == "missing_api_key"
    assert body["prompt"] == body["skill_state"]["prompt"]


def test_session_allows_direct_answer_without_marking_answer_given_until_generated(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert workflow["allow_direct_answer"] is True
        assert workflow["direct_answer_given"] is False
        return {
            "prompt": "你可以先把 list length、accessed index、valid range 并排写出来。",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "还是不懂",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                workflow_state="hint_level_3",
                active_gate_id="student-learning/progressive-hint-ladder",
                hint_level=3,
                next_required_action="student_attempt",
                confidence_before=0.4,
            ),
            "task_state": {"hint_level": 3},
            "last_evidence": {"confidence_before": 2},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["allow_direct_answer"] is True
    assert body["direct_answer_given"] is False
    assert body["state"] == "hint_level_4"


def test_session_previous_full_response_last_evidence_restores_workflow_state(monkeypatch):
    def fake_generate_teaching_response(**kwargs):
        workflow = kwargs["skill_action"]
        assert workflow["state"] == "hint_level_3"
        assert workflow["hint_level"] == 3
        assert workflow["active_gate_id"] == "student-learning/progressive-hint-ladder"
        assert workflow["confidence_before_required"] is False
        return {
            "prompt": workflow["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    previous_response = {
        "evidence": {"confidence_before": 2},
        "pedagogical_workflow": {
            "state": "diagnose_stuck",
            "hint_level": 2,
            "teach_back_required": False,
            "prompt_key": "diagnose_stuck",
        },
    }

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "还是不懂",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                workflow_state="diagnose_stuck",
                active_gate_id="student-learning/stuck-and-error-diagnosis-coach",
                hint_level=2,
                next_required_action="diagnose_learning_gap",
                confidence_before=0.4,
            ),
            "last_evidence": previous_response,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["active_gate_id"] == "student-learning/progressive-hint-ladder"
    assert body["state"] == "hint_level_3"
    assert body["hint_level"] == 3
    assert body["confidence_before_required"] is False


def test_session_qwen_direct_answer_guardrail_uses_workflow_prompt(monkeypatch):
    class DirectAnswerProvider:
        model = "qwen3.7-max"

        def chat(self, messages, temperature=None, max_tokens=None):
            return "答案是：while 条件为假时循环停止，所以程序会继续执行后面的代码。"

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", DirectAnswerProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "last_evidence": {"confidence_before": 2},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["allow_direct_answer"] is False
    assert body["prompt"] == body["skill_state"]["prompt"]
    assert body["prompt"] != "答案是：while 条件为假时循环停止，所以程序会继续执行后面的代码。"
    assert body["llm_guardrail_triggered"] is True
    assert body["guardrail_reason"] == "direct_answer_blocked"
    assert body["fallback_reason"] == "direct_answer_blocked"
    assert body["evidence"]["llm_guardrail_triggered"] is True


def test_session_qwen_direct_answer_guardrail_repairs_with_second_llm_call(monkeypatch):
    class RepairingProvider:
        model = "qwen-max"

        def __init__(self):
            self.calls = 0

        def chat(self, messages, temperature=None, max_tokens=None):
            self.calls += 1
            if self.calls == 1:
                return "答案是：list[2] 越界，因为长度 2 的最大索引是 1。"
            return "你已经给了 length=2 和 index=2；先只判断一下：长度为 2 时，合法索引有哪些？"

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", RepairingProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "last_evidence": {"confidence_before": 2},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["allow_direct_answer"] is False
    assert body["prompt"].startswith("你已经给了 length=2")
    assert body["llm_used"] is True
    assert body["llm_fallback"] is False
    assert body["llm_guardrail_triggered"] is True
    assert body["guardrail_reason"] == "direct_answer_repaired"
    assert body["fallback_reason"] is None
    assert body["direct_answer_given"] is False


def test_chargeable_direct_request_repairs_a_hint_into_a_delivered_answer(monkeypatch):
    class DirectDeliveryProvider:
        model = "qwen3.7-max"

        def __init__(self):
            self.calls = 0

        def chat(self, messages, temperature=None, max_tokens=None):
            self.calls += 1
            if self.calls == 1:
                return "Can you first guess how a tuple differs from a list?"
            return "Direct answer: A tuple can store objects of any type, including mixed types."

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", DirectDeliveryProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "direct-entitlement-session",
            "client_turn_id": "direct-entitlement-turn",
            "message": "Give me the direct answer about tuples.",
            "stage": "start",
            "requested_focus_node_id": "Concept:tuple",
            "token_charge_decision": {
                "chargeable": True,
                "reason_code": "deterministic_direct_request",
                "confidence": 1.0,
                "decision_source": "deterministic_fallback",
                "model": "deterministic-rules",
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body.get("direct_answer_entitlement") is True, body
    assert body["allow_direct_answer"] is True
    assert body["direct_answer_given"] is True
    assert "Direct answer:" in body["prompt"]
    assert body["guardrail_reason"] == "direct_answer_delivered"


def test_session_qwen_direct_answer_guardrail_blocks_answer_plus_teach_back(monkeypatch):
    class DirectAnswerThenQuestionProvider:
        model = "qwen3.7-max"

        def chat(self, messages, temperature=None, max_tokens=None):
            return "print(len(data)) 会输出 3，因为 len 返回容器元素数量。请你复述一遍。"

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", DirectAnswerThenQuestionProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "last_evidence": {"confidence_before": 2},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["allow_direct_answer"] is False
    assert body["prompt"] == body["skill_state"]["prompt"]
    assert body["prompt"] != "print(len(data)) 会输出 3，因为 len 返回容器元素数量。请你复述一遍。"
    assert body["llm_guardrail_triggered"] is True
    assert body["guardrail_reason"] == "direct_answer_blocked"
    assert body["fallback_reason"] == "direct_answer_blocked"


def test_session_qwen_guardrail_blocks_synonym_answer_plus_student_action(monkeypatch):
    class SynonymDirectAnswerProvider:
        model = "qwen3.7-max"

        def chat(self, messages, temperature=None, max_tokens=None):
            return "改成在条件满足时 break，就可以停止循环。请你判断为什么。"

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "DashScopeChatProvider", SynonymDirectAnswerProvider)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "last_evidence": {"confidence_before": 2},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["allow_direct_answer"] is False
    assert body["prompt"] == body["skill_state"]["prompt"]
    assert body["prompt"] != "改成在条件满足时 break，就可以停止循环。请你判断为什么。"
    assert body["llm_guardrail_triggered"] is True
    assert body["guardrail_reason"] == "direct_answer_blocked"
    assert body["fallback_reason"] == "direct_answer_blocked"


def test_session_qwen_guardrail_blocks_compact_range_direct_answers(monkeypatch):
    direct_prompts = [
        "`print(len(data))` 输出 3，因为列表里有三个元素。请你复述。",
        "第一步检查条件，第二步运行分支，所以结果返回 True。",
        "改成在条件满足时 break，就可以停止循环。",
        "函数调用 `items.append(1)` 返回 None，因为它原地修改对象。请你复述。",
    ]

    monkeypatch.setattr(session, "understand_query", fake_understand_index_error)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    client = TestClient(app)

    for prompt in direct_prompts:
        class VariantDirectAnswerProvider:
            model = "qwen3.7-max"

            def chat(self, messages, temperature=None, max_tokens=None):
                return prompt

        monkeypatch.setattr(session, "DashScopeChatProvider", VariantDirectAnswerProvider)
        response = client.post(
            "/ai/session/step",
            json={
                "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
                "message": "我访问的是 list[2]，长度是 2",
                "stage": "hint",
                "baseline_mode": "full_memory",
                "last_evidence": {"confidence_before": 2},
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["allow_direct_answer"] is False
        assert body["prompt"] == body["skill_state"]["prompt"], prompt
        assert body["prompt"] != prompt
        assert body["llm_guardrail_triggered"] is True, prompt
        assert body["guardrail_reason"] == "direct_answer_blocked"
        assert body["fallback_reason"] == "direct_answer_blocked"


def test_session_step_full_memory_uses_context_and_learner_memory(monkeypatch):
    captured = {}

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="debugging_question",
            raw_message=message,
            retrieval_query="Python list IndexError valid index range",
            concept_hints=["Concept:list", "Concept:index"],
            needs_code=True,
            risk="direct_answer_dependency",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        captured.update(kwargs)
        assert kwargs["baseline_mode"] == "full_memory"
        assert kwargs["recent_messages"][0]["content"] == "为什么我的 list 报 IndexError？"
        assert kwargs["task_state"]["current_concept"] == "Concept:list"
        assert kwargs["last_evidence"]["confidence_before"] == 0.4
        assert kwargs["learner_memory"][0]["memory_id"] == "mem_index_001"
        assert kwargs["skill_action"]["next_required_action"] == "diagnose_learning_gap"
        return {
            "prompt": "我记得你前面卡在 list[2]。先判断：长度为 2 的列表最大合法索引是多少？",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "learner_id": "learner-session-1",
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                workflow_state="retrieve_first",
                active_gate_id="student-learning/retrieve-first-gate",
                hint_level=1,
                confidence_before=0.4,
                last_kg_path=["Concept:list", "Concept:index", "ErrorType:IndexError"],
            ),
            "recent_messages": [
                {"role": "student", "content": "为什么我的 list 报 IndexError？"},
                {"role": "agent", "content": "请先写出长度和索引。"},
            ],
            "task_state": {"current_concept": "Concept:index", "hint_level": 1},
            "last_evidence": {"confidence_before": 2},
            "learner_memory": [
                {
                    "memory_id": "mem_index_001",
                    "memory_type": "misconception",
                    "topic": "Concept:index",
                    "concepts": ["Concept:list", "Concept:index", "ErrorType:IndexError"],
                    "content": "学生可能把 len(list) 当成最大合法索引。",
                    "strength": 2,
                    "use_count": 1,
                    "status": "active",
                }
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert captured["recent_messages"][1]["role"] == "agent"
    assert body["baseline_mode"] == "full_memory"
    assert body["memory_used"] is True
    assert body["memory_context"]["short_term_count"] == 2
    assert body["memory_context"]["long_term_count"] == 1
    assert body["memory_updates"][0]["operation"] == "UPDATE"
    assert body["memory_updates"][0]["target_memory_id"] == "mem_index_001"
    assert body["memory_updates"][0]["learner_id"] == "learner-session-1"
    assert body["memory_updates"][0]["session_id"] == "demo-session"
    assert body["evidence"]["baseline_mode"] == "full_memory"
    assert body["evidence"]["memory_used"] is True
    assert body["skill_state"]["next_required_action"] == "diagnose_learning_gap"
    assert body["evidence"]["teach_back_score"] is None


def test_direct_answer_request_inherits_session_topic_for_kg_and_rag(monkeypatch):
    captured = {}

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        assert message == "关于 Python index：直接告诉我答案，不要问我"
        return QueryUnderstandingResult(
            intent="direct_answer_request",
            raw_message=message,
            retrieval_query="直接给出答案",
            concept_hints=[],
            needs_code=False,
            risk="direct_answer_dependency",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen-max",
        )

    def fake_ground_resolved_turn(
        resolution,
        understanding,
        *,
        historical_concept_ids=None,
    ) -> dict:
        captured["grounding_question"] = resolution.resolved_question
        captured["current_concept_hints"] = understanding.concept_hints
        captured["historical_concept_ids"] = historical_concept_ids or []
        captured["requested_focus_node_id"] = resolution.selected_node.node_id
        if "Concept:index" not in captured["historical_concept_ids"] and "ErrorType:IndexError" not in captured["historical_concept_ids"]:
            return {
                "topic_id": "kg_gap:direct",
                "topic_label": "kg_gap:direct",
                "path": [],
                "path_edges": [],
                "selected_node_ids": [],
                "algorithm": "test-grounding",
                "kg_gap": True,
            }
        return {
            "topic_id": "Concept:index",
            "topic_label": "index",
            "path": ["Concept:list", "Concept:index", "Concept:valid_index_range", "ErrorType:IndexError"],
            "path_edges": [],
            "selected_node_ids": ["Concept:index"],
            "algorithm": "test-grounding",
            "kg_gap": False,
        }

    def fake_search_with_context(query: str, concepts: list[str] | None = None, top_k: int = 5) -> dict:
        captured["rag_query"] = query
        captured["rag_concepts"] = concepts or []
        return fake_search_chunks(query, concepts, top_k)

    def fake_generate_teaching_response(**kwargs):
        captured["teaching_query"] = kwargs["query_understanding"].retrieval_query
        captured["teaching_kg_path"] = kwargs["kg_result"]["path"]
        return {
            "prompt": kwargs["skill_action"]["prompt"],
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "ground_resolved_turn", fake_ground_resolved_turn)
    monkeypatch.setattr(session, "search_chunks", fake_search_with_context)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "直接告诉我答案，不要问我",
            "stage": "hint",
            "baseline_mode": "rag_kg_skills",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:index",
                label="index",
                confidence_before=0.4,
                last_kg_path=["Concept:list", "Concept:index", "ErrorType:IndexError"],
            ),
            "recent_messages": [
                {"role": "student", "content": "为什么我的 list 报 IndexError？"},
                {"role": "agent", "content": "请先写出 list 的长度和访问的索引。"},
            ],
            "task_state": {
                "current_concept": "Concept:index",
                "query_concepts": ["Concept:list", "Concept:index", "ErrorType:IndexError"],
            },
            "last_evidence": {"kg_path": ["Concept:list", "Concept:index", "ErrorType:IndexError"]},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert captured["grounding_question"] == body["turn_resolution"]["resolved_question"]
    assert "Concept:index" not in captured["grounding_question"]
    assert "Concept:index" in captured["historical_concept_ids"]
    assert "Concept:valid_index_range" in body["kg_path"]
    assert body["kg_gap"] is False
    assert "Concept:index" in captured["rag_concepts"]
    assert "ErrorType:IndexError" in captured["rag_concepts"]
    assert captured["rag_query"] == body["turn_resolution"]["retrieval_query"]
    assert captured["teaching_query"] == "直接给出答案"
    assert captured["teaching_kg_path"] == body["kg_path"]


def test_session_step_returns_research_grounded_orchestration_contract(monkeypatch):
    captured = {}

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="error_debugging",
            raw_message=message,
            retrieval_query="Python list IndexError valid index range",
            concept_hints=["Concept:list", "Concept:index", "Concept:valid_index_range"],
            needs_code=True,
            risk="direct_answer_dependency",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        captured.update(kwargs)
        assert kwargs["memory_context"]["rmm"]["prospective_memory_plan"]["selected_memory_ids"] == ["mem_index_001"]
        assert kwargs["learner_memory"][0]["memory_id"] == "mem_index_001"
        assert kwargs["recent_messages"][-1]["content"] == "请先写出长度和索引。"
        return {
            "prompt": "你已经给出 length=2 和 index=2。先写出 valid range，再判断 index 是否落在范围内。",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "learner_id": "learner-orch-1",
            "session_id": "session-orch-1",
            "client_turn_id": "legacy-test-turn",
            "episode_id": 42,
            "message": "我访问的是 list[2]，长度是 2",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "conversation_projection": topic_projection(
                canonical_topic="Concept:list",
                label="list",
                workflow_state="retrieve_first",
                active_gate_id="student-learning/retrieve-first-gate",
                hint_level=1,
                confidence_before=0.6,
                last_kg_path=[
                    "Concept:list",
                    "Concept:index",
                    "Concept:valid_index_range",
                    "ErrorType:IndexError",
                ],
            ),
            "recent_messages": [
                {"role": "student", "content": "为什么我的 list 报 IndexError？"},
                {"role": "agent", "content": "请先写出长度和索引。"},
            ],
            "task_state": {"current_concept": "Concept:index", "hint_level": 1},
            "last_evidence": {"confidence_before": 3},
            "topic_summaries": [
                {
                    "topic": "Concept:index",
                    "topic_summary": "学生需要巩固合法索引范围。",
                    "weak_concepts": ["Concept:index"],
                    "mastered_concepts": [],
                    "source_memory_ids": ["mem_index_001"],
                }
            ],
            "learner_memory": [
                {
                    "memory_id": "mem_index_001",
                    "memory_type": "misconception",
                    "topic": "Concept:valid_index_range",
                    "concepts": ["Concept:list", "Concept:index", "Concept:valid_index_range", "ErrorType:IndexError"],
                    "content": "学生把 len(list) 当成最大合法索引。",
                    "strength": 3,
                    "use_count": 2,
                    "days_since_last_used": 1,
                    "effective_score": 8.0,
                    "status": "active",
                }
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()

    assert body["next_recent_messages"][-2:] == [
        {"role": "student", "content": "我访问的是 list[2]，长度是 2"},
        {
            "role": "agent",
            "content": "你已经给出 length=2 和 index=2。先写出 valid range，再判断 index 是否落在范围内。",
        },
    ]
    assert body["session_context"]["short_term_memory"]["policy"] == "sliding_window"
    assert body["session_context"]["short_term_memory"]["message_count"] == len(body["next_recent_messages"])

    next_state = body["next_task_state"]
    assert next_state["topic"] == body["kg_topic_id"]
    assert next_state["topic"] != "list_index_indexerror"
    assert next_state["workflow_state"] == body["skill_state"]["state"]
    assert next_state["active_gate_id"] == body["active_gate_id"]
    assert next_state["last_kg_path"] == body["kg_path"]
    assert next_state["last_rag_chunk_ids"] == ["python-docs-3.14.6-list"]
    assert body["session_context"]["mid_term_memory"]["task_state"] == next_state

    assert body["memory_reading_plan"]["selected_memory_ids"] == ["mem_index_001"]
    assert body["memory_context"]["rmm"]["prospective_memory_plan"]["selected_memory_ids"] == ["mem_index_001"]
    assert body["retrospective_memory_use"]["used_memory_ids"] == []
    assert body["retrospective_memory_use"]["unused_selected_memory_ids"] == ["mem_index_001"]
    assert body["retrospective_memory_use"]["verification_reason"] == "model_did_not_report_usage"
    assert body["memory_reinforcement"][0]["memory_id"] == "mem_index_001"
    assert body["memory_reinforcement"][0]["operation"] == "REINFORCE"

    assert body["memory_updates"][0]["operation"] == "UPDATE"
    assert body["topic_summary_update"]["topic"] == body["kg_topic_id"]
    assert "Concept:valid_index_range" in body["topic_summary_update"]["weak_concepts"]
    assert body["learning_facts"][0]["source_episode_id"] == 42
    assert body["learning_facts"][0]["learner_id"] == "learner-orch-1"
    assert body["session_context"]["long_term_memory"]["memory_policy"] == "mem0_memorybank_rmm_zep"
    assert body["evidence"]["memory_reading_plan"]["selected_memory_ids"] == ["mem_index_001"]
    assert body["evidence"]["topic_summary_update"]["topic"] == body["kg_topic_id"]
    assert body["evidence"]["learning_facts"][0]["source_episode_id"] == 42


def test_verified_used_memory_ids_filters_unselected_model_reports():
    used_ids, reason = session._verified_used_memory_ids(
        {"used_memory_ids": ["mem-selected", "mem-invented", 12]},
        ["mem-selected", "mem-other"],
    )

    assert used_ids == ["mem-selected"]
    assert reason == "model_reported_used_memory_ids"


def test_session_step_fallback_memory_candidate_has_contract_and_identity(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python list index",
            concept_hints=["Concept:list", "Concept:index"],
            needs_code=False,
            risk="low",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["skill_action"]["stuck_detected"] is True
        return {
            "prompt": "索引是位置编号。先判断第一个元素的索引是多少？",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "learner_id": "learner-fallback-1",
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "我不懂 list 索引",
            "stage": "hint",
            "baseline_mode": "full_memory",
            "learner_memory": [],
        },
    )

    assert response.status_code == 200
    update = response.json()["memory_updates"][0]
    assert update["operation"] == "ADD"
    assert update["memory_type"] == "misconception"
    assert update["learner_id"] == "learner-fallback-1"
    assert update["session_id"] == "demo-session"
    assert update["confidence"] > 0
    assert update["source"] == "deterministic_rule"
    assert update["evidence_span"] == "我不懂 list 索引"
    assert update.get("learner_id") != "unknown"
    assert update.get("session_id") != "unknown"


def test_session_step_rag_only_skips_kg_skill_and_memory(monkeypatch):
    searched = {}

    def fail_if_kg_called(*args, **kwargs):
        raise AssertionError("rag_only baseline must not call KG reasoning")

    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python list index",
            concept_hints=["Concept:list"],
            needs_code=False,
            risk="low",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_search_without_kg(query: str, concepts: list[str] | None = None, top_k: int = 5) -> dict:
        searched["concepts"] = concepts
        return fake_search_chunks(query, concepts, top_k)

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["baseline_mode"] == "rag_only"
        assert kwargs["allow_direct_answer"] is True
        assert kwargs["skill_action"]["allow_direct_answer"] is True
        assert kwargs["skill_action"]["direct_answer_given"] is False
        assert kwargs["kg_result"]["path"] == []
        assert kwargs["learner_memory"] == []
        return {
            "prompt": "RAG only response",
            "teaching_strategy": "rag-only-answer",
            "llm_used": True,
            "llm_fallback": False,
            "fallback_reason": None,
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "reason_about_target", fail_if_kg_called)
    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_without_kg)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    client = TestClient(app)

    response = client.post(
        "/ai/session/step",
        json={
            "session_id": "demo-session",
            "client_turn_id": "legacy-test-turn",
            "message": "索引是什么？",
            "baseline_mode": "rag_only",
            "learner_memory": [{"memory_id": "must_not_be_used"}],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert searched["concepts"] == []
    assert body["baseline_mode"] == "rag_only"
    assert body["skill_id"] == "baseline/rag-only"
    assert body["primary_skill_id"] == "baseline/rag-only"
    assert body["active_gate_id"] == "baseline/rag-only"
    assert body["requires_student_attempt"] is False
    assert body["direct_answer_given"] is False
    assert body["allow_direct_answer"] is True
    assert body["skill_state"]["skill_id"] == "baseline/rag-only"
    assert body["skill_state"]["direct_answer_given"] is False
    assert body["memory_used"] is False
    assert body["kg_path"] == []
    assert body["rag_kg_guided"] is False


def test_full_memory_turn_returns_noop_memory_update_when_no_candidate(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="smalltalk",
            raw_message=message,
            retrieval_query="你好",
            concept_hints=[],
            needs_code=False,
            risk="low",
            llm_used=False,
            llm_fallback=True,
            chat_model="qwen3.7-max",
        )

    def fake_generate_teaching_response(**kwargs):
        assert kwargs["baseline_mode"] == "full_memory"
        return {
            "prompt": "你好，我们可以从一个具体问题开始。",
            "teaching_strategy": "retrieve-first-with-evidence",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "qwen3.7-max",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)

    step = session.next_session_step(
        session_id="session-noop",
        message="你好",
        stage="start",
        baseline_mode="full_memory",
        recent_messages=[],
        task_state={"scenario": "index-error"},
        last_evidence={},
        learner_memory=[],
    )

    assert step["memory_used"] is False
    assert step["memory_updates"] == []
    assert step["turn_resolution"]["workflow_action"] == "preserve_without_advance"


def test_preserved_turn_keeps_active_topic_and_conversation_context(monkeypatch):
    resolution = TurnResolution(
        original_message="How is the weather today?",
        resolved_question="How is the weather today?",
        resolved_intent="off_topic",
        conversation_relation="off_topic",
        active_topic_before="topic-current",
        active_topic_after="topic-current",
        selected_node=SelectedNodeResolution(usage="absent", reason="off-topic"),
        workflow_action="preserve_without_advance",
        retrieval_query="",
        resolution_confidence=1.0,
    )
    monkeypatch.setattr(session, "resolve_turn", lambda *args: resolution)

    response = session.next_session_step(
        session_id="preserved-context",
        client_turn_id="preserved-context-turn",
        conversation_projection=topic_projection(
            canonical_topic="Concept:list",
            label="list",
            last_kg_path=["Concept:variable", "Concept:list"],
        ),
        message="How is the weather today?",
        stage="start",
        recent_messages=[
            {"role": "student", "content": "What is a list?"},
            {"role": "agent", "content": "A list stores an ordered sequence."},
        ],
    )

    assert response["turn_resolution"]["workflow_action"] == "preserve_without_advance"
    assert response["kg_grounding"]["topic_id"] == "Concept:list"
    assert response["next_task_state"]["topic"] == "Concept:list"
    assert response["session_context"]["mid_term_memory"]["topic"] == "Concept:list"
    assert response["next_recent_messages"][:2] == [
        {"role": "student", "content": "What is a list?"},
        {"role": "agent", "content": "A list stores an ordered sequence."},
    ]
    assert response["next_conversation_projection"]["active_topic_id"] == "topic-current"
    assert "list" in response["prompt"]
    assert "cannot identify" not in response["prompt"].lower()


def test_full_memory_kg_grounding_uses_student_question_not_rag_template(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python while loop stop condition",
            concept_hints=["Concept:while_loop"],
            needs_code=False,
            risk="normal",
            llm_used=True,
            llm_fallback=False,
            chat_model="qwen3.7-max",
            route="python_learning",
        )

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    step = session.next_session_step(
        session_id="session-while-loop",
        message="while 循环什么时候停止？",
        stage="start",
        baseline_mode="full_memory",
        recent_messages=[],
        task_state={"scenario": "python-learning"},
        last_evidence={},
        learner_memory=[],
    )

    assert step["next_task_state"]["topic"] == "Concept:while_loop"
    assert step["kg_topic_id"] == "Concept:while_loop"
    assert step["kg_path"] == ["Concept:while_loop"]
    assert "ErrorType:IndexError" not in step["kg_path"]


def _task4_resolution(*, relation="start", action="initialize", topic_id="topic-list"):
    return TurnResolution(
        original_message="what is list?",
        resolved_question="what is list?",
        resolved_intent="concept_question",
        conversation_relation=relation,
        active_topic_before=None,
        active_topic_after=topic_id,
        target_topic_id=topic_id,
        selected_node=SelectedNodeResolution(usage="absent", reason="no_selection"),
        workflow_action=action,
        retrieval_query="Python list",
        resolution_confidence=1.0,
    )


def test_resolution_runs_before_onboarding(monkeypatch):
    calls = []
    resolution = _task4_resolution(
        relation="greeting", action="preserve_without_advance", topic_id=None
    ).model_copy(
        update={
            "resolved_intent": "greeting",
            "conversation_relation": "greeting",
            "active_topic_after": None,
            "target_topic_id": None,
            "retrieval_query": "",
        }
    )

    def fake_resolve_turn(*args, **kwargs):
        calls.append("resolution")
        return resolution

    def fake_onboarding(**kwargs):
        assert calls == ["resolution"]
        assert kwargs["resolution"] is resolution
        calls.append("onboarding")
        return {"prompt": "Hi"}

    monkeypatch.setattr(session, "resolve_turn", fake_resolve_turn)
    monkeypatch.setattr(session, "_onboarding_session_response", fake_onboarding)

    response = session.next_session_step(
        session_id="task4-order-onboarding",
        client_turn_id="turn-onboarding",
        conversation_projection={},
        message="hello",
        stage="start",
    )

    assert response["turn_resolution"] == resolution.model_dump(mode="json")
    assert calls == ["resolution", "onboarding"]


def test_d09_back_without_history_returns_application_owned_answer_and_no_topic_events():
    response = session.next_session_step(
        session_id="d09-empty-back",
        client_turn_id="d09-turn-1",
        conversation_projection={},
        message="back",
        stage="start",
        baseline_mode="no_rag",
    )

    assert response["prompt"] == "No previous topic exists."
    assert response["response_contract"]["answer_body"] == "No previous topic exists."
    assert response["turn_resolution"]["conversation_relation"] == "unresolved"
    assert response["next_conversation_projection"]["active_topic_id"] is None
    assert response["next_conversation_projection"]["topics"] == {}
    event_types = [event["event_type"] for event in response["conversation_events"]]
    assert event_types == [
        "user_message_received",
        "turn_resolved",
        "assistant_response_committed",
    ]


def test_d02_clarify_current_uses_topic_context_without_advancing_pedagogy(monkeypatch):
    projection = topic_projection(
        canonical_topic="Concept:dict",
        label="dictionary",
        workflow_state="hint_level_2",
        active_gate_id="student-learning/progressive-hint-ladder",
        hint_level=2,
        next_required_action="student_attempt",
        confidence_before=0.6,
    )
    topic_id = projection["active_topic_id"]
    original_pedagogy = dict(projection["topics"][topic_id]["pedagogy_state"])
    captured = {}

    def capture_response_context(**kwargs):
        captured["task_state"] = dict(kwargs["task_state"])
        captured["last_evidence"] = dict(kwargs["last_evidence"])
        return {
            "prompt": "dictionary clarification",
            "teaching_strategy": "test",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "fallback-rules",
        }

    monkeypatch.setattr(session, "generate_teaching_response", capture_response_context)

    response = session.next_session_step(
        session_id="d02-clarify-current",
        client_turn_id="d02-turn-1",
        conversation_projection=projection,
        message="这是啥意思？",
        stage="start",
        baseline_mode="no_rag",
    )

    resolution = response["turn_resolution"]
    assert resolution["conversation_relation"] == "clarify_current"
    assert resolution["active_topic_after"] == topic_id
    assert resolution["workflow_action"] == "continue"
    assert captured["task_state"]["workflow_state"] == "hint_level_2"
    assert captured["task_state"]["hint_level"] == 2
    replayed = response["next_conversation_projection"]
    assert replayed["active_topic_id"] == topic_id
    assert replayed["topics"][topic_id]["pedagogy_state"] == original_pedagogy
    assert response["memory_updates"] == []
    assert response["memory_reinforcement"] == []
    assert "pedagogy_advanced" not in {
        event["event_type"] for event in response["conversation_events"]
    }


@pytest.mark.parametrize(
    "message",
    [
        "我说的“它”是 tuple，不是 list",
        "I mean tuple, not list",
    ],
)
def test_d11_no_kg_correction_creates_tuple_topic_instead_of_reusing_list(
    monkeypatch,
    message,
):
    monkeypatch.setattr(
        session,
        "understand_resolved_question",
        lambda question, intent: QueryUnderstandingResult(
            intent=intent,
            raw_message=question,
            retrieval_query="Python tuple",
            concept_hints=["Concept:tuple"],
            needs_code=False,
            risk="normal",
            llm_used=False,
            llm_fallback=True,
            chat_model="fallback-rules",
            route="python_learning",
        ),
    )
    monkeypatch.setattr(
        session,
        "generate_teaching_response",
        lambda **kwargs: {
            "prompt": "Tuple correction accepted.",
            "teaching_strategy": "test",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "fallback-rules",
        },
    )

    response = session.next_session_step(
        session_id="d11-correction",
        client_turn_id="d11-turn-1",
        conversation_projection=topic_projection(
            canonical_topic="Concept:list",
            label="list",
        ),
        message=message,
        stage="start",
        baseline_mode="no_rag",
    )

    resolution = response["turn_resolution"]
    assert resolution["conversation_relation"] == "switch_topic"
    assert resolution["retrieval_query"] == "Python tuple"
    assert resolution["topic_transition"] == {
        "kind": "switch",
        "from_label": "list",
        "to_label": "tuple",
    }
    projection = response["next_conversation_projection"]
    active = projection["topics"][projection["active_topic_id"]]
    assert active["canonical_topic"] == "Concept:tuple"
    assert active["topic_label"] == "tuple"
    assert "Topic Transition: list → tuple" in response["prompt"]


def test_no_rag_explicit_tuple_correction_rejects_term_hint_as_canonical_topic(
    monkeypatch,
):
    monkeypatch.setattr(
        session,
        "understand_resolved_question",
        lambda question, intent: QueryUnderstandingResult(
            intent=intent,
            raw_message=question,
            retrieval_query="Python tuple",
            concept_hints=["Concept:list", "Term:tuple", "Term:list"],
            needs_code=False,
            risk="normal",
            llm_used=False,
            llm_fallback=True,
            chat_model="fallback-rules",
            route="python_learning",
        ),
    )
    monkeypatch.setattr(
        session,
        "generate_teaching_response",
        lambda **kwargs: {
            "prompt": "Tuple correction accepted.",
            "teaching_strategy": "test",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "fallback-rules",
        },
    )

    response = session.next_session_step(
        session_id="no-rag-tuple-canonical-identity",
        client_turn_id="tuple-correction-turn",
        conversation_projection=topic_projection(
            canonical_topic="Concept:list",
            label="list",
        ),
        message="我说 tuple 不是 list",
        stage="start",
        baseline_mode="no_rag",
    )

    resolution = response["turn_resolution"]
    assert resolution["conversation_relation"] == "switch_topic"
    assert resolution["active_topic_after"] != resolution["active_topic_before"]
    assert resolution["topic_transition"] == {
        "kind": "switch",
        "from_label": "list",
        "to_label": "tuple",
    }
    assert response["concept_hints"] == ["Concept:list", "Term:tuple", "Term:list"]
    assert response["kg_topic_id"] == "Concept:tuple"

    topic_created = next(
        event
        for event in response["conversation_events"]
        if event["event_type"] == "topic_created"
    )
    assert topic_created["payload"]["topic"]["canonical_topic"] == "Concept:tuple"

    projection = response["next_conversation_projection"]
    active = projection["topics"][projection["active_topic_id"]]
    assert active["canonical_topic"] == "Concept:tuple"
    assert active["canonical_topic"] != "Term:tuple"


def test_resolution_runs_before_kg_and_rag(monkeypatch):
    calls = []
    resolution = _task4_resolution()

    def fake_resolve_turn(*args, **kwargs):
        calls.append("resolution")
        return resolution

    def fake_understand(resolved_question, resolved_intent, **kwargs):
        assert calls == ["resolution", "topic"]
        calls.append("understanding")
        return QueryUnderstandingResult(
            intent=resolved_intent,
            raw_message=resolved_question,
            retrieval_query="Python list",
            concept_hints=["Concept:list"],
            needs_code=False,
            risk="normal",
            llm_used=False,
            llm_fallback=True,
            chat_model="fallback-rules",
        )

    def fake_select(resolved, projection):
        assert resolved is resolution
        calls.append("topic")
        return {"topic_id": "topic-list", "pedagogy_state": {}}

    def fake_ground(resolved, understanding, **kwargs):
        assert calls == ["resolution", "topic", "understanding"]
        calls.append("kg")
        return session.empty_kg_result("Concept:list", "list")

    def fake_search(query, concepts=None, top_k=3):
        assert calls == ["resolution", "topic", "understanding", "kg"]
        assert query == resolution.retrieval_query
        calls.append("rag")
        return session.empty_rag_result()

    monkeypatch.setattr(session, "resolve_turn", fake_resolve_turn)
    monkeypatch.setattr(session, "select_topic_state", fake_select)
    monkeypatch.setattr(session, "understand_resolved_question", fake_understand)
    monkeypatch.setattr(session, "ground_resolved_turn", fake_ground)
    monkeypatch.setattr(session, "search_chunks", fake_search)
    monkeypatch.setattr(
        session,
        "generate_teaching_response",
        lambda **kwargs: {
            "prompt": "list answer",
            "teaching_strategy": "test",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "fallback-rules",
        },
    )

    result = session.next_session_step(
        session_id="task4-order",
        client_turn_id="turn-order",
        conversation_projection={},
        message="what is list?",
        stage="start",
        baseline_mode="rag_kg",
    )

    assert calls[:5] == ["resolution", "topic", "understanding", "kg", "rag"]
    assert result["turn_resolution"] == resolution.model_dump(mode="json")


def test_stream_and_non_stream_return_equal_resolution_and_projection_for_learning_turn(monkeypatch):
    payload = {
        "session_id": "task4-parity",
        "client_turn_id": "turn-parity",
        "conversation_projection": {},
        "message": "what is list?",
        "stage": "start",
        "baseline_mode": "no_rag",
        "requested_focus_node_id": "Concept:list",
    }
    client = TestClient(app)
    normal = client.post("/ai/session/step", json=payload)
    with client.stream("POST", "/ai/session/step/stream", json=payload) as streamed:
        events = [json.loads(line) for line in streamed.iter_lines() if line]

    stream_result = events[-1]["response"]
    assert normal.status_code == 200
    assert normal.json()["turn_resolution"] == stream_result["turn_resolution"]
    assert normal.json()["next_conversation_projection"] == stream_result["next_conversation_projection"]
    assert normal.json()["next_conversation_projection"]["active_topic_id"] is not None


def test_new_topic_does_not_consume_prior_topic_agent_prompt(monkeypatch):
    previous_prompt = session.decide_next_teaching_action(
        "student-learning/retrieve-first-gate",
        "what is list?",
        stage="start",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )["prompt"]
    captured = {}
    original_decide = session.decide_next_teaching_action

    def capture_topic_local_history(*args, **kwargs):
        captured["recent_messages"] = kwargs["recent_messages"]
        return original_decide(*args, **kwargs)

    def fake_generate_teaching_response(**kwargs):
        return {
            "prompt": kwargs["skill_action"]["prompt"],
            "teaching_strategy": "test",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "chat_model": "fallback-rules",
        }

    monkeypatch.setattr(session, "decide_next_teaching_action", capture_topic_local_history)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    result = session.next_session_step(
        session_id="task4-topic-local-history",
        client_turn_id="turn-dictionary",
        conversation_projection=topic_projection(
            canonical_topic="Concept:list",
            label="list",
            workflow_state="hint_level_3",
            active_gate_id="student-learning/progressive-hint-ladder",
            hint_level=3,
        ),
        message="what is dictionary?",
        stage="start",
        baseline_mode="rag_kg_skills",
        recent_messages=[
            {"role": "student", "content": "what is list?"},
            {"role": "agent", "content": previous_prompt},
        ],
    )

    assert result["turn_resolution"]["workflow_action"] == "initialize"
    assert captured["recent_messages"] == []
    assert result["skill_state"]["state"] == "retrieve_first"
    assert result["skill_state"]["hint_level"] == 0


def test_completed_turn_summary_survives_switch_and_back():
    first = session.next_session_step(
        session_id="task4-summary",
        client_turn_id="turn-list",
        conversation_projection={},
        message="what is list?",
        stage="start",
        baseline_mode="no_rag",
        requested_focus_node_id="Concept:list",
    )
    list_topic_id = first["next_conversation_projection"]["active_topic_id"]
    stored_summary = first["next_conversation_projection"]["topics"][list_topic_id]["summary"]
    sentence_count = len([part for part in stored_summary.replace("。", ".").split(".") if part.strip()])

    assert stored_summary.strip()
    assert 1 <= sentence_count <= 3
    assert first["skill_state"]["next_required_action"] in stored_summary
    committed = next(
        event
        for event in first["conversation_events"]
        if event["event_type"] == "assistant_response_committed"
    )
    assert committed["payload"]["summary"] == stored_summary

    second = session.next_session_step(
        session_id="task4-summary",
        client_turn_id="turn-dictionary",
        conversation_projection=first["next_conversation_projection"],
        message="what is dictionary?",
        stage="start",
        baseline_mode="no_rag",
    )
    third = session.next_session_step(
        session_id="task4-summary",
        client_turn_id="turn-back",
        conversation_projection=second["next_conversation_projection"],
        message="back",
        stage="start",
        baseline_mode="no_rag",
    )

    assert third["next_conversation_projection"]["active_topic_id"] == list_topic_id
    assert third["next_conversation_projection"]["topics"][list_topic_id]["summary"] == stored_summary


def test_topic_summary_contract_is_localized_and_hard_bounded_for_long_inputs():
    cases = [
        {
            "message": "为什么" + "这个浮点数计算仍然不精确" * 40 + "？",
            "label": "超长浮点数学习主题" * 30,
            "action": "diagnose_learning_gap",
            "localized_prefix": "学习：",
            "foreign_prefix": "Learning:",
        },
        {
            "message": "Why does " + "this floating point calculation stay imprecise " * 40 + "?",
            "label": "Extremely long floating point learning topic " * 30,
            "action": "collect_confidence_before",
            "localized_prefix": "Learning:",
            "foreign_prefix": "学习：",
        },
    ]

    for index, case in enumerate(cases):
        topic_id = f"topic-summary-{index}"
        resolution = TurnResolution(
            original_message=case["message"],
            resolved_question=case["message"],
            resolved_intent="concept_question",
            conversation_relation="start",
            active_topic_after=topic_id,
            target_topic_id=topic_id,
            selected_node=SelectedNodeResolution(usage="absent", reason="no_selection"),
            workflow_action="initialize",
            retrieval_query="Python floating point",
            resolution_confidence=1.0,
        )
        understanding = QueryUnderstandingResult(
            intent="concept_question",
            raw_message=case["message"],
            retrieval_query="Python floating point",
            concept_hints=["Concept:floating_point"],
            needs_code=False,
            risk="normal",
            llm_used=False,
            llm_fallback=True,
            chat_model="fallback-rules",
        )
        events = session.build_completed_turn_events(
            session_id="summary-contract",
            client_turn_id=f"summary-turn-{index}",
            projection=ConversationProjection.empty(),
            resolution=resolution,
            requested_focus_node_id=None,
            understanding=understanding,
            kg_result={
                "topic_id": "Concept:floating_point",
                "topic_label": case["label"],
                "path": ["Concept:floating_point"],
            },
            rag_sources=[],
            skill_state={
                "state": "retrieve_first",
                "active_gate_id": "student-learning/retrieve-first-gate",
                "hint_level": 0,
                "next_required_action": case["action"],
            },
            answer="guided response",
        )
        committed = next(
            event for event in events if event.event_type == "assistant_response_committed"
        )
        summary = committed.payload["summary"]
        replayed = session.apply_events(ConversationProjection.empty(), events)
        normalized = summary.replace("。", ".")
        sentence_count = len([part for part in normalized.split(".") if part.strip()])

        assert len(summary) <= 240
        assert 1 <= sentence_count <= 3
        assert case["action"] in summary
        assert case["localized_prefix"] in summary
        assert case["foreign_prefix"] not in summary
        assert replayed.topics[topic_id].summary == summary


def test_completed_turn_events_are_uuid_ordered_and_replayable():
    first = session.next_session_step(
        session_id="task4-events",
        client_turn_id="turn-1",
        conversation_projection={},
        message="what is list?",
        stage="start",
        baseline_mode="no_rag",
        requested_focus_node_id="Concept:list",
    )
    second = session.next_session_step(
        session_id="task4-events",
        client_turn_id="turn-2",
        conversation_projection=first["next_conversation_projection"],
        message="what is len?",
        stage="start",
        baseline_mode="no_rag",
    )
    restored_before = first["next_conversation_projection"]["topics"]
    third = session.next_session_step(
        session_id="task4-events",
        client_turn_id="turn-3",
        conversation_projection=second["next_conversation_projection"],
        message="back",
        stage="start",
        baseline_mode="no_rag",
    )

    all_events = [
        *first["conversation_events"],
        *second["conversation_events"],
        *third["conversation_events"],
    ]
    assert [event["sequence"] for event in all_events] == list(range(1, len(all_events) + 1))
    for turn in (first, second, third):
        assert [event["ordinal"] for event in turn["conversation_events"]] == list(
            range(1, len(turn["conversation_events"]) + 1)
        )
        assert all(event["session_id"] == "task4-events" for event in turn["conversation_events"])
        assert all(uuid.UUID(event["event_id"]).version == 4 for event in turn["conversation_events"])
    event_types = {event["event_type"] for event in all_events}
    assert {
        "user_message_received",
        "kg_node_selected",
        "turn_resolved",
        "topic_created",
        "topic_suspended",
        "topic_resumed",
        "retrieval_completed",
        "pedagogy_advanced",
        "assistant_response_committed",
    } <= event_types
    restored_id = first["next_conversation_projection"]["active_topic_id"]
    restored_after = third["next_conversation_projection"]["topics"][restored_id]
    restored_original = restored_before[restored_id]
    for key in (
        "active_kg_focus_node_id",
        "last_kg_path",
        "last_rag_chunk_ids",
        "pedagogy_state",
        "unresolved_question",
    ):
        assert restored_after[key] == restored_original[key]


def _task3_generate_teaching_response(**kwargs):
    del kwargs
    return {
        "prompt": "Focused Task 3 response.",
        "teaching_strategy": "task3-test",
        "llm_used": False,
        "llm_fallback": True,
        "fallback_reason": "task3_test",
        "fallback_detail": None,
        "guardrail_reason": None,
        "llm_guardrail_triggered": False,
        "chat_model": "task3-test",
        "token_usage": {
            "model": "task3-test",
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "usage_unavailable": True,
        },
    }


def test_session_step_keeps_active_topic_when_ai_approves_direct_answer(monkeypatch):
    preserved = TurnResolution(
        original_message="Give me answer directly, I dont want to play games with you",
        resolved_question="Give me answer directly, I dont want to play games with you",
        resolved_intent="unknown",
        conversation_relation="unresolved",
        selected_node=SelectedNodeResolution(usage="absent", reason="no explicit node"),
        workflow_action="preserve_without_advance",
        retrieval_query="",
        resolution_confidence=0.2,
        ambiguity_reason="deterministic resolver could not classify the wording",
    )
    captured = {}

    monkeypatch.setattr(session, "resolve_turn", lambda *args: preserved)
    monkeypatch.setattr(
        session,
        "understand_resolved_question",
        lambda question, intent: QueryUnderstandingResult(
            intent="direct_answer_request",
            raw_message=question,
            retrieval_query="Python set definition and operations",
            concept_hints=["Concept:set"],
            needs_code=False,
            risk="direct_answer_dependency",
            llm_used=False,
            llm_fallback=True,
            chat_model="test",
            fallback_reason="test",
            route="direct_answer_request",
        ),
    )
    monkeypatch.setattr(session, "generate_teaching_response", _task3_generate_teaching_response)
    def fake_ground_resolved_turn(resolution, understanding, historical_concept_ids):
        del understanding, historical_concept_ids
        captured["resolution"] = resolution
        return {
            "topic_id": "Concept:set",
            "topic_label": "set",
            "selected_node_ids": ["Concept:set"],
            "path": ["Concept:set"],
        }

    monkeypatch.setattr(session, "ground_resolved_turn", fake_ground_resolved_turn)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)

    response = session.next_session_step(
        session_id="ai-direct-context",
        client_turn_id="ai-direct-context-turn",
        conversation_projection=topic_projection(canonical_topic="Concept:set", label="set"),
        message="Give me answer directly, I dont want to play games with you",
        stage="start",
        baseline_mode="rag_kg",
        token_charge_decision=TokenChargeDecisionResponse(
            chargeable=True,
            reason_code="context_resolved_direct_request",
            confidence=0.95,
            decision_source="llm",
            model="qwen-test",
        ),
    )

    assert response["turn_resolution"]["workflow_action"] == "continue"
    assert response["turn_resolution"]["active_topic_after"] == "topic-current"
    assert response["allow_direct_answer"] is True
    assert captured["resolution"].resolved_intent == "direct_answer_request"
    assert response["kg_grounding"]["topic_id"] == "Concept:set"


@pytest.mark.parametrize(
    ("message", "expected_intent", "expected_risk", "expected_chargeable"),
    [
        ("不要直接给答案，让我自己试", "concept_question", "normal", False),
        ("别给完整代码，只给我提示", "syntax_question", "normal", False),
        ("不要直接给结论，解释 list[4] 为什么报错", "error_debugging", "normal", False),
        ("Do not give me the final answer; give me a hint", "concept_question", "normal", False),
        ("你会直接给答案吗？", "concept_question", "normal", False),
        ("老师说“直接给答案”是什么意思？", "concept_question", "normal", False),
        (
            "请直接给我完整答案，不要再提示",
            "direct_answer_request",
            "direct_answer_dependency",
            True,
        ),
        (
            "把这个 Python 函数写完给我",
            "direct_answer_request",
            "direct_answer_dependency",
            True,
        ),
    ],
)
def test_session_step_persists_negated_direct_answer_as_normal_intent(
    monkeypatch,
    message,
    expected_intent,
    expected_risk,
    expected_chargeable,
):
    monkeypatch.setattr(session, "generate_teaching_response", _task3_generate_teaching_response)
    monkeypatch.setattr(
        session,
        "resolve_turn",
        lambda message, projection, requested_focus_node_id, recent_messages: resolve_turn_contract(
            message,
            projection,
            requested_focus_node_id,
            recent_messages,
            allow_llm=False,
        ),
    )

    response = session.next_session_step(
        session_id="task3-teaching-intent",
        client_turn_id="task3-teaching-intent-turn",
        conversation_projection=topic_projection(
            canonical_topic="Concept:function",
            label="function",
        ),
        message=message,
        stage="start",
        baseline_mode="no_rag",
    )
    charge = deterministic_token_charge_decision(message)

    assert response["turn_resolution"]["resolved_intent"] == expected_intent
    assert response["intent"] == expected_intent
    assert response["learning_trace"]["query_understanding"]["intent"] == expected_intent
    assert response["risk"] == expected_risk
    assert response["evidence"]["intent"] == expected_intent
    assert charge.chargeable is expected_chargeable


@pytest.mark.parametrize(
    "message",
    (
        "你好，今天过得怎么样？我们先随便聊两句。",
        "我们先随便聊两句",
        "先闲聊一下",
        "陪我聊会儿",
        "今天有点累",
        "Let's just chat for a moment",
        "How is your day going?",
    ),
)
def test_session_step_uses_explicit_focus_for_casual_message(
    monkeypatch,
    message,
):
    projection = topic_projection(
        canonical_topic="Concept:function",
        label="function",
    )
    function_frame = projection["topics"]["topic-current"]
    suspended = json.loads(json.dumps(function_frame))
    suspended.update(
        {
            "topic_id": "topic-list",
            "canonical_topic": "Concept:list",
            "topic_label": "list",
            "aliases": ["list"],
            "status": "suspended",
        }
    )
    projection["back_stack"] = ["topic-list"]
    projection["topics"]["topic-list"] = suspended
    monkeypatch.setattr(
        session,
        "resolve_turn",
        lambda message, projection, requested_focus_node_id, recent_messages: resolve_turn_contract(
            message,
            projection,
            requested_focus_node_id,
            recent_messages,
            allow_llm=False,
        ),
    )

    response = session.next_session_step(
        session_id="task3-casual",
        client_turn_id="task3-casual-turn",
        conversation_projection=projection,
        message=message,
        stage="start",
        baseline_mode="full_memory",
        recent_messages=[
            {"role": "student", "content": "function 怎么定义？"},
            {"role": "agent", "content": "我们正在学习 function。"},
        ],
        requested_focus_node_id="Concept:len",
    )

    resolution = response["turn_resolution"]
    assert resolution["resolved_intent"] == "concept_question"
    assert resolution["conversation_relation"] == "kg_explore"
    assert resolution["selected_node"]["usage"] == "used"
    assert resolution["workflow_action"] in {"initialize", "continue"}
    assert "len" in resolution["retrieval_query"].lower()
    assert response["intent"] == "concept_question"
    assert response["risk"] == "normal"
    assert deterministic_token_charge_decision(message).chargeable is False
    replayed = response["next_conversation_projection"]
    active = replayed["topics"][replayed["active_topic_id"]]
    assert active["canonical_topic"] == "Concept:len"


@pytest.mark.parametrize(
    ("range_marker", "prompt"),
    [
        ("1-5", "On a scale from 1-5, how confident are you about Python function?"),
        ("1–5", "请按 1–5 给 Python function 的理解程度打分。"),
        ("1 到 5", "请按 1 到 5 给 Python function 的信心打分。"),
        ("1至5", "请按 1至5 给 Python function 的理解程度打分。"),
        ("from 1 to 5", "Rate your Python function confidence from 1 to 5."),
        (None, "Try one Python function example before we continue."),
    ],
)
def test_session_step_rating_one_uses_active_topic(monkeypatch, range_marker, prompt):
    projection = topic_projection(
        canonical_topic="Concept:function",
        label="function",
        workflow_state="confidence_before_required",
        active_gate_id="student-learning/confidence-calibration-check",
        hint_level=4,
        next_required_action="collect_confidence_before",
        confidence_before=None,
    )
    expected_topics = json.loads(json.dumps(projection["topics"]))
    monkeypatch.setattr(session, "generate_teaching_response", _task3_generate_teaching_response)
    monkeypatch.setattr(session, "search_chunks", lambda *args, **kwargs: session.empty_rag_result())
    monkeypatch.setattr(
        session,
        "resolve_turn",
        lambda message, projection, requested_focus_node_id, recent_messages: resolve_turn_contract(
            message,
            projection,
            requested_focus_node_id,
            recent_messages,
            allow_llm=False,
        ),
    )

    response = session.next_session_step(
        session_id="task3-rating",
        client_turn_id="task3-rating-turn",
        conversation_projection=projection,
        message="1",
        stage="start",
        baseline_mode="full_memory",
        recent_messages=[
            {"role": "student", "content": "dictionary 的 key 怎么取？"},
            {"role": "agent", "content": prompt},
        ],
    )
    resolution = response["turn_resolution"]

    if range_marker is None:
        assert resolution["conversation_relation"] == "unresolved"
        assert resolution["active_topic_after"] == "topic-current"
        assert resolution["workflow_action"] == "preserve_without_advance"
        assert resolution["retrieval_query"] == ""
        assert response["next_conversation_projection"]["topics"] == expected_topics
        return

    assert resolution["conversation_relation"] in {"continue", "clarify_current"}
    assert resolution["active_topic_after"] == "topic-current"
    assert resolution["topic_transition"] is None
    assert resolution["workflow_action"] == "continue"
    assert "function" in resolution["retrieval_query"].lower()
    assert "dictionary" not in resolution["retrieval_query"].lower()
    active = response["next_conversation_projection"]["topics"]["topic-current"]
    assert active["pedagogy_state"]["confidence_before"] == pytest.approx(0.2)


def test_chargeable_direct_request_overrides_gate_and_preserves_tuple_for_next_turn(monkeypatch):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return QueryUnderstandingResult(
            intent="concept_question",
            raw_message=message,
            retrieval_query="Python tuple immutability object storage",
            concept_hints=["Concept:tuple", "Concept:immutability"],
            needs_code=False,
            risk="direct_answer_dependency",
            llm_used=False,
            llm_fallback=True,
            chat_model="test-model",
        )

    def fake_generate_teaching_response(**kwargs):
        if kwargs["allow_direct_answer"]:
            prompt = "A tuple can store references to objects of any type, such as `tuple[0]`. It is immutable because its items cannot be reassigned."
        else:
            prompt = "You already know tuples store different objects. What does immutable mean for changing one item?"
        return {
            "prompt": prompt,
            "teaching_strategy": "test",
            "llm_used": False,
            "llm_fallback": True,
            "fallback_reason": "test",
            "fallback_detail": None,
            "guardrail_reason": None,
            "llm_guardrail_triggered": False,
            "chat_model": "test-model",
            "token_usage": {"model": "test-model", "prompt_tokens": 90, "completion_tokens": 90, "total_tokens": 180, "usage_unavailable": False},
            "direct_answer_contract": {"valid": kwargs["allow_direct_answer"], "question_free": kwargs["allow_direct_answer"]},
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "search_chunks", fake_search_chunks)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)
    monkeypatch.setattr(
        session,
        "resolve_turn",
        lambda message, projection, requested_focus_node_id, recent_messages: resolve_turn_contract(
            message, projection, requested_focus_node_id, recent_messages, allow_llm=False
        ),
    )
    direct_decision = TokenChargeDecisionResponse(
        chargeable=True,
        reason_code="deterministic_direct_request",
        confidence=1.0,
        decision_source="deterministic_fallback",
        model="deterministic-rules",
    )
    initial_projection = topic_projection(canonical_topic="Concept:tuple", label="tuple")

    direct = session.next_session_step(
        session_id="direct-answer-entitlement",
        client_turn_id="direct-turn",
        conversation_projection=initial_projection,
        message="Give me the direct answer about tuples.",
        stage="start",
        baseline_mode="full_memory",
        requested_focus_node_id="Concept:tuple",
        token_charge_decision=direct_decision,
    )

    assert direct["direct_answer_entitlement"] is True
    assert direct["allow_direct_answer"] is True
    assert direct["requires_student_attempt"] is False
    assert direct["direct_answer_given"] is True
    assert direct["skill_state"]["preempted_policy"]["state"] != "direct_answer_allowed"
    assert direct["answered_concept"] == "Concept:tuple"

    follow_up = session.next_session_step(
        session_id="direct-answer-entitlement",
        client_turn_id="follow-up-turn",
        conversation_projection=direct["next_conversation_projection"],
        message="Why is it immutable?",
        stage="hint",
        baseline_mode="full_memory",
        recent_messages=direct["next_recent_messages"],
        last_evidence=direct["evidence"],
        token_charge_decision=TokenChargeDecisionResponse(
            chargeable=False,
            reason_code="deterministic_free_default",
            confidence=1.0,
            decision_source="deterministic_fallback",
            model="deterministic-rules",
        ),
    )

    assert follow_up["direct_answer_entitlement"] is False
    assert follow_up["allow_direct_answer"] is False
    assert follow_up["kg_grounding"]["selected_node_ids"][0] == "Concept:tuple"
    assert follow_up["skill_state"]["state"] != "direct_answer_allowed"
