import { Button } from '@/components/button';

export function ReadError({ message, retryLabel, onRetry }: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
      <p className="text-sm text-destructive" role="alert">{message}</p>
      <Button type="button" size="sm" variant="secondary" onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}
