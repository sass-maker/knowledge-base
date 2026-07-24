import { ConfigGuard } from "@/components/config-guard";
import { Sidebar } from "@/components/sidebar";
import { isAppPath, usePathname } from "@/lib/router";
import DomainsPage from "@/pages/domains";
import EvalsPage from "@/pages/evals";
import IngestPage from "@/pages/ingest";
import OverviewPage from "@/pages/overview";
import QueryPage from "@/pages/query";
import SettingsPage from "@/pages/settings";
import TracesPage from "@/pages/traces";

const PAGES = {
  "/": OverviewPage,
  "/domains": DomainsPage,
  "/query": QueryPage,
  "/ingest": IngestPage,
  "/evals": EvalsPage,
  "/traces": TracesPage,
  "/settings": SettingsPage,
} as const;

function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold text-foreground">Dashboard page not found</h1>
      <a className="text-sm text-accent hover:underline" href="/">
        Return to overview
      </a>
    </div>
  );
}

export default function App() {
  const pathname = usePathname();
  const Page = isAppPath(pathname) ? PAGES[pathname] : NotFoundPage;

  return (
    <div className="flex min-h-svh w-full">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="page-fade flex flex-1 flex-col overflow-y-auto">
          <ConfigGuard>
            <Page />
          </ConfigGuard>
        </div>
      </div>
    </div>
  );
}
