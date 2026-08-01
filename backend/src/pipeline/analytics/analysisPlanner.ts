import { startActiveObservation } from "@langfuse/tracing";
import { callGroqJson } from "../groq.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { AnalysisPlan, PmRelevantContext, QueryIntent } from "./types.js";
import { compactJson, unique } from "./utils.js";

export async function runAnalysisPlanner(input: {
  jobId: string;
  question: string;
  intent: QueryIntent;
  context: PmRelevantContext;
  artifactRoot: string;
  repairNotes?: string[];
}): Promise<AnalysisPlan> {
  const event = analyticsTrackingEvents.analysisPlanner;
  return startActiveObservation(event.stageId, async (span) => {
    span.update({
      input: {
        question: input.question,
        intent: input.intent,
        repair_notes: input.repairNotes ?? [],
      },
      metadata: { agent: "analytics_planner" },
    });

    const llmPlan = await callGroqJson<AnalysisPlan>({
      traceName: "groq.analytics.analysis_plan",
      temperature: 0.1,
      maxTokens: 2200,
      traceInput: {
        question: input.question,
        context_features: input.context.features.map(
          (feature) => feature.feature_slug,
        ),
        repair_notes: input.repairNotes ?? [],
      },
      messages: [
        {
          role: "system",
          content:
            "You are an analytics planning agent. Produce a compact JSON analysis plan. Do not write SQL yet.",
        },
        {
          role: "user",
          content: `Question:
${input.question}

Intent:
${compactJson(input.intent)}

Relevant context:
${compactJson(input.context, 18000)}

Prior repair notes:
${compactJson(input.repairNotes ?? [])}

Return JSON with this shape:
{
  "interpreted_question": string,
  "answer_type": "metric_lookup" | "trend" | "funnel" | "root_cause" | "segment_comparison" | "latency" | "data_quality" | "schema_explanation" | "open_ended",
  "tables": string[],
  "joins": [{"left_table": string, "left_column": string, "right_table": string, "right_column": string, "reason": string}],
  "queries": [{"id": string, "purpose": string, "sql_intent": string, "expected_columns": string[], "priority": "required" | "nice_to_have"}],
  "evidence_standard": {"needs_comparison": boolean, "needs_segment_cut": boolean, "min_rows": number, "can_answer_if_empty": boolean},
  "assumptions": string[],
  "risks": string[]
}

Plan 1-5 ClickHouse queries. Prefer reusable context metrics and tables. Include data quality or baseline queries when the PM asks why, worse, drop, increase, or root cause.`,
        },
      ],
    });

    const plan = repairPlan(llmPlan, input);
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "analysis_plan.json",
      plan,
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: { question: input.question },
      stageOutput: plan,
    });
    span.update({ output: plan });
    return plan;
  });
}

function repairPlan(
  plan: AnalysisPlan | null,
  input: {
    question: string;
    intent: QueryIntent;
    context: PmRelevantContext;
  },
): AnalysisPlan {
  const fallback = fallbackPlan(input);
  if (!plan) {
    return fallback;
  }

  const tables = unique([
    ...(plan.tables ?? []),
    ...fallback.tables.slice(0, plan.tables?.length ? 0 : 1),
  ]).filter(Boolean);

  const queries = (plan.queries ?? [])
    .filter((query) => query.id && query.purpose && query.sql_intent)
    .slice(0, 6);

  return {
    interpreted_question:
      plan.interpreted_question || fallback.interpreted_question,
    answer_type: plan.answer_type || fallback.answer_type,
    tables,
    joins: (plan.joins ?? []).slice(0, 8),
    queries: queries.length > 0 ? queries : fallback.queries,
    evidence_standard: {
      needs_comparison:
        plan.evidence_standard?.needs_comparison ??
        fallback.evidence_standard.needs_comparison,
      needs_segment_cut:
        plan.evidence_standard?.needs_segment_cut ??
        fallback.evidence_standard.needs_segment_cut,
      min_rows:
        Number(plan.evidence_standard?.min_rows) ||
        fallback.evidence_standard.min_rows,
      can_answer_if_empty:
        plan.evidence_standard?.can_answer_if_empty ??
        fallback.evidence_standard.can_answer_if_empty,
    },
    assumptions: plan.assumptions ?? fallback.assumptions,
    risks: plan.risks ?? fallback.risks,
  };
}

function fallbackPlan(input: {
  question: string;
  intent: QueryIntent;
  context: PmRelevantContext;
}): AnalysisPlan {
  const table =
    input.context.features[0]?.table_name ??
    input.context.workflows[0]?.table_name ??
    "silver.unknown";
  const answerType = input.intent.requested_analyses[0] ?? "open_ended";
  return {
    interpreted_question: input.question,
    answer_type: answerType,
    tables: table === "silver.unknown" ? [] : [table],
    joins: [],
    queries: [
      {
        id: "q1_overview",
        purpose:
          "Get a compact overview of available event volume and event names.",
        sql_intent:
          table === "silver.unknown"
            ? "List relevant silver tables and their approximate row counts."
            : `Summarize row counts by event_name from ${table}.`,
        expected_columns: ["event_name", "rows"],
        priority: "required",
      },
    ],
    evidence_standard: {
      needs_comparison: ["root_cause", "trend", "segment_comparison"].includes(
        answerType,
      ),
      needs_segment_cut: ["root_cause", "segment_comparison"].includes(
        answerType,
      ),
      min_rows: 1,
      can_answer_if_empty: answerType === "schema_explanation",
    },
    assumptions: [
      "Fallback plan used because the LLM planner was unavailable or incomplete.",
    ],
    risks: [
      "The answer may need follow-up queries if the first overview is too broad.",
    ],
  };
}
