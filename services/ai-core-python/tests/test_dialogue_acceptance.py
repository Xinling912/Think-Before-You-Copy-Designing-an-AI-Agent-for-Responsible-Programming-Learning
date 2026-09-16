from __future__ import annotations

import copy
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import session
from app.conversation_events import ConversationEvent
from app.conversation_projection import ConversationProjection, project_events
from app.main import app
from app.turn_resolution import TurnResolution, resolve_turn as resolve_turn_contract
from tests.probe_set import DIALOGUE_ACCEPTANCE_CASES


REPO_ROOT = Path(__file__).resolve().parents[3]
GO_SERVICE = REPO_ROOT / "services" / "api-gateway-go"
FIXED_TIME = "2026-07-20T00:00:00Z"
PRESERVED_TOPIC_FIELDS = (
    "active_kg_focus_node_id",
    "last_kg_path",
    "last_rag_chunk_ids",
    "pedagogy_state",
    "unresolved_question",
)


@dataclass(frozen=True)
class DialogueRun:
    resolution: dict[str, Any]
    final_projection: dict[str, Any]
    initial_projection: dict[str, Any]
    prompts: tuple[str, ...]
    results: tuple[dict[str, Any], ...]
    stream_events: tuple[dict[str, Any], ...]
    pending_selection: str | None
    failed: bool


class DeterministicResolutionProvider:
    provider = "acceptance-stub"
    model = "acceptance-stub"

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def chat(self, messages, temperature=None, max_tokens=None) -> str:
        del messages, temperature, max_tokens
        return json.dumps(self.payload, ensure_ascii=False)


def _topic_frame(
    canonical_topic: str,
    label: str,
    *,
    status: str = "active",
    workflow_state: str = "hint_level_2",
    active_gate_id: str = "student-learning/progressive-hint-ladder",
    hint_level: int = 2,
    next_required_action: str = "apply_hint",
    confidence_before: float | None = 0.6,
) -> dict[str, Any]:
    slug = canonical_topic.partition(":")[2].replace("_", "-")
    return {
        "topic_id": f"topic-{slug}",
        "canonical_topic": canonical_topic,
        "topic_label": label,
        "aliases": [label, canonical_topic.partition(":")[2]],
        "status": status,
        "summary": f"学生正在学习 {label}；尚未解决 {label} 的示例问题；下一步执行 {next_required_action}。",
        "unresolved_question": f"{label} 的示例问题是什么？",
        "turn_ids": [f"prior-{slug}"],
        "active_kg_focus_node_id": canonical_topic,
        "last_kg_path": [canonical_topic, "Concept:object"],
        "last_rag_chunk_ids": [f"chunk-{slug}"],
        "pedagogy_state": {
            "workflow_state": workflow_state,
            "active_gate_id": active_gate_id,
            "hint_level": hint_level,
            "next_required_action": next_required_action,
            "confidence_before": confidence_before,
            "confidence_after": None,
            "teach_back_required": False,
        },
        "created_at": FIXED_TIME,
        "last_active_at": FIXED_TIME,
    }


def _projection(precondition: str) -> dict[str, Any]:
    if precondition == "empty":
        return ConversationProjection.empty().model_dump(mode="json")

    labels = {
        "list": ("Concept:list", "list"),
        "dictionary": ("Concept:dict", "dictionary"),
        "len": ("Concept:len", "len"),
        "function": ("Concept:function", "function"),
    }
    if precondition == "dictionary_confidence":
        frame = _topic_frame(
            "Concept:dict",
            "dictionary",
            workflow_state="confidence_before_required",
            active_gate_id="student-learning/confidence-calibration-check",
            hint_level=4,
            next_required_action="collect_confidence_before",
            confidence_before=None,
        )
        return {
            "schema_version": 1,
            "last_sequence": 0,
            "active_topic_id": frame["topic_id"],
            "back_stack": [],
            "topics": {frame["topic_id"]: frame},
        }
    if precondition == "dictionary_with_back_stack":
        old = _topic_frame("Concept:list", "list", status="suspended")
        current = _topic_frame("Concept:dict", "dictionary")
        return {
            "schema_version": 1,
            "last_sequence": 0,
            "active_topic_id": current["topic_id"],
            "back_stack": [old["topic_id"]],
            "topics": {old["topic_id"]: old, current["topic_id"]: current},
        }
    if precondition == "history_list_dictionary_function":
        list_frame = _topic_frame("Concept:list", "list", status="suspended")
        dictionary_frame = _topic_frame(
            "Concept:dict", "dictionary", status="suspended"
        )
        function_frame = _topic_frame("Concept:function", "function")
        return {
            "schema_version": 1,
            "last_sequence": 0,
            "active_topic_id": function_frame["topic_id"],
            "back_stack": [list_frame["topic_id"], dictionary_frame["topic_id"]],
            "topics": {
                list_frame["topic_id"]: list_frame,
                dictionary_frame["topic_id"]: dictionary_frame,
                function_frame["topic_id"]: function_frame,
            },
        }
    canonical_topic, label = labels[precondition]
    frame = _topic_frame(canonical_topic, label)
    return {
        "schema_version": 1,
        "last_sequence": 0,
        "active_topic_id": frame["topic_id"],
        "back_stack": [],
        "topics": {frame["topic_id"]: frame},
    }


def _fake_teaching_response(**kwargs) -> dict[str, Any]:
    message = str(kwargs["message"])
    topic = str(kwargs["kg_result"].get("topic_label") or "Python")
    if re.search(r"[\u4e00-\u9fff]", message):
        body = f"我们继续围绕 {topic} 学习，并用当前问题确认理解。"
    else:
        body = f"We will continue learning {topic} from the current question."
    return {
        "prompt": body,
        "teaching_strategy": "deterministic-acceptance-stub",
        "llm_used": False,
        "llm_fallback": True,
        "fallback_reason": "acceptance_stub",
        "fallback_detail": None,
        "guardrail_reason": None,
        "llm_guardrail_triggered": False,
        "chat_model": "acceptance-stub",
        "token_usage": {
            "model": "acceptance-stub",
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "usage_unavailable": True,
        },
    }


@pytest.fixture(autouse=True)
def deterministic_teaching_provider(monkeypatch):
    monkeypatch.setattr(session, "generate_teaching_response", _fake_teaching_response)


def _resolver_with_rejected_provider(override: str):
    def resolver(message, projection, requested_focus_node_id, recent_messages):
        deterministic = resolve_turn_contract(
            message,
            projection,
            requested_focus_node_id,
            recent_messages,
        )
        payload = deterministic.model_dump(mode="json")
        if override == "rewrite_to_len":
            payload["retrieval_query"] = "Python len usage"
        elif override == "intent_unknown":
            payload["resolved_intent"] = "unknown"
        else:
            raise AssertionError(f"unsupported provider override: {override}")
        return resolve_turn_contract(
            message,
            projection,
            requested_focus_node_id,
            recent_messages,
            provider=DeterministicResolutionProvider(payload),
            allow_llm=True,
        )

    return resolver


def _topic_by_canonical(projection: dict[str, Any], canonical_topic: str) -> dict[str, Any]:
    matches = [
        frame
        for frame in projection["topics"].values()
        if frame["canonical_topic"] == canonical_topic
    ]
    assert len(matches) == 1, (canonical_topic, projection["topics"])
    return matches[0]


def _initial_recent_messages(projection: dict[str, Any]) -> list[dict[str, str]]:
    active_topic_id = projection.get("active_topic_id")
    if not active_topic_id:
        return []
    frame = projection["topics"][active_topic_id]
    return [
        {
            "event_id": f"context-{active_topic_id}",
            "role": "student",
            "content": f"怎么学习{frame['topic_label']}？",
        },
        {
            "event_id": f"context-{active_topic_id}-answer",
            "role": "agent",
            "content": frame["summary"],
        },
    ]


def _run_dialogue_case(case: dict[str, Any], monkeypatch) -> DialogueRun:
    projection = _projection(case["precondition"])
    initial_projection = copy.deepcopy(projection)
    recent_messages: list[dict[str, Any]] = _initial_recent_messages(projection)
    prompts: list[str] = []
    results: list[dict[str, Any]] = []
    pending_selection: str | None = None
    captured_resolution: TurnResolution | None = None

    for index, turn in enumerate(case["turns"]):
        pending_selection = turn.get("selected_node_id")
        original_resolver = session.resolve_turn

        def capture_resolution(*args, **kwargs):
            nonlocal captured_resolution
            captured_resolution = original_resolver(*args, **kwargs)
            return captured_resolution

        resolver = (
            _resolver_with_rejected_provider(turn["provider_override"])
            if turn.get("provider_override")
            else capture_resolution
        )
        if turn.get("provider_override"):
            provider_resolver = resolver

            def capture_provider_resolution(*args, **kwargs):
                nonlocal captured_resolution
                captured_resolution = provider_resolver(*args, **kwargs)
                return captured_resolution

            resolver = capture_provider_resolution

        with monkeypatch.context() as scoped:
            scoped.setattr(session, "resolve_turn", resolver)
            if turn.get("fail_during_response"):
                def fail_response(**kwargs):
                    del kwargs
                    raise RuntimeError("injected streamed response failure")

                scoped.setattr(session, "generate_teaching_response", fail_response)
                stream_events: list[dict[str, Any]] = []
                stream = session.iter_session_step_events(
                    session_id=f"acceptance-{case['case_id'].lower()}",
                    client_turn_id=f"{case['case_id'].lower()}-turn-{index + 1}",
                    conversation_projection=projection,
                    message=turn["message"],
                    stage="start",
                    baseline_mode="no_rag",
                    recent_messages=recent_messages,
                    requested_focus_node_id=pending_selection,
                )
                with pytest.raises(RuntimeError, match="injected streamed response failure"):
                    while True:
                        stream_events.append(next(stream))
                assert captured_resolution is not None
                return DialogueRun(
                    resolution=captured_resolution.model_dump(mode="json"),
                    final_projection=projection,
                    initial_projection=initial_projection,
                    prompts=tuple(prompts),
                    results=tuple(results),
                    stream_events=tuple(stream_events),
                    pending_selection=pending_selection,
                    failed=True,
                )

            result = session.next_session_step(
                session_id=f"acceptance-{case['case_id'].lower()}",
                client_turn_id=f"{case['case_id'].lower()}-turn-{index + 1}",
                conversation_projection=projection,
                message=turn["message"],
                stage="start",
                baseline_mode="no_rag",
                recent_messages=recent_messages,
                requested_focus_node_id=pending_selection,
            )

        results.append(result)
        prompts.append(result["prompt"])
        projection = result["next_conversation_projection"]
        recent_messages = result["next_recent_messages"]
        pending_selection = None

    assert results
    return DialogueRun(
        resolution=results[-1]["turn_resolution"],
        final_projection=projection,
        initial_projection=initial_projection,
        prompts=tuple(prompts),
        results=tuple(results),
        stream_events=(),
        pending_selection=pending_selection,
        failed=False,
    )


@pytest.mark.parametrize(
    "case",
    DIALOGUE_ACCEPTANCE_CASES,
    ids=[case["case_id"] for case in DIALOGUE_ACCEPTANCE_CASES],
)
def test_dialogue_acceptance(case, monkeypatch):
    run = _run_dialogue_case(case, monkeypatch)
    resolution = run.resolution
    final_prompt = run.prompts[-1] if run.prompts else ""

    assert resolution["conversation_relation"] == case["expected_relation"]
    if "expected_intent" in case:
        assert resolution["resolved_intent"] == case["expected_intent"]
    assert resolution["selected_node"]["usage"] == case["expected_selection_usage"]
    assert resolution["workflow_action"] == case["expected_workflow_action"]
    assert run.failed is bool(case.get("failed_turn", False))

    active_topic_id = run.final_projection["active_topic_id"]
    if case["expected_topic"] is None:
        assert active_topic_id is None
    else:
        active = run.final_projection["topics"][active_topic_id]
        assert active["canonical_topic"] == case["expected_topic"]

    if not run.failed:
        if resolution["selected_node"]["usage"] == "absent":
            assert final_prompt.count("Selected Node:") == 0
        else:
            assert final_prompt.count("Selected Node:") == 1
        if resolution["topic_transition"] is None:
            assert final_prompt.count("Topic Transition:") == 0
        else:
            assert final_prompt.count("Topic Transition:") == 1
        if resolution["workflow_action"] in {"initialize", "continue", "restore"}:
            assert run.results[-1]["kg_topic_id"] == case.get(
                "expected_kg_topic",
                case["expected_topic"],
            )

    for required in case.get("required_visible", []):
        assert required.lower() in final_prompt.lower()
    for forbidden in case.get("forbidden_visible", []):
        assert forbidden not in final_prompt
    for turn_index, required in case.get("required_visible_by_turn", []):
        assert required in run.prompts[turn_index]
    for forbidden in case.get("forbidden_retrieval", []):
        assert forbidden not in resolution["retrieval_query"]
    for expected in case.get("expected_resolved_terms", []):
        assert expected.lower() in resolution["resolved_question"].lower()

    if "expected_topic_count" in case:
        assert len(run.final_projection["topics"]) == case["expected_topic_count"]

    for canonical_topic in case.get("preserved_topics", []):
        before = _topic_by_canonical(run.initial_projection, canonical_topic)
        after = _topic_by_canonical(run.final_projection, canonical_topic)
        for field in PRESERVED_TOPIC_FIELDS:
            assert after[field] == before[field]

    restore_topic = case.get("restore_exact_topic")
    if restore_topic:
        before = _topic_by_canonical(run.initial_projection, restore_topic)
        after = _topic_by_canonical(run.final_projection, restore_topic)
        for field in PRESERVED_TOPIC_FIELDS:
            assert after[field] == before[field]

    if case.get("new_topic_must_not_inherit_confidence"):
        before = _topic_by_canonical(run.initial_projection, "Concept:dict")
        active = run.final_projection["topics"][run.final_projection["active_topic_id"]]
        assert active["pedagogy_state"] != before["pedagogy_state"]
        assert active["pedagogy_state"]["workflow_state"] != "confidence_before_required"
        assert active["pedagogy_state"]["hint_level"] != 4

    if case.get("projection_must_be_preserved"):
        assert run.final_projection["active_topic_id"] == run.initial_projection["active_topic_id"]
        assert run.final_projection["back_stack"] == run.initial_projection["back_stack"]
        assert run.final_projection["topics"] == run.initial_projection["topics"]

    if case.get("pedagogy_must_be_unchanged"):
        before = _topic_by_canonical(run.initial_projection, case["expected_topic"])
        after = _topic_by_canonical(run.final_projection, case["expected_topic"])
        assert after["pedagogy_state"] == before["pedagogy_state"]

    if case.get("failed_turn"):
        assert run.results == ()
        assert run.pending_selection == "Concept:len"
        assert run.final_projection == run.initial_projection
        assert [event["type"] for event in run.stream_events] == ["trace_started"]
        serialized_stream = json.dumps(run.stream_events, ensure_ascii=False)
        assert "trace_completed_payload" not in serialized_stream
        assert "conversation_events" not in serialized_stream
        assert "next_conversation_projection" not in serialized_stream
        _assert_frontend_failed_stream_retains_composer_and_selection()

    if case.get("answer_language") == "Chinese":
        answer_body = run.results[-1]["response_contract"]["answer_body"]
        assert re.search(r"[\u4e00-\u9fff]", answer_body)
        assert "Selected Node:" in final_prompt
        assert "Topic Transition:" in final_prompt
    if case.get("context_bridge_language") == "Chinese":
        context_line = next(
            line for line in final_prompt.splitlines() if line.startswith("Previous Context:")
        )
        assert re.search(r"[\u4e00-\u9fff]", context_line)


def _assert_frontend_failed_stream_retains_composer_and_selection() -> None:
    npm_command = "npm.cmd" if os.name == "nt" else "npm"
    completed = subprocess.run(
        [
            npm_command,
            "test",
            "--",
            "src/pages/SessionDemo/sessionDemo.component.test.tsx",
            "-t",
            "failed streamed turn restores the message and reuses its client turn ID for retry",
        ],
        cwd=REPO_ROOT / "frontend",
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )
    output = completed.stdout + completed.stderr
    assert completed.returncode == 0, output
    assert re.search(r"Tests\s+1 passed", output), output


def _run_go_store_test(test_name: str) -> None:
    completed = subprocess.run(
        ["go", "test", "./internal/store", "-run", f"^{test_name}$", "-count=1"],
        cwd=GO_SERVICE,
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def _request_payload(**updates: Any) -> dict[str, Any]:
    payload = {
        "session_id": "acceptance-endpoint",
        "client_turn_id": "acceptance-endpoint-turn",
        "conversation_projection": {},
        "message": "什么是 Python list？",
        "stage": "start",
        "baseline_mode": "no_rag",
    }
    payload.update(updates)
    return payload


def test_invalid_selected_node_persists_nothing():
    client = TestClient(app)
    supplied_projection = _projection("dictionary")
    original_projection = copy.deepcopy(supplied_projection)

    response = client.post(
        "/ai/session/step",
        json=_request_payload(
            conversation_projection=supplied_projection,
            requested_focus_node_id="Concept:not_in_catalog",
        ),
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": "invalid_focus_node_id",
        "requested_focus_node_id": "Concept:not_in_catalog",
    }
    assert "conversation_events" not in response.json()
    assert "next_conversation_projection" not in response.json()
    assert supplied_projection == original_projection


def test_duplicate_client_turn_persists_nothing_twice():
    _run_go_store_test("TestPersistCompletedSessionTurnRejectsDuplicateCommittedClientTurn")


def test_completed_turn_rolls_back_every_artifact():
    _run_go_store_test("TestPersistCompletedSessionTurnRollsBackAllArtifactsOnProjectionSequenceError")


def test_event_replay_equals_stored_projection():
    first = session.next_session_step(
        session_id="acceptance-replay",
        client_turn_id="acceptance-replay-1",
        conversation_projection={},
        message="what is list?",
        stage="start",
        baseline_mode="no_rag",
    )
    second = session.next_session_step(
        session_id="acceptance-replay",
        client_turn_id="acceptance-replay-2",
        conversation_projection=first["next_conversation_projection"],
        message="what is dictionary?",
        stage="start",
        baseline_mode="no_rag",
    )
    events = [
        ConversationEvent.model_validate(item)
        for result in (first, second)
        for item in result["conversation_events"]
    ]

    replayed = project_events(events).model_dump(mode="json")
    assert json.dumps(replayed, ensure_ascii=False, sort_keys=True) == json.dumps(
        second["next_conversation_projection"], ensure_ascii=False, sort_keys=True
    )


def test_event_sequences_are_gap_free():
    projection: dict[str, Any] = {}
    all_sequences: list[int] = []
    for index, message in enumerate(("what is list?", "what is dictionary?", "back"), start=1):
        result = session.next_session_step(
            session_id="acceptance-sequences",
            client_turn_id=f"acceptance-sequences-{index}",
            conversation_projection=projection,
            message=message,
            stage="start",
            baseline_mode="no_rag",
        )
        events = result["conversation_events"]
        assert [event["ordinal"] for event in events] == list(range(1, len(events) + 1))
        all_sequences.extend(event["sequence"] for event in events)
        projection = result["next_conversation_projection"]

    assert all_sequences == list(range(1, len(all_sequences) + 1))
    assert projection["last_sequence"] == all_sequences[-1]


def test_stream_and_non_stream_are_contract_equivalent():
    client = TestClient(app)
    payload = _request_payload(
        session_id="acceptance-parity",
        client_turn_id="acceptance-parity-turn",
        requested_focus_node_id="Concept:len",
        message="这是啥意思？",
    )

    normal = client.post("/ai/session/step", json=payload)
    streamed = client.post("/ai/session/step/stream", json=payload)
    assert normal.status_code == streamed.status_code == 200
    stream_events = [json.loads(line) for line in streamed.text.splitlines() if line.strip()]
    completed = next(
        event["response"]
        for event in stream_events
        if event["type"] == "trace_completed_payload"
    )
    normal_payload = normal.json()

    for field in (
        "turn_resolution",
        "response_contract",
        "prompt",
        "next_conversation_projection",
    ):
        assert completed[field] == normal_payload[field]


def test_explicit_set_focus_reaches_query_kg_rag_and_guided_response(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_search(query: str, concepts: list[str] | None = None, top_k: int = 5) -> dict:
        captured["query"] = query
        captured["concepts"] = concepts or []
        captured["top_k"] = top_k
        return {
            "retrieval_mode": "semantic-vector-rerank",
            "kg_guided": bool(concepts),
            "index": {"backend": "faiss-flat-ip", "document_count": 2154},
            "reranker": {"enabled": True, "candidate_count": 40},
            "chunks": [
                {
                    "chunk_id": "python-docs-set",
                    "source": "python-official-docs",
                    "concepts": ["Concept:set"],
                    "score": 0.91,
                    "embedding_score": 0.77,
                    "rerank_score": 0.91,
                    "title": "Sets",
                    "heading_path": ["Data Structures", "Sets"],
                    "source_url": "https://docs.python.org/3/tutorial/datastructures.html#sets",
                }
            ],
        }

    monkeypatch.setattr(session, "search_chunks", fake_search)
    response = session.next_session_step(
        session_id="context-first-set",
        client_turn_id="context-first-set-1",
        conversation_projection=ConversationProjection.empty(),
        message="what's this concept about?",
        stage="student_question",
        requested_focus_node_id="Concept:set",
    )

    assert "set" in response["rewritten_query"].lower()
    assert response["kg_grounding"]["focus_source"] == "explicit"
    assert response["kg_grounding"]["requested_focus_node_id"] == "Concept:set"
    assert "Concept:set" in response["kg_grounding"]["selected_node_ids"]
    assert response["rag_retrieval_mode"] == "semantic-vector-rerank"
    assert response["state"] != "onboarding"
    assert "set" in response["prompt"].lower()
    assert "set" in captured["query"].lower()
    assert "Concept:set" in captured["concepts"]
