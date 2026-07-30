import { describe, expect, it, vi } from 'vitest';

import { KnowledgebaseClient, type KnowledgebaseAnswer } from '../src/client';

function answerPayload(): KnowledgebaseAnswer {
  return {
    project: 'tenant-a',
    domain: 'manuals',
    index_id: 'index-1',
    route: 'hybrid_rrf',
    ai_used: false,
    trace_id: 'trace-1',
    session_id: null,
    answer_mode: 'extractive',
    answer_model: null,
    question: 'What is the rollback procedure?',
    answer: 'Use the documented rollback checklist.',
    citations: [
      {
        index: 1,
        document_id: 'document-1',
        chunk_id: 'chunk-1',
        file_id: 'file-1',
        filename: 'runbook.pdf',
        page_start: 7,
        page_end: 7,
        excerpt: 'Use the documented rollback checklist.',
        score: 0.94,
        metadata: { section: 'Rollback' },
      },
    ],
    confidence: { level: 'high', verification_status: 'supported' },
    data: [
      {
        document_id: 'document-1',
        chunk_id: 'chunk-1',
        chunk_content: 'Use the documented rollback checklist.',
        score: 0.94,
        metadata: { file_id: 'file-1', page: 7 },
      },
    ],
  };
}

describe('KnowledgebaseClient query HTTP contract', () => {
  it('sends the stable /v1/kb/query request and preserves cited evidence', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(answerPayload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = new KnowledgebaseClient({
      baseUrl: 'https://kb.example/',
      serviceKey: 'service-key',
      fetch: fetchImpl as typeof fetch,
    });

    const answer = await client.query({
      domain: 'manuals',
      question: 'What is the rollback procedure?',
      top_k: 5,
      mode: 'hybrid',
      answer_mode: 'extractive',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith('https://kb.example/v1/kb/query', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer service-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        domain: 'manuals',
        question: 'What is the rollback procedure?',
        top_k: 5,
        mode: 'hybrid',
        answer_mode: 'extractive',
      }),
    });
    expect(answer).toMatchObject({
      trace_id: 'trace-1',
      answer: 'Use the documented rollback checklist.',
      citations: [
        {
          file_id: 'file-1',
          filename: 'runbook.pdf',
          page_start: 7,
          page_end: 7,
          excerpt: 'Use the documented rollback checklist.',
        },
      ],
    });
  });

  it('surfaces an authenticated HTTP error without treating it as an answer', async () => {
    const client = new KnowledgebaseClient({
      baseUrl: 'https://kb.example',
      serviceKey: 'expired-key',
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      ) as typeof fetch,
    });

    await expect(
      client.query({ domain: 'manuals', question: 'What changed?' })
    ).rejects.toThrow('unauthorized');
  });
});
