import { useCallback, useEffect, useRef, useState } from 'react';
import type { Domain, KbStatus } from '@/lib/api';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/button';
import { Card, CardTitle, Skeleton, StatCard } from '@/components/card';
import { Onboarding, isOnboardingDone } from '@/components/onboarding';
import { PageHeader } from '@/components/page-header';
import { useOverviewCache } from '@/components/overview-cache';
import { AppLink as Link } from '@/components/app-link';
import { formatTime } from '@/lib/utils';
import { ArrowRight, Database, History, Search, TableProperties } from 'lucide-react';

export interface OverviewContentProps {
  status: KbStatus | null;
  domains: Domain[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function OverviewContent({ status, domains, loading, error, onRetry }: OverviewContentProps) {
  const errorNotice = error ? (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
      <p>Could not load overview data. {error}</p>
      <Button className="mt-3" variant="secondary" onClick={onRetry}>
        Retry overview
      </Button>
    </div>
  ) : null;
  if (error && !status) return errorNotice;

  if (loading && !status) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading overview" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {errorNotice}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Domains" value={status?.domains ?? 0} />
        <StatCard label="Files" value={status?.files ?? 0} />
        <StatCard label="Active Schemas" value={status?.schemas ?? 0} hint={`${status?.schema_drafts ?? 0} pending drafts`} />
        <StatCard label="Entities" value={status?.entities ?? 0} />
        <StatCard label="Jobs" value={status?.jobs ?? 0} />
        <StatCard label="Relationships" value={status?.relationships ?? 0} />
        <StatCard label="Recent Traces" value={status?.recent_traces ?? 0} hint="last 50" />
        <StatCard label="Recent Eval Reports" value={status?.recent_eval_reports ?? 0} hint="last 50" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Domains</CardTitle>
          {domains.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">No domains yet. Create one to start ingesting files and running queries.</p>
              <Link
                href="/domains"
                className="inline-flex h-9 w-fit items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Database className="size-4" /> Create a domain
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {domains.slice(0, 5).map((d) => (
                <Link
                  key={d.name}
                  href={`/domains?domain=${encodeURIComponent(d.name)}`}
                  className="card-lift flex items-center justify-between rounded-lg border border-border bg-background/50 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2.5">
                    <Database className="size-4 text-muted-foreground" />
                    <span className="font-mono font-medium text-foreground">{d.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatTime(d.created_at)}</span>
                </Link>
              ))}
              {domains.length > 5 && (
                <Link href="/domains" className="flex items-center gap-1 pt-1 text-xs text-muted-foreground hover:text-foreground">
                  View all {domains.length} domains
                  <ArrowRight className="size-3" />
                </Link>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Quick actions</CardTitle>
          <div className="flex flex-col gap-2">
            <Link href="/data" className="card-lift flex items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2.5 text-sm">
              <TableProperties className="size-4 text-muted-foreground" />
              <span className="text-foreground">Inspect corpus data</span>
            </Link>
            <Link href="/history" className="card-lift flex items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2.5 text-sm">
              <History className="size-4 text-muted-foreground" />
              <span className="text-foreground">Review query history</span>
            </Link>
            <Link href="/query" className="card-lift flex items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2.5 text-sm">
              <Search className="size-4 text-muted-foreground" />
              <span className="text-foreground">Run a cited query</span>
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}

export default function OverviewPage() {
  const { snapshot, saveSnapshot } = useOverviewCache();
  const status = snapshot?.status ?? null;
  const domains = snapshot?.domains ?? [];
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!snapshot);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const latestRequest = useRef(0);

  const loadOverview = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextDomains] = await Promise.all([api.getStatus(), api.getDomains()]);
      if (request !== latestRequest.current) return;
      saveSnapshot({ status: nextStatus, domains: nextDomains.domains ?? [] });
      if (!isOnboardingDone() && (nextDomains.domains ?? []).length === 0) {
        setShowOnboarding(true);
      }
    } catch (cause) {
      if (request !== latestRequest.current) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        saveSnapshot(null);
      }
      setError(cause instanceof ApiError ? `API error ${cause.status}` : String(cause));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [saveSnapshot]);

  useEffect(() => {
    void loadOverview();
    return () => {
      latestRequest.current++;
    };
  }, [loadOverview]);

  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={() => {
          setShowOnboarding(false);
          void loadOverview();
        }}
      />
    );
  }

  return (
    <>
      <PageHeader title="Overview" description="Private retrieval operations for SaaS Maker projects" />
      <div className="flex flex-col gap-6 p-6">
        <OverviewContent status={status} domains={domains} loading={loading} error={error} onRetry={() => void loadOverview()} />
      </div>
    </>
  );
}
