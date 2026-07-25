import { createContext, useContext, useEffect, useState } from "react";
import { api, ApiError, type OperatorSession } from "@/lib/api";
import { Button } from "@/components/button";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

const OperatorContext = createContext<OperatorSession["operator"] | null>(null);

export function useOperator() {
  const operator = useContext(OperatorContext);
  if (!operator) {
    throw new Error("useOperator must be used inside AccessGuard");
  }
  return operator;
}

export function AccessGuard({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  async function loadSession() {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      setSession(await api.getSession());
    } catch (cause) {
      setSession(null);
      setStatus(cause instanceof ApiError ? cause.status : null);
      if (cause instanceof ApiError && cause.body && typeof cause.body === "object") {
        const message = (cause.body as { error?: unknown }).error;
        setError(typeof message === "string" ? message : cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to verify operator access");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 spin" />
          Verifying internal access…
        </div>
      </div>
    );
  }

  if (!session) {
    const configurationError = status === 503;
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="flex w-full max-w-md flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <span
              className="flex size-12 items-center justify-center rounded-xl"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              <ShieldCheck className="size-6" />
            </span>
            <h1 className="text-xl font-semibold text-foreground">
              {configurationError ? "Internal access needs setup" : "Internal access required"}
            </h1>
            <p className="text-pretty text-sm text-muted-foreground">
              {configurationError
                ? "Configure the Cloudflare Access audience and team domain for this Pages project."
                : "Sign in through Cloudflare Access to inspect private corpus data and query history."}
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Access check failed</p>
              <p className="mt-1 text-muted-foreground">{error}</p>
            </div>
          </div>

          <Button onClick={() => void loadSession()}>
            <RefreshCw className="size-4" />
            Retry access
          </Button>
        </div>
      </div>
    );
  }

  return (
    <OperatorContext.Provider value={session.operator}>
      {children}
    </OperatorContext.Provider>
  );
}
