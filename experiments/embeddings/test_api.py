import unittest

from embedding_api import GEMMA, SMALL, EmbeddingRequest, create_api, format_inputs
from fastapi.testclient import TestClient


class FakeRuntime:
    def metadata(self):
        return {"id": GEMMA}

    def embed(self, payload):
        return {"task": payload.task}


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_api(FakeRuntime()))

    def test_query_and_document_prefixes_are_different(self):
        query = format_inputs(
            EmbeddingRequest(input="hello", task="retrieval_query"), GEMMA
        )
        document = format_inputs(EmbeddingRequest(input="hello"), GEMMA)
        self.assertEqual(query, ["task: search result | query: hello"])
        self.assertEqual(document, ["title: none | text: hello"])
        self.assertEqual(
            format_inputs(EmbeddingRequest(input="hello"), SMALL), ["hello"]
        )

    def test_rejects_empty_oversized_and_unknown_fields_without_echoing_content(self):
        for payload in [
            {"input": ""},
            {"input": []},
            {"input": ["test"] * 9},
            {"input": "test", "task": "invalid"},
            {"input": "private sentinel", "unknown": "private sentinel"},
            {"input": "private sentinel", "encoding_format": "base64"},
            {"input": "x" * 16001},
        ]:
            response = self.client.post("/v1/embeddings", json=payload)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("private sentinel", response.text)

    def test_preserves_task_selection(self):
        response = self.client.post(
            "/v1/embeddings", json={"input": "example", "task": "code_retrieval"}
        )
        self.assertEqual(response.json(), {"task": "code_retrieval"})


if __name__ == "__main__":
    unittest.main()
