import { Fragment, useEffect, useMemo, useState } from 'react';
import { ApiError, api, type Domain, type Trace, type TraceDrilldown } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/button';
import { formatMs, formatScore, formatTime } from '@/lib/utils';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, History, Loader2, Microscope, Search } from 'lucide-react';

const PAGE_SIZE = 15;

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function QueryHistoryPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('');
  const [traces, setTraces] = useState<Trace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drilldowns, setDrilldowns] = useState<Record<string, TraceDrilldown>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  useEffect(() => {
    api
      .getDomains()
      .then((result) => setDomains(result.domains ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getTraces()
      .then((result) => {
        if (cancelled) return;
        setTraces(result.traces ?? []);
        const requested = new URLSearchParams(window.location.search).get('trace');
        if (requested && result.traces.some((trace) => trace.id === requested)) {
          setExpanded(new Set([requested]));
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? `API error ${cause.status}` : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPage(0);
  }, [domain, mode, query]);

  const modes = useMemo(() => [...new Set(traces.map((trace) => trace.mode).filter(Boolean))].sort(), [traces]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return traces.filter(
      (trace) =>
        (!domain || trace.domain === domain) &&
        (!mode || trace.mode === mode) &&
        (!normalized ||
          trace.question.toLowerCase().includes(normalized) ||
          (trace.answer ?? '').toLowerCase().includes(normalized) ||
          trace.citations.some((citation) => citation.document.toLowerCase().includes(normalized) || citation.content.toLowerCase().includes(normalized))),
    );
  }, [domain, mode, query, traces]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const exported = await api.exportTraces(domain || undefined);
      const filename = `knowledgebase-query-history-${domain || 'all'}-${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(filename, exported);
      setNotice(`Exported ${exported.traces.length} query traces`);
    } catch (cause) {
      setError(cause instanceof ApiError ? `API error ${cause.status}` : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function handleDrilldown(id: string) {
    setBusy(id);
    setError(null);
    try {
      const drilldown = await api.getTraceDrilldown(id);
      setDrilldowns((current) => ({ ...current, [id]: drilldown }));
      setExpanded((current) => new Set(current).add(id));
    } catch (cause) {
      setError(cause instanceof ApiError ? `API error ${cause.status}` : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Query history"
        description="Inspect questions, answers, citations, and retrieval quality"
        action={
          <Button size="sm" variant="secondary" disabled={busy === 'export' || loading} onClick={handleExport}>
            {busy === 'export' ? <Loader2 className="size-4 spin" /> : <Download className="size-4" />}
            Export JSON
          </Button>
        }
      />
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
        {notice && <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">{notice}</div>}

        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <label className="flex min-w-52 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Domain</span>
            <select
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground"
            >
              <option value="">All domains</option>
              {domains.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-64 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Search history</span>
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Question, answer, or cited source…"
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </span>
          </label>

          <label className="flex min-w-44 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Route</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">All routes</option>
              {modes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 spin" />
              Loading query history…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
              <History className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No matching queries</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {query || domain || mode ? 'Clear the filters to widen this view.' : 'Run a cited query to create the first trace.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[960px] w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2.5">
                        <span className="sr-only">Expand</span>
                      </th>
                      <th className="px-3 py-2.5 font-medium">Question</th>
                      <th className="px-3 py-2.5 font-medium">Domain</th>
                      <th className="px-3 py-2.5 font-medium">Route</th>
                      <th className="px-3 py-2.5 text-right font-medium">Citations</th>
                      <th className="px-3 py-2.5 text-right font-medium">Latency</th>
                      <th className="px-4 py-2.5 text-right font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pageRows.map((trace) => {
                      const isOpen = expanded.has(trace.id);
                      const drilldown = drilldowns[trace.id];
                      const supportScore = drilldown?.quality?.support_score;
                      return (
                        <Fragment key={trace.id}>
                          <tr className="hover:bg-muted/20">
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                aria-label={isOpen ? 'Collapse trace' : 'Expand trace'}
                                aria-expanded={isOpen}
                                onClick={() => toggle(trace.id)}
                                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                              </button>
                            </td>
                            <td className="max-w-xl px-3 py-3">
                              <button
                                type="button"
                                onClick={() => toggle(trace.id)}
                                className="line-clamp-2 text-left font-medium leading-relaxed text-foreground"
                              >
                                {trace.question}
                              </button>
                              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{trace.id}</p>
                            </td>
                            <td className="px-3 py-3 font-mono text-xs">{trace.domain}</td>
                            <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{trace.mode}</td>
                            <td className="px-3 py-3 text-right font-mono text-xs">{trace.citations.length}</td>
                            <td className="px-3 py-3 text-right font-mono text-xs">{formatMs(trace.latency_ms)}</td>
                            <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatTime(trace.created_at)}</td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-background/40">
                              <td colSpan={7} className="px-4 py-5 sm:px-12">
                                <div className="flex flex-col gap-5">
                                  <section>
                                    <h3 className="text-xs font-semibold text-muted-foreground">Answer</h3>
                                    <p className="mt-2 max-w-4xl whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                                      {trace.answer || 'No synthesized answer was recorded.'}
                                    </p>
                                  </section>

                                  <div className="flex flex-wrap items-center gap-2">
                                    {typeof supportScore === 'number' && (
                                      <span className="rounded-full bg-accent/10 px-2.5 py-1 font-mono text-xs text-accent">
                                        support {formatScore(supportScore)}
                                      </span>
                                    )}
                                    <Button size="sm" variant="secondary" disabled={busy === trace.id} onClick={() => handleDrilldown(trace.id)}>
                                      {busy === trace.id ? <Loader2 className="size-4 spin" /> : <Microscope className="size-4" />}
                                      Quality drilldown
                                    </Button>
                                  </div>

                                  <section>
                                    <h3 className="text-xs font-semibold text-muted-foreground">Citations ({trace.citations.length})</h3>
                                    {trace.citations.length === 0 ? (
                                      <p className="mt-2 text-sm text-destructive">No citations were recorded for this trace.</p>
                                    ) : (
                                      <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                                        {trace.citations.map((citation, index) => (
                                          <div
                                            key={`${trace.id}-${citation.chunk_id}-${index}`}
                                            className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
                                          >
                                            <div>
                                              <p className="text-sm leading-relaxed text-foreground">{citation.content}</p>
                                              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                                                {citation.document} · file {citation.file_id ?? 'unknown'} · page{' '}
                                                {citation.page_start === citation.page_end
                                                  ? citation.page_start
                                                  : `${citation.page_start}–${citation.page_end}`}
                                              </p>
                                            </div>
                                            <span className="font-mono text-xs text-muted-foreground">{formatScore(citation.score)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </section>

                                  {drilldown && (
                                    <details>
                                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Raw quality signals</summary>
                                      <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
                                        {JSON.stringify(drilldown.quality, null, 2)}
                                      </pre>
                                    </details>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="font-mono">
                    {page + 1}/{pages}
                  </span>
                  <Button size="sm" variant="ghost" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Query History loads the latest 50 traces for this tenant. Export uses the same authenticated history boundary.
        </p>
      </div>
    </>
  );
}
