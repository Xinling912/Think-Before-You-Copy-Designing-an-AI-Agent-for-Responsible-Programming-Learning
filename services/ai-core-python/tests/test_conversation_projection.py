from __future__ import annotations

from typing import Any

import pytest

from app.conversation_events import ConversationEvent
from app.conversation_projection import (
    ConversationProjection,
    ConversationProjectionEventError,
    ConversationSequenceError,
    TopicFrame,
    TopicPedagogyState,
    apply_events,
    project_events,
)


SESSION_ID = "session-replay"
CLIENT_TURN_ID = "turn-replay"
CREATED_AT = "2026-07-20T10:00:00+08:00"


def event(
    *,
    sequence: int,
    event_type: str = "user_message_received",
    payload: dict[str, Any] | None = None,
) -> ConversationEvent:
    return ConversationEvent(
        event_id=f"event-{sequence}",
        session_id=SESSION_ID,
        client_turn_id=CLIENT_TURN_ID,
        ordinal=sequence,
        sequence=sequence,
        event_type=event_type,
        payload=payload or {},
        created_at=CREATED_AT,
    )


def topic(
    *,
    topic_id: str,
    canonical_topic: str,
    label: str,
    hint_level: int = 0,
    focus_node_id: str | None = None,
) -> TopicFrame:
    return TopicFrame(
        topic_id=topic_id,
        canonical_topic=canonical_topic,
        topic_label=label,
        aliases=[label],
        status="active",
        summary=f"Learning {label}.",
        unresolved_question=f"How does {label} work?",
        turn_ids=[f"turn-{label}"],
        active_kg_focus_node_id=focus_node_id,
        last_kg_path=[canonical_topic] if focus_node_id else [],
        last_rag_chunk_ids=[f"chunk-{label}"],
        pedagogy_state=TopicPedagogyState(
            workflow_state=f"hint_level_{hint_level}",
            active_gate_id="student-learning/progressive-hint-ladder",
            hint_level=hint_level,
            next_required_action="apply_hint",
            confidence_before=None,
            confidence_after=None,
            teach_back_required=False,
        ),
        created_at=CREATED_AT,
        last_active_at=CREATED_AT,
    )


def created_event(sequence: int, frame: TopicFrame) -> ConversationEvent:
    return event(
        sequence=sequence,
        event_type="topic_created",
        payload={"topic": frame.model_dump(mode="json")},
    )


def suspended_event(sequence: int, topic_id: str) -> ConversationEvent:
    return event(
        sequence=sequence,
        event_type="topic_suspended",
        payload={"topic_id": topic_id},
    )


def resumed_event(
    sequence: int,
    topic_id: str,
    *,
    navigation: str,
) -> ConversationEvent:
    return event(
        sequence=sequence,
        event_type="topic_resumed",
        payload={"topic_id": topic_id, "navigation": navigation},
    )


def events_for_dictionary_then_function_then_back() -> list[ConversationEvent]:
    dictionary = topic(
        topic_id="topic-dictionary",
        canonical_topic="Concept:dict",
        label="dictionary",
        hint_level=2,
        focus_node_id="Concept:dict",
    )
    function = topic(
        topic_id="topic-function",
        canonical_topic="Concept:function",
        label="function",
        hint_level=0,
        focus_node_id="Concept:function",
    )
    return [
        created_event(1, dictionary),
        suspended_event(2, dictionary.topic_id),
        created_event(3, function),
        suspended_event(4, function.topic_id),
        resumed_event(5, dictionary.topic_id, navigation="back"),
    ]


def _stable_json(projection: ConversationProjection) -> str:
    ordered_topics = dict(sorted(projection.topics.items()))
    return projection.model_copy(update={"topics": ordered_topics}).model_dump_json()


def test_empty_event_stream_returns_versioned_projection():
    projected = project_events([])

    assert projected == ConversationProjection.empty()
    assert projected.schema_version == 1
    assert projected.last_sequence == 0
    assert projected.active_topic_id is None
    assert projected.back_stack == []
    assert projected.topics == {}


def test_topic_switch_suspends_old_and_pushes_stack():
    dictionary = topic(
        topic_id="topic-dictionary",
        canonical_topic="Concept:dict",
        label="dictionary",
    )
    function = topic(
        topic_id="topic-function",
        canonical_topic="Concept:function",
        label="function",
    )

    projected = project_events(
        [
            created_event(1, dictionary),
            suspended_event(2, dictionary.topic_id),
            created_event(3, function),
        ]
    )

    assert projected.active_topic_id == "topic-function"
    assert projected.back_stack == ["topic-dictionary"]
    assert projected.topics["topic-dictionary"].status == "suspended"
    assert projected.topics["topic-function"].status == "active"


def test_back_restores_exact_topic_frame():
    projected = project_events(events_for_dictionary_then_function_then_back())

    assert projected.active_topic_id == "topic-dictionary"
    assert projected.back_stack == []
    assert projected.topics["topic-function"].status == "suspended"
    assert projected.topics["topic-dictionary"].status == "active"
    assert projected.topics["topic-dictionary"].pedagogy_state.hint_level == 2
    assert projected.topics["topic-dictionary"].active_kg_focus_node_id == "Concept:dict"


def test_named_resume_restores_non_adjacent_frame():
    dictionary = topic(
        topic_id="topic-dictionary",
        canonical_topic="Concept:dict",
        label="dictionary",
        hint_level=2,
        focus_node_id="Concept:dict",
    )
    function = topic(
        topic_id="topic-function",
        canonical_topic="Concept:function",
        label="function",
        hint_level=1,
        focus_node_id="Concept:function",
    )
    list_topic = topic(
        topic_id="topic-list",
        canonical_topic="Concept:list",
        label="list",
        hint_level=3,
        focus_node_id="Concept:list",
    )

    projected = project_events(
        [
            created_event(1, dictionary),
            suspended_event(2, dictionary.topic_id),
            created_event(3, function),
            suspended_event(4, function.topic_id),
            created_event(5, list_topic),
            suspended_event(6, list_topic.topic_id),
            resumed_event(7, dictionary.topic_id, navigation="named"),
        ]
    )

    assert projected.active_topic_id == "topic-dictionary"
    assert projected.back_stack == ["topic-dictionary", "topic-function", "topic-list"]
    assert projected.topics["topic-dictionary"] == dictionary
    assert projected.topics["topic-list"].status == "suspended"


def test_greeting_does_not_mutate_topic_navigation():
    before = project_events(events_for_dictionary_then_function_then_back())
    greeting_events = [
        event(sequence=6, event_type="user_message_received", payload={"message": "hello"}),
        event(
            sequence=7,
            event_type="turn_resolved",
            payload={"conversation_relation": "greeting"},
        ),
        event(sequence=8, event_type="assistant_response_committed", payload={}),
    ]

    after = apply_events(before, greeting_events)

    assert after.active_topic_id == before.active_topic_id
    assert after.back_stack == before.back_stack
    assert after.topics == before.topics
    assert after.last_sequence == 8


def test_sequence_gap_is_rejected():
    with pytest.raises(ConversationSequenceError) as exc_info:
        project_events([event(sequence=1), event(sequence=3)])

    assert exc_info.value.expected == 2
    assert exc_info.value.actual == 3


def test_full_replay_matches_incremental_apply():
    events = events_for_dictionary_then_function_then_back()
    full = project_events(events)
    initial = project_events(events[:3])
    incremental = apply_events(initial, events[3:])

    assert _stable_json(full) == _stable_json(incremental)


def test_event_and_projection_containers_are_deeply_immutable():
    source_payload = {"nested": {"values": ["original"]}}
    received = event(sequence=1, payload=source_payload)
    dictionary = topic(
        topic_id="topic-dictionary",
        canonical_topic="Concept:dict",
        label="dictionary",
        focus_node_id="Concept:dict",
    )
    projected = project_events([created_event(1, dictionary)])

    source_payload["nested"]["values"].append("changed-outside")
    assert received.payload["nested"]["values"] == ["original"]

    forbidden_mutations = [
        lambda: received.payload.__setitem__("new", "value"),
        lambda: received.payload["nested"].__setitem__("new", "value"),
        lambda: received.payload["nested"]["values"].append("changed-inside"),
        lambda: projected.back_stack.append("topic-other"),
        lambda: projected.topics.__setitem__("topic-other", dictionary),
        lambda: projected.topics["topic-dictionary"].aliases.append("mapping"),
        lambda: projected.topics["topic-dictionary"].turn_ids.append("turn-new"),
        lambda: projected.topics["topic-dictionary"].last_kg_path.append("Concept:key"),
        lambda: projected.topics["topic-dictionary"].last_rag_chunk_ids.append("chunk-new"),
    ]
    for mutate in forbidden_mutations:
        with pytest.raises(TypeError, match="immutable"):
            mutate()

    assert received.model_dump_json() == (
        '{"schema_version":1,"event_id":"event-1","session_id":"session-replay",'
        '"client_turn_id":"turn-replay","ordinal":1,"sequence":1,'
        '"event_type":"user_message_received","payload":{"nested":{"values":["original"]}},'
        '"created_at":"2026-07-20T10:00:00+08:00"}'
    )
    assert '"back_stack":[]' in projected.model_dump_json()


def test_topic_created_requires_prior_active_frame_to_be_suspended():
    dictionary = topic(
        topic_id="topic-dictionary",
        canonical_topic="Concept:dict",
        label="dictionary",
    )
    function = topic(
        topic_id="topic-function",
        canonical_topic="Concept:function",
        label="function",
    )

    with pytest.raises(ConversationProjectionEventError, match="must be suspended"):
        project_events([created_event(1, dictionary), created_event(2, function)])


def test_mutable_builtin_base_methods_cannot_bypass_container_immutability():
    received = event(
        sequence=1,
        payload={"nested": {"values": ["original"]}},
    )
    dictionary = topic(
        topic_id="topic-dictionary",
        canonical_topic="Concept:dict",
        label="dictionary",
    )
    projected = project_events([created_event(1, dictionary)])

    with pytest.raises(TypeError):
        list.append(received.payload["nested"]["values"], "bypassed")
    with pytest.raises(TypeError):
        dict.__setitem__(received.payload["nested"], "bypassed", True)
    with pytest.raises(TypeError):
        list.append(projected.back_stack, "topic-bypassed")
    with pytest.raises(TypeError):
        dict.__setitem__(projected.topics, "topic-bypassed", dictionary)

    assert received.payload == {"nested": {"values": ["original"]}}
    assert projected.back_stack == []
    assert list(projected.topics) == ["topic-dictionary"]


def test_model_copy_updates_are_revalidated_and_recursively_frozen():
    received = event(sequence=1, payload={"nested": {"values": ["original"]}})
    copied_event = received.model_copy(
        update={"payload": {"nested": {"values": ["copied"]}}}
    )
    dictionary = topic(
        topic_id="topic-dictionary",
        canonical_topic="Concept:dict",
        label="dictionary",
    )
    copied_topic = dictionary.model_copy(
        update={
            "aliases": ["dict", "dictionary"],
            "last_kg_path": ["Concept:dict", "Concept:key"],
        }
    )
    copied_projection = ConversationProjection.empty().model_copy(
        update={
            "active_topic_id": dictionary.topic_id,
            "back_stack": ["topic-list"],
            "topics": {dictionary.topic_id: dictionary},
        }
    )

    forbidden_mutations = [
        lambda: copied_event.payload["nested"]["values"].append("changed"),
        lambda: copied_topic.aliases.append("mapping"),
        lambda: copied_topic.last_kg_path.append("Concept:value"),
        lambda: copied_projection.back_stack.append("topic-function"),
        lambda: copied_projection.topics.__setitem__("topic-function", dictionary),
    ]
    for mutate in forbidden_mutations:
        with pytest.raises(TypeError, match="immutable"):
            mutate()

    assert copied_event.model_dump_json().endswith(
        '"payload":{"nested":{"values":["copied"]}},'
        '"created_at":"2026-07-20T10:00:00+08:00"}'
    )
    assert copied_topic.model_dump(mode="json")["aliases"] == ["dict", "dictionary"]
    assert copied_projection.model_dump(mode="json")["back_stack"] == ["topic-list"]
