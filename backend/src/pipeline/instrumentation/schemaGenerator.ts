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

type SchemaDesignSuggestion = {
  order_by?: string[];
  partition_by?: string;
  ttl?: string;
  column_type_overrides?: Array<{
    column: string;
    type: string;
    reason: string;
  }>;
  materialized_view_recommendations?: Array<{
    purpose: string;
    dimensions?: string[];
    metrics?: string[];
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
  let schemaPlan = buildSchemaPlan(input.manifest, input.eventProfile);
  const suggestion = await requestSchemaDesignSuggestion(input);

  if (suggestion) {
    schemaPlan = applyDesignSuggestion(
      schemaPlan,
      suggestion,
      input.eventProfile,
    );
    iterations.push({
      iteration: 1,
      actor: "schema_designer",
      summary:
        "LLM schema designer proposed ClickHouse strategy updates from spec, profile, and context.",
      issues: suggestion.rationale ?? [],
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
    mode: suggestion ? "llm_assisted" : "deterministic_only",
    iterations,
    final_plan: schemaPlan,
  };
}

async function requestSchemaDesignSuggestion(input: {
  featureSlug: string;
  manifest: FeatureManifest;
  eventProfile: EventProfile;
  context: ContextBundle;
}): Promise<SchemaDesignSuggestion | null> {
  try {
    return await callGroqJson<SchemaDesignSuggestion>({
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
            "You are a ClickHouse instrumentation schema designer. Return only JSON. Suggest schema strategy changes, but do not invent raw fields.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Review the deterministic draft inputs and suggest only safe ClickHouse schema strategy improvements.",
            allowed_shape: {
              order_by: ["existing_column_name"],
              partition_by:
                "ClickHouse partition expression, usually toYYYYMM(timestamp)",
              ttl: "ClickHouse TTL expression",
              column_type_overrides: [
                {
                  column: "existing_column_name",
                  type: "ClickHouse type",
                  reason: "why this type is better",
                },
              ],
              materialized_view_recommendations: [
                {
                  purpose: "aggregation purpose",
                  dimensions: ["existing_column_name"],
                  metrics: ["count | success_count | entity_count"],
                },
              ],
              rationale: ["short reasoning bullets"],
            },
            constraints: [
              "Use only columns present in the event profile after flattening.",
              "ORDER BY columns must be non-nullable.",
              "Keep raw_json for replay.",
              "Prefer LowCardinality(String) for repeated dimensions.",
              "Suggest materialized views only for reusable aggregates.",
            ],
            feature_manifest: input.manifest,
            event_profile: input.eventProfile,
            generated_context: input.context.generatedContext,
            base_context_excerpt: input.context.baseContext.slice(0, 6000),
          }),
        },
      ],
    });
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

function applyDesignSuggestion(
  plan: SchemaPlan,
  suggestion: SchemaDesignSuggestion,
  eventProfile: EventProfile,
): SchemaPlan {
  const columns = plan.columns.map((column) => ({ ...column }));
  const columnNames = new Set(columns.map((column) => column.name));
  const nullableColumns = new Set(
    columns
      .filter((column) => column.type.startsWith("Nullable("))
      .map((column) => column.name),
  );

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

  for (const override of suggestion.column_type_overrides ?? []) {
    if (!columnNames.has(override.column) || !allowedTypes.has(override.type)) {
      continue;
    }
    const column = columns.find(
      (candidate) => candidate.name === override.column,
    );
    const field = eventProfile.fields.find(
      (candidate) => column?.source_path === candidate.path,
    );
    const sourceIsNullable =
      field && (field.null_count > 0 || field.count < eventProfile.row_count);
    if (sourceIsNullable && !override.type.startsWith("Nullable(")) {
      continue;
    }
    if (
      column &&
      column.name !== "timestamp" &&
      column.name !== "ingested_at"
    ) {
      column.type = override.type;
      column.reason = `${column.reason} Schema designer override: ${override.reason}`;
    }
  }

  const suggestedOrderBy = (suggestion.order_by ?? []).filter(
    (column, index, all) =>
      columnNames.has(column) &&
      !nullableColumns.has(column) &&
      all.indexOf(column) === index,
  );
  const orderBy =
    suggestedOrderBy.includes("timestamp") &&
    suggestedOrderBy.includes("event_id")
      ? suggestedOrderBy
      : plan.order_by;

  const partitionBy =
    suggestion.partition_by === "toYYYYMM(timestamp)"
      ? suggestion.partition_by
      : plan.partition_by;
  const ttl =
    suggestion.ttl && /^timestamp \+ INTERVAL \d+ MONTH$/.test(suggestion.ttl)
      ? suggestion.ttl
      : plan.ttl;

  return repairSchemaPlan(
    {
      ...plan,
      partition_by: partitionBy,
      ttl,
      order_by: orderBy,
      columns,
      materialized_views: buildMaterializedViewPlans(plan.table_name, columns),
    },
    null,
    null,
  );
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
