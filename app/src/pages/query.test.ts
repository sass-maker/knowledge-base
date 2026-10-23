import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { QueryDomainState } from './query';

describe('query domain availability', () => {
  it('presents a failed domain lookup as a retryable error instead of an empty corpus', () => {
    const markup = renderToStaticMarkup(createElement(QueryDomainState, { loading: false, error: 'API error 503', hasDomains: false, onRetry: vi.fn() }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Could not load domains. API error 503');
    expect(markup).toContain('Retry domains');
    expect(markup).not.toContain('No domains to query');
    expect(markup).not.toContain('Go to domains');
  });

  it('shows the empty corpus action only after a successful empty response', () => {
    const markup = renderToStaticMarkup(createElement(QueryDomainState, { loading: false, error: null, hasDomains: false, onRetry: vi.fn() }));
    expect(markup).toContain('No domains to query');
    expect(markup).toContain('Go to domains');
    expect(markup).not.toContain('Retry domains');
  });

  it('does not present a pending lookup as an empty corpus', () => {
    const markup = renderToStaticMarkup(createElement(QueryDomainState, { loading: true, error: null, hasDomains: false, onRetry: vi.fn() }));
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('No domains to query');
  });
});
