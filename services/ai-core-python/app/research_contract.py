REQUIRED_MECHANISMS = {
    "mem0_operations": ["ADD", "UPDATE", "DELETE", "NOOP"],
    "memorybank_decay": ["strength", "use_count", "last_used_at", "effective_score"],
    "rmm_reflection": ["topic_summary", "prospective_memory_plan", "retrospective_memory_use"],
    "zep_temporal_memory": ["episode", "fact", "valid_from", "valid_to", "status"],
    "ain_kg_extraction": ["source_chunk_id", "predicate", "confidence"],
    "hint_factory": ["hint_level", "hint_ladder"],
    "cognitive_forcing": ["requires_student_attempt", "direct_answer_given"],
    "metacognition": ["confidence_before", "confidence_after"],
    "teach_back": ["teach_back_required", "teach_back_score"],
}


def missing_mechanisms(payload: dict) -> list[str]:
    missing = []
    for mechanism, keys in REQUIRED_MECHANISMS.items():
        if not any(key in str(payload) for key in keys):
            missing.append(mechanism)
    return missing
