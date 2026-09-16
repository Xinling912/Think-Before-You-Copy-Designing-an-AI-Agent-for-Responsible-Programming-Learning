import pytest

from app.memory import (
    build_memory_context,
    build_or_update_topic_summary,
    build_reflection_summary,
    build_prospective_memory_plan,
    decide_memory_operations,
    derive_memory_state,
    extract_memory_candidates,
    generate_learning_facts,
    memorybank_effective_score,
    reinforce_retrieved_memories,
    retrospective_memory_use,
)


def test_mem0_extracts_salient_misconception_from_exchange():
    candidates = extract_memory_candidates(
        learner_id="learner-1",
        session_id="session-1",
        student_message="我不知道为什么这段代码会报错。",
        agent_message="先写出已知条件、操作步骤和实际结果。",
        topic="Concept:debugging_error_types",
        concepts=["Concept:debugging_error_types"],
    )

    assert candidates
    misconception = candidates[0]
    assert misconception["learner_id"] == "learner-1"
    assert misconception["session_id"] == "session-1"
    assert misconception["memory_type"] == "misconception"
    assert misconception["topic"] == "Concept:debugging_error_types"
    assert "Concept:debugging_error_types" in misconception["concepts"]
    assert "当前主题" in misconception["content"]
    assert misconception["salience"] >= 0.7
    assert misconception["confidence"] >= 0.7
    assert misconception["source"] == "deterministic_rule"
    assert misconception["evidence_span"] == "我不知道为什么这段代码会报错。"


def test_mem0_extracts_direct_answer_dependency_preference():
    candidates = extract_memory_candidates(
        learner_id="learner-1",
        session_id="session-1",
        student_message="请直接给我完整答案，不要提示。",
        agent_message="我会先让你判断关键条件。",
        topic="list_index_indexerror",
        concepts=["Concept:list", "Concept:index"],
    )

    assert len(candidates) == 1
    preference = candidates[0]
    assert preference["memory_type"] == "preference"
    assert preference["topic"] == "learning_strategy_direct_answer_dependency"
    assert "Concept:direct_answer_dependency" in preference["concepts"]
    assert preference["confidence"] >= 0.7
    assert preference["source"] == "deterministic_rule"
    assert preference["evidence_span"] == "请直接给我完整答案，不要提示。"


def test_mem0_emits_noop_when_no_salient_candidate():
    operations = decide_memory_operations([], existing_memories=[])

    assert operations == [
        {
            "operation": "NOOP",
            "reason": "no_salient_candidate",
            "memory_type": "none",
            "topic": "general_python_learning",
            "concepts": [],
            "content": "",
        }
    ]


def test_mem0_non_salient_candidate_uses_fixed_noop_shape():
    operations = decide_memory_operations(
        [
            {
                "memory_type": "misconception",
                "topic": "smalltalk",
                "concepts": ["Concept:noise"],
                "content": "嗯",
                "salience": 0.1,
            }
        ],
        existing_memories=[],
    )

    assert operations == [
        {
            "operation": "NOOP",
            "reason": "candidate_memory_too_short",
            "memory_type": "none",
            "topic": "general_python_learning",
            "concepts": [],
            "content": "",
        }
    ]


def test_teach_back_mastery_candidate_deletes_active_misconception():
    existing = [
        {
            "memory_id": "mem-misconception",
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:index", "Concept:valid_index_range"],
            "content": "学生认为长度为 2 可以访问 list[2]。",
            "status": "active",
        }
    ]
    candidates = extract_memory_candidates(
        learner_id="learner-1",
        session_id="session-1",
        student_message="长度为2时合法索引是0和1，所以list[2]越界。",
        agent_message="请再给一个信心分数。",
        topic="list_index_indexerror",
        concepts=["Concept:index", "Concept:valid_index_range"],
        workflow_evidence={"state": "teach_back_evaluated", "teach_back_score": 0.9},
    )

    operations = decide_memory_operations(candidates, existing)

    assert candidates[0]["memory_type"] == "mastery"
    assert operations[0]["operation"] == "DELETE"
    assert operations[0]["target_memory_id"] == "mem-misconception"


def test_mem0_operations_cover_add_update_delete_noop():
    existing = [
        {
            "memory_id": "mem-old",
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:index"],
            "content": "学生认为长度为 2 的 list 可以访问 list[2]。",
            "status": "active",
        },
        {
            "memory_id": "mem-other",
            "memory_type": "preference",
            "topic": "python_learning_strategy",
            "concepts": ["Concept:direct_answer_dependency"],
            "content": "学生经常请求直接答案。",
            "status": "active",
        },
    ]
    candidates = [
        {
            "memory_type": "preference",
            "topic": "debugging_help",
            "concepts": ["Concept:hint_ladder"],
            "content": "学生偏好先给提示再给答案。",
            "salience": 0.8,
        },
        {
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:index", "Concept:valid_index_range"],
            "content": "学生仍把 len(list) 当成最大合法索引。",
            "salience": 0.9,
        },
        {
            "memory_type": "mastery",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:index", "Concept:valid_index_range"],
            "content": "学生现在能说明长度为 2 的列表最大合法索引是 1。",
            "salience": 0.9,
        },
        {
            "memory_type": "misconception",
            "topic": "smalltalk",
            "concepts": [],
            "content": "嗯",
            "salience": 0.1,
        },
    ]

    operations = decide_memory_operations(candidates, existing)

    assert [operation["operation"] for operation in operations] == [
        "ADD",
        "UPDATE",
        "DELETE",
        "NOOP",
    ]
    assert operations[1]["target_memory_id"] == "mem-old"
    assert operations[2]["target_memory_id"] == "mem-old"
    assert operations[3]["reason"] in {"candidate_memory_too_short", "candidate_not_salient"}


def test_memorybank_decay_formula_and_reinforcement():
    fresh = memorybank_effective_score(strength=2, use_count=1, days_since_last_used=0)
    stale = memorybank_effective_score(strength=2, use_count=1, days_since_last_used=30)
    reinforced = memorybank_effective_score(strength=4, use_count=8, days_since_last_used=30)

    assert stale < fresh
    assert reinforced > stale


def test_memorybank_uses_ebbinghaus_retention_formula():
    assert memorybank_effective_score(strength=2, use_count=0, days_since_last_used=0) == pytest.approx(1.0)
    assert memorybank_effective_score(strength=2, use_count=0, days_since_last_used=2) == pytest.approx(0.367879, rel=1e-5)
    reinforced = memorybank_effective_score(strength=2, use_count=4, days_since_last_used=2)
    stale = memorybank_effective_score(strength=2, use_count=0, days_since_last_used=2)
    assert reinforced > stale


def test_memorybank_clamps_negative_use_count():
    score = memorybank_effective_score(strength=2, use_count=-1, days_since_last_used=2)

    assert score == pytest.approx(0.367879, rel=1e-5)


def test_derive_memory_state_collects_active_risks_mastery_and_misconceptions():
    state = derive_memory_state(
        [
            {
                "memory_id": "m-risk",
                "memory_type": "preference",
                "topic": "learning_strategy_direct_answer_dependency",
                "concepts": ["Concept:direct_answer_dependency"],
                "content": "学生经常请求直接答案。",
                "status": "active",
            },
            {
                "memory_id": "m-mastery",
                "memory_type": "mastery",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:index", "Concept:index"],
                "content": "学生已掌握索引范围。",
                "status": "active",
            },
            {
                "memory_id": "m-mis",
                "memory_type": "misconception",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:valid_index_range"],
                "content": "学生把长度 2 和索引 2 混淆。",
                "status": "active",
            },
            {
                "memory_id": "m-old",
                "memory_type": "misconception",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:list"],
                "content": "已删除的记忆不应参与状态。",
                "status": "deleted",
            },
        ]
    )

    assert state["active_risks"] == ["direct_answer_dependency"]
    assert state["mastered_concepts"] == ["Concept:index"]
    assert state["misconceptions"] == [
        {
            "topic": "list_index_indexerror",
            "concepts": ["Concept:valid_index_range"],
            "content": "学生把长度 2 和索引 2 混淆。",
        }
    ]
    assert state["retrieved_memory_count"] == 3


def test_reinforce_retrieved_memories_increments_use_count_and_score():
    memories = [
        {
            "memory_id": "m1",
            "strength": 4,
            "use_count": 1,
            "last_used_at": "2026-07-01T00:00:00Z",
            "status": "active",
        }
    ]

    result = reinforce_retrieved_memories(memories, now_iso="2026-07-06T00:00:00Z")

    assert result[0]["memory_id"] == "m1"
    assert result[0]["use_count"] == 2
    assert result[0]["last_used_at"] == "2026-07-06T00:00:00Z"
    assert result[0]["effective_score"] > 0
    assert memories[0]["use_count"] == 1


def test_build_reflection_summary_records_prospective_and_retrospective():
    summary = build_reflection_summary(
        topic="Concept:file_context_manager",
        recent_messages=[
            {"role": "student", "content": "我不懂为什么 with open 更好"},
            {"role": "agent", "content": "请先判断资源释放发生在什么时候。"},
        ],
        evidence={"teach_back_required": True, "hint_level": "diagnostic_question"},
    )

    assert summary["topic"] == "Concept:file_context_manager"
    assert "prospective" in summary
    assert "retrospective" in summary
    assert "不确定" in summary["retrospective"] or "卡住" in summary["retrospective"]
    assert summary["evidence"]["teach_back_required"] is True


def test_rmm_prospective_and_retrospective_memory_plan():
    learner_memory = [
        {
            "memory_id": "mem-index",
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:index", "Concept:valid_index_range"],
            "content": "学生把 len(list) 当成最大合法索引。",
            "strength": 3,
            "use_count": 2,
            "days_since_last_used": 1,
            "status": "active",
        },
        {
            "memory_id": "mem-inactive",
            "memory_type": "misconception",
            "topic": "list_index_indexerror",
            "concepts": ["Concept:index"],
            "content": "不应被选中。",
            "strength": 5,
            "use_count": 5,
            "days_since_last_used": 0,
            "status": "deleted",
        },
    ]
    topic_summaries = [
        {
            "topic": "list_index_indexerror",
            "topic_summary": "学生需要巩固合法索引范围。",
            "weak_concepts": ["Concept:valid_index_range"],
        }
    ]

    plan = build_prospective_memory_plan(
        topic="list_index_indexerror",
        query_concepts=["Concept:index"],
        learner_memory=learner_memory,
        topic_summaries=topic_summaries,
    )
    retrospective = retrospective_memory_use(plan, used_memory_ids=["mem-index"])

    assert plan["topic"] == "list_index_indexerror"
    assert plan["selected_memory_ids"] == ["mem-index"]
    assert plan["selected_topic_summary"]["topic_summary"] == "学生需要巩固合法索引范围。"
    assert "Concept:index" in plan["prospective_memory_plan"]
    assert retrospective["used_memory_ids"] == ["mem-index"]
    assert retrospective["unused_selected_memory_ids"] == []
    assert "keep" in retrospective["retrieval_refinement"].lower()


def test_rmm_retrospective_distinguishes_selected_from_verified_used():
    plan = {"topic": "list_index_indexerror", "selected_memory_ids": ["mem-a", "mem-b"]}
    retrospective = retrospective_memory_use(
        plan,
        used_memory_ids=[],
        verification_reason="model_did_not_report_usage",
    )
    assert retrospective["selected_memory_ids"] == ["mem-a", "mem-b"]
    assert retrospective["used_memory_ids"] == []
    assert retrospective["unused_selected_memory_ids"] == ["mem-a", "mem-b"]
    assert retrospective["verification_reason"] == "model_did_not_report_usage"


def test_rmm_retrospective_filters_unselected_model_reported_memory_ids():
    plan = {"topic": "list_index_indexerror", "selected_memory_ids": ["mem-a", "mem-b"]}
    retrospective = retrospective_memory_use(
        plan,
        used_memory_ids=["mem-a", "mem-x"],
        verification_reason="model_reported_used_memory_ids",
    )
    assert retrospective["used_memory_ids"] == ["mem-a"]
    assert retrospective["unused_selected_memory_ids"] == ["mem-b"]


def test_rmm_prospective_respects_persisted_effective_score_ordering():
    plan = build_prospective_memory_plan(
        topic="list_index_indexerror",
        query_concepts=["Concept:index"],
        learner_memory=[
            {
                "memory_id": "mem-recomputed-would-win",
                "memory_type": "misconception",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:index"],
                "content": "High strength, but persisted retrieval score is low.",
                "strength": 10,
                "use_count": 10,
                "days_since_last_used": 0,
                "effective_score": 0.1,
                "status": "active",
            },
            {
                "memory_id": "mem-persisted-winner",
                "memory_type": "misconception",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:index"],
                "content": "Persisted score should determine ordering.",
                "strength": 1,
                "use_count": 0,
                "days_since_last_used": 100,
                "effective_score": 9.9,
                "status": "active",
            },
        ],
        topic_summaries=[],
    )

    assert plan["selected_memory_ids"] == [
        "mem-persisted-winner",
        "mem-recomputed-would-win",
    ]


def test_topic_summary_updates_weak_and_mastered_concepts():
    summary = build_or_update_topic_summary(
        topic="list_index_indexerror",
        existing_summary={
            "topic": "list_index_indexerror",
            "weak_concepts": ["Concept:index"],
            "mastered_concepts": [],
            "source_memory_ids": ["mem-old"],
        },
        memory_updates=[
            {
                "operation": "ADD",
                "memory_id": "mem-weak",
                "memory_type": "misconception",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:valid_index_range"],
                "content": "学生认为长度为 2 的列表可以访问 list[2]。",
            },
            {
                "operation": "DELETE",
                "target_memory_id": "mem-old",
                "memory_type": "mastery",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:index"],
                "content": "学生能说出索引从 0 开始。",
            },
        ],
        used_memory_ids=["mem-old"],
    )

    assert summary["topic"] == "list_index_indexerror"
    assert "Concept:valid_index_range" in summary["weak_concepts"]
    assert "Concept:index" in summary["mastered_concepts"]
    assert "Concept:index" not in summary["weak_concepts"]
    assert set(summary["source_memory_ids"]) >= {"mem-old", "mem-weak"}
    assert summary["next_teaching_action"]
    assert summary["topic_summary"]


def test_zep_like_learning_facts_from_exchange():
    candidates = extract_memory_candidates(
        learner_id="learner-1",
        session_id="session-1",
        student_message="我不知道为什么 with open 更好。",
        agent_message="先判断资源释放发生在什么时候。",
        topic="Concept:file_context_manager",
        concepts=["Concept:file_context_manager"],
    )
    operations = decide_memory_operations(candidates, existing_memories=[])

    facts = generate_learning_facts(
        learner_id="learner-1",
        episode_id=7,
        topic="list_index_indexerror",
        memory_updates=operations,
    )

    misconception_fact = next(
        fact for fact in facts if fact["predicate"] == "has_misconception"
    )
    assert misconception_fact["fact_id"]
    assert misconception_fact["learner_id"] == "learner-1"
    assert misconception_fact["subject"] == "Learner:learner-1"
    assert misconception_fact["object"] == "Misconception:Concept:file_context_manager"
    assert misconception_fact["confidence"] > 0
    assert misconception_fact["source_episode_id"] == 7
    assert isinstance(misconception_fact["source_episode_id"], int)
    assert misconception_fact["valid_from"]
    assert misconception_fact["valid_to"] is None
    assert misconception_fact["status"] == "active"
    assert misconception_fact["payload"]["operation"] in {"ADD", "UPDATE"}
    assert misconception_fact["payload"]["topic"] == "Concept:file_context_manager"


def test_zep_like_learning_facts_include_resolved_and_mastery_predicates():
    facts = generate_learning_facts(
        learner_id="learner-1",
        episode_id=7,
        topic="list_index_indexerror",
        memory_updates=[
            {
                "operation": "DELETE",
                "target_memory_id": "mem-old",
                "memory_type": "mastery",
                "topic": "list_index_indexerror",
                "concepts": ["Concept:index", "Concept:valid_index_range"],
                "content": "学生能解释长度为 2 的列表合法索引是 0 和 1。",
                "confidence": 0.91,
            }
        ],
    )

    predicates = {fact["predicate"] for fact in facts}
    assert {"resolved_misconception", "has_mastery"} <= predicates
    for fact in facts:
        assert fact["fact_id"]
        assert fact["learner_id"] == "learner-1"
        assert fact["source_episode_id"] == 7
        assert fact["confidence"] == 0.91
        assert fact["valid_to"] is None
        assert fact["payload"]["target_memory_id"] == "mem-old"


def test_generate_learning_facts_rejects_non_integer_episode_id():
    with pytest.raises(ValueError, match="episode_id|source_episode_id"):
        generate_learning_facts(
            learner_id="learner-1",
            episode_id="episode-1",
            topic="list_index_indexerror",
            memory_updates=[
                {
                    "operation": "ADD",
                    "memory_type": "misconception",
                    "topic": "list_index_indexerror",
                    "concepts": ["Concept:index"],
                    "content": "学生不理解索引。",
                    "confidence": 0.8,
                }
            ],
        )


def test_non_salient_smalltalk_is_noop():
    candidates = extract_memory_candidates(
        learner_id="learner-1",
        session_id="session-1",
        student_message="谢谢，哈哈",
        agent_message="不客气。",
        topic="list_index_indexerror",
        concepts=["Concept:list"],
    )
    operations = decide_memory_operations(candidates, existing_memories=[])
    context = build_memory_context(
        recent_messages=[{"role": "student", "content": "谢谢，哈哈"}],
        task_state={},
        learner_memory=[],
        retrieved_memory_ids=[],
        topic_summaries=[],
        reading_plan={"topic": "list_index_indexerror"},
    )

    assert candidates == []
    assert operations == [
        {
            "operation": "NOOP",
            "reason": "no_salient_candidate",
            "memory_type": "none",
            "topic": "general_python_learning",
            "concepts": [],
            "content": "",
        }
    ]
    assert context["short_term_count"] == 1
    assert context["long_term_count"] == 0
    assert context["retrieved_memory_ids"] == []
    assert "rmm" in context
