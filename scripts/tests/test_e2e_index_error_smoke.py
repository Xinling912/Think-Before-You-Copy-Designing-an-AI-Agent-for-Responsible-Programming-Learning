import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scripts.e2e_index_error_smoke import (
    ParticipantJSONClient,
    expected_chat_model,
    is_grounded_learning_source,
    is_python_official_source,
)


class _StudyParticipantHandler(BaseHTTPRequestHandler):
    session_cookie = ""
    evidence_cookie = ""

    def log_message(self, format: str, *args: object) -> None:
        pass

    def _json(self, status: int, body: dict, cookie: str | None = None) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path == "/api/participant/status":
            self._json(200, {"authenticated": False, "consent_required": True})
            return
        assert self.path == "/api/session/session-study-smoke/evidence"
        type(self).evidence_cookie = self.headers.get("Cookie", "")
        if type(self).evidence_cookie != "rea_admin=admin-token":
            self._json(401, {"error": "admin_authentication_required"})
            return
        self._json(200, {"events": [{"payload": {"skill_id": "retrieve-first"}}]})

    def do_POST(self) -> None:
        if self.path == "/api/participant/consent":
            self._json(
                200,
                {"authenticated": True, "consent_required": False},
                "rea_participant=study-token; Path=/; Secure; HttpOnly; SameSite=Lax",
            )
            return
        if self.path == "/api/admin/login":
            self._json(
                200,
                {"authenticated": True},
                "rea_admin=admin-token; Path=/; Secure; HttpOnly; SameSite=Strict",
            )
            return
        assert self.path == "/api/session/start"
        type(self).session_cookie = self.headers.get("Cookie", "")
        if type(self).session_cookie != "rea_participant=study-token":
            self._json(401, {"error": "consent_required"})
            return
        self._json(200, {"session": {"id": "session-study-smoke"}})


def test_participant_client_consents_and_sends_secure_cookie_over_local_http() -> None:
    _StudyParticipantHandler.session_cookie = ""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StudyParticipantHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = ParticipantJSONClient(f"http://127.0.0.1:{server.server_port}")
        client.ensure_participant()
        response = client.post_json("/api/session/start", {"scenario": "index-error"})
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert response["session"]["id"] == "session-study-smoke"
    assert _StudyParticipantHandler.session_cookie == "rea_participant=study-token"


def test_participant_client_logs_in_as_admin_for_protected_evidence() -> None:
    _StudyParticipantHandler.evidence_cookie = ""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StudyParticipantHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = ParticipantJSONClient(f"http://127.0.0.1:{server.server_port}")
        client.login_admin("admin-test-password")
        response = client.get_json("/api/session/session-study-smoke/evidence")
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert response["events"][0]["payload"]["skill_id"] == "retrieve-first"
    assert _StudyParticipantHandler.evidence_cookie == "rea_admin=admin-token"


def test_expected_chat_model_prefers_environment_variable(tmp_path: Path):
    env_path = tmp_path / ".env"
    env_path.write_text("DASHSCOPE_CHAT_MODEL=qwen-max\n", encoding="utf-8")

    assert expected_chat_model({"DASHSCOPE_CHAT_MODEL": "qwen3.7-max"}, env_path) == "qwen3.7-max"


def test_expected_chat_model_reads_local_env_file(tmp_path: Path):
    env_path = tmp_path / ".env"
    env_path.write_text("DASHSCOPE_CHAT_MODEL=qwen-max\n", encoding="utf-8")

    assert expected_chat_model({}, env_path) == "qwen-max"


def test_expected_chat_model_defaults_to_documented_model(tmp_path: Path):
    assert expected_chat_model({}, tmp_path / ".env") == "qwen3.7-max"


def test_python_official_source_accepts_current_source_id_and_docs_url():
    assert is_python_official_source({"source": "python-docs-3.14.6"})
    assert is_python_official_source({"source_url": "https://docs.python.org/3/tutorial/datastructures.html"})


def test_python_official_source_rejects_non_official_source():
    assert not is_python_official_source({"source": "runoob-python3", "source_url": "https://www.runoob.com/python3/"})


def test_grounded_learning_source_accepts_registered_corpus_sources():
    assert is_grounded_learning_source({"source": "think-python-2e", "source_url": "https://greenteapress.com/thinkpython2/html/thinkpython2009.html"})
    assert is_grounded_learning_source({"source_id": "py4e-html3", "source_url": "https://www.py4e.com/html3/08-lists"})


def test_grounded_learning_source_rejects_missing_url_or_unknown_source():
    assert not is_grounded_learning_source({"source": "think-python-2e"})
    assert not is_grounded_learning_source({"source": "unknown", "source_url": "https://example.test"})
