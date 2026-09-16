#!/usr/bin/env python3
"""Run live Session Orchestrator checks with Qwen, skills, KG, RAG, and memory."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai-core-python"))
sys.path.insert(0, str(ROOT))

from app.rag import DEFAULT_INDEX_NAME, load_semantic_index  # noqa: E402
from app.session import next_session_step  # noqa: E402
from scripts.corpus_sources import all_source_ids  # noqa: E402


QUESTIONS_PATH = ROOT / "eval" / "index_error_questions.jsonl"


def load_cases() -> list[dict]:
    return [json.loads(line) for line in QUESTIONS_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]


def assert_truthy(value: object, label: str) -> None:
    if not value:
        raise AssertionError(f"{label} must be present.")


def assert_expected_concepts(case: dict, step: dict) -> None:
    expected = set(case.get("expected_concepts", []))
    if not expected:
        return
    actual = set(step.get("concept_hints") or []) | set(step.get("kg_path") or [])
    missing = sorted(expected - actual)
    if missing:
        raise AssertionError(f"{case['id']} missing expected concepts {missing}; actual={sorted(actual)}")


def assert_memory_contract(case: dict, step: dict) -> None:
    session_context = step.get("session_context") or {}
    for key in ["short_term_memory", "mid_term_memory", "long_term_memory"]:
        if key not in session_context:
            raise AssertionError(f"{case['id']} missing session_context.{key}")
    if step["memory_used"] is not True:
        raise AssertionError(f"{case['id']} full_memory mode must use memory.")
    if "memory_context" not in step or "memory_reading_plan" not in step:
        raise AssertionError(f"{case['id']} must expose memory_context and memory_reading_plan.")
    if step["evidence"].get("session_context") is None:
        raise AssertionError(f"{case['id']} evidence must include session_context for frontend sidebar.")


def assert_skill_contract(case: dict, step: dict) -> None:
    workflow = step.get("pedagogical_workflow") or {}
    trace = step.get("workflow_trace") or []
    if not workflow:
        raise AssertionError(f"{case['id']} must expose pedagogical_workflow.")
    if not trace:
        raise AssertionError(f"{case['id']} must expose workflow_trace.")
    if step.get("primary_skill_id") != "student-learning/index-error-workflow":
        raise AssertionError(f"{case['id']} unexpected primary skill: {step.get('primary_skill_id')}")
    if step.get("direct_answer_given"):
        raise AssertionError(f"{case['id']} retrieve-first workflow must not mark direct_answer_given on first turn.")
    if not any(
        skill in json.dumps(workflow, ensure_ascii=False)
        for skill in [
            "retrieve-first",
            "progressive-hint",
            "stuck-and-error-diagnosis",
            "confidence-calibration",
            "teach-back",
        ]
    ):
        raise AssertionError(f"{case['id']} workflow must name a pedagogical skill decision.")


def assert_grounding_contract(case: dict, step: dict) -> None:
    assert_truthy(step["kg_path"], f"{case['id']} KG path")
    assert_truthy(step["kg_path_edges"], f"{case['id']} KG path edges")
    if step["kg_path"][-1] != "ErrorType:IndexError":
        raise AssertionError(f"{case['id']} expected KG path to end at ErrorType:IndexError, got {step['kg_path']!r}.")
    if not any(edge.get("candidate_id") for edge in step["kg_path_edges"]):
        raise AssertionError(f"{case['id']} KG path must include at least one generated candidate edge.")

    if step["rag_retrieval_mode"] != "semantic-vector-rerank":
        raise AssertionError(f"{case['id']} expected semantic-vector-rerank, got {step['rag_retrieval_mode']!r}.")
    if step["rag_index"].get("version") != DEFAULT_INDEX_NAME:
        raise AssertionError(f"{case['id']} must use multisource index {DEFAULT_INDEX_NAME}.")
    if step["rag_index"].get("source_ids") != all_source_ids():
        raise AssertionError(f"{case['id']} RAG index must include all four sources.")
    if not step["rag_sources"]:
        raise AssertionError(f"{case['id']} must return at least one RAG source.")
    allowed_sources = set(all_source_ids())
    for source in step["rag_sources"]:
        source_id = source.get("source_id") or source.get("source")
        if source_id not in allowed_sources:
            raise AssertionError(f"{case['id']} unexpected RAG source_id: {source_id}")
        if not source.get("source_url"):
            raise AssertionError(f"{case['id']} RAG source must expose source_url.")


def main() -> None:
    if not os.environ.get("DASHSCOPE_API_KEY"):
        raise SystemExit("DASHSCOPE_API_KEY is required for live session orchestrator evaluation.")

    load_semantic_index.cache_clear()
    cases = load_cases()
    if len(cases) < 10:
        raise AssertionError(f"Expected at least 10 session eval cases, got {len(cases)}.")

    learner_memory = [
        {
            "memory_id": "mem_index_001",
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:list", "Concept:index"],
            "content": "学生可能把 len(list) 当成最大合法索引。",
            "strength": 2,
            "use_count": 1,
            "effective_score": 1.1,
            "status": "active",
        },
    ]

    for case in cases:
        step = next_session_step(
            session_id=f"eval-session-{case['id']}",
            message=case["message"],
            stage="start",
            learner_id="eval-learner",
            baseline_mode="full_memory",
            recent_messages=[
                {"role": "student", "content": "为什么我的 list 报 IndexError？"},
                {"role": "agent", "content": "请先写出 list 的长度和访问的索引。"},
            ],
            task_state={"scenario": "index-error", "current_concept": "Concept:index"},
            last_evidence={"confidence_before": 2},
            learner_memory=learner_memory,
            topic_summaries=[
                {
                    "topic": "list_index_indexerror",
                    "topic_summary": "学生正在学习 list 索引越界。",
                    "weak_concepts": ["Concept:valid_index_range"],
                    "mastered_concepts": [],
                    "next_teaching_action": "先要求学生判断合法索引范围。",
                    "source_memory_ids": ["mem_index_001"],
                }
            ],
        )
        if step["chat_model"] != "qwen3.7-max":
            raise AssertionError(f"{case['id']} must use qwen3.7-max, got {step['chat_model']!r}.")
        if not step["llm_used"]:
            raise AssertionError(f"{case['id']} Qwen chat model should be used when DASHSCOPE_API_KEY is set.")
        assert_truthy(step["prompt"], f"{case['id']} teaching prompt")
        assert_expected_concepts(case, step)
        assert_grounding_contract(case, step)
        assert_skill_contract(case, step)
        assert_memory_contract(case, step)
        print(
            json.dumps(
                {
                    "case": case["id"],
                    "intent": step["intent"],
                    "active_gate": step["active_gate_id"],
                    "rag_top": step["rag_sources"][0]["title"],
                    "rag_source_id": step["rag_sources"][0].get("source_id") or step["rag_sources"][0].get("source"),
                    "memory_updates": len(step.get("memory_updates") or []),
                    "prompt": step["prompt"][:120],
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
