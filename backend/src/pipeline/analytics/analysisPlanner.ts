import { startActiveObservation } from "@langfuse/tracing";
import { callGroqJson } from "../groq.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { BASE_FUNNEL_TABLES, qualifyFeatureTable } from "../warehouseTables.js";
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

Plan 1-5 ClickHouse queries. Prefer reusable context metrics and tables. Include data quality or baseline queries when the PM asks why, worse, drop, increase, or root cause.
Always use exact table names from context (silver.<feature>_events for generated features; bare base table names for the 8 existing funnel/support tables).
Do not plan queries against information_schema, metrics, feature_metrics, or other metadata tables unless they appear explicitly in relevant context.
When comparing a feature to overall conversion, join feature silver tables to purchase_completed / application_started on user_id or application_id.
If contradictions mention known issues (e.g. K1 iOS OTP), plan a device/os segment cut to check them.`,
        },
      ],
    });

    validatePlan(llmPlan);
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
  plan: AnalysisPlan,
  input: {
    question: string;
    intent: QueryIntent;
    context: PmRelevantContext;
  },
): AnalysisPlan {
  const fallback = fallbackPlan(input);
  const tables = unique(
    [...(plan.tables ?? []), ...fallback.tables]
      .filter(Boolean)
      .map((table) => qualifyFeatureTable(table)),
  );

  const joins = uniqueJoins([
    ...(plan.joins ?? []),
    ...fallback.joins,
    ...input.context.joins.slice(0, 8).map((join) => ({
      left_table: qualifyFeatureTable(join.left_table),
      left_column: join.left_column,
      right_table: qualifyFeatureTable(join.right_table),
      right_column: join.right_column,
      reason: `Context join (${join.grain}, confidence ${join.confidence})`,
    })),
  ]).slice(0, 12);

  const queries = (plan.queries ?? [])
    .filter((query) => query.id && query.purpose && query.sql_intent)
    .slice(0, 6);
  if (queries.length === 0) {
    throw new Error("Groq analysis planner returned no usable queries.");
  }

  return {
    interpreted_question:
      plan.interpreted_question || fallback.interpreted_question,
    answer_type: plan.answer_type || fallback.answer_type,
    tables,
    joins,
    queries,
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
    assumptions: plan.assumptions,
    risks: plan.risks,
  };
}

function validatePlan(plan: AnalysisPlan) {
  if (
    !plan ||
    !plan.interpreted_question ||
    !plan.answer_type ||
    !Array.isArray(plan.tables) ||
    !Array.isArray(plan.joins) ||
    !Array.isArray(plan.queries) ||
    !plan.evidence_standard ||
    !Array.isArray(plan.assumptions) ||
    !Array.isArray(plan.risks)
  ) {
    throw new Error("Groq analysis planner returned an unusable plan.");
  }
}

function fallbackPlan(input: {
  question: string;
  intent: QueryIntent;
  context: PmRelevantContext;
}): AnalysisPlan {
  const featureTable = input.context.features[0]
    ? qualifyFeatureTable(input.context.features[0].table_name)
    : null;
  const workflowTable = input.context.workflows.find(
    (workflow) => !workflow.table_name.includes("|"),
  )?.table_name;
  const table = featureTable
    ? featureTable
    : workflowTable
      ? qualifyFeatureTable(workflowTable)
      : null;
  const answerType = input.intent.requested_analyses[0] ?? "open_ended";
  const tables = unique(
    [table, ...BASE_FUNNEL_TABLES].filter((value): value is string =>
      Boolean(value),
    ),
  );

  const joins =
    table && table.startsWith("silver.")
      ? [
          {
            left_table: table,
            left_column: "user_id",
            right_table: "purchase_completed",
            right_column: "user_id",
            reason:
              "Feature vs baseline conversion join on user_id for uplift/context.",
          },
          {
            left_table: table,
            left_column: "application_id",
            right_table: "application_started",
            right_column: "application_id",
            reason: "Application-level join into the base funnel.",
          },
        ]
      : [];

  return {
    interpreted_question: input.question,
    answer_type: answerType,
    tables,
    joins,
    queries: [
      {
        id: "q1_overview",
        purpose: table
          ? "Get a compact overview of feature event volume and event names."
          : "Get base funnel stage volumes for context.",
        sql_intent: table
          ? `Summarize row counts by event_name from ${table}.`
          : "Count distinct users at each base funnel stage.",
        expected_columns: table ? ["event_name", "rows"] : ["stage", "users"],
        priority: "required",
      },
      {
        id: "q2_baseline",
        purpose: "Base conversion funnel baseline for comparison.",
        sql_intent:
          "Count distinct users on destination_card_clicked, application_started, document_uploaded, purchase_completed.",
        expected_columns: ["stage", "users"],
        priority: "nice_to_have",
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
      ...(input.context.retrieval_notes.some((note) =>
        note.startsWith("WARNING"),
      )
        ? [
            "Context retrieval reported warnings; feature-specific tables may be missing from memory.",
          ]
        : []),
    ],
    risks: [
      "The answer may need follow-up queries if the first overview is too broad.",
      ...input.context.retrieval_notes.filter((note) =>
        note.startsWith("WARNING"),
      ),
    ],
  };
}

function uniqueJoins(joins: AnalysisPlan["joins"]): AnalysisPlan["joins"] {
  const seen = new Set<string>();
  return joins.filter((join) => {
    if (
      !join.left_table ||
      !join.right_table ||
      join.left_table.includes("*") ||
      join.right_table.includes("*") ||
      join.left_table.includes("|") ||
      join.right_table.includes("|")
    ) {
      return false;
    }
    const key = [
      join.left_table,
      join.left_column,
      join.right_table,
      join.right_column,
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
