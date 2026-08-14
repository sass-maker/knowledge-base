import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type ChunkEntry, type Domain, type EntityRecord, type FileEntry, type Job, type RelationshipRecord } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/button';
import { cn, formatTime, truncate } from '@/lib/utils';
import { Boxes, Briefcase, ChevronLeft, ChevronRight, Database, FileText, GitBranch, Loader2, RefreshCw, Search } from 'lucide-react';

type DataTab = 'files' | 'chunks' | 'jobs' | 'entities' | 'relationships';

const PAGE_SIZE = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function includesQuery(values: unknown[], query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(normalized),
  );
}

function StatusBadge({ value }: { value: string }) {
  const state = value.toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 font-mono text-[11px]',
        state === 'ready' || state === 'done' || state === 'complete'
          ? 'bg-emerald-500/15 text-emerald-400'
          : state === 'failed' || state === 'error'
            ? 'bg-red-500/15 text-red-400'
            : state === 'pending' || state === 'queued' || state === 'running'
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-muted text-muted-foreground',
      )}
    >
      {value}
    </span>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span>
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" aria-label="Previous page" disabled={page === 0} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="font-mono">
          {page + 1}/{pages}
        </span>
        <Button size="sm" variant="ghost" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default function DataPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [tab, setTab] = useState<DataTab>('files');
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [chunks, setChunks] = useState<ChunkEntry[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [relationships, setRelationships] = useState<RelationshipRecord[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
    Promise.all([
      api.getFiles(domain || undefined),
      api.getChunks(domain || undefined),
      api.getJobs(domain || undefined),
      api.getEntities(domain || undefined),
      api.getRelationships(domain || undefined),
    ])
      .then(([fileResult, chunkResult, jobResult, entityResult, relationshipResult]) => {
        if (cancelled) return;
        setFiles(fileResult.files ?? []);
        setChunks(chunkResult);
        setJobs(jobResult.jobs ?? []);
        setEntities(entityResult);
        setRelationships(relationshipResult);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? `API error ${cause.status}` : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain, refreshKey]);

  useEffect(() => {
    setPage(0);
    setKindFilter('');
  }, [tab, domain]);

  useEffect(() => {
    setPage(0);
  }, [query, kindFilter]);

  const filtered = useMemo(() => {
    if (tab === 'files') {
      return files.filter(
        (file) =>
          (!kindFilter || file.status === kindFilter) && includesQuery([file.filename, file.id, file.domain, file.content_hash, file.mime, file.error], query),
      );
    }
    if (tab === 'chunks') {
      return chunks.filter((chunk) => includesQuery([chunk.text, chunk.id, chunk.file_id, chunk.domain, JSON.stringify(chunk.metadata)], query));
    }
    if (tab === 'jobs') {
      return jobs.filter(
        (job) => (!kindFilter || job.status === kindFilter) && includesQuery([job.id, job.file_id, job.domain, job.stage, job.status, job.error], query),
      );
    }
    if (tab === 'entities') {
      return entities.filter(
        (entity) =>
          (!kindFilter || entity.type === kindFilter) &&
          includesQuery([entity.display_name, entity.identity_key, entity.id, entity.domain, entity.type, JSON.stringify(entity.field_values ?? {})], query),
      );
    }
    return relationships.filter(
      (relationship) =>
        (!kindFilter || relationship.rel_type === kindFilter) &&
        includesQuery(
          [
            relationship.source_display_name,
            relationship.target_display_name,
            relationship.src_id,
            relationship.dst_id,
            relationship.domain,
            relationship.rel_type,
            relationship.evidence_file,
          ],
          query,
        ),
    );
  }, [chunks, entities, files, jobs, kindFilter, query, relationships, tab]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const filterOptions = useMemo(() => {
    const values =
      tab === 'files'
        ? files.map((file) => file.status)
        : tab === 'jobs'
          ? jobs.map((job) => job.status)
          : tab === 'entities'
            ? entities.map((entity) => entity.type)
            : tab === 'relationships'
              ? relationships.map((relationship) => relationship.rel_type)
              : [];
    return [...new Set(values.filter(Boolean))].sort();
  }, [entities, files, jobs, relationships, tab]);

  const tabs: Array<{
    id: DataTab;
    label: string;
    count: number;
    icon: typeof FileText;
  }> = [
    { id: 'files', label: 'Files', count: files.length, icon: FileText },
    { id: 'chunks', label: 'Chunks', count: chunks.length, icon: Boxes },
    { id: 'jobs', label: 'Jobs', count: jobs.length, icon: Briefcase },
    { id: 'entities', label: 'Entities', count: entities.length, icon: Database },
    {
      id: 'relationships',
      label: 'Relationships',
      count: relationships.length,
      icon: GitBranch,
    },
  ];

  return (
    <>
      <PageHeader
        title="Data"
        description="Inspect stored corpus records and ingestion state"
        action={
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>
            <RefreshCw className={cn('size-4', loading && 'spin')} />
            Refresh
          </Button>
        }
      />
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

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
            <span className="text-xs font-medium text-muted-foreground">Search records</span>
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filename, ID, excerpt, entity, error…"
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </span>
          </label>

          {filterOptions.length > 0 && (
            <label className="flex min-w-44 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{tab === 'entities' || tab === 'relationships' ? 'Type' : 'Status'}</span>
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="">All</option>
                {filterOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
          {tabs.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={cn(
                  'flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition-colors',
                  selected ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
                <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px]">{item.count}</span>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 spin" />
              Loading corpus data…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
              <Database className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No matching {tab}</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {query || kindFilter ? 'Clear the filters to widen this view.' : 'This data type has not been created for the selected domain yet.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                {tab === 'files' && (
                  <table className="min-w-[900px] w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">File</th>
                        <th className="px-4 py-2.5 font-medium">Domain</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Size</th>
                        <th className="px-4 py-2.5 font-medium">Uploaded</th>
                        <th className="px-4 py-2.5 font-medium">Failure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(pageRows as FileEntry[]).map((file) => (
                        <tr key={file.id} className="align-top hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <p className="max-w-72 truncate font-medium text-foreground">{file.filename}</p>
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{file.id}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{file.domain}</td>
                          <td className="px-4 py-3">
                            <StatusBadge value={file.status} />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{formatBytes(file.size)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatTime(file.created_at)}</td>
                          <td className="max-w-64 px-4 py-3 text-xs text-destructive">{file.error ? truncate(file.error, 120) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {tab === 'chunks' && (
                  <table className="min-w-[940px] w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Excerpt</th>
                        <th className="px-4 py-2.5 font-medium">Domain</th>
                        <th className="px-4 py-2.5 font-medium">File ID</th>
                        <th className="px-4 py-2.5 font-medium">Pages</th>
                        <th className="px-4 py-2.5 font-medium">Chunk ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(pageRows as ChunkEntry[]).map((chunk) => (
                        <tr key={chunk.id} className="align-top hover:bg-muted/20">
                          <td className="max-w-xl px-4 py-3">
                            <details>
                              <summary className="cursor-pointer text-sm leading-relaxed text-foreground">{truncate(chunk.text, 180)}</summary>
                              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{chunk.text}</p>
                            </details>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{chunk.domain}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{chunk.file_id}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {chunk.page_start === chunk.page_end ? chunk.page_start : `${chunk.page_start}–${chunk.page_end}`}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{chunk.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {tab === 'jobs' && (
                  <table className="min-w-[900px] w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Job</th>
                        <th className="px-4 py-2.5 font-medium">Domain</th>
                        <th className="px-4 py-2.5 font-medium">Stage</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Updated</th>
                        <th className="px-4 py-2.5 font-medium">Failure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(pageRows as Job[]).map((job) => (
                        <tr key={job.id} className="align-top hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs text-foreground">{job.id}</p>
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{job.file_id}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{job.domain}</td>
                          <td className="px-4 py-3 text-foreground">{job.stage}</td>
                          <td className="px-4 py-3">
                            <StatusBadge value={job.status} />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{formatTime(job.updated_at)}</td>
                          <td className="max-w-72 px-4 py-3 text-xs text-destructive">{job.error ? truncate(job.error, 150) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {tab === 'entities' && (
                  <table className="min-w-[820px] w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Entity</th>
                        <th className="px-4 py-2.5 font-medium">Domain</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Identity</th>
                        <th className="px-4 py-2.5 font-medium">Fields</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(pageRows as EntityRecord[]).map((entity) => (
                        <tr key={entity.id} className="align-top hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{entity.display_name ?? entity.identity_key}</p>
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{entity.id}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{entity.domain}</td>
                          <td className="px-4 py-3">
                            <StatusBadge value={entity.type} />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entity.identity_key}</td>
                          <td className="max-w-72 px-4 py-3 font-mono text-xs text-muted-foreground">
                            {truncate(JSON.stringify(entity.field_values ?? {}), 120)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {tab === 'relationships' && (
                  <table className="min-w-[900px] w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Relationship</th>
                        <th className="px-4 py-2.5 font-medium">Domain</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Source</th>
                        <th className="px-4 py-2.5 font-medium">Evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(pageRows as RelationshipRecord[]).map((relationship) => (
                        <tr key={relationship.id} className="align-top hover:bg-muted/20">
                          <td className="px-4 py-3 text-foreground">
                            {relationship.source_display_name ?? relationship.src_id}
                            <span className="px-2 text-muted-foreground">→</span>
                            {relationship.target_display_name ?? relationship.dst_id}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{relationship.domain}</td>
                          <td className="px-4 py-3">
                            <StatusBadge value={relationship.rel_type} />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {relationship.src_id} → {relationship.dst_id}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {relationship.evidence_file
                              ? `${relationship.evidence_file}${relationship.evidence_page ? ` · p.${relationship.evidence_page}` : ''}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <Pager page={page} total={filtered.length} onChange={setPage} />
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Loaded window: up to 500 records per data type. Filters and pagination apply to this authenticated tenant-scoped window.
        </p>
      </div>
    </>
  );
}
