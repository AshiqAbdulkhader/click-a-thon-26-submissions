import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startActiveObservation } from "@langfuse/tracing";
import { loadContextBundle } from "./context.js";
import { runInstrumentationAgent } from "./instrumentation.js";
import { pipelineStages } from "./stages.js";
import { shutdownLangfuse, startLangfuse } from "../tracing/langfuse.js";

type RunPipelineInput = {
  specFolder: string;
};

export async function runPipeline(input: RunPipelineInput) {
  startLangfuse();

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

  try {
    await startActiveObservation("schema-kings.pipeline", async (rootSpan) => {
      rootSpan.update({
        input: {
          job_id: jobId,
          spec_folder: specFolder,
        },
        metadata: {
          pipeline: "feature-spec-to-clickhouse-schema",
          environment: process.env.NODE_ENV ?? "local",
          model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
        },
      });

      const context = await startActiveObservation(
        "00_context_provider",
        async (span) => {
          span.update({
            input: {
              base_context: "base_context.md",
              existing_ddl: "data/ddl.sql",
              instrumentation_notes: "data/instrumentation_notes.md",
            },
            metadata: {
              agent: "context_provider_v0",
            },
          });

          const loadedContext = await loadContextBundle(repoRoot);
          span.update({
            output: {
              generated_features:
                loadedContext.generatedContext.features.length,
              contradictions:
                loadedContext.generatedContext.contradictions.length,
            },
          });
          return loadedContext;
        },
      );
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
        "12_trace_summary",
      ]);

      for (const stage of pipelineStages) {
        const status = completedStages.has(stage.id) ? "done" : "todo";
        console.log(`[${status}] ${stage.id}: ${stage.name}`);
      }

      const runSummary = {
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
        langfuse_trace_id: rootSpan.traceId,
      };

      await startActiveObservation("12_trace_summary", async (span) => {
        span.update({
          input: {
            artifact_root: artifactRoot,
          },
          metadata: {
            agent: "pipeline_orchestrator",
          },
        });
        await writeFile(
          path.join(artifactRoot, "run_summary.json"),
          `${JSON.stringify(runSummary, null, 2)}\n`,
        );
        span.update({
          output: runSummary,
        });
      });

      rootSpan.update({
        output: {
          job_id: jobId,
          feature_slug: result.featureSlug,
          table_name: runSummary.table_name,
          artifact_root: artifactRoot,
          trace_id: rootSpan.traceId,
        },
      });

      console.log("");
      console.log(`Instrumentation agent finished for ${result.featureSlug}.`);
      console.log(`Generated table: silver.${result.schemaPlan.table_name}`);
      console.log(
        `Generated schema: ${path.join(artifactRoot, "04_schema_generator", "schema.sql")}`,
      );
      console.log(`Langfuse trace ID: ${rootSpan.traceId}`);
    });
  } finally {
    await shutdownLangfuse();
  }
}

function createJobId(specFolder: string) {
  const slug = specFolder.split("/").filter(Boolean).at(-1) ?? "unknown_spec";
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "");
  return `${timestamp}_${slug}`;
}
