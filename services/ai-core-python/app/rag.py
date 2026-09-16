from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Protocol

try:
    import faiss
    import numpy as np
except Exception:  # pragma: no cover - faiss is required for runtime, optional for import diagnostics.
    faiss = None
    np = None

from app.dashscope import DashScopeEmbeddingProvider, DashScopeReranker
from app.kg_catalog import KGCatalog, load_kg_catalog


REPO_ROOT = Path(__file__).resolve().parents[3]
CORPUS_DIR = REPO_ROOT / "data" / "processed" / "python-docs-3.14.6"
PROCESSED_SOURCE_DIRS = {
    "python-docs-3.14.6": REPO_ROOT / "data" / "processed" / "python-docs-3.14.6",
    "think-python-2e": REPO_ROOT / "data" / "processed" / "think-python-2e",
    "py4e-html3": REPO_ROOT / "data" / "processed" / "py4e-html3",
    "runoob-python3": REPO_ROOT / "data" / "processed" / "runoob-python3",
}
DEFAULT_INDEX_NAME = "python-learning-multisource-v1"
INDEX_ROOT = REPO_ROOT / "data" / "indexes"
INDEX_DIR = INDEX_ROOT / DEFAULT_INDEX_NAME
RETRIEVAL_MODE = "semantic-vector-rerank"
INDEX_BACKEND = "faiss-flat-ip"
INDEX_SCHEMA_VERSION = 3


class EmbeddingProvider(Protocol):
    provider: str
    model: str
    dimensions: int

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        ...

    def embed_query(self, text: str) -> list[float]:
        ...


class Reranker(Protocol):
    provider: str
    model: str

    def rerank(self, query: str, documents: list[str], top_n: int) -> list[dict]:
        ...


class RAGIndexNotReadyError(RuntimeError):
    pass


def manifest_path(index_dir: Path | None = None) -> Path:
    return (index_dir or INDEX_DIR) / "manifest.json"


def docstore_path(index_dir: Path | None = None) -> Path:
    return (index_dir or INDEX_DIR) / "docstore.jsonl"


def faiss_path(index_dir: Path | None = None) -> Path:
    return (index_dir or INDEX_DIR) / "faiss.index"


def display_path(path: Path) -> str:
    if path.is_relative_to(REPO_ROOT):
        return str(path.relative_to(REPO_ROOT))
    return str(path)


def index_dir_for(index_name: str = DEFAULT_INDEX_NAME) -> Path:
    if not index_name or index_name == DEFAULT_INDEX_NAME:
        return INDEX_DIR
    return INDEX_ROOT / index_name


def strip_code_fences(text: str) -> str:
    return re.sub(r"```.*?```", " ", text, flags=re.DOTALL)


def semantic_text(chunk: dict) -> str:
    return "\n".join(
        [
            chunk.get("title", ""),
            " > ".join(chunk.get("heading_path", [])),
            strip_code_fences(chunk.get("text", "")),
        ],
    ).strip()


def rerank_text(chunk: dict) -> str:
    text = chunk.get("text", "")
    if len(text) > 2800:
        text = text[:2800]
    return "\n".join(
        [
            chunk.get("title", ""),
            " > ".join(chunk.get("heading_path", [])),
            text,
        ],
    ).strip()


@lru_cache(maxsize=1)
def kg_catalog_for_rag() -> KGCatalog:
    return load_kg_catalog()


def _catalog_hits(text: str, *, top_k: int = 8, min_score: float = 0.08) -> list[str]:
    try:
        hits = kg_catalog_for_rag().search(text, top_k=top_k, min_score=min_score)
    except Exception:
        return []
    return [
        hit.node.node_id
        for hit in hits
        if hit.node.node_type in {"Concept", "ErrorType", "Misconception", "Function", "Statement", "Practice"}
    ]


def infer_concepts(chunk: dict) -> list[str]:
    return _catalog_hits(semantic_text(chunk), top_k=10)


def infer_query_concepts(query: str) -> list[str]:
    return _catalog_hits(query, top_k=8)


def load_chunks(source_ids: list[str] | None = None) -> list[dict]:
    chunks = []
    selected_source_ids = source_ids or list(PROCESSED_SOURCE_DIRS)
    for source_id in selected_source_ids:
        source_dir = PROCESSED_SOURCE_DIRS.get(source_id)
        if source_dir is None:
            raise RAGIndexNotReadyError(f"Unknown corpus source: {source_id}")
        chunks_path = source_dir / "chunks.jsonl"
        if not chunks_path.is_file():
            continue
        with chunks_path.open(encoding="utf-8") as file:
            for line in file:
                if line.strip():
                    chunk = json.loads(line)
                    chunk.setdefault("source_id", source_id)
                    chunk["concepts"] = infer_concepts(chunk)
                    chunks.append(chunk)
    return chunks


def normalize_vector(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def batched(items: list[str], batch_size: int) -> list[list[str]]:
    return [items[index:index + batch_size] for index in range(0, len(items), batch_size)]


def get_embedding_provider() -> EmbeddingProvider:
    return DashScopeEmbeddingProvider()


def get_reranker() -> Reranker:
    return DashScopeReranker()


def public_chunk(chunk: dict, embedding_score: float, rerank_score: float | None = None) -> dict:
    score = rerank_score if rerank_score is not None else embedding_score
    source_id = chunk.get("source_id") or chunk.get("source") or "python-docs-3.14.6"
    return {
        "source_id": source_id,
        "chunk_id": chunk["chunk_id"],
        "doc_id": chunk["doc_id"],
        "title": chunk["title"],
        "heading_path": chunk.get("heading_path", []),
        "source_url": chunk["source_url"],
        "source": source_id,
        "source_license_note": chunk.get("source_license_note") or chunk.get("license"),
        "text": chunk["text"],
        "score": round(float(score), 6),
        "embedding_score": round(float(embedding_score), 6),
        "rerank_score": round(float(rerank_score), 6) if rerank_score is not None else None,
        "concepts": chunk.get("concepts", []),
        "quality_flags": chunk.get("quality_flags", []),
    }


def build_semantic_index(
    chunks: list[dict] | None = None,
    index_dir: Path | None = None,
    embedding_provider: EmbeddingProvider | None = None,
    batch_size: int = 10,
    source_ids: list[str] | None = None,
    index_name: str = DEFAULT_INDEX_NAME,
) -> dict:
    if faiss is None or np is None:
        raise RAGIndexNotReadyError("faiss-cpu is required to build the semantic DashScope embedding index.")
    target_dir = index_dir or index_dir_for(index_name)
    provider = embedding_provider or get_embedding_provider()
    source_chunks = chunks or load_chunks(source_ids=source_ids)
    documents = []
    texts = []
    for position, chunk in enumerate(source_chunks):
        normalized_chunk = dict(chunk)
        normalized_chunk["concepts"] = normalized_chunk.get("concepts") or infer_concepts(normalized_chunk)
        documents.append(
            {
                "index": position,
                "chunk": normalized_chunk,
                "embedding_text": semantic_text(normalized_chunk),
            },
        )
        texts.append(semantic_text(normalized_chunk))

    vectors = []
    for text_batch in batched(texts, batch_size):
        vectors.extend(provider.embed_documents(text_batch))
    if len(vectors) != len(documents):
        raise RAGIndexNotReadyError(
            f"Embedding provider returned {len(vectors)} vectors for {len(documents)} chunks.",
        )
    normalized_vectors = [normalize_vector([float(value) for value in vector]) for vector in vectors]
    matrix = np.array(normalized_vectors, dtype="float32")
    index = faiss.IndexFlatIP(provider.dimensions)
    index.add(matrix)

    source_counts: dict[str, int] = {}
    for document in documents:
        source_id = document["chunk"].get("source_id") or "unknown"
        source_counts[source_id] = source_counts.get(source_id, 0) + 1
    manifest_source_ids = source_ids or list(source_counts)
    if source_ids:
        source_counts = {source_id: source_counts.get(source_id, 0) for source_id in source_ids}

    target_dir.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(faiss_path(target_dir)))
    with docstore_path(target_dir).open("w", encoding="utf-8") as file:
        for document in documents:
            file.write(json.dumps(document, ensure_ascii=False) + "\n")
    manifest = {
        "schema_version": INDEX_SCHEMA_VERSION,
        "retrieval_mode": RETRIEVAL_MODE,
        "backend": INDEX_BACKEND,
        "version": index_name,
        "source_ids": manifest_source_ids,
        "source_counts": source_counts,
        "embedding_provider": provider.provider,
        "embedding_model": provider.model,
        "dimensions": provider.dimensions,
        "document_count": len(documents),
        "files": {
            "faiss": display_path(faiss_path(target_dir)),
            "docstore": display_path(docstore_path(target_dir)),
        },
    }
    manifest_path(target_dir).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


@lru_cache(maxsize=4)
def load_semantic_index(index_dir_value: str | None = None) -> dict:
    target_dir = Path(index_dir_value) if index_dir_value else INDEX_DIR
    required_files = [manifest_path(target_dir), docstore_path(target_dir), faiss_path(target_dir)]
    if not all(path.is_file() for path in required_files):
        raise RAGIndexNotReadyError(
            "RAG requires a semantic DashScope embedding index. Run scripts/build_rag_index.py before search.",
        )
    manifest = json.loads(manifest_path(target_dir).read_text(encoding="utf-8"))
    if manifest.get("retrieval_mode") != RETRIEVAL_MODE or manifest.get("embedding_provider") != "dashscope":
        raise RAGIndexNotReadyError(
            "RAG refuses legacy hash-vector indexes. Rebuild a semantic DashScope embedding index.",
        )
    documents = [
        json.loads(line)
        for line in docstore_path(target_dir).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if len(documents) != manifest.get("document_count"):
        raise RAGIndexNotReadyError("RAG docstore count does not match manifest document_count.")
    if faiss is None:
        raise RAGIndexNotReadyError("faiss-cpu is required to load the semantic index.")
    return {
        "manifest": manifest,
        "documents": documents,
        "faiss_index": faiss.read_index(str(faiss_path(target_dir))),
    }


def query_text(query: str, concepts: set[str]) -> str:
    if not concepts:
        return query
    terms = [_catalog_phrase_for(concept) for concept in sorted(concepts)]
    return f"{query}\nRelevant concepts: {' '.join(terms)}"


def _catalog_phrase_for(concept_id: str) -> str:
    try:
        node = kg_catalog_for_rag().get_node(concept_id)
    except Exception:
        return _humanize_identifier(concept_id)
    parts = [
        node.label,
        *node.aliases,
        *node.evidence_texts[:2],
    ]
    phrase = " ".join(part for part in parts if part).strip()
    return phrase or _humanize_identifier(concept_id)


def _humanize_identifier(value: str) -> str:
    suffix = value.split(":", 1)[-1]
    return suffix.replace("_", " ").replace("-", " ").strip() or value


def search_chunks(
    query: str,
    concepts: list[str] | None = None,
    top_k: int = 5,
    source_ids: list[str] | None = None,
    index_name: str = DEFAULT_INDEX_NAME,
) -> dict:
    target_dir = index_dir_for(index_name)
    bundle = load_semantic_index(str(target_dir))
    manifest = bundle["manifest"]
    embedding_provider = get_embedding_provider()
    reranker = get_reranker()
    query_concepts = set(concepts or infer_query_concepts(query))
    query_vector = normalize_vector(
        [float(value) for value in embedding_provider.embed_query(query_text(query, query_concepts))],
    )
    query_matrix = np.array([query_vector], dtype="float32")
    candidate_count = min(len(bundle["documents"]), max(top_k * 8, 20))
    distances, indices = bundle["faiss_index"].search(query_matrix, candidate_count)
    candidates = []
    allowed_source_ids = set(source_ids or [])
    for distance, index in zip(distances[0], indices[0], strict=True):
        if int(index) < 0:
            continue
        document = bundle["documents"][int(index)]
        if allowed_source_ids and document["chunk"].get("source_id") not in allowed_source_ids:
            continue
        candidates.append(
            {
                "chunk": document["chunk"],
                "embedding_score": float(distance),
            },
        )

    rerank_inputs = [rerank_text(candidate["chunk"]) for candidate in candidates]
    enriched_query = query_text(query, query_concepts)
    rerank_results = reranker.rerank(enriched_query, rerank_inputs, top_n=min(top_k, len(rerank_inputs))) if rerank_inputs else []
    reranked_chunks = []
    for item in rerank_results:
        candidate_index = item["index"]
        if candidate_index < 0 or candidate_index >= len(candidates):
            continue
        candidate = candidates[candidate_index]
        reranked_chunks.append(
            public_chunk(
                candidate["chunk"],
                embedding_score=candidate["embedding_score"],
                rerank_score=float(item["relevance_score"]),
            ),
        )

    return {
        "query": query,
        "retrieval_mode": RETRIEVAL_MODE,
        "kg_guided": bool(concepts),
        "concepts": sorted(query_concepts),
        "index": {
            "backend": manifest["backend"],
            "version": manifest["version"],
            "source_ids": manifest.get("source_ids", []),
            "source_counts": manifest.get("source_counts", {}),
            "document_count": manifest["document_count"],
            "dimensions": manifest["dimensions"],
            "path": display_path(faiss_path(target_dir)),
            "docstore_path": display_path(docstore_path(target_dir)),
            "manifest_path": display_path(manifest_path(target_dir)),
            "embedding_provider": manifest["embedding_provider"],
            "embedding_model": manifest["embedding_model"],
        },
        "reranker": {
            "enabled": True,
            "provider": reranker.provider,
            "model": reranker.model,
            "candidate_count": len(candidates),
        },
        "chunks": reranked_chunks,
    }
