"""Exercise the same ASGI application and actual weights in a deployed container."""

import math
import statistics
import time


def verify_runtime(runtime):
    from embedding_api import create_api
    from fastapi.testclient import TestClient

    client = TestClient(create_api(runtime))
    samples = []
    for _ in range(3):
        started = time.perf_counter()
        response = client.post(
            "/v1/embeddings",
            json={
                "input": "How do I make an authenticated HTTP request?",
                "task": "retrieval_query",
            },
        )
        assert response.status_code == 200, response.text
        samples.append(response.json()["meta"]["inference_ms"])
        assert time.perf_counter() >= started
    query = response.json()["data"][0]["embedding"]
    documents = client.post(
        "/v1/embeddings",
        json={
            "input": [
                "Send an HTTP request with an Authorization Bearer header to authenticate to the API.",
                "A banana is a yellow fruit commonly eaten for breakfast.",
            ],
            "task": "retrieval_document",
        },
    ).json()["data"]
    scores = [
        sum(a * b for a, b in zip(query, item["embedding"])) for item in documents
    ]
    assert scores[0] > scores[1], scores
    for dim in runtime.dimensions:
        response = client.post(
            "/v1/embeddings", json={"input": "A test document", "dimensions": dim}
        )
        assert response.status_code == 200, response.text
        vector = response.json()["data"][0]["embedding"]
        assert len(vector) == dim and all(math.isfinite(value) for value in vector)
        assert abs(math.sqrt(sum(value * value for value in vector)) - 1) < 1e-4
    assert (
        client.post(
            "/v1/embeddings", json={"input": "test", "model": "wrong-model"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/embeddings", json={"input": "test", "dimensions": 1}
        ).status_code
        == 422
    )
    assert (
        client.post("/v1/embeddings", json={"input": "word " * 12000}).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/embeddings", json={"input": "word " * (runtime.max_tokens + 10)}
        ).status_code
        == 413
    )
    assert (
        client.post("/v1/embeddings", json={"input": ["test"] * 9}).status_code == 422
    )
    assert client.post("/v1/embeddings", json={"input": " "}).status_code == 422
    assert client.get("/healthz").json()["status"] == "ready"
    chunk_timings = []
    chunk_tokens = 0
    chunk = (
        "HTTP APIs use authentication headers to identify the caller. "
        "The server validates the credential before handling the request. "
        "Embedding services represent queries and documents as vectors for retrieval. "
        "Clients should use matching models and dimensions for both query and document vectors. "
    ) * 4
    for _ in range(3):
        chunk_response = client.post(
            "/v1/embeddings", json={"input": chunk, "task": "retrieval_document"}
        )
        assert chunk_response.status_code == 200, chunk_response.text
        chunk_result = chunk_response.json()
        chunk_timings.append(chunk_result["meta"]["inference_ms"])
        chunk_tokens = chunk_result["usage"]["total_tokens"]
    return {
        "ok": True,
        "runtime": runtime.metadata(),
        "samples_ms": samples,
        "median_inference_ms": round(statistics.median(samples), 2),
        "chunk_tokens": chunk_tokens,
        "chunk_samples_ms": chunk_timings,
        "chunk_median_inference_ms": round(statistics.median(chunk_timings), 2),
        "retrieval_scores": {"relevant": scores[0], "unrelated": scores[1]},
        "checks": [
            "real-weights",
            "query-document-ranking",
            "all-dimensions-normalized",
            "token-budget",
            "batch-budget",
            "wrong-model",
            "blank-input",
            "readiness",
        ],
        "scope": "deployed-container ASGI application; public proxy authentication verified separately",
    }
