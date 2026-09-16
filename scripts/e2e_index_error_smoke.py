import json
import os
from pathlib import Path
from urllib import request


BASE_URL = os.environ.get("REA_BASE_URL", "http://127.0.0.1:18081").rstrip("/")
REQUEST_TIMEOUT_SECONDS = 45
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHAT_MODEL = "qwen3.7-max"
LEARNING_SOURCE_IDS = {
    "python-official-docs",
    "python-docs-3.14.6",
    "think-python-2e",
    "py4e-html3",
    "runoob-python3",
}


class ParticipantJSONClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.participant_cookie = ""
        self.admin_cookie = ""

    def _request_json(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        cookies = [cookie for cookie in (self.participant_cookie, self.admin_cookie) if cookie]
        if cookies:
            headers["Cookie"] = "; ".join(cookies)
        req = request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )
        with request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            set_cookie = response.headers.get("Set-Cookie", "")
            if set_cookie.startswith("rea_participant="):
                self.participant_cookie = set_cookie.split(";", 1)[0]
            elif set_cookie.startswith("rea_admin="):
                self.admin_cookie = set_cookie.split(";", 1)[0]
            return json.loads(response.read().decode("utf-8"))

    def get_json(self, path: str) -> dict:
        return self._request_json("GET", path)

    def post_json(self, path: str, payload: dict) -> dict:
        return self._request_json("POST", path, payload)

    def ensure_participant(self) -> None:
        status = self.get_json("/api/participant/status")
        if status.get("authenticated"):
            return
        if not status.get("consent_required"):
            raise AssertionError(f"participant status did not authenticate or require consent: {status!r}")
        consent = self.post_json("/api/participant/consent", {"accepted": True})
        if not consent.get("authenticated") or not self.participant_cookie:
            raise AssertionError(f"participant consent did not establish a session: {consent!r}")

    def login_admin(self, password: str) -> None:
        login = self.post_json("/api/admin/login", {"password": password})
        if not login.get("authenticated") or not self.admin_cookie:
            raise AssertionError("admin login did not establish an authenticated session")


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def expected_chat_model(env: dict[str, str] | None = None, env_path: Path | None = None) -> str:
    env = env or os.environ
    configured = str(env.get("DASHSCOPE_CHAT_MODEL") or "").strip()
    if configured:
        return configured

    path = env_path or ROOT / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            if key.strip() == "DASHSCOPE_CHAT_MODEL":
                return value.strip().strip('"').strip("'") or DEFAULT_CHAT_MODEL

    return DEFAULT_CHAT_MODEL


def configured_admin_password(env: dict[str, str] | None = None, env_path: Path | None = None) -> str:
    env = env or os.environ
    configured = str(env.get("STUDY_ADMIN_PASSWORD") or "").strip()
    if configured:
        return configured

    path = env_path or ROOT / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            if key.strip() == "STUDY_ADMIN_PASSWORD":
                return value.strip().strip('"').strip("'")

    raise AssertionError("STUDY_ADMIN_PASSWORD is required for the protected evidence smoke check")


def is_python_official_source(source: dict) -> bool:
    source_id = str(source.get("source") or source.get("source_id") or "")
    source_url = str(source.get("source_url") or source.get("url") or "")
    return source_id in {"python-official-docs", "python-docs-3.14.6"} or source_url.startswith("https://docs.python.org/3/")


def is_grounded_learning_source(source: dict) -> bool:
    source_id = str(source.get("source") or source.get("source_id") or "")
    source_url = str(source.get("source_url") or source.get("url") or "")
    return bool(source_url) and source_id in LEARNING_SOURCE_IDS


def main() -> None:
    client = ParticipantJSONClient(BASE_URL)
    client.ensure_participant()
    session_response = client.post_json("/api/session/start", {"scenario": "index-error"})
    session_id = session_response["session"]["id"]

    step = client.post_json(
        "/api/session/message",
        {
            "session_id": session_id,
            "message": "为什么我的 Python list 报 IndexError？",
            "stage": "start",
        },
    )

    assert_equal(step["skill_id"], "student-learning/retrieve-first-gate", "first skill")
    assert_equal(step["requires_student_attempt"], True, "student attempt gate")
    assert_equal(step["direct_answer_given"], False, "direct answer gate")
    assert_equal(
        step["kg_path"],
        ["Concept:list", "Concept:index", "Concept:zero_based_index", "Concept:valid_index_range", "ErrorType:IndexError"],
        "KG path",
    )
    assert_equal(step["rag_retrieval_mode"], "semantic-vector-rerank", "RAG retrieval mode")
    assert_equal(step["rag_reranker"]["enabled"], True, "RAG reranker")
    assert_equal(step["intent"], "error_debugging", "query intent")
    if "valid index range" not in step["rewritten_query"]:
        raise AssertionError(f"rewritten query must include valid index range, got {step['rewritten_query']!r}")
    assert_equal(step["chat_model"], expected_chat_model(), "chat model")
    assert_equal(step["teaching_strategy"], "retrieve-first-with-evidence", "teaching strategy")
    if not is_grounded_learning_source(step["rag_sources"][0]):
        raise AssertionError(f"RAG source must be a registered learning source, got {step['rag_sources'][0]!r}")
    if step["rag_sources"][0]["chunk_id"] == "python-list-index-001":
        raise AssertionError("RAG must return real Python docs chunk ids, not the legacy mock chunk")
    if step["rag_sources"][0].get("rerank_score", 0) <= 0:
        raise AssertionError("RAG source must include a positive rerank_score")
    assert_equal(step["hint_ladder"][0]["level"], 1, "hint ladder")
    assert_equal(step["evidence"]["cognitive_gate"], "retrieval", "cognitive gate")
    assert_equal(step["evidence"]["teach_back"], "not_required", "teach-back")
    assert_equal(step["evidence"]["rewritten_query"], step["rewritten_query"], "saved query rewrite evidence")

    admin_client = ParticipantJSONClient(BASE_URL)
    admin_client.login_admin(configured_admin_password())
    evidence = admin_client.get_json(f"/api/session/{session_id}/evidence")
    if not evidence["events"]:
        raise AssertionError("evidence API returned no events")
    saved_payload = evidence["events"][0]["payload"]
    assert_equal(saved_payload["skill_id"], "student-learning/retrieve-first-gate", "saved skill evidence")
    assert_equal(saved_payload["direct_answer_given"], False, "saved direct answer gate")
    assert_equal(saved_payload["rewritten_query"], step["rewritten_query"], "saved rewritten query")

    print("IndexError E2E smoke passed.")


if __name__ == "__main__":
    main()
