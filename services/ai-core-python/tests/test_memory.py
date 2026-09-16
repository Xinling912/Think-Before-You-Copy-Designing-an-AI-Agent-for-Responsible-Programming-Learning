from app.memory import compute_effective_score, decide_memory_operation


def test_add_new_misconception_when_no_similar_memory():
    candidate = {
        "memory_type": "misconception",
        "topic": "list_index_indexerror",
        "concepts": ["Concept:index"],
        "content": "学生把 len(list) 当成最大合法索引。",
    }

    result = decide_memory_operation(candidate, existing_memories=[])

    assert result["operation"] == "ADD"
    assert result["memory_type"] == "misconception"
    assert result["topic"] == "list_index_indexerror"
    assert result["concepts"] == ["Concept:index"]


def test_update_existing_misconception_when_same_topic_and_concept():
    candidate = {
        "memory_type": "misconception",
        "topic": "list_index_indexerror",
        "concepts": ["Concept:index", "Concept:valid_index_range"],
        "content": "学生认为长度为 2 的 list 可以访问 list[2]。",
    }
    existing = [
        {
            "memory_id": "mem_001",
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:index"],
            "content": "学生把 len(list) 当成最大合法索引。",
        }
    ]

    result = decide_memory_operation(candidate, existing_memories=existing)

    assert result["operation"] == "UPDATE"
    assert result["target_memory_id"] == "mem_001"
    assert result["concepts"] == ["Concept:index", "Concept:valid_index_range"]
    assert "len(list)" in result["content"]
    assert "list[2]" in result["content"]


def test_short_candidate_is_not_stored():
    candidate = {
        "memory_type": "misconception",
        "topic": "list_index_indexerror",
        "concepts": ["Concept:index"],
        "content": "不会",
    }

    result = decide_memory_operation(candidate, existing_memories=[])

    assert result["operation"] == "NOOP"
    assert result["reason"] == "candidate_memory_too_short"


def test_effective_score_decays_with_time_and_recovers_with_strength():
    fresh_score = compute_effective_score(strength=2, use_count=1, days_since_last_used=0)
    old_score = compute_effective_score(strength=2, use_count=1, days_since_last_used=60)
    reinforced_score = compute_effective_score(
        strength=4,
        use_count=5,
        days_since_last_used=60,
    )

    assert old_score < fresh_score
    assert reinforced_score > old_score
