from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Literal


DirectAnswerClass = Literal[
    "explicit_direct",
    "ambiguous_direct",
    "negated",
    "meta_or_quoted",
    "ordinary",
]


@dataclass(frozen=True)
class DirectAnswerIntent:
    classification: DirectAnswerClass
    chargeable: bool
    reason_code: str
    source: Literal["deterministic", "llm"]


IntentClassifier = Callable[[str, list[dict[str, str]]], DirectAnswerIntent | None]


_NEGATED_PATTERNS = (
    r"(?:不要|别)(?:再)?(?:直接)?(?:给|告诉|说)(?:我)?(?:完整|正确|最终)?(?:答案|结论|解法|代码)",
    r"(?:只要|只给)(?:我)?(?:一个)?提示",
    r"(?:不要|别).{0,12}(?:写完|补全|完成).{0,12}(?:函数|代码)",
    r"(?:do not|don't|dont).{0,24}(?:answer|solution|code)",
    r"(?:hint only|only give me (?:a )?hint|give me (?:just )?(?:one |a )?hint)",
    r"(?!(?:不要再提示|别解释))(?:不要|别).{0,12}(?:把)?.{0,20}(?:代码|函数).{0,20}(?:写完|补全|完成)",
    r"\b(?:do not|don't|dont)\b.{0,32}\b(?:complete|finish)\b.{0,32}\b(?:code|function)\b",
    r"\bi don't want.{0,32}\b(?:answer|solution|code)\b",
)
_META_PATTERNS = (
    r"(?:你|系统|ai).{0,10}(?:会|能|可以).{0,10}(?:直接)?(?:给|告诉|说).{0,10}(?:答案|结论|解法|代码).{0,4}[吗么?？]",
    r"[“\"'].{0,48}(?:直接给答案|完整答案|answer|solution|code).{0,48}[”\"'].{0,16}(?:是什么意思|什么意思|意味着|mean)",
    r"can (?:you|the system|ai).{0,16}(?:give|provide).{0,16}direct answers?\??",
    r"[“\"'].{0,64}[”\"'].{0,24}(?:什么意思|什么含义|mean)",
    r"(?:你会|能否|是否|can you|are you able to|could the tutor).{0,48}(?:答案|代码|函数|answer|code|function).{0,32}[?？]",
)
_ORDINARY_PATTERNS = (
    r"^(?:如果|假如|if|when).{0,96}(?:学不到|not learn)",
    r"^(?:我已经|after i|when i).{0,96}(?:写完|完成|complete|finish)",
    r"^(?:写完|补全|完成).{0,32}(?:后|之后|怎么)",
    r"(?:答案|answer).{0,12}(?:为什么|why)",
)
_CASUAL_PATTERNS = (
    r"(?:你叫|你的名字|叫什么名字|your name)",
    r"(?:选择|点击|点了|选了).{0,20}(?:节点|node|知识图谱|kg)",
)
_CHINESE_DIRECT = (
    r"(?:别问我了|别绕了|不要再提问).{0,24}(?:正确|完整|最终)?(?:答案|解法|结论)",
    r"(?:直接|别绕|不要提示|不用引导|不要问我|不需要步骤).{0,12}(?:给|告诉|说|写|补全|完成|代写|做完).{0,16}(?:答案|结论|解法|代码|函数|题|作业)",
    r"(?:给|告诉|说).{0,8}(?:我)?.{0,16}(?:完整|正确|最终)?.{0,8}(?:答案|结论|解法)",
    r"(?:把|帮我|替我).{0,16}(?:代码|函数).{0,12}(?:写完|补全|完成|做完)",
    r"(?:写完|补全|完成|做完).{0,12}(?:代码|函数).{0,8}(?:给我)?",
)
_ENGLISH_DIRECT = (
    r"\b(?:give|tell|show|reveal)\b.{0,48}\b(?:direct|final|full|complete)?\s*(?:answer|solution)\b",
    r"\b(?:solve|write|finish|complete)\b.{0,48}\b(?:code|function|exercise|assignment|solution)\b",
    r"\b(?:stop hinting|no hints|do not guide)\b.{0,48}\b(?:solve|answer|solution|code)\b",
)
_REFERENTIAL_PATTERNS = (
    r"(?:那就)?直接(?:说|讲)(?:吧)?$",
    r"(?:就)?(?:直接)?告诉我(?:吧)?$",
    r"(?:just )?say it$",
    r"tell me then$",
)
_TASK_MARKERS = ("python", "代码", "函数", "题", "报错", "error", "list", "dict", "range", "while", "for")


def _normalized(message: str) -> str:
    return " ".join(str(message or "").casefold().split())


def _matches(message: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pattern, message, flags=re.IGNORECASE) for pattern in patterns)


def _free_intent(classification: Literal["negated", "meta_or_quoted", "ordinary"], reason: str) -> DirectAnswerIntent:
    return DirectAnswerIntent(classification, False, reason, "deterministic")


def is_hard_free_request(message: str) -> DirectAnswerIntent | None:
    normalized = _normalized(message)
    if not normalized.startswith("不要问我") and _matches(normalized, _NEGATED_PATTERNS):
        return _free_intent("negated", "negated_direct_request")
    if _matches(normalized, _META_PATTERNS):
        return _free_intent("meta_or_quoted", "meta_direct_answer_question")
    if _matches(normalized, _CASUAL_PATTERNS):
        return _free_intent("ordinary", "casual_or_off_topic")
    if _matches(normalized, _ORDINARY_PATTERNS):
        return _free_intent("ordinary", "deterministic_free_default")
    return None


def is_explicit_direct_request(message: str) -> bool:
    normalized = _normalized(message)
    return _matches(normalized, _CHINESE_DIRECT) or _matches(normalized, _ENGLISH_DIRECT)


def _has_task_antecedent(recent_messages: list[dict[str, str]]) -> bool:
    for item in reversed(recent_messages[-4:]):
        content = _normalized(str(item.get("content", "")))
        if any(marker in content for marker in _TASK_MARKERS):
            return True
    return False


def resolve_direct_answer_intent(
    message: str,
    recent_messages: list[dict[str, str]],
    classifier: IntentClassifier | None = None,
) -> DirectAnswerIntent:
    hard_free = is_hard_free_request(message)
    if hard_free is not None:
        return hard_free
    if is_explicit_direct_request(message):
        return DirectAnswerIntent(
            "explicit_direct", True, "deterministic_direct_request", "deterministic"
        )
    normalized = _normalized(message)
    if _matches(normalized, _REFERENTIAL_PATTERNS) and _has_task_antecedent(recent_messages):
        if classifier is not None:
            decision = classifier(message, recent_messages)
            if decision is not None and decision.chargeable:
                return DirectAnswerIntent(
                    "ambiguous_direct", True, "context_resolved_direct_request", "llm"
                )
    return _free_intent("ordinary", "deterministic_free_default")
