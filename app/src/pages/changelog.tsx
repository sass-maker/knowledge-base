import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { ExternalLink } from "lucide-react";

const SOURCE_URL = "https://github.com/sass-maker/knowledge-base";
const ROADMAP_URL = `${SOURCE_URL}/issues`;

const entries = [
  {
    date: "2026-07-25",
    label: "July 25, 2026",
    title: "Private dashboard cut over to Cloudflare Pages",
    body: "The operator dashboard moved to search.sassmaker.com behind Cloudflare Access. Same-origin proxying, direct deep links, and verified project switching now work without exposing Worker credentials to the browser.",
    tags: ["Dashboard", "Access"],
  },
  {
    date: "2026-07-25",
    label: "July 25, 2026",
    title: "Project-scoped search became the default operator view",
    body: "The dashboard now discovers Fleet project scopes, opens Research Papers by default, switches independently to Starboard, and hides demo and proof corpora unless an operator explicitly enables them.",
    tags: ["Projects", "Privacy"],
  },
  {
    date: "2026-06-28",
    label: "June 28, 2026",
    title: "Embedding-model catalog release completed",
    body: "Every advertised embedding dimension gained a matching Vectorize binding and model metadata. Release checks covered catalog parity, CRUD smoke tests, hosted UI readiness, and live OCR on the same Cloudflare-native runtime.",
    tags: ["Retrieval", "Release"],
  },
  {
    date: "2026-06-23",
    label: "June 23, 2026",
    title: "A+ cited-search evidence shipped",
    body: "The deployed proof covered readiness, scoped evaluation, lexical and semantic search, ingestion, observability, and the hosted operator UI. Citation and hit rates reached 1.0 in the recorded benchmark.",
    tags: ["Evidence", "Evaluation"],
  },
] as const;

export default function ChangelogPage() {
  return (
    <>
      <PageHeader
        title="Changelog"
        description="Verified changes to Private Agent Search and its operator surface"
        action={
          <div className="hidden items-center gap-2 md:flex">
            <a
              href={ROADMAP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              Roadmap <ExternalLink className="size-3" />
            </a>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              Source <ExternalLink className="size-3" />
            </a>
          </div>
        }
      />

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <div className="max-w-2xl">
          <p className="text-sm leading-6 text-muted-foreground">
            This is the maintained product history. Open and planned work stays in GitHub Issues,
            while each entry here reflects verified repository or deployment evidence.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 md:hidden">
            <a
              href={ROADMAP_URL}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium"
            >
              Roadmap <ExternalLink className="size-3.5" />
            </a>
            <a
              href={SOURCE_URL}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium"
            >
              Source <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>

        <section className="flex flex-col" aria-label="Knowledgebase releases">
          {entries.map((entry) => (
            <article
              key={`${entry.date}-${entry.title}`}
              className="grid gap-3 border-t border-border py-6 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6"
            >
              <time
                dateTime={entry.date}
                className="font-mono text-xs font-medium text-muted-foreground"
              >
                {entry.label}
              </time>
              <Card className="p-5">
                <h2 className="text-base font-semibold text-foreground">{entry.title}</h2>
                <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">
                  {entry.body}
                </p>
                <ul className="mt-4 flex flex-wrap gap-2" aria-label="Update categories">
                  {entry.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-foreground"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              </Card>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}

