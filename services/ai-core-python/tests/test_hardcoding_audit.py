from __future__ import annotations

import ast
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = SERVICE_ROOT / "app"


def _read_app_source(filename: str) -> str:
    return (APP_ROOT / filename).read_text(encoding="utf-8")


def _parse_app(filename: str) -> ast.Module:
    return ast.parse(_read_app_source(filename), filename=str(APP_ROOT / filename))


def _function_node(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} not found")


def _names_in(node: ast.AST) -> set[str]:
    return {item.id for item in ast.walk(node) if isinstance(item, ast.Name)}


def _calls_in(node: ast.AST, function_name: str) -> list[ast.Call]:
    calls: list[ast.Call] = []
    for item in ast.walk(node):
        if not isinstance(item, ast.Call):
            continue
        if isinstance(item.func, ast.Name) and item.func.id == function_name:
            calls.append(item)
        elif isinstance(item.func, ast.Attribute) and item.func.attr == function_name:
            calls.append(item)
    return calls


def _string_constants(node: ast.AST) -> list[str]:
    return [item.value for item in ast.walk(node) if isinstance(item, ast.Constant) and isinstance(item.value, str)]


def test_query_understanding_does_not_filter_runtime_concepts_through_known_hints():
    tree = _parse_app("query_understanding.py")
    runtime_functions = [
        "understand_query",
        "normalize_understanding_payload",
        "fallback_understanding",
        "enrich_rewrite_with_project_rules",
    ]

    offenders = [
        function_name
        for function_name in runtime_functions
        if "KNOWN_CONCEPT_HINTS" in _names_in(_function_node(tree, function_name))
    ]

    assert offenders == [], (
        "KNOWN_CONCEPT_HINTS may exist only as legacy compatibility data; "
        f"runtime query understanding paths still reference it in {offenders}."
    )


def test_query_understanding_has_no_topic_specific_branches_injecting_concept_ids():
    source = _read_app_source("query_understanding.py")
    tree = ast.parse(source)
    topic_markers = ("while", "range", "switch", "case", "list", "indexerror", "索引", "下标", "越界")
    runtime_functions = [
        "understand_query",
        "normalize_understanding_payload",
        "fallback_understanding",
        "enrich_rewrite_with_project_rules",
    ]
    offenders: list[str] = []

    for function_name in runtime_functions:
        function = _function_node(tree, function_name)
        for node in ast.walk(function):
            if not isinstance(node, ast.If):
                continue
            condition = ast.get_source_segment(source, node.test) or ""
            body = "\n".join(ast.get_source_segment(source, child) or "" for child in node.body)
            if any(marker in condition.lower() for marker in topic_markers) and (
                "Concept:" in body or "ErrorType:" in body
            ):
                offenders.append(f"{function_name}:{node.lineno}")

    assert offenders == [], (
        "Topic-specific branches must not inject fixed KG IDs for while/range/switch/list/IndexError; "
        f"found branches at {offenders}."
    )


def test_session_does_not_default_to_indexerror_topic_or_reasoning_path():
    source = _read_app_source("session.py")
    tree = ast.parse(source)

    assert "INDEX_ERROR_TOPIC" not in source, (
        "session.py must derive topic_id from dynamic KG grounding or kg_gap, "
        "not import/use INDEX_ERROR_TOPIC."
    )

    default_calls: list[int] = []
    for call in _calls_in(tree, "reason_about_target"):
        first_arg = call.args[0] if call.args else None
        source_kw = next((kw.value for kw in call.keywords if kw.arg == "source"), None)
        if (
            isinstance(first_arg, ast.Constant)
            and first_arg.value == "IndexError"
            and isinstance(source_kw, ast.Constant)
            and source_kw.value == "Concept:list"
        ):
            default_calls.append(call.lineno)

    assert default_calls == [], (
        'session.py must not call reason_about_target("IndexError", source="Concept:list") '
        f"as a runtime default; found calls at {default_calls}."
    )


def test_kg_loads_generated_inputs_broadly_and_keeps_generated_nodes_first_class():
    source = _read_app_source("kg.py")
    tree = ast.parse(source)

    assert "GENERATED_CANDIDATES_PATH" not in source, (
        "kg.py must not use one GENERATED_CANDIDATES_PATH as the only generated KG input; "
        "load all generated candidate files instead."
    )

    discarding_branches: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        condition = ast.get_source_segment(source, node.test) or ""
        body = "\n".join(ast.get_source_segment(source, child) or "" for child in node.body)
        if "not in concepts" in condition and "continue" in body:
            discarding_branches.append(node.lineno)

    assert discarding_branches == [], (
        "Generated candidate nodes must not be discarded merely because they are absent from kg/concepts.yaml; "
        f"found discard branches at {discarding_branches}."
    )


def test_rag_uses_kg_catalog_not_fixed_concept_tables():
    source = _read_app_source("rag.py")
    assert "CONCEPT_RULES" not in source
    assert "CONCEPT_QUERY_TERMS" not in source
    assert "load_kg_catalog" in source


def test_kg_reason_request_does_not_default_to_list_source():
    source = _read_app_source("schemas.py")
    assert 'source: str = "Concept:list"' not in source
    assert "source: str | None" in source


def test_session_direct_answer_guardrail_is_not_index_range_specific():
    tree = _parse_app("session.py")
    guardrail = _function_node(tree, "_looks_like_direct_answer")
    guardrail_source = ast.get_source_segment(_read_app_source("session.py"), guardrail) or ""
    guardrail_literals = set(_string_constants(guardrail))
    forbidden_literals = {
        "超出范围",
        "越界",
        "outofrange",
        "out of range",
        "合法索引是",
        "合法索引",
        "索引范围",
        "从0开始",
        "从零开始",
        "0和1",
        "只能用",
        "会报错",
    }
    assert guardrail_literals.isdisjoint(forbidden_literals)
    forbidden_source_markers = (
        "boundary_phrase",
        "range_phrase",
        "valid_answer_phrase",
        '"越" + "界"',
        '"out" + "of" + "range"',
        '"合法" + "索引"',
    )
    assert not any(marker in guardrail_source for marker in forbidden_source_markers)


def test_kg_extraction_uses_catalog_or_llm_not_topic_rule_table():
    source = _read_app_source("kg_extraction.py")
    assert "RULES:" not in source
    assert "ExtractionRule(" not in source
    assert "load_kg_catalog" in source


def test_memory_has_no_indexerror_list_fallback_defaults():
    source = _read_app_source("memory.py")
    tree = ast.parse(source)
    forbidden_literals = {"list_index_indexerror", "list[2]"}
    literal_hits = {
        literal
        for literal in _string_constants(tree)
        for forbidden in forbidden_literals
        if forbidden in literal
    }

    assert literal_hits == set(), (
        "memory.py must not contain IndexError/list fallback memory defaults such as "
        f"{sorted(forbidden_literals)}; found {sorted(literal_hits)}."
    )

    default_offenders: list[str] = []
    for function in [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]:
        defaults = list(function.args.defaults) + [default for default in function.args.kw_defaults if default]
        if any(isinstance(default, ast.Name) and default.id == "INDEX_ERROR_TOPIC" for default in defaults):
            default_offenders.append(function.name)
        for node in ast.walk(function):
            if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
                if any(isinstance(value, ast.Name) and value.id == "INDEX_ERROR_TOPIC" for value in node.values):
                    default_offenders.append(function.name)

    assert default_offenders == [], (
        "memory.py must not use INDEX_ERROR_TOPIC as fallback/default logic; "
        f"found offenders in {sorted(set(default_offenders))}."
    )


def test_pedagogy_has_no_unguarded_indexerror_or_list_default_prompts():
    source = _read_app_source("pedagogy.py")
    tree = ast.parse(source)
    forbidden_prompt_markers = (
        "IndexError",
        "list[2]",
        "长度为 2",
        "长度为2",
        "合法索引",
        "索引越界",
        "list length",
        "accessed index",
    )
    allowed_registry_name_markers = ("KG", "GROUND", "TOPIC", "REGISTRY")
    offenders: list[str] = []

    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        target_names = [
            target.id
            for target in targets
            if isinstance(target, ast.Name)
        ]
        if not target_names:
            continue
        strings = _string_constants(node)
        if not any(any(marker in value for marker in forbidden_prompt_markers) for value in strings):
            continue
        if any(
            all(marker in name.upper() for marker in allowed_registry_name_markers)
            for name in target_names
        ):
            continue
        offenders.extend(f"{name}:{node.lineno}" for name in target_names)

    assert offenders == [], (
        "IndexError/list prompts may only live behind KG-grounded topic registries, "
        f"not unguarded defaults; found {offenders}."
    )


def test_pedagogy_runtime_detectors_are_not_index_specific():
    source = _read_app_source("pedagogy.py")
    tree = ast.parse(source)
    detector_names = {
        "_has_student_attempt",
        "_has_substantive_reasoning",
        "_score_teach_back",
    }
    detector_literals = set()
    detector_source = ""
    for name in detector_names:
        node = _function_node(tree, name)
        detector_literals.update(_string_constants(node))
        detector_source += ast.get_source_segment(source, node) or ""

    forbidden_literals = {
        "访问",
        "长度",
        "范围",
        "合法",
        "小于",
        "最大",
        "最小",
        "从0开始",
        "从零开始",
        "0和1",
        "0,1",
        "0、1",
        "list[2]",
        "IndexError",
    }
    assert detector_literals.isdisjoint(forbidden_literals)
    assert "Concept:list" not in detector_source
    assert "ErrorType:IndexError" not in detector_source


def test_test_center_has_no_fixed_catalog_difficulty_prompts_or_question_bank():
    source = _read_app_source("test_center.py")
    tree = ast.parse(source)
    forbidden_identifiers = {
        "QUESTION_BANK",
        "FIXED_QUESTIONS",
        "EXPECTED_ANSWERS",
        "questionBank",
        "fixedQuestions",
        "testTopics",
        "testDifficultyPrompts",
    }
    identifiers = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}

    assert identifiers.isdisjoint(forbidden_identifiers)
    assert "python_syntax_program_structure" not in source
    assert "Generate one English multiple-choice question that checks whether" not in source
