import { AppLink as Link } from "@/components/app-link";
import { usePathname } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useOperator } from "@/components/access-guard";
import { useProjectScope } from "@/components/project-context";
import { isInternalProject, projectLabel } from "@/lib/project-scope";
import {
  LayoutDashboard,
  Database,
  Search,
  FileUp,
  FlaskConical,
  History,
  Settings,
  TableProperties,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/data", label: "Data", icon: TableProperties },
  { href: "/history", label: "Query history", icon: History },
  { href: "/domains", label: "Domains", icon: Database },
  { href: "/query", label: "Query", icon: Search },
  { href: "/ingest", label: "Ingest", icon: FileUp },
  { href: "/evals", label: "Evals", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const operator = useOperator();
  const {
    projects,
    selectedProject,
    includeInternal,
    setSelectedProject,
    setIncludeInternal,
  } = useProjectScope();
  return (
    <aside className="flex h-svh w-16 shrink-0 flex-col border-r border-border bg-card sm:w-60">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4 sm:px-5">
        <span
          className="flex size-8 items-center justify-center rounded-lg font-mono text-sm font-bold"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          SM
        </span>
        <div className="hidden flex-col sm:flex">
          <span className="text-sm font-semibold text-foreground">SaaS Maker</span>
          <span className="text-xs text-muted-foreground">Knowledgebase</span>
        </div>
      </div>
      <div className="hidden border-b border-border px-3 py-3 sm:block">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            Project
          </span>
          <select
            aria-label="SaaS Maker project"
            value={selectedProject}
            onChange={(event) => setSelectedProject(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
          >
            {projects.map((project) => (
              <option key={project.name} value={project.name}>
                {projectLabel(project.name)} · {project.file_count}{" "}
                {project.file_count === 1 ? "file" : "files"}
                {isInternalProject(project) ? " · internal" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInternal}
            onChange={(event) => setIncludeInternal(event.target.checked)}
            className="size-3.5 rounded border-input accent-[var(--accent)]"
          />
          Show test and demo scopes
        </label>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={cn(
                "flex min-h-10 items-center justify-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 sm:justify-start",
                active
                  ? "nav-item-active bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground hover:translate-x-0.5",
              )}
            >
              <Icon className={cn("size-4 transition-transform", active && "text-accent")} />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-border px-4 py-3 sm:block">
        <p className="truncate text-xs font-medium text-foreground">{operator.email}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Access verified</p>
      </div>
    </aside>
  );
}
