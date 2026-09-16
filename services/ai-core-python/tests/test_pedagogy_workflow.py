from app.pedagogy import (
    apply_direct_answer_entitlement,
    decide_next_teaching_action,
    recover_workflow_evidence,
)
from app import session
from app.conversation_projection import ConversationProjection, TopicFrame, TopicPedagogyState
from app.turn_resolution import SelectedNodeResolution, TurnResolution


def _topic_projection(*, active_topic="topic-list") -> ConversationProjection:
    return ConversationProjection(
        last_sequence=9,
        active_topic_id=active_topic,
        back_stack=["topic-list"] if active_topic == "topic-len" else [],
        topics={
            "topic-list": TopicFrame(
                topic_id="topic-list",
                canonical_topic="Concept:list",
                topic_label="list",
                aliases=["list", "列表"],
                status="active" if active_topic == "topic-list" else "suspended",
                summary="list summary",
                unresolved_question="list question",
                pedagogy_state=TopicPedagogyState(
                    workflow_state="hint_level_3",
                    active_gate_id="student-learning/progressive-hint-ladder",
                    hint_level=3,
                    next_required_action="apply_hint",
                    confidence_before=0.4,
                    teach_back_required=True,
                ),
                created_at="2026-07-20T00:00:00Z",
                last_active_at="2026-07-20T00:00:00Z",
            ),
            "topic-len": TopicFrame(
                topic_id="topic-len",
                canonical_topic="Concept:len",
                topic_label="len",
                aliases=["len"],
                status="active" if active_topic == "topic-len" else "suspended",
                summary="len summary",
                unresolved_question="len question",
                created_at="2026-07-20T00:01:00Z",
                last_active_at="2026-07-20T00:01:00Z",
            ),
        },
    )


def _workflow_resolution(action, before, after, relation="continue") -> TurnResolution:
    return TurnResolution(
        original_message="question",
        resolved_question="question",
        resolved_intent="concept_question",
        conversation_relation=relation,
        active_topic_before=before,
        active_topic_after=after,
        target_topic_id=after,
        selected_node=SelectedNodeResolution(usage="absent", reason="no_selection"),
        workflow_action=action,
        retrieval_query="Python question",
        resolution_confidence=1.0,
    )


def test_new_topic_initializes_pedagogy():
    selected = session.select_topic_state(
        _workflow_resolution("initialize", "topic-list", "topic-new", "switch_topic"),
        _topic_projection(),
    )
    assert selected["pedagogy_state"] == {}
    assert selected["task_state"] == {}
    assert selected["last_evidence"] == {}


def test_resumed_topic_restores_pedagogy():
    projection = _topic_projection(active_topic="topic-len")
    selected = session.select_topic_state(
        _workflow_resolution("restore", "topic-len", "topic-list", "resume_previous"),
        projection,
    )
    assert selected["pedagogy_state"] == projection.topics["topic-list"].pedagogy_state.model_dump(mode="json")
    assert selected["task_state"]["hint_level"] == 3
    assert selected["last_evidence"]["active_gate_id"] == "student-learning/progressive-hint-ladder"


def test_greeting_preserves_active_topic_state():
    projection = _topic_projection()
    selected = session.select_topic_state(
        _workflow_resolution("preserve_without_advance", "topic-list", "topic-list", "greeting"),
        projection,
    )
    assert selected["topic_frame"] == projection.topics["topic-list"].model_dump(mode="json")
    assert selected["advance_pedagogy"] is False


def test_off_topic_preserves_active_topic_state():
    projection = _topic_projection()
    selected = session.select_topic_state(
        _workflow_resolution("preserve_without_advance", "topic-list", "topic-list", "off_topic"),
        projection,
    )
    assert selected["topic_frame"] == projection.topics["topic-list"].model_dump(mode="json")
    assert selected["advance_pedagogy"] is False


def test_retrieve_first_asks_for_attempt_once_then_moves_to_diagnosis():
    first = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="为什么我的 Python list 报 IndexError？",
        stage="start",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )

    assert first["state"] == "retrieve_first"
    assert first["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert first["active_gate_id"] == "student-learning/retrieve-first-gate"
    assert first["skill_id"] == first["active_gate_id"]
    assert first["prompt_key"] == "retrieve_first"
    assert first["requires_student_attempt"] is True
    assert first["allow_direct_answer"] is False
    assert first["direct_answer_given"] is False

    second = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="我访问的是 list[2]，长度是 2",
        stage="hint",
        recent_messages=[{"role": "agent", "content": first["prompt"]}],
        task_state={"hint_level": first["hint_level"]},
        last_evidence={"confidence_before": 3},
    )

    assert second["state"] == "hint_level_1"
    assert second["prompt"] != first["prompt"]
    assert second["next_required_action"] == "diagnose_learning_gap"
    assert second["active_gate_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert second["skill_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert second["primary_skill_id"] == "student-learning/adaptive-python-workflow"


def test_direct_answer_entitlement_overrides_retrieve_first_for_one_turn():
    original = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="Give me the direct answer.",
        stage="start",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )

    action = apply_direct_answer_entitlement(original, True)

    assert original["state"] == "retrieve_first"
    assert action["state"] == "direct_answer_allowed"
    assert action["allow_direct_answer"] is True
    assert action["requires_student_attempt"] is False
    assert action["next_required_action"] == "answer_with_evidence"
    assert action["preempted_policy"] == {
        "state": "retrieve_first",
        "active_gate_id": "student-learning/retrieve-first-gate",
        "prompt_key": "retrieve_first",
        "next_required_action": "student_attempt",
    }


def test_direct_answer_entitlement_does_not_change_a_non_entitled_action():
    original = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="Why does list[4] fail?",
        stage="start",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )

    assert apply_direct_answer_entitlement(original, False) == original


def test_index_error_workflow_progresses_without_repeating_prompt():
    first = decide_next_teaching_action(
        "student-learning/retrieve-first-gate",
        "为什么我的 list 报 IndexError？",
        stage="start",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )
    assert first["active_gate_id"] == "student-learning/retrieve-first-gate"
    assert first["allow_direct_answer"] is False
    first_trace = {item["skill_id"]: item["status"] for item in first["workflow_trace"]}
    assert first_trace == {
        "student-learning/retrieve-first-gate": "active",
        "student-learning/confidence-calibration-check": "pending",
        "student-learning/stuck-and-error-diagnosis-coach": "waiting",
        "student-learning/progressive-hint-ladder": "waiting",
        "student-learning/teach-back-evaluator": "waiting",
    }

    second = decide_next_teaching_action(
        "student-learning/retrieve-first-gate",
        "我不知道",
        stage="diagnose",
        recent_messages=[{"role": "agent", "content": first["prompt"]}],
        task_state={"retrieve_first_done": True, "hint_level": 0},
        last_evidence={"skill_state": first},
    )
    assert second["active_gate_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert second["prompt"] != first["prompt"]
    assert second["hint_level"] >= 1
    second_trace = {item["skill_id"]: item["status"] for item in second["workflow_trace"]}
    assert second_trace["student-learning/retrieve-first-gate"] == "passed"
    assert second_trace["student-learning/confidence-calibration-check"] == "pending"
    assert second_trace["student-learning/stuck-and-error-diagnosis-coach"] == "active"
    assert second_trace["student-learning/progressive-hint-ladder"] in {"active", "waiting"}
    assert second_trace["student-learning/teach-back-evaluator"] == "waiting"

    third = decide_next_teaching_action(
        "student-learning/retrieve-first-gate",
        "这个规则必须对照代码和结果，因为当前操作会导致异常；例如 list[2] 这个例子，下一步我会检查教材证据。",
        stage="diagnose",
        recent_messages=[{"role": "agent", "content": second["prompt"]}],
        task_state={"hint_level": second["hint_level"]},
        last_evidence={"skill_state": second, "confidence_before": 2},
    )
    assert third["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert third["teach_back_required"] is True
    third_trace = {item["skill_id"]: item["status"] for item in third["workflow_trace"]}
    assert third_trace["student-learning/retrieve-first-gate"] == "passed"
    assert third_trace["student-learning/confidence-calibration-check"] == "passed"
    assert third_trace["student-learning/stuck-and-error-diagnosis-coach"] == "passed"
    assert third_trace["student-learning/progressive-hint-ladder"] == "passed"
    assert third_trace["student-learning/teach-back-evaluator"] == "active"


def test_stuck_without_confidence_has_single_active_gate_and_pending_confidence():
    action = decide_next_teaching_action(
        "student-learning/retrieve-first-gate",
        "我不知道",
        stage="diagnose",
        recent_messages=[],
        task_state={"retrieve_first_done": True, "hint_level": 0},
        last_evidence={},
    )

    trace = {item["skill_id"]: item["status"] for item in action["workflow_trace"]}
    active_skills = [
        item["skill_id"]
        for item in action["workflow_trace"]
        if item["status"] == "active"
    ]

    assert action["active_gate_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert active_skills == ["student-learning/stuck-and-error-diagnosis-coach"]
    assert trace["student-learning/confidence-calibration-check"] == "pending"
    assert action["confidence_before_required"] is False


def test_baseline_workflow_trace_skips_pedagogical_skills():
    action = decide_next_teaching_action(
        "baseline/no-rag",
        "直接告诉我答案",
        stage="start",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )

    assert action["allow_direct_answer"] is True
    trace = {item["skill_id"]: item["status"] for item in action["workflow_trace"]}
    assert trace == {
        "student-learning/retrieve-first-gate": "skipped",
        "student-learning/confidence-calibration-check": "skipped",
        "student-learning/stuck-and-error-diagnosis-coach": "skipped",
        "student-learning/progressive-hint-ladder": "skipped",
        "student-learning/teach-back-evaluator": "skipped",
    }


def test_hint_ladder_progresses_without_repeating_prompt():
    first = decide_next_teaching_action(
        skill_id="student-learning/progressive-hint-ladder",
        message="不知道",
        stage="hint",
        recent_messages=[],
        task_state={"hint_level": 0},
        last_evidence={"confidence_before": 2},
    )
    second = decide_next_teaching_action(
        skill_id="student-learning/progressive-hint-ladder",
        message="还是不懂",
        stage="hint",
        recent_messages=[{"role": "agent", "content": first["prompt"]}],
        task_state={"hint_level": first["hint_level"]},
        last_evidence={"confidence_before": 2},
    )

    assert second["hint_level"] > first["hint_level"]
    assert second["prompt"] != first["prompt"]
    assert second["repeated_prompt_blocked"] is True
    assert second["skill_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert second["active_gate_id"] == "student-learning/stuck-and-error-diagnosis-coach"
    assert second["prompt_key"] == "diagnose_stuck"


def test_confidence_before_required_before_substantive_help():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="我访问的是 list[2]，长度是 2",
        stage="hint",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )

    assert action["state"] == "confidence_before_required"
    assert action["skill_id"] == "student-learning/confidence-calibration-check"
    assert action["active_gate_id"] == "student-learning/confidence-calibration-check"
    assert action["prompt_key"] == "confidence_before"
    assert action["confidence_before_required"] is True
    assert action["allow_direct_answer"] is False
    assert action["next_required_action"] == "collect_confidence_before"
    assert "confidence" in action["decision_reason"]


def test_retrieve_first_still_precedes_confidence_without_attempt():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="为什么我的 Python list 报 IndexError？",
        stage="start",
        recent_messages=[],
        task_state={},
        last_evidence={},
    )

    assert action["state"] == "retrieve_first"
    assert action["active_gate_id"] == "student-learning/retrieve-first-gate"
    assert action["confidence_before_required"] is False
    assert action["next_required_action"] == "student_attempt"


def test_teach_back_required_after_correct_index_reasoning():
    action = decide_next_teaching_action(
        skill_id="student-learning/teach-back-evaluator",
        message="这个规则要求操作和结果对应，因为当前代码会导致异常；例如输出和预期不一致，下一步检查证据。",
        stage="hint",
        recent_messages=[],
        task_state={},
        last_evidence={"confidence_before": 3},
    )

    assert action["state"] == "teach_back_required"
    assert action["skill_id"] == "student-learning/teach-back-evaluator"
    assert action["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert action["prompt_key"] == "teach_back_required"
    assert action["teach_back_required"] is True
    assert action["allow_direct_answer"] is False
    assert action["next_required_action"] == "teach_back"


def test_teach_back_evaluator_scores_good_and_poor_answers():
    good = decide_next_teaching_action(
        skill_id="student-learning/teach-back-evaluator",
        message="规则是操作必须满足教材条件，因为当前代码导致异常；例如这个代码片段的结果和预期不一致，下一步检查文档证据。",
        stage="teach_back",
        recent_messages=[],
        task_state={"teach_back_required": True},
        last_evidence={"confidence_before": 3},
    )
    poor = decide_next_teaching_action(
        skill_id="student-learning/teach-back-evaluator",
        message="就是会报错",
        stage="teach_back",
        recent_messages=[],
        task_state={"teach_back_required": True},
        last_evidence={"confidence_before": 3},
    )

    assert good["teach_back_score"] is not None
    assert poor["teach_back_score"] is not None
    assert good["teach_back_score"] > poor["teach_back_score"]
    assert good["teach_back_score"] >= 0.8
    assert poor["teach_back_score"] <= 0.4
    assert good["confidence_after_required"] is True
    assert good["skill_id"] == "student-learning/teach-back-evaluator"
    assert poor["skill_id"] == "student-learning/teach-back-evaluator"
    assert good["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert good["prompt_key"] == "confidence_after"


def test_allow_direct_answer_does_not_mean_answer_already_given_for_hint_ladder():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="还是不懂",
        stage="hint",
        recent_messages=[],
        task_state={"hint_level": 3},
        last_evidence={"confidence_before": 2},
    )

    assert action["state"] == "hint_level_4"
    assert action["skill_id"] == "student-learning/progressive-hint-ladder"
    assert action["active_gate_id"] == "student-learning/progressive-hint-ladder"
    assert action["prompt_key"] == "hint_level_4"
    assert action["allow_direct_answer"] is True
    assert action["direct_answer_given"] is False


def test_repeated_non_direct_hint_does_not_fallback_to_direct_answer_prompt():
    action = decide_next_teaching_action(
        skill_id="student-learning/progressive-hint-ladder",
        message="还是不懂",
        stage="hint",
        recent_messages=[],
        task_state={"hint_level": 2},
        last_evidence={
            "confidence_before": 2,
            "prompt_key": "hint_level_3",
        },
    )

    assert action["state"] == "hint_level_3"
    assert action["hint_level"] == 3
    assert action["allow_direct_answer"] is False
    assert action["prompt_key"] != "hint_level_4"
    assert "可以直接解释了" not in action["prompt"]
    assert "最大合法索引是 1，所以访问 index 2 会越界" not in action["prompt"]
    assert action["primary_skill_id"] == "student-learning/adaptive-python-workflow"
    assert action["active_gate_id"] == "student-learning/progressive-hint-ladder"


def test_index_attempt_recovered_high_hint_level_keeps_state_and_prompt_key_consistent():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="我访问的是 list[2]，长度是 2",
        stage="hint",
        recent_messages=[],
        task_state={},
        last_evidence={
            "confidence_before": 3,
            "hint_level": 4,
            "prompt_key": "hint_level_4",
        },
    )

    assert action["allow_direct_answer"] is False
    assert action["hint_level"] <= 3
    assert action["state"] == f"hint_level_{action['hint_level']}"
    assert action["prompt_key"] == action["state"]
    assert "可以直接解释了" not in action["prompt"]


def test_index_attempt_repeated_prompt_upgrade_keeps_state_and_prompt_key_consistent():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="我访问的是 list[2]，长度是 2",
        stage="hint",
        recent_messages=[],
        task_state={},
        last_evidence={
            "confidence_before": 3,
            "hint_level": 1,
            "prompt_key": "hint_level_1",
        },
    )

    assert action["allow_direct_answer"] is False
    assert action["state"] == action["prompt_key"]
    assert action["hint_level"] == 2
    assert action["state"] == "hint_level_2"


def test_stuck_repeated_prompt_upgrade_keeps_state_and_prompt_key_consistent():
    action = decide_next_teaching_action(
        skill_id="student-learning/progressive-hint-ladder",
        message="还是不懂",
        stage="hint",
        recent_messages=[],
        task_state={"hint_level": 1},
        last_evidence={
            "confidence_before": 2,
            "prompt_key": "diagnose_stuck",
        },
    )

    assert action["allow_direct_answer"] is False
    assert action["state"] == action["prompt_key"]
    assert action["hint_level"] == 3
    assert action["active_gate_id"] == "student-learning/progressive-hint-ladder"
    assert action["next_required_action"] == "apply_hint"


def test_teach_back_submission_precedes_confidence_gate_from_nested_evidence():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="规则是操作必须满足教材条件，因为当前代码导致异常；例如这个代码片段的结果和预期不一致，下一步检查文档证据。",
        stage="teach_back",
        recent_messages=[],
        task_state={},
        last_evidence={
            "pedagogical_workflow": {
                "state": "teach_back_required",
                "teach_back_required": True,
                "hint_level": 1,
            }
        },
    )

    assert action["state"] == "teach_back_evaluated"
    assert action["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert action["teach_back_score"] >= 0.8
    assert action["confidence_after_required"] is True


def test_teach_back_task_state_precedes_retrieve_first_even_at_start_stage():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="就是会报错",
        stage="start",
        recent_messages=[],
        task_state={"teach_back_required": True},
        last_evidence={"confidence_before": 3},
    )

    assert action["state"] == "teach_back_evaluated"
    assert action["active_gate_id"] == "student-learning/teach-back-evaluator"
    assert action["next_required_action"] == "repair_teach_back"
    assert action["teach_back_required"] is True
    assert action["allow_direct_answer"] is False


def test_poor_teach_back_keeps_direct_answer_disallowed():
    action = decide_next_teaching_action(
        skill_id="student-learning/teach-back-evaluator",
        message="就是会报错",
        stage="teach_back",
        recent_messages=[],
        task_state={"teach_back_required": True},
        last_evidence={"confidence_before": 3},
    )

    assert action["state"] == "teach_back_evaluated"
    assert action["teach_back_score"] <= 0.4
    assert action["teach_back_required"] is True
    assert action["allow_direct_answer"] is False
    assert action["direct_answer_given"] is False
    assert action["next_required_action"] == "repair_teach_back"
    assert "请再用自己的话补上" in action["prompt"]


def test_previous_full_response_restores_confidence_and_hint_level():
    action = decide_next_teaching_action(
        skill_id="student-learning/retrieve-first-gate",
        message="还是不懂",
        stage="hint",
        recent_messages=[],
        task_state={},
        last_evidence={
            "evidence": {"confidence_before": 2},
            "pedagogical_workflow": {
                "state": "diagnose_stuck",
                "hint_level": 2,
                "prompt_key": "diagnose_stuck",
            },
        },
    )

    assert action["state"] == "hint_level_3"
    assert action["active_gate_id"] == "student-learning/progressive-hint-ladder"
    assert action["hint_level"] == 3
    assert action["confidence_before_required"] is False
    assert action["prompt_key"] == "hint_level_3"


def test_recover_workflow_evidence_recurses_through_deep_previous_response():
    recovered = recover_workflow_evidence(
        {
            "last_evidence": {
                "evidence": {
                    "skill_state": {
                        "workflow": {
                            "pedagogical_workflow": {
                                "confidence_before": 4,
                                "hint_level": 2,
                                "state": "teach_back_required",
                                "teach_back_required": True,
                                "prompt_key": "teach_back_required",
                                "retrieve_first_done": True,
                            }
                        }
                    }
                }
            }
        }
    )

    assert recovered["confidence_before"] == 4
    assert recovered["hint_level"] == 2
    assert recovered["state"] == "teach_back_required"
    assert recovered["teach_back_required"] is True
    assert recovered["prompt_key"] == "teach_back_required"
    assert recovered["retrieve_first_done"] is True
