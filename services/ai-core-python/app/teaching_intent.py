from __future__ import annotations

import re
from typing import Literal

from app.direct_answer_intent import resolve_direct_answer_intent


DirectAnswerTeachingSignal = Literal[
    "negated",
    "meta_or_quoted",
    "positive",
    "absent",
]


_NEGATED_DIRECT_ANSWER_PATTERNS = (
    re.compile(
        r"(?:不要|别|不用|不必|无需|请勿|不需要)(?:再)?(?:直接)?"
        r"(?:给|告诉|提供|公布|说出|写出|展示)?(?:我)?"
        r"(?:最终|最后|完整|全部|标准|现成)?的?"
        r"(?:答案|结论|解法|代码)"
    ),
    re.compile(
        r"(?:只|仅)(?:给|告诉|提供)?(?:我)?(?:一些|点|一点)?"
        r"(?:提示|线索|思路|方向)"
    ),
    re.compile(
        r"(?:do not|don't|dont|please don't|please do not|no|without)\s+"
        r"(?:(?:give|provide|tell|show|reveal)\s+(?:me\s+)?)?"
        r"(?:the\s+)?(?:direct|final|full|complete)?\s*"
        r"(?:answer|solution|code)\b"
    ),
    re.compile(r"\b(?:hint|hints)\s+only\b|\bonly\s+(?:give\s+me\s+)?(?:a\s+)?(?:hint|hints)\b"),
)

_META_MEANING_PATTERNS = (
    re.compile(
        r"(?:什么是|是什么意思|指什么|如何定义).{0,16}(?:直接给答案|完整答案|最终答案|代写)|"
        r"\bwhat\s+(?:does|is)\b.{0,24}\b(?:direct|final|full|complete)\s+answer\b"
    ),
)

_COMPLETION_CONTENT_PATTERNS = (
    re.compile(
        r"(?:帮(?:我|学生))?(?:把|将).{0,20}"
        r"(?:函数|代码|程序|脚本|作业|题目)"
        r".{0,16}(?:写完|补全|完成|做完)"
    ),
    re.compile(
        r"(?:帮(?:我|学生))?(?:写完|补全|完成|做完).{0,32}"
        r"(?:函数|代码|程序|脚本|作业|题目)"
    ),
    re.compile(
        r"(?:help\s+(?:me|students?)\s+)?(?:finish|complete)\b.{0,32}"
        r"\b(?:code|function|program|script|assignment|solution)\b"
    ),
)

_DESCRIPTIVE_COMPLETION_PATTERNS = (
    re.compile(
        r"(?:我)?已经.{0,8}(?:写完|补全|完成|做完).{0,32}"
        r"(?:函数|代码|程序|脚本|作业|题目)"
    ),
    re.compile(
        r"(?:写完|补全|完成|做完).{0,20}"
        r"(?:函数|代码|程序|脚本|作业|题目)后"
    ),
)

_NEGATION_WRAPPER_PREFIX = re.compile(
    r"(?:不要|别|不用|不必|无需|请勿|不需要)(?:再)?(?:帮我)?\s*$|"
    r"(?:i\s+)?(?:do\s+not|don't|dont)(?:\s+want\s+(?:you|the\s+tutor)\s+to)?\s*$"
)

_CAPABILITY_FRAME_PATTERNS = (
    re.compile(r"(?:你|老师|系统|助手)?(?:会|能|可以|是否会|能不能|可不可以)"),
    re.compile(
        r"\b(?:are\s+you\s+able\s+to|can\s+you|could\s+you|will\s+you|would\s+you|"
        r"can\s+the\s+tutor|could\s+the\s+tutor|would\s+the\s+tutor)\b"
    ),
)

_CONDITIONAL_FRAME_PATTERN = re.compile(
    r"^(?:如果|假如|要是)|^\s*\b(?:if|when|after|once)\b"
)

_POSITIVE_COMPLETION_REQUEST_PATTERNS = (
    re.compile(
        r"(?:请|麻烦)(?:帮我)?.{0,12}(?:写完|补全|完成|做完)"
        r".{0,32}(?:函数|代码|程序|脚本|作业|题目)"
    ),
    re.compile(
        r"帮我(?:写完|补全|完成|做完).{0,32}"
        r"(?:函数|代码|程序|脚本|作业|题目)"
    ),
    re.compile(
        r"(?:把|将).{0,40}(?:函数|代码|程序|脚本|作业|题目)"
        r".{0,16}(?:写完|补全|完成|做完)给我"
    ),
    re.compile(
        r"(?:写完|补全|完成|做完).{0,40}"
        r"(?:函数|代码|程序|脚本|作业|题目).{0,12}给我"
    ),
    re.compile(
        r"(?:^|[，,;；]\s*)(?:please\s+)?(?:finish|complete)\b.{0,32}"
        r"\b(?:code|function|program|script|assignment|solution)\b"
        r"(?:.{0,16}\bfor\s+me\b)?[.!]?$"
    ),
    re.compile(
        r"\bhelp\s+me\s+(?:finish|complete)\b.{0,32}"
        r"\b(?:code|function|program|script|assignment|solution)\b"
    ),
)

_POSITIVE_DIRECT_ANSWER_PATTERNS = (
    re.compile(
        r"(?:请|麻烦|现在|就|只|赶紧)*\s*直接"
        r"(?:给|告诉|提供|公布|说出|写出|展示)(?:我)?"
        r"(?:最终|最后|完整|全部|标准|现成)?的?"
        r"(?:答案|结论|解法|代码)"
    ),
    re.compile(
        r"(?:请|麻烦|现在|就|只|赶紧)*\s*"
        r"(?:给|告诉|提供|公布|说出|写出|展示)(?:我)?"
        r"(?:最终|最后|完整|全部|标准|现成)的?"
        r"(?:答案|结论|解法|代码)"
    ),
    re.compile(
        r"(?:请|麻烦|现在|就|只|赶紧)*\s*"
        r"(?:给|告诉|提供|公布|说出|写出|展示)(?:我)?"
        r"(?:答案|结论|解法|代码)(?:吧|即可|就行|[。！!])?$"
    ),
    re.compile(r"(?:帮我)?代写"),
    re.compile(
        r"\b(?:just\s+|please\s+|simply\s+)?"
        r"(?:give|provide|tell|show|reveal)\s+(?:me\s+)?(?:the\s+)?"
        r"(?:direct|final|full|complete)\s+(?:answer|solution|code)\b"
    ),
    re.compile(
        r"\b(?:write|solve|do)\b.{0,12}\b(?:the\s+)?(?:full|complete|entire)\b"
        r".{0,20}\b(?:code|function|program|assignment|answer|solution)\b"
    ),
)

_QUOTED_TEXT_PATTERNS = (
    re.compile(r'"([^"\n]+)"'),
    re.compile(r"(?<![A-Za-z])'([^'\n]+)'(?![A-Za-z])"),
    re.compile(r"“([^”\n]+)”"),
    re.compile(r"‘([^’\n]+)’"),
    re.compile(r"「([^」\n]+)」"),
    re.compile(r"『([^』\n]+)』"),
)

_DIRECT_ANSWER_WORDING = re.compile(
    r"(?:直接给答案|完整答案|最终答案|最后答案|完整代码|代写)|"
    r"\b(?:direct|final|full|complete)\s+(?:answer|answers|solution|solutions|code)\b"
)


def _contains_quoted_direct_answer_wording(message: str) -> bool:
    return any(
        _contains_request_content(match.group(1))
        for pattern in _QUOTED_TEXT_PATTERNS
        for match in pattern.finditer(message)
    )


def _contains_positive_direct_answer_request(message: str) -> bool:
    return any(
        pattern.search(message)
        for pattern in (
            *_POSITIVE_DIRECT_ANSWER_PATTERNS,
            *_POSITIVE_COMPLETION_REQUEST_PATTERNS,
        )
    )


def _request_content_matches(message: str) -> list[re.Match[str]]:
    matches = [
        match
        for pattern in (
            *_POSITIVE_DIRECT_ANSWER_PATTERNS,
            *_COMPLETION_CONTENT_PATTERNS,
        )
        for match in pattern.finditer(message)
    ]
    matches.extend(_DIRECT_ANSWER_WORDING.finditer(message))
    return sorted(matches, key=lambda match: match.start())


def _contains_request_content(message: str) -> bool:
    return bool(_request_content_matches(message))


def _has_negation_wrapper(message: str, matches: list[re.Match[str]]) -> bool:
    return any(
        _NEGATION_WRAPPER_PREFIX.search(message[: match.start()])
        for match in matches
    )


def _has_capability_wrapper(message: str, matches: list[re.Match[str]]) -> bool:
    if not re.search(r"(?:吗|么|？|\?)\s*$", message):
        return False
    first_request = matches[0].start() if matches else len(message)
    return any(
        (frame := pattern.search(message)) is not None
        and frame.start() < first_request
        for pattern in _CAPABILITY_FRAME_PATTERNS
    )


def _has_conditional_wrapper(message: str, matches: list[re.Match[str]]) -> bool:
    frame = _CONDITIONAL_FRAME_PATTERN.search(message)
    if frame is None or not matches:
        return False
    separator = re.search(r"[，,;；]", message[frame.end() :])
    antecedent_end = (
        frame.end() + separator.start()
        if separator is not None
        else len(message)
    )
    return all(match.start() < antecedent_end for match in matches)


def classify_direct_answer_teaching_signal(
    message: str,
) -> DirectAnswerTeachingSignal:
    """Classify direct-answer wording without making a broader turn decision."""
    intent = resolve_direct_answer_intent(message, [], None)
    if intent.classification == "negated":
        return "negated"
    if intent.classification == "meta_or_quoted":
        return "meta_or_quoted"
    if intent.classification == "explicit_direct":
        return "positive"
    return "absent"
