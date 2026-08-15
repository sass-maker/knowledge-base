export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function summarizeLatencies(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min_ms: Math.round((sorted[0] ?? 0) * 100) / 100,
    p50_ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95_ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99_ms: Math.round(percentile(sorted, 99) * 100) / 100,
    max_ms: Math.round((sorted.at(-1) ?? 0) * 100) / 100,
    mean_ms: Math.round((sorted.length ? total / sorted.length : 0) * 100) / 100,
  };
}
