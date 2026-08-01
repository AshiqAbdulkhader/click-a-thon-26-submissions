import { EvidencePack, InsightDraft, QueryResult } from "./types.js";

/**
 * Deterministic numbers-first scaffold from real ClickHouse result rows.
 * Used when LLM insight synthesis is weak/unavailable but warehouse evidence exists.
 * Never invents numbers — only formats returned rows.
 */
export function buildNumbersFirstDraft(
  evidencePack: EvidencePack,
): InsightDraft {
  const results = evidencePack.query_results.filter(
    (result) => result.row_count > 0,
  );
  const unknownFeature =
    evidencePack.plan.answer_type === "schema_explanation" &&
    (evidencePack.plan.assumptions.some((item) =>
      /not found in context memory|unknown feature|will not attribute/i.test(
        item,
      ),
    ) ||
      evidencePack.context.retrieval_notes.some((note) =>
        /no generated feature matched|will not attribute other feature/i.test(
          note,
        ),
      ));

  if (unknownFeature) {
    const known = results
      .flatMap((result) => result.rows)
      .map((row) =>
        row.feature_slug
          ? `${row.feature_slug} → ${row.table_name ?? ""}`
          : null,
      )
      .filter((value): value is string => Boolean(value));
    return {
      short_answer:
        "That feature does not appear to be instrumented in the current context memory, so I will not invent performance metrics for it.",
      key_findings: [
        "No matching generated feature table was found for the requested feature.",
        known.length > 0
          ? `Instrumented features available now: ${known.join("; ")}`
          : "No generated features were listed from context.feature_registry.",
      ],
      evidence: results.map((result) => ({
        claim: compactRowClaim(result),
        query_id: result.query_id,
        confidence: "high" as const,
      })),
      recommended_actions: [
        "Run instrumentation (`pnpm cli run <spec-folder>`) for this feature first.",
        "Re-ask after the feature appears in context.feature_registry.",
      ],
      caveats: [
        "Strict mode: refusing to attribute unrelated feature metrics to an unknown feature.",
        ...evidencePack.context.retrieval_notes.filter((note) =>
          note.startsWith("WARNING"),
        ),
      ],
    };
  }

  if (results.length === 0) {
    return {
      short_answer:
        "No non-empty ClickHouse results were available to answer this question.",
      key_findings: [],
      evidence: [],
      recommended_actions: [
        "Confirm the feature is instrumented and context memory is populated.",
        "Retry with a more specific feature or metric name.",
      ],
      caveats: [
        ...evidencePack.evaluation.evidence_gaps,
        ...evidencePack.evaluation.repair_notes,
        ...evidencePack.context.retrieval_notes.filter((note) =>
          note.startsWith("WARNING"),
        ),
      ],
    };
  }

  const findings = results.flatMap((result) => summarizeResult(result));
  const evidence = results.map((result) => ({
    claim: compactRowClaim(result),
    query_id: result.query_id,
    confidence: confidenceFor(result),
  }));

  const headline = pickHeadline(results, evidencePack.question);
  const knownIssues = evidencePack.context.contradictions
    .filter((item) =>
      /known_issue|k1|k2|otp|ios/i.test(`${item.id} ${item.summary}`),
    )
    .slice(0, 3)
    .map((item) => item.summary);

  return {
    short_answer: headline,
    key_findings: findings.slice(0, 12),
    evidence,
    recommended_actions: buildActions(results, knownIssues),
    caveats: [
      "This answer is grounded in executed ClickHouse rows (numbers-first scaffold).",
      ...evidencePack.evaluation.evidence_gaps,
      ...evidencePack.context.retrieval_notes.filter((note) =>
        note.startsWith("WARNING"),
      ),
      ...knownIssues.map((issue) => `Context known-issue note: ${issue}`),
    ].filter(Boolean),
  };
}

function pickHeadline(results: QueryResult[], question: string): string {
  const funnel = results.find(
    (result) =>
      /funnel|drop|conversion|stage/i.test(result.query_id + result.purpose) &&
      result.rows.length > 0,
  );
  if (funnel) {
    const parts = funnel.rows.slice(0, 6).map((row) => formatRowInline(row));
    return `From executed warehouse queries for “${question.slice(0, 120)}”: ${parts.join(" | ")}`;
  }
  const first = results[0];
  return `Warehouse evidence for “${question.slice(0, 120)}” — ${first.query_id} returned ${first.row_count} row(s): ${formatRowInline(first.rows[0] ?? {})}`;
}

function summarizeResult(result: QueryResult): string[] {
  const lines: string[] = [];
  const preview = result.rows.slice(0, 8);
  if (preview.length === 0) {
    return lines;
  }

  // Ordered funnel-like rows
  if (
    preview.every(
      (row) =>
        ("stage" in row || "event_name" in row || "step" in row) &&
        ("users" in row || "entities" in row || "rows" in row),
    )
  ) {
    const ordered = [...preview];
    lines.push(
      `${result.query_id}: ${ordered.map((row) => formatRowInline(row)).join(" → ")}`,
    );
    const counts = ordered
      .map((row) => Number(row.users ?? row.entities ?? row.rows ?? 0))
      .filter((value) => Number.isFinite(value) && value >= 0);
    for (let i = 0; i < counts.length - 1; i += 1) {
      const from = counts[i];
      const to = counts[i + 1];
      if (from > 0 && to <= from) {
        const drop = ((from - to) / from) * 100;
        const fromLabel = String(
          ordered[i].stage ?? ordered[i].event_name ?? ordered[i].step ?? i,
        );
        const toLabel = String(
          ordered[i + 1].stage ??
            ordered[i + 1].event_name ??
            ordered[i + 1].step ??
            i + 1,
        );
        lines.push(
          `Drop ${fromLabel} → ${toLabel}: ${drop.toFixed(1)}% (${from} → ${to})`,
        );
      }
    }
    return lines;
  }

  // Segment success rows
  if (
    preview.some((row) => "success_rate" in row || "conversion_rate" in row)
  ) {
    const sorted = [...preview].sort(
      (a, b) =>
        Number(a.success_rate ?? a.conversion_rate ?? 0) -
        Number(b.success_rate ?? b.conversion_rate ?? 0),
    );
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    lines.push(`${result.query_id} lowest: ${formatRowInline(worst)}`);
    lines.push(`${result.query_id} highest: ${formatRowInline(best)}`);
    return lines;
  }

  for (const row of preview.slice(0, 4)) {
    lines.push(`${result.query_id}: ${formatRowInline(row)}`);
  }
  return lines;
}

function compactRowClaim(result: QueryResult): string {
  if (result.rows.length === 0) {
    return `${result.query_id} returned 0 rows.`;
  }
  const sample = result.rows
    .slice(0, 3)
    .map((row) => formatRowInline(row))
    .join("; ");
  return `${result.query_id} (${result.row_count} rows): ${sample}`;
}

function formatRowInline(row: Record<string, unknown>): string {
  return Object.entries(row)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(", ");
}

function formatValue(value: unknown): string {
  if (value == null) {
    return "null";
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(4).replace(/\.?0+$/, "");
  }
  return String(value);
}

function confidenceFor(result: QueryResult): "high" | "medium" | "low" {
  if (result.row_count >= 1 && /primitive_/.test(result.query_id)) {
    return "high";
  }
  if (result.row_count >= 1) {
    return "medium";
  }
  return "low";
}

function buildActions(results: QueryResult[], knownIssues: string[]): string[] {
  const actions = [
    "Validate the largest drop-off step with a product owner before changing UX.",
    "Re-check the same cuts after the next instrumentation refresh.",
  ];
  if (
    results.some((result) =>
      /device|os|segment/i.test(result.query_id + result.purpose),
    )
  ) {
    actions.unshift(
      "Prioritize the weakest device/OS/geo segment from the evidence table before global changes.",
    );
  }
  if (knownIssues.length > 0) {
    actions.unshift(
      "Cross-check segment findings against documented known issues before calling a product regression.",
    );
  }
  return actions.slice(0, 5);
}

/** Merge LLM draft with numbers-first facts — numbers win when LLM is empty/evasive. */
export function mergeWithNumbersFirst(
  llmDraft: InsightDraft | null,
  evidencePack: EvidencePack,
): InsightDraft {
  const numbers = buildNumbersFirstDraft(evidencePack);
  if (!llmDraft) {
    return {
      ...numbers,
      caveats: [
        ...numbers.caveats,
        "LLM insight synthesizer was unavailable; used deterministic numbers-first summary only.",
      ],
    };
  }

  const llmEvasive =
    /cannot be determined|no data|unavailable|not enough evidence|could not/i.test(
      llmDraft.short_answer,
    ) && evidencePack.query_results.some((result) => result.row_count > 0);

  if (llmEvasive || llmDraft.key_findings.length === 0) {
    return {
      short_answer: numbers.short_answer,
      key_findings: uniqueStrings([
        ...numbers.key_findings,
        ...llmDraft.key_findings,
      ]),
      evidence: uniqueEvidence([...numbers.evidence, ...llmDraft.evidence]),
      recommended_actions: uniqueStrings([
        ...numbers.recommended_actions,
        ...llmDraft.recommended_actions,
      ]),
      caveats: uniqueStrings([
        ...numbers.caveats,
        ...llmDraft.caveats,
        llmEvasive
          ? "LLM prose was evasive despite non-empty query results; numbers-first scaffold took priority."
          : "Filled empty LLM findings from executed query rows.",
      ]),
    };
  }

  // LLM produced content — still ensure every non-empty result has evidence.
  return {
    short_answer: llmDraft.short_answer,
    key_findings: uniqueStrings([
      ...llmDraft.key_findings,
      ...numbers.key_findings.slice(0, 4),
    ]),
    evidence: uniqueEvidence([...llmDraft.evidence, ...numbers.evidence]),
    recommended_actions: uniqueStrings([
      ...llmDraft.recommended_actions,
      ...numbers.recommended_actions,
    ]),
    caveats: uniqueStrings([...llmDraft.caveats, ...numbers.caveats]),
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueEvidence(
  values: InsightDraft["evidence"],
): InsightDraft["evidence"] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.query_id}|${item.claim}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
