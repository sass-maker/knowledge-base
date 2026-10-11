import { HTTPException } from 'hono/http-exception';
import type { DecisionInput, EvidenceRef, FrozenDecision } from './decision-types';
import type { Repository } from './repository';
import type { ChunkRecord, DocumentRecord } from './types';

export async function loadEvidenceDocuments(repo: Repository, tenant: string, indexId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length > 64 || unique.some((id) => typeof id !== 'string' || !id || id.length > 256))
    throw new HTTPException(400, { message: 'Invalid document ids' });
  const documents: Array<{ document: DocumentRecord; chunks: ChunkRecord[] }> = [];
  for (const id of unique) {
    const document = await repo.getDocument(tenant, id);
    if (!document || document.index_id !== indexId) throw new HTTPException(404, { message: 'Evidence document not found in index' });
    if (document.metadata._kb_snapshot_state === 'superseded')
      throw new HTTPException(409, { message: 'Evidence document was superseded; retrieve current candidates' });
    const chunks = await repo.getChunksByIds(tenant, await repo.getChunkIdsForDocument(tenant, id));
    if (!chunks.length) throw new HTTPException(422, { message: 'Evidence document has no published chunks' });
    documents.push({ document, chunks });
  }
  return documents;
}

export function validateEvidence(value: unknown, chunks: ChunkRecord[]): EvidenceRef {
  if (!value || typeof value !== 'object') throw new Error('Evidence reference is required');
  const ref = value as Partial<EvidenceRef>;
  const chunk = chunks.find((item) => item.id === ref.chunk_id && item.document_id === ref.document_id);
  if (!chunk || typeof ref.excerpt !== 'string' || !ref.excerpt.trim() || ref.excerpt.length > 1200 || !chunk.content.includes(ref.excerpt)) {
    throw new Error('Evidence must quote a published chunk exactly');
  }
  return { document_id: chunk.document_id, chunk_id: chunk.id, excerpt: ref.excerpt };
}

function evidenceOptions(chunks: ChunkRecord[], question: string): Record<string, EvidenceRef> {
  const terms = question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const rows = chunks
    .flatMap((chunk) =>
      (chunk.content.match(/[^\n.!?]+[.!?]?/g) ?? [chunk.content]).map((sentence) => {
        const excerpt = sentence.trim().slice(0, 360);
        return {
          ref: { document_id: chunk.document_id, chunk_id: chunk.id, excerpt },
          score: terms.filter((term) => excerpt.toLowerCase().includes(term)).length,
        };
      }),
    )
    .filter((row) => row.ref.excerpt.length >= 20)
    .sort((a, b) => b.score - a.score);
  const unique = rows.filter((row, i) => rows.findIndex((other) => other.ref.excerpt === row.ref.excerpt) === i).slice(0, 7);
  return Object.fromEntries(unique.map((row, i) => [`e${i + 1}`, row.ref]));
}

function validateDecisionInput(input: DecisionInput): void {
  if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1500)
    throw new HTTPException(400, { message: 'question is required and limited to 1500 characters' });
  if (!Array.isArray(input.context_document_ids) || input.context_document_ids.length < 1 || input.context_document_ids.length > 3)
    throw new HTTPException(400, { message: 'One to three context documents are required' });
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 20)
    throw new HTTPException(400, { message: 'One to twenty candidates are required' });
  if (new Set(input.candidates.map((item) => item?.id)).size !== input.candidates.length) throw new HTTPException(400, { message: 'Duplicate candidate id' });
  for (const candidate of input.candidates) {
    if (
      !candidate ||
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      candidate.id.length > 256 ||
      !Array.isArray(candidate.document_ids) ||
      candidate.document_ids.length < 1 ||
      candidate.document_ids.length > 3
    ) {
      throw new HTTPException(400, { message: 'Each candidate requires an id and one to three document ids' });
    }
  }
}

export async function freezeDecision(repo: Repository, tenant: string, indexId: string, input: DecisionInput): Promise<FrozenDecision> {
  validateDecisionInput(input);
  const sourceIds = [...new Set([...input.context_document_ids, ...input.candidates.flatMap((candidate) => candidate.document_ids)])];
  const documents = await loadEvidenceDocuments(repo, tenant, indexId, sourceIds);
  const context = documents.filter((row) => input.context_document_ids.includes(row.document.id)).flatMap((row) => row.chunks);
  if (input.explicit_gaps !== undefined && (!Array.isArray(input.explicit_gaps) || input.explicit_gaps.length > 3))
    throw new HTTPException(400, { message: 'At most three explicit gaps' });
  let gaps: EvidenceRef[];
  try {
    gaps = (input.explicit_gaps ?? []).map((gap) => validateEvidence(gap, context));
  } catch (error) {
    throw new HTTPException(400, { message: String(error) });
  }
  const projectOptions = evidenceOptions(context, input.question);
  gaps.forEach((gap, i) => {
    projectOptions[`g${i + 1}`] = gap;
  });
  while (Object.keys(projectOptions).length > 7)
    delete projectOptions[
      Object.keys(projectOptions)
        .filter((key) => !key.startsWith('g'))
        .at(-1) ?? ''
    ];
  const frozen: FrozenDecision = {
    schema_version: 1,
    index_id: indexId,
    source_document_ids: sourceIds,
    state: {},
    questions: {},
    candidates: input.candidates.map((candidate) => ({
      id: candidate.id,
      project_options: projectOptions,
      candidate_options: evidenceOptions(
        documents.filter((row) => candidate.document_ids.includes(row.document.id)).flatMap((row) => row.chunks),
        input.question,
      ),
      gaps: gaps.map((_, n) => `g${n + 1}`),
    })),
    coverage: {
      candidates: input.candidates.length,
      omitted_candidates: 0,
      evidence_options_per_candidate: 7,
      excerpt_character_limit: 360,
      packed_bytes: 0,
      evidence_truncated: false,
    },
  };
  packDecision(frozen, input.question);
  return frozen;
}

function choiceOptions(options: Record<string, EvidenceRef>): Record<string, string> {
  return { ...Object.fromEntries(Object.keys(options).map((key) => [key, key])), none: 'Insufficient source evidence.' };
}

function buildDecisionState(frozen: FrozenDecision, question: string): void {
  const projectOptions = frozen.candidates[0]?.project_options ?? {};
  frozen.state = {
    question,
    context_evidence: Object.fromEntries(Object.entries(projectOptions).map(([key, ref]) => [key, ref.excerpt])),
    explicitly_documented_gap_options: frozen.candidates[0]?.gaps ?? [],
    candidates: frozen.candidates.map((candidate, i) => ({
      key: `c${i + 1}`,
      id: candidate.id,
      evidence: Object.fromEntries(Object.entries(candidate.candidate_options).map(([key, ref]) => [key, ref.excerpt])),
    })),
    evidence_policy: 'Bounded source excerpts. Candidate order is not relevance rank. Reject when excerpts do not establish fit.',
  };
  frozen.questions = {};
  frozen.candidates.forEach((candidate, i) => {
    const key = `c${i + 1}`;
    frozen.questions[`${key}_fit`] = {
      type: 'choice',
      instructions: `Evaluate ${key} against context. Shared words alone do not establish fit.`,
      criteria: {
        ...(candidate.gaps.length ? { integration: 'Addresses an explicit unmet gap with compatible capability; select that gap.' } : {}),
        reference: 'Evidence supports a useful comparison or implementation pattern.',
        reject: 'Unsupported, incompatible, no new benefit, or insufficient evidence.',
      },
    };
    frozen.questions[`${key}_project`] = {
      type: 'choice',
      instructions: `Select context_evidence supporting ${key} fit, or none.`,
      criteria: choiceOptions(candidate.project_options),
    };
    frozen.questions[`${key}_candidate`] = {
      type: 'choice',
      instructions: `Select ${key}.evidence supporting its capability, or none.`,
      criteria: choiceOptions(candidate.candidate_options),
    };
  });
}

function trimOptions(options: Record<string, EvidenceRef>, count: number, characters: number, preserveGaps = false): void {
  let kept = 0;
  for (const [key, ref] of Object.entries(options)) {
    if (preserveGaps && key.startsWith('g')) continue;
    if (kept++ >= count) delete options[key];
    else options[key] = { ...ref, excerpt: ref.excerpt.slice(0, characters) };
  }
}

function packDecision(frozen: FrozenDecision, question: string): void {
  for (const [count, characters] of [
    [7, 360],
    [3, 240],
    [2, 160],
    [1, 80],
  ] as const) {
    const projectOptions = frozen.candidates[0]?.project_options ?? {};
    trimOptions(projectOptions, count, characters, true);
    for (const candidate of frozen.candidates) trimOptions(candidate.candidate_options, count, characters);
    buildDecisionState(frozen, question);
    const bytes = new TextEncoder().encode(JSON.stringify({ state: frozen.state, questions: frozen.questions })).byteLength;
    frozen.coverage = {
      candidates: frozen.candidates.length,
      omitted_candidates: 0,
      evidence_options_per_candidate: count,
      excerpt_character_limit: characters,
      packed_bytes: bytes,
      evidence_truncated: count < 7,
    };
    if (bytes <= 24000) return;
  }
  throw new HTTPException(413, { message: 'Frozen decision exceeds context budget even with bounded evidence; shorten question or candidate ids' });
}
