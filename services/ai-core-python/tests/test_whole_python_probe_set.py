from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

import pytest


SERVICE_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = SERVICE_ROOT / "app"
TESTS_ROOT = Path(__file__).resolve().parent

for import_root in (SERVICE_ROOT, TESTS_ROOT):
    import_root_text = str(import_root)
    if import_root_text not in sys.path:
        sys.path.insert(0, import_root_text)

from app import session
from app.query_understanding import QueryUnderstandingResult, understand_query
from probe_set import PROBE_QUESTIONS


class FakeChatProvider:
    provider = "test"
    model = "probe-model"

    def __init__(self, content: str):
        self.content = content

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        del messages, temperature, max_tokens
        return self.content


def _fake_query_result(message: str, concept_id: str) -> QueryUnderstandingResult:
    return QueryUnderstandingResult(
        intent="concept_question",
        raw_message=message,
        retrieval_query=f"Python learning question: {message}",
        concept_hints=[concept_id],
        needs_code=False,
        risk="normal",
        llm_used=False,
        llm_fallback=False,
        chat_model="probe-test",
    )


def test_probe_set_covers_whole_python_beginner_surface():
    required_areas = {
        "interpreter",
        "variables",
        "numbers",
        "strings",
        "lists",
        "tuples",
        "dictionaries",
        "sets",
        "conditions",
        "loops",
        "range",
        "functions",
        "arguments",
        "scope",
        "modules",
        "packages",
        "files",
        "json",
        "exceptions",
        "classes",
        "inheritance",
        "iterators",
        "generators",
        "comprehensions",
        "venv",
        "pip",
        "stdlib",
        "regex",
        "debugging",
    }

    areas = {probe["area"] for probe in PROBE_QUESTIONS}

    assert len(PROBE_QUESTIONS) >= 30
    assert required_areas <= areas
    assert len({probe["question"] for probe in PROBE_QUESTIONS}) == len(PROBE_QUESTIONS)
    assert all(probe["concept_id"].startswith("Concept:") for probe in PROBE_QUESTIONS)


def test_runtime_modules_do_not_import_tests_probe_set():
    offenders: list[str] = []

    for path in APP_ROOT.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "probe_set" or alias.name.endswith(".probe_set"):
                        offenders.append(f"{path.name}:{node.lineno}")
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if module == "probe_set" or module.endswith(".probe_set"):
                    offenders.append(f"{path.name}:{node.lineno}")

    assert offenders == [], f"Runtime modules must not import tests/probe_set.py: {offenders}"


@pytest.mark.parametrize("probe", PROBE_QUESTIONS, ids=lambda probe: probe["area"])
def test_query_understanding_preserves_generated_kg_concepts_from_qwen(probe: dict):
    provider = FakeChatProvider(
        json.dumps(
            {
                "intent": "concept_question",
                "raw_message": probe["question"],
                "retrieval_query": f"Python {probe['area']} source-backed explanation",
                "concept_hints": [probe["concept_id"]],
                "needs_code": False,
                "risk": "normal",
            },
            ensure_ascii=False,
        )
    )

    result = understand_query(probe["question"], chat_provider=provider)

    assert probe["concept_id"] in result.concept_hints, (
        "Qwen-selected generated KG node IDs must be preserved even when absent from manual concepts.yaml; "
        f"{probe['concept_id']} was dropped for {probe['area']}."
    )
    assert "ErrorType:IndexError" not in result.concept_hints


@pytest.mark.parametrize(
    "probe",
    [probe for probe in PROBE_QUESTIONS if probe["area"] not in {"lists"}],
    ids=lambda probe: probe["area"],
)
def test_fallback_query_understanding_does_not_default_non_index_probes_to_list_indexerror(probe: dict):
    result = understand_query(probe["question"], allow_llm=False)

    assert "ErrorType:IndexError" not in result.concept_hints
    assert result.concept_hints != ["Concept:list"], (
        "Fallback query understanding must emit generic terms or a KG gap for non-index probes, "
        f"not default {probe['area']} to Concept:list."
    )
    assert "IndexError" not in result.retrieval_query


@pytest.mark.parametrize(
    "probe",
    [
        probe
        for probe in PROBE_QUESTIONS
        if probe["area"] in {"dictionaries", "functions", "files", "classes", "numbers"}
    ],
    ids=lambda probe: probe["area"],
)
def test_session_probe_topics_do_not_default_to_indexerror_when_kg_is_disabled(monkeypatch, probe: dict):
    def fake_understand_query(message: str) -> QueryUnderstandingResult:
        return _fake_query_result(message, probe["concept_id"])

    def fake_generate_teaching_response(**kwargs):
        return {
            "prompt": f"probe response for {probe['area']}",
            "teaching_strategy": "probe",
            "llm_used": False,
            "llm_fallback": False,
            "fallback_reason": None,
            "guardrail_reason": None,
            "llm_guardrail_triggered": False,
            "chat_model": "probe-test",
        }

    monkeypatch.setattr(session, "understand_query", fake_understand_query)
    monkeypatch.setattr(session, "generate_teaching_response", fake_generate_teaching_response)

    result = session.next_session_step(
        session_id=f"probe-{probe['area']}",
        client_turn_id=f"probe-{probe['area']}-turn",
        conversation_projection={},
        learner_id="probe-learner",
        message=probe["question"],
        stage="start",
        baseline_mode="no_rag",
    )

    projection = result["next_conversation_projection"]
    active_topic_id = projection["active_topic_id"]
    assert active_topic_id is not None
    assert projection["topics"][active_topic_id]["canonical_topic"] == probe["concept_id"]
    assert result["next_task_state"]["topic"] == probe["concept_id"]
