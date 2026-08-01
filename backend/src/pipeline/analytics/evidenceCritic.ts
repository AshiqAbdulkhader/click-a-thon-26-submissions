import { startActiveObservation } from "@langfuse/tracing";
import {
  writeStageJson,
  writeStageText,
} from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import {
  EvidencePack,
  FinalAnalyticsAnswer,
  InsightDraft,
  QueryResult,
} from "./types.js";
import { renderDraftMarkdown } from "./insightSynthesizer.js";

export async function runEvidenceCritic(input: {
  jobId: string;
  draft: InsightDraft;
  evidencePack: EvidencePack;
  artifactRoot: string;
  traceId: string;
}): Promise<FinalAnalyticsAnswer> {
  const event = analyticsTrackingEvents.evidenceCritic;
  return startActiveObservation(event.stageId, async (span) => {
    const queryIds = new Set(
      input.evidencePack.query_results.map((result) => result.query_id),
    );
    const criticNotes: string[] = [];
    const evidence = input.draft.evidence.filter((claim) => {
      if (!queryIds.has(claim.query_id)) {
        criticNotes.push(
          `Removed unsupported claim with unknown query id: ${claim.claim}`,
        );
        return false;
      }
      return true;
    });

    const caveats = [...input.draft.caveats];
    if (!input.evidencePack.evaluation.passed) {
      caveats.push(
        "Evidence quality checks found gaps; treat this answer as directional until follow-up queries pass.",
      );
      criticNotes.push(...input.evidencePack.evaluation.evidence_gaps);
    }

    if (evidence.length === 0 && input.evidencePack.query_results.length > 0) {
      criticNotes.push(
        "No explicit evidence claims survived; added query-result caveat.",
      );
      caveats.push(summarizeQueryResults(input.evidencePack.query_results));
    }

    const finalAnswer: FinalAnalyticsAnswer = {
      ...input.draft,
      evidence,
      caveats,
      critic_notes: criticNotes,
      artifact_root: input.artifactRoot,
      trace_id: input.traceId,
    };

    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "final_answer.json",
      finalAnswer,
    );
    await writeStageText(
      input.artifactRoot,
      event.stageId,
      "final_answer.md",
      renderDraftMarkdown(finalAnswer),
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: { draft: input.draft },
      stageOutput: finalAnswer,
    });
    span.update({ output: finalAnswer });
    return finalAnswer;
  });
}

function summarizeQueryResults(results: QueryResult[]) {
  return results
    .map((result) => `${result.query_id}: ${result.row_count} rows`)
    .join("; ");
}
