from fastapi.testclient import TestClient

from app.main import app


def test_kg_reason_returns_index_error_learning_path():
    client = TestClient(app)

    response = client.post("/ai/kg/reason", json={"target": "IndexError"})

    assert response.status_code == 200
    body = response.json()
    assert body["target"] == "IndexError"
    assert body["source"] == "ErrorType:IndexError"
    assert body["algorithm"] == "weighted-multi-hop-graph-search"
    assert body["path"] == ["ErrorType:IndexError"]
    assert len(body["path_edges"]) == len(body["path"]) - 1


def test_kg_reason_finds_paths_from_different_start_nodes():
    client = TestClient(app)

    response = client.post(
        "/ai/kg/reason",
        json={"source": "Concept:len", "target": "IndexError"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["path"][0] == "Concept:len"
    assert body["path"][-1] == "ErrorType:IndexError"
    assert len(body["path"]) >= 2
