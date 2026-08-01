import { SchemaPlan } from "../types.js";

export function buildMaterializedViewPlans(
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
