import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const corpusBytes = readFileSync(new URL('./public-cases.json', import.meta.url));
export const corpus = JSON.parse(corpusBytes);
export const corpusHash = createHash('sha256').update(corpusBytes).digest('hex');
const hash = (text) => createHash('sha256').update(text).digest('hex');

export function verifyCorpus() {
  for (const source of Object.values(corpus.sources)) {
    if (hash(source.excerpt) !== source.excerpt_sha256 || !source.url.includes(source.revision)) throw new Error('Frozen source digest mismatch');
  }
  if (new Set(corpus.cases.map((row) => row.id)).size !== corpus.cases.length) throw new Error('Duplicate benchmark case');
}

// Inputs contain no expected labels, rationales or held-out cases.
export function developmentInputs() {
  return corpus.cases
    .filter((row) => row.split === 'development')
    .map((row) => ({
      id: row.id,
      user_problem: row.user_problem,
      operation: row.operation,
      project: corpus.sources[row.project],
      candidate: corpus.sources[row.candidate],
    }));
}

function evaluatedRows(observations) {
  const seen = new Set();
  return observations.rows.map((row) => {
    const test = corpus.cases.find((item) => item.id === row.id && item.split === 'development');
    if (!test || seen.has(row.id)) throw new Error('Unknown, held-out or duplicate observation');
    seen.add(row.id);
    if (!['ok', 'unavailable', 'rate_limited', 'error'].includes(row.status)) throw new Error('Invalid observation status');
    if (row.status !== 'ok') return { ...row, test };
    if (typeof row.useful !== 'boolean') throw new Error('Completed decision requires usefulness');
    if (row.project_id !== 'knowledge-base' || row.requested_model !== 'auto' || !row.model || row.model === 'auto' || !row.provider)
      throw new Error('Completed observation requires gateway model/provider attribution');
    const exact = row.project_excerpt === corpus.sources[test.project].excerpt && row.candidate_excerpt === corpus.sources[test.candidate].excerpt;
    return { ...row, test, exact };
  });
}

export function evaluate(observations) {
  verifyCorpus();
  const total = developmentInputs().length;
  if (!observations)
    return {
      mode: 'offline_source_inventory',
      corpus_sha256: corpusHash,
      provisional_labels: true,
      development_cases: total,
      held_out_cases: corpus.cases.length - total,
      evaluated_cases: 0,
      false_positives: null,
      false_negatives: null,
      entailment: null,
      coverage: { observed: 0, expected: total },
      cache_reuse: null,
      latency_ms: null,
      gateway_429: null,
      live_observations: 'Not supplied; consult the runtime capability receipt before attempting inference.',
    };
  if (observations.corpus_sha256 !== corpusHash || observations.mode !== 'live_free_ai')
    throw new Error('Only attributed live observations for this frozen corpus can produce quality metrics');
  const rows = evaluatedRows(observations);
  const complete = rows.filter((row) => row.status === 'ok');
  const scored = complete.filter((row) => row.test.provisional_label !== 'ambiguous');
  const latencies = rows
    .map((row) => row.latency_ms)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  return {
    mode: observations.mode,
    corpus_sha256: corpusHash,
    provisional_labels: true,
    evaluated_cases: scored.length,
    false_positives: scored.filter((row) => row.useful && row.test.provisional_label !== 'useful').map((row) => row.id),
    false_negatives: scored.filter((row) => !row.useful && row.test.provisional_label === 'useful').map((row) => row.id),
    ambiguous: complete.filter((row) => row.test.provisional_label === 'ambiguous').map((row) => row.id),
    coverage: { observed: rows.length, completed: complete.length, expected: total, held_out: corpus.cases.length - total },
    citation_existence: { exact: complete.filter((row) => row.exact).length, checked: complete.length },
    entailment: 'Requires separate literal-claim review; exact quotes alone do not prove entailment.',
    cache_reuse: {
      explicitly_observed_hits: rows.filter((row) => row.cache_hit === true).length,
      known: rows.filter((row) => typeof row.cache_hit === 'boolean').length,
    },
    latency_ms: {
      samples: latencies.length,
      median: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
      p95: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
    },
    gateway_429: rows.filter((row) => row.status === 'rate_limited').length,
    unavailable: rows.filter((row) => row.status === 'unavailable').length,
    errors: rows.filter((row) => row.status === 'error').length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  console.log(
    JSON.stringify(
      path === '--inputs' ? { corpus_sha256: corpusHash, cases: developmentInputs() } : evaluate(path ? JSON.parse(readFileSync(path, 'utf8')) : null),
      null,
      2,
    ),
  );
}
