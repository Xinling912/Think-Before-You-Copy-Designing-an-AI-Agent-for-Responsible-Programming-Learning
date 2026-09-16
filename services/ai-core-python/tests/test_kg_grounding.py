import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.kg_catalog import load_kg_catalog
from app.kg_grounding import ground_question
from app import session


class FakeGroundingProvider:
    def __init__(self, response: dict) -> None:
        self.response = response
        self.prompts: list[str] = []

    def chat(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return json.dumps(self.response)


def write_fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    concepts_path = tmp_path / "concepts.yaml"
    edges_path = tmp_path / "edges.yaml"
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()
    concepts_path.write_text("concepts: []\n", encoding="utf-8")
    edges_path.write_text("edges: []\n", encoding="utf-8")
    (generated_dir / "python-docs-3.14.6-candidates.jsonl").write_text(
        "\n".join(
            json.dumps(row)
            for row in [
                {
                    "candidate_id": "dict-edge",
                    "source_id": "python-docs-3.14.6",
                    "source_chunk_id": "chunk-dict",
                    "source_url": "https://example.test/dict",
                    "subject": "Concept:dictionary_get",
                    "predicate": "contrasts_with",
                    "object": "Concept:key_lookup",
                    "confidence": 0.93,
                    "evidence_text": "dict.get returns a default when a key is missing; d[key] raises KeyError.",
                },
                {
                    "candidate_id": "float-edge",
                    "source_id": "python-docs-3.14.6",
                    "source_chunk_id": "chunk-float",
                    "source_url": "https://example.test/float",
                    "subject": "Concept:floating_point",
                    "predicate": "can_have",
                    "object": "Concept:representation_error",
                    "confidence": 0.9,
                    "evidence_text": "Decimal fractions like 0.1 cannot be represented exactly as binary floating point.",
                },
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return concepts_path, edges_path, generated_dir


def test_grounding_uses_provider_selected_candidate_node_ids(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = write_fixture(tmp_path)
    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)
    provider = FakeGroundingProvider(
        {
            "selected_node_ids": ["Concept:dictionary_get", "Concept:key_lookup"],
            "source_node_id": "Concept:dictionary_get",
            "target_node_id": "Concept:key_lookup",
            "confidence": 0.82,
            "reason": "Question asks about dict.get versus d[key].",
        }
    )

    result = ground_question("dict.get 和 d[key] 有什么区别？", catalog, chat_provider=provider)

    assert result["kg_gap"] is False
    assert result["method"] == "qwen_kg_grounding"
    assert result["topic_id"] == "Concept:dictionary_get"
    assert result["selected_node_ids"] == ["Concept:dictionary_get", "Concept:key_lookup"]
    assert "Concept:dictionary_get" in provider.prompts[0]
    assert result["path"] == ["Concept:dictionary_get", "Concept:key_lookup"]


def test_grounding_rejects_invented_provider_ids_and_falls_back(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = write_fixture(tmp_path)
    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)
    provider = FakeGroundingProvider(
        {
            "selected_node_ids": ["Concept:invented"],
            "source_node_id": "Concept:invented",
            "target_node_id": "Concept:key_lookup",
            "confidence": 0.99,
            "reason": "Invented node should be ignored.",
        }
    )

    result = ground_question("why is 0.1 plus 0.2 weird in Python?", catalog, chat_provider=provider)

    assert result["kg_gap"] is False
    assert result["method"] == "catalog_similarity_fallback"
    assert result["topic_id"] == "Concept:floating_point"
    assert result["selected_node_ids"][0] == "Concept:floating_point"
    assert result["reason"].startswith("Provider selected node IDs outside")


def test_grounding_returns_kg_gap_when_catalog_has_no_support(tmp_path: Path) -> None:
    concepts_path, edges_path, generated_dir = write_fixture(tmp_path)
    catalog = load_kg_catalog(concepts_path, edges_path, generated_dir)

    result = ground_question("正则 re.match 和 re.search 怎么区别？", catalog, chat_provider=None)

    assert result["kg_gap"] is True
    assert result["topic_id"].startswith("kg_gap:")
    assert result["candidate_nodes"] == []
    assert result["path"] == []


def test_non_error_concept_question_does_not_fallback_to_error_path() -> None:
    catalog = load_kg_catalog()

    result = ground_question("while 循环什么时候停止？", catalog, chat_provider=None)

    assert result["kg_gap"] is False
    assert result["topic_id"] == "Concept:while_loop"
    assert result["source_node_id"] == "Concept:while_loop"
    assert result["target_node_id"] == "Concept:while_loop"
    assert result["path"] == ["Concept:while_loop"]
    assert all(not node_id.startswith("ErrorType:") for node_id in result["selected_node_ids"])


def test_chinese_out_of_range_question_maps_to_index_range_kg_nodes() -> None:
    catalog = load_kg_catalog()

    result = ground_question("我不知道怎么判断是不是越界", catalog, chat_provider=None)

    assert result["kg_gap"] is False
    assert "Concept:valid_index_range" in result["selected_node_ids"] or "Concept:valid_index_range" in result["path"]
    assert result["path"]


def test_demo_questions_have_complete_knowledge_path_views() -> None:
    prompts = [
        "I met IndexError in my list.",
        "my list length is 4, why list[4] fails?",
        "how to get the last item with len(list) - 1?",
        "how do I use a for loop over a list?",
        "should I use range(len(list))?",
        "what is the difference between parameter and argument?",
        "why assignment is not equality?",
        "why do I get NameError?",
        "why do I get TypeError mixing string and int?",
        "why SyntaxError after if statement?",
    ]
    for prompt in prompts:
        trace = session._trace_kg_grounding(ground_question(prompt))
        view = trace["knowledge_path_view"]
        assert view["upstream"], prompt
        assert view["current"], prompt
        assert view["downstream"], prompt


def test_beginner_curriculum_questions_select_named_source_backed_paths() -> None:
    prompts = [
        "Why does list[4] fail when the list length is 4?",
        "How do I get the last item in a list?",
        "What is the difference between a list and a tuple?",
        "How do I access a dictionary value by key?",
        "When should I use for versus while?",
        "Why does range(len(items)) work?",
        "What is the difference between a parameter and an argument?",
        "Why do I get NameError?",
        "Why do I get TypeError when adding text and a number?",
        "How do I read a text file line by line?",
    ]

    for prompt in prompts:
        result = ground_question(prompt)
        path_view = result["curriculum_path"]
        assert path_view["path_id"].startswith("path-"), prompt
        assert path_view["source_url"].startswith("https://"), prompt
        assert path_view["upstream"], prompt
        assert path_view["focus"], prompt
        assert path_view["downstream"], prompt


def test_current_question_function_is_not_overridden_by_set_history() -> None:
    result = ground_question(
        "what is a function?",
        current_concept_hints=["Concept:function"],
        historical_concept_ids=["Concept:set"],
    )

    trace = session._trace_kg_grounding(result)

    assert [node["id"] for node in trace["knowledge_path_view"]["current"]] == ["Concept:function"]
    assert trace["focus_source"] == "current_question"


def test_valid_requested_focus_becomes_the_single_current_node() -> None:
    result = ground_question(
        "what is a set?",
        requested_focus_node_id="Concept:function",
    )

    trace = session._trace_kg_grounding(result)

    assert result["topic_id"] == "Concept:function"
    assert result["source_node_id"] == "Concept:function"
    assert result["target_node_id"] == "Concept:function"
    assert result["selected_node_ids"] == ["Concept:function"]
    assert result["requested_focus_node_id"] == "Concept:function"
    assert trace["focus_source"] == "explicit"
    assert [node["id"] for node in trace["knowledge_path_view"]["current"]] == ["Concept:function"]


def test_trace_neighbors_are_real_incoming_and_outgoing_edges() -> None:
    catalog = load_kg_catalog()
    result = ground_question(
        "explain functions",
        catalog,
        requested_focus_node_id="Concept:function",
    )

    trace = session._trace_kg_grounding(result, catalog=catalog)
    view = trace["knowledge_path_view"]
    current_id = view["current"][0]["id"]
    upstream_ids = {node["id"] for node in view["upstream"]}
    downstream_ids = {node["id"] for node in view["downstream"]}
    real_edges = {(edge.source, edge.predicate, edge.target) for edge in catalog.edges}

    assert current_id == "Concept:function"
    assert upstream_ids
    assert downstream_ids
    assert all((edge["from"], edge["relation"], edge["to"]) in real_edges for edge in view["edges"])
    assert all(edge["to"] == current_id for edge in view["edges"] if edge["from"] in upstream_ids)
    assert all(edge["from"] == current_id for edge in view["edges"] if edge["to"] in downstream_ids)


def test_curriculum_path_never_overrides_grounded_current() -> None:
    trace = session._trace_kg_grounding(
        {
            "topic_id": "Concept:function",
            "source_node_id": "Concept:function",
            "target_node_id": "Concept:function",
            "selected_node_ids": ["Concept:function"],
            "path": ["Concept:function"],
            "path_edges": [],
            "focus_source": "current_question",
            "requested_focus_node_id": None,
            "curriculum_path": {
                "path_id": "unrelated-set-path",
                "path_label": "Sets",
                "upstream": ["Concept:dict"],
                "focus": ["Concept:set"],
                "downstream": ["Concept:key"],
                "source_url": "https://example.test/sets",
            },
        }
    )

    assert [node["id"] for node in trace["knowledge_path_view"]["current"]] == ["Concept:function"]
    assert trace["knowledge_path_view"].get("path_id") is None
