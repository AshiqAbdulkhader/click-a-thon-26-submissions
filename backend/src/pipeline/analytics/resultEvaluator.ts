import { startActiveObservation } from "@langfuse/tracing";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { AnalysisPlan, QueryResult, ResultEvaluation } from "./types.js";

export async function runResultEvaluator(input: {
  jobId: string;
  plan: AnalysisPlan;
  results: QueryResult[];
  executionErrors: string[];
  artifactRoot: string;
}): Promise<ResultEvaluation> {
  const event = analyticsTrackingEvents.resultEvaluator;
  return startActiveObservation(event.stageId, async (span) => {
    const evidenceGaps: string[] = [];
    const repairNotes: string[] = [...input.executionErrors];
    const requiredQueries = new Set(
      input.plan.queries
        .filter((query) => query.priority === "required")
        .map((query) => query.id),
    );
    const successfulQueries = new Set(
      input.results.map((result) => result.query_id),
    );

    for (const queryId of requiredQueries) {
      if (!successfulQueries.has(queryId)) {
        evidenceGaps.push(
          `Required query did not produce a result: ${queryId}`,
        );
      }
    }

    const totalRows = input.results.reduce(
      (sum, result) => sum + result.row_count,
      0,
    );
    if (totalRows < input.plan.evidence_standard.min_rows) {
      evidenceGaps.push(
        `Result rows (${totalRows}) below evidence minimum (${input.plan.evidence_standard.min_rows}).`,
      );
    }

    if (totalRows === 0 && !input.plan.evidence_standard.can_answer_if_empty) {
      repairNotes.push(
        "Queries returned no rows. Broaden time filters, verify table/column names, or run schema discovery.",
      );
    }

    if (
      input.plan.evidence_standard.needs_comparison &&
      input.results.length < 2
    ) {
      evidenceGaps.push(
        "Question needs comparison evidence but fewer than two result sets were produced.",
      );
      repairNotes.push(
        "Add a baseline, segment, or before/after comparison query.",
      );
    }

    const evaluation: ResultEvaluation = {
      passed: evidenceGaps.length === 0 && input.executionErrors.length === 0,
      needs_repair: repairNotes.length > 0 || evidenceGaps.length > 0,
      repair_notes: repairNotes,
      evidence_gaps: evidenceGaps,
    };

    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "result_evaluation.json",
      evaluation,
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: evaluation.passed ? "completed" : "failed",
      stageInput: {
        result_count: input.results.length,
        execution_errors: input.executionErrors,
      },
      stageOutput: evaluation,
    });
    span.update({ output: evaluation });
    return evaluation;
  });
}
