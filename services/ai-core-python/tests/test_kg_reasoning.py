from app.kg import load_edges, reason_about_target


def test_load_edges_includes_generated_candidate_evidence_edges() -> None:
    edges = load_edges()

    candidate_edges = [edge for edge in edges if edge.get("source") == "kg/generated/candidates.jsonl"]

    assert candidate_edges
    assert any(edge.get("candidate_id", "").startswith("kgcand_") for edge in candidate_edges)
    assert any({edge["from"], edge["to"]} == {"Concept:list", "Concept:index"} for edge in candidate_edges)


def test_learning_path_uses_generated_candidate_edges_when_available() -> None:
    result = reason_about_target("IndexError", source="Concept:list")

    assert result["path"] == [
        "Concept:list",
        "Concept:index",
        "Concept:zero_based_index",
        "Concept:valid_index_range",
        "ErrorType:IndexError",
    ]
    assert all(edge.get("source") == "kg/edges.yaml" for edge in result["path_edges"])


def test_generated_candidate_edges_do_not_override_manual_teaching_weights() -> None:
    edges = load_edges()
    manual_index_error_edge = next(
        edge
        for edge in edges
        if not edge.get("candidate_id")
        and edge["from"] == "ErrorType:IndexError"
        and edge["type"] == "caused_by"
        and edge["to"] == "Concept:index"
    )

    duplicate_candidates = [
        edge
        for edge in edges
        if edge.get("candidate_id")
        and edge["from"] == "ErrorType:IndexError"
        and edge["type"] == "caused_by"
        and edge["to"] == "Concept:index"
    ]

    assert duplicate_candidates
    assert all(edge["weight"] > manual_index_error_edge["weight"] for edge in duplicate_candidates)
