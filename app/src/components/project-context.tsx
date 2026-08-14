import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Database, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { isInternalProject, projectLabel, setApiProjectScope, sortProjects, type OperatorProject } from '@/lib/project-scope';

const PROJECT_STORAGE_KEY = 'knowledgebase:selected-project';

interface ProjectContextValue {
  projects: OperatorProject[];
  selectedProject: string;
  selectedProjectLabel: string;
  includeInternal: boolean;
  setSelectedProject: (project: string) => void;
  setIncludeInternal: (include: boolean) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectScope() {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error('useProjectScope must be used inside ProjectProvider');
  }
  return value;
}

function storedProject(): string {
  try {
    return window.sessionStorage.getItem(PROJECT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberProject(project: string) {
  try {
    window.sessionStorage.setItem(PROJECT_STORAGE_KEY, project);
  } catch {
    // Project selection is a convenience, not a required storage dependency.
  }
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<OperatorProject[]>([]);
  const [selectedProject, setSelectedProjectState] = useState('');
  const [includeInternal, setIncludeInternalState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getOperatorProjects()
      .then((result) => {
        if (cancelled) return;
        const sorted = sortProjects(result);
        const visible = sorted.filter((project) => !isInternalProject(project));
        const preferred = storedProject();
        const initial =
          visible.find((project) => project.name === preferred) ?? visible[0] ?? sorted.find((project) => project.name === preferred) ?? sorted[0];
        setProjects(sorted);
        if (initial) {
          const showInternal = isInternalProject(initial);
          setIncludeInternalState(showInternal);
          setApiProjectScope(initial.name, showInternal);
          setSelectedProjectState(initial.name);
          rememberProject(initial.name);
        }
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
  }, []);

  const visibleProjects = useMemo(() => projects.filter((project) => includeInternal || !isInternalProject(project)), [includeInternal, projects]);

  function selectProject(project: string) {
    if (!projects.some((candidate) => candidate.name === project)) return;
    setApiProjectScope(project, includeInternal);
    setSelectedProjectState(project);
    rememberProject(project);
  }

  function setIncludeInternal(include: boolean) {
    setIncludeInternalState(include);
    const selected = projects.find((project) => project.name === selectedProject);
    const fallback = projects.find((project) => !isInternalProject(project)) ?? projects[0];
    const nextProject = !include && selected && isInternalProject(selected) ? (fallback?.name ?? '') : selectedProject;
    setApiProjectScope(nextProject, include);
    if (nextProject !== selectedProject) {
      setSelectedProjectState(nextProject);
      rememberProject(nextProject);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 spin" />
          Loading SaaS Maker projects…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="flex max-w-md items-start gap-3 rounded-xl border border-destructive/30 bg-card p-4 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Project inventory unavailable</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <Database className="size-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">No project data yet</h1>
          <p className="text-sm text-muted-foreground">A SaaS Maker project will appear here after it creates its first Knowledgebase project or corpus.</p>
        </div>
      </div>
    );
  }

  return (
    <ProjectContext.Provider
      value={{
        projects: visibleProjects,
        selectedProject,
        selectedProjectLabel: projectLabel(selectedProject),
        includeInternal,
        setSelectedProject: selectProject,
        setIncludeInternal,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
