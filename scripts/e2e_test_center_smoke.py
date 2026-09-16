import json
import os
import re
from collections.abc import Mapping
from urllib import parse, request
from uuid import uuid4

try:
    from scripts.e2e_index_error_smoke import ParticipantJSONClient
except ModuleNotFoundError:
    from e2e_index_error_smoke import ParticipantJSONClient


DEFAULT_BASE_URL = "http://127.0.0.1:18081"
REQUEST_TIMEOUT_SECONDS = 180
PRIVATE_TEST_FIELDS = frozenset(
    {"expected_answer", "accepted_equivalents", "grading_rubric", "reason"}
)
ASCII_LETTER_PATTERN = re.compile(r"[A-Za-z]")
CJK_PATTERN = re.compile(
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


def configured_base_url(env: Mapping[str, str] | None = None) -> str:
    source = os.environ if env is None else env
    configured = str(source.get("TEST_CENTER_BASE_URL") or DEFAULT_BASE_URL).strip()
    return configured.rstrip("/")


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_no_private_fields(value, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in PRIVATE_TEST_FIELDS:
                raise AssertionError(f"public JSON leaked private field {key!r} at {path}")
            assert_no_private_fields(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            assert_no_private_fields(nested, f"{path}[{index}]")


def request_json(
    base_url: str,
    method: str,
    path: str,
    payload: dict | None = None,
    participant_cookie: str = "",
) -> dict:
    encoded = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        encoded = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if participant_cookie:
        headers["Cookie"] = participant_cookie

    http_request = request.Request(
        base_url + path,
        data=encoded,
        headers=headers,
        method=method,
    )
    with request.urlopen(http_request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        status = response.status
        body = json.loads(response.read().decode("utf-8"))

    assert_equal(status, 200, f"{method} {path} status")
    if not isinstance(body, dict):
        raise AssertionError(f"{method} {path} must return a JSON object, got {type(body).__name__}")
    assert_no_private_fields(body)
    return body


def assert_topic_overview(body: dict, require_zero_scores: bool) -> list[dict]:
    topics = body.get("topics")
    if not isinstance(topics, list):
        raise AssertionError("topic overview must contain a topics list")
    assert_equal(len(topics), 20, "topic count")
    if not all(isinstance(topic, dict) for topic in topics):
        raise AssertionError("every topic must be a JSON object")

    topic_ids = [topic.get("id") for topic in topics]
    icons = [topic.get("icon") for topic in topics]
    if not all(isinstance(topic_id, str) and topic_id for topic_id in topic_ids):
        raise AssertionError("all topic IDs must be non-empty strings")
    if not all(isinstance(icon, str) and icon for icon in icons):
        raise AssertionError("all topic icons must be non-empty strings")
    assert_equal(len(set(topic_ids)), 20, "unique topic IDs")
    assert_equal(len(set(icons)), 20, "unique icons")

    if require_zero_scores:
        for topic in topics:
            score = topic.get("score")
            if isinstance(score, bool) or not isinstance(score, int) or score != 0:
                raise AssertionError(
                    f"initial score for topic {topic.get('id')!r}: expected 0, got {score!r}"
                )
    return topics


def assert_generated_question(question: dict, topic_id: str) -> tuple[str, str]:
    question_id = question.get("question_id")
    question_text = question.get("question_text")
    if not isinstance(question_id, str) or not question_id:
        raise AssertionError(f"question ID must be a non-empty string, got {question_id!r}")
    assert_equal(question.get("topic_id"), topic_id, "generated question topic")
    if not isinstance(question_text, str) or not ASCII_LETTER_PATTERN.search(question_text):
        raise AssertionError("question text must contain ASCII English letters")
    if CJK_PATTERN.search(question_text):
        raise AssertionError("question text must not contain CJK characters")
    return question_id, question_text


def assert_zero_progress(body: dict, label: str) -> None:
    progress = body.get("progress")
    if not isinstance(progress, dict):
        raise AssertionError(f"{label} must contain a progress object")
    score = progress.get("score")
    if isinstance(score, bool) or not isinstance(score, int) or score != 0:
        raise AssertionError(f"{label} progress score: expected 0, got {score!r}")


def run_smoke(base_url: str | None = None) -> None:
    resolved_base_url = (base_url or configured_base_url()).rstrip("/")
    learner_id = str(uuid4())
    participant_client = ParticipantJSONClient(resolved_base_url)
    participant_client.ensure_participant()
    participant_cookie = participant_client.participant_cookie

    request_json(resolved_base_url, "GET", "/api/health", participant_cookie=participant_cookie)

    topics_path = "/api/tests/topics?" + parse.urlencode({"learner_id": learner_id})
    initial_overview = request_json(
        resolved_base_url,
        "GET",
        topics_path,
        participant_cookie=participant_cookie,
    )
    topics = assert_topic_overview(initial_overview, require_zero_scores=True)
    topic_id = topics[0]["id"]

    question = request_json(
        resolved_base_url,
        "POST",
        "/api/tests/question",
        {"learner_id": learner_id, "topic_id": topic_id},
        participant_cookie,
    )
    question_id, question_text = assert_generated_question(question, topic_id)

    reload_path = "/api/tests/question/" + parse.quote(question_id, safe="") + "?" + parse.urlencode(
        {"learner_id": learner_id}
    )
    reloaded = request_json(
        resolved_base_url,
        "GET",
        reload_path,
        participant_cookie=participant_cookie,
    )
    assert_equal(reloaded.get("question_id"), question_id, "reloaded question ID")
    assert_equal(reloaded.get("question_text"), question_text, "reloaded question text")

    answer_payload = {
        "learner_id": learner_id,
        "question_id": question_id,
        "answer": "I do not know.",
    }
    first_answer = request_json(
        resolved_base_url,
        "POST",
        "/api/tests/answer",
        answer_payload,
        participant_cookie,
    )
    assert_equal(first_answer.get("question_id"), question_id, "graded question ID")
    assert_equal(first_answer.get("is_correct"), False, "invalid beginner answer judgment")
    assert_equal(first_answer.get("duplicate"), False, "first answer duplicate flag")
    assert_zero_progress(first_answer, "first answer")
    attempt_id = first_answer.get("attempt_id")
    if not isinstance(attempt_id, str) or not attempt_id:
        raise AssertionError(f"attempt ID must be a non-empty string, got {attempt_id!r}")

    duplicate_answer = request_json(
        resolved_base_url,
        "POST",
        "/api/tests/answer",
        answer_payload,
        participant_cookie,
    )
    assert_equal(duplicate_answer.get("attempt_id"), attempt_id, "duplicate attempt ID")
    assert_equal(duplicate_answer.get("is_correct"), False, "duplicate answer judgment")
    assert_equal(duplicate_answer.get("duplicate"), True, "duplicate answer flag")
    assert_zero_progress(duplicate_answer, "duplicate answer")

    final_overview = request_json(
        resolved_base_url,
        "GET",
        topics_path,
        participant_cookie=participant_cookie,
    )
    assert_topic_overview(final_overview, require_zero_scores=False)


def main() -> None:
    run_smoke()
    print("AI Test Center E2E smoke passed.")


if __name__ == "__main__":
    main()
