from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any, Literal

from pydantic import Field, field_serializer, field_validator

from app.conversation_events import (
    ConversationEvent,
    ConversationEventType,
    DeeplyImmutableModel,
    deep_freeze,
    deep_thaw,
)


TopicStatus = Literal["active", "suspended", "completed"]
ResumeNavigation = Literal["back", "named"]


class ConversationSequenceError(ValueError):
    def __init__(self, expected: int, actual: int) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(f"conversation event sequence must be {expected}, got {actual}")


class ConversationProjectionEventError(ValueError):
    pass


class ImmutableProjectionModel(DeeplyImmutableModel):
    pass


class TopicPedagogyState(ImmutableProjectionModel):
    workflow_state: str = ""
    active_gate_id: str | None = None
    hint_level: int = Field(default=0, ge=0)
    next_required_action: str | None = None
    confidence_before: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence_after: float | None = Field(default=None, ge=0.0, le=1.0)
    teach_back_required: bool = False


class TopicFrame(ImmutableProjectionModel):
    topic_id: str = Field(min_length=1)
    canonical_topic: str = Field(min_length=1)
    topic_label: str = Field(min_length=1)
    aliases: list[str] = Field(default_factory=list)
    status: TopicStatus = "active"
    summary: str = ""
    unresolved_question: str = ""
    turn_ids: list[str] = Field(default_factory=list)
    active_kg_focus_node_id: str | None = None
    last_kg_path: list[str] = Field(default_factory=list)
    last_rag_chunk_ids: list[str] = Field(default_factory=list)
    pedagogy_state: TopicPedagogyState = Field(default_factory=TopicPedagogyState)
    created_at: str = Field(min_length=1)
    last_active_at: str = Field(min_length=1)

    @field_validator(
        "aliases",
        "turn_ids",
        "last_kg_path",
        "last_rag_chunk_ids",
        mode="after",
    )
    @classmethod
    def freeze_sequence_fields(cls, value: list[str]) -> list[str]:
        return deep_freeze(value)

    @field_serializer(
        "aliases",
        "turn_ids",
        "last_kg_path",
        "last_rag_chunk_ids",
    )
    def serialize_sequence_fields(self, value: Sequence[str]) -> list[str]:
        return deep_thaw(value)


class ConversationProjection(ImmutableProjectionModel):
    schema_version: Literal[1] = 1
    last_sequence: int = Field(default=0, ge=0)
    active_topic_id: str | None = None
    back_stack: list[str] = Field(default_factory=list)
    topics: dict[str, TopicFrame] = Field(default_factory=dict)

    @classmethod
    def empty(cls) -> "ConversationProjection":
        return cls()

    @field_validator("back_stack", mode="after")
    @classmethod
    def freeze_back_stack(cls, value: list[str]) -> list[str]:
        return deep_freeze(value)

    @field_validator("topics", mode="after")
    @classmethod
    def freeze_topics(cls, value: dict[str, TopicFrame]) -> dict[str, TopicFrame]:
        return deep_freeze(value)

    @field_serializer("back_stack")
    def serialize_back_stack(self, value: Sequence[str]) -> list[str]:
        return deep_thaw(value)

    @field_serializer("topics")
    def serialize_topics(self, value: Mapping[str, TopicFrame]) -> dict[str, TopicFrame]:
        return dict(value.items())


Reducer = Callable[[ConversationProjection, ConversationEvent], ConversationProjection]


def _finish(
    projection: ConversationProjection,
    event: ConversationEvent,
    **updates: Any,
) -> ConversationProjection:
    projection_data = projection.model_dump()
    projection_data.update({"last_sequence": event.sequence, **updates})
    return ConversationProjection.model_validate(projection_data)


def _require_topic(projection: ConversationProjection, topic_id: str) -> TopicFrame:
    try:
        return projection.topics[topic_id]
    except KeyError as exc:
        raise ConversationProjectionEventError(f"unknown topic frame: {topic_id}") from exc


def _topic_id(event: ConversationEvent) -> str:
    topic_id = event.payload.get("topic_id")
    if not isinstance(topic_id, str) or not topic_id.strip():
        raise ConversationProjectionEventError(
            f"{event.event_type} requires a non-empty payload.topic_id"
        )
    return topic_id


def _no_navigation_change(
    projection: ConversationProjection,
    event: ConversationEvent,
) -> ConversationProjection:
    return _finish(projection, event)


def _topic_created(
    projection: ConversationProjection,
    event: ConversationEvent,
) -> ConversationProjection:
    topic_data = event.payload.get("topic")
    if not isinstance(topic_data, Mapping):
        raise ConversationProjectionEventError("topic_created requires payload.topic")
    topic = TopicFrame.model_validate(topic_data)
    if topic.topic_id in projection.topics:
        raise ConversationProjectionEventError(f"topic frame already exists: {topic.topic_id}")

    previous_id = projection.active_topic_id
    back_stack = list(projection.back_stack)
    if previous_id is not None and previous_id != topic.topic_id:
        previous = _require_topic(projection, previous_id)
        if previous.status != "suspended":
            raise ConversationProjectionEventError(
                f"active topic frame {previous_id} must be suspended before topic_created"
            )
        back_stack.append(previous_id)

    topics = dict(projection.topics)
    topics[topic.topic_id] = topic.model_copy(update={"status": "active"}, deep=True)
    return _finish(
        projection,
        event,
        active_topic_id=topic.topic_id,
        back_stack=back_stack,
        topics=topics,
    )


def _topic_suspended(
    projection: ConversationProjection,
    event: ConversationEvent,
) -> ConversationProjection:
    topic_id = _topic_id(event)
    topic = _require_topic(projection, topic_id)
    allowed_updates = {
        key: event.payload[key]
        for key in ("summary", "unresolved_question", "last_active_at")
        if key in event.payload
    }
    updated_topic = topic.model_copy(
        update={"status": "suspended", **allowed_updates},
        deep=True,
    )
    topics = dict(projection.topics)
    topics[topic_id] = TopicFrame.model_validate(updated_topic.model_dump())
    return _finish(projection, event, topics=topics)


def _back_stack_after_pop(
    projection: ConversationProjection,
    target_topic_id: str,
) -> list[str]:
    stack = list(projection.back_stack)
    while stack:
        candidate = stack.pop()
        if candidate not in projection.topics or candidate == projection.active_topic_id:
            continue
        if candidate != target_topic_id:
            raise ConversationProjectionEventError(
                f"back target {target_topic_id} does not match stack target {candidate}"
            )
        return stack
    raise ConversationProjectionEventError("back requested with no previous topic frame")


def _topic_resumed(
    projection: ConversationProjection,
    event: ConversationEvent,
) -> ConversationProjection:
    topic_id = _topic_id(event)
    target = _require_topic(projection, topic_id)
    navigation = event.payload.get("navigation")
    if navigation not in ("back", "named"):
        raise ConversationProjectionEventError(
            "topic_resumed requires payload.navigation to be 'back' or 'named'"
        )

    previous_id = projection.active_topic_id
    if navigation == "back":
        back_stack = _back_stack_after_pop(projection, topic_id)
    else:
        back_stack = list(projection.back_stack)
        if previous_id is not None and previous_id != topic_id:
            _require_topic(projection, previous_id)
            back_stack.append(previous_id)

    topics = dict(projection.topics)
    if previous_id is not None and previous_id != topic_id:
        previous = _require_topic(projection, previous_id)
        topics[previous_id] = previous.model_copy(update={"status": "suspended"}, deep=True)

    target_updates: dict[str, Any] = {"status": "active"}
    if "last_active_at" in event.payload:
        target_updates["last_active_at"] = event.payload["last_active_at"]
    topics[topic_id] = TopicFrame.model_validate(
        target.model_copy(update=target_updates, deep=True).model_dump()
    )
    return _finish(
        projection,
        event,
        active_topic_id=topic_id,
        back_stack=back_stack,
        topics=topics,
    )


def _retrieval_completed(
    projection: ConversationProjection,
    event: ConversationEvent,
) -> ConversationProjection:
    topic_id = event.payload.get("topic_id")
    if topic_id is None:
        return _finish(projection, event)
    if not isinstance(topic_id, str):
        raise ConversationProjectionEventError("retrieval_completed payload.topic_id must be text")
    topic = _require_topic(projection, topic_id)
    updates = {
        key: event.payload[key]
        for key in ("last_kg_path", "last_rag_chunk_ids", "active_kg_focus_node_id")
        if key in event.payload
    }
    topics = dict(projection.topics)
    topics[topic_id] = TopicFrame.model_validate(
        topic.model_copy(update=updates, deep=True).model_dump()
    )
    return _finish(projection, event, topics=topics)


def _pedagogy_advanced(
    projection: ConversationProjection,
    event: ConversationEvent,
) -> ConversationProjection:
    topic_id = _topic_id(event)
    topic = _require_topic(projection, topic_id)
    pedagogy_data = event.payload.get("pedagogy_state")
    if not isinstance(pedagogy_data, Mapping):
        raise ConversationProjectionEventError(
            "pedagogy_advanced requires payload.pedagogy_state"
        )
    pedagogy = TopicPedagogyState.model_validate(pedagogy_data)
    topics = dict(projection.topics)
    topics[topic_id] = topic.model_copy(update={"pedagogy_state": pedagogy}, deep=True)
    return _finish(projection, event, topics=topics)


def _assistant_response_committed(
    projection: ConversationProjection,
    event: ConversationEvent,
) -> ConversationProjection:
    topic_id = event.payload.get("topic_id")
    if topic_id is None:
        return _finish(projection, event)
    if not isinstance(topic_id, str):
        raise ConversationProjectionEventError(
            "assistant_response_committed payload.topic_id must be text"
        )
    topic = _require_topic(projection, topic_id)
    updates: dict[str, Any] = {
        key: event.payload[key]
        for key in ("summary", "unresolved_question", "last_active_at")
        if key in event.payload
    }
    turn_id = event.payload.get("turn_id")
    if turn_id is not None:
        if not isinstance(turn_id, str) or not turn_id.strip():
            raise ConversationProjectionEventError(
                "assistant_response_committed payload.turn_id must be non-empty text"
            )
        updates["turn_ids"] = [*topic.turn_ids, turn_id]
    topics = dict(projection.topics)
    topics[topic_id] = TopicFrame.model_validate(
        topic.model_copy(update=updates, deep=True).model_dump()
    )
    return _finish(projection, event, topics=topics)


REDUCERS: dict[ConversationEventType, Reducer] = {
    "user_message_received": _no_navigation_change,
    "kg_node_selected": _no_navigation_change,
    "turn_resolved": _no_navigation_change,
    "topic_created": _topic_created,
    "topic_suspended": _topic_suspended,
    "topic_resumed": _topic_resumed,
    "retrieval_completed": _retrieval_completed,
    "pedagogy_advanced": _pedagogy_advanced,
    "assistant_response_committed": _assistant_response_committed,
}


def project_events(events: list[ConversationEvent]) -> ConversationProjection:
    state = ConversationProjection.empty()
    for expected, event in enumerate(events, start=1):
        if event.sequence != expected:
            raise ConversationSequenceError(expected, event.sequence)
        state = REDUCERS[event.event_type](state, event)
    return state


def apply_events(
    projection: ConversationProjection,
    events: list[ConversationEvent],
) -> ConversationProjection:
    state = projection.model_copy(deep=True)
    for offset, event in enumerate(events, start=1):
        expected = projection.last_sequence + offset
        if event.sequence != expected:
            raise ConversationSequenceError(expected, event.sequence)
        state = REDUCERS[event.event_type](state, event)
    return state
