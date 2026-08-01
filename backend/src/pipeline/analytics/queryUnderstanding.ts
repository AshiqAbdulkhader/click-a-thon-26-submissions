import { startActiveObservation } from "@langfuse/tracing";
import { callGroqJson } from "../groq.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { QueryIntent } from "./types.js";
import { normalizeTokens, unique } from "./utils.js";

export async function runQueryUnderstanding(input: {
  jobId: string;
  question: string;
  artifactRoot: string;
}): Promise<QueryIntent> {
  const event = analyticsTrackingEvents.queryUnderstanding;
  return startActiveObservation(event.stageId, async (span) => {
    span.update({
      input: { question: input.question },
      metadata: { agent: "analytics_query_understanding" },
    });

    const llmIntent = await callGroqJson<QueryIntent>({
      traceName: "groq.analytics.query_intent",
      temperature: 0,
      maxTokens: 1200,
      traceInput: { question: input.question },
      messages: [
        {
          role: "system",
          content:
            "You parse product-manager analytics questions. Return strict JSON only. Do not answer the question.",
        },
        {
          role: "user",
          content: `Parse this PM analytics question into:
{
  "original_question": string,
  "normalized_question": string,
  "feature_hints": string[],
  "metric_hints": string[],
  "table_hints": string[],
  "segment_hints": string[],
  "time_hints": string[],
  "requested_analyses": string[],
  "ambiguity_notes": string[]
}

Allowed requested_analyses values: metric_lookup, trend, funnel, root_cause, segment_comparison, latency, data_quality, schema_explanation, open_ended.

Question: ${input.question}`,
        },
      ],
    });

    const intent = repairIntent(llmIntent, input.question);
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "intent.json",
      intent,
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: { question: input.question },
      stageOutput: intent,
    });
    span.update({ output: intent });
    return intent;
  });
}

function repairIntent(
  intent: QueryIntent | null,
  question: string,
): QueryIntent {
  const fallback = deterministicIntent(question);
  if (!intent) {
    return fallback;
  }

  return {
    original_question: question,
    normalized_question:
      intent.normalized_question || fallback.normalized_question,
    feature_hints: unique([
      ...(intent.feature_hints ?? []),
      ...fallback.feature_hints,
    ]),
    metric_hints: unique([
      ...(intent.metric_hints ?? []),
      ...fallback.metric_hints,
    ]),
    table_hints: unique([
      ...(intent.table_hints ?? []),
      ...fallback.table_hints,
    ]),
    segment_hints: unique([
      ...(intent.segment_hints ?? []),
      ...fallback.segment_hints,
    ]),
    time_hints: unique([...(intent.time_hints ?? []), ...fallback.time_hints]),
    requested_analyses:
      intent.requested_analyses?.length > 0
        ? unique(intent.requested_analyses)
        : fallback.requested_analyses,
    ambiguity_notes: intent.ambiguity_notes ?? fallback.ambiguity_notes,
  };
}

function deterministicIntent(question: string): QueryIntent {
  const tokens = normalizeTokens(question);
  const has = (...values: string[]) =>
    values.some((value) => tokens.has(value));
  const requested_analyses: QueryIntent["requested_analyses"] = [];

  if (has("why", "drop", "dropped", "worse", "root", "cause")) {
    requested_analyses.push("root_cause");
  }
  if (has("funnel", "conversion", "complete", "completion", "dropoff")) {
    requested_analyses.push("funnel");
  }
  if (has("ios", "android", "mobile", "country", "geo", "device", "segment")) {
    requested_analyses.push("segment_comparison");
  }
  if (has("trend", "over", "daily", "weekly", "yesterday", "today")) {
    requested_analyses.push("trend");
  }
  if (has("slow", "latency", "time", "duration")) {
    requested_analyses.push("latency");
  }
  if (has("schema", "table", "column", "event")) {
    requested_analyses.push("schema_explanation");
  }
  if (requested_analyses.length === 0) {
    requested_analyses.push("open_ended");
  }

  return {
    original_question: question,
    normalized_question: question.trim().toLowerCase(),
    feature_hints: Array.from(tokens).filter((token) =>
      [
        "checkout",
        "express",
        "family",
        "forex",
        "status",
        "abandoned",
      ].includes(token),
    ),
    metric_hints: Array.from(tokens).filter((token) =>
      [
        "conversion",
        "completion",
        "dropoff",
        "revenue",
        "latency",
        "success",
        "failure",
      ].includes(token),
    ),
    table_hints: Array.from(tokens).filter((token) =>
      token.includes("_events"),
    ),
    segment_hints: Array.from(tokens).filter((token) =>
      ["ios", "android", "mobile", "web", "country", "device", "geo"].includes(
        token,
      ),
    ),
    time_hints: Array.from(tokens).filter((token) =>
      ["today", "yesterday", "daily", "weekly", "month", "latest"].includes(
        token,
      ),
    ),
    requested_analyses,
    ambiguity_notes: [],
  };
}
