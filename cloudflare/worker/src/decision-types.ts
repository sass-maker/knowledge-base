import type { JsonRecord } from './types';

export interface EvidenceRef {
  document_id: string;
  chunk_id: string;
  excerpt: string;
}
interface DecisionCandidate {
  id: string;
  document_ids: string[];
}
export interface DecisionInput {
  question: string;
  context_document_ids: string[];
  candidates: DecisionCandidate[];
  explicit_gaps?: EvidenceRef[];
  engine?: 'free_ai' | 'jev';
}
export interface DecisionItem {
  candidate_id: string;
  verdict: 'integration' | 'reference' | 'reject';
  reason: string;
  benefit: string;
  project_evidence: EvidenceRef[];
  candidate_evidence: EvidenceRef[];
}
export interface DecisionResult {
  abstained: boolean;
  items: DecisionItem[];
}
export interface DecisionEngineResult {
  status: 'ok' | 'disabled' | 'error';
  requested_model: string;
  resolved_model: string | null;
  provider: string | null;
  latency_ms: number;
  usage: JsonRecord | null;
  raw: unknown;
  result?: DecisionResult;
  error?: string;
}
interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
export interface FrozenDecision {
  schema_version: 1;
  index_id: string;
  source_document_ids: string[];
  state: JsonRecord;
  questions: Record<string, ChoiceQuestion>;
  candidates: Array<{ id: string; project_options: Record<string, EvidenceRef>; candidate_options: Record<string, EvidenceRef>; gaps: string[] }>;
  coverage: {
    candidates: number;
    omitted_candidates: 0;
    evidence_options_per_candidate: number;
    excerpt_character_limit: number;
    packed_bytes: number;
    evidence_truncated: boolean;
  };
}
