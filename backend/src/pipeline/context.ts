import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { executeClickHouse, queryClickHouseText, sqlString } from "./clickhouse.js";

export type ContextBundle = {
  baseContext: string;
  existingDdl: string;
  instrumentationNotes: string;
  generatedContext: GeneratedContextRegistry;
};

export type GeneratedContextRegistry = {
  version: number;
  updated_at: string | null;
  features: Array<{
    feature_slug: string;
    table_name: string;
    primary_entity: string;
    event_names: string[];
    success_event: string | null;
    metric_hints: string[];
    added_at: string;
  }>;
  contradictions: Array<{
    id: string;
    summary: string;
    evidence: string;
  }>;
};

const emptyRegistry: GeneratedContextRegistry = {
  version: 1,
  updated_at: null,
  features: [],
  contradictions: [
    {
      id: "base_context_eta_name_mismatch",
      summary:
        "Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.",
      evidence:
        "base_context.md defines visa_issuance_eta_days; data/ddl.sql defines application_started.eta_shown Nullable(String).",
    },
    {
      id: "conversion_denominator_ambiguity",
      summary:
        "Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.",
      evidence:
        "Metric definitions contain both formulas; analytics must choose based on question type.",
    },
  ],
};

export async function loadContextBundle(
  repoRoot: string,
): Promise<ContextBundle> {
  await ensureContextTables();
  const [baseContext, existingDdl, instrumentationNotes] =
    await Promise.all([
      readFile(path.join(repoRoot, "base_context.md"), "utf8"),
      readFile(path.join(repoRoot, "data", "ddl.sql"), "utf8"),
      readFile(path.join(repoRoot, "data", "instrumentation_notes.md"), "utf8"),
    ]);

  await ingestBaseContextDocuments({
    repoRoot,
    jobId: "bootstrap",
    baseContext,
    existingDdl,
    instrumentationNotes,
  });

  return {
    baseContext,
    existingDdl,
    instrumentationNotes,
    generatedContext: await readGeneratedContext(),
  };
}

export async function updateGeneratedContext(input: {
  job_id: string;
  feature_slug: string;
  table_name: string;
  primary_entity: string;
  workflow_type: string;
  event_names: string[];
  success_event: string | null;
  metric_hints: string[];
  validation: Record<string, unknown>;
}) {
  await ensureContextTables();
  await executeClickHouse(`INSERT INTO context.feature_registry FORMAT JSONEachRow
${JSON.stringify({
  feature_slug: input.feature_slug,
  job_id: input.job_id,
  table_name: input.table_name,
  primary_entity: input.primary_entity,
  workflow_type: input.workflow_type,
  event_names_json: JSON.stringify(input.event_names),
  success_event: input.success_event ?? "",
  metric_hints_json: JSON.stringify(input.metric_hints),
  validation_json: JSON.stringify(input.validation),
})}
`);

  await executeClickHouse(`INSERT INTO context.fact_registry FORMAT JSONEachRow
${[
  {
    fact_id: `${input.job_id}:feature:${input.feature_slug}`,
    fact_type: "feature",
    subject: input.feature_slug,
    predicate: "uses_table",
    object: input.table_name,
    confidence: 1,
    evidence_json: JSON.stringify([
      "feature_manifest.json",
      "schema_plan.json",
      "load_report.json validation passed",
    ]),
    source_job_id: input.job_id,
  },
  {
    fact_id: `${input.job_id}:entity:${input.feature_slug}`,
    fact_type: "entity",
    subject: input.feature_slug,
    predicate: "primary_entity",
    object: input.primary_entity,
    confidence: 1,
    evidence_json: JSON.stringify([
      "feature_manifest.json",
      "event_profile.json",
      "load_report.json validation passed",
    ]),
    source_job_id: input.job_id,
  },
]
  .map((row) => JSON.stringify(row))
  .join("\n")}
`);

  return readGeneratedContext();
}

export async function bootstrapContext(repoRoot: string) {
  await ensureContextTables();
  const [baseContext, existingDdl, instrumentationNotes] = await Promise.all([
    readFile(path.join(repoRoot, "base_context.md"), "utf8"),
    readFile(path.join(repoRoot, "data", "ddl.sql"), "utf8"),
    readFile(path.join(repoRoot, "data", "instrumentation_notes.md"), "utf8"),
  ]);

  await ingestBaseContextDocuments({
    repoRoot,
    jobId: `bootstrap_${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")}`,
    baseContext,
    existingDdl,
    instrumentationNotes,
  });

  return readGeneratedContext();
}

export async function ensureContextTables() {
  await executeClickHouse("CREATE DATABASE IF NOT EXISTS context");

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.context_documents
(
    doc_id String,
    doc_type LowCardinality(String),
    source_path String,
    content String,
    content_hash String,
    job_id String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (doc_id)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.feature_registry
(
    feature_slug String,
    job_id String,
    table_name String,
    primary_entity String,
    workflow_type LowCardinality(String),
    event_names_json String,
    success_event String,
    metric_hints_json String,
    validation_json String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (feature_slug)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.fact_registry
(
    fact_id String,
    fact_type LowCardinality(String),
    subject String,
    predicate String,
    object String,
    confidence Float32,
    evidence_json String,
    source_job_id String,
    created_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (fact_id)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.contradictions
(
    id String,
    summary String,
    evidence String,
    status LowCardinality(String),
    detected_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(detected_at)
ORDER BY (id)
`);
}

async function ingestBaseContextDocuments(input: {
  repoRoot: string;
  jobId: string;
  baseContext: string;
  existingDdl: string;
  instrumentationNotes: string;
}) {
  const rows = [
    {
      doc_id: "base_context",
      doc_type: "business_context",
      source_path: path.join(input.repoRoot, "base_context.md"),
      content: input.baseContext,
      content_hash: hash(input.baseContext),
      job_id: input.jobId,
    },
    {
      doc_id: "existing_ddl",
      doc_type: "schema_context",
      source_path: path.join(input.repoRoot, "data", "ddl.sql"),
      content: input.existingDdl,
      content_hash: hash(input.existingDdl),
      job_id: input.jobId,
    },
    {
      doc_id: "instrumentation_notes",
      doc_type: "instrumentation_context",
      source_path: path.join(input.repoRoot, "data", "instrumentation_notes.md"),
      content: input.instrumentationNotes,
      content_hash: hash(input.instrumentationNotes),
      job_id: input.jobId,
    },
  ];

  await executeClickHouse(`INSERT INTO context.context_documents FORMAT JSONEachRow
${rows.map((row) => JSON.stringify(row)).join("\n")}
`);

  await executeClickHouse(`INSERT INTO context.contradictions FORMAT JSONEachRow
${emptyRegistry.contradictions
  .map((contradiction) =>
    JSON.stringify({
      ...contradiction,
      status: "open",
    }),
  )
  .join("\n")}
`);
}

async function readGeneratedContext(): Promise<GeneratedContextRegistry> {
  await ensureContextTables();
  const featuresRaw = (
    await queryClickHouseText(`
SELECT
  feature_slug,
  table_name,
  primary_entity,
  event_names_json,
  success_event,
  metric_hints_json,
  toString(updated_at)
FROM context.feature_registry
ORDER BY feature_slug
FORMAT TabSeparated
`)
  ).trim();

  const contradictionsRaw = (
    await queryClickHouseText(`
SELECT id, summary, evidence
FROM context.contradictions
WHERE status = 'open'
ORDER BY id
FORMAT TabSeparated
`)
  ).trim();

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    features: featuresRaw
      ? featuresRaw.split("\n").map((line) => {
          const [
            feature_slug,
            table_name,
            primary_entity,
            event_names_json,
            success_event,
            metric_hints_json,
            added_at,
          ] = line.split("\t");
          return {
            feature_slug,
            table_name,
            primary_entity,
            event_names: parseJsonArray(event_names_json),
            success_event: success_event || null,
            metric_hints: parseJsonArray(metric_hints_json),
            added_at,
          };
        })
      : [],
    contradictions: contradictionsRaw
      ? contradictionsRaw.split("\n").map((line) => {
          const [id, summary, evidence] = line.split("\t");
          return { id, summary, evidence };
        })
      : emptyRegistry.contradictions,
  };
}

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
