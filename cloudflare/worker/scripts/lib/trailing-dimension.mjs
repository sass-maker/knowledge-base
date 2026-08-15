/**
 * Extract a trailing 2-5 digit dimension suffix from a model/binding name
 * (e.g. "bge-large-en-v1.5" → 5, "voyage-3-lite" → 3).
 * Returns `null` when the value is not a string or no trailing dimension is found.
 */
export function trailingDimension(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/(?:^|[-_])(\d{2,5})$/);
  if (!match) return null;
  const dimension = Number(match[1]);
  return Number.isInteger(dimension) && dimension > 0 ? dimension : null;
}
