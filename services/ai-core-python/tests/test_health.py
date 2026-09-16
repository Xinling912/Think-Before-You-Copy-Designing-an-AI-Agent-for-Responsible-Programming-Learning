from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_ai_core_status():
    client = TestClient(app)

    response = client.get("/ai/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-core-python"}

