import path from "node:path";
import { startActiveObservation } from "@langfuse/tracing";
import { ContextBundle } from "../context.js";
import { callGroqJson } from "../groq.js";
import { recordPipelineStage } from "../tracking.js";
import { writeStageJson } from "./artifacts.js";
import { extractSpecEventOrder } from "./eventUtils.js";
import { instrumentationTrackingEvents } from "./trackingEvents.js";
import { EventProfile, FeatureManifest } from "./types.js";

export async function runSpecParser(input: {
  jobId: string;
  featureSlug: string;
  specMarkdown: string;
  eventProfile: EventProfile;
  context: ContextBundle;
  artifactRoot: string;
}) {
  const stage = instrumentationTrackingEvents.specParser;

  return startActiveObservation(stage.observationName, async (span) => {
    span.update({
      input: {
        feature_slug: input.featureSlug,
        event_names: input.eventProfile.event_order,
        context_features: input.context.generatedContext.features.length,
      },
      metadata: {
        agent: stage.agent,
        source_layer: stage.sourceLayer,
        target_layer: stage.targetLayer,
        llm_provider: "groq",
        model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
      },
    });

    const parsedManifest = await buildManifestWithGroq(input);
    const manifest = repairManifestWithEvidence({
      manifest: parsedManifest,
      featureSlug: input.featureSlug,
      specMarkdown: input.specMarkdown,
      eventProfile: input.eventProfile,
    });

    await writeStageJson(
      input.artifactRoot,
      stage.stageId,
      "feature_manifest.json",
      manifest,
    );

    span.update({
      output: {
        feature_name: manifest.feature_name,
        workflow_type: manifest.workflow_type,
        primary_entity: manifest.primary_entity,
        success_event: manifest.success_event,
        metric_hints: manifest.metric_hints,
        artifact: path.join(
          input.artifactRoot,
          stage.stageId,
          "feature_manifest.json",
        ),
      },
    });

    await recordPipelineStage({
      jobId: input.jobId,
      stageId: stage.stageId,
      stageName: stage.stageName,
      status: "completed",
      stageInput: {
        feature_slug: input.featureSlug,
        event_names: input.eventProfile.event_order,
        source_layer: stage.sourceLayer,
        target_layer: stage.targetLayer,
      },
      stageOutput: {
        feature_name: manifest.feature_name,
        workflow_type: manifest.workflow_type,
        primary_entity: manifest.primary_entity,
        success_event: manifest.success_event,
        metric_hints: manifest.metric_hints,
      },
    });

    return manifest;
  });
}

async function buildManifestWithGroq(input: {
  featureSlug: string;
  specMarkdown: string;
  eventProfile: EventProfile;
  context: ContextBundle;
}): Promise<FeatureManifest> {
  const compactContext = {
    generated_context: input.context.generatedContext,
    instrumentation_notes_excerpt: input.context.instrumentationNotes.slice(
      0,
      5000,
    ),
    existing_ddl_excerpt: input.context.existingDdl.slice(0, 8000),
    base_context_excerpt: input.context.baseContext.slice(0, 8000),
  };

  const manifest = await callGroqJson<FeatureManifest>({
    modelRole: "schema",
    messages: [
      {
        role: "system",
        content:
          "You are an instrumentation agent for ClickHouse analytics. Return only valid JSON. Choose schema-relevant product semantics from the spec and context.",
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Create a feature manifest for schema generation. Use the event profile and Atlys context. Pick the primary entity, workflow type, ordered events, success event, metric hints, and context notes.",
          allowed_workflow_types: [
            "funnel",
            "revenue_addon",
            "referral_loop",
            "recovery",
            "generic",
          ],
          required_shape: {
            feature_slug: "string",
            feature_name: "string",
            primary_entity: "string",
            workflow_type:
              "funnel | revenue_addon | referral_loop | recovery | generic",
            event_order: ["event_name"],
            success_event: "event_name or null",
            metric_hints: ["metric names/questions"],
            context_notes: ["short notes"],
          },
          feature_slug: input.featureSlug,
          spec_markdown: input.specMarkdown,
          event_profile: input.eventProfile,
          context: compactContext,
        }),
      },
    ],
    traceName: instrumentationTrackingEvents.specParser.generationName,
    traceInput: {
      task: "feature_manifest_for_schema_generation",
      feature_slug: input.featureSlug,
      event_names: input.eventProfile.event_order,
      row_count: input.eventProfile.row_count,
      field_count: input.eventProfile.fields.length,
      context_features: input.context.generatedContext.features.length,
      context_contradictions:
        input.context.generatedContext.contradictions.length,
    },
  });
  if (
    !manifest.feature_slug ||
    !manifest.feature_name ||
    !manifest.primary_entity ||
    !manifest.workflow_type ||
    !Array.isArray(manifest.event_order) ||
    !Array.isArray(manifest.metric_hints) ||
    !Array.isArray(manifest.context_notes)
  ) {
    throw new Error("Groq manifest generation returned an unusable manifest.");
  }
  return manifest;
}

function repairManifestWithEvidence(input: {
  manifest: FeatureManifest;
  featureSlug: string;
  specMarkdown: string;
  eventProfile: EventProfile;
}): FeatureManifest {
  const eventOrder = extractSpecEventOrder(
    input.specMarkdown,
    input.eventProfile.event_order,
  );
  const eventText = eventOrder.join(" ");
  const hasField = (fieldPath: string) =>
    input.eventProfile.fields.some((field) => field.path === fieldPath);
  const contextNotes = [...input.manifest.context_notes];

  let primaryEntity = input.manifest.primary_entity;
  let workflowType = input.manifest.workflow_type;
  let metricHints = input.manifest.metric_hints;

  if (
    hasField("share_id") &&
    (eventText.includes("recipient") ||
      eventText.includes("link_opened") ||
      input.specMarkdown.toLowerCase().includes("share"))
  ) {
    primaryEntity = "share_id";
    workflowType = "referral_loop";
    metricHints = [
      "share_rate_by_status_shared",
      "channel_mix",
      "new_user_open_rate_by_channel",
      "recipient_cta_rate",
    ];
    contextNotes.push(
      "Deterministic repair: share_id is present and recipient-side events are keyed by share_id.",
    );
  } else if (hasField("group_id")) {
    primaryEntity = "group_id";
    workflowType = "funnel";
    contextNotes.push(
      "Deterministic repair: group_id is present and is the feature-level entity.",
    );
  } else if (
    eventText.includes("forex") ||
    input.specMarkdown.toLowerCase().includes("aov")
  ) {
    primaryEntity = "application_id";
    workflowType = "revenue_addon";
    metricHints = ["attach_rate", "aov_uplift", "dropoff_by_step"];
    contextNotes.push(
      "Deterministic repair: forex feature is a revenue add-on.",
    );
  } else if (
    eventText.includes("reminder") ||
    eventText.includes("reconverted")
  ) {
    primaryEntity = "application_id";
    workflowType = "recovery";
    metricHints = [
      "reconversion_rate",
      "channel_recovery_rate",
      "timing_effect",
    ];
    contextNotes.push(
      "Deterministic repair: reminder/reconverted events indicate recovery workflow.",
    );
  }

  return {
    ...input.manifest,
    feature_slug: input.featureSlug,
    primary_entity: primaryEntity,
    workflow_type: workflowType,
    event_order: eventOrder,
    success_event: eventOrder.at(-1) ?? input.manifest.success_event,
    metric_hints: metricHints,
    context_notes: [...new Set(contextNotes)],
  };
}
