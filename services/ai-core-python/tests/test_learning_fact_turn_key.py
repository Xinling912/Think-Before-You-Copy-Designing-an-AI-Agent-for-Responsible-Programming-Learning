from app.memory import generate_learning_facts


def _updates():
    return [
        {
            "operation": "ADD",
            "memory_type": "misconception",
            "topic": "Concept:list",
            "content": "student thinks list indexes start at 1",
            "reason": "wrong index base",
        }
    ]


def test_learning_fact_id_includes_turn_key():
    base = generate_learning_facts("learner-a", 9, "Concept:list", _updates())
    same_turn = generate_learning_facts("learner-a", 9, "Concept:list", _updates(), turn_key="turn-1")
    other_turn = generate_learning_facts("learner-a", 9, "Concept:list", _updates(), turn_key="turn-2")
    repeat_same_turn = generate_learning_facts("learner-a", 9, "Concept:list", _updates(), turn_key="turn-1")

    assert same_turn[0]["fact_id"] != other_turn[0]["fact_id"]
    assert same_turn[0]["fact_id"] == repeat_same_turn[0]["fact_id"]
    assert same_turn[0]["fact_id"] != base[0]["fact_id"]
