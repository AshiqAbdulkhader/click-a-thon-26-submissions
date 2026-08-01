import { startActiveObservation } from "@langfuse/tracing";
import { callGroqJson } from "../groq.js";
import {
  writeStageJson,
  writeStageText,
} from "../instrumentation/artifacts.js";
import { recordPipelineStage } from "../tracking.js";
import { analyticsTrackingEvents } from "./trackingEvents.js";
import { EvidencePack, InsightDraft } from "./types.js";
import { compactJson } from "./utils.js";

export async function runInsightSynthesizer(input: {
  jobId: string;
  evidencePack: EvidencePack;
  artifactRoot: string;
}): Promise<InsightDraft> {
  const event = analyticsTrackingEvents.insightSynthesizer;
  return startActiveObservation(event.stageId, async (span) => {
    span.update({
      input: {
        question: input.evidencePack.question,
        query_result_count: input.evidencePack.query_results.length,
      },
      metadata: { agent: "analytics_insight_synthesizer" },
    });

    const llmDraft = await callGroqJson<InsightDraft>({
      traceName: "groq.analytics.insight_synthesizer",
      temperature: 0.2,
      maxTokens: 2200,
      traceInput: {
        question: input.evidencePack.question,
        result_count: input.evidencePack.query_results.length,
      },
      messages: [
        {
          role: "system",
          content:
            "You write PM-facing analytics answers from evidence. Do not invent facts. Return JSON only.",
        },
        {
          role: "user",
          content: `Evidence pack:
${compactJson(input.evidencePack, 24000)}

Return:
{
  "short_answer": string,
  "key_findings": string[],
  "evidence": [{"claim": string, "query_id": string, "confidence": "high" | "medium" | "low"}],
  "recommended_actions": string[],
  "caveats": string[]
}

Rules:
- Be useful to a product manager.
- Say when evidence is weak or missing.
- Do not claim causality unless the evidence directly supports it.
- Mention query ids for claims.
- Attach confidence high|medium|low on every evidence claim.
- If context contradictions mention known issues (e.g. K1 iOS WebKit OTP), link findings to them only when segment evidence supports it.`,
        },
      ],
    });

    const draft = repairDraft(llmDraft, input.evidencePack);
    await writeStageJson(
      input.artifactRoot,
      event.stageId,
      "insight_draft.json",
      draft,
    );
    await writeStageText(
      input.artifactRoot,
      event.stageId,
      "answer.md",
      renderDraftMarkdown(draft),
    );
    await recordPipelineStage({
      jobId: input.jobId,
      stageId: event.stageId,
      stageName: event.stageName,
      status: "completed",
      stageInput: { question: input.evidencePack.question },
      stageOutput: draft,
    });
    span.update({ output: draft });
    return draft;
  });
}

function repairDraft(
  draft: InsightDraft | null,
  evidencePack: EvidencePack,
): InsightDraft {
  if (draft) {
    return {
      short_answer:
        draft.short_answer ||
        "I could not produce a confident answer from the available evidence.",
      key_findings: draft.key_findings ?? [],
      evidence: draft.evidence ?? [],
      recommended_actions: draft.recommended_actions ?? [],
      caveats: draft.caveats ?? [],
    };
  }

  return {
    short_answer:
      evidencePack.query_results.length === 0
        ? "I could not answer this from ClickHouse because the planned queries did not return usable evidence."
        : "I found ClickHouse evidence for the question, but the insight writer was unavailable; review the query results artifact.",
    key_findings: evidencePack.query_results.map(
      (result) =>
        `${result.query_id} returned ${result.row_count} rows for: ${result.purpose}`,
    ),
    evidence: evidencePack.query_results.map((result) => ({
      claim: `${result.query_id} returned ${result.row_count} rows.`,
      query_id: result.query_id,
      confidence: result.row_count > 0 ? "medium" : "low",
    })),
    recommended_actions: [],
    caveats: [
      ...evidencePack.evaluation.evidence_gaps,
      ...evidencePack.evaluation.repair_notes,
    ],
  };
}

export function renderDraftMarkdown(draft: InsightDraft) {
  const lines = [`# Answer`, "", draft.short_answer, ""];
  if (draft.key_findings.length > 0) {
    lines.push("## Key findings", "");
    for (const finding of draft.key_findings) {
      lines.push(`- ${finding}`);
    }
    lines.push("");
  }
  if (draft.evidence.length > 0) {
    lines.push("## Evidence (claim → query → confidence)", "");
    for (const claim of draft.evidence) {
      lines.push(
        `- **[${claim.confidence}]** ${claim.claim} _(query: \`${claim.query_id}\`)_`,
      );
    }
    lines.push("");
  }
  if (draft.recommended_actions.length > 0) {
    lines.push("## Recommended actions", "");
    for (const action of draft.recommended_actions) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }
  if (draft.caveats.length > 0) {
    lines.push("## Caveats", "");
    for (const caveat of draft.caveats) {
      lines.push(`- ${caveat}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
