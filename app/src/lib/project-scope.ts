export interface OperatorProject {
  name: string;
  project: string;
  description: string;
  kind_count: number;
  file_count: number;
  created_at: string;
  updated_at: string;
}

let selectedProject = '';
let includeInternalScopes = false;

const INTERNAL_PROJECT_NAMES = new Set(['default', 'proof-s', 's-grade-dry-run', 'saas-maker', 'verify']);

const INTERNAL_PROJECT_PREFIXES = ['deploy-smoke-', 'e2e-', 'proof-', 's-grade-', 'smoke-'];

const INTERNAL_DOMAIN_NAMES = new Set(['legal', 'notes', 'personal_notes', 'sec', 'stack-notes']);

const INTERNAL_DOMAIN_PREFIXES = ['codex-rag-smoke-', 'deploy-smoke-', 'e2e-', 'perf-', 's-grade-', 'smoke-'];

const PROJECT_LABELS: Record<string, string> = {
  'tenant-a': 'Research Papers',
  starboard: 'Starboard',
};

export function setApiProjectScope(project: string, includeInternal: boolean) {
  selectedProject = project;
  includeInternalScopes = includeInternal;
}

export function getApiProject(): string {
  return selectedProject;
}

export function isInternalScopeVisible(): boolean {
  return includeInternalScopes;
}

export function isInternalProject(project: OperatorProject): boolean {
  if (isInternalProjectName(project.name)) return true;
  return project.file_count === 0 && project.kind_count === 0;
}

function isInternalProjectName(project: string): boolean {
  return INTERNAL_PROJECT_NAMES.has(project) || INTERNAL_PROJECT_PREFIXES.some((prefix) => project.startsWith(prefix));
}

export function isInternalDomain(domain: string): boolean {
  if (includeInternalScopes) return false;
  if (INTERNAL_DOMAIN_NAMES.has(domain) && (selectedProject === 'default' || isInternalProjectName(selectedProject))) {
    return true;
  }
  return INTERNAL_DOMAIN_PREFIXES.some((prefix) => domain.startsWith(prefix));
}

export function projectLabel(project: string): string {
  const known = PROJECT_LABELS[project];
  if (known) return known;
  return project
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function sortProjects(projects: OperatorProject[]): OperatorProject[] {
  return [...projects].sort((left, right) => right.file_count - left.file_count || right.kind_count - left.kind_count || left.name.localeCompare(right.name));
}
