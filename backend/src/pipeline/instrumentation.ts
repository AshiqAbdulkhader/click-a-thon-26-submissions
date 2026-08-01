import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { callGroqJson } from "./groq.js";
import {
  ContextBundle,
  GeneratedContextRegistry,
  updateGeneratedContext,
} from "./context.js";

type FieldProfile = {
  path: string;
  count: number;
  null_count: number;
  types: string[];
  sample_values: unknown[];
};

export type EventProfile = {
  feature_slug: string;
  row_count: number;
  event_counts: Record<string, number>;
  event_order: string[];
  fields: FieldProfile[];
};

type FeatureManifest = {
  feature_slug: string;
  feature_name: string;
  primary_entity: string;
  workflow_type:
    | "funnel"
    | "revenue_addon"
    | "referral_loop"
    | "recovery"
    | "generic";
  event_order: string[];
  success_event: string | null;
  metric_hints: string[];
  context_notes: string[];
};

type SchemaPlan = {
  database: "silver";
  table_name: string;
  engine: string;
  partition_by: string;
  order_by: string[];
  ttl: string;
  columns: Array<{
    name: string;
    type: string;
    source_path: string | null;
    reason: string;
  }>;
};

type MappingPlan = {
  table_name: string;
  mappings: Array<{
    column: string;
    source_path: string | null;
    transform: string;
  }>;
};

export async function runInstrumentationAgent(input: {
  repoRoot: string;
  specFolder: string;
  jobId: string;
  artifactRoot: string;
  context: ContextBundle;
}) {
  const specPath = path.join(input.specFolder, "spec.md");
  const eventsPath = path.join(input.specFolder, "events.ndjson");
  const [specMarkdown, eventsNdjson] = await Promise.all([
    readFile(specPath, "utf8"),
    readFile(eventsPath, "utf8"),
  ]);

  const featureSlug = normalizeFeatureSlug(path.basename(input.specFolder));

  await writeStageJson(
    input.artifactRoot,
    "01_bronze_ingest",
    "bronze_report.json",
    {
      job_id: input.jobId,
      feature_slug: featureSlug,
      spec_path: specPath,
      events_path: eventsPath,
      spec_bytes: Buffer.byteLength(specMarkdown),
      events_bytes: Buffer.byteLength(eventsNdjson),
      ingested_at: new Date().toISOString(),
    },
  );

  const rawEvents = parseNdjson(eventsNdjson);
  const eventProfile = profileEvents(featureSlug, rawEvents);
  await writeStageJson(
    input.artifactRoot,
    "02_event_profiler",
    "event_profile.json",
    eventProfile,
  );

  const manifest =
    (await buildManifestWithGroq({
      featureSlug,
      specMarkdown,
      eventProfile,
      context: input.context,
    })) ?? buildFallbackManifest(featureSlug, specMarkdown, eventProfile);

  await writeStageJson(
    input.artifactRoot,
    "03_spec_parser",
    "feature_manifest.json",
    manifest,
  );

  const schemaPlan = buildSchemaPlan(manifest, eventProfile);
  const schemaSql = renderCreateTableSql(schemaPlan);
  const mappingPlan = buildMappingPlan(schemaPlan);

  await writeStageJson(
    input.artifactRoot,
    "04_schema_generator",
    "schema_plan.json",
    schemaPlan,
  );
  await writeStageText(
    input.artifactRoot,
    "04_schema_generator",
    "schema.sql",
    schemaSql,
  );
  await writeStageJson(
    input.artifactRoot,
    "04_schema_generator",
    "mapping.json",
    mappingPlan,
  );

  const schemaReview = reviewSchema(schemaPlan, eventProfile, manifest);
  await writeStageText(
    input.artifactRoot,
    "05_schema_critic",
    "schema_review.md",
    schemaReview,
  );

  const updatedContext = await updateGeneratedContext({
    repoRoot: input.repoRoot,
    feature_slug: featureSlug,
    table_name: schemaPlan.table_name,
    primary_entity: manifest.primary_entity,
    event_names: manifest.event_order,
    success_event: manifest.success_event,
    metric_hints: manifest.metric_hints,
  });

  await writeStageText(
    input.artifactRoot,
    "07_context_agent",
    "context_diff.md",
    renderContextDiff(manifest, schemaPlan, updatedContext),
  );
  await writeStageJson(
    input.artifactRoot,
    "07_context_agent",
    "updated_context.json",
    updatedContext,
  );

  return {
    featureSlug,
    eventProfile,
    manifest,
    schemaPlan,
    schemaSql,
    mappingPlan,
  };
}

function parseNdjson(ndjson: string): Record<string, unknown>[] {
  return ndjson
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch (error) {
        throw new Error(`Invalid JSON on NDJSON line ${index + 1}: ${error}`);
      }
    });
}

function profileEvents(
  featureSlug: string,
  events: Record<string, unknown>[],
): EventProfile {
  const eventCounts: Record<string, number> = {};
  const fieldMap = new Map<string, FieldProfile>();

  for (const event of events) {
    const eventName = String(event.event ?? "unknown_event");
    eventCounts[eventName] = (eventCounts[eventName] ?? 0) + 1;

    for (const [fieldPath, value] of flattenObject(event)) {
      const existing =
        fieldMap.get(fieldPath) ??
        ({
          path: fieldPath,
          count: 0,
          null_count: 0,
          types: [],
          sample_values: [],
        } satisfies FieldProfile);

      existing.count += 1;
      if (value === null || value === undefined || value === "") {
        existing.null_count += 1;
      }

      const type = inferJsonType(value);
      if (!existing.types.includes(type)) {
        existing.types.push(type);
      }
      if (
        existing.sample_values.length < 5 &&
        value !== null &&
        value !== undefined &&
        value !== "" &&
        !existing.sample_values.includes(value)
      ) {
        existing.sample_values.push(value);
      }
      fieldMap.set(fieldPath, existing);
    }
  }

  return {
    feature_slug: featureSlug,
    row_count: events.length,
    event_counts: eventCounts,
    event_order: Object.keys(eventCounts),
    fields: [...fieldMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function buildManifestWithGroq(input: {
  featureSlug: string;
  specMarkdown: string;
  eventProfile: EventProfile;
  context: ContextBundle;
}): Promise<FeatureManifest | null> {
  const compactContext = {
    generated_context: input.context.generatedContext,
    instrumentation_notes_excerpt: input.context.instrumentationNotes.slice(
      0,
      5000,
    ),
    existing_ddl_excerpt: input.context.existingDdl.slice(0, 8000),
    base_context_excerpt: input.context.baseContext.slice(0, 8000),
  };

  try {
    return await callGroqJson<FeatureManifest>({
      messages: [
        {
          role: "system",
          content:
            "You are an instrumentation agent for ClickHouse analytics. Return only valid JSON. Choose schema-relevant product semantics from the spec and context.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Create a feature manifest for schema generation. Use the event profile and Atlys context. Pick the primary entity, workflow type, ordered events, success event, metric hints, and context notes.",
            allowed_workflow_types: [
              "funnel",
              "revenue_addon",
              "referral_loop",
              "recovery",
              "generic",
            ],
            required_shape: {
              feature_slug: "string",
              feature_name: "string",
              primary_entity: "string",
              workflow_type:
                "funnel | revenue_addon | referral_loop | recovery | generic",
              event_order: ["event_name"],
              success_event: "event_name or null",
              metric_hints: ["metric names/questions"],
              context_notes: ["short notes"],
            },
            feature_slug: input.featureSlug,
            spec_markdown: input.specMarkdown,
            event_profile: input.eventProfile,
            context: compactContext,
          }),
        },
      ],
    });
  } catch (error) {
    console.warn(`Groq manifest generation failed; using fallback: ${error}`);
    return null;
  }
}

function buildFallbackManifest(
  featureSlug: string,
  specMarkdown: string,
  eventProfile: EventProfile,
): FeatureManifest {
  const title = specMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? featureSlug;
  const eventOrder = extractSpecEventOrder(
    specMarkdown,
    eventProfile.event_order,
  );
  const eventText = eventOrder.join(" ");
  const primaryEntity = eventProfile.fields.some(
    (field) => field.path === "share_id",
  )
    ? "share_id"
    : eventProfile.fields.some((field) => field.path === "group_id")
      ? "group_id"
      : "application_id";

  const workflowType: FeatureManifest["workflow_type"] =
    eventText.includes("forex") || specMarkdown.toLowerCase().includes("aov")
      ? "revenue_addon"
      : eventText.includes("share") || eventText.includes("recipient")
        ? "referral_loop"
        : eventText.includes("reminder") || eventText.includes("reconvert")
          ? "recovery"
          : "funnel";

  return {
    feature_slug: featureSlug,
    feature_name: title.replace(/^Feature spec\s+[—-]\s+/i, ""),
    primary_entity: primaryEntity,
    workflow_type: workflowType,
    event_order: eventOrder,
    success_event: eventOrder.at(-1) ?? null,
    metric_hints: inferMetricHints(workflowType, eventOrder),
    context_notes: [
      "Generated by deterministic fallback because GROQ_API_KEY was not available or Groq returned no JSON.",
      "Use existing Atlys envelope fields and avoid all-string schemas.",
    ],
  };
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

  const orderBy = [
    "event_name",
    "timestamp",
    manifest.primary_entity === "application_id"
      ? "application_id"
      : toColumnName(manifest.primary_entity),
    "user_id",
    "event_id",
  ].filter((column, index, all) => all.indexOf(column) === index);

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

function reviewSchema(
  schemaPlan: SchemaPlan,
  eventProfile: EventProfile,
  manifest: FeatureManifest,
): string {
  const columnNames = new Set(schemaPlan.columns.map((column) => column.name));
  const warnings: string[] = [];

  for (const required of ["event_name", "event_id", "timestamp", "user_id"]) {
    if (!columnNames.has(required)) {
      warnings.push(`Missing required analytical column: ${required}.`);
    }
  }

  if (!schemaPlan.order_by.includes("timestamp")) {
    warnings.push(
      "ORDER BY should include timestamp for time-window analytics.",
    );
  }

  if (
    !schemaPlan.columns.some((column) => column.type.includes("LowCardinality"))
  ) {
    warnings.push(
      "No LowCardinality columns detected for repeated dimensions.",
    );
  }

  const nestedFields = eventProfile.fields.filter((field) =>
    field.path.includes("."),
  );
  if (nestedFields.length > 0) {
    const flattened = nestedFields.every((field) =>
      columnNames.has(toColumnName(field.path)),
    );
    if (!flattened) {
      warnings.push(
        "Some nested fields were not flattened into analytical columns.",
      );
    }
  }

  return `# Schema Review

## Verdict

${warnings.length === 0 ? "Pass for v0 instrumentation." : "Needs attention before production."}

## What this schema optimizes for

- Feature workflow: \`${manifest.workflow_type}\`
- Primary entity: \`${manifest.primary_entity}\`
- Success event: \`${manifest.success_event ?? "none"}\`
- Partitioning: \`${schemaPlan.partition_by}\`
- Ordering key: \`(${schemaPlan.order_by.join(", ")})\`

## Checks

${warnings.length === 0 ? "- No blocking issues found." : warnings.map((warning) => `- ${warning}`).join("\n")}

## Notes

- Raw payload is preserved in \`raw_json\` for replay and hidden-spec debugging.
- \`${schemaPlan.engine}\` is used so repeated \`event_id\` values can collapse during merges.
- TTL is set to \`${schemaPlan.ttl}\`; adjust if judges ask for longer retention.
`;
}

function renderContextDiff(
  manifest: FeatureManifest,
  schemaPlan: SchemaPlan,
  registry: GeneratedContextRegistry,
): string {
  return `# Context Diff

## Added Feature

- Feature: ${manifest.feature_name}
- Slug: \`${manifest.feature_slug}\`
- Table: \`silver.${schemaPlan.table_name}\`
- Primary entity: \`${manifest.primary_entity}\`
- Workflow type: \`${manifest.workflow_type}\`
- Events: ${manifest.event_order.map((event) => `\`${event}\``).join(" -> ")}
- Success event: \`${manifest.success_event ?? "none"}\`

## Metric Hints

${manifest.metric_hints.map((metric) => `- ${metric}`).join("\n")}

## Context Notes

${manifest.context_notes.map((note) => `- ${note}`).join("\n")}

## Registry Status

- Known generated features: ${registry.features.length}
- Known context contradictions: ${registry.contradictions.length}
`;
}

function flattenObject(
  value: Record<string, unknown>,
  prefix = "",
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (
      child &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      !(child instanceof Date)
    ) {
      entries.push(
        ...flattenObject(child as Record<string, unknown>, childPath),
      );
    } else {
      entries.push([childPath, child]);
    }
  }
  return entries;
}

function inferJsonType(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function clickHouseTypeForField(
  field: FieldProfile,
  isStandard: boolean,
  totalRows: number,
): string {
  const types = field.types.filter((type) => type !== "null");
  const nullable = field.null_count > 0 || field.count < totalRows;
  const wrap = (type: string) => (nullable ? `Nullable(${type})` : type);

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

function extractSpecEventOrder(specMarkdown: string, fallback: string[]) {
  const matches = [...specMarkdown.matchAll(/-\s+`([^`]+)`\s+[—-]/g)].map(
    (match) => match[1],
  );
  return matches.length > 0 ? matches : fallback;
}

function inferMetricHints(
  workflowType: FeatureManifest["workflow_type"],
  eventOrder: string[],
) {
  const start = eventOrder[0] ?? "first_event";
  const end = eventOrder.at(-1) ?? "success_event";
  if (workflowType === "revenue_addon") {
    return ["attach_rate", "aov_uplift", "dropoff_by_step", "destination_mix"];
  }
  if (workflowType === "referral_loop") {
    return [
      "share_rate",
      "channel_mix",
      "new_user_open_rate",
      "recipient_cta_rate",
    ];
  }
  if (workflowType === "recovery") {
    return ["reconversion_rate", "channel_recovery_rate", "timing_effect"];
  }
  return [
    `${start}_to_${end}_conversion`,
    "step_through_rate",
    "segment_comparison",
  ];
}

function toColumnName(fieldPath: string) {
  if (fieldPath === "event") {
    return "event_name";
  }
  if (fieldPath === "id") {
    return "event_id";
  }
  return fieldPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizeFeatureSlug(folderName: string) {
  return folderName.replace(/^\d+_/, "").replace(/[^a-zA-Z0-9]+/g, "_");
}

async function writeStageJson(
  artifactRoot: string,
  stage: string,
  filename: string,
  value: unknown,
) {
  await writeStageText(
    artifactRoot,
    stage,
    filename,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function writeStageText(
  artifactRoot: string,
  stage: string,
  filename: string,
  value: string,
) {
  const dir = path.join(artifactRoot, stage);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), value);
}
