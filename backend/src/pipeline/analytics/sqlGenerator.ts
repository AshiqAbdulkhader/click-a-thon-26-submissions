import { startActiveObservation } from "@langfuse/tracing";
import { callGroqJson } from "../groq.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { bareTableName, qualifyFeatureTable } from "../warehouseTables.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import {
  AnalysisPlan,
  GeneratedSqlQuery,
  PmRelevantContext,
  QueryIntent,
} from "./types.js";
import {
  compactJson,
  getKnownClickHouseTables,
  groundSqlTableNames,
  unique,
} from "./utils.js";

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

    const catalog = buildSqlCatalog(input.context, input.plan);
    const liveTables = await getKnownClickHouseTables();
    const allowedTables = unique([
      ...catalog.tables,
      ...liveTables.filter(
        (table) =>
          table.startsWith("silver.") ||
          table.startsWith("gold.") ||
          !table.includes(".") ||
          table.includes("destination_card") ||
          table.includes("application_started") ||
          table.includes("document_uploaded") ||
          table.includes("purchase_completed") ||
          table.includes("pay_now") ||
          table.includes("search_typed") ||
          table.includes("landing_page") ||
          table.includes("auth_completed"),
      ),
    ]);

    const llmQueries = await callGroqJson<{ queries: GeneratedSqlQuery[] }>({
      traceName: "groq.analytics.sql_generator",
      temperature: 0,
      maxTokens: 3000,
      traceInput: {
        question: input.question,
        query_count: input.plan.queries.length,
        execution_feedback: input.executionFeedback ?? [],
        allowed_tables: allowedTables.slice(0, 40),
      },
      messages: [
        {
          role: "system",
          content:
            "You generate ClickHouse SELECT SQL for analytics. Return JSON only. SQL must be read-only and must not include FORMAT or semicolons. NEVER invent table or column names.",
        },
        {
          role: "user",
          content: `Question:
${input.question}

Intent:
${compactJson(input.intent)}

Plan:
${compactJson(input.plan)}

ALLOWED TABLES (use only these exact names):
${allowedTables.map((table) => `- ${table}`).join("\n") || "- (none — return empty queries)"}

ALLOWED COLUMNS BY TABLE (from context memory; prefer these):
${compactJson(catalog.columnsByTable, 12000)}

KNOWN JOINS:
${compactJson(catalog.joins, 4000)}

METRIC SQL SKETCHES (adapt, do not invent tables):
${compactJson(catalog.metrics, 4000)}

Relevant context notes / contradictions / known issues:
${compactJson(
  {
    contradictions: input.context.contradictions,
    retrieval_notes: input.context.retrieval_notes,
  },
  6000,
)}

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
- Use ONLY exact table names from ALLOWED TABLES. Generated feature tables are silver.<name>_events. Base funnel tables are bare names (destination_card_clicked, application_started, document_uploaded, purchase_completed, pay_now_clicked, …).
- Use ONLY columns from ALLOWED COLUMNS when listed for a table.
- Prefer silver feature tables for feature-specific questions; join base funnel tables for baseline/uplift comparisons via user_id or application_id.
- Feature event names live in event_name (not a free-text event column) for silver tables. Base tables are one event per table (no event_name column).
- Use ClickHouse syntax.
- Limit exploratory result sets to at most 100 rows.
- For root-cause questions, include comparison/baseline and segment cuts when available.
- If allowed tables are empty, return an empty queries array rather than inventing tables.
- Do not invent causal language in SQL comments; do not include comments.`,
        },
      ],
    });

    if (!Array.isArray(llmQueries.queries)) {
      throw new Error("Groq SQL generator returned an unusable queries array.");
    }
    const generated = repairGeneratedQueries(
      llmQueries.queries,
      input.plan,
      catalog.tables,
    );
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "sql_queries.json",
      {
        queries: generated,
        allowed_tables: allowedTables,
      },
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: { plan: input.plan },
      stageOutput: {
        queries: generated,
        allowed_tables: allowedTables,
      },
    });
    span.update({
      output: {
        queries: generated,
        allowed_tables: allowedTables,
      },
    });
    return generated;
  });
}

function buildSqlCatalog(context: PmRelevantContext, plan: AnalysisPlan) {
  const tables = unique(
    [
      ...plan.tables,
      ...context.features.map((feature) => feature.table_name),
      ...context.workflows.map((workflow) => workflow.table_name),
      ...context.columns.map((column) => column.table_name),
      ...context.joins.flatMap((join) => [join.left_table, join.right_table]),
    ]
      .filter(Boolean)
      .filter((table) => !table.includes("|") && !table.includes("*"))
      .map((table) => qualifyFeatureTable(table)),
  );

  const columnsByTable: Record<string, string[]> = {};
  for (const column of context.columns) {
    const table = qualifyFeatureTable(column.table_name);
    if (!tables.includes(table) && !tables.includes(bareTableName(table))) {
      // still include if plan/context referenced bare
      if (
        !tables.some(
          (candidate) => bareTableName(candidate) === bareTableName(table),
        )
      ) {
        continue;
      }
    }
    const key =
      tables.find(
        (candidate) => bareTableName(candidate) === bareTableName(table),
      ) ?? table;
    columnsByTable[key] ??= [];
    if (!columnsByTable[key].includes(column.column_name)) {
      columnsByTable[key].push(column.column_name);
    }
  }

  return {
    tables,
    columnsByTable,
    joins: context.joins.slice(0, 30),
    metrics: context.metrics.slice(0, 20),
  };
}

function repairGeneratedQueries(
  queries: GeneratedSqlQuery[],
  plan: AnalysisPlan,
  catalogTables: string[],
): GeneratedSqlQuery[] {
  const byId = new Map(queries.map((query) => [query.id, query]));
  const primaryTable =
    plan.tables.map((table) => qualifyFeatureTable(table)).find(Boolean) ??
    catalogTables[0];

  const repaired = plan.queries.map((planned) => {
    const generated = byId.get(planned.id);
    if (!generated?.sql?.trim()) {
      throw new Error(
        `Groq SQL generator omitted SQL for planned query ${planned.id}.`,
      );
    }
    return {
      ...planned,
      sql: groundSqlTableNames(generated.sql, catalogTables),
    };
  });

  // Keep any extra LLM queries that map to catalog tables after grounding.
  for (const query of queries) {
    if (repaired.some((item) => item.id === query.id)) {
      continue;
    }
    const sql = groundSqlTableNames(query.sql, catalogTables);
    if (sql.trim()) {
      repaired.push({ ...query, sql });
    }
  }

  return repaired.filter((query) => query.sql.trim().length > 0);
}
