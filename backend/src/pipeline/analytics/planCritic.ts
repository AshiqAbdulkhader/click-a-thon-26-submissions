import { startActiveObservation } from "@langfuse/tracing";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { AnalysisPlan, PmRelevantContext } from "./types.js";

export async function runPlanCritic(input: {
  jobId: string;
  plan: AnalysisPlan;
  context: PmRelevantContext;
  artifactRoot: string;
}): Promise<{ passed: boolean; warnings: string[]; plan: AnalysisPlan }> {
  const event = analyticsTrackingEvents.planCritic;
  return startActiveObservation(event.stageId, async (span) => {
    const warnings: string[] = [];
    const knownTables = new Set([
      ...input.context.features.map((feature) => feature.table_name),
      ...input.context.workflows.map((workflow) => workflow.table_name),
      ...input.context.columns.map((column) => column.table_name),
    ]);
    const repairedPlan: AnalysisPlan = {
      ...input.plan,
      queries: input.plan.queries.slice(0, 6),
    };

    if (repairedPlan.queries.length === 0) {
      warnings.push("Plan does not contain any queries.");
    }
    if (
      repairedPlan.tables.length > 0 &&
      repairedPlan.tables.every((table) => !knownTables.has(table))
    ) {
      warnings.push("Plan tables are not present in retrieved context.");
    }
    if (
      repairedPlan.evidence_standard.needs_comparison &&
      repairedPlan.queries.length < 2
    ) {
      warnings.push(
        "Question appears comparative/root-cause but plan has only one query.",
      );
    }

    const result = {
      passed: repairedPlan.queries.length > 0,
      warnings,
      plan: repairedPlan,
    };
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "plan_review.json",
      result,
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: result.passed ? "completed" : "failed",
      stageInput: { plan: input.plan },
      stageOutput: result,
    });
    span.update({ output: result });
    return result;
  });
}
