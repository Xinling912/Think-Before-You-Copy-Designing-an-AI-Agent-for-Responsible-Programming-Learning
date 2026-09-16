#!/usr/bin/env python3
"""Validate paper baseline result summaries."""

from __future__ import annotations

import json
import sys
from pathlib import Path


REQUIRED_BASELINES = ["no_rag", "rag_only", "rag_kg", "rag_kg_skills", "full_memory"]


def validate_summary(summary: dict) -> None:
    by_mode = summary.get("by_mode") or {}
    missing = [mode for mode in REQUIRED_BASELINES if mode not in by_mode]
    if missing:
        raise AssertionError(f"missing baseline modes: {missing}")

    question_count = int(summary.get("question_count") or 0)
    expected_rows = question_count * len(REQUIRED_BASELINES)
    if question_count <= 0:
        raise AssertionError("question_count must be positive")
    if int(summary.get("rows") or 0) < expected_rows:
        raise AssertionError(
            f"baseline rows below expected count: {summary.get('rows')} < {expected_rows}"
        )

    for mode in REQUIRED_BASELINES:
        rows = int((by_mode.get(mode) or {}).get("rows") or 0)
        if rows != question_count:
            raise AssertionError(f"{mode} rows mismatch: {rows} != {question_count}")

    full_memory = by_mode["full_memory"]
    rag_only = by_mode["rag_only"]
    if float(full_memory.get("grounded_rate") or 0) < float(rag_only.get("grounded_rate") or 0):
        raise AssertionError("full_memory grounded_rate must be at least rag_only grounded_rate")
    if float(full_memory.get("pedagogical_compliance_rate") or 0) < 1:
        raise AssertionError("full_memory pedagogical_compliance_rate must equal 1")
    if float(full_memory.get("llm_fallback_rate") or 0) != 0:
        raise AssertionError("full_memory llm_fallback_rate must equal 0")


def main(argv: list[str]) -> None:
    if not argv:
        raise SystemExit("Usage: python scripts/check_baseline_results.py <summary.json>")
    path = Path(argv[0])
    summary = json.loads(path.read_text(encoding="utf-8"))
    validate_summary(summary)
    print("Baseline summary checks passed.")


if __name__ == "__main__":
    main(sys.argv[1:])
