from __future__ import annotations

import json

import pytest

from app.conversation_projection import ConversationProjection, TopicFrame, TopicPedagogyState
from app.turn_resolution import _explicit_topics, resolve_turn


class FakeProvider:
    provider = "fake"
    model = "fake-resolution"

    def __init__(self, content: str | Exception) -> None:
        self.content = content
        self.calls = 0
        self.messages: list[dict[str, str]] = []

    def chat(self, messages, temperature=None, max_tokens=None):
        self.calls += 1
        self.messages = messages
        if isinstance(self.content, Exception):
            raise self.content
        return self.content


def _topic(
    topic_id: str,
    canonical_topic: str,
    label: str,
    *,
    status: str = "suspended",
    aliases: list[str] | None = None,
    unresolved_question: str = "",
    last_active_at: str = "2026-07-20T00:00:00Z",
) -> TopicFrame:
    return TopicFrame(
        topic_id=topic_id,
        canonical_topic=canonical_topic,
        topic_label=label,
        aliases=aliases or [],
        status=status,
        summary=f"Stored summary for {label}.",
        unresolved_question=unresolved_question,
        turn_ids=[f"turn-{label}"],
        active_kg_focus_node_id=canonical_topic,
        last_kg_path=[canonical_topic],
        last_rag_chunk_ids=[f"chunk-{label}"],
        pedagogy_state=TopicPedagogyState(
            workflow_state="hint_level_1",
            active_gate_id="student-learning/progressive-hint-ladder",
            hint_level=1,
            next_required_action="apply_hint",
        ),
        created_at="2026-07-20T00:00:00Z",
        last_active_at=last_active_at,
    )


def _projection(
    active: str | None = "dictionary",
    *,
    include: tuple[str, ...] = ("list", "dictionary", "function"),
    back_stack: tuple[str, ...] = ("topic-list",),
    unresolved_question: str | None = None,
) -> ConversationProjection:
    definitions = {
        "list": ("Concept:list", ["列表"]),
        "dictionary": ("Concept:dict", ["dict", "字典"]),
        "function": ("Concept:function", ["函数"]),
        "tuple": ("Concept:tuple", ["元组"]),
    }
    topics = {}
    for label in include:
        canonical, aliases = definitions[label]
        topics[f"topic-{label}"] = _topic(
            f"topic-{label}",
            canonical,
            label,
            status="active" if label == active else "suspended",
            aliases=aliases,
            unresolved_question=(
                unresolved_question
                if label == active and unresolved_question is not None
                else "怎么访问一个不存在的键？" if label == "dictionary" else ""
            ),
        )
    return ConversationProjection(
        last_sequence=12,
        active_topic_id=f"topic-{active}" if active else None,
        back_stack=list(back_stack) if active else [],
        topics=topics,
    )


@pytest.mark.parametrize(
    (
        "case",
        "message",
        "projection",
        "selection",
        "relation",
        "active_after",
        "usage",
        "action",
        "query_terms",
        "forbidden_query_terms",
    ),
    [
        (
            "explicit-current",
            "dictionary 怎么添加键值对？",
            _projection(),
            None,
            "continue",
            "topic-dictionary",
            "absent",
            "continue",
            ("dictionary", "键值对"),
            ("Stored summary", "chunk-dictionary"),
        ),
        (
            "referential-current",
            "这是啥意思？",
            _projection(),
            None,
            "clarify_current",
            "topic-dictionary",
            "absent",
            "continue",
            ("dictionary", "不存在的键"),
            ("Stored summary", "turn-dictionary"),
        ),
        (
            "selected-compatible",
            "len 对字符串返回什么？",
            _projection(active=None, include=(), back_stack=()),
            "Concept:len",
            "start",
            None,
            "used",
            "initialize",
            ("len", "字符串"),
            (),
        ),
        (
            "selected-referential",
            "这是啥意思？",
            _projection(),
            "Concept:len",
            "kg_explore",
            None,
            "used",
            "initialize",
            ("len",),
            ("怎么访问一个不存在的键", "Stored summary"),
        ),
        (
            "selected-conflicting",
            "dictionary 怎么添加键值对？",
            _projection(),
            None,
            "continue",
            "topic-dictionary",
            "absent",
            "continue",
            ("dictionary", "键值对"),
            ("Stored summary",),
        ),
        (
            "back",
            "back",
            _projection(),
            None,
            "resume_previous",
            "topic-list",
            "absent",
            "restore",
            ("list",),
            ("dictionary", "Stored summary"),
        ),
        (
            "named-resume",
            "回到之前讲 list 的地方",
            _projection(active="function", back_stack=("topic-list", "topic-dictionary")),
            None,
            "resume_named",
            "topic-list",
            "absent",
            "restore",
            ("list",),
            ("function", "Stored summary"),
        ),
        (
            "greeting",
            "你好",
            _projection(),
            None,
            "greeting",
            "topic-dictionary",
            "absent",
            "preserve_without_advance",
            (),
            ("dictionary", "Stored summary"),
        ),
        (
            "off-topic",
            "今天天气怎么样？",
            _projection(),
            None,
            "off_topic",
            "topic-dictionary",
            "absent",
            "preserve_without_advance",
            (),
            ("dictionary", "Stored summary"),
        ),
    ],
)
def test_deterministic_arbitration_matrix(
    case,
    message,
    projection,
    selection,
    relation,
    active_after,
    usage,
    action,
    query_terms,
    forbidden_query_terms,
):
    result = resolve_turn(
        message,
        projection=projection,
        requested_focus_node_id=selection,
        recent_messages=[
            {"event_id": "event-student-1", "role": "student", "content": "RAW OLD STUDENT TEXT"},
            {"event_id": "event-agent-1", "role": "agent", "content": "RAW OLD AGENT TEXT"},
        ],
        allow_llm=False,
    )

    assert result.original_message == message, case
    assert result.conversation_relation == relation, case
    if active_after is None:
        assert result.active_topic_after is not None, case
        assert result.active_topic_after.startswith("topic-"), case
        assert result.active_topic_after not in projection.topics, case
    else:
        assert result.active_topic_after == active_after, case
    assert result.selected_node.usage == usage, case
    assert result.workflow_action == action, case
    assert result.context_source_event_ids == ["event-student-1", "event-agent-1"], case
    assert all(term.lower() in result.retrieval_query.lower() for term in query_terms), case
    assert all(term.lower() not in result.retrieval_query.lower() for term in forbidden_query_terms), case
    assert "RAW OLD" not in result.retrieval_query, case


def test_back_with_empty_stack_is_unresolved_without_transition():
    result = resolve_turn(
        "back",
        projection=_projection(active="dictionary", back_stack=()),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "unresolved"
    assert result.active_topic_after == "topic-dictionary"
    assert result.workflow_action == "preserve_without_advance"
    assert result.topic_transition is None
    assert result.ambiguity_reason == "no_previous_topic"
    assert result.retrieval_query == ""


def test_d09_back_without_any_topic_preserves_empty_projection():
    result = resolve_turn(
        "back",
        projection=_projection(active=None, include=(), back_stack=()),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "unresolved"
    assert result.resolved_question == "No previous topic exists."
    assert result.active_topic_before is None
    assert result.active_topic_after is None
    assert result.target_topic_id is None
    assert result.workflow_action == "preserve_without_advance"
    assert result.topic_transition is None
    assert result.retrieval_query == ""


def test_allow_llm_false_does_not_construct_or_call_provider(monkeypatch):
    def forbidden_provider():
        raise AssertionError("provider must not be constructed")

    monkeypatch.setattr("app.turn_resolution.get_resolution_provider", forbidden_provider)
    result = resolve_turn(
        "dictionary 是什么？",
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "continue"


@pytest.mark.parametrize(
    ("provider_content", "case"),
    [
        ("not json", "provider_invalid_json"),
        (json.dumps({"resolution_confidence": 0.79}), "provider_low_confidence"),
        (RuntimeError("offline"), "provider_unavailable"),
    ],
)
def test_invalid_or_unavailable_provider_falls_back_deterministically(provider_content, case):
    provider = FakeProvider(provider_content)

    result = resolve_turn(
        "再举一个例子",
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[
            {"event_id": "event-1", "role": "student", "content": "dictionary 是什么？"},
        ],
        provider=provider,
        allow_llm=True,
    )

    assert provider.calls == 1
    assert result.conversation_relation == "continue"
    assert result.active_topic_after == "topic-dictionary"
    assert result.workflow_action == "continue"
    assert case in {
        "provider_invalid_json",
        "provider_low_confidence",
        "provider_unavailable",
    }
    assert "dictionary" in result.retrieval_query.lower()
    assert "dictionary 是什么" not in result.retrieval_query
    assert "event-1" in provider.messages[1]["content"]
    assert "dictionary 是什么？" in provider.messages[1]["content"]


def test_valid_provider_is_called_once_and_cannot_override_explicit_focus():
    provider = FakeProvider("{}")
    deterministic = resolve_turn(
        "dictionary 的 key 怎么取？",
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )
    provider.content = json.dumps(deterministic.model_dump())

    result = resolve_turn(
        "dictionary 的 key 怎么取？",
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        provider=provider,
        allow_llm=True,
    )

    assert provider.calls == 1
    assert result.conversation_relation == "kg_explore"
    assert result.selected_node.usage == "used"
    assert result.active_topic_after is not None
    assert result.active_topic_after != "topic-dictionary"
    assert "len" in result.retrieval_query.lower()


def test_d06_target_clause_switches_from_dictionary_to_function():
    result = resolve_turn(
        "先不说 dictionary，讲讲 function",
        projection=_projection(include=("list", "dictionary")),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "switch_topic"
    assert result.active_topic_before == "topic-dictionary"
    assert result.active_topic_after is not None
    assert result.active_topic_after != "topic-dictionary"
    assert result.topic_transition is not None
    assert result.topic_transition.from_label == "dictionary"
    assert result.topic_transition.to_label == "function"
    assert result.workflow_action == "initialize"
    assert "dictionary" in result.retrieval_query
    assert "function" in result.retrieval_query


def test_d11_explicit_correction_chooses_tuple_not_negated_list():
    result = resolve_turn(
        "我说的“它”是 tuple，不是 list",
        projection=_projection(active="list"),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "switch_topic"
    assert result.topic_transition is not None
    assert result.topic_transition.from_label == "list"
    assert result.topic_transition.to_label == "tuple"
    assert result.retrieval_query == "Python tuple"


@pytest.mark.parametrize(
    "message",
    [
        "I mean tuple, not list",
        "tuple, not list",
        "我说的是 tuple，不是 list",
    ],
)
def test_correction_uses_positive_subject_before_negated_old_subject(message):
    result = resolve_turn(
        message,
        projection=_projection(active="list"),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "switch_topic"
    assert result.topic_transition is not None
    assert result.topic_transition.from_label == "list"
    assert result.topic_transition.to_label == "tuple"
    assert result.retrieval_query == "Python tuple"


def test_explicit_python_subject_wins_before_off_topic_keyword_detection():
    result = resolve_turn(
        "天气数据怎么用 Python list 保存？",
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_intent == "concept_question"
    assert result.conversation_relation == "switch_topic"
    assert result.topic_transition is not None
    assert result.topic_transition.to_label == "list"
    assert "天气数据" in result.retrieval_query
    assert "list" in result.retrieval_query


@pytest.mark.parametrize("message", ["能解释一下吗？", "怎么用？", "Could you explain it?"])
def test_broad_ellipses_use_selected_node_before_active_context(message):
    result = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "kg_explore"
    assert result.selected_node.usage == "used"
    assert result.active_topic_after != "topic-dictionary"
    assert "len" in result.resolved_question.lower()
    assert "len" in result.retrieval_query.lower()
    assert "不存在的键" not in result.retrieval_query


def test_new_topic_id_is_stable_and_has_uuid_v4_format():
    kwargs = {
        "message": "这是啥意思？",
        "projection": _projection(),
        "requested_focus_node_id": "Concept:len",
        "recent_messages": [{"event_id": "event-1", "role": "student", "content": "old"}],
        "allow_llm": False,
    }

    first = resolve_turn(**kwargs)
    second = resolve_turn(**kwargs)

    assert first.active_topic_after == second.active_topic_after
    assert first.active_topic_after is not None
    topic_uuid = first.active_topic_after.removeprefix("topic-")
    parsed = __import__("uuid").UUID(topic_uuid)
    assert parsed.version == 4
    assert str(parsed) == topic_uuid


@pytest.mark.parametrize(
    ("field", "poison"),
    [
        ("original_message", "poisoned original"),
        ("resolved_question", "Python len usage"),
        ("resolved_intent", "syntax_question"),
        ("conversation_relation", "off_topic"),
        ("active_topic_before", "topic-poison-before"),
        ("active_topic_after", "topic-poison-after"),
        ("target_topic_id", "topic-poison-target"),
        (
            "selected_node",
            {
                "node_id": "Concept:len",
                "label": "len",
                "usage": "used",
                "reason": "poisoned_reason",
            },
        ),
        (
            "topic_transition",
            {"kind": "switch", "from_label": "dictionary", "to_label": "len"},
        ),
        ("workflow_action", "preserve_without_advance"),
        ("retrieval_query", "Python len usage"),
        ("context_source_event_ids", ["poison-event"]),
        ("ambiguity_reason", "poisoned"),
    ],
)
def test_provider_cannot_change_any_authoritative_resolution_field(field, poison):
    deterministic = resolve_turn(
        "dictionary 的 key 怎么取？",
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[{"event_id": "event-1", "role": "student", "content": "old"}],
        allow_llm=False,
    )
    payload = deterministic.model_dump()
    payload[field] = poison
    provider = FakeProvider(json.dumps(payload))

    result = resolve_turn(
        "dictionary 的 key 怎么取？",
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[{"event_id": "event-1", "role": "student", "content": "old"}],
        provider=provider,
        allow_llm=True,
    )

    assert provider.calls == 1
    assert result == deterministic
    assert "len" in result.retrieval_query.lower()


def test_named_resume_zero_matches_clarifies_without_navigation():
    result = resolve_turn(
        "回到 generator 的地方",
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "unresolved"
    assert result.active_topic_after == "topic-dictionary"
    assert result.topic_transition is None
    assert result.ambiguity_reason == "named_topic_not_found"


def test_named_resume_uses_explicit_concept_from_topic_linked_recorded_message():
    result = resolve_turn(
        "回到 generator 的地方",
        projection=_projection(active="dictionary", include=("list", "dictionary")),
        requested_focus_node_id=None,
        recent_messages=[
            {
                "event_id": "event-list-generator",
                "topic_id": "topic-list",
                "role": "student",
                "content": "list generator 怎么工作？",
            }
        ],
        allow_llm=False,
    )

    assert result.conversation_relation == "resume_named"
    assert result.active_topic_after == "topic-list"
    assert result.workflow_action == "restore"


def test_named_resume_same_canonical_duplicates_choose_most_recent_frame():
    old = _topic(
        "topic-list-old",
        "Concept:list",
        "list",
        aliases=["列表"],
        last_active_at="2026-07-18T00:00:00Z",
    )
    recent = _topic(
        "topic-list-recent",
        "Concept:list",
        "list",
        aliases=["列表"],
        last_active_at="2026-07-19T00:00:00Z",
    )
    dictionary = _topic(
        "topic-dictionary",
        "Concept:dict",
        "dictionary",
        status="active",
        aliases=["dict", "字典"],
    )
    projection = ConversationProjection(
        last_sequence=3,
        active_topic_id="topic-dictionary",
        back_stack=["topic-list-old", "topic-list-recent"],
        topics={frame.topic_id: frame for frame in (old, recent, dictionary)},
    )

    result = resolve_turn(
        "回到 list 的地方",
        projection=projection,
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "resume_named"
    assert result.active_topic_after == "topic-list-recent"


def test_named_resume_ambiguous_only_across_canonical_topics_and_lists_labels():
    projection = _projection(active="dictionary", include=("list", "dictionary", "tuple"))
    recent_messages = [
        {
            "event_id": "event-list-sequence",
            "topic_id": "topic-list",
            "role": "student",
            "content": "sequence 的 list 用法",
        },
        {
            "event_id": "event-tuple-sequence",
            "topic_id": "topic-tuple",
            "role": "student",
            "content": "sequence 的 tuple 用法",
        },
    ]

    result = resolve_turn(
        "回到 sequence 的地方",
        projection=projection,
        requested_focus_node_id=None,
        recent_messages=recent_messages,
        allow_llm=False,
    )

    assert result.conversation_relation == "unresolved"
    assert result.ambiguity_reason == "named_topic_ambiguous"
    assert "list" in result.resolved_question
    assert "tuple" in result.resolved_question


def test_multi_concept_comparison_keeps_the_explicit_focus_authoritative():
    result = resolve_turn(
        "dictionary 和 len 有什么区别？",
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "kg_explore"
    assert result.active_topic_after is not None
    assert result.active_topic_after != "topic-dictionary"
    assert result.selected_node.usage == "used"
    assert "dictionary" in result.retrieval_query
    assert "len" in result.retrieval_query


def test_arbitrary_selected_kg_label_explicitly_present_is_used():
    result = resolve_turn(
        "append 怎么用？",
        projection=_projection(active="list"),
        requested_focus_node_id="Concept:append",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.selected_node.node_id == "Concept:append"
    assert result.selected_node.label == "append"
    assert result.selected_node.usage == "used"
    assert result.selected_node.reason == "requested_focus_node_is_authoritative"
    assert result.conversation_relation in {"continue", "switch_topic", "kg_explore"}
    assert "append" in result.resolved_question.lower()
    assert "append" in result.retrieval_query.lower()


@pytest.mark.parametrize(
    "message",
    ["给我讲个笑话", "Tell me a joke", "帮我写首诗", "随便聊聊"],
)
def test_non_python_request_with_active_topic_is_off_topic(message):
    result = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_intent == "off_topic"
    assert result.conversation_relation == "off_topic"
    assert result.active_topic_after == "topic-dictionary"
    assert result.workflow_action == "preserve_without_advance"
    assert result.retrieval_query == ""


def test_provider_cannot_turn_non_python_request_into_context_continuation():
    deterministic = resolve_turn(
        "给我讲个笑话",
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )
    payload = deterministic.model_dump()
    payload.update(
        {
            "resolved_intent": "concept_question",
            "conversation_relation": "continue",
            "workflow_action": "continue",
            "retrieval_query": "Python dictionary joke",
        }
    )
    provider = FakeProvider(json.dumps(payload))

    result = resolve_turn(
        "给我讲个笑话",
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        provider=provider,
        allow_llm=True,
    )

    assert provider.calls == 1
    assert result == deterministic
    assert result.retrieval_query == ""


@pytest.mark.parametrize("message", ["再举个例子", "为什么会这样？", "这有啥用？", "怎么用？"])
def test_subjectless_contextual_followups_continue_active_topic(message):
    result = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation in {"continue", "clarify_current"}
    assert result.resolved_intent == "concept_question"
    assert result.active_topic_after == "topic-dictionary"
    assert result.workflow_action == "continue"
    assert "dictionary" in result.retrieval_query.lower()


@pytest.mark.parametrize(
    "message",
    [
        "有什么例子？",
        "还有其他方法吗？",
        "能详细一点吗？",
        "那它的复杂度呢？",
        "你能换个例子吗？",
        "Could you give another example?",
        "What other approaches are there?",
    ],
)
def test_subjectless_question_grammar_uses_active_context_without_whitelist(message):
    result = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation in {"continue", "clarify_current"}
    assert result.resolved_intent == "concept_question"
    assert result.active_topic_after == "topic-dictionary"
    assert result.workflow_action == "continue"
    assert "dictionary" in result.retrieval_query.lower()


@pytest.mark.parametrize(
    ("message", "label"),
    [
        ("Python enumerate 怎么用？", "enumerate"),
        ("`zip` 是什么？", "zip"),
        ("sorted() 怎么用？", "sorted"),
        ("filter 方法是什么？", "filter"),
        ("map 函数怎么用？", "map"),
    ],
)
def test_syntactically_signaled_arbitrary_python_identifier_is_explicit_topic(message, label):
    result = resolve_turn(
        message,
        projection=_projection(active="list"),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "switch_topic"
    assert result.active_topic_after != "topic-list"
    assert result.target_topic_id == result.active_topic_after
    assert result.topic_transition is not None
    assert result.topic_transition.from_label == "list"
    assert result.topic_transition.to_label == label
    assert result.workflow_action == "initialize"
    assert label in result.resolved_question.lower()
    assert label in result.retrieval_query.lower()
    assert result.retrieval_query != ""


@pytest.mark.parametrize(
    "message",
    ["先不说 len，讲 function", "不要讲 len，讲 function"],
)
def test_negated_selected_node_remains_authoritative_until_removed(message):
    result = resolve_turn(
        message,
        projection=_projection(include=("list", "dictionary")),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.selected_node.usage == "used"
    assert result.selected_node.reason == "requested_focus_node_is_authoritative"
    assert result.conversation_relation == "kg_explore"
    assert result.topic_transition is not None
    assert result.topic_transition.to_label == "len"
    assert "len" in result.retrieval_query.lower()


@pytest.mark.parametrize(
    "message",
    ["len 怎么用？", "dictionary 和 len 有什么区别？"],
)
def test_positive_or_comparison_selected_node_mention_remains_used(message):
    result = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.selected_node.usage == "used"


@pytest.mark.parametrize(
    "message",
    [
        "这个节点是什么意思？",
        "这个节点是什么？",
        "这个节点怎么用？",
        "能解释一下这个节点吗？",
        "What's this?",
        "What’s this?",
    ],
)
def test_selected_node_deictic_phrases_use_current_selection(message):
    result = resolve_turn(
        message,
        projection=ConversationProjection.empty(),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.selected_node.node_id == "Concept:len"
    assert result.selected_node.usage == "used"
    assert result.selected_node.reason == "requested_focus_node_is_authoritative"
    assert result.resolved_intent == "concept_question"
    assert "len" in result.retrieval_query.lower()
    assert result.retrieval_query.lower().startswith("python len")


@pytest.mark.parametrize(
    "message",
    [
        "dictionary 的 key 怎么取？",
        "Let's just chat for a moment",
        "hello",
        "1",
        "anything at all",
    ],
)
def test_requested_focus_node_is_always_authoritative_for_the_next_turn(message):
    result = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.selected_node.node_id == "Concept:len"
    assert result.selected_node.usage == "used"
    assert result.selected_node.reason == "requested_focus_node_is_authoritative"
    assert result.resolved_question


@pytest.mark.parametrize(
    ("node_id", "message", "label"),
    [
        ("Concept:set", "what's this concept is about?", "set"),
        ("Concept:key", "why is it important?", "key"),
        ("Concept:len", "Let's just chat for a moment", "len"),
        ("Concept:set", "back", "set"),
    ],
)
def test_requested_focus_always_starts_or_continues_its_python_topic(
    node_id,
    message,
    label,
):
    result = resolve_turn(
        message,
        projection=ConversationProjection.empty(),
        requested_focus_node_id=node_id,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.selected_node.node_id == node_id
    assert result.selected_node.usage == "used"
    assert result.workflow_action in {"initialize", "restore", "continue"}
    assert label in result.resolved_question.lower()
    assert label in result.retrieval_query.lower()
    assert result.resolved_intent == "concept_question"


@pytest.mark.parametrize(
    "message",
    [
        "Okay, so what's this concept about?",
        "Can you explain it more?",
        "Why does that happen?",
        "???",
    ],
)
def test_referential_follow_up_continues_active_dictionary_topic(message):
    result = resolve_turn(
        message,
        projection=_projection(active="dictionary"),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation in {"continue", "clarify_current"}
    assert result.active_topic_after == "topic-dictionary"
    assert result.workflow_action == "continue"
    assert "dictionary" in result.resolved_question.lower()
    assert "dictionary" in result.retrieval_query.lower()


def test_english_referential_follow_up_keeps_an_english_context_prefix():
    result = resolve_turn(
        "Can you explain it more?",
        projection=_projection(active="dictionary", unresolved_question="What does a dictionary key mean?"),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_question.startswith("About Python dictionary:")
    assert "关于" not in result.resolved_question
    assert result.retrieval_query == "Python dictionary: What does a dictionary key mean?"


@pytest.mark.parametrize("message", ["Google 是什么？", "weather 是什么？"])
def test_bare_ascii_subject_with_definition_suffix_is_not_invented_as_python_topic(message):
    result = resolve_turn(
        message,
        projection=ConversationProjection.empty(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.active_topic_after is None
    assert result.target_topic_id is None
    assert result.conversation_relation in {"off_topic", "unresolved"}
    assert result.retrieval_query == ""

    with_active = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )
    assert with_active.conversation_relation == "off_topic"
    assert with_active.active_topic_after == "topic-dictionary"
    assert with_active.target_topic_id is None
    assert with_active.retrieval_query == ""


@pytest.mark.parametrize(
    "message",
    [
        "我不要 len，我要 function",
        "not len, explain function",
        "别管 len，讲 function",
        "先不说 len，讲 function",
        "不要讲 len，讲 function",
    ],
)
def test_selected_alias_only_in_excluded_clause_keeps_focus_authoritative(message):
    result = resolve_turn(
        message,
        projection=_projection(include=("list", "dictionary")),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.selected_node.usage == "used"
    assert result.conversation_relation == "kg_explore"
    assert result.topic_transition is not None
    assert result.topic_transition.to_label == "len"
    assert "len" in result.retrieval_query.lower()


@pytest.mark.parametrize(
    "message",
    ["用 Python 写一个天气查询程序", "用 Python 写个笑话生成器"],
)
def test_python_coding_request_wins_before_off_topic_payload_words(message):
    result = resolve_turn(
        message,
        projection=_projection(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_intent == "syntax_question"
    assert result.conversation_relation == "switch_topic"
    assert result.active_topic_after != "topic-dictionary"
    assert result.topic_transition is not None
    assert result.topic_transition.to_label == "Python programming"
    assert result.workflow_action == "initialize"
    assert "dictionary" not in result.retrieval_query.lower()
    assert message in result.retrieval_query


@pytest.mark.parametrize(
    ("message", "topic_label"),
    [
        ("为什么 0.1 + 0.2 不是 0.3？", "floating point"),
        ("self 到底是谁？", "self"),
    ],
)
def test_explicit_python_learning_probe_initializes_canonical_topic(
    message,
    topic_label,
):
    result = resolve_turn(
        message,
        projection=ConversationProjection.empty(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_intent == "concept_question"
    assert result.conversation_relation == "start"
    assert result.workflow_action == "initialize"
    assert result.active_topic_after is not None
    assert result.target_topic_id == result.active_topic_after
    assert topic_label in result.retrieval_query.lower()


EXPLICIT_CASUAL_MESSAGES = (
    "你好，今天过得怎么样？我们先随便聊两句。",
    "我们先随便聊两句",
    "先闲聊一下",
    "陪我聊会儿",
    "今天有点累",
    "Let's just chat for a moment",
    "How is your day going?",
)


@pytest.mark.parametrize("message", EXPLICIT_CASUAL_MESSAGES)
def test_explicit_casual_message_cannot_override_pending_selection(message):
    projection = _projection(
        active="function",
        back_stack=("topic-list", "topic-dictionary"),
    )
    before = projection.model_dump(mode="json")

    result = resolve_turn(
        message,
        projection=projection,
        requested_focus_node_id="Concept:len",
        recent_messages=[
            {
                "event_id": "event-function-question",
                "role": "student",
                "content": "function 怎么定义？",
            },
            {
                "event_id": "event-function-answer",
                "role": "agent",
                "content": "我们正在学习 function。",
            },
        ],
        allow_llm=False,
    )

    assert result.resolved_intent == "concept_question"
    assert result.conversation_relation == "kg_explore"
    assert result.active_topic_after is not None
    assert result.selected_node.usage == "used"
    assert result.workflow_action == "initialize"
    assert "len" in result.retrieval_query.lower()
    assert projection.model_dump(mode="json") == before


@pytest.mark.parametrize("message", EXPLICIT_CASUAL_MESSAGES)
def test_provider_cannot_replace_explicit_focus_resolution(message):
    projection = _projection(active="function")
    deterministic = resolve_turn(
        message,
        projection=projection,
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )
    poisoned = deterministic.model_dump(mode="json")
    poisoned.update(
        {
            "resolved_intent": "concept_question",
            "conversation_relation": "continue",
            "workflow_action": "continue",
            "retrieval_query": "Python function len",
        }
    )
    provider = FakeProvider(json.dumps(poisoned))

    result = resolve_turn(
        message,
        projection=projection,
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        provider=provider,
        allow_llm=True,
    )

    assert provider.calls in {0, 1}
    assert result == deterministic
    assert result.resolved_intent == "concept_question"
    assert "len" in result.retrieval_query.lower()


def test_explicit_focus_precedes_explicit_python_subject():
    result = resolve_turn(
        "我们随便聊聊 list 的切片",
        projection=_projection(active="function"),
        requested_focus_node_id="Concept:len",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_intent == "concept_question"
    assert result.conversation_relation == "kg_explore"
    assert result.active_topic_after is not None
    assert result.active_topic_after != "topic-list"
    assert result.selected_node.usage == "used"
    assert result.workflow_action in {"initialize", "restore"}
    assert "len" in result.retrieval_query.lower()


def test_prepositional_for_keeps_selected_for_loop_context_without_retargeting():
    result = resolve_turn(
        "Let's just chat for a moment",
        projection=_projection(active="function"),
        requested_focus_node_id="Concept:for_loop",
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_intent == "concept_question"
    assert result.conversation_relation == "kg_explore"
    assert result.active_topic_after is not None
    assert result.selected_node.usage == "used"
    assert result.selected_node.reason == "requested_focus_node_is_authoritative"
    assert result.topic_transition is not None
    assert result.workflow_action == "initialize"
    assert "for loop" in result.retrieval_query.lower()


@pytest.mark.parametrize(
    ("message", "expected_relation"),
    [
        ("Let's just chat for now", "off_topic"),
        ("Tell me a joke for now", "off_topic"),
        ("Let's chat for fun", "off_topic"),
        ("I am tired for some reason", "unresolved"),
        ("Wait for him", "unresolved"),
        ("Can we chat for two minutes?", "off_topic"),
    ],
)
def test_prepositional_for_never_becomes_for_loop(message, expected_relation):
    result = resolve_turn(
        message,
        projection=_projection(active="function"),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == expected_relation
    assert result.active_topic_after == "topic-function"
    assert result.topic_transition is None
    assert result.workflow_action == "preserve_without_advance"
    assert result.retrieval_query == ""


@pytest.mark.parametrize(
    "message",
    (
        "What is a for loop?",
        "Explain the Python for statement",
        "for item in items:",
        "for",
        "Explain for loops",
        "How do I use for loops?",
    ),
)
def test_semantic_for_loop_boundaries_keep_true_loop_messages(message):
    result = resolve_turn(
        message,
        projection=ConversationProjection.empty(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "start"
    assert result.workflow_action == "initialize"
    assert result.active_topic_after is not None
    assert "for loop" in result.retrieval_query.lower()


def test_for_and_while_comparison_keeps_both_explicit_loop_topics():
    message = "Compare for and while loops"
    positioned = _explicit_topics(message)
    canonicals = {topic[0] for _, topic in positioned}

    assert "Concept:for_loop" in canonicals
    assert "Concept:while_loop" in canonicals

    result = resolve_turn(
        message,
        projection=ConversationProjection.empty(),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.conversation_relation == "start"
    assert result.workflow_action == "initialize"
    assert "for" in result.retrieval_query.lower()
    assert "while" in result.retrieval_query.lower()


@pytest.mark.parametrize(
    "range_marker",
    ("1-5", "1–5", "1 到 5", "1至5", "from 1 to 5"),
)
def test_bare_rating_continues_only_after_immediate_bounded_prompt(range_marker):
    result = resolve_turn(
        "1",
        projection=_projection(active="function"),
        requested_focus_node_id=None,
        recent_messages=[
            {
                "event_id": "event-old-dictionary",
                "role": "student",
                "content": "dictionary 是什么？",
            },
            {
                "event_id": "event-rating-prompt",
                "role": "agent",
                "content": (
                    f"On a scale from {range_marker}, how confident are you "
                    "about Python function?"
                ),
            },
        ],
        allow_llm=False,
    )

    assert result.resolved_intent == "concept_question"
    assert result.conversation_relation in {"continue", "clarify_current"}
    assert result.active_topic_after == "topic-function"
    assert result.workflow_action == "continue"
    assert "function" in result.retrieval_query.lower()
    assert "dictionary" not in result.retrieval_query.lower()


def test_bare_rating_without_immediate_bounded_prompt_is_unresolved():
    result = resolve_turn(
        "1",
        projection=_projection(active="function"),
        requested_focus_node_id=None,
        recent_messages=[
            {
                "event_id": "event-not-a-rating-prompt",
                "role": "agent",
                "content": "Try one function example before we continue.",
            }
        ],
        allow_llm=False,
    )

    assert result.conversation_relation == "unresolved"
    assert result.active_topic_after == "topic-function"
    assert result.workflow_action == "preserve_without_advance"
    assert result.retrieval_query == ""


@pytest.mark.parametrize(
    ("message", "expected_intent"),
    [
        ("不要直接给答案，让我自己试", "concept_question"),
        ("别给完整代码，只给我提示", "syntax_question"),
        ("不要直接给结论，解释 list[4] 为什么报错", "error_debugging"),
        ("Do not give me the final answer; give me a hint", "concept_question"),
        ("你会直接给答案吗？", "concept_question"),
        ("老师说“直接给答案”是什么意思？", "concept_question"),
        ("请直接给我完整答案，不要再提示", "direct_answer_request"),
        ("把这个 Python 函数写完给我", "direct_answer_request"),
    ],
)
def test_turn_resolver_uses_authoritative_teaching_intent(message, expected_intent):
    result = resolve_turn(
        message,
        projection=_projection(active="function"),
        requested_focus_node_id=None,
        recent_messages=[],
        allow_llm=False,
    )

    assert result.resolved_intent == expected_intent
    assert result.active_topic_after is not None
    assert result.conversation_relation in {"continue", "switch_topic"}
    assert result.workflow_action in {"continue", "initialize", "restore"}
    assert result.retrieval_query
