import path from "node:path";
import { startActiveObservation } from "@langfuse/tracing";
import { ContextBundle } from "../context.js";
import { callGroqJson } from "../groq.js";
import { recordPipelineStage } from "../tracking.js";
import { writeStageJson, writeStageText } from "./artifacts.js";
import { toColumnName } from "./eventUtils.js";
import { instrumentationTrackingEvents } from "./trackingEvents.js";
import {
  EventProfile,
  FeatureManifest,
  MappingPlan,
  SchemaPlan,
} from "./types.js";

export async function runSchemaGenerator(input: {
  jobId: string;
  featureSlug: string;
  manifest: FeatureManifest;
  eventProfile: EventProfile;
  context: ContextBundle;
  artifactRoot: string;
}) {
  const stage = instrumentationTrackingEvents.schemaGenerator;

  return startActiveObservation(stage.observationName, async (span) => {
    span.update({
      input: {
        feature_slug: input.featureSlug,
        workflow_type: input.manifest.workflow_type,
        primary_entity: input.manifest.primary_entity,
        field_count: input.eventProfile.fields.length,
      },
      metadata: {
        agent: stage.agent,
        source_layer: stage.sourceLayer,
        target_layer: stage.targetLayer,
      },
    });

    const designLoop = await runSchemaDesignLoop(input);
    const schemaPlan = designLoop.final_plan;
    const schemaSql = renderCreateTableSql(schemaPlan);
    const mappingPlan = buildMappingPlan(schemaPlan);
    const materializedViewsSql = renderMaterializedViewsSql(schemaPlan);

    await writeStageJson(
      input.artifactRoot,
      stage.stageId,
      "schema_plan.json",
      schemaPlan,
    );
    await writeStageJson(
      input.artifactRoot,
      stage.stageId,
      "schema_design_loop.json",
      designLoop,
    );
    await writeStageText(
      input.artifactRoot,
      stage.stageId,
      "schema.sql",
      schemaSql,
    );
    await writeStageText(
      input.artifactRoot,
      stage.stageId,
      "materialized_views.sql",
      materializedViewsSql,
    );
    await writeStageJson(
      input.artifactRoot,
      stage.stageId,
      "mapping.json",
      mappingPlan,
    );

    span.update({
      output: {
        table: `silver.${schemaPlan.table_name}`,
        engine: schemaPlan.engine,
        partition_by: schemaPlan.partition_by,
        order_by: schemaPlan.order_by,
        column_count: schemaPlan.columns.length,
        materialized_views: schemaPlan.materialized_views.map(
          (view) => view.name,
        ),
        loop_iterations: designLoop.iterations.length,
        artifacts: [
          path.join(
            input.artifactRoot,
            stage.stageId,
            "schema_design_loop.json",
          ),
          path.join(input.artifactRoot, stage.stageId, "schema_plan.json"),
          path.join(input.artifactRoot, stage.stageId, "schema.sql"),
          path.join(
            input.artifactRoot,
            stage.stageId,
            "materialized_views.sql",
          ),
          path.join(input.artifactRoot, stage.stageId, "mapping.json"),
        ],
      },
    });

    await recordPipelineStage({
      jobId: input.jobId,
      stageId: stage.stageId,
      stageName: stage.stageName,
      status: "completed",
      stageInput: {
        feature_slug: input.featureSlug,
        workflow_type: input.manifest.workflow_type,
        primary_entity: input.manifest.primary_entity,
        source_layer: stage.sourceLayer,
        target_layer: stage.targetLayer,
      },
      stageOutput: {
        table: `silver.${schemaPlan.table_name}`,
        engine: schemaPlan.engine,
        partition_by: schemaPlan.partition_by,
        order_by: schemaPlan.order_by,
        column_count: schemaPlan.columns.length,
        materialized_views: schemaPlan.materialized_views.map(
          (view) => view.name,
        ),
        loop_iterations: designLoop.iterations.length,
      },
    });

    return { schemaPlan, schemaSql, mappingPlan };
  });
}

type SchemaColumnDraft = {
  name: string;
  type: string;
  source_path: string | null;
  reason: string;
};

type SchemaDesignDraft = {
  table_name?: string;
  engine?: string;
  order_by?: string[];
  partition_by?: string;
  ttl?: string;
  columns?: SchemaColumnDraft[];
  materialized_view_recommendations?: Array<{
    purpose: string;
    dimensions?: string[];
    metrics?: string[];
  }>;
  context_assumptions?: Array<{
    claim: string;
    evidence: string;
    trusted: boolean;
  }>;
  rationale?: string[];
};

type SchemaDesignLoop = {
  mode: "llm_assisted" | "deterministic_only";
  iterations: Array<{
    iteration: number;
    actor: "schema_designer" | "deterministic_guardrail" | "schema_repair";
    summary: string;
    issues: string[];
  }>;
  final_plan: SchemaPlan;
};

async function runSchemaDesignLoop(input: {
  featureSlug: string;
  manifest: FeatureManifest;
  eventProfile: EventProfile;
  context: ContextBundle;
}): Promise<SchemaDesignLoop> {
  const iterations: SchemaDesignLoop["iterations"] = [];
  const fallbackPlan = buildSchemaPlan(input.manifest, input.eventProfile);
  let schemaPlan = fallbackPlan;
  const draft = await requestSchemaDesignDraft(input);

  if (draft) {
    schemaPlan = normalizeDesignDraft(draft, fallbackPlan, input.eventProfile);
    iterations.push({
      iteration: 1,
      actor: "schema_designer",
      summary:
        "LLM schema designer proposed a full ClickHouse schema plan from spec, profile, and context evidence.",
      issues: [
        ...(draft.rationale ?? []),
        ...(draft.context_assumptions ?? []).map(
          (assumption) =>
            `${assumption.trusted ? "trusted" : "not_trusted"} context: ${assumption.claim} (${assumption.evidence})`,
        ),
      ],
    });
  } else {
    iterations.push({
      iteration: 1,
      actor: "schema_designer",
      summary:
        "No LLM schema suggestion available; using deterministic evidence-based draft.",
      issues: [],
    });
  }

  const firstReview = reviewSchemaPlan(schemaPlan, input.eventProfile);
  iterations.push({
    iteration: 1,
    actor: "deterministic_guardrail",
    summary:
      firstReview.length === 0
        ? "Draft passed guardrails."
        : "Draft had guardrail issues.",
    issues: firstReview,
  });

  if (firstReview.length > 0) {
    schemaPlan = repairSchemaPlan(
      schemaPlan,
      input.manifest,
      input.eventProfile,
    );
    const secondReview = reviewSchemaPlan(schemaPlan, input.eventProfile);
    iterations.push({
      iteration: 2,
      actor: "schema_repair",
      summary:
        secondReview.length === 0
          ? "Deterministic repair produced an executable schema plan."
          : "Deterministic repair left unresolved issues.",
      issues: secondReview,
    });

    if (secondReview.length > 0) {
      throw new Error(
        `Schema design loop failed guardrails: ${secondReview.join("; ")}`,
      );
    }
  }

  return {
    mode: draft ? "llm_assisted" : "deterministic_only",
    iterations,
    final_plan: schemaPlan,
  };
}

async function requestSchemaDesignDraft(input: {
  featureSlug: string;
  manifest: FeatureManifest;
  eventProfile: EventProfile;
  context: ContextBundle;
}): Promise<SchemaDesignDraft | null> {
  try {
    const draft = await callGroqJson<SchemaDesignDraft>({
      strictJson: false,
      temperature: 0,
      maxTokens: 3500,
      traceName: "groq.schema_design",
      traceInput: {
        task: "clickhouse_schema_design",
        feature_slug: input.featureSlug,
        workflow_type: input.manifest.workflow_type,
        field_count: input.eventProfile.fields.length,
        context_features: input.context.generatedContext.features.length,
      },
      messages: [
        {
          role: "system",
          content:
            "You are a ClickHouse instrumentation schema designer. Return exactly one JSON object and nothing else. Do not return null. The JSON object must include a columns array. Design from the spec and raw event evidence. Treat business context as useful but fallible; never trust context over raw event evidence.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Design the full Silver ClickHouse schema plan for this feature. Use the spec and event profile as source of truth. Use context only when supported by evidence, and explicitly mark context assumptions as trusted or not trusted.",
            allowed_shape: {
              table_name: `${input.featureSlug}_events`,
              engine: "ReplacingMergeTree",
              order_by: ["existing_column_name"],
              partition_by:
                "ClickHouse partition expression, usually toYYYYMM(timestamp)",
              ttl: "ClickHouse TTL expression",
              columns: [
                {
                  name: "snake_case_column_name",
                  type: "ClickHouse type",
                  source_path:
                    "raw JSON path from event_profile, or null only for pipeline columns",
                  reason: "why this column belongs in the analytical schema",
                },
              ],
              materialized_view_recommendations: [
                {
                  purpose: "aggregation purpose",
                  dimensions: ["existing_column_name"],
                  metrics: ["count | success_count | entity_count"],
                },
              ],
              context_assumptions: [
                {
                  claim: "context claim used or rejected",
                  evidence: "spec/event/profile/context evidence",
                  trusted: true,
                },
              ],
              rationale: ["short reasoning bullets"],
            },
            constraints: [
              "Return exactly one JSON object. No markdown, no prose outside JSON, no null.",
              "Every non-pipeline source_path must exist in event_profile.fields.",
              "Include required pipeline columns: job_id, event_name, event_id, timestamp, raw_json, ingested_at.",
              "event_name maps from raw path event; event_id maps from raw path id; timestamp maps from raw path timestamp.",
              "ORDER BY columns must be non-nullable.",
              "ORDER BY must include timestamp and event_id.",
              "Keep raw_json for replay.",
              "Prefer LowCardinality(String) for repeated dimensions.",
              "Use Nullable types for fields missing from some events or containing nulls.",
              "Suggest materialized views only for reusable aggregates.",
              "Do not copy context errors into the schema. If context conflicts with event evidence, trust event evidence.",
            ],
            feature_manifest: input.manifest,
            event_profile: input.eventProfile,
            generated_context: input.context.generatedContext,
            known_context_contradictions:
              input.context.generatedContext.contradictions,
            base_context_excerpt: input.context.baseContext.slice(0, 6000),
          }),
        },
      ],
    });
    if (!draft || !Array.isArray(draft.columns)) {
      console.warn(
        "Groq schema design returned no usable columns array; using deterministic draft.",
      );
      return null;
    }
    return draft;
  } catch (error) {
    console.warn(
      `Groq schema design failed; using deterministic draft: ${error}`,
    );
    return null;
  }
}

function buildSchemaPlan(
  manifest: FeatureManifest,
  eventProfile: EventProfile,
): SchemaPlan {
  const tableName = `${manifest.feature_slug}_events`;
  const standardColumns = new Set([
    "event",
    "id",
    "timestamp",
    "user_id",
    "application_id",
    "app_session_id",
    "device",
    "device_type",
    "os",
    "app_version",
    "client_lib",
    "geoip_country_code",
    "geoip_subdivision_1_code",
    "city",
    "destination",
    "citizenship",
    "gclid",
    "fbclid",
    "duplicate_id",
    "is_back_filled",
  ]);

  const columns: SchemaPlan["columns"] = [
    {
      name: "job_id",
      type: "String",
      source_path: null,
      reason: "Pipeline run identifier for replay and trace joins.",
    },
    {
      name: "event_name",
      type: "LowCardinality(String)",
      source_path: "event",
      reason: "Common event discriminator for funnel and step analysis.",
    },
    {
      name: "event_id",
      type: "String",
      source_path: "id",
      reason: "Raw event identifier used for dedupe and audit.",
    },
    {
      name: "timestamp",
      type: "DateTime64(3)",
      source_path: "timestamp",
      reason: "Primary time dimension for partitions and sequence analysis.",
    },
  ];

  for (const field of eventProfile.fields) {
    if (["event", "id", "timestamp"].includes(field.path)) {
      continue;
    }

    const name = toColumnName(field.path);
    columns.push({
      name,
      type: clickHouseTypeForField(
        field,
        standardColumns.has(field.path),
        eventProfile.row_count,
      ),
      source_path: field.path,
      reason: standardColumns.has(field.path)
        ? "Atlys common envelope field."
        : "Feature-specific field inferred from raw events.",
    });
  }

  columns.push({
    name: "raw_json",
    type: "String",
    source_path: null,
    reason: "Lossless raw payload for audit, replay, and schema evolution.",
  });
  columns.push({
    name: "ingested_at",
    type: "DateTime DEFAULT now()",
    source_path: null,
    reason: "Operational ingest timestamp.",
  });

  const columnNames = new Set(columns.map((column) => column.name));
  const nullableColumns = new Set(
    columns
      .filter((column) => column.type.startsWith("Nullable("))
      .map((column) => column.name),
  );
  const primaryEntityColumn = resolvePrimaryEntityColumn(
    manifest.primary_entity,
    columnNames,
  );

  const orderBy = [
    "event_name",
    "timestamp",
    primaryEntityColumn,
    "user_id",
    "event_id",
  ].filter(
    (column, index, all) =>
      all.indexOf(column) === index && !nullableColumns.has(column),
  );

  return {
    database: "silver",
    table_name: tableName,
    engine: "ReplacingMergeTree",
    partition_by: "toYYYYMM(timestamp)",
    order_by: orderBy,
    ttl: "timestamp + INTERVAL 18 MONTH",
    columns,
    materialized_views: buildMaterializedViewPlans(tableName, columns),
  };
}

function normalizeDesignDraft(
  draft: SchemaDesignDraft,
  fallbackPlan: SchemaPlan,
  eventProfile: EventProfile,
): SchemaPlan {
  const allowedSourcePaths = new Set(
    eventProfile.fields.map((field) => field.path),
  );
  const fallbackByName = new Map(
    fallbackPlan.columns.map((column) => [column.name, column]),
  );
  const columns: SchemaPlan["columns"] = [];
  const seenNames = new Set<string>();

  for (const draftColumn of draft.columns ?? []) {
    const name = toColumnName(draftColumn.name);
    if (!name || seenNames.has(name)) {
      continue;
    }
    const fallbackColumn = fallbackByName.get(name);
    const sourcePath = normalizeSourcePath(name, draftColumn.source_path);
    if (sourcePath && !allowedSourcePaths.has(sourcePath)) {
      continue;
    }
    if (!sourcePath && !isPipelineColumn(name)) {
      continue;
    }

    const field = sourcePath
      ? eventProfile.fields.find((candidate) => candidate.path === sourcePath)
      : null;
    const fallbackType =
      fallbackColumn?.type ?? typeForPipelineColumn(name) ?? "String";
    const type = sanitizeColumnType(
      draftColumn.type,
      fallbackType,
      field,
      eventProfile.row_count,
      name,
    );

    columns.push({
      name,
      type,
      source_path: sourcePath,
      reason:
        draftColumn.reason ||
        fallbackColumn?.reason ||
        "Selected by schema designer and validated against event evidence.",
    });
    seenNames.add(name);
  }

  const mergedColumns = mergeColumns(columns, fallbackPlan.columns);
  const columnNames = new Set(mergedColumns.map((column) => column.name));
  const nullableColumns = new Set(
    mergedColumns
      .filter((column) => column.type.startsWith("Nullable("))
      .map((column) => column.name),
  );
  const orderBy = (draft.order_by ?? []).filter(
    (column, index, all) =>
      columnNames.has(column) &&
      !nullableColumns.has(column) &&
      all.indexOf(column) === index,
  );

  const partitionBy =
    draft.partition_by === "toYYYYMM(timestamp)"
      ? draft.partition_by
      : fallbackPlan.partition_by;
  const ttl =
    draft.ttl && /^timestamp \+ INTERVAL \d+ MONTH$/.test(draft.ttl)
      ? draft.ttl
      : fallbackPlan.ttl;

  return repairSchemaPlan(
    {
      database: "silver",
      table_name:
        draft.table_name === fallbackPlan.table_name
          ? draft.table_name
          : fallbackPlan.table_name,
      engine:
        draft.engine === "ReplacingMergeTree"
          ? draft.engine
          : fallbackPlan.engine,
      partition_by: partitionBy,
      ttl,
      order_by: orderBy,
      columns: mergedColumns,
      materialized_views: buildMaterializedViewPlans(
        fallbackPlan.table_name,
        mergedColumns,
      ),
    },
    null,
    null,
  );
}

function normalizeSourcePath(columnName: string, sourcePath: string | null) {
  if (columnName === "event_name") {
    return "event";
  }
  if (columnName === "event_id") {
    return "id";
  }
  if (columnName === "timestamp") {
    return "timestamp";
  }
  return sourcePath;
}

function isPipelineColumn(columnName: string) {
  return ["job_id", "raw_json", "ingested_at"].includes(columnName);
}

function typeForPipelineColumn(columnName: string) {
  if (columnName === "job_id" || columnName === "raw_json") {
    return "String";
  }
  if (columnName === "ingested_at") {
    return "DateTime DEFAULT now()";
  }
  return null;
}

function sanitizeColumnType(
  requestedType: string,
  fallbackType: string,
  field: EventProfile["fields"][number] | null | undefined,
  totalRows: number,
  columnName: string,
) {
  const allowedTypes = new Set([
    "String",
    "LowCardinality(String)",
    "DateTime64(3)",
    "DateTime DEFAULT now()",
    "Bool",
    "UInt8",
    "UInt16",
    "UInt32",
    "UInt64",
    "Int64",
    "Float64",
    "Nullable(String)",
    "Nullable(Bool)",
    "Nullable(UInt8)",
    "Nullable(UInt16)",
    "Nullable(UInt32)",
    "Nullable(UInt64)",
    "Nullable(Int64)",
    "Nullable(Float64)",
  ]);
  if (!allowedTypes.has(requestedType)) {
    return fallbackType;
  }
  if (columnName === "timestamp") {
    return "DateTime64(3)";
  }
  if (columnName === "ingested_at") {
    return "DateTime DEFAULT now()";
  }
  const sourceIsNullable =
    field && (field.null_count > 0 || field.count < totalRows);
  if (sourceIsNullable && !requestedType.startsWith("Nullable(")) {
    return fallbackType.startsWith("Nullable(")
      ? fallbackType
      : `Nullable(${fallbackType.replace("LowCardinality(String)", "String")})`;
  }
  return requestedType;
}

function reviewSchemaPlan(
  plan: SchemaPlan,
  eventProfile: EventProfile,
): string[] {
  const issues: string[] = [];
  const columnNames = new Set(plan.columns.map((column) => column.name));
  const sourcePaths = new Set(
    plan.columns
      .map((column) => column.source_path)
      .filter((sourcePath): sourcePath is string => Boolean(sourcePath)),
  );
  const nullableColumns = new Set(
    plan.columns
      .filter((column) => column.type.startsWith("Nullable("))
      .map((column) => column.name),
  );

  for (const required of [
    "job_id",
    "event_name",
    "event_id",
    "timestamp",
    "raw_json",
  ]) {
    if (!columnNames.has(required)) {
      issues.push(`missing_required_column:${required}`);
    }
  }

  for (const column of plan.order_by) {
    if (!columnNames.has(column)) {
      issues.push(`order_by_unknown_column:${column}`);
    }
    if (nullableColumns.has(column)) {
      issues.push(`order_by_nullable_column:${column}`);
    }
  }

  if (!plan.order_by.includes("timestamp")) {
    issues.push("order_by_missing_timestamp");
  }
  if (!plan.order_by.includes("event_id")) {
    issues.push("order_by_missing_event_id");
  }

  for (const field of eventProfile.fields) {
    if (
      !["event", "id", "timestamp"].includes(field.path) &&
      !sourcePaths.has(field.path)
    ) {
      issues.push(`unmapped_raw_field:${field.path}`);
    }
  }

  return issues;
}

function repairSchemaPlan(
  plan: SchemaPlan,
  manifest: FeatureManifest | null,
  eventProfile: EventProfile | null,
): SchemaPlan {
  const baseline =
    manifest && eventProfile ? buildSchemaPlan(manifest, eventProfile) : plan;
  const columns = mergeColumns(plan.columns, baseline.columns);
  const columnNames = new Set(columns.map((column) => column.name));
  const nullableColumns = new Set(
    columns
      .filter((column) => column.type.startsWith("Nullable("))
      .map((column) => column.name),
  );
  const orderBy = plan.order_by.filter(
    (column, index, all) =>
      columnNames.has(column) &&
      !nullableColumns.has(column) &&
      all.indexOf(column) === index,
  );
  const repairedOrderBy =
    orderBy.includes("timestamp") && orderBy.includes("event_id")
      ? orderBy
      : baseline.order_by;

  return {
    ...plan,
    partition_by: plan.partition_by || baseline.partition_by,
    ttl: plan.ttl || baseline.ttl,
    order_by: repairedOrderBy,
    columns,
    materialized_views: buildMaterializedViewPlans(plan.table_name, columns),
  };
}

function mergeColumns(
  columns: SchemaPlan["columns"],
  baselineColumns: SchemaPlan["columns"],
) {
  const merged = [...columns];
  const names = new Set(merged.map((column) => column.name));
  for (const baselineColumn of baselineColumns) {
    if (!names.has(baselineColumn.name)) {
      merged.push(baselineColumn);
      names.add(baselineColumn.name);
    }
  }
  return merged;
}

function buildMaterializedViewPlans(
  tableName: string,
  columns: SchemaPlan["columns"],
): SchemaPlan["materialized_views"] {
  const columnNames = new Set(columns.map((column) => column.name));
  const dimensions = [
    "device_type",
    "geoip_country_code",
    "destination",
  ].filter((column) => columnNames.has(column));

  const targetTable = `${tableName}_daily_event_counts`;
  const viewName = `${targetTable}_mv`;
  const dimensionDefinitions =
    dimensions.length > 0
      ? `${dimensions.map((column) => `    ${column} String`).join(",\n")},\n`
      : "";
  const dimensionSelects =
    dimensions.length > 0
      ? `${dimensions
          .map((column) => `    toString(ifNull(${column}, '')) AS ${column}`)
          .join(",\n")},\n`
      : "";
  const dimensionGroupBy =
    dimensions.length > 0 ? `, ${dimensions.join(", ")}` : "";
  const orderBy = ["event_date", "event_name", ...dimensions].join(", ");

  return [
    {
      name: viewName,
      target_table: `gold.${targetTable}`,
      target_table_sql: `CREATE TABLE IF NOT EXISTS gold.${targetTable}
(
    event_date Date,
    event_name LowCardinality(String),
${dimensionDefinitions}    events UInt64,
    unique_users UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (${orderBy});`,
      view_sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS gold.${viewName}
TO gold.${targetTable}
AS
SELECT
    toDate(timestamp) AS event_date,
    event_name,
${dimensionSelects}    count() AS events,
    uniq(user_id) AS unique_users
FROM silver.${tableName}
GROUP BY event_date, event_name${dimensionGroupBy};`,
      purpose:
        "Reusable daily event and unique-user counts for PM-facing funnel and segment analysis.",
      dimensions,
      metrics: ["events", "unique_users"],
    },
  ];
}

function resolvePrimaryEntityColumn(
  primaryEntity: string,
  columnNames: Set<string>,
) {
  const normalized = toColumnName(primaryEntity);
  if (columnNames.has(normalized)) {
    return normalized;
  }

  const withId = `${normalized}_id`;
  if (columnNames.has(withId)) {
    return withId;
  }

  return columnNames.has("application_id") ? "application_id" : "user_id";
}

function renderCreateTableSql(plan: SchemaPlan): string {
  const columns = plan.columns
    .map((column) => `    ${column.name} ${column.type}`)
    .join(",\n");

  return `CREATE TABLE IF NOT EXISTS ${plan.database}.${plan.table_name}
(
${columns}
)
ENGINE = ${plan.engine}
PARTITION BY ${plan.partition_by}
ORDER BY (${plan.order_by.join(", ")})
TTL ${plan.ttl};
`;
}

function renderMaterializedViewsSql(plan: SchemaPlan): string {
  if (plan.materialized_views.length === 0) {
    return "-- No materialized views were required for this feature schema.\n";
  }

  return `${plan.materialized_views
    .map((view) => `${view.target_table_sql}\n\n${view.view_sql}`)
    .join("\n\n")}\n`;
}

function buildMappingPlan(plan: SchemaPlan): MappingPlan {
  return {
    table_name: `${plan.database}.${plan.table_name}`,
    mappings: plan.columns.map((column) => ({
      column: column.name,
      source_path: column.source_path,
      transform:
        column.name === "job_id"
          ? "set from pipeline job_id"
          : column.name === "raw_json"
            ? "serialize original event JSON"
            : column.name === "timestamp"
              ? "parse ISO timestamp to DateTime64(3)"
              : column.name === "ingested_at"
                ? "ClickHouse DEFAULT now()"
                : "copy from raw JSON path with nullable cast",
    })),
  };
}

function clickHouseTypeForField(
  field: EventProfile["fields"][number],
  isStandard: boolean,
  totalRows: number,
): string {
  const types = field.types.filter((type) => type !== "null");
  const nullable = field.null_count > 0 || field.count < totalRows;
  const wrap = (type: string) => {
    if (!nullable) {
      return type;
    }
    if (type === "LowCardinality(String)") {
      return "Nullable(String)";
    }
    return `Nullable(${type})`;
  };

  if (field.path.endsWith("_id") || field.path === "id") {
    return wrap("String");
  }

  if (field.path === "is_back_filled" || field.path.startsWith("is_")) {
    return wrap("UInt8");
  }

  if (types.length === 1 && types[0] === "boolean") {
    return wrap("Bool");
  }

  if (types.length === 1 && types[0] === "number") {
    const samples = field.sample_values.filter(
      (sample): sample is number => typeof sample === "number",
    );
    if (/(amount|value|rate|price|revenue|currency_value)/i.test(field.path)) {
      return wrap("Float64");
    }
    if (/(latency|duration|time_on_page)/i.test(field.path)) {
      return wrap("UInt32");
    }
    const integerOnly = samples.every((sample) => Number.isInteger(sample));
    return wrap(integerOnly ? integerTypeForSamples(samples) : "Float64");
  }

  if (field.path === "timestamp") {
    return "DateTime64(3)";
  }

  const baseString =
    isStandard || field.sample_values.length <= 50
      ? "LowCardinality(String)"
      : "String";
  return wrap(baseString);
}

function integerTypeForSamples(samples: number[]) {
  const max = Math.max(...samples, 0);
  const min = Math.min(...samples, 0);
  if (min >= 0 && max <= 255) {
    return "UInt8";
  }
  if (min >= 0 && max <= 65535) {
    return "UInt16";
  }
  if (min >= 0 && max <= 4294967295) {
    return "UInt32";
  }
  return "Int64";
}
