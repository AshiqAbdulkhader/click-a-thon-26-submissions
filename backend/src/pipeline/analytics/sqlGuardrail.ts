import { startActiveObservation } from "@langfuse/tracing";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { GeneratedSqlQuery, SqlGuardrailResult } from "./types.js";
import {
  getClickHouseColumns,
  getKnownClickHouseTables,
  stripSqlFormatting,
} from "./utils.js";

const FORBIDDEN_SQL =
  /\b(insert|update|delete|drop|alter|create|truncate|optimize|grant|revoke|attach|detach|rename)\b/i;

export async function runSqlGuardrail(input: {
  jobId: string;
  queries: GeneratedSqlQuery[];
  artifactRoot: string;
}): Promise<Array<GeneratedSqlQuery & { guardrail: SqlGuardrailResult }>> {
  const event = analyticsTrackingEvents.sqlGuardrail;
  return startActiveObservation(event.stageId, async (span) => {
    const knownTables = new Set(await getKnownClickHouseTables());
    const guarded = await Promise.all(
      input.queries.map(async (query) => {
        const repairedSql = repairSql(query.sql);
        const warnings = validateSql(repairedSql, knownTables);
        const referencedTables = Array.from(knownTables).filter((table) =>
          repairedSql.includes(table),
        );
        const columns = await getClickHouseColumns(referencedTables);
        const missingColumnWarnings = findLikelyMissingColumns(
          repairedSql,
          columns,
          referencedTables,
        );
        return {
          ...query,
          sql: repairedSql,
          guardrail: {
            passed: warnings.length === 0,
            repaired_sql: repairedSql,
            warnings: [...warnings, ...missingColumnWarnings],
          },
        };
      }),
    );

    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "sql_guardrail.json",
      {
        queries: guarded,
      },
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: guarded.every((query) => query.guardrail.passed)
        ? "completed"
        : "failed",
      stageInput: { query_count: input.queries.length },
      stageOutput: { queries: guarded },
    });
    span.update({ output: { queries: guarded } });
    return guarded;
  });
}

function repairSql(sql: string) {
  let repaired = stripSqlFormatting(sql);
  repaired = repaired.replace(/\bFORMAT\s+\w+\s*$/i, "").trim();
  if (!/\blimit\b/i.test(repaired) && !/\bcount\s*\(/i.test(repaired)) {
    repaired = `${repaired}\nLIMIT 100`;
  }
  return repaired;
}

function validateSql(sql: string, knownTables: Set<string>) {
  const warnings: string[] = [];
  const normalized = sql.trim();
  if (!/^(\s*with|\s*select)\b/i.test(normalized)) {
    warnings.push("SQL must start with SELECT or WITH.");
  }
  if (FORBIDDEN_SQL.test(normalized)) {
    warnings.push(
      "SQL contains a forbidden mutating or administrative keyword.",
    );
  }
  const hasKnownTable = Array.from(knownTables).some((table) =>
    normalized.includes(table),
  );
  if (!hasKnownTable && /\bfrom\s+system\./i.test(normalized)) {
    return warnings;
  }
  if (!hasKnownTable && /\bfrom\b/i.test(normalized)) {
    warnings.push("SQL does not reference a known silver/gold/context table.");
  }
  return warnings;
}

function findLikelyMissingColumns(
  sql: string,
  columns: Array<{ table_name: string; column_name: string; type: string }>,
  referencedTables: string[],
) {
  if (referencedTables.length === 0 || columns.length === 0) {
    return [];
  }
  const knownColumns = new Set(columns.map((column) => column.column_name));
  const likelyIdentifiers = Array.from(
    sql.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g),
  )
    .map((match) => match[1])
    .filter(
      (word) =>
        ![
          "select",
          "from",
          "where",
          "group",
          "by",
          "order",
          "limit",
          "as",
          "and",
          "or",
          "with",
          "count",
          "uniq",
          "uniqExact",
          "sum",
          "avg",
          "min",
          "max",
          "toDate",
          "toStartOfDay",
          "desc",
          "asc",
          "case",
          "when",
          "then",
          "else",
          "end",
          "if",
          "null",
          "silver",
          "gold",
          "context",
          "system",
          "tables",
        ].includes(word),
    );
  const missing = likelyIdentifiers.filter(
    (word) =>
      !knownColumns.has(word) &&
      !referencedTables.some((table) => table.endsWith(`.${word}`)) &&
      !/^\d+$/.test(word),
  );
  return Array.from(new Set(missing))
    .slice(0, 8)
    .map((column) => `Identifier may not be a known column: ${column}`);
}
