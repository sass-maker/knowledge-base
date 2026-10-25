import { describe, expect, it, vi } from 'vitest';
import { answerFromEvidence } from '../src/query';
import type { CitationRecord, Env, SearchResult } from '../src/types';

const citation: CitationRecord = {
  index: 1,
  document_id: 'doc-1',
  chunk_id: 'chunk-1',
  file_id: 'file-1',
  filename: 'paper.pdf',
  page_start: 1,
  page_end: 1,
  excerpt: 'Self-attention lets each token weigh relationships with other tokens in the sequence.',
  score: 0.9,
  metadata: {},
};

const retrieved: SearchResult[] = [
  {
    document_id: 'doc-1',
    chunk_id: 'chunk-1',
    chunk_content: citation.excerpt,
    score: 0.9,
    metadata: {},
  },
];

function setup(content: string) {
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content } }] }));
  const env = { FREE_AI: { run: vi.fn(), fetch } } as unknown as Env;
  const run = (
    requestedMode: 'workers_ai' | 'extractive' = 'workers_ai',
    citations: CitationRecord[] = [citation],
    searchResults: SearchResult[] = retrieved,
  ) =>
    answerFromEvidence({
      env,
      question: 'What problem does self-attention address?',
      citations,
      retrieved: searchResults,
      extractiveAnswer: 'Self-attention connects token relationships. [1]',
      baseConfidence: { level: 'high' },
      requestedMode,
    });
  return { fetch, run };
}

describe('AI answer support gate', () => {
  it('keeps typed insufficient-evidence abstention and replaces model prose with a fixed refusal', async () => {
    const { run } = setup('{"status":"insufficient_evidence"}');
    const result = await run();

    expect(result.answer).toBe('I do not have enough cited evidence in this domain to answer.');
    expect(result.answerMode).toBe('free_ai');
    expect(result.aiUsed).toBe(true);
    expect(result.confidence).toMatchObject({
      level: 'none',
      verification_status: 'abstained',
      verification_checked: false,
      answer_support_reason: 'model_reported_insufficient_evidence',
    });
    expect(result.timing).toMatchObject({ answer_mode: 'free_ai', synthesis_outcome: 'insufficient_evidence' });
  });

  it('accepts a typed refusal inside an exact JSON code fence', async () => {
    const { run } = setup('```json\n{"status":"insufficient_evidence"}\n```');
    const result = await run();

    expect(result.answer).toBe('I do not have enough cited evidence in this domain to answer.');
    expect(result.confidence).toMatchObject({ level: 'none', verification_status: 'abstained' });
  });

  it('rejects arbitrary uncited generated prose', async () => {
    const { run } = setup('Self-attention solves the vanishing gradient problem.');
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.answerMode).toBe('extractive');
    expect(result.timing.synthesis_fallback).toBe('uncited_response');
  });

  it('rejects a cited answer that invents an evidence ID', async () => {
    const { run } = setup('Self-attention connects tokens. [999]');
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.timing.synthesis_fallback).toBe('unknown_citation_id');
  });

  it('rejects a mixed valid and invented citation list', async () => {
    const { run } = setup('Self-attention connects token relationships. [1] But also does more. [999]');
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.timing.synthesis_fallback).toBe('unknown_citation_id');
  });

  it('does not accept a citation row beyond the five shown to the model', async () => {
    const sixthCitation = { ...citation, index: 6, chunk_id: 'chunk-6', excerpt: 'A sixth cited excerpt.' };
    const { run } = setup('A claim from the sixth excerpt. [6]');
    const result = await run('workers_ai', [citation, ...Array.from({ length: 4 }, (_, index) => ({ ...citation, index: index + 2 })), sixthCitation]);

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.timing.synthesis_fallback).toBe('unknown_citation_id');
  });

  it('does not accept an ID whose citation row was cut off by the evidence text bound', async () => {
    const longCitations = Array.from({ length: 5 }, (_, index) => ({
      ...citation,
      index: index + 1,
      chunk_id: `chunk-${index + 1}`,
      excerpt: `Evidence ${index + 1}. ${'bounded evidence text '.repeat(70)}`,
    }));
    const { run } = setup('A claim from the truncated excerpt. [5]');
    const result = await run('workers_ai', longCitations);

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.timing.synthesis_fallback).toBe('unknown_citation_id');
  });

  it('preserves a valid legacy cited answer', async () => {
    const { run } = setup('Self-attention connects token relationships. [1]');
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.answerMode).toBe('free_ai');
    expect(result.aiUsed).toBe(true);
  });

  it('preserves a cited legacy JSON answer', async () => {
    const { run } = setup('{"answer":"Self-attention connects token relationships. [1]"}');
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.answerMode).toBe('free_ai');
    expect(result.aiUsed).toBe(true);
  });

  it('accepts a typed supported answer only when its inline and declared citation IDs match', async () => {
    const { run } = setup('{"status":"answered","answer":"Self-attention connects token relationships. [1]","citation_ids":[1]}');
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.answerMode).toBe('free_ai');
    expect(result.aiUsed).toBe(true);
  });

  it('rejects a typed answer when declared and inline citation IDs differ', async () => {
    const secondCitation = { ...citation, index: 2, chunk_id: 'chunk-2', excerpt: 'A second supporting excerpt.' };
    const { run } = setup('{"status":"answered","answer":"Self-attention connects token relationships. [1]","citation_ids":[2]}');
    const result = await run('workers_ai', [citation, secondCitation]);

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.timing.synthesis_fallback).toBe('citation_id_mismatch');
  });

  it('accepts typed supported answers inside an exact JSON code fence', async () => {
    const { run } = setup('```json\n{"status":"answered","answer":"Self-attention connects token relationships. [1]","citation_ids":[1]}\n```');
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.answerMode).toBe('free_ai');
  });

  it('rejects a citation that appears only beyond the rendered answer limit', async () => {
    const { run } = setup(`${'Supported explanation. '.repeat(220)} [1]`);
    const result = await run();

    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.timing.synthesis_fallback).toBe('uncited_response');
  });

  it('falls back with explicit reasons for malformed and unsupported typed output', async () => {
    for (const [content, reason] of [
      ['{"status":"insufficient_evidence",', 'malformed_typed_output'],
      ['{"status":"unsupported"}', 'unsupported_typed_status'],
      ['{"status":"insufficient_evidence","answer":"invented claim"}', 'malformed_typed_output'],
    ] as const) {
      const { run } = setup(content);
      const result = await run();
      expect(result.answer).toBe('Self-attention connects token relationships. [1]');
      expect(result.timing.synthesis_fallback).toBe(reason);
    }
  });

  it('keeps extractive mode independent of the model response', async () => {
    const { fetch, run } = setup('{"status":"insufficient_evidence"}');
    const result = await run('extractive');

    expect(fetch).not.toHaveBeenCalled();
    expect(result.answer).toBe('Self-attention connects token relationships. [1]');
    expect(result.answerMode).toBe('extractive');
    expect(result.aiUsed).toBe(false);
  });
});
