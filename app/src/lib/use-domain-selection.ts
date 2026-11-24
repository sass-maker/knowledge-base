import { useEffect, useState } from 'react';
import { api, type Domain, isAccessDenied } from '@/lib/api';

export function useDomainSelection({ selectFirst = true }: { selectFirst?: boolean } = {}) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDomains()
      .then(({ domains: rows }) => {
        if (cancelled) return;
        setDomains(rows);
        setDomain((selected) => (rows.some((row) => row.name === selected) ? selected : ((selectFirst ? rows[0]?.name : '') ?? '')));
      })
      .catch((cause) => {
        if (cancelled) return;
        if (isAccessDenied(cause)) {
          setDomains([]);
          setDomain('');
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, selectFirst]);

  return { domain, domains, setDomain, loading, error, retry: () => setAttempt((value) => value + 1) };
}
