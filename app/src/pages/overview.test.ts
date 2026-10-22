import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Domain, KbStatus } from '@/lib/api';
import { OverviewContent } from './overview';

const emptyStatus: KbStatus = {
  domains: 0,
  files: 0,
  jobs: 0,
  schemas: 0,
  schema_drafts: 0,
  entities: 0,
  relationships: 0,
  traces: 0,
  eval_reports: 0,
  recent_traces: 0,
  recent_eval_reports: 0,
};

describe('overview load states', () => {
  it.each([
    { loading: true, error: null },
    { loading: false, error: 'API error 503' },
  ])('retains a known corpus while refreshing or recovering: %j', ({ loading, error }) => {
    const markup = renderToStaticMarkup(
      createElement(OverviewContent, {
        status: { ...emptyStatus, domains: 1, files: 7 },
        domains: [{ name: 'saved-corpus', description: 'Saved corpus', created_at: '2026-10-22T10:00:00Z' }] as Domain[],
        loading,
        error,
        onRetry: vi.fn(),
      }),
    );
    expect(markup).toContain('saved-corpus');
    expect(markup).not.toContain('Loading overview');
    expect(markup).not.toContain('No domains yet');
    if (error) expect(markup).toContain('Retry overview');
  });

  it('renders a retryable error without presenting failed data as empty', () => {
    const markup = renderToStaticMarkup(
      createElement(OverviewContent, {
        status: null,
        domains: [],
        loading: false,
        error: 'API error 503',
        onRetry: vi.fn(),
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Could not load overview data. API error 503');
    expect(markup).toContain('Retry overview');
    expect(markup).not.toContain('No domains yet');
    expect(markup).not.toContain('Active Schemas');
  });

  it('shows the empty state after a successful empty response', () => {
    const markup = renderToStaticMarkup(
      createElement(OverviewContent, {
        status: emptyStatus,
        domains: [] as Domain[],
        loading: false,
        error: null,
        onRetry: vi.fn(),
      }),
    );

    expect(markup).toContain('No domains yet.');
    expect(markup).toContain('Active Schemas');
    expect(markup).not.toContain('Could not load overview data');
    expect(markup).not.toContain('Retry overview');
  });
});
