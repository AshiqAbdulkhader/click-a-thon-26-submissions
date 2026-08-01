import { retrieveRelevantContextForSpec } from "../../context.js";
import { buildSchemaPlan } from "./fallback.js";
import {
  normalizeDesignDraft,
  repairSchemaPlan,
  reviewSchemaPlan,
} from "./guardrails.js";
import {
  requestSchemaCriticReview,
  requestSchemaDesignDraft,
  requestSchemaRevisionDraft,
} from "./prompts.js";
import { RunSchemaGeneratorInput, SchemaDesignLoop } from "./types.js";

export async function runSchemaDesignLoop(
  input: RunSchemaGeneratorInput,
): Promise<SchemaDesignLoop> {
  const iterations: SchemaDesignLoop["iterations"] = [];
  const fallbackPlan = buildSchemaPlan(input.manifest, input.eventProfile);
  let schemaPlan = fallbackPlan;
  const relevantContext = retrieveRelevantContextForSpec({
    context: input.context,
    featureSlug: input.featureSlug,
    workflowType: input.manifest.workflow_type,
    primaryEntity: input.manifest.primary_entity,
    eventNames: input.manifest.event_order,
    fieldPaths: input.eventProfile.fields.map((field) => field.path),
    metricHints: input.manifest.metric_hints,
  });
  const draft = await requestSchemaDesignDraft(input, relevantContext);

  if (draft) {
    schemaPlan = normalizeDesignDraft(
      draft,
      fallbackPlan,
      input.eventProfile,
      input.manifest,
    );
    iterations.push({
      iteration: 1,
      actor: "schema_designer",
      summary:
        "LLM schema designer proposed a full ClickHouse schema plan from spec, profile, and context evidence.",
      issues: [
        ...(draft.rationale ?? []),
        ...(draft.context_assumptions ?? []).map(
          (assumption) =>
            `${assumption.trusted ? "trusted" : "not_trusted"} context: ${assumption.claim} (${assumption.evidence})`,
        ),
      ],
    });
  } else {
    iterations.push({
      iteration: 1,
      actor: "schema_designer",
      summary:
        "No LLM schema suggestion available; using deterministic evidence-based draft.",
      issues: [],
    });
  }

  const criticReview = await requestSchemaCriticReview({
    ...input,
    schemaPlan,
    relevantContext,
    deterministicIssues: reviewSchemaPlan(schemaPlan, input.eventProfile),
  });
  if (criticReview) {
    const criticIssues = [
      ...(criticReview.issues ?? []),
      ...(criticReview.rationale ?? []),
    ];
    iterations.push({
      iteration: 1,
      actor: "schema_critic",
      summary:
        criticReview.verdict === "revise"
          ? "LLM schema critic requested a schema revision."
          : "LLM schema critic passed the schema plan.",
      issues: criticIssues,
    });

    if (criticReview.verdict === "revise") {
      const revision = await requestSchemaRevisionDraft({
        ...input,
        currentPlan: schemaPlan,
        criticReview,
        relevantContext,
      });
      if (revision) {
        schemaPlan = normalizeDesignDraft(
          revision,
          fallbackPlan,
          input.eventProfile,
          input.manifest,
        );
        iterations.push({
          iteration: 2,
          actor: "schema_designer_revision",
          summary:
            "LLM schema designer revised the plan using schema critic feedback.",
          issues: revision.rationale ?? [],
        });
      }
    }
  } else {
    iterations.push({
      iteration: 1,
      actor: "schema_critic",
      summary:
        "LLM schema critic was unavailable; deterministic guardrails remained the critic of record.",
      issues: [],
    });
  }

  const firstReview = reviewSchemaPlan(schemaPlan, input.eventProfile);
  iterations.push({
    iteration: 1,
    actor: "deterministic_guardrail",
    summary:
      firstReview.length === 0
        ? "Draft passed guardrails."
        : "Draft had guardrail issues.",
    issues: firstReview,
  });

  if (firstReview.length > 0) {
    schemaPlan = repairSchemaPlan(
      schemaPlan,
      input.manifest,
      input.eventProfile,
    );
    const secondReview = reviewSchemaPlan(schemaPlan, input.eventProfile);
    iterations.push({
      iteration: 2,
      actor: "schema_repair",
      summary:
        secondReview.length === 0
          ? "Deterministic repair produced an executable schema plan."
          : "Deterministic repair left unresolved issues.",
      issues: secondReview,
    });

    if (secondReview.length > 0) {
      throw new Error(
        `Schema design loop failed guardrails: ${secondReview.join("; ")}`,
      );
    }
  }

  return {
    mode: draft ? "llm_assisted" : "deterministic_only",
    iterations,
    final_plan: schemaPlan,
  };
}
