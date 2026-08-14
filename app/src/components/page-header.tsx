import { useProjectScope } from '@/components/project-context';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  const { selectedProject, selectedProjectLabel } = useProjectScope();
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className="hidden max-w-56 truncate rounded-md bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:inline"
          title={selectedProject}
        >
          {selectedProjectLabel}
        </span>
        {action}
      </div>
    </div>
  );
}
