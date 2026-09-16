import pytest
from pydantic import ValidationError

from app.response_contract import (
    StructuredTeachingAnswer,
    build_response_contract,
    render_teaching_response,
)
from app.turn_resolution import (
    SelectedNodeResolution,
    TopicTransition,
    TurnResolution,
)
from app import session


def resolution(
    *,
    selection_usage: str = "absent",
    selection_label: str | None = None,
    relation: str = "continue",
    transition: TopicTransition | None = None,
) -> TurnResolution:
    return TurnResolution(
        original_message="这是啥意思？",
        resolved_question="Python 的 len 是什么意思？",
        resolved_intent="concept_question",
        conversation_relation=relation,
        active_topic_before="topic-dictionary",
        active_topic_after="topic-len",
        target_topic_id="topic-len",
        selected_node=SelectedNodeResolution(
            node_id="Concept:len" if selection_usage != "absent" else None,
            label=selection_label,
            usage=selection_usage,
            reason="test",
        ),
        topic_transition=transition,
        workflow_action=(
            "restore"
            if relation in {"resume_previous", "resume_named"}
            else "initialize"
            if transition is not None
            else "continue"
        ),
        retrieval_query="Python len",
        resolution_confidence=1.0,
    )


def test_rejected_selection_uses_exact_english_marker_once():
    rendered = render_teaching_response(
        answer_body="我们继续回答 dictionary 的问题。",
        resolution=resolution(selection_usage="not_used", selection_label="len"),
        context_summary=None,
    )

    assert rendered == (
        "Selected Node: len · Not used for this response\n\n"
        "我们继续回答 dictionary 的问题。"
    )
    assert rendered.count("Selected Node:") == 1


def test_used_selection_uses_exact_english_marker_and_preserves_chinese_body():
    rendered = render_teaching_response(
        answer_body="len 返回容器中的元素数量。",
        resolution=resolution(selection_usage="used", selection_label="len"),
        context_summary=None,
    )

    assert rendered == "Selected Node: len\n\nlen 返回容器中的元素数量。"


def test_selection_label_falls_back_to_node_id_suffix():
    rendered = render_teaching_response(
        answer_body="Count the elements.",
        resolution=resolution(selection_usage="used"),
        context_summary=None,
    )

    assert rendered.startswith("Selected Node: len\n\n")


def test_absent_selection_renders_no_selection_line():
    rendered = render_teaching_response(
        answer_body="Lists are ordered mutable sequences.",
        resolution=resolution(),
        context_summary=None,
    )

    assert rendered == "Lists are ordered mutable sequences."
    assert "Selected Node:" not in rendered


def test_switch_renders_metadata_in_exact_order_with_previous_context():
    switched = resolution(
        selection_usage="used",
        selection_label="len",
        relation="kg_explore",
        transition=TopicTransition(
            kind="switch", from_label="dictionary", to_label="len"
        ),
    )

    rendered = render_teaching_response(
        answer_body="我们现在来看 len。",
        resolution=switched,
        context_summary="学生正在学习 dictionary 的键值映射。",
    )

    assert rendered == (
        "Selected Node: len\n"
        "Topic Transition: dictionary → len\n"
        "Previous Context: 学生正在学习 dictionary 的键值映射。\n\n"
        "我们现在来看 len。"
    )
    assert rendered.count("Topic Transition:") == 1
    assert rendered.count("Previous Context:") == 1


def test_back_renders_transition_then_resumed_context_then_english_body():
    resumed = resolution(
        relation="resume_previous",
        transition=TopicTransition(
            kind="resume", from_label="dictionary", to_label="list"
        ),
    )

    rendered = render_teaching_response(
        answer_body="We can continue from the valid-index question.",
        resolution=resumed,
        context_summary="The student was checking the valid index range.",
    )

    assert rendered == (
        "Topic Transition: dictionary → list\n"
        "Resumed Context: The student was checking the valid index range.\n\n"
        "We can continue from the valid-index question."
    )


def test_continuation_renders_neither_transition_nor_context_label():
    rendered = render_teaching_response(
        answer_body="Keep working with the same list example.",
        resolution=resolution(),
        context_summary="This must not appear on a continuation.",
    )

    assert rendered == "Keep working with the same list example."
    assert "Topic Transition:" not in rendered
    assert "Previous Context:" not in rendered
    assert "Resumed Context:" not in rendered


def test_structured_answer_requires_nonblank_body_and_bounds_summary():
    with pytest.raises(ValidationError):
        StructuredTeachingAnswer(answer_body="   ")
    with pytest.raises(ValidationError):
        StructuredTeachingAnswer(answer_body="valid", topic_summary_update="x" * 241)

    answer = StructuredTeachingAnswer(
        answer_body="valid", topic_summary_update="x" * 240
    )
    assert len(answer.topic_summary_update or "") == 240


@pytest.mark.parametrize(
    "reserved_line",
    [
        "Selected Node: len",
        "Topic Transition: list → len",
        "Previous Context: old",
        "Resumed Context: old",
    ],
)
def test_structured_answer_rejects_application_owned_metadata(reserved_line):
    with pytest.raises(ValidationError):
        StructuredTeachingAnswer(answer_body=f"Explanation.\n{reserved_line}")


def test_response_contract_exposes_body_and_structured_metadata():
    switched = resolution(
        selection_usage="not_used",
        selection_label="len",
        relation="switch_topic",
        transition=TopicTransition(
            kind="switch", from_label="list", to_label="dictionary"
        ),
    )
    answer = StructuredTeachingAnswer(answer_body="我们继续回答 dictionary。")

    contract = build_response_contract(
        answer=answer,
        resolution=switched,
        context_summary="学生此前在学习 list。",
    )

    assert contract == {
        "selected_node_label": "len",
        "selected_node_usage": "not_used",
        "topic_transition": {
            "kind": "switch",
            "from_label": "list",
            "to_label": "dictionary",
        },
        "context_label": "Previous Context",
        "context_summary": "学生此前在学习 list。",
        "answer_language": "Chinese",
        "answer_body": "我们继续回答 dictionary。",
        "topic_summary_update": None,
    }


def test_response_contract_identifies_english_answer_language():
    contract = build_response_contract(
        answer=StructuredTeachingAnswer(answer_body="Let us continue."),
        resolution=resolution(),
        context_summary=None,
    )

    assert contract["answer_language"] == "English"


def _teaching_response(answer_body: str) -> dict:
    return {
        "prompt": answer_body,
        "teaching_strategy": "test",
        "llm_used": False,
        "llm_fallback": True,
        "fallback_reason": "test",
        "fallback_detail": None,
        "guardrail_reason": None,
        "llm_guardrail_triggered": False,
        "chat_model": "fallback-rules",
        "token_usage": session._unavailable_token_usage("fallback-rules"),
    }


def test_session_publishes_and_persists_one_rendered_selection_marker(monkeypatch):
    monkeypatch.setattr(
        session,
        "generate_teaching_response",
        lambda **kwargs: _teaching_response("len 返回容器中的元素数量。"),
    )

    response = session.next_session_step(
        session_id="response-contract-selection",
        client_turn_id="turn-selection",
        conversation_projection={},
        message="这是啥意思？",
        stage="start",
        baseline_mode="no_rag",
        requested_focus_node_id="Concept:len",
    )

    assert response["response_contract"]["selected_node_label"] == "len"
    assert response["response_contract"]["selected_node_usage"] == "used"
    assert response["response_contract"]["answer_body"] == "len 返回容器中的元素数量。"
    assert response["prompt"] == (
        "Selected Node: len\n\nlen 返回容器中的元素数量。"
    )
    assert response["prompt"].count("Selected Node:") == 1
    assert response["evidence"]["response_contract"] == response["response_contract"]
    assert response["learning_trace"]["response_contract"] == response["response_contract"]
    assert response["learning_trace"]["answer"] == response["prompt"]
    assert response["next_recent_messages"][-1] == {
        "role": "agent",
        "content": response["prompt"],
    }
    committed = next(
        event
        for event in response["conversation_events"]
        if event["event_type"] == "assistant_response_committed"
    )
    assert committed["payload"]["answer"] == response["prompt"]


def test_session_switch_uses_stored_previous_topic_summary(monkeypatch):
    monkeypatch.setattr(
        session,
        "generate_teaching_response",
        lambda **kwargs: _teaching_response("Lists are ordered mutable sequences."),
    )
    first = session.next_session_step(
        session_id="response-contract-switch",
        client_turn_id="turn-list",
        conversation_projection={},
        message="what is list?",
        stage="start",
        baseline_mode="no_rag",
    )
    list_topic_id = first["next_conversation_projection"]["active_topic_id"]
    stored_summary = first["next_conversation_projection"]["topics"][list_topic_id][
        "summary"
    ]
    monkeypatch.setattr(
        session,
        "generate_teaching_response",
        lambda **kwargs: _teaching_response("Dictionaries map keys to values."),
    )

    second = session.next_session_step(
        session_id="response-contract-switch",
        client_turn_id="turn-dictionary",
        conversation_projection=first["next_conversation_projection"],
        message="what is dictionary?",
        stage="start",
        baseline_mode="no_rag",
    )

    assert second["response_contract"]["context_label"] == "Previous Context"
    assert second["response_contract"]["context_summary"] == stored_summary
    assert second["prompt"] == (
        "Topic Transition: list → dictionary\n"
        f"Previous Context: {stored_summary}\n\n"
        "Dictionaries map keys to values."
    )


def test_session_onboarding_also_exposes_structured_body_without_metadata():
    response = session.next_session_step(
        session_id="response-contract-greeting",
        client_turn_id="turn-greeting",
        conversation_projection={},
        message="hello",
        stage="start",
        baseline_mode="no_rag",
    )

    assert response["response_contract"] == {
        "selected_node_label": None,
        "selected_node_usage": "absent",
        "topic_transition": None,
        "context_label": None,
        "context_summary": None,
        "answer_language": "English",
        "answer_body": response["prompt"],
        "topic_summary_update": None,
    }
    assert response["learning_trace"]["response_contract"] == response["response_contract"]
