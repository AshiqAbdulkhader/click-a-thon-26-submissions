import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { executeClickHouse, queryClickHouseText } from "./clickhouse.js";
import { EventProfile, SchemaPlan } from "./instrumentation/types.js";

export type ContextBundle = {
  baseContext: string;
  existingDdl: string;
  instrumentationNotes: string;
  generatedContext: GeneratedContextRegistry;
};

export type RelevantContextBundle = {
  similar_workflows: GeneratedContextRegistry["workflows"];
  column_type_precedents: GeneratedContextRegistry["columns"];
  reusable_metrics: GeneratedContextRegistry["metrics"];
  recommended_joins: GeneratedContextRegistry["joins"];
  schema_quality: GeneratedContextRegistry["schema_quality"];
  contradictions: GeneratedContextRegistry["contradictions"];
  retrieval_notes: string[];
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
  columns: Array<{
    table_name: string;
    column_name: string;
    clickhouse_type: string;
    source_path: string | null;
    semantic_role: string;
    is_nullable: boolean;
  }>;
  workflows: Array<{
    feature_slug: string;
    table_name: string;
    workflow_type: string;
    start_event: string | null;
    success_event: string | null;
    primary_entity: string;
    primary_entity_column: string;
    segment_columns: string[];
  }>;
  metrics: Array<{
    metric_name: string;
    feature_slug: string;
    formula_sql: string;
    grain: string;
    segment_columns: string[];
  }>;
  joins: Array<{
    left_table: string;
    left_column: string;
    right_table: string;
    right_column: string;
    grain: string;
    confidence: number;
  }>;
  schema_quality: Array<{
    table_name: string;
    order_by: string[];
    partition_by: string;
    ttl: string;
    materialized_views: string[];
    validation_passed: boolean;
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
  columns: [],
  workflows: [],
  metrics: [],
  joins: [],
  schema_quality: [],
};

export async function loadContextBundle(
  repoRoot: string,
): Promise<ContextBundle> {
  await ensureContextTables();
  const [baseContext, existingDdl, instrumentationNotes] = await Promise.all([
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
  schema_plan: SchemaPlan;
  event_profile: EventProfile;
}) {
  await ensureContextTables();
  await insertJsonRows("context.feature_registry", [
    {
      feature_slug: input.feature_slug,
      job_id: input.job_id,
      table_name: input.table_name,
      primary_entity: input.primary_entity,
      workflow_type: input.workflow_type,
      event_names_json: JSON.stringify(input.event_names),
      success_event: input.success_event ?? "",
      metric_hints_json: JSON.stringify(input.metric_hints),
      validation_json: JSON.stringify(input.validation),
    },
  ]);

  await insertJsonRows("context.fact_registry", [
    {
      fact_id: `feature:${input.feature_slug}:uses_table`,
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
      fact_id: `entity:${input.feature_slug}:primary_entity`,
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
  ]);

  await writeSchemaMemory(input);

  return readGeneratedContext();
}

export function retrieveRelevantContextForSpec(input: {
  context: ContextBundle;
  featureSlug: string;
  workflowType: string;
  primaryEntity: string;
  eventNames: string[];
  fieldPaths: string[];
  metricHints: string[];
}): RelevantContextBundle {
  const registry = input.context.generatedContext;
  const queryTerms = new Set(
    [
      input.featureSlug,
      input.workflowType,
      input.primaryEntity,
      ...input.eventNames,
      ...input.fieldPaths,
      ...input.metricHints,
    ]
      .flatMap(tokenize)
      .filter(Boolean),
  );

  const scoreText = (...values: Array<string | null | undefined>) =>
    values
      .flatMap((value) => tokenize(value ?? ""))
      .reduce((score, token) => score + (queryTerms.has(token) ? 1 : 0), 0);

  const similarWorkflows = registry.workflows
    .map((workflow) => ({
      item: workflow,
      score:
        scoreText(
          workflow.feature_slug,
          workflow.workflow_type,
          workflow.primary_entity,
          workflow.primary_entity_column,
          workflow.start_event,
          workflow.success_event,
          workflow.segment_columns.join(" "),
        ) + (workflow.workflow_type === input.workflowType ? 4 : 0),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((scored) => scored.item);

  const fieldColumnNames = new Set(
    input.fieldPaths.map((field) => field.split(".").at(-1) ?? field),
  );
  const columnPrecedents = registry.columns
    .map((column) => ({
      item: column,
      score:
        scoreText(
          column.table_name,
          column.column_name,
          column.source_path,
          column.semantic_role,
        ) +
        (fieldColumnNames.has(column.column_name) ? 5 : 0) +
        (input.fieldPaths.includes(column.source_path ?? "") ? 6 : 0),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60)
    .map((scored) => scored.item);

  const reusableMetrics = registry.metrics
    .map((metric) => ({
      item: metric,
      score:
        scoreText(
          metric.feature_slug,
          metric.metric_name,
          metric.formula_sql,
          metric.grain,
          metric.segment_columns.join(" "),
        ) +
        input.metricHints.reduce(
          (score, hint) => score + lexicalOverlap(hint, metric.metric_name),
          0,
        ),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((scored) => scored.item);

  const recommendedJoins = registry.joins
    .filter(
      (join) =>
        input.fieldPaths.includes(join.left_column) ||
        input.fieldPaths.includes(join.right_column) ||
        fieldColumnNames.has(join.left_column) ||
        fieldColumnNames.has(join.right_column),
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20);

  const tableNames = new Set([
    ...similarWorkflows.map((workflow) => workflow.table_name),
    ...columnPrecedents.map((column) => column.table_name),
  ]);
  const schemaQuality = registry.schema_quality
    .filter((quality) => tableNames.has(quality.table_name))
    .slice(0, 20);

  return {
    similar_workflows: similarWorkflows,
    column_type_precedents: columnPrecedents,
    reusable_metrics: reusableMetrics,
    recommended_joins: recommendedJoins,
    schema_quality: schemaQuality,
    contradictions: registry.contradictions,
    retrieval_notes: [
      `Retrieved ${similarWorkflows.length} workflows, ${columnPrecedents.length} column precedents, ${reusableMetrics.length} metrics, and ${recommendedJoins.length} joins.`,
      "Use retrieved context as evidence, not truth; raw event profile remains source of truth.",
    ],
  };
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

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.column_registry
(
    feature_slug String,
    table_name String,
    column_name String,
    clickhouse_type String,
    source_path String,
    semantic_role LowCardinality(String),
    is_nullable UInt8,
    sample_values_json String,
    reason String,
    confidence Float32,
    source_job_id String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (table_name, column_name)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.workflow_registry
(
    feature_slug String,
    table_name String,
    workflow_type LowCardinality(String),
    ordered_events_json String,
    start_event String,
    success_event String,
    primary_entity String,
    primary_entity_column String,
    segment_columns_json String,
    source_job_id String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (feature_slug)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.metric_registry
(
    metric_id String,
    feature_slug String,
    metric_name String,
    formula_sql String,
    numerator_definition String,
    denominator_definition String,
    grain String,
    required_tables_json String,
    segment_columns_json String,
    caveats String,
    confidence Float32,
    source_job_id String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (metric_id)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.join_registry
(
    join_id String,
    left_table String,
    left_column String,
    right_table String,
    right_column String,
    join_type LowCardinality(String),
    grain String,
    confidence Float32,
    evidence String,
    source_job_id String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (join_id)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS context.schema_quality_registry
(
    feature_slug String,
    table_name String,
    engine String,
    partition_by String,
    order_by_json String,
    ttl String,
    materialized_views_json String,
    validation_json String,
    validation_passed UInt8,
    source_job_id String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (table_name)
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
      source_path: path.join(
        input.repoRoot,
        "data",
        "instrumentation_notes.md",
      ),
      content: input.instrumentationNotes,
      content_hash: hash(input.instrumentationNotes),
      job_id: input.jobId,
    },
  ];

  await insertJsonRows("context.context_documents", rows);

  await insertJsonRows(
    "context.contradictions",
    emptyRegistry.contradictions.map((contradiction) => ({
      ...contradiction,
      status: "open",
    })),
  );

  await writeBaseSchemaMemory({
    jobId: input.jobId,
    existingDdl: input.existingDdl,
  });
}

async function writeSchemaMemory(input: {
  job_id: string;
  feature_slug: string;
  table_name: string;
  primary_entity: string;
  workflow_type: string;
  event_names: string[];
  success_event: string | null;
  metric_hints: string[];
  validation: Record<string, unknown>;
  schema_plan: SchemaPlan;
  event_profile: EventProfile;
}) {
  const fullTableName = `silver.${input.table_name}`;
  const fieldProfiles = new Map(
    input.event_profile.fields.map((field) => [field.path, field]),
  );
  const columns = input.schema_plan.columns.map((column) => {
    const field = column.source_path
      ? fieldProfiles.get(column.source_path)
      : null;
    return {
      feature_slug: input.feature_slug,
      table_name: fullTableName,
      column_name: column.name,
      clickhouse_type: column.type,
      source_path: column.source_path ?? "",
      semantic_role: semanticRoleForColumn(column.name, column.type),
      is_nullable: column.type.startsWith("Nullable(") ? 1 : 0,
      sample_values_json: JSON.stringify(field?.sample_values ?? []),
      reason: column.reason,
      confidence: field || !column.source_path ? 1 : 0.7,
      source_job_id: input.job_id,
    };
  });

  await insertJsonRows("context.column_registry", columns);

  const primaryEntityColumn = resolveContextPrimaryEntityColumn(
    input.primary_entity,
    input.schema_plan.columns.map((column) => column.name),
  );
  const segmentColumns = input.schema_plan.columns
    .filter(
      (column) =>
        semanticRoleForColumn(column.name, column.type) === "dimension",
    )
    .map((column) => column.name);

  await insertJsonRows("context.workflow_registry", [
    {
      feature_slug: input.feature_slug,
      table_name: fullTableName,
      workflow_type: input.workflow_type,
      ordered_events_json: JSON.stringify(input.event_names),
      start_event: input.event_names[0] ?? "",
      success_event: input.success_event ?? "",
      primary_entity: input.primary_entity,
      primary_entity_column: primaryEntityColumn,
      segment_columns_json: JSON.stringify(segmentColumns),
      source_job_id: input.job_id,
    },
  ]);

  const metrics = buildMetricMemory({
    featureSlug: input.feature_slug,
    tableName: fullTableName,
    metricHints: input.metric_hints,
    eventNames: input.event_names,
    successEvent: input.success_event,
    primaryEntityColumn,
    segmentColumns,
    jobId: input.job_id,
  });
  await insertJsonRows("context.metric_registry", metrics);

  await insertJsonRows(
    "context.join_registry",
    buildJoinMemory({
      tableName: fullTableName,
      columns: input.schema_plan.columns.map((column) => column.name),
      jobId: input.job_id,
    }),
  );

  await insertJsonRows("context.schema_quality_registry", [
    {
      feature_slug: input.feature_slug,
      table_name: fullTableName,
      engine: input.schema_plan.engine,
      partition_by: input.schema_plan.partition_by,
      order_by_json: JSON.stringify(input.schema_plan.order_by),
      ttl: input.schema_plan.ttl,
      materialized_views_json: JSON.stringify(
        input.schema_plan.materialized_views.map((view) => view.name),
      ),
      validation_json: JSON.stringify(input.validation),
      validation_passed: Boolean(
        (input.validation as { passed?: unknown }).passed,
      )
        ? 1
        : 0,
      source_job_id: input.job_id,
    },
  ]);
}

async function writeBaseSchemaMemory(input: {
  jobId: string;
  existingDdl: string;
}) {
  const tables = parseCreateTables(input.existingDdl);
  const columnRows = tables.flatMap((table) =>
    table.columns.map((column) => ({
      feature_slug: "base_context",
      table_name: table.name,
      column_name: column.name,
      clickhouse_type: column.type,
      source_path: column.name,
      semantic_role: semanticRoleForColumn(column.name, column.type),
      is_nullable: column.type.startsWith("Nullable(") ? 1 : 0,
      sample_values_json: "[]",
      reason: "Parsed from data/ddl.sql during context bootstrap.",
      confidence: 1,
      source_job_id: input.jobId,
    })),
  );
  await insertJsonRows("context.column_registry", columnRows);

  await insertJsonRows(
    "context.join_registry",
    tables.flatMap((table) =>
      buildJoinMemory({
        tableName: table.name,
        columns: table.columns.map((column) => column.name),
        jobId: input.jobId,
      }),
    ),
  );

  await insertJsonRows("context.workflow_registry", [
    {
      feature_slug: "base_conversion_funnel",
      table_name:
        "destination_card_clicked|application_started|document_uploaded|purchase_completed",
      workflow_type: "funnel",
      ordered_events_json: JSON.stringify([
        "destination_card_clicked",
        "application_started",
        "document_uploaded",
        "purchase_completed",
      ]),
      start_event: "destination_card_clicked",
      success_event: "purchase_completed",
      primary_entity: "application",
      primary_entity_column: "application_id",
      segment_columns_json: JSON.stringify([
        "device_type",
        "os",
        "geoip_country_code",
        "destination",
        "citizenship",
      ]),
      source_job_id: input.jobId,
    },
  ]);

  await insertJsonRows("context.metric_registry", [
    {
      metric_id: "base:funnel_conversion",
      feature_slug: "base_conversion_funnel",
      metric_name: "funnel_conversion_rate",
      formula_sql:
        "uniq(purchase_completed.user_id) / nullIf(uniq(application_started.user_id), 0)",
      numerator_definition: "distinct users with purchase_completed",
      denominator_definition: "distinct users with application_started",
      grain: "user",
      required_tables_json: JSON.stringify([
        "application_started",
        "purchase_completed",
      ]),
      segment_columns_json: JSON.stringify([
        "device_type",
        "os",
        "geoip_country_code",
        "destination",
      ]),
      caveats:
        "Use for funnel dashboards; leadership conversion may use sessions instead.",
      confidence: 0.9,
      source_job_id: input.jobId,
    },
    {
      metric_id: "base:passport_capture_pass_rate",
      feature_slug: "base_conversion_funnel",
      metric_name: "passport_capture_pass_rate",
      formula_sql:
        "countIf(is_crossed_failed_attempt_threshold = 0) / nullIf(count(), 0) FROM document_uploaded",
      numerator_definition:
        "document uploads without crossed failed-attempt threshold",
      denominator_definition: "all document uploads",
      grain: "event",
      required_tables_json: JSON.stringify(["document_uploaded"]),
      segment_columns_json: JSON.stringify([
        "device_type",
        "os",
        "destination",
      ]),
      caveats:
        "Base context links this to passport capture quality; validate device cuts before conclusions.",
      confidence: 0.9,
      source_job_id: input.jobId,
    },
    {
      metric_id: "base:revenue_per_conversion",
      feature_slug: "base_conversion_funnel",
      metric_name: "revenue_per_conversion",
      formula_sql: "avg(value) FROM purchase_completed",
      numerator_definition: "purchase_completed.value",
      denominator_definition: "converted purchases",
      grain: "purchase",
      required_tables_json: JSON.stringify(["purchase_completed"]),
      segment_columns_json: JSON.stringify(["currency", "destination"]),
      caveats:
        "Values are event currency amounts; normalize currency before cross-currency comparisons.",
      confidence: 0.85,
      source_job_id: input.jobId,
    },
  ]);
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
FROM context.feature_registry FINAL
ORDER BY feature_slug
FORMAT TabSeparated
`)
  ).trim();

  const contradictionsRaw = (
    await queryClickHouseText(`
SELECT id, summary, evidence
FROM context.contradictions
FINAL
WHERE status = 'open'
ORDER BY id
FORMAT TabSeparated
`)
  ).trim();

  const columnsRaw = (
    await queryClickHouseText(`
SELECT
  table_name,
  column_name,
  clickhouse_type,
  source_path,
  semantic_role,
  is_nullable
FROM context.column_registry FINAL
ORDER BY table_name, column_name
LIMIT 500
FORMAT TabSeparated
`)
  ).trim();

  const workflowsRaw = (
    await queryClickHouseText(`
SELECT
  feature_slug,
  table_name,
  workflow_type,
  start_event,
  success_event,
  primary_entity,
  primary_entity_column,
  segment_columns_json
FROM context.workflow_registry FINAL
ORDER BY updated_at DESC
LIMIT 50
FORMAT TabSeparated
`)
  ).trim();

  const metricsRaw = (
    await queryClickHouseText(`
SELECT
  metric_name,
  feature_slug,
  formula_sql,
  grain,
  segment_columns_json
FROM context.metric_registry FINAL
ORDER BY updated_at DESC
LIMIT 100
FORMAT TabSeparated
`)
  ).trim();

  const joinsRaw = (
    await queryClickHouseText(`
SELECT
  left_table,
  left_column,
  right_table,
  right_column,
  grain,
  confidence
FROM context.join_registry FINAL
ORDER BY updated_at DESC
LIMIT 100
FORMAT TabSeparated
`)
  ).trim();

  const qualityRaw = (
    await queryClickHouseText(`
SELECT
  table_name,
  order_by_json,
  partition_by,
  ttl,
  materialized_views_json,
  validation_passed
FROM context.schema_quality_registry FINAL
ORDER BY updated_at DESC
LIMIT 100
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
    columns: columnsRaw
      ? columnsRaw.split("\n").map((line) => {
          const [
            table_name,
            column_name,
            clickhouse_type,
            source_path,
            semantic_role,
            is_nullable,
          ] = line.split("\t");
          return {
            table_name,
            column_name,
            clickhouse_type,
            source_path: source_path || null,
            semantic_role,
            is_nullable: is_nullable === "1",
          };
        })
      : [],
    workflows: workflowsRaw
      ? workflowsRaw.split("\n").map((line) => {
          const [
            feature_slug,
            table_name,
            workflow_type,
            start_event,
            success_event,
            primary_entity,
            primary_entity_column,
            segment_columns_json,
          ] = line.split("\t");
          return {
            feature_slug,
            table_name,
            workflow_type,
            start_event: start_event || null,
            success_event: success_event || null,
            primary_entity,
            primary_entity_column,
            segment_columns: parseJsonArray(segment_columns_json),
          };
        })
      : [],
    metrics: metricsRaw
      ? metricsRaw.split("\n").map((line) => {
          const [
            metric_name,
            feature_slug,
            formula_sql,
            grain,
            segment_columns_json,
          ] = line.split("\t");
          return {
            metric_name,
            feature_slug,
            formula_sql,
            grain,
            segment_columns: parseJsonArray(segment_columns_json),
          };
        })
      : [],
    joins: joinsRaw
      ? joinsRaw.split("\n").map((line) => {
          const [
            left_table,
            left_column,
            right_table,
            right_column,
            grain,
            confidence,
          ] = line.split("\t");
          return {
            left_table,
            left_column,
            right_table,
            right_column,
            grain,
            confidence: Number(confidence),
          };
        })
      : [],
    schema_quality: qualityRaw
      ? qualityRaw.split("\n").map((line) => {
          const [
            table_name,
            order_by_json,
            partition_by,
            ttl,
            materialized_views_json,
            validation_passed,
          ] = line.split("\t");
          return {
            table_name,
            order_by: parseJsonArray(order_by_json),
            partition_by,
            ttl,
            materialized_views: parseJsonArray(materialized_views_json),
            validation_passed: validation_passed === "1",
          };
        })
      : [],
  };
}

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

async function insertJsonRows(
  tableName: string,
  rows: Record<string, unknown>[],
) {
  if (rows.length === 0) {
    return;
  }
  await executeClickHouse(`INSERT INTO ${tableName} FORMAT JSONEachRow
${rows.map((row) => JSON.stringify(row)).join("\n")}
`);
}

function semanticRoleForColumn(columnName: string, clickhouseType: string) {
  if (["job_id", "ingested_at"].includes(columnName)) {
    return "operational";
  }
  if (columnName === "raw_json") {
    return "raw_payload";
  }
  if (columnName === "event_name") {
    return "event_name";
  }
  if (columnName === "timestamp" || columnName.endsWith("_at")) {
    return "timestamp";
  }
  if (columnName === "event_id" || columnName.endsWith("_id")) {
    return "entity_id";
  }
  if (
    /(amount|value|rate|price|revenue|latency|duration|count|attempts|depth|time)/i.test(
      columnName,
    )
  ) {
    return "metric_value";
  }
  if (clickhouseType.includes("Bool") || columnName.startsWith("is_")) {
    return "boolean_flag";
  }
  if (
    /(currency|country|city|destination|device|os|version|channel|method|type|source|flow|status|step)/i.test(
      columnName,
    )
  ) {
    return "dimension";
  }
  return clickhouseType.includes("String") ? "dimension" : "metric_value";
}

function resolveContextPrimaryEntityColumn(
  primaryEntity: string,
  columnNames: string[],
) {
  const names = new Set(columnNames);
  const normalized = primaryEntity.replace(/[^a-zA-Z0-9]+/g, "_");
  if (names.has(normalized)) {
    return normalized;
  }
  if (names.has(`${normalized}_id`)) {
    return `${normalized}_id`;
  }
  if (names.has("application_id")) {
    return "application_id";
  }
  return names.has("user_id") ? "user_id" : "";
}

function buildMetricMemory(input: {
  featureSlug: string;
  tableName: string;
  metricHints: string[];
  eventNames: string[];
  successEvent: string | null;
  primaryEntityColumn: string;
  segmentColumns: string[];
  jobId: string;
}) {
  const startEvent = input.eventNames[0] ?? "";
  const successEvent = input.successEvent ?? input.eventNames.at(-1) ?? "";
  const metrics = input.metricHints.map((hint) => ({
    metric_id: `${input.featureSlug}:${slugify(hint)}`,
    feature_slug: input.featureSlug,
    metric_name: hint,
    formula_sql: metricFormulaSql({
      tableName: input.tableName,
      metricName: hint,
      startEvent,
      successEvent,
      primaryEntityColumn: input.primaryEntityColumn,
    }),
    numerator_definition: successEvent
      ? `${input.primaryEntityColumn} reaching ${successEvent}`
      : "feature-specific numerator",
    denominator_definition: startEvent
      ? `${input.primaryEntityColumn} reaching ${startEvent}`
      : "feature-specific denominator",
    grain: input.primaryEntityColumn || "event",
    required_tables_json: JSON.stringify([input.tableName]),
    segment_columns_json: JSON.stringify(input.segmentColumns),
    caveats:
      "Generated from feature metric hints; analytics agent should verify exact denominator against the user question.",
    confidence: 0.75,
    source_job_id: input.jobId,
  }));

  if (startEvent && successEvent && input.primaryEntityColumn) {
    metrics.unshift({
      metric_id: `${input.featureSlug}:primary_conversion`,
      feature_slug: input.featureSlug,
      metric_name: `${startEvent}_to_${successEvent}_conversion`,
      formula_sql: metricFormulaSql({
        tableName: input.tableName,
        metricName: "conversion",
        startEvent,
        successEvent,
        primaryEntityColumn: input.primaryEntityColumn,
      }),
      numerator_definition: `${input.primaryEntityColumn} reaching ${successEvent}`,
      denominator_definition: `${input.primaryEntityColumn} reaching ${startEvent}`,
      grain: input.primaryEntityColumn,
      required_tables_json: JSON.stringify([input.tableName]),
      segment_columns_json: JSON.stringify(input.segmentColumns),
      caveats:
        "Primary feature conversion metric generated from ordered feature events.",
      confidence: 0.9,
      source_job_id: input.jobId,
    });
  }

  return metrics;
}

function metricFormulaSql(input: {
  tableName: string;
  metricName: string;
  startEvent: string;
  successEvent: string;
  primaryEntityColumn: string;
}) {
  if (!input.startEvent || !input.successEvent || !input.primaryEntityColumn) {
    return `-- Metric '${input.metricName}' requires feature-specific SQL.`;
  }
  return `uniqIf(${input.primaryEntityColumn}, event_name = '${input.successEvent}') / nullIf(uniqIf(${input.primaryEntityColumn}, event_name = '${input.startEvent}'), 0) FROM ${input.tableName}`;
}

function buildJoinMemory(input: {
  tableName: string;
  columns: string[];
  jobId: string;
}) {
  const joins = [];
  if (input.columns.includes("user_id")) {
    joins.push({
      join_id: `${input.tableName}:user_id:base_events`,
      left_table: input.tableName,
      left_column: "user_id",
      right_table: "*",
      right_column: "user_id",
      join_type: "entity",
      grain: "user",
      confidence: 0.9,
      evidence: "Atlys context says user_id joins all event streams.",
      source_job_id: input.jobId,
    });
  }
  if (input.columns.includes("application_id")) {
    joins.push({
      join_id: `${input.tableName}:application_id:application_funnel`,
      left_table: input.tableName,
      left_column: "application_id",
      right_table:
        "application_started|document_uploaded|pay_now_clicked|purchase_completed",
      right_column: "application_id",
      join_type: "entity",
      grain: "application",
      confidence: 0.9,
      evidence:
        "Base context join map links application_id across application_started and downstream funnel tables.",
      source_job_id: input.jobId,
    });
  }
  return joins;
}

function parseCreateTables(ddl: string) {
  const tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
  }> = [];
  const tableRegex =
    /CREATE TABLE\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*ENGINE/g;
  for (const match of ddl.matchAll(tableRegex)) {
    const [, name, body] = match;
    const columns = body
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter(Boolean)
      .map((line) => {
        const columnMatch = line.match(/^([a-zA-Z0-9_]+)\s+(.+)$/);
        if (!columnMatch) {
          return null;
        }
        return { name: columnMatch[1], type: columnMatch[2] };
      })
      .filter((column): column is { name: string; type: string } =>
        Boolean(column),
      );
    tables.push({ name, columns });
  }
  return tables;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function lexicalOverlap(left: string, right: string) {
  const rightTokens = new Set(tokenize(right));
  return tokenize(left).reduce(
    (score, token) => score + (rightTokens.has(token) ? 1 : 0),
    0,
  );
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
