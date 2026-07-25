import { useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardTitle } from "@/components/card";
import { Button } from "@/components/button";
import {
  AlertCircle,
  Check,
  Loader2,
  LogOut,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { navigate } from "@/lib/router";
import { resetOnboarding } from "@/components/onboarding";
import { useOperator } from "@/components/access-guard";

export default function SettingsPage() {
  const operator = useOperator();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await api.getStatus();
      setTestResult({ ok: true, message: "Access and Worker proxy are healthy" });
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Internal identity and dashboard connection"
      />
      <div className="flex max-w-2xl flex-col gap-6 p-6">
        <Card>
          <CardTitle>Operator access</CardTitle>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-lg bg-muted px-3 py-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {operator.email}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  Verified by Cloudflare Access · {operator.subject}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleTest} disabled={testing}>
                {testing ? (
                  <>
                    <Loader2 className="size-4 spin" /> Testing…
                  </>
                ) : (
                  "Test internal connection"
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  window.location.href = "/cdn-cgi/access/logout";
                }}
                className="text-destructive hover:text-destructive"
              >
                <LogOut className="size-4" /> Sign out
              </Button>
            </div>

            {testResult && (
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  testResult.ok
                    ? "bg-accent/10 text-accent"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <Check className="size-4" />
                ) : (
                  <AlertCircle className="size-4" />
                )}
                {testResult.message}
                {testResult.ok && (
                  <button
                    onClick={() => navigate("/")}
                    className="ml-auto text-xs font-medium underline-offset-4 hover:underline"
                  >
                    Go to dashboard →
                  </button>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Security boundary</CardTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Dashboard requests use a same-origin Pages Function. Your verified
            Access identity is checked before the Function adds the Worker
            service key server-side; no Worker credential is stored in this browser.
          </p>
        </Card>

        <Card>
          <CardTitle>Onboarding</CardTitle>
          <p className="mb-3 text-sm text-muted-foreground">
            Replay the first-run workflow for creating a domain, ingesting data,
            and running a cited query.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              resetOnboarding();
              navigate("/");
            }}
          >
            <RotateCcw className="size-4" /> Reset onboarding
          </Button>
        </Card>
      </div>
    </>
  );
}
