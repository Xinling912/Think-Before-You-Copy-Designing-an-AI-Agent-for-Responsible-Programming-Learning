#!/usr/bin/env python3
"""Run paper-oriented baseline checks for the IndexError MVP chain."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai-core-python"))
sys.path.insert(0, str(ROOT))

from app.rag import load_semantic_index  # noqa: E402
from app.session import next_session_step  # noqa: E402
from scripts.corpus_sources import all_source_ids  # noqa: E402


BASELINE_MODES = ["no_rag", "rag_only", "rag_kg", "rag_kg_skills", "full_memory"]
QUESTIONS_PATH = ROOT / "eval" / "index_error_questions.jsonl"
RESULT_DIR = ROOT / "eval" / "results"


def load_questions() -> list[dict]:
    return [
        json.loads(line)
        for line in QUESTIONS_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def assert_mode_contract(mode: str, step: dict) -> None:
    if step["baseline_mode"] != mode:
        raise AssertionError(f"Expected mode {mode}, got {step['baseline_mode']}.")
    if mode == "no_rag":
        if step["rag_sources"] or step["kg_path"] or step["requires_student_attempt"] or step["memory_used"]:
            raise AssertionError(f"no_rag must disable RAG, KG, skills, and memory: {step}")
    if mode == "rag_only":
        if not step["rag_sources"] or step["kg_path"] or step["requires_student_attempt"] or step["memory_used"]:
            raise AssertionError(f"rag_only must use RAG only: {step}")
    if mode == "rag_kg":
        if not step["rag_sources"] or not step["kg_path"] or step["requires_student_attempt"] or step["memory_used"]:
            raise AssertionError(f"rag_kg must use RAG and KG without skills or memory: {step}")
    if mode == "rag_kg_skills":
        if not step["rag_sources"] or not step["kg_path"] or not step["requires_student_attempt"] or step["memory_used"]:
            raise AssertionError(f"rag_kg_skills must use RAG, KG, and skills without memory: {step}")
    if mode == "full_memory":
        if not step["rag_sources"] or not step["kg_path"] or not step["requires_student_attempt"] or not step["memory_used"]:
            raise AssertionError(f"full_memory must enable all modules: {step}")


def compute_metrics(question: dict, step: dict, latency_ms: int) -> dict:
    prompt = str(step.get("prompt", ""))
    prompt_lower = prompt.lower()
    expected_terms = question.get("expected_terms") or []
    expected_concepts = question.get("expected_concepts") or []
    kg_path = step.get("kg_path") or []
    concept_hints = step.get("concept_hints") or []
    rag_sources = step.get("rag_sources") or []

    term_hits = sum(1 for term in expected_terms if str(term).lower() in prompt_lower)
    concept_hits = sum(
        1
        for concept in expected_concepts
        if concept in kg_path or concept in concept_hints
    )
    grounded_to_python_docs = any(
        "docs.python.org" in str(source.get("source_url", ""))
        or source.get("source_id") in all_source_ids()
        or source.get("source") in all_source_ids()
        for source in rag_sources
    )

    return {
        "expected_term_hit_rate": term_hits / max(len(expected_terms), 1),
        "expected_concept_hit_rate": concept_hits / max(len(expected_concepts), 1),
        "grounded_to_python_docs": grounded_to_python_docs,
        "pedagogical_compliance": not bool(step.get("direct_answer_given")),
        "llm_fallback": bool(step.get("llm_fallback")),
        "latency_ms": latency_ms,
    }


def summarize_step(question: dict, mode: str, step: dict) -> dict:
    first_source = step["rag_sources"][0] if step["rag_sources"] else {}
    return {
        "question_id": question["id"],
        "mode": mode,
        "intent": step.get("intent"),
        "direct_answer_given": step.get("direct_answer_given"),
        "student_attempt_required": step.get("requires_student_attempt"),
        "kg_nodes": len(step.get("kg_path") or []),
        "rag_sources": len(step.get("rag_sources") or []),
        "memory_used": step.get("memory_used"),
        "memory_updates": len(step.get("memory_updates") or []),
        "top_source_title": first_source.get("title"),
        "top_source_url": first_source.get("source_url"),
        "top_score": first_source.get("score"),
        "llm_used": step.get("llm_used"),
        "llm_fallback": step.get("llm_fallback"),
    }


def aggregate_results(rows: list[dict]) -> dict:
    by_mode: dict[str, dict] = {}
    for mode in BASELINE_MODES:
        mode_rows = [row for row in rows if row["mode"] == mode]
        if not mode_rows:
            continue
        by_mode[mode] = {
            "rows": len(mode_rows),
            "expected_term_hit_rate_mean": mean(
                row["metrics"]["expected_term_hit_rate"] for row in mode_rows
            ),
            "expected_concept_hit_rate_mean": mean(
                row["metrics"]["expected_concept_hit_rate"] for row in mode_rows
            ),
            "grounded_rate": mean(
                1.0 if row["metrics"]["grounded_to_python_docs"] else 0.0
                for row in mode_rows
            ),
            "pedagogical_compliance_rate": mean(
                1.0 if row["metrics"]["pedagogical_compliance"] else 0.0
                for row in mode_rows
            ),
            "llm_fallback_rate": mean(
                1.0 if row["metrics"]["llm_fallback"] else 0.0
                for row in mode_rows
            ),
            "latency_ms_mean": mean(row["metrics"]["latency_ms"] for row in mode_rows),
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_modes": BASELINE_MODES,
        "question_count": len({row["question_id"] for row in rows}),
        "rows": len(rows),
        "by_mode": by_mode,
    }


def mean(values: object) -> float:
    items = [float(value) for value in values]
    if not items:
        return 0.0
    return sum(items) / len(items)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="JSONL path for per-question baseline rows.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv or [])
    if not os.environ.get("DASHSCOPE_API_KEY"):
        print("Skipping baseline evaluation because DASHSCOPE_API_KEY is not set.")
        return

    load_semantic_index.cache_clear()
    questions = load_questions()
    summaries: list[dict] = []
    learner_memory = [
        {
            "memory_id": "mem_index_001",
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:list", "Concept:index"],
            "content": "学生可能把 len(list) 当成最大合法索引。",
            "strength": 2,
            "use_count": 1,
            "status": "active",
        }
    ]

    for question in questions:
        for mode in BASELINE_MODES:
            started = time.perf_counter()
            step = next_session_step(
                session_id=f"eval-{question['id']}-{mode}",
                message=question["message"],
                stage="start",
                baseline_mode=mode,
                recent_messages=[
                    {"role": "student", "content": "为什么我的 list 报 IndexError？"},
                    {"role": "agent", "content": "请先写出 list 的长度和访问的索引。"},
                ],
                task_state={"scenario": "index-error", "current_concept": "Concept:index"},
                last_evidence={"confidence_before": 2},
                learner_memory=learner_memory,
            )
            latency_ms = int((time.perf_counter() - started) * 1000)
            assert_mode_contract(mode, step)
            summary = summarize_step(question, mode, step)
            summary["metrics"] = compute_metrics(question, step, latency_ms)
            summaries.append(summary)

    out_path = args.out
    if out_path is None:
        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out_path = RESULT_DIR / f"baseline-{stamp}.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path = out_path.with_suffix(".summary.json")
    out_path.write_text(
        "\n".join(json.dumps(summary, ensure_ascii=False) for summary in summaries) + "\n",
        encoding="utf-8",
    )
    summary_path.write_text(
        json.dumps(aggregate_results(summaries), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    for summary in summaries:
        print(json.dumps(summary, ensure_ascii=False))
    print(json.dumps({"result_path": str(out_path), "summary_path": str(summary_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
