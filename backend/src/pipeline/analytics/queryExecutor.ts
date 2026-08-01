import { startActiveObservation } from "@langfuse/tracing";
import { queryClickHouseText } from "../clickhouse.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { GeneratedSqlQuery, QueryResult, SqlGuardrailResult } from "./types.js";

export async function runQueryExecutor(input: {
  jobId: string;
  queries: Array<GeneratedSqlQuery & { guardrail: SqlGuardrailResult }>;
  artifactRoot: string;
}): Promise<{ results: QueryResult[]; errors: string[] }> {
  const event = analyticsTrackingEvents.queryExecutor;
  return startActiveObservation(event.stageId, async (span) => {
    const results: QueryResult[] = [];
    const errors: string[] = [];

    for (const query of input.queries) {
      if (!query.guardrail.passed) {
        errors.push(
          `${query.id}: blocked by SQL guardrail: ${query.guardrail.warnings.join("; ")}`,
        );
        continue;
      }

      try {
        const sql = `${query.guardrail.repaired_sql}\nFORMAT JSON`;
        const raw = await queryClickHouseText(sql);
        const parsed = JSON.parse(raw) as {
          data?: Record<string, unknown>[];
          rows?: number;
          statistics?: Record<string, unknown>;
        };
        results.push({
          query_id: query.id,
          purpose: query.purpose,
          sql: query.guardrail.repaired_sql,
          rows: parsed.data ?? [],
          row_count: parsed.rows ?? parsed.data?.length ?? 0,
          statistics: parsed.statistics,
        });
      } catch (error) {
        errors.push(
          `${query.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const output = { results, errors };
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "query_results.json",
      output,
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: errors.length === 0 ? "completed" : "failed",
      stageInput: { queries: input.queries },
      stageOutput: {
        result_count: results.length,
        errors,
      },
    });
    span.update({ output });
    return output;
  });
}
