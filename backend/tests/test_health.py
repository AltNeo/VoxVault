def test_health_returns_ok(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.headers.get("x-response-time-ms")
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)
    assert body["version"]


def test_provider_health_not_configured(client) -> None:
    response = client.get("/api/health/provider")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "not_configured"
    assert body["reachable"] is False
