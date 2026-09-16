from app import query_understanding
from app.dashscope import DashScopeConfigurationError
from app.session import iter_session_step_events, next_session_step


def _raise_model_unavailable():
    raise DashScopeConfigurationError("model unavailable in this test")


def test_stream_model_unavailable_input_skips_list_grounding_and_rag(monkeypatch):
    monkeypatch.setattr(query_understanding, "get_chat_provider", _raise_model_unavailable)
    events = list(
        iter_session_step_events(
            session_id="session-test",
            message="hello?",
            stage="student_question",
            baseline_mode="full_memory",
            episode_id=1,
        ),
    )

    query_event = next(event for event in events if event["type"] == "query_understanding_done")
    kg_event = next(event for event in events if event["type"] == "kg_grounding_done")
    rag_event = next(event for event in events if event["type"] == "rag_evidence_done")
    response_event = next(event for event in events if event["type"] == "guided_response_done")

    assert query_event["query_understanding"]["route"] == "greeting"
    assert query_event["query_understanding"]["rewritten_query"] == ""
    assert query_event["query_understanding"]["concept_hints"] == []
    assert kg_event["kg_grounding"]["selected_node_ids"] == []
    assert kg_event["kg_grounding"]["knowledge_path_view"]["upstream"] == []
    assert kg_event["kg_grounding"]["knowledge_path_view"]["current"] == []
    assert kg_event["kg_grounding"]["knowledge_path_view"]["downstream"] == []
    assert rag_event["rag_evidence"] == []
    assert "Python question" in response_event["answer"]
    assert "list" not in response_event["answer"].lower()


def test_non_stream_model_unavailable_input_skips_list_grounding_and_rag(monkeypatch):
    monkeypatch.setattr(query_understanding, "get_chat_provider", _raise_model_unavailable)
    response = next_session_step(
        session_id="session-test",
        message="what can I say",
        stage="student_question",
        baseline_mode="full_memory",
        episode_id=1,
    )

    trace = response["learning_trace"]
    assert response["route"] == "python_unclear"
    assert trace["kg_grounding"]["selected_node_ids"] == []
    assert trace["rag_evidence"] == []
    assert "Python learning target" in trace["answer"]
    assert "list" not in trace["answer"].lower()
