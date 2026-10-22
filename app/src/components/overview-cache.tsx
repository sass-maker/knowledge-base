import { createContext, useContext, useState } from 'react';
import type { Domain, KbStatus } from '@/lib/api';

interface OverviewSnapshot {
  status: KbStatus;
  domains: Domain[];
}

const OverviewCache = createContext<{
  snapshot: OverviewSnapshot | null;
  saveSnapshot: (snapshot: OverviewSnapshot | null) => void;
} | null>(null);

/** Memory only, below access verification and keyed by the selected project scope. */
export function OverviewCacheProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, saveSnapshot] = useState<OverviewSnapshot | null>(null);
  return <OverviewCache.Provider value={{ snapshot, saveSnapshot }}>{children}</OverviewCache.Provider>;
}

export function useOverviewCache() {
  const cache = useContext(OverviewCache);
  if (!cache) throw new Error('Overview cache requires an authenticated project scope');
  return cache;
}
