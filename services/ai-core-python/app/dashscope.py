from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com"
EMBEDDING_PATH = "/api/v1/services/embeddings/text-embedding/text-embedding"
RERANK_PATH = "/api/v1/services/rerank/text-rerank/text-rerank"
CHAT_COMPLETIONS_PATH = "/compatible-mode/v1/chat/completions"


class DashScopeConfigurationError(RuntimeError):
    pass


class DashScopeAPIError(RuntimeError):
    pass


def load_local_env() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class DashScopeSettings:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    embedding_model: str = "text-embedding-v4"
    embedding_dimensions: int = 1024
    rerank_model: str = "qwen3-rerank"
    chat_model: str = "qwen3.7-max"
    chat_temperature: float = 0.2
    chat_max_tokens: int = 800
    chat_enable_thinking: bool = False
    chat_max_retries: int = 2
    chat_retry_delay_seconds: float = 0.4
    timeout_seconds: float = 45.0

    @classmethod
    def from_env(cls) -> "DashScopeSettings":
        load_local_env()
        api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
        if not api_key:
            raise DashScopeConfigurationError("DASHSCOPE_API_KEY is required for semantic RAG.")
        return cls(
            api_key=api_key,
            base_url=os.environ.get("DASHSCOPE_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
            embedding_model=os.environ.get("DASHSCOPE_EMBED_MODEL", "text-embedding-v4"),
            embedding_dimensions=int(os.environ.get("DASHSCOPE_EMBED_DIM", "1024")),
            rerank_model=os.environ.get("DASHSCOPE_RERANK_MODEL", "qwen3-rerank"),
            chat_model=os.environ.get("DASHSCOPE_CHAT_MODEL", "qwen3.7-max"),
            chat_temperature=float(os.environ.get("DASHSCOPE_CHAT_TEMPERATURE", "0.2")),
            chat_max_tokens=int(os.environ.get("DASHSCOPE_CHAT_MAX_TOKENS", "800")),
            chat_enable_thinking=os.environ.get("DASHSCOPE_CHAT_ENABLE_THINKING", "false").lower() == "true",
            chat_max_retries=int(os.environ.get("DASHSCOPE_CHAT_MAX_RETRIES", "2")),
            chat_retry_delay_seconds=float(os.environ.get("DASHSCOPE_CHAT_RETRY_DELAY_SECONDS", "0.4")),
            timeout_seconds=float(os.environ.get("DASHSCOPE_TIMEOUT_SECONDS", "45")),
        )


@dataclass(frozen=True)
class DashScopeChatResponse:
    content: str
    model: str
    usage: dict[str, int | bool]


def normalize_chat_usage(raw_usage: object) -> dict[str, int | bool]:
    if not isinstance(raw_usage, dict):
        return {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "usage_unavailable": True,
        }
    prompt_tokens = int(raw_usage.get("prompt_tokens") or raw_usage.get("input_tokens") or 0)
    completion_tokens = int(raw_usage.get("completion_tokens") or raw_usage.get("output_tokens") or 0)
    total_tokens = int(raw_usage.get("total_tokens") or prompt_tokens + completion_tokens)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "usage_unavailable": total_tokens <= 0,
    }


class DashScopeEmbeddingProvider:
    provider = "dashscope"

    def __init__(self, settings: DashScopeSettings | None = None):
        self.settings = settings or DashScopeSettings.from_env()
        self.model = self.settings.embedding_model
        self.dimensions = self.settings.embedding_dimensions

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts, text_type="document")

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text], text_type="query")[0]

    def _embed(self, texts: list[str], text_type: str) -> list[list[float]]:
        if not texts:
            return []
        response = self._post(
            EMBEDDING_PATH,
            {
                "model": self.model,
                "input": {"texts": texts},
                "parameters": {
                    "text_type": text_type,
                    "dimension": self.dimensions,
                },
            },
        )
        embeddings = response.get("output", {}).get("embeddings", [])
        if len(embeddings) != len(texts):
            raise DashScopeAPIError(
                f"DashScope embedding returned {len(embeddings)} vectors for {len(texts)} texts.",
            )
        ordered = sorted(embeddings, key=lambda item: item.get("text_index", 0))
        vectors = [item.get("embedding") for item in ordered]
        if any(not isinstance(vector, list) for vector in vectors):
            raise DashScopeAPIError("DashScope embedding response did not include vector arrays.")
        return vectors

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.settings.api_key}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=self.settings.timeout_seconds) as client:
                response = client.post(self.settings.base_url + path, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise DashScopeAPIError(f"DashScope embedding request failed: {exc}") from exc
        if response.status_code >= 400:
            raise DashScopeAPIError(
                f"DashScope embedding request failed with HTTP {response.status_code}: {response.text[:500]}",
            )
        return response.json()


class DashScopeReranker:
    provider = "dashscope"

    def __init__(self, settings: DashScopeSettings | None = None):
        self.settings = settings or DashScopeSettings.from_env()
        self.model = self.settings.rerank_model

    def rerank(self, query: str, documents: list[str], top_n: int) -> list[dict]:
        if not documents:
            return []
        response = self._post(
            RERANK_PATH,
            {
                "model": self.model,
                "input": {
                    "query": query,
                    "documents": documents,
                },
                "parameters": {
                    "top_n": min(top_n, len(documents)),
                    "return_documents": False,
                },
            },
        )
        results = response.get("output", {}).get("results", [])
        normalized = []
        for item in results:
            if "index" not in item:
                continue
            normalized.append(
                {
                    "index": int(item["index"]),
                    "relevance_score": float(item.get("relevance_score", 0.0)),
                },
            )
        return normalized

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.settings.api_key}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=self.settings.timeout_seconds) as client:
                response = client.post(self.settings.base_url + path, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise DashScopeAPIError(f"DashScope rerank request failed: {exc}") from exc
        if response.status_code >= 400:
            raise DashScopeAPIError(
                f"DashScope rerank request failed with HTTP {response.status_code}: {response.text[:500]}",
            )
        return response.json()


class DashScopeChatProvider:
    provider = "dashscope"

    def __init__(self, settings: DashScopeSettings | None = None):
        self.settings = settings or DashScopeSettings.from_env()
        self.model = self.settings.chat_model
        self.temperature = self.settings.chat_temperature
        self.max_tokens = self.settings.chat_max_tokens

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        return self.chat_with_usage(messages, temperature=temperature, max_tokens=max_tokens).content

    def chat_with_usage(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> DashScopeChatResponse:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature if temperature is None else temperature,
            "max_tokens": self.max_tokens if max_tokens is None else max_tokens,
        }
        if not self.settings.chat_enable_thinking:
            payload["enable_thinking"] = False

        last_error: DashScopeAPIError | None = None
        attempts = max(1, self.settings.chat_max_retries + 1)
        for attempt in range(attempts):
            try:
                response = self._post(CHAT_COMPLETIONS_PATH, payload)
                choices = response.get("choices", [])
                if not choices:
                    raise DashScopeAPIError("DashScope chat response did not include choices.")
                content = choices[0].get("message", {}).get("content", "")
                if not isinstance(content, str) or not content.strip():
                    raise DashScopeAPIError("DashScope chat response did not include message content.")
                return DashScopeChatResponse(
                    content=content.strip(),
                    model=str(response.get("model") or self.model),
                    usage=normalize_chat_usage(response.get("usage")),
                )
            except DashScopeAPIError as exc:
                last_error = exc
                if attempt >= attempts - 1:
                    break
                time.sleep(self.settings.chat_retry_delay_seconds)
        raise last_error or DashScopeAPIError("DashScope chat request failed.")

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.settings.api_key}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=self.settings.timeout_seconds) as client:
                response = client.post(self.settings.base_url + path, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise DashScopeAPIError(f"DashScope chat request failed: {exc}") from exc
        if response.status_code >= 400:
            raise DashScopeAPIError(
                f"DashScope chat request failed with HTTP {response.status_code}: {response.text[:500]}",
            )
        return response.json()
