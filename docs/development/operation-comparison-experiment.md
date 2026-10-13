# Operation comparison experiment — Cloud slice, 2026-10-13

Related: [Knowledge Base #80](https://github.com/sass-maker/knowledge-base/issues/80),
[existing draft PR #78](https://github.com/sass-maker/knowledge-base/pull/78).
[Issue #77](https://github.com/sass-maker/knowledge-base/issues/77) remains the
separate owner-local recovery/consolidation tracker. The owner resumed Knowledge
Base experiments; the historical pause does not apply to this slice.

## Frozen public benchmark

The [case manifest](../../experiments/operation-comparison/public-cases.json)
contains immutable GitHub revisions, literal bounded README passages, source-file
and excerpt SHA256 receipts, user problems and agent-provisional labels. These
labels were defined before comparisons, are not owner-validated truth and do not
establish general recommendation quality. No private catalog or corpus is needed.

Five development cases cover article extraction with a different method, an
identical library with no demonstrated new method, generic HTML selectors,
Markdown compilation in the opposite direction, and title-only partial retrieval.
Three cases are held out. The executable development input exporter excludes
held-out cases, labels and rationales; the evaluator rejects held-out observations.
The held-out subset must remain unused until the method is frozen for a separate
trial. It is small, public and agent-authored, not a blinded owner benchmark.

Preparation remains separate from usefulness. A shared sub-operation can be
relevant across runtimes without implying integration readiness, improved results
or a missing requirement. There is no required recommendation count. Partial
retrieval and ambiguous evidence are distinct from a proven lack of capability.

From the repository root:

```sh
# Deterministic offline inventory; makes no model request.
node experiments/operation-comparison/evaluate.mjs
# Public inputs only; retain these exact inputs for later authorized trials.
node experiments/operation-comparison/evaluate.mjs --inputs
# Actual pipeline and adversarial contract checks, with local in-memory documents.
pnpm --dir cloudflare/worker exec vitest run tests/operation-comparison-benchmark.test.ts tests/operation-comparison.test.ts tests/gateway-decisions-api.test.ts
# Score externally retained, actual authorized gateway observations when available.
node experiments/operation-comparison/evaluate.mjs /absolute/path/to/live-observations.json
```

An observation file must have `mode: "live_free_ai"`, the current
`corpus_sha256`, and `rows`. Each row has a development case `id`, `status`
(`ok`, `unavailable`, `rate_limited`, or `error`), and optional observed
`latency_ms`/`cache_hit`. Completed rows additionally require `useful`,
`project_id: "knowledge-base"`, `requested_model: "auto"`, actual resolved
`model` and `provider`; literal `project_excerpt`/`candidate_excerpt` are checked
separately. These receipts are supplied observations, not cryptographic proof of
live execution. Never label constructed fixture rows as live observations.
Preserve raw gateway outputs and preparation/usefulness stage receipts externally
for audit, with no credentials. The scorer does not invoke any provider.

## Reproducible source results and limits

All five development cases freeze successfully through the existing evidence
pipeline with candidate-owned literal excerpts, no omitted supplied candidates
and packed inputs below 24 KB. The partial-retrieval case retains only its supplied
title, rather than recovering a full README implicitly. This exercises supplied
input coverage, not live retrieval recall. No retrieval arms or production
indexes were called; production partial-arm behavior remains unqualified.

An adversarial proposal with real evidence IDs and invented method names is
accepted by the existing literal-ID validator. Its test deliberately demonstrates
this limit: citation existence is not summary entailment or usefulness. No model
quality is claimed from that constructed proposal. Human/agent literal-claim
review remains separate from provisional usefulness labels.

The chat preparation path now has a 30-second explicit deadline covering both
fetch and response-body reading, matching the bounded typed decision path's
behavior even when a binding ignores abort. The request still carries its abort
signal; underlying provider work cancellation depends on binding support. Offline
regressions exercise a stalled fetch, stalled body, missing binding, HTTP 429 and
503, without retries or provider substitution. They are contract checks, not
observed gateway capacity or timing.

The offline inventory reports **zero model-evaluated cases**. False positives,
false negatives, entailment, live latency, cache reuse and observed gateway-429
rate are unmeasured (`null`). The scorer separately reports errors/unavailable
states, ambiguous cases, completed coverage, false-positive/negative case IDs,
exact citation existence, latency samples and explicit cache-hit observations.
Repeated identical inputs do not establish cache reuse: the Knowledge Base
intelligence routes store runs but do not implement a comparison-result lookup;
any gateway/upstream cache reuse requires its actual receipt. No cache is added
by this experiment.

## Runtime capability receipt

The Cloud runtime status on October 13 reports current observations at spec
revision 11, no configured capabilities, runtime variables, secret bindings or
outbound identities. The non-secret identity manifest selector is absent. No
credential value, credential file or env file was inspected.

These are three distinct boundaries:

1. [Chat preparation](../../cloudflare/worker/src/decision-engine.ts) and the
   [typed decision adapter](../../cloudflare/worker/src/gateway-decisions.ts)
   require an executable `FREE_AI.fetch` Worker service binding. The checked-in
   deployment configuration does not make that binding executable in this Cloud
   process; no supported injected binding is available here.
2. [Other inference paths](../../cloudflare/worker/src/free-ai.ts) contain an
   HTTP fallback using a configured `FREE_AI_BASE_URL` and authenticated transport,
   with an optional injected `AI_HTTP` transport for tests. Thus the missing
   service binding alone does **not** rule out HTTP. The runtime metadata exposes
   no already-configured authorized gateway URL/identity/transport for this task.
   No inference connector is exposed by the available tool catalog. General
   GitHub connectivity does not establish gateway authentication.
3. The enforced runtime HTTP allowlist and `/etc/codex/network-policy.json`
   exclude the documented `ai-gateway.sassmaker.com` host and the internal
   `fleet-gateway.internal` target. Local TCP destination grants are empty and
   VPN is unconfigured. The networking instructions require the inherited proxy;
   direct connections cannot grant authorization. No denied request was attempted,
   no proxy was deployed and no network policy or Access setting was changed.

A live trial needs either a supported existing executable gateway binding, or
an already-authorized configured HTTP gateway identity/transport **and** allowed
outbound access. None is established in this session. This is a precise capability
blocker, not a gateway outage or proof that HTTP paths are generally unavailable.
The public inputs, offline inventory and contract suite remain runnable unchanged.
Model `auto`, project `knowledge-base`, free gateway only; no Jev calls, quota
changes, provider substitution, production writes, migrations or deployment.

[Starboard #172](https://github.com/Codevetter/starboard/issues/172) supplied
public qualification context (generic overlap, first-visit 429s, cache/coverage
limits); [PR #179](https://github.com/Codevetter/starboard/pull/179) remains a
read-only counterpart. Its source and cutover are untouched. Production
qualification and public release approval remain separate.

## Local validation receipt

Local runner: Node 24.19.0, pinned pnpm 10.33.2; CI specifies Node 22.
Focused operation/benchmark/typed-gateway suite: **53 passed**. Worker typecheck
and full suite: **564 passed, one existing skip**; Worker coverage thresholds
pass (80.27% statements, 68.38% branches, 87.50% functions, 86.38% lines).
App checks/build/coverage, landing checks/build, docs, format, unused,
complexity (unchanged 54-violation budget), duplication, cycles, suppressions,
hygiene, four static-Astro qualification tests and the workflow's legacy-parse
dry-run/preflight/gap commands pass. No gate or assertion is weakened.

The first sandboxed broad Worker invocation could not execute child-process
CLI fixtures; authorized local process execution resolved those four harness
failures. The final checks use an offline fetch guard permitting only data URLs
and loopback application requests. Package audit/installation transport is a
separate dependency check, not live inference. No UI behavior changed; the
merged landing cache/copy is retained via a preserving merge of current main.
Live model quality, gateway/cache timing, retrieval/owner/device/production
acceptance and a public release are not covered by these local checks.
