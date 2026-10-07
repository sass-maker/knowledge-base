"""Bounded, content-log-free embedding API shared by the two trial models."""

import logging
import math
import os
import resource
import threading
import time
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

GEMMA = "google/embeddinggemma-2"
SMALL = "BAAI/bge-small-en-v1.5"
REVISIONS = {
    GEMMA: "914f7f89142e33e77833254d9c9b90c3cef7303b",
    SMALL: "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
}
TASK_PREFIXES = {
    "retrieval_query": "task: search result | query: ",
    "retrieval_document": "title: none | text: ",
    "code_retrieval": "task: code retrieval | query: ",
    "sentence_similarity": "task: sentence similarity | query: ",
    "classification": "task: classification | query: ",
    "clustering": "task: clustering | query: ",
}
Text = Annotated[str, Field(min_length=1, max_length=16000)]


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: Text | Annotated[list[Text], Field(min_length=1, max_length=8)]
    model: str | None = None
    task: Literal[
        "retrieval_query",
        "retrieval_document",
        "code_retrieval",
        "sentence_similarity",
        "classification",
        "clustering",
    ] = "retrieval_document"
    dimensions: int | None = None
    encoding_format: Literal["float"] = "float"


def format_inputs(request: EmbeddingRequest, model_id: str) -> list[str]:
    texts = [request.input] if isinstance(request.input, str) else request.input
    if any(not text.strip() for text in texts):
        raise HTTPException(422, "Inputs must contain non-whitespace text")
    if model_id == GEMMA:
        prefix = TASK_PREFIXES[request.task]
    elif request.task == "retrieval_query":
        prefix = "Represent this sentence for searching relevant passages: "
    elif request.task in ("retrieval_document", "sentence_similarity"):
        prefix = ""
    else:
        raise HTTPException(
            422, "BGE-small supports retrieval and similarity tasks only"
        )
    return [prefix + text for text in texts]


class EmbeddingRuntime:
    def __init__(self, model_id: str, model_path: str):
        import torch
        from sentence_transformers import SentenceTransformer

        started = time.perf_counter()
        torch.set_num_threads(2 if model_id == GEMMA else 1)
        self.model_id = model_id
        self.dimensions = [128, 256, 512, 768] if model_id == GEMMA else [384]
        self.max_tokens = 2048 if model_id == GEMMA else 512
        self.lock = threading.Lock()
        self.model = SentenceTransformer(
            model_path,
            device="cpu",
            local_files_only=True,
            model_kwargs={"torch_dtype": torch.float32},
        )
        self.model.max_seq_length = self.max_tokens
        warmup = self.model.encode(["readiness check"], normalize_embeddings=True)
        if not all(math.isfinite(float(v)) for v in warmup[0]):
            raise RuntimeError("Model readiness check produced non-finite values")
        self.load_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.info("Model ready: %s; load_ms=%s", model_id, self.load_ms)

    def metadata(self):
        return {
            "id": self.model_id,
            "object": "model",
            "owned_by": "trial",
            "revision": REVISIONS[self.model_id],
            "source_sha256": os.environ.get("TRIAL_SOURCE_SHA256"),
            "modalities": ["text", "code"],
            "dimensions": self.dimensions,
            "max_input_tokens": self.max_tokens,
            "max_batch_size": 8,
            "max_total_tokens": 8192,
            "dtype": "float32",
            "device": "cpu",
            "parameters": sum(
                parameter.numel() for parameter in self.model.parameters()
            ),
            "load_ms": self.load_ms,
            "peak_rss_mib": round(
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2
            ),
        }

    def embed(self, request: EmbeddingRequest):
        if request.model not in (None, self.model_id, self.model_id.split("/")[-1]):
            raise HTTPException(422, f"This endpoint serves {self.model_id}")
        dimensions = (
            self.dimensions[-1] if request.dimensions is None else request.dimensions
        )
        if dimensions not in self.dimensions:
            raise HTTPException(422, f"Supported dimensions: {self.dimensions}")
        texts = format_inputs(request, self.model_id)
        counts = [len(self.model.tokenizer.encode(text)) for text in texts]
        if max(counts) > self.max_tokens or sum(counts) > 8192:
            raise HTTPException(
                413, "Token limit exceeded; split input into smaller chunks"
            )
        if not self.lock.acquire(blocking=False):
            raise HTTPException(
                429, "Model busy; retry shortly", headers={"Retry-After": "2"}
            )
        try:
            started = time.perf_counter()
            vectors = self.model.encode(
                texts,
                batch_size=1,
                prompt="",
                truncate_dim=dimensions,
                normalize_embeddings=True,
                show_progress_bar=False,
            ).tolist()
            for vector in vectors:
                norm = math.sqrt(sum(value * value for value in vector))
                if (
                    len(vector) != dimensions
                    or not all(math.isfinite(v) for v in vector)
                    or abs(norm - 1) > 1e-4
                ):
                    raise RuntimeError("Invalid embedding produced by model")
            return {
                "object": "list",
                "model": self.model_id,
                "data": [
                    {"object": "embedding", "index": i, "embedding": vector}
                    for i, vector in enumerate(vectors)
                ],
                "usage": {"prompt_tokens": sum(counts), "total_tokens": sum(counts)},
                "meta": {
                    "task": request.task,
                    "dimensions": dimensions,
                    "inference_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            }
        finally:
            self.lock.release()


def create_api(runtime) -> FastAPI:
    api = FastAPI(title="Embedding model experiment", docs_url=None, redoc_url=None)

    @api.exception_handler(RequestValidationError)
    async def validation_error(_request, error):
        # Pydantic's default response echoes input values; do not return private content.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {"type": item["type"], "loc": item["loc"], "msg": item["msg"]}
                    for item in error.errors()
                ]
            },
        )

    @api.get("/healthz")
    def health():
        return {"status": "ready", **runtime.metadata()}

    @api.get("/v1/models")
    def models():
        return {"object": "list", "data": [runtime.metadata()]}

    @api.post("/v1/embeddings")
    def embeddings(payload: EmbeddingRequest):
        try:
            return runtime.embed(payload)
        except HTTPException:
            raise
        except (RuntimeError, ValueError) as error:
            logger.error("Inference failure: %s", type(error).__name__)
            raise HTTPException(503, "Model inference failed") from None

    return api
