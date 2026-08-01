import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startActiveObservation } from "@langfuse/tracing";
import { loadContextBundle } from "../context.js";
import { recordPipelineRun } from "../tracking.js";
import { shutdownLangfuse, startLangfuse } from "../../tracing/langfuse.js";
import { runAnalysisPlanner } from "./analysisPlanner.js";
import { retrievePmContext } from "./contextRetriever.js";
import { runEvidenceCritic } from "./evidenceCritic.js";
import { runInsightSynthesizer } from "./insightSynthesizer.js";
import { runPlanCritic } from "./planCritic.js";
import { runAnalyticsPrimitives } from "./primitives.js";
import { runQueryExecutor } from "./queryExecutor.js";
import { runQueryUnderstanding } from "./queryUnderstanding.js";
import { runResultEvaluator } from "./resultEvaluator.js";
import { runSqlGenerator } from "./sqlGenerator.js";
import { runSqlGuardrail } from "./sqlGuardrail.js";
import { EvidencePack, FinalAnalyticsAnswer } from "./types.js";

const MAX_ANALYTICS_ATTEMPTS = 2;

export async function runAnalyticsAsk(input: {
  question: string;
  repoRoot?: string;
}): Promise<FinalAnalyticsAnswer> {
  startLangfuse();

  const repoRoot = input.repoRoot ?? path.resolve(process.cwd(), "..");
  const jobId = createAskJobId(input.question);
  const featureSlug = "pm_query";
  const startedAt = new Date().toISOString();
  const artifactRoot = path.join(repoRoot, "backend", "artifacts", jobId);
  await mkdir(artifactRoot, { recursive: true });

  let traceId = "";
  try {
    const answer = await startActiveObservation(
      "schema-kings.analytics_ask",
      async (rootSpan) => {
        traceId = rootSpan.traceId;
        rootSpan.update({
          input: {
            question: input.question,
            artifact_root: artifactRoot,
          },
          metadata: {
            pipeline: "pm-question-to-clickhouse-insight",
            environment: process.env.NODE_ENV ?? "local",
            model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
          },
        });

        await recordPipelineRun({
          jobId,
          featureSlug,
          specFolder: "ask",
          status: "started",
          traceId,
          startedAt,
          summary: { question: input.question },
        });

        const context = await loadContextBundle(repoRoot);
        const intent = await runQueryUnderstanding({
          jobId,
          question: input.question,
          artifactRoot,
        });
        const pmContext = await retrievePmContext({
          jobId,
          question: input.question,
          intent,
          context,
          artifactRoot,
        });

        let repairNotes: string[] = [];
        let evidencePack: EvidencePack | null = null;

        for (let attempt = 1; attempt <= MAX_ANALYTICS_ATTEMPTS; attempt += 1) {
          const plan = await runAnalysisPlanner({
            jobId,
            question: input.question,
            intent,
            context: pmContext,
            artifactRoot,
            repairNotes,
          });
          const planReview = await runPlanCritic({
            jobId,
            plan,
            context: pmContext,
            artifactRoot,
          });
          if (!planReview.passed) {
            repairNotes = planReview.warnings;
            if (attempt < MAX_ANALYTICS_ATTEMPTS) {
              continue;
            }
          }

          const sqlQueries = await runSqlGenerator({
            jobId,
            question: input.question,
            intent,
            context: pmContext,
            plan: planReview.plan,
            artifactRoot,
            executionFeedback: repairNotes,
          });
          const primitiveQueries = await runAnalyticsPrimitives({
            jobId,
            intent,
            context: pmContext,
            plan: planReview.plan,
            artifactRoot,
          });
          const guardedQueries = await runSqlGuardrail({
            jobId,
            queries: mergeQueries(sqlQueries, primitiveQueries),
            artifactRoot,
          });
          const executed = await runQueryExecutor({
            jobId,
            queries: guardedQueries,
            artifactRoot,
          });
          const evaluation = await runResultEvaluator({
            jobId,
            plan: planReview.plan,
            results: executed.results,
            executionErrors: executed.errors,
            artifactRoot,
          });

          evidencePack = {
            question: input.question,
            intent,
            context: pmContext,
            plan: planReview.plan,
            query_results: executed.results,
            evaluation,
          };

          if (!evaluation.needs_repair || attempt >= MAX_ANALYTICS_ATTEMPTS) {
            break;
          }
          repairNotes = [
            ...evaluation.repair_notes,
            ...evaluation.evidence_gaps,
            ...guardedQueries.flatMap((query) =>
              query.guardrail.warnings.map(
                (warning) => `${query.id}: ${warning}`,
              ),
            ),
          ];
        }

        if (!evidencePack) {
          throw new Error("Analytics ask loop ended without an evidence pack.");
        }

        const draft = await runInsightSynthesizer({
          jobId,
          evidencePack,
          artifactRoot,
        });
        const finalAnswer = await runEvidenceCritic({
          jobId,
          draft,
          evidencePack,
          artifactRoot,
          traceId,
        });

        const runSummary = {
          job_id: jobId,
          question: input.question,
          answer: finalAnswer.short_answer,
          artifact_root: artifactRoot,
          langfuse_trace_id: traceId,
          evidence_queries: evidencePack.query_results.map((result) => ({
            query_id: result.query_id,
            row_count: result.row_count,
          })),
        };
        await writeFile(
          path.join(artifactRoot, "ask_summary.json"),
          `${JSON.stringify(runSummary, null, 2)}\n`,
        );
        await recordPipelineRun({
          jobId,
          featureSlug,
          specFolder: "ask",
          status: "completed",
          traceId,
          startedAt,
          completedAt: new Date().toISOString(),
          summary: runSummary,
        });

        rootSpan.update({ output: runSummary });
        return finalAnswer;
      },
    );

    return answer;
  } catch (error) {
    await recordPipelineRun({
      jobId,
      featureSlug,
      specFolder: "ask",
      status: "failed",
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      summary: {
        question: input.question,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  } finally {
    await shutdownLangfuse();
  }
}

function createAskJobId(question: string) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "");
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return `${timestamp}_ask_${slug || "question"}`;
}

function mergeQueries<T extends { id: string }>(primary: T[], secondary: T[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((query) => {
    if (seen.has(query.id)) {
      return false;
    }
    seen.add(query.id);
    return true;
  });
}
