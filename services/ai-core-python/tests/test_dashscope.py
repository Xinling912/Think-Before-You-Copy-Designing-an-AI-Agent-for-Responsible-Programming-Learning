from app.dashscope import DashScopeAPIError, DashScopeChatProvider, DashScopeSettings


def test_chat_with_usage_normalizes_dashscope_usage():
    provider = DashScopeChatProvider(DashScopeSettings(api_key="test-key"))

    def fake_post(path, payload):
        return {
            "model": "qwen3.7-max",
            "choices": [{"message": {"content": "Use the index range first."}}],
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "total_tokens": 150,
            },
        }

    provider._post = fake_post

    response = provider.chat_with_usage([{"role": "user", "content": "x"}])

    assert response.content == "Use the index range first."
    assert response.model == "qwen3.7-max"
    assert response.usage["prompt_tokens"] == 120
    assert response.usage["completion_tokens"] == 30
    assert response.usage["total_tokens"] == 150
    assert response.usage["usage_unavailable"] is False


def test_chat_retries_once_after_transient_api_error():
    provider = DashScopeChatProvider(DashScopeSettings(api_key="test-key"))
    calls = []

    def flaky_post(path, payload):
        calls.append((path, payload))
        if len(calls) == 1:
            raise DashScopeAPIError("transient HTTP 502")
        return {"choices": [{"message": {"content": "模型恢复后的自然回复"}}]}

    provider._post = flaky_post

    result = provider.chat([{"role": "user", "content": "你好"}])

    assert result == "模型恢复后的自然回复"
    assert len(calls) == 2
