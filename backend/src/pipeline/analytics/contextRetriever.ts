import { startActiveObservation } from "@langfuse/tracing";
import { ContextBundle } from "../context.js";
import { writeStageJson } from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { PmRelevantContext, QueryIntent } from "./types.js";
import { normalizeTokens, scoreAgainstTerms, unique } from "./utils.js";

export async function retrievePmContext(input: {
  jobId: string;
  question: string;
  intent: QueryIntent;
  context: ContextBundle;
  artifactRoot: string;
}): Promise<PmRelevantContext> {
  const event = analyticsTrackingEvents.contextRetrieval;
  return startActiveObservation(event.stageId, async (span) => {
    const terms = buildTerms(input.question, input.intent);
    const registry = input.context.generatedContext;

    const features = registry.features
      .map((feature) => ({
        item: feature,
        score: scoreAgainstTerms(
          terms,
          feature.feature_slug,
          feature.table_name,
          feature.primary_entity,
          feature.event_names,
          feature.metric_hints,
        ),
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((scored) => scored.item);

    const featureSlugs = new Set(
      features.map((feature) => feature.feature_slug),
    );
    const tableNames = new Set(features.map((feature) => feature.table_name));

    const workflows = registry.workflows
      .map((workflow) => ({
        item: workflow,
        score:
          scoreAgainstTerms(
            terms,
            workflow.feature_slug,
            workflow.table_name,
            workflow.workflow_type,
            workflow.primary_entity,
            workflow.segment_columns,
            workflow.start_event,
            workflow.success_event,
          ) +
          (featureSlugs.has(workflow.feature_slug) ? 5 : 0) +
          (tableNames.has(workflow.table_name) ? 5 : 0),
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((scored) => scored.item);

    for (const workflow of workflows) {
      tableNames.add(workflow.table_name);
    }

    const columns = registry.columns
      .map((column) => ({
        item: column,
        score:
          scoreAgainstTerms(
            terms,
            column.table_name,
            column.column_name,
            column.semantic_role,
            column.source_path,
          ) + (tableNames.has(column.table_name) ? 4 : 0),
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 120)
      .map((scored) => scored.item);

    for (const column of columns.slice(0, 40)) {
      tableNames.add(column.table_name);
    }

    const metrics = registry.metrics
      .map((metric) => ({
        item: metric,
        score:
          scoreAgainstTerms(
            terms,
            metric.feature_slug,
            metric.metric_name,
            metric.formula_sql,
            metric.grain,
            metric.segment_columns,
          ) + (featureSlugs.has(metric.feature_slug) ? 4 : 0),
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((scored) => scored.item);

    const joins = registry.joins
      .filter(
        (join) =>
          tableNames.has(join.left_table) ||
          tableNames.has(join.right_table) ||
          terms.has(join.left_column) ||
          terms.has(join.right_column),
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 40);

    const schemaQuality = registry.schema_quality
      .filter((quality) => tableNames.has(quality.table_name))
      .slice(0, 40);

    const relevant: PmRelevantContext = {
      features,
      workflows,
      columns,
      metrics,
      joins,
      schema_quality: schemaQuality,
      contradictions: registry.contradictions,
      base_context_excerpt: input.context.baseContext.slice(0, 5000),
      retrieval_notes: [
        `Retrieved ${features.length} features, ${workflows.length} workflows, ${columns.length} columns, ${metrics.length} metrics, ${joins.length} joins.`,
        "This PM retrieval is broader than spec retrieval and should be treated as evidence, not absolute truth.",
      ],
    };

    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "pm_context.json",
      relevant,
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: {
        question: input.question,
        intent: input.intent,
      },
      stageOutput: {
        features: relevant.features.length,
        workflows: relevant.workflows.length,
        columns: relevant.columns.length,
        metrics: relevant.metrics.length,
        joins: relevant.joins.length,
      },
    });
    span.update({ output: relevant });
    return relevant;
  });
}

function buildTerms(question: string, intent: QueryIntent) {
  return new Set(
    unique([
      ...normalizeTokens(question),
      ...intent.feature_hints.flatMap((hint) =>
        Array.from(normalizeTokens(hint)),
      ),
      ...intent.metric_hints.flatMap((hint) =>
        Array.from(normalizeTokens(hint)),
      ),
      ...intent.table_hints.flatMap((hint) =>
        Array.from(normalizeTokens(hint)),
      ),
      ...intent.segment_hints.flatMap((hint) =>
        Array.from(normalizeTokens(hint)),
      ),
    ]),
  );
}
