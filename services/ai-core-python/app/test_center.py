from __future__ import annotations

import json
import re
from typing import Any

from app.dashscope import DashScopeChatProvider
from app.kg_grounding import ground_question
from app.schemas import (
    GeneratedTestQuestion,
    TestJudgeRequest,
    TestJudgeResponse,
    TestJudgment,
    TestQuestionGenerateRequest,
    TestQuestionGenerationResponse,
)
from app.structured_output import StructuredValidationError, request_validated_json_with_one_repair


QUESTION_FORMAT_BY_LEVEL = {
    1: "multiple_choice",
    2: "terminology",
    3: "syntax",
    4: "code_reading",
    5: "output_prediction",
    6: "fill_blank",
    7: "scenario",
    8: "debugging",
    9: "correction",
    10: "transfer",
}

FENCED_CODE_LINE_MAXIMUMS = {
    1: 0,
    2: 0,
    3: 1,
    4: 2,
    5: 3,
    6: 3,
    8: 4,
    9: 5,
    10: 5,
}

_CJK_PATTERN = re.compile(
    "["
    "\u1100-\u11ff"
    "\u3040-\u30ff"
    "\u3130-\u318f"
    "\u31f0-\u31ff"
    "\u3400-\u4dbf"
    "\u4e00-\u9fff"
    "\ua960-\ua97f"
    "\uac00-\ud7af"
    "\ud7b0-\ud7ff"
    "\uf900-\ufaff"
    "\uff66-\uff9d"
    "\uffa0-\uffdc"
    "\U0001aff0-\U0001afff"
    "\U0001b000-\U0001b16f"
    "\U00020000-\U0002ee5f"
    "\U0002f800-\U0002fa1f"
    "\U00030000-\U000323af"
    "\U000323b0-\U0003347f"
    "]",
)
_OPTION_REFERENCE_PATTERN = re.compile(
    r"(?i)(?:\b(?:option|choice|answer)\s*[A-D]\b|\b[A-D]\s+(?:is|was)\s+correct\b|"
    r"\b(?:first|second|third|fourth)\s+(?:option|choice|answer)\b)",
)
_ASCII_LETTER_PATTERN = re.compile(r"[A-Za-z]")
_FENCED_CODE_PATTERN = re.compile(r"```[^\n`]*\n?(.*?)```", flags=re.DOTALL)
_OPEN_RESPONSE_OPTION_LINE_PATTERN = re.compile(
    r"(?m)^\s*(?:[1-9][.)]|[A-D][.)])\s+\S+",
)
_ASCII_WORD_PATTERN = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_PRIVACY_TOKEN_PATTERN = re.compile(
    r"==|!=|<=|>=|:=|\*\*|//|->|\[\]|\{\}|\(\)|[A-Za-z0-9_]+|[+\-*/%<>=]",
)

# This is deliberately a high-confidence marker list rather than a general
# dictionary. Two markers are required, so Python identifiers and isolated
# borrowed words remain valid while obvious Latin-script non-English prose is
# rejected deterministically without another model call or dependency.
_NON_ENGLISH_PROSE_MARKERS = frozenset(
    {
        # French
        "affectation",
        "affiche",
        "affichera",
        "ajoute",
        "ajouter",
        "alors",
        "avec",
        "boucle",
        "boucles",
        "chaine",
        "ce",
        "cette",
        "dans",
        "de",
        "des",
        "doit",
        "est",
        "fait",
        "faux",
        "fonction",
        "imprime",
        "laquelle",
        "le",
        "lequel",
        "liste",
        "nombre",
        "nombres",
        "pour",
        "pourquoi",
        "que",
        "quel",
        "quelle",
        "quelles",
        "renvoie",
        "reponse",
        "resultat",
        "retourne",
        "sans",
        "sinon",
        "sont",
        "sortie",
        "supprime",
        "une",
        "utilise",
        "utiliser",
        "valeur",
        "valeurs",
        "vrai",
        # Spanish, Portuguese, Italian, and German high-confidence basics
        "ausgabe",
        "ciclo",
        "cual",
        "cuales",
        "dieser",
        "druckt",
        "funcao",
        "imprimir",
        "laco",
        "quale",
        "saida",
        "schleife",
        "stampa",
        "usar",
        "valore",
        "verdadero",
        "welche",
        "wahr",
    },
)

_PRIVACY_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "that",
        "the",
        "this",
        "to",
        "was",
        "with",
    },
)
_EXPLICIT_ANSWER_CUES = (
    ("accepted", "answer"),
    ("accepted", "equivalent"),
    ("accepted", "response"),
    ("complete", "answer"),
    ("correct", "answer"),
    ("expected", "answer"),
    ("right", "answer"),
)


def build_test_grounding(request: TestQuestionGenerateRequest) -> dict[str, Any]:
    selected = request.selected_topic
    raw_grounding = ground_question(
        f"{selected.label}\n{selected.summary}",
        chat_provider=None,
    )
    return {
        "selected_node_ids": list(raw_grounding.get("selected_node_ids") or []),
        "path": list(raw_grounding.get("path") or []),
        "path_edges": list(raw_grounding.get("path_edges") or []),
        "curriculum_path": list(raw_grounding.get("curriculum_path") or []),
        "kg_gap": bool(raw_grounding.get("kg_gap", False)),
    }


def build_question_messages(
    request: TestQuestionGenerateRequest,
    kg_grounding: dict[str, Any],
) -> list[dict[str, str]]:
    catalog_json = _compact_json([topic.model_dump(mode="json") for topic in request.catalog])
    selected_json = _compact_json(request.selected_topic.model_dump(mode="json"))
    recent_json = _compact_json(list(request.recent_questions[-10:]))
    grounding_json = _compact_json(kg_grounding)
    expected_format = QUESTION_FORMAT_BY_LEVEL[request.level]
    return [
        {
            "role": "system",
            "content": (
                "Generate exactly one dynamic Python assessment question as one JSON object. "
                "Use English only for learner-visible question text and options. "
                "Keep the content suitable for a complete Python beginner. "
                "Do not copy or invent a fixed question bank."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Complete catalog JSON: {catalog_json}\n"
                f"Selected topic JSON: {selected_json}\n"
                f"Selected topic summary: {request.selected_topic.summary}\n"
                f"Current progress: {request.current_progress}\n"
                f"Level: {request.level}\n"
                f"Required question format: {expected_format}\n"
                f"Exact difficulty prompt: {request.difficulty_prompt}\n"
                f"Recent questions JSON (avoid normalized duplicates): {recent_json}\n"
                f"KG grounding JSON: {grounding_json}\n"
                "Return only JSON with topic_id, level, question_format, question_text, options, "
                "expected_answer, accepted_equivalents, grading_rubric, and beginner_difficulty. "
                "Only level 1 may contain options and it must contain exactly four options. "
                "For levels 2 through 10, options must be an empty JSON array. "
                "grading_rubric must be a JSON array of concise strings only; do not use objects, "
                "scores, keys, or nested arrays for rubric entries. "
                "Set beginner_difficulty to true. Every nonempty learner-visible field must contain "
                "an ASCII letter and must contain no CJK characters."
            ),
        },
    ]


def _normalize_rubric_entry(entry: Any) -> Any:
    if not isinstance(entry, dict):
        return entry

    for field in ("criterion", "description", "rule", "text", "rubric"):
        value = entry.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return entry


def _normalize_generated_question_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    rubric = normalized.get("grading_rubric")
    if isinstance(rubric, list):
        normalized["grading_rubric"] = [_normalize_rubric_entry(entry) for entry in rubric]
    return normalized


def validate_generated_question(
    payload: dict[str, Any],
    request: TestQuestionGenerateRequest,
) -> GeneratedTestQuestion:
    question = GeneratedTestQuestion.model_validate(_normalize_generated_question_payload(payload))
    errors: list[str] = []
    expected_format = QUESTION_FORMAT_BY_LEVEL[request.level]

    if question.topic_id != request.selected_topic.id:
        errors.append("topic_id must equal selected_topic.id")
    if question.level != request.level:
        errors.append("level must equal the requested level")
    if question.question_format != expected_format:
        errors.append(f"question_format must equal {expected_format} for level {request.level}")

    errors.extend(_learner_visible_text_errors("question_text", question.question_text))
    for index, option in enumerate(question.options):
        errors.extend(_learner_visible_text_errors(f"options[{index}]", option))

    normalized_question = _normalize_text(question.question_text)
    normalized_recent = {_normalize_text(recent) for recent in request.recent_questions}
    if normalized_question in normalized_recent:
        errors.append("question_text duplicates a recent question")

    maximum_code_lines = FENCED_CODE_LINE_MAXIMUMS.get(request.level)
    if maximum_code_lines is not None:
        fenced_code_lines = sum(
            _count_fenced_code_lines(value)
            for value in (question.question_text, *question.options)
        )
        if fenced_code_lines > maximum_code_lines:
            errors.append(
                f"level {request.level} allows at most {maximum_code_lines} fenced code lines",
            )

    if request.level == 1:
        distinct_options = {_normalize_text(option) for option in question.options}
        if len(question.options) != 4 or len(distinct_options) != 4:
            errors.append("level 1 requires exactly four distinct options")
    else:
        if question.options:
            errors.append(f"level {request.level} must not include options")
        if _contains_enumerated_answer_choices(question.question_text):
            errors.append("levels 2 through 10 must not contain enumerated answer choices")

    if question.beginner_difficulty is not True:
        errors.append("beginner_difficulty must be true")

    if errors:
        raise StructuredValidationError(errors)
    return question


def generate_test_question(
    request: TestQuestionGenerateRequest,
    *,
    chat_provider: Any | None = None,
) -> TestQuestionGenerationResponse:
    provider = chat_provider or DashScopeChatProvider()
    kg_grounding = build_test_grounding(request)
    result = request_validated_json_with_one_repair(
        chat_provider=provider,
        messages=build_question_messages(request, kg_grounding),
        validator=lambda payload: validate_generated_question(payload, request),
        failure_code="generation_failed",
        temperature=0.35,
        max_tokens=1200,
    )
    return TestQuestionGenerationResponse(
        **result.value.model_dump(mode="json"),
        kg_grounding=kg_grounding,
        provider=result.provider,
        model=result.model,
        token_usage=result.token_usage,
    )


def build_judge_messages(request: TestJudgeRequest) -> list[dict[str, str]]:
    private_question_json = _compact_json(request.model_dump(mode="json", exclude={"student_answer"}))
    student_answer_json = _compact_json(request.student_answer)
    return [
        {
            "role": "system",
            "content": (
                "Grade one persisted private Python test question. Return exactly one JSON object with "
                "is_correct, score, reason, and feedback. Give concise English feedback containing an "
                "ASCII letter and no CJK characters. Do not reveal the complete expected answer or an "
                "accepted equivalent when the student is incorrect. For multiple-choice questions, never "
                "refer to A/B/C/D or an option position; describe the learner's submitted text or concept."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Persisted private question JSON: {private_question_json}\n"
                f"Student answer JSON: {student_answer_json}\n"
                "Use the expected_answer, accepted_equivalents, and grading_rubric exactly as private grading evidence."
            ),
        },
    ]


def validate_test_judgment(payload: dict[str, Any], request: TestJudgeRequest) -> TestJudgment:
    judgment = TestJudgment.model_validate(payload)
    errors = _learner_visible_text_errors("feedback", judgment.feedback)
    if request.question_format == "multiple_choice" and _OPTION_REFERENCE_PATTERN.search(judgment.feedback):
        errors.append(
            "multiple-choice feedback must describe the submitted answer without option letters or positions",
        )
    if not judgment.is_correct:
        private_answers = (request.expected_answer, *request.accepted_equivalents)
        for field, value in (("reason", judgment.reason), ("feedback", judgment.feedback)):
            if any(_reveals_private_answer(value, answer) for answer in private_answers):
                errors.append(
                    f"incorrect {field} must not reveal the complete expected answer or an accepted equivalent",
                )
    if errors:
        raise StructuredValidationError(errors)
    return judgment


def judge_test_answer(
    request: TestJudgeRequest,
    *,
    chat_provider: Any | None = None,
) -> TestJudgeResponse:
    provider = chat_provider or DashScopeChatProvider()
    result = request_validated_json_with_one_repair(
        chat_provider=provider,
        messages=build_judge_messages(request),
        validator=lambda payload: validate_test_judgment(payload, request),
        failure_code="judging_failed",
        temperature=0.0,
        max_tokens=600,
    )
    return TestJudgeResponse(
        **result.value.model_dump(mode="json"),
        provider=result.provider,
        model=result.model,
        token_usage=result.token_usage,
    )


def _learner_visible_text_errors(field: str, value: str) -> list[str]:
    errors = []
    contains_cjk = _CJK_PATTERN.search(value) is not None
    if contains_cjk:
        errors.append(f"{field} must not contain CJK characters")
    if not _ASCII_LETTER_PATTERN.search(value):
        errors.append(f"{field} must contain an ASCII letter")
    elif not contains_cjk and _is_likely_non_english_prose(value):
        errors.append(f"{field} must be English")
    return errors


def _contains_enumerated_answer_choices(question_text: str) -> bool:
    visible_text = _FENCED_CODE_PATTERN.sub("", question_text)
    return len(_OPEN_RESPONSE_OPTION_LINE_PATTERN.findall(visible_text)) >= 2


def _is_likely_non_english_prose(value: str) -> bool:
    if any(character.isalpha() and not character.isascii() for character in value):
        return True
    words = [match.group(0).casefold() for match in _ASCII_WORD_PATTERN.finditer(value)]
    marker_count = sum(word in _NON_ENGLISH_PROSE_MARKERS for word in words)
    return marker_count >= 2


def _reveals_private_answer(candidate: str, private_answer: str) -> bool:
    candidate_tokens = _privacy_tokens(candidate)
    answer_tokens = _privacy_tokens(private_answer)
    if not candidate_tokens or not answer_tokens:
        return False

    answer_is_tiny_generic = (
        len(answer_tokens) == 1
        and answer_tokens[0].isalpha()
        and (len(answer_tokens[0]) < 4 or answer_tokens[0] in _PRIVACY_STOPWORDS)
    )
    exact_answer_embedded = _contains_token_sequence(candidate_tokens, answer_tokens)
    if exact_answer_embedded and not answer_is_tiny_generic:
        return True
    if answer_is_tiny_generic:
        return exact_answer_embedded and any(
            _contains_token_sequence(candidate_tokens, cue)
            for cue in _EXPLICIT_ANSWER_CUES
        )

    answer_content = {token for token in answer_tokens if token not in _PRIVACY_STOPWORDS}
    candidate_content = set(candidate_tokens)
    if len(answer_content) < 2:
        return False
    shared_content = answer_content & candidate_content
    return len(shared_content) >= 2 and len(shared_content) / len(answer_content) >= 0.8


def _privacy_tokens(value: str) -> tuple[str, ...]:
    return tuple(match.group(0).casefold() for match in _PRIVACY_TOKEN_PATTERN.finditer(value))


def _contains_token_sequence(haystack: tuple[str, ...], needle: tuple[str, ...]) -> bool:
    if len(needle) > len(haystack):
        return False
    return any(
        haystack[index : index + len(needle)] == needle
        for index in range(len(haystack) - len(needle) + 1)
    )


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).casefold()


def _count_fenced_code_lines(value: str) -> int:
    line_count = 0
    for block in _FENCED_CODE_PATTERN.findall(value):
        stripped = block.strip("\n")
        if stripped:
            line_count += len(stripped.splitlines())
    return line_count


def _compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
