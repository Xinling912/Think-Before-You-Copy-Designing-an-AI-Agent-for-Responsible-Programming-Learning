import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest

from scripts.e2e_test_center_smoke import (
    DEFAULT_BASE_URL,
    assert_generated_question,
    assert_no_private_fields,
    assert_topic_overview,
    configured_base_url,
    run_smoke,
)


ROOT = Path(__file__).resolve().parents[2]


def topic_payload() -> dict:
    return {
        "topics": [
            {
                "id": f"topic_{index:02d}",
                "label": f"Topic {index}",
                "summary": f"Summary {index}",
                "icon": f"icon_{index:02d}",
                "score": 0,
                "maximum": 10,
                "percent": 0,
            }
            for index in range(20)
        ]
    }


class _TestCenterHandler(BaseHTTPRequestHandler):
    server: "_TestCenterServer"

    def log_message(self, _format: str, *_args) -> None:
        return

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, body: dict, status: int = 200, cookie: str | None = None) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        self.server.requests.append(("GET", parsed.path, query, None))

        if parsed.path == "/api/participant/status":
            self.send_json({"authenticated": False, "consent_required": True})
            return
        if parsed.path == "/api/health":
            self.send_json({"status": "ok"})
            return
        if parsed.path == "/api/tests/topics":
            if self.headers.get("Cookie") != "rea_participant=test-center-token":
                self.send_json({"error": "consent_required"}, status=401)
                return
            self.server.learners.append(query.get("learner_id", [""])[0])
            self.send_json(topic_payload())
            return
        if parsed.path == "/api/tests/question/question-1":
            self.server.learners.append(query.get("learner_id", [""])[0])
            self.send_json(self.server.question)
            return
        self.send_json({"error": "not_found"}, status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        body = self.read_json()
        self.server.requests.append(("POST", parsed.path, {}, body))

        if parsed.path == "/api/participant/consent":
            self.send_json(
                {"authenticated": True, "consent_required": False},
                cookie="rea_participant=test-center-token; Path=/; Secure; HttpOnly",
            )
            return
        if self.headers.get("Cookie") != "rea_participant=test-center-token":
            self.send_json({"error": "consent_required"}, status=401)
            return
        self.server.learners.append(body.get("learner_id", ""))

        if parsed.path == "/api/tests/question":
            self.server.question = {
                "question_id": "question-1",
                "topic_id": body["topic_id"],
                "level": 1,
                "question_format": "short_answer",
                "question_text": "What name does this assignment bind?\nvalue = 3",
                "options": [],
                "progress": {"score": 0, "maximum": 10, "percent": 0},
            }
            self.send_json(self.server.question)
            return
        if parsed.path == "/api/tests/answer":
            self.server.answer_payloads.append(body)
            duplicate = len(self.server.answer_payloads) > 1
            self.send_json(
                {
                    "attempt_id": "attempt-1",
                    "question_id": "question-1",
                    "is_correct": False,
                    "feedback": "Review assignment before trying again.",
                    "progress": {"score": 0, "maximum": 10, "percent": 0},
                    "duplicate": duplicate,
                }
            )
            return
        self.send_json({"error": "not_found"}, status=404)


class _TestCenterServer(ThreadingHTTPServer):
    requests: list
    learners: list[str]
    answer_payloads: list[dict]
    question: dict


@contextmanager
def fake_test_center():
    server = _TestCenterServer(("127.0.0.1", 0), _TestCenterHandler)
    server.requests = []
    server.learners = []
    server.answer_payloads = []
    server.question = {}
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield server, f"http://{host}:{port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def test_configured_base_url_uses_required_environment_variable_and_default():
    assert configured_base_url({}) == DEFAULT_BASE_URL
    assert configured_base_url({"TEST_CENTER_BASE_URL": "http://example.test:9000/"}) == "http://example.test:9000"


def test_run_smoke_executes_the_complete_public_contract_with_one_uuid_learner():
    with fake_test_center() as (server, base_url):
        run_smoke(base_url)

    assert [(method, path) for method, path, _query, _body in server.requests] == [
        ("GET", "/api/participant/status"),
        ("POST", "/api/participant/consent"),
        ("GET", "/api/health"),
        ("GET", "/api/tests/topics"),
        ("POST", "/api/tests/question"),
        ("GET", "/api/tests/question/question-1"),
        ("POST", "/api/tests/answer"),
        ("POST", "/api/tests/answer"),
        ("GET", "/api/tests/topics"),
    ]
    assert len(set(server.learners)) == 1
    UUID(server.learners[0])
    assert server.answer_payloads == [
        {
            "learner_id": server.learners[0],
            "question_id": "question-1",
            "answer": "I do not know.",
        },
        {
            "learner_id": server.learners[0],
            "question_id": "question-1",
            "answer": "I do not know.",
        },
    ]


@pytest.mark.parametrize(
    "private_key",
    ["expected_answer", "accepted_equivalents", "grading_rubric", "reason"],
)
def test_private_field_scan_rejects_forbidden_keys_at_any_depth(private_key: str):
    with pytest.raises(AssertionError, match=private_key):
        assert_no_private_fields({"public": [{"nested": {private_key: "must not escape"}}]})


def test_topic_overview_requires_twenty_unique_ids_icons_and_zero_scores():
    valid = topic_payload()
    assert len(assert_topic_overview(valid, require_zero_scores=True)) == 20

    duplicate_icon = topic_payload()
    duplicate_icon["topics"][1]["icon"] = duplicate_icon["topics"][0]["icon"]
    with pytest.raises(AssertionError, match="unique icons"):
        assert_topic_overview(duplicate_icon, require_zero_scores=True)

    nonzero_score = topic_payload()
    nonzero_score["topics"][0]["score"] = 1
    with pytest.raises(AssertionError, match="initial score"):
        assert_topic_overview(nonzero_score, require_zero_scores=True)


def test_generated_question_requires_ascii_letters():
    question = {
        "question_id": "question-1",
        "topic_id": "topic_00",
        "question_text": "123 + 456?",
    }

    with pytest.raises(AssertionError, match="question text"):
        assert_generated_question(question, "topic_00")


@pytest.mark.parametrize(
    "character",
    [
        "\u1100",
        "\U00020000",
        "\U0002f800",
        "\U000323b0",
        "\u3042",
        "\u30a2",
        "\uff76",
        "\uac00",
        "\u3131",
        "\uffa1",
    ],
)
def test_generated_question_rejects_all_ai_core_cjk_ranges(character: str):
    question = {
        "question_id": "question-1",
        "topic_id": "topic_00",
        "question_text": f"Question containing {character}",
    }

    with pytest.raises(AssertionError, match="question text"):
        assert_generated_question(question, "topic_00")


def test_check_e2e_runs_both_smokes_in_order_without_adding_them_to_full():
    check_source = (ROOT / "check.sh").read_text(encoding="utf-8")
    e2e_branch = check_source.split('if [[ "${1:-}" == "--e2e" ]]; then', 1)[1].split(
        'elif [[ "${1:-}" == "--eval-baselines" ]]; then', 1
    )[0]
    index_smoke = "python3 scripts/e2e_index_error_smoke.py"
    test_center_smoke = "python3 scripts/e2e_test_center_smoke.py"

    assert index_smoke in e2e_branch
    assert test_center_smoke in e2e_branch
    assert e2e_branch.index(index_smoke) < e2e_branch.index(test_center_smoke)

    full_branch = check_source.split('elif [[ "${1:-}" == "--full" ]]; then', 1)[1].split(
        "\nelse\n", 1
    )[0]
    assert index_smoke not in full_branch
    assert test_center_smoke not in full_branch
