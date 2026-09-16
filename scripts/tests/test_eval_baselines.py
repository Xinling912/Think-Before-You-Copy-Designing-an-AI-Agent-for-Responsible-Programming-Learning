from scripts.eval_baselines import compute_metrics
from scripts.check_baseline_results import validate_summary


def test_compute_metrics_counts_terms_concepts_and_direct_answer():
    question = {
        "expected_terms": ["IndexError", "list", "index"],
        "expected_concepts": ["Concept:list", "Concept:index"],
    }
    step = {
        "prompt": "IndexError happens when a list index is outside range.",
        "kg_path": ["Concept:list", "Concept:index"],
        "rag_sources": [
            {
                "source_url": "https://docs.python.org/3/tutorial/datastructures.html#more-on-lists"
            }
        ],
        "direct_answer_given": False,
        "llm_fallback": False,
    }

    metrics = compute_metrics(question, step, latency_ms=120)

    assert metrics["expected_term_hit_rate"] == 1.0
    assert metrics["expected_concept_hit_rate"] == 1.0
    assert metrics["grounded_to_python_docs"] is True
    assert metrics["pedagogical_compliance"] is True
    assert metrics["latency_ms"] == 120


def test_compute_metrics_penalizes_missing_grounding_and_direct_answer():
    question = {
        "expected_terms": ["valid index range", "len"],
        "expected_concepts": ["Concept:valid_index_range"],
    }
    step = {
        "prompt": "直接把 list[2] 改成 list[1] 就行。",
        "kg_path": [],
        "rag_sources": [],
        "direct_answer_given": True,
        "llm_fallback": True,
    }

    metrics = compute_metrics(question, step, latency_ms=333)

    assert metrics["expected_term_hit_rate"] == 0
    assert metrics["expected_concept_hit_rate"] == 0
    assert metrics["grounded_to_python_docs"] is False
    assert metrics["pedagogical_compliance"] is False
    assert metrics["llm_fallback"] is True


def test_validate_summary_requires_all_baselines_and_full_memory_contract():
    summary = {
        "baseline_modes": ["no_rag", "rag_only", "rag_kg", "rag_kg_skills", "full_memory"],
        "question_count": 4,
        "rows": 20,
        "by_mode": {
            "no_rag": {"rows": 4, "grounded_rate": 0, "pedagogical_compliance_rate": 1, "llm_fallback_rate": 0},
            "rag_only": {"rows": 4, "grounded_rate": 1, "pedagogical_compliance_rate": 1, "llm_fallback_rate": 0},
            "rag_kg": {"rows": 4, "grounded_rate": 1, "pedagogical_compliance_rate": 1, "llm_fallback_rate": 0},
            "rag_kg_skills": {"rows": 4, "grounded_rate": 1, "pedagogical_compliance_rate": 1, "llm_fallback_rate": 0},
            "full_memory": {"rows": 4, "grounded_rate": 1, "pedagogical_compliance_rate": 1, "llm_fallback_rate": 0},
        },
    }

    validate_summary(summary)


def test_validate_summary_rejects_missing_mode():
    summary = {
        "baseline_modes": ["no_rag", "rag_only", "rag_kg", "rag_kg_skills", "full_memory"],
        "question_count": 4,
        "rows": 16,
        "by_mode": {
            "no_rag": {"rows": 4, "grounded_rate": 0, "pedagogical_compliance_rate": 1, "llm_fallback_rate": 0},
        },
    }

    try:
        validate_summary(summary)
    except AssertionError as exc:
        assert "missing baseline modes" in str(exc)
    else:
        raise AssertionError("validate_summary should reject missing modes")
