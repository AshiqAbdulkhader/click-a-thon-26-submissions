import { startActiveObservation } from "@langfuse/tracing";
import { callGroqJson } from "../groq.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import {
  AnalysisPlan,
  GeneratedSqlQuery,
  PmRelevantContext,
  QueryIntent,
} from "./types.js";
import { compactJson } from "./utils.js";

export async function runSqlGenerator(input: {
  jobId: string;
  question: string;
  intent: QueryIntent;
  context: PmRelevantContext;
  plan: AnalysisPlan;
  artifactRoot: string;
  executionFeedback?: string[];
}): Promise<GeneratedSqlQuery[]> {
  const event = analyticsTrackingEvents.sqlGenerator;
  return startActiveObservation(event.stageId, async (span) => {
    span.update({
      input: {
        question: input.question,
        plan: input.plan,
        execution_feedback: input.executionFeedback ?? [],
      },
      metadata: { agent: "analytics_sql_generator" },
    });

    const llmQueries = await callGroqJson<{ queries: GeneratedSqlQuery[] }>({
      traceName: "groq.analytics.sql_generator",
      temperature: 0,
      maxTokens: 3000,
      traceInput: {
        question: input.question,
        query_count: input.plan.queries.length,
        execution_feedback: input.executionFeedback ?? [],
      },
      messages: [
        {
          role: "system",
          content:
            "You generate ClickHouse SELECT SQL for analytics. Return JSON only. SQL must be read-only and must not include FORMAT or semicolons.",
        },
        {
          role: "user",
          content: `Question:
${input.question}

Intent:
${compactJson(input.intent)}

Plan:
${compactJson(input.plan)}

Relevant context:
${compactJson(input.context, 20000)}

Prior execution feedback:
${compactJson(input.executionFeedback ?? [])}

Return:
{
  "queries": [
    {
      "id": string,
      "purpose": string,
      "sql_intent": string,
      "expected_columns": string[],
      "priority": "required" | "nice_to_have",
      "sql": string
    }
  ]
}

Rules:
- Only SELECT/WITH queries.
- Prefer exact table and column names from context.
- Use ClickHouse syntax.
- Limit exploratory result sets to at most 100 rows.
- For root-cause questions, include comparison/baseline and segment cuts when available.
- Do not invent causal language in SQL comments; do not include comments.`,
        },
      ],
    });

    const generated = repairGeneratedQueries(
      llmQueries?.queries ?? [],
      input.plan,
    );
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "sql_queries.json",
      {
        queries: generated,
      },
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: { plan: input.plan },
      stageOutput: { queries: generated },
    });
    span.update({ output: { queries: generated } });
    return generated;
  });
}

function repairGeneratedQueries(
  queries: GeneratedSqlQuery[],
  plan: AnalysisPlan,
): GeneratedSqlQuery[] {
  const byId = new Map(queries.map((query) => [query.id, query]));
  const repaired = plan.queries.map((planned) => {
    const generated = byId.get(planned.id);
    return {
      ...planned,
      sql: generated?.sql ?? fallbackSql(planned.sql_intent, plan.tables[0]),
    };
  });
  return repaired.filter((query) => query.sql.trim().length > 0);
}

function fallbackSql(sqlIntent: string, table?: string) {
  if (!table) {
    return `
SELECT database, name AS table_name, total_rows
FROM system.tables
WHERE database IN ('silver', 'gold')
ORDER BY database, name
LIMIT 100`;
  }
  if (/event/i.test(sqlIntent)) {
    return `
SELECT event_name, count() AS rows
FROM ${table}
GROUP BY event_name
ORDER BY rows DESC
LIMIT 100`;
  }
  return `
SELECT *
FROM ${table}
LIMIT 20`;
}
