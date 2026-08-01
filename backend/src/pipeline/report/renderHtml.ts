import type { AskCard, FeatureCard, PipelineReport } from "./types.js";

export function renderReportHtml(report: PipelineReport): string {
  if (report.mode === "ask") {
    return renderShell(report, renderAskPage(report));
  }
  if (report.mode === "run") {
    return renderShell(report, renderRunPage(report));
  }
  return renderShell(report, renderOverviewPage(report));
}

function renderShell(report: PipelineReport, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Schema Kings · ${escapeHtml(report.title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            display: ['"Fraunces"', "Georgia", "serif"],
            sans: ['"DM Sans"', "system-ui", "sans-serif"],
            mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
          },
          colors: {
            ink: "#121612",
            soft: "#5c675f",
            moss: "#24574a",
            clay: "#b84f1f",
            wash: "#f4f7f4",
            line: "#cfd8d1",
          },
        },
      },
    };
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Fraunces:opsz,wght@9..144,500;9..144,650&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    html { scroll-behavior: smooth; }
    body {
      background:
        radial-gradient(900px 480px at 0% 0%, #d9e8df 0%, transparent 60%),
        radial-gradient(700px 400px at 100% 10%, #efe4d6 0%, transparent 55%),
        #f4f7f4;
      color: #121612;
    }
    .section-panel {
      background: rgba(255,255,255,0.78);
      backdrop-filter: blur(8px);
      border-top: 1px solid #cfd8d1;
      border-bottom: 1px solid #cfd8d1;
    }
    details > summary { list-style: none; cursor: pointer; }
    details > summary::-webkit-details-marker { display: none; }
    details[open] .chev::before { content: "▾ "; }
    .chev::before { content: "▸ "; color: #24574a; }
    .conf-high { color: #24574a; font-weight: 600; }
    .conf-medium { color: #b84f1f; font-weight: 600; }
    .conf-low { color: #7a6548; font-weight: 600; }
  </style>
</head>
<body class="font-sans antialiased">
  <div class="mx-auto max-w-3xl px-5 pb-24 pt-10 md:px-8">
    ${body}
    <footer class="mt-10 px-1 text-xs text-soft">
      Generated ${escapeHtml(report.generated_at)}
      · mode <span class="font-mono">${escapeHtml(report.mode)}</span>
      ${report.job_id ? ` · <span class="font-mono">${escapeHtml(report.job_id)}</span>` : ""}
      · <span class="font-mono">pnpm cli report</span>
    </footer>
  </div>
</body>
</html>`;
}

function renderOverviewPage(report: PipelineReport): string {
  return `
    <header class="mb-8">
      <p class="font-display text-4xl font-semibold tracking-tight text-moss md:text-5xl">Schema Kings</p>
      <p class="mt-4 max-w-xl text-base leading-relaxed text-soft">
        Overview of the whole pipeline. Pass a job id to open one run/ask only.
      </p>
      <p class="mt-2 font-mono text-xs text-soft">pnpm cli report 20260801T210941</p>
      <div class="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-ink">
        <span><strong class="font-display text-2xl text-moss">${report.stats.features_instrumented}</strong> <span class="text-soft">features</span></span>
        <span><strong class="font-display text-2xl">${report.stats.instrumentation_runs}</strong> <span class="text-soft">spec runs</span></span>
        <span><strong class="font-display text-2xl">${report.stats.ask_jobs}</strong> <span class="text-soft">asks total</span></span>
      </div>
    </header>

    <nav class="sticky top-0 z-20 mb-10 -mx-5 flex gap-1 overflow-x-auto border-y border-line bg-wash/95 px-5 py-3 text-sm backdrop-blur md:-mx-8 md:px-8">
      <a href="#features" class="shrink-0 px-3 py-1.5 text-ink/80">1. Features</a>
      <a href="#context" class="shrink-0 px-3 py-1.5 text-ink/80">2. Context</a>
      <a href="#insights" class="shrink-0 px-3 py-1.5 text-ink/80">3. Insights</a>
    </nav>

    <section id="features" class="section-panel mb-10 scroll-mt-20 px-5 py-10 md:px-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Section 1</p>
      <h2 class="mt-2 font-display text-3xl tracking-tight">Instrumented features</h2>
      <div class="mt-8 divide-y divide-line">
        ${report.features.map((f) => renderFeature(f, false)).join("")}
      </div>
    </section>

    <section id="context" class="section-panel mb-10 scroll-mt-20 px-5 py-10 md:px-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Section 2</p>
      <h2 class="mt-2 font-display text-3xl tracking-tight">Context memory</h2>
      <ul class="mt-8 space-y-4">
        ${report.features
          .map(
            (
              f,
            ) => `<li class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
            <span class="font-mono text-sm font-medium text-moss">${escapeHtml(f.feature_slug)}</span>
            <span class="text-sm text-ink/80">${escapeHtml(f.table_name)}</span>
          </li>`,
          )
          .join("")}
      </ul>
      ${
        report.contradictions.length
          ? `<ul class="mt-8 space-y-3">
          ${report.contradictions
            .map(
              (c) => `<li class="text-sm">
              <span class="font-mono text-xs text-clay">${escapeHtml(c.id)}</span>
              <span class="text-ink/80"> — ${escapeHtml(c.summary)}</span>
            </li>`,
            )
            .join("")}
        </ul>`
          : ""
      }
    </section>

    <section id="insights" class="section-panel mb-6 scroll-mt-20 px-5 py-10 md:px-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Section 3</p>
      <h2 class="mt-2 font-display text-3xl tracking-tight">Recent PM insights</h2>
      <div class="mt-8 divide-y divide-line">
        ${report.recent_asks.map((ask) => renderAsk(ask)).join("")}
      </div>
    </section>
  `;
}

function renderAskPage(report: PipelineReport): string {
  const ask = (report.focus as AskCard | null) ?? report.recent_asks[0];
  const related = report.features[0] ?? null;
  if (!ask) {
    return `<p class="text-soft">No ask payload for this job.</p>`;
  }

  return `
    <header class="mb-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-clay">Single ask job</p>
      <p class="mt-3 font-display text-4xl font-semibold tracking-tight text-moss">Schema Kings</p>
      <p class="mt-4 font-mono text-xs text-soft break-all">${escapeHtml(report.job_id ?? "")}</p>
      <p class="mt-4 text-sm text-soft">Overview of everything: <span class="font-mono">pnpm cli report</span></p>
    </header>

    <section class="section-panel px-5 py-10 md:px-8">
      ${renderAsk(ask, true)}
    </section>

    ${
      related
        ? `<section class="section-panel mt-8 px-5 py-8 md:px-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Related feature</p>
      ${renderFeature(related, false)}
    </section>`
        : ""
    }
  `;
}

function renderRunPage(report: PipelineReport): string {
  const feature = (report.focus as FeatureCard | null) ?? report.features[0];
  if (!feature) {
    return `<p class="text-soft">No instrumentation payload for this job.</p>`;
  }

  return `
    <header class="mb-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-clay">Single instrumentation job</p>
      <p class="mt-3 font-display text-4xl font-semibold tracking-tight text-moss">Schema Kings</p>
      <h1 class="mt-4 font-display text-2xl tracking-tight">${escapeHtml(feature.feature_slug)}</h1>
      <p class="mt-2 font-mono text-xs text-soft break-all">${escapeHtml(report.job_id ?? "")}</p>
      <p class="mt-4 text-sm text-soft">Overview of everything: <span class="font-mono">pnpm cli report</span></p>
    </header>

    <section class="section-panel px-5 py-10 md:px-8">
      ${renderFeature(feature, true)}
    </section>

    <section class="section-panel mt-8 px-5 py-8 md:px-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Context written by this run</p>
      <div class="mt-4 space-y-1 font-mono text-[11px] leading-relaxed text-soft">
        ${renderMarkdownLite(report.context_changelog)}
      </div>
      ${
        report.contradictions.length
          ? `<ul class="mt-6 space-y-2">
          ${report.contradictions
            .map(
              (c) =>
                `<li class="text-sm"><span class="font-mono text-xs text-clay">${escapeHtml(c.id)}</span> — ${escapeHtml(c.summary)}</li>`,
            )
            .join("")}
        </ul>`
          : ""
      }
    </section>
  `;
}

function renderFeature(feature: FeatureCard, openDetails: boolean): string {
  return `<article class="py-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-display text-xl tracking-tight text-ink">${escapeHtml(feature.feature_slug)}</h3>
        <p class="mt-1 font-mono text-xs text-soft">${escapeHtml(feature.table_name)}${
          feature.row_count != null
            ? ` · ${feature.row_count.toLocaleString()} rows`
            : ""
        }</p>
      </div>
      ${traceBtn(feature.langfuse_trace_url)}
    </div>
    <p class="mt-3 text-sm leading-relaxed text-ink/85">
      ${
        feature.event_names.length
          ? feature.event_names
              .map(
                (e) =>
                  `<code class="rounded bg-wash px-1.5 py-0.5 font-mono text-[12px]">${escapeHtml(e)}</code>`,
              )
              .join(' <span class="text-soft">→</span> ')
          : "—"
      }
    </p>
    <p class="mt-3 text-xs text-soft">
      ${escapeHtml(feature.engine)}
      ${feature.order_by.length ? ` · ORDER BY (${escapeHtml(feature.order_by.join(", "))})` : ""}
      ${feature.partition_by ? ` · ${escapeHtml(feature.partition_by)}` : ""}
    </p>
    <details class="mt-4" ${openDetails ? "open" : ""}>
      <summary class="text-sm text-moss"><span class="chev"></span>Schema SQL</summary>
      <pre class="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-sm bg-wash p-3 font-mono text-[11px] leading-relaxed text-ink/75">${escapeHtml(feature.schema_preview)}</pre>
    </details>
  </article>`;
}

function renderAsk(ask: AskCard, emphasize = false): string {
  return `<article class="py-8">
    <p class="text-xs font-semibold uppercase tracking-[0.12em] text-soft">Question</p>
    <p class="mt-2 text-[15px] font-medium leading-snug text-ink">${escapeHtml(ask.question)}</p>

    <p class="mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-moss">Answer</p>
    <p class="mt-3 font-display ${emphasize ? "text-[1.55rem] md:text-[1.75rem]" : "text-[1.35rem] md:text-[1.55rem]"} leading-snug tracking-tight text-ink">
      ${escapeHtml(ask.short_answer)}
    </p>

    ${
      ask.key_findings.length
        ? `<p class="mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-soft">Key findings</p>
      <ul class="mt-4 space-y-2.5">
        ${ask.key_findings
          .map(
            (f) =>
              `<li class="border-l-2 border-moss/50 pl-3 text-sm leading-relaxed text-ink/85">${escapeHtml(f)}</li>`,
          )
          .join("")}
      </ul>`
        : ""
    }

    ${
      ask.recommended_actions.length
        ? `<p class="mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-soft">Recommended actions</p>
      <ul class="mt-4 space-y-2">
        ${ask.recommended_actions
          .map((a) => `<li class="text-sm text-ink/85">— ${escapeHtml(a)}</li>`)
          .join("")}
      </ul>`
        : ""
    }

    <div class="mt-6 flex flex-wrap items-center gap-4">
      ${traceBtn(ask.langfuse_trace_url)}
      <span class="font-mono text-[11px] text-soft">${escapeHtml(ask.feature_slug)}</span>
    </div>

    ${
      ask.evidence.length
        ? `<details class="mt-5" ${emphasize ? "open" : ""}>
      <summary class="text-sm text-moss"><span class="chev"></span>Evidence + confidence</summary>
      <ul class="mt-3 space-y-2">
        ${ask.evidence
          .map((e) => {
            const conf = String(e.confidence).toLowerCase();
            const cls =
              conf === "high"
                ? "conf-high"
                : conf === "low"
                  ? "conf-low"
                  : "conf-medium";
            return `<li class="flex flex-col gap-0.5 text-sm sm:flex-row sm:justify-between sm:gap-6">
            <span class="text-ink/80">${escapeHtml(e.claim)}</span>
            <span class="${cls} shrink-0 font-mono text-xs">${escapeHtml(String(e.confidence))}</span>
          </li>`;
          })
          .join("")}
      </ul>
    </details>`
        : ""
    }

    ${
      ask.caveats.length
        ? `<details class="mt-4">
      <summary class="text-sm text-moss"><span class="chev"></span>Caveats</summary>
      <ul class="mt-3 space-y-2">
        ${ask.caveats
          .map((c) => `<li class="text-sm text-soft">${escapeHtml(c)}</li>`)
          .join("")}
      </ul>
    </details>`
        : ""
    }
  </article>`;
}

function traceBtn(url: string): string {
  if (!url) return `<span class="text-xs text-soft">no Langfuse id</span>`;
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer"
    class="inline-flex items-center text-sm font-medium text-moss underline decoration-moss/40 underline-offset-4 hover:decoration-moss">
    Open in Langfuse ↗
  </a>`;
}

function renderMarkdownLite(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trimEnd();
      if (!t) return "";
      if (t.startsWith("# ") || t.startsWith("## ")) {
        return `<p class="pt-2 font-sans text-xs font-semibold uppercase tracking-wide text-ink/60">${escapeHtml(t.replace(/^#+\s*/, ""))}</p>`;
      }
      if (t.startsWith("- ") || t.startsWith("* ")) {
        return `<p>+ ${escapeHtml(t.slice(2))}</p>`;
      }
      return `<p>${escapeHtml(t)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
