from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from types import MappingProxyType
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class FrozenSequence(Sequence[Any]):
    """An intrinsically immutable sequence with list-compatible equality."""

    __slots__ = ("_values",)

    def __init__(self, values: Sequence[Any] | Iterator[Any] = ()) -> None:
        object.__setattr__(self, "_values", tuple(values))

    def __setattr__(self, _name: str, _value: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def __getitem__(self, index: int | slice) -> Any:
        return self._values[index]

    def __iter__(self) -> Iterator[Any]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __repr__(self) -> str:
        return repr(list(self._values))

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Sequence) and not isinstance(other, (str, bytes, bytearray)):
            return tuple(self._values) == tuple(other)
        return False

    def __setitem__(self, _index: int | slice, _value: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def __delitem__(self, _index: int | slice) -> None:
        raise TypeError("conversation event state is immutable")

    def append(self, _value: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def clear(self) -> None:
        raise TypeError("conversation event state is immutable")

    def extend(self, _values: Sequence[Any]) -> None:
        raise TypeError("conversation event state is immutable")

    def insert(self, _index: int, _value: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def pop(self, _index: int = -1) -> Any:
        raise TypeError("conversation event state is immutable")

    def remove(self, _value: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def reverse(self) -> None:
        raise TypeError("conversation event state is immutable")

    def sort(self, *_args: Any, **_kwargs: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def __copy__(self) -> "FrozenSequence":
        return self

    def __deepcopy__(self, _memo: dict[int, Any]) -> "FrozenSequence":
        return self


class FrozenMapping(Mapping[str, Any]):
    """An intrinsically immutable mapping with dict-compatible equality."""

    __slots__ = ("_values",)

    def __init__(self, values: Mapping[str, Any] | None = None) -> None:
        object.__setattr__(self, "_values", MappingProxyType(dict(values or {})))

    def __setattr__(self, _name: str, _value: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def __getitem__(self, key: str) -> Any:
        return self._values[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __repr__(self) -> str:
        return repr(dict(self._values))

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Mapping):
            return dict(self.items()) == dict(other.items())
        return False

    def __setitem__(self, _key: str, _value: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def __delitem__(self, _key: str) -> None:
        raise TypeError("conversation event state is immutable")

    def clear(self) -> None:
        raise TypeError("conversation event state is immutable")

    def pop(self, _key: str, _default: Any = None) -> Any:
        raise TypeError("conversation event state is immutable")

    def popitem(self) -> tuple[str, Any]:
        raise TypeError("conversation event state is immutable")

    def setdefault(self, _key: str, _default: Any = None) -> Any:
        raise TypeError("conversation event state is immutable")

    def update(self, *_args: Any, **_kwargs: Any) -> None:
        raise TypeError("conversation event state is immutable")

    def __copy__(self) -> "FrozenMapping":
        return self

    def __deepcopy__(self, _memo: dict[int, Any]) -> "FrozenMapping":
        return self


def deep_freeze(value: Any) -> Any:
    """Detach and recursively freeze JSON-shaped conversation state."""

    if isinstance(value, (FrozenMapping, FrozenSequence)):
        return value
    if isinstance(value, Mapping):
        return FrozenMapping({key: deep_freeze(item) for key, item in value.items()})
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return FrozenSequence(deep_freeze(item) for item in value)
    if isinstance(value, (set, frozenset)):
        return frozenset(deep_freeze(item) for item in value)
    return value


def deep_thaw(value: Any) -> Any:
    """Convert immutable runtime containers back to JSON-shaped containers."""

    if isinstance(value, Mapping):
        return {key: deep_thaw(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [deep_thaw(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return [deep_thaw(item) for item in value]
    return value


class DeeplyImmutableModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    def model_copy(
        self,
        *,
        update: Mapping[str, Any] | None = None,
        deep: bool = False,
    ) -> Self:
        del deep
        data = self.model_dump(round_trip=True)
        if update:
            data.update({key: deep_thaw(value) for key, value in update.items()})
        return self.__class__.model_validate(data)


ConversationEventType = Literal[
    "user_message_received",
    "kg_node_selected",
    "turn_resolved",
    "topic_created",
    "topic_suspended",
    "topic_resumed",
    "retrieval_completed",
    "pedagogy_advanced",
    "assistant_response_committed",
]

EVENT_TYPES = {
    "user_message_received",
    "kg_node_selected",
    "turn_resolved",
    "topic_created",
    "topic_suspended",
    "topic_resumed",
    "retrieval_completed",
    "pedagogy_advanced",
    "assistant_response_committed",
}


class ConversationEvent(DeeplyImmutableModel):
    """An immutable, session-ordered conversation event envelope."""

    schema_version: Literal[1] = 1
    event_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    client_turn_id: str = Field(min_length=1)
    ordinal: int = Field(ge=1)
    sequence: int = Field(ge=1)
    event_type: ConversationEventType
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(min_length=1)

    @field_validator("payload", mode="after")
    @classmethod
    def freeze_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        return deep_freeze(value)

    @field_serializer("payload")
    def serialize_payload(self, value: Mapping[str, Any]) -> dict[str, Any]:
        return deep_thaw(value)
