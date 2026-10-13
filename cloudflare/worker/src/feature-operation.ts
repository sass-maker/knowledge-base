import { jsonRecord } from './app-utils';
import type { JsonRecord } from './types';

export interface FeatureOperation {
  input: string;
  action: string;
  output: string;
  method: string;
  constraints: string[];
  importance: 'core' | 'supporting';
}

export const operationSchema: JsonRecord = {
  type: 'object', additionalProperties: false,
  properties: {
    input: { type: 'string', minLength: 1, maxLength: 100 },
    action: { type: 'string', minLength: 1, maxLength: 100 },
    output: { type: 'string', minLength: 1, maxLength: 100 },
    method: { type: 'string', maxLength: 140 },
    constraints: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 100 } },
    importance: { type: 'string', enum: ['core', 'supporting'] },
  }, required: ['input', 'action', 'output', 'method', 'constraints', 'importance'],
};

export function parseFeatureOperation(value: unknown): FeatureOperation {
  const row = jsonRecord(value);
  const text = (key: string, limit: number, empty = false): string => {
    const value = row[key];
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > limit)
      throw new Error(`Invalid feature operation ${key}`);
    return value.trim();
  };
  if (Object.keys(row).some((key) => !['input', 'action', 'output', 'method', 'constraints', 'importance'].includes(key)) ||
    !Array.isArray(row.constraints) || row.constraints.length > 3 || row.constraints.some((value) => typeof value !== 'string' || !value.trim() || value.length > 100) ||
    !['core', 'supporting'].includes(String(row.importance))) throw new Error('Invalid feature operation');
  return {
    input: text('input', 100), action: text('action', 100), output: text('output', 100),
    method: text('method', 140, true), constraints: row.constraints as string[],
    importance: row.importance as FeatureOperation['importance'],
  };
}
