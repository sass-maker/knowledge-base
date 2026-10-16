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
