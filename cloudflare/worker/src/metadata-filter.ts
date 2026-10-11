import { HTTPException } from 'hono/http-exception';
import type { JsonRecord } from './types';

type Scalar = string | number | boolean | null;
type SqlValue = string | number | null;
type Condition = { key: string; operator: string; values: Scalar[] };

function scalar(value: unknown): value is Scalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function conditions(filter: unknown): Condition[] {
  if (filter === undefined || filter === null) return [];
  if (typeof filter !== 'object' || Array.isArray(filter)) throw new HTTPException(400, { message: 'filter must be an object' });
  const out: Condition[] = [];
  const entries = Object.entries(filter);
  if (entries.length > 12) throw new HTTPException(400, { message: 'filter has too many fields' });
  for (const [key, value] of entries) {
    if (key !== 'tenant' && key !== 'index_id') out.push(...fieldConditions(key, value));
  }
  if (out.reduce((sum, condition) => sum + condition.values.length, 0) > 64) throw new HTTPException(400, { message: 'filter has too many values' });
  return out;
}

function fieldConditions(key: string, value: unknown): Condition[] {
  const out: Condition[] = [];
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)) throw new HTTPException(400, { message: 'Invalid filter field' });
  const operators = scalar(value) ? [['$eq', value]] : Object.entries((value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as JsonRecord);
  if (!operators.length || operators.length > 2) throw new HTTPException(400, { message: 'Invalid filter condition' });
  for (const [operator, operand] of operators) {
    if (!['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte'].includes(String(operator))) {
      throw new HTTPException(400, { message: 'Unsupported filter operator' });
    }
    const values = operator === '$in' || operator === '$nin' ? operand : [operand];
    if (!Array.isArray(values) || values.length > 20 || !values.every(scalar)) throw new HTTPException(400, { message: 'Invalid filter operand' });
    out.push({ key, operator: String(operator), values });
  }
  return out;
}

export function metadataFilterSql(filter: unknown, column = 'metadata'): { sql: string; values: SqlValue[] } {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  for (const condition of conditions(filter)) {
    const path = `$.${condition.key}`;
    const value = `json_extract(${column}, ?)`;
    const operands = condition.values.map((item) => (typeof item === 'boolean' ? Number(item) : item));
    if (condition.operator === '$in' || condition.operator === '$nin') {
      if (!operands.length) {
        clauses.push(condition.operator === '$in' ? '0' : '1');
        continue;
      }
      const present = operands.filter((operand) => operand !== null);
      if (condition.operator === '$in') {
        const alternatives: string[] = [];
        if (operands.includes(null)) {
          alternatives.push(`${value} IS NULL`);
          values.push(path);
        }
        if (present.length) {
          alternatives.push(`${value} IN (${present.map(() => '?').join(',')})`);
          values.push(path, ...present);
        }
        clauses.push(`(${alternatives.join(' OR ')})`);
      } else {
        const membership = present.length ? value + ' NOT IN (' + present.map(() => '?').join(',') + ')' : '1';
        clauses.push(value + ' IS NOT NULL AND ' + membership);
        values.push(path, ...(present.length ? [path, ...present] : []));
      }
    } else {
      const operator = ({ $eq: 'IS', $ne: 'IS NOT', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' } as Record<string, string>)[condition.operator];
      if (!['$eq', '$ne'].includes(condition.operator)) {
        clauses.push(`json_type(${column}, ?) ${typeof operands[0] === 'number' ? "IN ('integer','real')" : "= 'text'"}`);
        values.push(path);
      }
      clauses.push(`${value} ${operator} ?`);
      values.push(path, operands[0] ?? null);
    }
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1', values };
}

export function matchesMetadataFilter(metadata: JsonRecord, filter: unknown): boolean {
  return conditions(filter).every(({ key, operator, values }) => {
    const actual =
      key.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as JsonRecord)[part] : undefined), metadata) ?? null;
    if (operator === '$eq') return actual === values[0];
    if (operator === '$ne') return actual !== values[0];
    if (operator === '$in') return values.includes(actual as Scalar);
    if (operator === '$nin') return actual !== null && !values.includes(actual as Scalar);
    const expected = values[0];
    if ((typeof actual !== 'string' && typeof actual !== 'number') || typeof actual !== typeof expected) return false;
    const comparison =
      typeof actual === 'number' && typeof expected === 'number'
        ? actual - expected
        : String(actual) < String(expected)
          ? -1
          : String(actual) > String(expected)
            ? 1
            : 0;
    if (operator === '$gt') return comparison > 0;
    if (operator === '$gte') return comparison >= 0;
    if (operator === '$lt') return comparison < 0;
    return comparison <= 0;
  });
}
