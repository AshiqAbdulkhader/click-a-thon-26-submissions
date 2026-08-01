import { startActiveObservation } from "@langfuse/tracing";
import { sqlString } from "../clickhouse.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import {
  AnalysisPlan,
  GeneratedSqlQuery,
  PmRelevantContext,
  QueryIntent,
} from "./types.js";
import { unique } from "./utils.js";

type TableShape = {
  table: string;
  columns: Set<string>;
  workflow?: PmRelevantContext["workflows"][number];
};

export async function runAnalyticsPrimitives(input: {
  jobId: string;
  intent: QueryIntent;
  context: PmRelevantContext;
  plan: AnalysisPlan;
  artifactRoot: string;
}): Promise<GeneratedSqlQuery[]> {
  const event = analyticsTrackingEvents.analyticsPrimitives;
  return startActiveObservation(event.stageId, async (span) => {
    const queries = buildPrimitiveQueries(input);
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "primitive_queries.json",
      {
        queries,
      },
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: {
        requested_analyses: input.intent.requested_analyses,
        plan_tables: input.plan.tables,
      },
      stageOutput: {
        query_count: queries.length,
        query_ids: queries.map((query) => query.id),
      },
    });
    span.update({ output: { query_count: queries.length, queries } });
    return queries;
  });
}

function buildPrimitiveQueries(input: {
  intent: QueryIntent;
  context: PmRelevantContext;
  plan: AnalysisPlan;
}) {
  const shapes = resolveTableShapes(input.context, input.plan);
  const queries: GeneratedSqlQuery[] = [];
  const requested = new Set([
    ...input.intent.requested_analyses,
    input.plan.answer_type,
  ]);

  for (const shape of shapes.slice(0, 3)) {
    if (hasCoreEventColumns(shape)) {
      queries.push(eventOverview(shape));
    }
    if (hasCoreEventColumns(shape) && hasEntity(shape)) {
      queries.push(dataQuality(shape));
    }
    if (
      requested.has("trend") ||
      requested.has("root_cause") ||
      requested.has("open_ended")
    ) {
      if (hasCoreEventColumns(shape)) {
        queries.push(trendScan(shape));
        queries.push(anomalyScan(shape));
      }
    }
    if (
      requested.has("funnel") ||
      requested.has("root_cause") ||
      requested.has("open_ended")
    ) {
      if (hasCoreEventColumns(shape) && hasEntity(shape)) {
        queries.push(funnelBreakdown(shape));
      }
    }
    if (
      requested.has("segment_comparison") ||
      requested.has("root_cause") ||
      requested.has("open_ended")
    ) {
      const segment = pickSegmentColumn(shape);
      if (segment && hasCoreEventColumns(shape) && hasEntity(shape)) {
        queries.push(segmentComparison(shape, segment));
      }
    }
    if (requested.has("latency") || requested.has("open_ended")) {
      const latencyColumn = pickColumn(shape, [
        "latency",
        "duration",
        "time_on_page",
        "processing_time",
      ]);
      if (latencyColumn && hasCoreEventColumns(shape)) {
        queries.push(latencyDistribution(shape, latencyColumn));
      }
    }
    if (requested.has("open_ended") || requested.has("root_cause")) {
      const numericPair = pickNumericPair(input.context, shape);
      if (numericPair) {
        queries.push(correlationScan(shape, numericPair[0], numericPair[1]));
      }
    }
  }

  const seen = new Set<string>();
  return queries.filter((query) => {
    if (seen.has(query.id)) {
      return false;
    }
    seen.add(query.id);
    return true;
  });
}

function resolveTableShapes(
  context: PmRelevantContext,
  plan: AnalysisPlan,
): TableShape[] {
  const tables = unique([
    ...plan.tables,
    ...context.features.map((feature) => feature.table_name),
    ...context.workflows.map((workflow) => workflow.table_name),
  ]).filter(Boolean);

  return tables.map((table) => ({
    table,
    columns: new Set(
      context.columns
        .filter((column) => column.table_name === table)
        .map((column) => column.column_name),
    ),
    workflow: context.workflows.find(
      (workflow) => workflow.table_name === table,
    ),
  }));
}

function hasCoreEventColumns(shape: TableShape) {
  return shape.columns.has("event_name") && shape.columns.has("timestamp");
}

function hasEntity(shape: TableShape) {
  return Boolean(pickEntityColumn(shape));
}

function pickEntityColumn(shape: TableShape) {
  const preferred = [
    shape.workflow?.primary_entity_column,
    "application_id",
    "user_id",
    "app_session_id",
  ].filter((value): value is string => Boolean(value));
  return preferred.find((column) => shape.columns.has(column));
}

function pickSegmentColumn(shape: TableShape) {
  const preferred = [
    ...(shape.workflow?.segment_columns ?? []),
    "device_type",
    "device",
    "os",
    "geoip_country_code",
    "geoip_subdivision_1_code",
    "country",
    "destination",
    "citizenship",
    "city",
  ];
  return preferred.find((column) => shape.columns.has(column));
}

function pickColumn(shape: TableShape, fragments: string[]) {
  return Array.from(shape.columns).find((column) =>
    fragments.some((fragment) => column.includes(fragment)),
  );
}

function pickNumericPair(context: PmRelevantContext, shape: TableShape) {
  const numeric = context.columns
    .filter(
      (column) =>
        column.table_name === shape.table &&
        /(UInt|Int|Float|Decimal)/.test(column.clickhouse_type) &&
        !["job_id", "event_id"].includes(column.column_name),
    )
    .map((column) => column.column_name)
    .filter((column) => shape.columns.has(column));
  return numeric.length >= 2 ? ([numeric[0], numeric[1]] as const) : null;
}

function idFor(prefix: string, table: string) {
  return `${prefix}_${table.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

function eventOverview(shape: TableShape): GeneratedSqlQuery {
  return {
    id: idFor("primitive_event_overview", shape.table),
    purpose: "Show event volume by event name as a broad feature overview.",
    sql_intent: "Count rows by event_name.",
    expected_columns: ["event_name", "rows"],
    priority: "nice_to_have",
    sql: `
SELECT event_name, count() AS rows
FROM ${shape.table}
GROUP BY event_name
ORDER BY rows DESC
LIMIT 100`,
  };
}

function dataQuality(shape: TableShape): GeneratedSqlQuery {
  const entity = pickEntityColumn(shape) ?? "user_id";
  return {
    id: idFor("primitive_data_quality", shape.table),
    purpose:
      "Check basic data quality for event, timestamp, id, and entity coverage.",
    sql_intent:
      "Return row counts, entity coverage, event id uniqueness, and time range.",
    expected_columns: [
      "rows",
      "unique_events",
      "unique_entities",
      "missing_entities",
      "first_seen",
      "last_seen",
    ],
    priority: "nice_to_have",
    sql: `
SELECT
  count() AS rows,
  uniqExact(event_name) AS unique_events,
  uniqExact(${entity}) AS unique_entities,
  countIf(${entity} = '') AS missing_entities,
  uniqExact(event_id) AS unique_event_ids,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen
FROM ${shape.table}`,
  };
}

function trendScan(shape: TableShape): GeneratedSqlQuery {
  return {
    id: idFor("primitive_trend", shape.table),
    purpose: "Show daily event trend by event name.",
    sql_intent: "Count events by day and event_name.",
    expected_columns: ["day", "event_name", "rows"],
    priority: "nice_to_have",
    sql: `
SELECT
  toDate(timestamp) AS day,
  event_name,
  count() AS rows
FROM ${shape.table}
GROUP BY day, event_name
ORDER BY day DESC, rows DESC
LIMIT 200`,
  };
}

function anomalyScan(shape: TableShape): GeneratedSqlQuery {
  return {
    id: idFor("primitive_anomaly", shape.table),
    purpose:
      "Find days whose event volume differs most from the table average.",
    sql_intent:
      "Compute daily event counts with a simple z-score over available days.",
    expected_columns: ["day", "rows", "baseline_avg", "z_score"],
    priority: "nice_to_have",
    sql: `
WITH daily AS (
  SELECT toDate(timestamp) AS day, count() AS rows
  FROM ${shape.table}
  GROUP BY day
)
SELECT
  day,
  rows,
  avg(rows) OVER () AS baseline_avg,
  stddevPop(rows) OVER () AS baseline_std,
  if(stddevPop(rows) OVER () = 0, 0, (rows - avg(rows) OVER ()) / stddevPop(rows) OVER ()) AS z_score
FROM daily
ORDER BY abs(z_score) DESC
LIMIT 30`,
  };
}

function funnelBreakdown(shape: TableShape): GeneratedSqlQuery {
  const entity = pickEntityColumn(shape) ?? "user_id";
  const success = shape.workflow?.success_event;
  return {
    id: idFor("primitive_funnel", shape.table),
    purpose: "Show entity-level funnel reach by event name.",
    sql_intent:
      "Count unique entities reaching each event; include success-event flag when known.",
    expected_columns: [
      "event_name",
      "entities",
      "event_rows",
      "is_success_event",
    ],
    priority: "required",
    sql: `
SELECT
  event_name,
  uniqExact(${entity}) AS entities,
  count() AS event_rows,
  ${success ? `event_name = ${sqlString(success)}` : "0"} AS is_success_event
FROM ${shape.table}
GROUP BY event_name
ORDER BY entities DESC
LIMIT 100`,
  };
}

function segmentComparison(
  shape: TableShape,
  segment: string,
): GeneratedSqlQuery {
  const entity = pickEntityColumn(shape) ?? "user_id";
  const success = shape.workflow?.success_event;
  const successExpr = success
    ? `uniqExactIf(${entity}, event_name = ${sqlString(success)})`
    : "0";
  return {
    id: idFor(`primitive_segment_${segment}`, shape.table),
    purpose: `Compare coverage and success by ${segment}.`,
    sql_intent: `Compute entity volume and success rate by ${segment}.`,
    expected_columns: [segment, "entities", "success_entities", "success_rate"],
    priority: "required",
    sql: `
SELECT
  ${segment},
  uniqExact(${entity}) AS entities,
  ${successExpr} AS success_entities,
  if(uniqExact(${entity}) = 0, 0, success_entities / uniqExact(${entity})) AS success_rate
FROM ${shape.table}
GROUP BY ${segment}
ORDER BY entities DESC
LIMIT 100`,
  };
}

function latencyDistribution(
  shape: TableShape,
  latencyColumn: string,
): GeneratedSqlQuery {
  return {
    id: idFor(`primitive_latency_${latencyColumn}`, shape.table),
    purpose: `Summarize latency distribution for ${latencyColumn}.`,
    sql_intent: `Compute p50/p90/p95 latency by event_name for ${latencyColumn}.`,
    expected_columns: ["event_name", "p50", "p90", "p95"],
    priority: "nice_to_have",
    sql: `
SELECT
  event_name,
  quantileExact(0.5)(${latencyColumn}) AS p50,
  quantileExact(0.9)(${latencyColumn}) AS p90,
  quantileExact(0.95)(${latencyColumn}) AS p95,
  count() AS rows
FROM ${shape.table}
WHERE ${latencyColumn} IS NOT NULL
GROUP BY event_name
ORDER BY p95 DESC
LIMIT 100`,
  };
}

function correlationScan(
  shape: TableShape,
  left: string,
  right: string,
): GeneratedSqlQuery {
  return {
    id: idFor(`primitive_correlation_${left}_${right}`, shape.table),
    purpose: `Check simple correlation between ${left} and ${right}.`,
    sql_intent: `Compute Pearson correlation for two numeric columns.`,
    expected_columns: ["correlation", "rows"],
    priority: "nice_to_have",
    sql: `
SELECT
  corr(toFloat64(${left}), toFloat64(${right})) AS correlation,
  count() AS rows
FROM ${shape.table}
WHERE ${left} IS NOT NULL AND ${right} IS NOT NULL`,
  };
}
