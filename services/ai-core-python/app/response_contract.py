from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.turn_resolution import TurnResolution


_APPLICATION_METADATA_LABELS = (
    "Selected Node:",
    "Topic Transition:",
    "Previous Context:",
    "Resumed Context:",
)


def _display_label(value: str) -> str:
    suffix = value.partition(":")[2] if ":" in value else value
    return re.sub(r"[_-]+", " ", suffix).strip()


class StructuredTeachingAnswer(BaseModel):
    """Model-owned prose without application-owned audit metadata."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    answer_body: str = Field(min_length=1)
    topic_summary_update: str | None = Field(default=None, max_length=240)

    @field_validator("answer_body")
    @classmethod
    def reject_application_metadata(cls, value: str) -> str:
        if any(label in value for label in _APPLICATION_METADATA_LABELS):
            raise ValueError("answer_body contains application-owned metadata")
        return value

    @field_validator("topic_summary_update")
    @classmethod
    def reject_blank_summary(cls, value: str | None) -> str | None:
        if value is not None and not value:
            raise ValueError("topic_summary_update must be non-empty when supplied")
        return value


def _selected_node_label(resolution: TurnResolution) -> str | None:
    if resolution.selected_node.usage == "absent":
        return None
    if resolution.selected_node.label:
        return _display_label(resolution.selected_node.label)
    node_id = resolution.selected_node.node_id
    if not node_id:
        return None
    return _display_label(node_id)


def _context_metadata(
    resolution: TurnResolution,
    context_summary: str | None,
) -> tuple[str | None, str | None]:
    summary = context_summary.strip() if context_summary else None
    transition = resolution.topic_transition
    if transition is None or summary is None:
        return None, None
    if transition.kind == "switch":
        return "Previous Context", summary
    return "Resumed Context", summary


def _answer_language(answer_body: str) -> str:
    return "Chinese" if re.search(r"[\u4e00-\u9fff]", answer_body) else "English"


def build_response_contract(
    *,
    answer: StructuredTeachingAnswer,
    resolution: TurnResolution,
    context_summary: str | None,
) -> dict[str, Any]:
    context_label, normalized_summary = _context_metadata(
        resolution,
        context_summary,
    )
    return {
        "selected_node_label": _selected_node_label(resolution),
        "selected_node_usage": resolution.selected_node.usage,
        "topic_transition": (
            {
                "kind": resolution.topic_transition.kind,
                "from_label": _display_label(resolution.topic_transition.from_label),
                "to_label": _display_label(resolution.topic_transition.to_label),
            }
            if resolution.topic_transition is not None
            else None
        ),
        "context_label": context_label,
        "context_summary": normalized_summary,
        "answer_language": _answer_language(answer.answer_body),
        "answer_body": answer.answer_body,
        "topic_summary_update": answer.topic_summary_update,
    }


def render_teaching_response(
    *,
    answer_body: str | StructuredTeachingAnswer,
    resolution: TurnResolution,
    context_summary: str | None,
) -> str:
    answer = (
        answer_body
        if isinstance(answer_body, StructuredTeachingAnswer)
        else StructuredTeachingAnswer(answer_body=answer_body)
    )
    contract = build_response_contract(
        answer=answer,
        resolution=resolution,
        context_summary=context_summary,
    )
    metadata: list[str] = []
    selected_label = contract["selected_node_label"]
    if selected_label is not None:
        selection_line = f"Selected Node: {selected_label}"
        if contract["selected_node_usage"] == "not_used":
            selection_line += " · Not used for this response"
        metadata.append(selection_line)

    transition = contract["topic_transition"]
    if transition is not None:
        metadata.append(
            "Topic Transition: "
            f"{transition['from_label']} → {transition['to_label']}"
        )

    context_label = contract["context_label"]
    if context_label is not None:
        metadata.append(f"{context_label}: {contract['context_summary']}")

    if not metadata:
        return answer.answer_body
    return "\n".join(metadata) + "\n\n" + answer.answer_body
