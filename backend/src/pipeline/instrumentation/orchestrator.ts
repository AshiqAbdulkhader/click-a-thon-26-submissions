import path from "node:path";
import { ContextBundle } from "../context.js";
import { runBronzeIngest } from "./bronzeIngest.js";
import { runContextUpdater } from "./contextUpdater.js";
import { normalizeFeatureSlug } from "./eventUtils.js";
import { runEventProfiler } from "./eventProfiler.js";
import { runSchemaCritic } from "./schemaCritic.js";
import { runSchemaGenerator } from "./schemaGenerator.js";
import { runSilverLoader } from "./silverLoader.js";
import { runSpecParser } from "./specParser.js";
import { writeStageJson } from "./artifacts.js";
import { MappingPlan, SchemaPlan, SilverLoadReport } from "./types.js";

const MAX_SCHEMA_LOAD_ATTEMPTS = 2;

export async function runInstrumentationAgent(input: {
  repoRoot: string;
  specFolder: string;
  jobId: string;
  artifactRoot: string;
  context: ContextBundle;
}) {
  const specPath = path.join(input.specFolder, "spec.md");
  const eventsPath = path.join(input.specFolder, "events.ndjson");
  const featureSlug = normalizeFeatureSlug(path.basename(input.specFolder));

  const bronze = await runBronzeIngest({
    jobId: input.jobId,
    featureSlug,
    specPath,
    eventsPath,
    artifactRoot: input.artifactRoot,
  });

  const eventProfile = await runEventProfiler({
    jobId: input.jobId,
    featureSlug,
    eventsPath,
    rawEvents: bronze.rawEvents,
    artifactRoot: input.artifactRoot,
  });

  const manifest = await runSpecParser({
    jobId: input.jobId,
    featureSlug,
    specMarkdown: bronze.specMarkdown,
    eventProfile,
    context: input.context,
    artifactRoot: input.artifactRoot,
  });

  let schemaPlan: SchemaPlan | null = null;
  let schemaSql = "";
  let mappingPlan: MappingPlan | null = null;
  let loadReport: SilverLoadReport | null = null;
  let executionFeedback: string[] = [];
  const repairAttempts: Array<{
    attempt: number;
    status: "failed" | "completed";
    feedback: string[];
  }> = [];

  for (let attempt = 1; attempt <= MAX_SCHEMA_LOAD_ATTEMPTS; attempt += 1) {
    const generated = await runSchemaGenerator({
      jobId: input.jobId,
      featureSlug,
      manifest,
      eventProfile,
      context: input.context,
      artifactRoot: input.artifactRoot,
      executionFeedback,
    });
    schemaPlan = generated.schemaPlan;
    schemaSql = generated.schemaSql;
    mappingPlan = generated.mappingPlan;

    const schemaReview = await runSchemaCritic({
      jobId: input.jobId,
      schemaPlan,
      eventProfile,
      manifest,
      artifactRoot: input.artifactRoot,
    });

    if (schemaReview.warnings.length > 0) {
      executionFeedback = [
        `Schema critic blocked attempt ${attempt}: ${schemaReview.warnings.join("; ")}`,
      ];
      repairAttempts.push({
        attempt,
        status: "failed",
        feedback: executionFeedback,
      });
      if (attempt < MAX_SCHEMA_LOAD_ATTEMPTS) {
        continue;
      }
      await writeRepairLoopArtifact(input.artifactRoot, repairAttempts);
      throw new Error(executionFeedback[0]);
    }

    try {
      loadReport = await runSilverLoader({
        jobId: input.jobId,
        schemaPlan,
        schemaSql,
        eventProfile,
        manifest,
        rawEvents: bronze.rawEvents,
        artifactRoot: input.artifactRoot,
      });
      repairAttempts.push({
        attempt,
        status: "completed",
        feedback: [],
      });
      break;
    } catch (error) {
      executionFeedback = [
        `Silver load or validation failed on attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`,
      ];
      repairAttempts.push({
        attempt,
        status: "failed",
        feedback: executionFeedback,
      });
      if (attempt >= MAX_SCHEMA_LOAD_ATTEMPTS) {
        await writeRepairLoopArtifact(input.artifactRoot, repairAttempts);
        throw error;
      }
    }
  }

  await writeRepairLoopArtifact(input.artifactRoot, repairAttempts);

  if (!schemaPlan || !mappingPlan || !loadReport) {
    throw new Error(
      "Instrumentation repair loop ended without a loaded schema.",
    );
  }

  await runContextUpdater({
    jobId: input.jobId,
    featureSlug,
    manifest,
    schemaPlan,
    eventProfile,
    loadReport,
    artifactRoot: input.artifactRoot,
  });

  return {
    featureSlug,
    eventProfile,
    manifest,
    schemaPlan,
    schemaSql,
    mappingPlan,
    loadReport,
  };
}

async function writeRepairLoopArtifact(
  artifactRoot: string,
  attempts: Array<{
    attempt: number;
    status: "failed" | "completed";
    feedback: string[];
  }>,
) {
  await writeStageJson(
    artifactRoot,
    "04_schema_generator",
    "repair_loop.json",
    {
      max_attempts: MAX_SCHEMA_LOAD_ATTEMPTS,
      attempts,
    },
  );
}
