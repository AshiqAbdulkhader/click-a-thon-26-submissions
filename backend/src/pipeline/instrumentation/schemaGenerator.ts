import path from "node:path";
import { startActiveObservation } from "@langfuse/tracing";
import { recordPipelineStage } from "../tracking.js";
import { writeStageJson, writeStageText } from "./artifacts.js";
import { toColumnName } from "./eventUtils.js";
import { instrumentationStageConfig } from "./stageConfig.js";
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
  artifactRoot: string;
}) {
  const stage = instrumentationStageConfig.schemaGenerator;

  return startActiveObservation(stage.id, async (span) => {
    span.update({
      input: {
        feature_slug: input.featureSlug,
        workflow_type: input.manifest.workflow_type,
        primary_entity: input.manifest.primary_entity,
        field_count: input.eventProfile.fields.length,
      },
      metadata: {
        agent: stage.agent,
        target_layer: "silver",
      },
    });

    const schemaPlan = buildSchemaPlan(input.manifest, input.eventProfile);
    const schemaSql = renderCreateTableSql(schemaPlan);
    const mappingPlan = buildMappingPlan(schemaPlan);

    await writeStageJson(
      input.artifactRoot,
      stage.id,
      "schema_plan.json",
      schemaPlan,
    );
    await writeStageText(input.artifactRoot, stage.id, "schema.sql", schemaSql);
    await writeStageJson(
      input.artifactRoot,
      stage.id,
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
        artifacts: [
          path.join(input.artifactRoot, stage.id, "schema_plan.json"),
          path.join(input.artifactRoot, stage.id, "schema.sql"),
          path.join(input.artifactRoot, stage.id, "mapping.json"),
        ],
      },
    });

    await recordPipelineStage({
      jobId: input.jobId,
      stageId: stage.id,
      stageName: stage.name,
      status: "completed",
      stageInput: {
        feature_slug: input.featureSlug,
        workflow_type: input.manifest.workflow_type,
        primary_entity: input.manifest.primary_entity,
      },
      stageOutput: {
        table: `silver.${schemaPlan.table_name}`,
        engine: schemaPlan.engine,
        partition_by: schemaPlan.partition_by,
        order_by: schemaPlan.order_by,
        column_count: schemaPlan.columns.length,
      },
    });

    return { schemaPlan, schemaSql, mappingPlan };
  });
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
  };
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
