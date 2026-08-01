import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadContextBundle } from "./context.js";
import { runInstrumentationAgent } from "./instrumentation.js";
import { pipelineStages } from "./stages.js";

type RunPipelineInput = {
  specFolder: string;
};

export async function runPipeline(input: RunPipelineInput) {
  const repoRoot = path.resolve(process.cwd(), "..");
  const specFolder = path.resolve(process.cwd(), input.specFolder);
  const jobId = createJobId(specFolder);
  const artifactRoot = path.join(repoRoot, "backend", "artifacts", jobId);
  await mkdir(artifactRoot, { recursive: true });

  console.log(`Starting pipeline`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Spec folder: ${specFolder}`);
  console.log(`Artifacts: ${artifactRoot}`);
  console.log("");

  const context = await loadContextBundle(repoRoot);
  console.log(`[done] context_provider: loaded base + generated context`);

  const result = await runInstrumentationAgent({
    repoRoot,
    specFolder,
    jobId,
    artifactRoot,
    context,
  });

  const completedStages = new Set([
    "01_bronze_ingest",
    "02_event_profiler",
    "03_spec_parser",
    "04_schema_generator",
    "05_schema_critic",
    "07_context_agent",
  ]);

  for (const stage of pipelineStages) {
    const status = completedStages.has(stage.id) ? "done" : "todo";
    console.log(`[${status}] ${stage.id}: ${stage.name}`);
  }

  await writeFile(
    path.join(artifactRoot, "run_summary.json"),
    `${JSON.stringify(
      {
        job_id: jobId,
        feature_slug: result.featureSlug,
        table_name: `silver.${result.schemaPlan.table_name}`,
        row_count: result.eventProfile.row_count,
        event_names: result.manifest.event_order,
        primary_entity: result.manifest.primary_entity,
        success_event: result.manifest.success_event,
        artifacts: artifactRoot,
        model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
        groq_used: Boolean(process.env.GROQ_API_KEY),
      },
      null,
      2,
    )}\n`,
  );

  console.log("");
  console.log(`Instrumentation agent finished for ${result.featureSlug}.`);
  console.log(`Generated table: silver.${result.schemaPlan.table_name}`);
  console.log(
    `Generated schema: ${path.join(artifactRoot, "04_schema_generator", "schema.sql")}`,
  );
}

function createJobId(specFolder: string) {
  const slug = specFolder.split("/").filter(Boolean).at(-1) ?? "unknown_spec";
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "");
  return `${timestamp}_${slug}`;
}
