"""Deploy with: uv tool run --from modal==1.6.1 modal deploy modal_app.py."""

import hashlib
from pathlib import Path

import modal

app = modal.App("embedding-model-trial")
GEMMA = "google/embeddinggemma-2"
SMALL = "BAAI/bge-small-en-v1.5"
GEMMA_REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"
SMALL_REVISION = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"
SOURCE_DIGEST = (
    hashlib.sha256(
        b"".join(
            (Path(__file__).parent / filename).read_bytes()
            for filename in ("modal_app.py", "embedding_api.py", "verification.py")
        )
    ).hexdigest()
    if modal.is_local()
    else ""
)


def prepare_weights(model_id, revision, destination):
    import tempfile

    import torch
    from sentence_transformers import SentenceTransformer

    options = {"vision_config": None, "audio_config": None} if model_id == GEMMA else {}
    with tempfile.TemporaryDirectory(prefix="model-download-") as cache:
        model = SentenceTransformer(
            model_id,
            revision=revision,
            device="cpu",
            cache_folder=cache,
            config_kwargs=options,
            model_kwargs={"torch_dtype": torch.float32},
        )
        model.save_pretrained(destination)


base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.14.1", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install(
        "transformers==5.19.0",
        "sentence-transformers==6.1.0",
        "fastapi==0.142.2",
        "httpx==0.28.1",
        "Pillow==12.3.0",
    )
)
gemma_image = (
    base_image.pip_install(
        "torchvision==0.29.1", index_url="https://download.pytorch.org/whl/cpu"
    )
    .run_function(
        prepare_weights, args=(GEMMA, GEMMA_REVISION, "/models/gemma"), memory=6144
    )
    .env(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "TRIAL_SOURCE_SHA256": SOURCE_DIGEST,
        }
    )
    .add_local_python_source("embedding_api", "verification")
)
small_image = (
    base_image.run_function(
        prepare_weights, args=(SMALL, SMALL_REVISION, "/models/small")
    )
    .env(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "TRIAL_SOURCE_SHA256": SOURCE_DIGEST,
        }
    )
    .add_local_python_source("embedding_api", "verification")
)


@app.cls(
    image=gemma_image,
    cpu=(1.0, 1.0),
    memory=(2048, 4096),
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
    timeout=120,
    startup_timeout=180,
)
class EmbeddingGemma2:
    @modal.enter()
    def load(self):
        from embedding_api import EmbeddingRuntime

        self.runtime = EmbeddingRuntime(GEMMA, "/models/gemma")

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        from embedding_api import create_api

        return create_api(self.runtime)

    @modal.method()
    def embed(self, payload: dict):
        from embedding_api import EmbeddingRequest

        return self.runtime.embed(EmbeddingRequest.model_validate(payload))

    @modal.method()
    def verify(self):
        from verification import verify_runtime

        return verify_runtime(self.runtime)


@app.cls(
    image=small_image,
    cpu=(0.25, 0.5),
    memory=(768, 1536),
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
    timeout=120,
    startup_timeout=180,
)
class BgeSmall:
    @modal.enter()
    def load(self):
        from embedding_api import EmbeddingRuntime

        self.runtime = EmbeddingRuntime(SMALL, "/models/small")

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        from embedding_api import create_api

        return create_api(self.runtime)

    @modal.method()
    def embed(self, payload: dict):
        from embedding_api import EmbeddingRequest

        return self.runtime.embed(EmbeddingRequest.model_validate(payload))

    @modal.method()
    def verify(self):
        from verification import verify_runtime

        return verify_runtime(self.runtime)
