---
title: Embedding model trial
description: Standalone Modal embedding endpoint, cost assumptions, and smaller-model comparison.
---

# Embedding model trial

Tracking: [issue 64](https://github.com/sass-maker/knowledge-base/issues/64).
Source: [Modal deployment](../../experiments/embeddings/modal_app.py),
[API](../../experiments/embeddings/embedding_api.py),
[authenticated SDK client](../../experiments/embeddings/client.py).
This is an independent experiment; the Cloudflare RAG runtime and stored
embeddings are unchanged. Both model names are also published in Free AI's
catalog; gateway release qualification is tracked in
[Free AI #100](https://github.com/sass-maker/free-ai/issues/100).
No UI or retrieval/answer route is added.

## Runtime and scope

EmbeddingGemma 2 loads its text-only backbone, disabling the vision and audio
encoders before saving the weights. It returns normalized 128/256/512/768-dimensional
vectors for text and code. BGE-small is a separate English text baseline with
384-dimensional vectors. Model revisions and direct dependencies are pinned in
source. Model weights are saved into the image during build; runtime is offline.
PyTorch and SentenceTransformers run CPU inference; torchvision is required by
EmbeddingGemma 2's processor even for text-only inference. FastAPI provides the
HTTP contract. httpx is used only by the remote ASGI verification method.

Each model allows one container, scales from zero, and shuts down after 30 idle
seconds. EmbeddingGemma 2 requests one physical CPU core and 2 GiB memory, with a
4 GiB memory limit. BGE-small requests 0.25 physical cores and 0.75 GiB, with limits
of 0.5 cores and 1.5 GiB. Actual usage above requests affects billing.

The endpoint requires Modal Proxy Token authentication before compute starts.
Under explicit owner authorization, a dedicated Modal Proxy Token was created
for the Free AI adapter and its pair stored as Worker secrets. Clients use their
existing gateway authentication; they do not need the Modal token. Modal CLI/SDK
use the existing authenticated profile. Requests are not logged by the application;
validation errors do not echo private inputs. The inference route rejects batches
above eight, blank inputs, unknown fields, mismatched models, unsupported
output dimensions, and inputs above 2,048 tokens (Gemma) or 512 tokens (BGE-small).
Gemma batches also have an 8,192-token aggregate limit. Overlong inputs return an
error instead of silently truncating. One inference runs at a time.

## Deploy and try

Deployed HTTPS embedding routes:

- [EmbeddingGemma 2](https://sarthakagrawal927--embedding-model-trial-embeddinggemma2-web.modal.run/v1/embeddings)
- [BGE-small](https://sarthakagrawal927--embedding-model-trial-bgesmall-web.modal.run/v1/embeddings)
- [Modal deployment](https://modal.com/apps/sarthakagrawal927/main/deployed/embedding-model-trial)

Run from `experiments/embeddings/`:

```bash
uv tool run --from modal==1.6.1 modal deploy modal_app.py
uv tool run --from modal==1.6.1 python client.py --model gemma --input 'How do I authenticate an HTTP request?'
uv tool run --from modal==1.6.1 python client.py --model small --input 'How do I authenticate an HTTP request?'
uv tool run --from modal==1.6.1 python client.py --model gemma --verify
```

The SDK client works with the current Modal login and does not require creating
an HTTP Proxy Token. The Free AI API accepts the exact model names
`google/embeddinggemma-2` and `BAAI/bge-small-en-v1.5` at
`https://ai-gateway.sassmaker.com/v1/embeddings`; see its
[request examples and shared trial allowance](https://ai-gateway.sassmaker.com/docs/embeddings/).
To call Modal directly from another service, obtain a Proxy Token
through your Modal dashboard and supply it as `Authorization: Bearer <id>.<secret>`;
never commit it or paste it into chat. The combined bearer value is compatible
with OpenAI clients. Each model exposes `POST /v1/embeddings`, `GET /v1/models`,
`GET /healthz`, and an OpenAPI schema; the schema UI is disabled.

The embedding request uses OpenAI fields `input`, `model`, `dimensions`, and
`encoding_format: "float"`; `task` is an extension and defaults to
`retrieval_document`. Use `retrieval_query` when comparing a query to a document,
`code_retrieval` for natural-language code queries, or `sentence_similarity` for
symmetric comparisons. Query and document tasks use different model prefixes.
Both sides must use the same model and dimension; never mix these vectors with
an existing index from another model, even when dimensions match.

## Cost model

Pricing checked 2026-10-07: [Modal](https://modal.com/pricing),
[Modal resource metering](https://modal.com/docs/guide/resources),
[Cloudflare Containers](https://developers.cloudflare.com/containers/platform/pricing/),
[Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/).
The live Modal dashboard showed a Starter workspace and $30.00 credits before
the trial deployment. The allowance is shared with all workspace applications;
this is not a dedicated $30 allowance per endpoint or a configured spending cap.
Compute credits apply to these custom Functions, not Modal's token-billed Shared
Endpoints. Build time, startup, inference, and the 30-second idle tail all consume
compute. No always-on minimum, GPU, persistent volume, or paid region selection
is configured.

| Runtime | Estimated charge per awake hour before credits |
| --- | ---: |
| Modal Gemma, requested 1 physical core + 2 GiB | $0.0631 |
| Modal Gemma, 1 core + 4 GiB memory limit | $0.0791 |
| Modal BGE-small, requested 0.25 core + 0.75 GiB | $0.0178 |
| Modal BGE-small, resource limits 0.5 core + 1.5 GiB | $0.0356 |
| Cloudflare standard-1, 0.5 vCPU + reserved 4 GiB / 8 GB disk | $0.0380 idle to $0.0740 at full CPU |

Modal prices are $0.0000131 per physical core-second and $0.00000222 per
GiB-second; a physical core is equivalent to two vCPUs. Estimates exclude egress,
initial builds, and unrelated workspace usage. These are estimated resource
charges, not observed invoices. Cloudflare also has Worker/Durable Object charges
and requires the Workers Paid plan; monthly included resources may offset usage.

For Gemma, 30 ten-minute sessions in a month, each with an additional 35-second
cold-start allowance and 30-second idle tail, is about $0.35 at requested resources
($0.44 at the memory limit), before credits. At requested resources the credit covers
approximately 475 awake hours of Gemma **if no other app uses the credit**.
Keeping it continuously awake for a 30-day month would cost about $45.46 before
credits, so the allowance alone does not make an always-on service free.

Managed Workers AI BGE-small costs $0.020 per million input tokens; Qwen3
Embedding 0.6B and BGE-M3 are listed at $0.012 per million. Workers AI includes
10,000 shared neurons daily. Managed models are compelling for production
costs; container hosting here is for evaluating the specific new model.
These are different models and do not establish equivalent retrieval quality.

## Verification

The 2026-10-07 deployment's source SHA-256 is
`67fef780ef6fc734c28960ed169c6c2a629303b7194065d4867f9ad31b975777`.
Both remote verification reports match the local digest of deployment, API, and
verification source. Full sanitized reports:
[Gemma](../../experiments/embeddings/verification-gemma.json) and
[BGE-small](../../experiments/embeddings/verification-small.json).

[Direct SDK request timing](../../experiments/embeddings/endpoint-smoke.json)
measured the same short query after zero-runner state, then three warm calls.
Gemma took 35.15 seconds cold and a 571 ms warm round-trip median. BGE-small took
26.58 seconds cold and a 505 ms warm round-trip median. Those end-to-end SDK
timings include platform startup and transport; model loading alone is much
shorter. Aggressive scale-to-zero therefore trades cost for a noticeable wait
after inactivity. A separate protected public HTTPS BGE request took 58.34 seconds
and returned a finite normalized 384-dimensional vector; an authenticated Gemma
HTTPS request also returned a valid 256-dimensional vector. These separate samples
are not directly comparable to the SDK medians. Both classes also
reported zero runners, running inputs, and backlog after the earlier idle period.

| Measured deployed CPU smoke (3 samples) | Gemma text encoder | BGE-small |
| --- | ---: | ---: |
| Loaded parameters | 271,002,624 | 33,360,000 |
| Warm short-query median | 479 ms | 30 ms |
| Document-chunk median | 1,763 ms (189 tokens) | 164 ms (214 tokens) |
| Model loading, excluding platform startup | 4.01 s | 1.04 s |
| Peak process RSS during smoke | 2,320 MiB | 1,004 MiB |

The models tokenize the same chunk differently. At resource limits, the measured
chunk throughput implies approximately $0.205/M tokens for Gemma and $0.0076/M
for BGE-small in a continuously warm, fully utilized worker. These are tiny-sample
resource estimates, excluding startup, idle, transport, and unused capacity;
they are not billed per-token prices. The BGE estimate can beat managed per-token
pricing only if work amortizes startup and idle tails sufficiently. Sporadic
traffic favors managed Workers AI or available Modal credits. Different retrieval
quality is unmeasured; the single fixture is not a model-quality comparison.

Local checks:

```bash
uv tool run --from modal==1.6.1 --with fastapi==0.142.2 --with httpx==0.28.1 python -m unittest test_api.py -v
uv tool run --from ruff ruff check .
uv tool run --from ruff ruff format --check .
```

Remote verification uses the exact deployed class and its loaded weights, invokes
the same FastAPI application with an ASGI client, verifies every supported
dimension and L2 normalization, rejection cases, readiness, and a query/document
ranking fixture. It also reports cold model loading, peak process RSS, and
three warm inference samples for a short query and a document chunk. This is a
small correctness/performance smoke, not a general retrieval-quality evaluation.
Public unauthenticated HTTP requests are checked separately for rejection by
Modal's proxy. Authenticated public HTTPS inference for both models passed with
the dedicated Proxy Token. SDK/ASGI, direct Modal HTTPS and gateway qualification
are distinct evidence; gateway release receipts live in Free AI's tracking issue.
