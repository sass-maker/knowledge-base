# Agent Integration Examples

Agents integrate with the Cloudflare Worker RAG service, not the retired local
Python API.

## Tool Contract

Name:

```text
private_corpus_query
```

Description:

```text
Query a private project corpus through the knowledgebase Cloudflare Worker.
Returns a cited answer, ranked evidence, filename/page excerpts, confidence, and
trace metadata. Use this before making factual claims about private documents.
```

Input schema:

```json
{
  "type": "object",
  "properties": {
    "domain": {"type": "string"},
    "question": {"type": "string"},
    "top_k": {"type": "integer", "minimum": 1, "maximum": 50},
    "mode": {"type": "string", "enum": ["auto", "hybrid", "semantic", "lexical"]},
    "answer_mode": {"type": "string", "enum": ["extractive", "workers_ai"]}
  },
  "required": ["domain", "question"]
}
```

The corpus/tenant is bound to the authenticated service key, not passed in the
body — `/v1/kb/query` reads only `domain` and `question` (alias `query`) plus
the optional retrieval knobs above.

## TypeScript Wrapper

The dependency-free typed wrapper lives at
[`cloudflare/worker/src/client.ts`](../../cloudflare/worker/src/client.ts).
Its HTTP compatibility test fixes the request and cited response shape at
[`cloudflare/worker/tests/client.test.ts`](../../cloudflare/worker/tests/client.test.ts).

```ts
import { KnowledgebaseClient } from "./src/client";

const knowledgebase = new KnowledgebaseClient({
  baseUrl: process.env.RAG_BASE_URL!,
  serviceKey: process.env.RAG_SERVICE_KEY!,
});

export function privateCorpusQuery(input: {
  domain: string;
  question: string;
}) {
  return knowledgebase.query({
    domain: input.domain,
    question: input.question,
    top_k: 8,
    mode: "hybrid",
    answer_mode: "extractive",
  });
}
```

## OpenAI Agents SDK

The current TypeScript SDK exposes local functions with `tool()` and validates
their parameters with Zod. Return the complete cited payload so the agent sees
the evidence, not only the synthesized answer.

```ts
import { tool } from "@openai/agents";
import { z } from "zod";

export const privateCorpusQueryTool = tool({
  name: "private_corpus_query",
  description: "Query private project evidence and return a cited answer.",
  parameters: z.object({
    domain: z.string().min(1),
    question: z.string().min(1),
  }),
  async execute({ domain, question }) {
    return privateCorpusQuery({
      domain,
      question,
    });
  },
});
```

Reference: [OpenAI Agents SDK function tools](https://openai.github.io/openai-agents-js/guides/tools/#3-function-tools).

## LangChain.js

LangChain's current JavaScript tool helper accepts a function plus name,
description, and Zod schema. JSON-stringify the complete payload when the tool
consumer expects text.

```ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const privateCorpusQueryTool = tool(
  async ({ domain, question }) =>
    JSON.stringify(
      await privateCorpusQuery({
        domain,
        question,
      }),
    ),
  {
    name: "private_corpus_query",
    description: "Query private project evidence and return a cited answer.",
    schema: z.object({
      domain: z.string().min(1),
      question: z.string().min(1),
    }),
  },
);
```

Reference: [LangChain JavaScript `tool`](https://reference.langchain.com/javascript/langchain-core/tools/tool).

## Agent Policy

Use the tool before answering when the question depends on private project facts,
source excerpts, citations, document comparison, or domain-specific evidence. If
the tool returns no relevant evidence, say the corpus does not currently support
the answer.
