from __future__ import annotations

import json
import hashlib
import re
import uuid
from collections.abc import Mapping, Sequence
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.conversation_projection import ConversationProjection, TopicFrame
from app.dashscope import DashScopeChatProvider
from app.teaching_intent import classify_direct_answer_teaching_signal


ConversationRelation = Literal[
    "start",
    "continue",
    "clarify_current",
    "switch_topic",
    "kg_explore",
    "resume_previous",
    "resume_named",
    "greeting",
    "off_topic",
    "unresolved",
]
SelectionUsage = Literal["used", "not_used", "absent"]
WorkflowAction = Literal["initialize", "continue", "restore", "preserve_without_advance"]


class ResolutionProvider(Protocol):
    provider: str
    model: str

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str: ...


class ResolutionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SelectedNodeResolution(ResolutionModel):
    node_id: str | None = None
    label: str | None = None
    usage: SelectionUsage
    reason: str


class TopicTransition(ResolutionModel):
    kind: Literal["switch", "resume"]
    from_label: str
    to_label: str


class TurnResolution(ResolutionModel):
    schema_version: Literal[1] = 1
    original_message: str
    resolved_question: str
    resolved_intent: str
    conversation_relation: ConversationRelation
    active_topic_before: str | None = None
    active_topic_after: str | None = None
    target_topic_id: str | None = None
    context_source_event_ids: list[str] = Field(default_factory=list)
    selected_node: SelectedNodeResolution
    topic_transition: TopicTransition | None = None
    workflow_action: WorkflowAction
    retrieval_query: str
    resolution_confidence: float = Field(ge=0.0, le=1.0)
    ambiguity_reason: str | None = None


_TOPIC_ALIASES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "dictionary": ("Concept:dict", "dictionary", ("dictionary", "dict", "字典")),
    "list": ("Concept:list", "list", ("list", "列表")),
    "tuple": ("Concept:tuple", "tuple", ("tuple", "元组")),
    "set": ("Concept:set", "set", ("set", "集合")),
    "function": ("Concept:function", "function", ("function", "函数")),
    "len": ("Concept:len", "len", ("len",)),
    "while loop": ("Concept:while_loop", "while loop", ("while loop", "while", "while 循环")),
    "for loop": ("Concept:for_loop", "for loop", ("for loop", "for", "for 循环")),
    "if statement": ("Concept:if_statement", "if statement", ("if statement", "if", "if 语句")),
    "variable": ("Concept:variable", "variable", ("variable", "变量")),
    "index": ("Concept:index", "index", ("index", "索引")),
    "string": ("Concept:string", "string", ("string", "字符串")),
    "parameter": ("Concept:parameter", "parameter", ("parameter", "参数")),
    "argument": ("Concept:argument", "argument", ("argument", "实参")),
    "class": ("Concept:class", "class", ("class", "类")),
    "floating point": (
        "Concept:floating_point",
        "floating point",
        ("floating point", "floating-point", "浮点数", "0.1 + 0.2", "0.1+0.2"),
    ),
    "self": ("Concept:instance_method_self", "self", ("self",)),
}

_BACK_COMMANDS = {"back", "go back", "回到刚才", "返回上一个话题"}
_REFERENTIAL_PHRASES = (
    "这是啥意思",
    "这是什么意思",
    "这是什么",
    "它是什么意思",
    "这个呢",
    "那这个呢",
)

_CONTINUATION_COMMANDS = {
    "continue",
    "go on",
    "keep going",
    "继续",
    "继续讲",
    "接着讲",
}


def get_resolution_provider() -> ResolutionProvider:
    return DashScopeChatProvider()


def _compact(value: str) -> str:
    return " ".join(value.split())


def _normalized_command(message: str) -> str:
    return re.sub(r"[，。！？!?.,]+$", "", _compact(message).lower()).strip()


def _is_greeting(message: str) -> bool:
    return _normalized_command(message) in {"hi", "hello", "hey", "你好", "您好", "嗨"}


def _is_off_topic(message: str) -> bool:
    normalized = message.lower()
    return any(
        token in normalized
        for token in (
            "weather",
            "天气",
            "google",
            "股票",
            "股价",
            "足球比分",
            "who is the president",
            "笑话",
            "joke",
            "写首诗",
            "write a poem",
            "随便聊聊",
            "just chat",
            "菜谱",
            "recipe",
            "旅游攻略",
            "travel plan",
        )
    )


def _is_explicit_casual_or_off_topic(message: str) -> bool:
    """Return whether the current message explicitly requests social conversation."""

    normalized = _normalized_command(message)
    return _is_off_topic(message) or any(
        marker in normalized
        for marker in (
            "随便聊两句",
            "闲聊一下",
            "陪我聊会儿",
            "陪我聊会",
            "今天有点累",
            "let's just chat",
            "lets just chat",
            "let's chat",
            "lets chat",
            "can we chat",
            "how is your day going",
        )
    )


def _is_semantic_for_alias(
    normalized_message: str,
    start: int,
    end: int,
) -> bool:
    command = _normalized_command(normalized_message)
    if command == "for":
        return True
    suffix = normalized_message[end:]
    if re.match(
        r"\s*(?:loops?\b|statement\b|循环|语句|怎么用|如何用|是什么|"
        r"vs\.?\b|和|与)",
        suffix,
        flags=re.IGNORECASE,
    ):
        return True
    if re.match(
        r"\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+[^:\n]+:",
        suffix,
        flags=re.IGNORECASE,
    ):
        return True
    prefix = normalized_message[:start]
    if re.search(
        r"\b(?:compare|comparison|versus|difference\s+between)\s*$",
        prefix,
        flags=re.IGNORECASE,
    ) and re.match(
        r"\s+(?:and|vs\.?|versus)\s+",
        suffix,
        flags=re.IGNORECASE,
    ):
        return True
    return bool(
        re.search(r"\bpython\s*$", prefix, flags=re.IGNORECASE)
        and re.fullmatch(r"\s*", suffix)
    )


def _semantic_alias_positions(message: str, alias: str) -> tuple[int, ...]:
    if re.fullmatch(r"[a-z][a-z0-9_ ]*", alias):
        normalized = message.lower()
        matches = re.finditer(
            rf"(?<![A-Za-z0-9_]){re.escape(alias)}(?![A-Za-z0-9_])",
            normalized,
        )
        return tuple(
            match.start()
            for match in matches
            if alias != "for"
            or _is_semantic_for_alias(normalized, match.start(), match.end())
        )
    positions: list[int] = []
    start = 0
    while (position := message.find(alias, start)) >= 0:
        positions.append(position)
        start = position + max(1, len(alias))
    return tuple(positions)


def _contains_alias(message: str, alias: str) -> bool:
    return bool(_semantic_alias_positions(message, alias))


def _alias_position(message: str, alias: str) -> int | None:
    positions = _semantic_alias_positions(message, alias)
    return positions[0] if positions else None


def _explicit_topics(message: str) -> list[tuple[int, tuple[str, str, tuple[str, ...]]]]:
    candidates: list[tuple[int, tuple[str, str, tuple[str, ...]]]] = []
    for canonical in _TOPIC_ALIASES.values():
        positions = [
            position
            for alias in canonical[2]
            if (position := _alias_position(message, alias)) is not None
        ]
        if positions:
            candidates.append((min(positions), canonical))
    if not candidates:
        error = re.search(r"\b([A-Za-z_][A-Za-z0-9_]*Error)\b", message)
        if error:
            label = error.group(1)
            candidates.append((error.start(), (f"ErrorType:{label}", label, (label,))))
    existing_canonicals = {topic[0] for _, topic in candidates}
    python_identifier_signals = {
        "abs",
        "all",
        "any",
        "append",
        "enumerate",
        "extend",
        "filter",
        "input",
        "insert",
        "iter",
        "map",
        "max",
        "min",
        "next",
        "open",
        "pop",
        "print",
        "remove",
        "reversed",
        "round",
        "sorted",
        "sum",
        "zip",
    }
    generic_patterns = (
        (r"(?i)\bpython\s+([A-Za-z_][A-Za-z0-9_]*)", False),
        (r"`([A-Za-z_][A-Za-z0-9_]*)`", False),
        (r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", False),
        (r"\b([A-Za-z_][A-Za-z0-9_]*)\s*(?=方法|函数|怎么用|是什么)", True),
    )
    ignored_identifiers = {"python", "what", "how", "could", "can", "please"}
    for pattern, requires_known_signal in generic_patterns:
        for match in re.finditer(pattern, message):
            identifier = match.group(1)
            if identifier.lower() in ignored_identifiers:
                continue
            if requires_known_signal and identifier.lower() not in python_identifier_signals:
                continue
            known = next(
                (
                    topic
                    for topic in _TOPIC_ALIASES.values()
                    if identifier.lower() in {alias.lower() for alias in topic[2]}
                ),
                None,
            )
            topic = known or (
                f"Concept:{identifier.lower()}",
                identifier,
                (identifier,),
            )
            if topic[0] in existing_canonicals:
                continue
            candidates.append((match.start(1), topic))
            existing_canonicals.add(topic[0])
    if not candidates and _is_python_coding_request(message):
        python_position = message.lower().find("python")
        candidates.append(
            (
                python_position,
                (
                    "Concept:python_programming",
                    "Python programming",
                    ("Python programming", "Python 编程"),
                ),
            )
        )
    return sorted(candidates, key=lambda item: item[0])


def _explicit_topic(
    message: str,
    active: TopicFrame | None = None,
) -> tuple[
    tuple[str, str, tuple[str, ...]] | None,
    list[tuple[str, str, tuple[str, ...]]],
    bool,
]:
    positioned = _explicit_topics(message)
    topics = [topic for _, topic in positioned]
    if not topics:
        return None, [], False

    comparison = bool(
        re.search(r"区别|不同|比较|\bdifference\b|\bcompare\b|\bversus\b|\bvs\.?\b", message, re.I)
    )
    negation = re.search(r"不是|\bnot\s+", message, re.I)
    if negation:
        positive_before = [topic for position, topic in positioned if position < negation.start()]
        positive_after_marker = re.search(
            r"(?:而是|(?<!不)是)\s*([^，。,.]+)$",
            message,
            re.I,
        )
        if positive_after_marker:
            after = [topic for position, topic in positioned if position >= positive_after_marker.start(1)]
            if after:
                return after[0], topics, comparison
        if positive_before:
            return positive_before[-1], topics, comparison

    if re.search(
        r"先不说|不再说|不要讲|不要说|不要|别讲|别说|别管|不讲|不说|"
        r"\bnot\b|instead|rather than",
        message,
        re.I,
    ):
        return topics[-1], topics, comparison

    if comparison and active is not None:
        for topic in topics:
            if _frame_matches(active, *topic):
                return topic, topics, True
    return topics[0], topics, comparison


def _is_explicit_correction(message: str) -> bool:
    return len(_explicit_topics(message)) >= 2 and bool(
        re.search(r"不是|\bnot\b", message, re.IGNORECASE)
    )


def _selected_topic(node_id: str) -> tuple[str, str, tuple[str, ...]]:
    for canonical in _TOPIC_ALIASES.values():
        if node_id == canonical[0]:
            return canonical
    prefix, _, value = node_id.partition(":")
    raw_label = value or prefix
    label = raw_label.replace("_", " ").strip()
    if label == "dict":
        return _TOPIC_ALIASES["dictionary"]
    return node_id, label, tuple(dict.fromkeys((label, raw_label)))


def _selection_is_positive(
    message: str,
    selected: tuple[str, str, tuple[str, ...]],
) -> bool:
    cleaned = message
    negative_prefix = (
        r"(?:先不说|不再说|不要讲|不要说|不要|别讲|别说|别管|不讲|不说|不是|"
        r"do not discuss|don't discuss|\bnot\b|skip)\s*"
    )
    for alias in sorted(selected[2], key=len, reverse=True):
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_ ]*", alias):
            alias_pattern = rf"(?<![A-Za-z0-9_]){re.escape(alias)}(?![A-Za-z0-9_])"
        else:
            alias_pattern = re.escape(alias)
        cleaned = re.sub(
            negative_prefix + alias_pattern,
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
    return any(_contains_alias(cleaned, alias) for alias in selected[2])


def _active_frame(projection: ConversationProjection) -> TopicFrame | None:
    if projection.active_topic_id is None:
        return None
    return projection.topics.get(projection.active_topic_id)


def _frame_matches(frame: TopicFrame, canonical: str, label: str, aliases: Sequence[str]) -> bool:
    values = {
        frame.canonical_topic.lower(),
        frame.topic_label.lower(),
        *(alias.lower() for alias in frame.aliases),
    }
    return canonical.lower() in values or label.lower() in values or any(
        alias.lower() in values for alias in aliases
    )


def _matching_frames(
    projection: ConversationProjection,
    canonical: str,
    label: str,
    aliases: Sequence[str],
) -> list[TopicFrame]:
    frames = [
        frame
        for frame in projection.topics.values()
        if _frame_matches(frame, canonical, label, aliases)
    ]
    return sorted(frames, key=lambda frame: frame.last_active_at, reverse=True)


def _new_topic_id(
    canonical: str,
    message: str,
    projection: ConversationProjection,
    requested_focus_node_id: str | None,
) -> str:
    evidence = json.dumps(
        {
            "canonical_topic": canonical,
            "message": message,
            "projection": projection.model_dump(mode="json"),
            "requested_focus_node_id": requested_focus_node_id,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(evidence).digest()[:16]
    return f"topic-{uuid.UUID(bytes=digest, version=4)}"


def _context_event_ids(recent_messages: Sequence[Mapping[str, Any]]) -> list[str]:
    ids: list[str] = []
    for item in recent_messages:
        event_id = item.get("event_id") or item.get("context_event_id")
        if isinstance(event_id, str) and event_id and event_id not in ids:
            ids.append(event_id)
    return ids


def _is_referential(message: str) -> bool:
    normalized = _normalized_command(message)
    # A punctuation-only follow-up is meaningful only in an existing learning
    # context (for example, a learner replying "???" after an explanation).
    # Treat it as a request to clarify the active topic instead of onboarding.
    if re.fullmatch(r"[\s?？！。.!]+", message):
        return True
    if any(phrase in normalized for phrase in _REFERENTIAL_PHRASES):
        return True
    if re.search(
        r"\b(?:what(?:'s| is) (?:this|it)(?:\s+concept)?(?:\s+about)?|"
        r"can you explain (?:this|it)(?:\s+more)?|"
        r"why (?:does|is) (?:this|that|it)(?:\s+important|\s+happen)?|"
        r"how (?:do i|can i|to) use (?:this|it))\b",
        normalized,
        flags=re.IGNORECASE,
    ):
        return True
    return bool(
        re.fullmatch(
            r"(?:能|可以|可不可以)?(?:再)?(?:解释|说明|讲)(?:一下|一遍)?(?:吗)?|"
            r"(?:这个|那个|该)节点(?:是)?(?:什么|啥)(?:意思)?|"
            r"(?:这个|那个|该)节点怎么用|"
            r"(?:能|可以|可不可以)?(?:再)?(?:解释|说明|讲)(?:一下|一遍)?(?:这个|那个|该)节点(?:吗)?|"
            r"(?:这个|那个|它)?怎么用|(?:could you |can you )?(?:please )?explain(?: it| this)?|"
            r"what(?:(?:'|’)s| is) (?:it|this)|"
            r"how (?:do i|can i|to) use (?:it|this)|"
            r"(?:这|那|它)(?:有)?(?:啥|什么)用|为什么(?:会)?(?:这样|如此)?|"
            r"(?:我)?(?:还是)?不懂|能不能换个方式解释",
            normalized,
            flags=re.IGNORECASE,
        )
    )


def _preceding_agent_requested_rating(
    recent_messages: Sequence[Mapping[str, Any]],
) -> bool:
    if not recent_messages:
        return False
    preceding = recent_messages[-1]
    if str(preceding.get("role") or "").lower() not in {"agent", "assistant"}:
        return False
    content = preceding.get("content")
    if not isinstance(content, str):
        return False
    has_range = bool(
        re.search(
            r"(?:1\s*[-–]\s*5|1\s*(?:到|至)\s*5|from\s+1\s+to\s+5)",
            content,
            flags=re.IGNORECASE,
        )
    )
    has_rating_subject = bool(
        re.search(
            r"信心|理解|掌握|confidence|confident|understand",
            content,
            flags=re.IGNORECASE,
        )
    )
    return has_range and has_rating_subject


def _is_rating_response(
    message: str,
    recent_messages: Sequence[Mapping[str, Any]],
) -> bool:
    return bool(re.fullmatch(r"[1-5]", message.strip())) and _preceding_agent_requested_rating(
        recent_messages
    )


def _is_valid_contextual_continuation(
    message: str,
    recent_messages: Sequence[Mapping[str, Any]],
) -> bool:
    normalized = _normalized_command(message)
    if _is_referential(message):
        return True
    if not normalized:
        return False
    if _is_rating_response(message, recent_messages):
        return True
    if normalized in _CONTINUATION_COMMANDS:
        return True
    if re.match(r"^(?:就是|还是|然后|所以).+", normalized):
        return True
    if classify_direct_answer_teaching_signal(message) in {
        "negated",
        "meta_or_quoted",
        "positive",
    }:
        return True
    return bool(
        re.search(
            r"(?:再)?举(?:一|另)?个例子|什么例子|换个例子|其他方法|详细一点|复杂度|"
            r"(?:那|这个|那个)\s*[a-z_][a-z0-9_]*\s*呢|"
            r"怎么写|写法|代码|提示|"
            r"another\s+example|other\s+(?:approaches|methods)|more\s+detail|"
            r"(?:explain|show|tell)\s+me\s+more|syntax|code|hint",
            normalized,
            flags=re.IGNORECASE,
        )
    )


def _intent(message: str) -> str:
    lowered = message.lower()
    if re.search(r"\b[A-Za-z_][A-Za-z0-9_]*Error\b", message) or any(
        token in message for token in ("报错", "错误", "异常")
    ):
        return "error_debugging"
    teaching_signal = classify_direct_answer_teaching_signal(message)
    if teaching_signal == "positive":
        return "direct_answer_request"
    if _is_python_coding_request(message) or any(
        token in lowered for token in ("怎么写", "写法", "syntax", "代码")
    ):
        return "syntax_question"
    return "concept_question"


def _is_python_coding_request(message: str) -> bool:
    lowered = message.lower()
    if "python" not in lowered:
        return False
    return bool(
        re.search(
            r"写|编写|创建|实现|开发|生成器|程序|脚本|应用|\bwrite\b|\bbuild\b|"
            r"\bcreate\b|\bimplement\b|\bprogram\b|\bscript\b|\bapp\b",
            message,
            flags=re.IGNORECASE,
        )
    )


def _resolved_from_topic(message: str, frame: TopicFrame, *, referential: bool) -> str:
    chinese_context = bool(
        re.search(r"[\u4e00-\u9fff]", f"{message} {frame.unresolved_question}")
    )
    if referential and frame.unresolved_question:
        if chinese_context:
            return f"关于 Python {frame.topic_label}：{frame.unresolved_question}"
        return f"About Python {frame.topic_label}: {frame.unresolved_question}"
    if chinese_context:
        return f"关于 Python {frame.topic_label}：{message}"
    return f"About Python {frame.topic_label}: {message}"


def _resolved_from_selection(message: str, label: str, *, referential: bool) -> str:
    if referential:
        if re.search(r"[\u4e00-\u9fff]", message):
            return f"Python 的 {label} 是什么意思？"
        return f"What does Python {label} mean?"
    if label.lower() in message.lower():
        return message
    return f"Python {label}: {message}"


def _retrieval_query(resolved_question: str, topic_label: str | None) -> str:
    if not resolved_question or not topic_label:
        return ""
    question = _compact(resolved_question)
    normalized_question = question.lower()
    normalized_topic = topic_label.lower()
    english_context_prefix = f"about python {normalized_topic}:"
    if normalized_question.startswith(english_context_prefix):
        question = question[len(english_context_prefix) :].strip()
        normalized_question = question.lower()
    if normalized_question.startswith(f"python {normalized_topic}"):
        return question
    if normalized_topic in normalized_question:
        # Keep the selected concept as the retrieval subject instead of
        # producing an awkward duplicated prefix such as "Python What does
        # Python set mean?" for a deictic selected-node question.
        return f"Python {topic_label}: {question}"
    return f"Python {topic_label} {question}"


def _selection(
    requested_focus_node_id: str | None,
    usage: SelectionUsage,
    reason: str,
) -> SelectedNodeResolution:
    if requested_focus_node_id is None:
        return SelectedNodeResolution(usage="absent", reason="no_selection")
    _, label, _ = _selected_topic(requested_focus_node_id)
    return SelectedNodeResolution(
        node_id=requested_focus_node_id,
        label=label,
        usage=usage,
        reason=reason,
    )


def _transition(
    kind: Literal["switch", "resume"],
    before: TopicFrame | None,
    after: TopicFrame | tuple[str, str, tuple[str, ...]] | None,
) -> TopicTransition | None:
    if before is None or after is None:
        return None
    to_label = after.topic_label if isinstance(after, TopicFrame) else after[1]
    if before.topic_label == to_label:
        return None
    return TopicTransition(
        kind=kind,
        from_label=before.topic_label,
        to_label=to_label,
    )


def _named_phrase(message: str) -> str | None:
    match = re.match(
        r"^\s*(?:回到|返回)(?:之前|先前)?(?:讲|学习|的)?\s*(.+?)\s*$",
        message,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    phrase = re.sub(r"(?:的地方|的话题|那里|那一段)[，。！？!?.,]*$", "", match.group(1)).strip()
    return phrase or None


def _linked_topic_texts(
    frame: TopicFrame,
    recent_messages: Sequence[Mapping[str, Any]],
) -> list[str]:
    texts: list[str] = []
    for item in recent_messages:
        linked_topic_id = item.get("topic_id") or item.get("topic_frame_id")
        content = item.get("content")
        if linked_topic_id == frame.topic_id and isinstance(content, str):
            texts.append(content)
    return texts


def _named_matches(
    phrase: str,
    projection: ConversationProjection,
    recent_messages: Sequence[Mapping[str, Any]],
) -> list[TopicFrame]:
    target, _, _ = _explicit_topic(phrase)
    matches: list[TopicFrame] = []
    normalized_phrase = phrase.lower()
    for frame in projection.topics.values():
        direct_values = [frame.canonical_topic, frame.topic_label, *frame.aliases]
        direct = any(
            normalized_phrase == value.lower()
            or _contains_alias(phrase, value.lower())
            for value in direct_values
        )
        if target is not None and _frame_matches(frame, *target):
            direct = True
        linked = False
        for content in _linked_topic_texts(frame, recent_messages):
            if _contains_alias(content, normalized_phrase):
                linked = True
                break
            linked_topics = [topic for _, topic in _explicit_topics(content)]
            if target is not None and any(
                linked_topic[0] == target[0] for linked_topic in linked_topics
            ):
                linked = True
                break
        if direct or linked:
            matches.append(frame)
    return sorted(matches, key=lambda frame: frame.last_active_at, reverse=True)


def _base_resolution(
    message: str,
    projection: ConversationProjection,
    requested_focus_node_id: str | None,
    recent_messages: Sequence[Mapping[str, Any]],
) -> TurnResolution:
    before = _active_frame(projection)
    before_id = projection.active_topic_id
    event_ids = _context_event_ids(recent_messages)
    command = _normalized_command(message)
    selected = _selected_topic(requested_focus_node_id) if requested_focus_node_id else None

    # A focus chip is an explicit learner action. It remains authoritative until
    # the learner removes it through the UI, regardless of the message wording.
    if requested_focus_node_id is not None and selected is not None:
        matches = _matching_frames(projection, *selected)
        target = matches[0] if matches else None
        target_id = target.topic_id if target else _new_topic_id(
            selected[0], message, projection, requested_focus_node_id
        )
        relation: ConversationRelation = (
            "continue" if target_id == before_id else "kg_explore" if before else "start"
        )
        action: WorkflowAction = (
            "continue" if target_id == before_id else "restore" if target else "initialize"
        )
        resolved = _resolved_from_selection(
            message,
            selected[1],
            referential=_is_referential(message),
        )
        return TurnResolution(
            original_message=message,
            resolved_question=resolved,
            resolved_intent="concept_question",
            conversation_relation=relation,
            active_topic_before=before_id,
            active_topic_after=target_id,
            target_topic_id=target_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "used",
                "requested_focus_node_is_authoritative",
            ),
            topic_transition=_transition("switch", before, target or selected),
            workflow_action=action,
            retrieval_query=_retrieval_query(resolved, selected[1]),
            resolution_confidence=1.0,
        )

    if command in _BACK_COMMANDS:
        target = next(
            (
                projection.topics[candidate]
                for candidate in reversed(projection.back_stack)
                if candidate in projection.topics and candidate != before_id
            ),
            None,
        )
        if target is None:
            return TurnResolution(
                original_message=message,
                resolved_question="No previous topic exists.",
                resolved_intent="unknown",
                conversation_relation="unresolved",
                active_topic_before=before_id,
                active_topic_after=before_id,
                target_topic_id=None,
                context_source_event_ids=event_ids,
                selected_node=_selection(
                    requested_focus_node_id,
                    "not_used" if requested_focus_node_id else "absent",
                    "navigation_command_precedes_selection",
                ),
                workflow_action="preserve_without_advance",
                retrieval_query="",
                resolution_confidence=1.0,
                ambiguity_reason="no_previous_topic",
            )
        return TurnResolution(
            original_message=message,
            resolved_question=f"Resume Python {target.topic_label}: {target.unresolved_question or target.summary}",
            resolved_intent="concept_question",
            conversation_relation="resume_previous",
            active_topic_before=before_id,
            active_topic_after=target.topic_id,
            target_topic_id=target.topic_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "not_used" if requested_focus_node_id else "absent",
                "navigation_command_precedes_selection",
            ),
            topic_transition=_transition("resume", before, target),
            workflow_action="restore",
            retrieval_query=_retrieval_query(
                target.unresolved_question or f"Resume {target.topic_label}", target.topic_label
            ),
            resolution_confidence=1.0,
        )

    named_phrase = _named_phrase(message)
    if named_phrase:
        matches = _named_matches(named_phrase, projection, recent_messages)
        canonical_groups: dict[str, list[TopicFrame]] = {}
        for frame in matches:
            canonical_groups.setdefault(frame.canonical_topic, []).append(frame)
        if len(canonical_groups) == 1:
            target = next(iter(canonical_groups.values()))[0]
            return TurnResolution(
                original_message=message,
                resolved_question=f"Resume Python {target.topic_label}: {target.unresolved_question or target.summary}",
                resolved_intent="concept_question",
                conversation_relation="resume_named",
                active_topic_before=before_id,
                active_topic_after=target.topic_id,
                target_topic_id=target.topic_id,
                context_source_event_ids=event_ids,
                selected_node=_selection(
                    requested_focus_node_id,
                    "not_used" if requested_focus_node_id else "absent",
                    "navigation_command_precedes_selection",
                ),
                topic_transition=_transition("resume", before, target),
                workflow_action="restore",
                retrieval_query=_retrieval_query(
                    target.unresolved_question or f"Resume {target.topic_label}", target.topic_label
                ),
                resolution_confidence=1.0,
            )
        labels = sorted({frame.topic_label for frame in matches})
        reason = "named_topic_ambiguous" if len(canonical_groups) > 1 else "named_topic_not_found"
        clarification = (
            f"Which previous Python topic did you mean: {', '.join(labels)}?"
            if labels
            else f"Which previous Python topic did you mean by {named_phrase}?"
        )
        return TurnResolution(
            original_message=message,
            resolved_question=clarification,
            resolved_intent="unknown",
            conversation_relation="unresolved",
            active_topic_before=before_id,
            active_topic_after=before_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "not_used" if requested_focus_node_id else "absent",
                "navigation_command_precedes_selection",
            ),
            workflow_action="preserve_without_advance",
            retrieval_query="",
            resolution_confidence=1.0,
            ambiguity_reason=reason,
        )

    explicit, _, _ = _explicit_topic(message, before)

    if _is_greeting(message):
        return TurnResolution(
            original_message=message,
            resolved_question=message,
            resolved_intent="greeting",
            conversation_relation="greeting",
            active_topic_before=before_id,
            active_topic_after=before_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "not_used" if requested_focus_node_id else "absent",
                "greeting_does_not_consume_selection",
            ),
            workflow_action="preserve_without_advance",
            retrieval_query="",
            resolution_confidence=1.0,
        )

    referential = _is_referential(message)
    if explicit is None and _is_explicit_casual_or_off_topic(message):
        return TurnResolution(
            original_message=message,
            resolved_question=message,
            resolved_intent="off_topic",
            conversation_relation="off_topic",
            active_topic_before=before_id,
            active_topic_after=before_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "not_used" if requested_focus_node_id else "absent",
                "off_topic_message_does_not_consume_selection",
            ),
            workflow_action="preserve_without_advance",
            retrieval_query="",
            resolution_confidence=1.0,
        )

    if explicit is not None:
        matches = _matching_frames(projection, *explicit)
        target = matches[0] if matches else None
        target_id = target.topic_id if target else _new_topic_id(
            explicit[0], message, projection, requested_focus_node_id
        )
        usage: SelectionUsage = "not_used" if requested_focus_node_id else "absent"
        if before is None:
            relation: ConversationRelation = "start"
            action: WorkflowAction = "initialize" if target is None else "restore"
        elif target_id == before_id:
            relation = "continue"
            action = "continue"
        else:
            relation = "switch_topic"
            action = "restore" if target is not None else "initialize"
        return TurnResolution(
            original_message=message,
            resolved_question=message,
            resolved_intent=_intent(message),
            conversation_relation=relation,
            active_topic_before=before_id,
            active_topic_after=target_id,
            target_topic_id=target_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                usage,
                "current_message_explicitly_conflicts_with_selection"
                if usage == "not_used"
                else "no_selection",
            ),
            topic_transition=_transition("switch", before, target or explicit),
            workflow_action=action,
            retrieval_query=(
                f"Python {explicit[1]}"
                if _is_explicit_correction(message)
                else _retrieval_query(message, explicit[1])
            ),
            resolution_confidence=1.0,
        )

    if before is not None and _is_rating_response(message, recent_messages):
        rating = message.strip()
        resolved = f"Confidence rating {rating} for Python {before.topic_label}"
        return TurnResolution(
            original_message=message,
            resolved_question=resolved,
            resolved_intent="concept_question",
            conversation_relation="continue",
            active_topic_before=before_id,
            active_topic_after=before_id,
            target_topic_id=before_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "not_used" if requested_focus_node_id else "absent",
                "rating_response_uses_active_topic",
            ),
            workflow_action="continue",
            retrieval_query=_retrieval_query(resolved, before.topic_label),
            resolution_confidence=1.0,
        )

    if re.fullmatch(r"\d+", message.strip()):
        return TurnResolution(
            original_message=message,
            resolved_question="Please clarify what this number refers to.",
            resolved_intent="unknown",
            conversation_relation="unresolved",
            active_topic_before=before_id,
            active_topic_after=before_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "not_used" if requested_focus_node_id else "absent",
                "unbound_short_response",
            ),
            workflow_action="preserve_without_advance",
            retrieval_query="",
            resolution_confidence=1.0,
            ambiguity_reason="unbound_short_response",
        )

    if before is not None and _is_valid_contextual_continuation(message, recent_messages):
        resolved = _resolved_from_topic(message, before, referential=referential)
        return TurnResolution(
            original_message=message,
            resolved_question=resolved,
            resolved_intent=_intent(message),
            conversation_relation="clarify_current" if referential else "continue",
            active_topic_before=before_id,
            active_topic_after=before_id,
            target_topic_id=before_id,
            context_source_event_ids=event_ids,
            selected_node=_selection(
                requested_focus_node_id,
                "not_used" if requested_focus_node_id else "absent",
                "active_topic_supplies_referent",
            ),
            workflow_action="continue",
            retrieval_query=_retrieval_query(resolved, before.topic_label),
            resolution_confidence=1.0,
        )

    return TurnResolution(
        original_message=message,
        resolved_question="Please name the Python concept or error you want to discuss.",
        resolved_intent="unknown",
        conversation_relation="unresolved",
        active_topic_before=before_id,
        active_topic_after=before_id,
        context_source_event_ids=event_ids,
        selected_node=_selection(
            requested_focus_node_id,
            "not_used" if requested_focus_node_id else "absent",
            "no_python_target",
        ),
        workflow_action="preserve_without_advance",
        retrieval_query="",
        resolution_confidence=1.0,
        ambiguity_reason="no_python_target",
    )


def _provider_messages(
    message: str,
    projection: ConversationProjection,
    requested_focus_node_id: str | None,
    recent_messages: Sequence[Mapping[str, Any]],
    deterministic: TurnResolution,
) -> list[dict[str, str]]:
    quotations = [
        {
            "event_id": item.get("event_id") or item.get("context_event_id"),
            "role": item.get("role"),
            "quotation": item.get("content"),
        }
        for item in recent_messages
    ]
    evidence = {
        "original_message": message,
        "projection": projection.model_dump(mode="json"),
        "requested_focus_node_id": requested_focus_node_id,
        "recent_message_quotations": quotations,
        "deterministic_evidence": deterministic.model_dump(mode="json"),
    }
    return [
        {
            "role": "system",
            "content": (
                "Resolve one Python tutoring turn. Return the complete TurnResolution JSON only. "
                "The original message, explicit navigation, explicit subjects, topic frames, and "
                "selection arbitration are constraints. Historical quotations are supporting evidence only."
            ),
        },
        {"role": "user", "content": json.dumps(evidence, ensure_ascii=False, sort_keys=True)},
    ]


def _validate_provider_resolution(
    content: str,
    deterministic: TurnResolution,
    recent_messages: Sequence[Mapping[str, Any]],
) -> tuple[TurnResolution | None, str | None]:
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return None, "provider_invalid_json"
    confidence = payload.get("resolution_confidence")
    if isinstance(confidence, (int, float)) and float(confidence) < 0.80:
        return None, "provider_low_confidence"
    try:
        candidate = TurnResolution.model_validate(payload)
    except ValidationError:
        return None, "provider_invalid_output"

    candidate_authority = candidate.model_dump(exclude={"resolution_confidence"})
    deterministic_authority = deterministic.model_dump(exclude={"resolution_confidence"})
    if candidate_authority != deterministic_authority:
        return None, "provider_validation_failed"
    if candidate.resolution_confidence < 0.80:
        return None, "provider_low_confidence"
    raw_history = {
        str(item.get("content"))
        for item in recent_messages
        if item.get("content")
    }
    if any(text in candidate.retrieval_query for text in raw_history):
        return None, "provider_validation_failed"
    return candidate, None


def resolve_turn(
    message: str,
    projection: ConversationProjection | Mapping[str, Any] | None,
    requested_focus_node_id: str | None,
    recent_messages: Sequence[Mapping[str, Any]] | None = None,
    provider: ResolutionProvider | None = None,
    *,
    allow_llm: bool = False,
) -> TurnResolution:
    canonical_projection = (
        projection
        if isinstance(projection, ConversationProjection)
        else ConversationProjection.model_validate(projection or {})
    )
    quotations = list(recent_messages or [])
    deterministic = _base_resolution(
        message,
        canonical_projection,
        requested_focus_node_id,
        quotations,
    )
    if requested_focus_node_id is not None:
        deterministic = deterministic.model_copy(
            update={
                "selected_node": _selection(
                    requested_focus_node_id,
                    "used",
                    "requested_focus_node_is_authoritative",
                )
            }
        )
    if not allow_llm:
        return deterministic

    try:
        resolution_provider = provider or get_resolution_provider()
        content = resolution_provider.chat(
            _provider_messages(
                message,
                canonical_projection,
                requested_focus_node_id,
                quotations,
                deterministic,
            ),
            temperature=0.0,
            max_tokens=1200,
        )
    except Exception:
        return deterministic

    candidate, failure = _validate_provider_resolution(content, deterministic, quotations)
    if candidate is None:
        del failure
        return deterministic
    return candidate
