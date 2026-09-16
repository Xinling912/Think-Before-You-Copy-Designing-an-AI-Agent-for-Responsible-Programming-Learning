import pytest
from fastapi.testclient import TestClient

from app import rag
from app import main as ai_main
from app.main import app


class FakeEmbeddingProvider:
    provider = "dashscope"
    model = "text-embedding-v4"
    dimensions = 4

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            if "if Statements" in text:
                vectors.append([1.0, 0.0, 0.0, 0.0])
            elif "while" in text:
                vectors.append([0.0, 1.0, 0.0, 0.0])
            elif "More on Lists" in text:
                vectors.append([0.0, 0.0, 1.0, 0.0])
            else:
                vectors.append([0.0, 0.0, 0.0, 1.0])
        return vectors

    def embed_query(self, text: str) -> list[float]:
        if "if" in text:
            return [1.0, 0.0, 0.0, 0.0]
        if "while" in text:
            return [0.0, 1.0, 0.0, 0.0]
        return [0.0, 0.0, 1.0, 0.0]


class FakeReranker:
    provider = "dashscope"
    model = "qwen3-rerank"

    def rerank(self, query: str, documents: list[str], top_n: int) -> list[dict]:
        scores = []
        for index, document in enumerate(documents):
            if "4.1. if Statements" in document:
                score = 0.99
            elif "5.1. More on Lists" in document:
                score = 0.85
            else:
                score = 0.2
            scores.append({"index": index, "relevance_score": score})
        return sorted(scores, key=lambda item: item["relevance_score"], reverse=True)[:top_n]


def sample_chunks() -> list[dict]:
    return [
        {
            "source_id": "python-docs-3.14.6",
            "chunk_id": "if-statements",
            "doc_id": "tutorial:controlflow",
            "title": "4.1. if Statements",
            "heading_path": ["4. More Control Flow Tools", "4.1. if Statements"],
            "source_url": "https://docs.python.org/3/tutorial/controlflow.html#if-statements",
            "text": "4.1. if Statements\nPython if statements select a block when a condition is true.",
            "quality_flags": ["official_source", "python_docs"],
        },
        {
            "source_id": "python-docs-3.14.6",
            "chunk_id": "while-loop",
            "doc_id": "tutorial:introduction",
            "title": "3.2. First Steps Towards Programming",
            "heading_path": ["3. An Informal Introduction to Python", "3.2. First Steps Towards Programming"],
            "source_url": "https://docs.python.org/3/tutorial/introduction.html#first-steps-towards-programming",
            "text": "The while loop executes as long as the condition remains true.",
            "quality_flags": ["official_source", "python_docs"],
        },
        {
            "source_id": "python-docs-3.14.6",
            "chunk_id": "more-on-lists",
            "doc_id": "tutorial:datastructures",
            "title": "5.1. More on Lists",
            "heading_path": ["5. Data Structures", "5.1. More on Lists"],
            "source_url": "https://docs.python.org/3/tutorial/datastructures.html#more-on-lists",
            "text": "Lists are zero-based. Accessing an index outside the valid range raises IndexError.",
            "quality_flags": ["official_source", "python_docs"],
        },
    ]


def test_build_semantic_index_writes_dashscope_manifest_and_docstore(tmp_path):
    manifest = rag.build_semantic_index(
        chunks=sample_chunks(),
        index_dir=tmp_path,
        embedding_provider=FakeEmbeddingProvider(),
    )

    assert manifest["retrieval_mode"] == "semantic-vector-rerank"
    assert manifest["embedding_provider"] == "dashscope"
    assert manifest["embedding_model"] == "text-embedding-v4"
    assert manifest["dimensions"] == 4
    assert manifest["document_count"] == 3
    assert (tmp_path / "faiss.index").is_file()
    assert (tmp_path / "docstore.jsonl").is_file()
    assert (tmp_path / "manifest.json").is_file()
    assert not (tmp_path / "local_vector_index.json").exists()


def test_load_chunks_can_filter_by_source(monkeypatch, tmp_path):
    source_a = tmp_path / "source-a"
    source_b = tmp_path / "source-b"
    source_a.mkdir()
    source_b.mkdir()
    (source_a / "chunks.jsonl").write_text(
        '{"source_id":"source-a","chunk_id":"a1","doc_id":"a","title":"A","heading_path":[],"source_url":"https://a","text":"alpha","quality_flags":[]}\n',
        encoding="utf-8",
    )
    (source_b / "chunks.jsonl").write_text(
        '{"source_id":"source-b","chunk_id":"b1","doc_id":"b","title":"B","heading_path":[],"source_url":"https://b","text":"beta","quality_flags":[]}\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(rag, "PROCESSED_SOURCE_DIRS", {"source-a": source_a, "source-b": source_b})

    chunks = rag.load_chunks(source_ids=["source-b"])

    assert [chunk["chunk_id"] for chunk in chunks] == ["b1"]


def test_public_chunk_exposes_source_provenance():
    chunk = {
        "source_id": "py4e-html3",
        "source_license_note": "creative-commons-source",
        "chunk_id": "py4e-html3-demo",
        "doc_id": "py4e-html3/demo",
        "title": "Variables",
        "heading_path": ["Variables"],
        "source_url": "https://www.py4e.com/html3/02-variables.htm",
        "text": "Variables store values.",
        "quality_flags": ["py4e_html3"],
    }

    public = rag.public_chunk(chunk, embedding_score=0.5, rerank_score=0.7)

    assert public["source_id"] == "py4e-html3"
    assert public["source"] == "py4e-html3"
    assert public["source_license_note"] == "creative-commons-source"


def test_rag_search_uses_semantic_embedding_and_reranker(monkeypatch, tmp_path):
    rag.build_semantic_index(
        chunks=sample_chunks(),
        index_dir=tmp_path,
        embedding_provider=FakeEmbeddingProvider(),
    )
    monkeypatch.setattr(rag, "INDEX_DIR", tmp_path)
    monkeypatch.setattr(rag, "get_embedding_provider", lambda: FakeEmbeddingProvider())
    monkeypatch.setattr(rag, "get_reranker", lambda: FakeReranker())
    rag.load_semantic_index.cache_clear()

    response = rag.search_chunks("if怎么写啊", top_k=2)

    assert response["retrieval_mode"] == "semantic-vector-rerank"
    assert response["index"]["backend"] == "faiss-flat-ip"
    assert response["index"]["embedding_provider"] == "dashscope"
    assert response["index"]["embedding_model"] == "text-embedding-v4"
    assert response["reranker"]["enabled"] is True
    assert response["reranker"]["model"] == "qwen3-rerank"
    assert response["chunks"][0]["title"] == "4.1. if Statements"
    assert response["chunks"][0]["embedding_score"] > 0
    assert response["chunks"][0]["rerank_score"] == 0.99


def test_rag_search_can_use_named_index(monkeypatch, tmp_path):
    named_index_dir = tmp_path / "indexes" / "custom-index"
    rag.build_semantic_index(
        chunks=sample_chunks(),
        index_dir=named_index_dir,
        embedding_provider=FakeEmbeddingProvider(),
        index_name="custom-index",
    )
    monkeypatch.setattr(rag, "INDEX_ROOT", tmp_path / "indexes")
    monkeypatch.setattr(rag, "get_embedding_provider", lambda: FakeEmbeddingProvider())
    monkeypatch.setattr(rag, "get_reranker", lambda: FakeReranker())
    rag.load_semantic_index.cache_clear()

    response = rag.search_chunks("if怎么写啊", top_k=1, index_name="custom-index")

    assert response["index"]["version"] == "custom-index"
    assert response["chunks"][0]["title"] == "4.1. if Statements"


def test_query_text_expands_concept_ids_into_search_terms():
    text = rag.query_text("索引是什么", {"Concept:list", "Concept:index", "Concept:valid_index_range"})

    assert "Concept:list" not in text
    assert "list" in text
    assert "index" in text
    assert "valid index range" in text


def test_rag_search_refuses_legacy_hash_index(monkeypatch, tmp_path):
    (tmp_path / "local_vector_index.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(rag, "INDEX_DIR", tmp_path)
    rag.load_semantic_index.cache_clear()

    with pytest.raises(rag.RAGIndexNotReadyError, match="semantic DashScope embedding index"):
        rag.search_chunks("IndexError")


def test_rag_endpoint_returns_rerank_metadata(monkeypatch, tmp_path):
    rag.build_semantic_index(
        chunks=sample_chunks(),
        index_dir=tmp_path,
        embedding_provider=FakeEmbeddingProvider(),
    )
    monkeypatch.setattr(rag, "INDEX_DIR", tmp_path)
    monkeypatch.setattr(rag, "get_embedding_provider", lambda: FakeEmbeddingProvider())
    monkeypatch.setattr(rag, "get_reranker", lambda: FakeReranker())
    rag.load_semantic_index.cache_clear()
    client = TestClient(app)

    response = client.post("/ai/rag/search", json={"query": "if怎么写啊", "top_k": 2})

    assert response.status_code == 200
    body = response.json()
    assert body["retrieval_mode"] == "semantic-vector-rerank"
    assert body["reranker"]["enabled"] is True
    assert body["chunks"][0]["title"] == "4.1. if Statements"


def test_rag_endpoint_forwards_source_ids_and_index_name(monkeypatch):
    captured = {}

    def fake_search_chunks(query, concepts=None, top_k=5, source_ids=None, index_name=None):
        captured.update(
            {
                "query": query,
                "concepts": concepts,
                "top_k": top_k,
                "source_ids": source_ids,
                "index_name": index_name,
            }
        )
        return {"chunks": [], "retrieval_mode": "semantic-vector-rerank"}

    monkeypatch.setattr(ai_main, "search_chunks", fake_search_chunks)
    client = TestClient(app)

    response = client.post(
        "/ai/rag/search",
        json={
            "query": "list 越界",
            "concepts": ["Concept:list"],
            "top_k": 2,
            "source_ids": ["runoob-python3"],
            "index_name": "python-learning-multisource-v1",
        },
    )

    assert response.status_code == 200
    assert captured == {
        "query": "list 越界",
        "concepts": ["Concept:list"],
        "top_k": 2,
        "source_ids": ["runoob-python3"],
        "index_name": "python-learning-multisource-v1",
    }
