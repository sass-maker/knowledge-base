import { AccessGuard } from "@/components/access-guard";
import { ProjectProvider, useProjectScope } from "@/components/project-context";
import { Sidebar } from "@/components/sidebar";
import { isAppPath, usePathname } from "@/lib/router";
import DataPage from "@/pages/data";
import DomainsPage from "@/pages/domains";
import EvalsPage from "@/pages/evals";
import IngestPage from "@/pages/ingest";
import OverviewPage from "@/pages/overview";
import QueryPage from "@/pages/query";
import SettingsPage from "@/pages/settings";
import TracesPage from "@/pages/traces";

const PAGES = {
  "/": OverviewPage,
  "/data": DataPage,
  "/domains": DomainsPage,
  "/query": QueryPage,
  "/ingest": IngestPage,
  "/evals": EvalsPage,
  "/history": TracesPage,
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

function DashboardShell() {
  const pathname = usePathname();
  const { selectedProject, includeInternal } = useProjectScope();
  const Page = isAppPath(pathname) ? PAGES[pathname] : NotFoundPage;

  return (
    <div className="flex min-h-svh w-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="page-fade flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Page key={`${selectedProject}:${includeInternal}:${pathname}`} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AccessGuard>
      <ProjectProvider>
        <DashboardShell />
      </ProjectProvider>
    </AccessGuard>
  );
}
