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

  const { schemaPlan, schemaSql, mappingPlan } = await runSchemaGenerator({
    jobId: input.jobId,
    featureSlug,
    manifest,
    eventProfile,
    context: input.context,
    artifactRoot: input.artifactRoot,
  });

  const schemaReview = await runSchemaCritic({
    jobId: input.jobId,
    schemaPlan,
    eventProfile,
    manifest,
    artifactRoot: input.artifactRoot,
  });

  if (schemaReview.warnings.length > 0) {
    throw new Error(
      `Schema critic blocked execution: ${schemaReview.warnings.join("; ")}`,
    );
  }

  const loadReport = await runSilverLoader({
    jobId: input.jobId,
    schemaPlan,
    schemaSql,
    eventProfile,
    manifest,
    rawEvents: bronze.rawEvents,
    artifactRoot: input.artifactRoot,
  });

  await runContextUpdater({
    jobId: input.jobId,
    featureSlug,
    manifest,
    schemaPlan,
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
