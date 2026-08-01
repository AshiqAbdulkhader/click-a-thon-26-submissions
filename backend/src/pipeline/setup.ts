import { spawn } from "node:child_process";
import path from "node:path";
import { startActiveObservation } from "@langfuse/tracing";
import { getClickHouseConfig, queryClickHouseText } from "./clickhouse.js";
import { bootstrapContext } from "./context.js";
import { recordDataLoad, recordDataLoadTable } from "./tracking.js";
import { shutdownLangfuse, startLangfuse } from "../tracing/langfuse.js";

const baseTables = [
  {
    table: "destination_card_clicked",
    file: "destination_card_clicked.parquet",
  },
  { table: "application_started", file: "application_started.parquet" },
  { table: "document_uploaded", file: "document_uploaded.parquet" },
  { table: "purchase_completed", file: "purchase_completed.parquet" },
  { table: "search_typed", file: "search_typed.parquet" },
  { table: "landing_page_scrolled", file: "landing_page_scrolled.parquet" },
  { table: "auth_completed", file: "auth_completed.parquet" },
  { table: "pay_now_clicked", file: "pay_now_clicked.parquet" },
] as const;

export async function runSetup(input: { repoRoot: string }) {
  startLangfuse();

  const loadId = `base_${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")}`;
  const startedAt = new Date().toISOString();
  let traceId = "";

  try {
    await startActiveObservation(
      "schema-kings.local-setup",
      async (rootSpan) => {
        traceId = rootSpan.traceId;
        rootSpan.update({
          input: {
            load_id: loadId,
            clickhouse_url: getClickHouseConfig().url,
            clickhouse_database: getClickHouseConfig().database,
          },
          metadata: {
            pipeline: "local-setup",
            includes: ["base_data_load", "context_bootstrap"],
          },
        });

        await recordDataLoad({
          loadId,
          loadType: "base_tables_and_context",
          status: "started",
          traceId,
          startedAt,
        });

        const loadSummary = await startActiveObservation(
          "setup.load_base_tables",
          async (span) => {
            span.update({
              input: {
                tables: baseTables.map((table) => table.table),
                loader: "data/load.sh",
              },
              metadata: {
                target_database: getClickHouseConfig().database,
              },
            });

            const loadScriptResult = await runLoadScript(input.repoRoot);

            const results = [];
            for (const table of baseTables) {
              const sourcePath = path.join(input.repoRoot, "data", table.file);
              const actualRows = Number(
                (
                  await queryClickHouseText(
                    `SELECT count() FROM ${table.table} FORMAT TabSeparated`,
                  )
                ).trim(),
              );

              const result = {
                table_name: table.table,
                source_path: sourcePath,
                actual_rows: actualRows,
                status: "completed" as const,
              };
              results.push(result);
              await recordDataLoadTable({
                loadId,
                tableName: table.table,
                sourcePath,
                actualRows,
                status: "completed",
                validation: {
                  row_count_positive: actualRows > 0,
                },
              });
            }

            span.update({
              output: {
                loader_stdout: loadScriptResult.stdout.slice(-2000),
                loaded_tables: results.length,
                total_rows: results.reduce(
                  (sum, result) => sum + result.actual_rows,
                  0,
                ),
                results,
              },
            });

            return {
              loaded_tables: results.length,
              total_rows: results.reduce(
                (sum, result) => sum + result.actual_rows,
                0,
              ),
              tables: results,
            };
          },
        );

        const contextSummary = await startActiveObservation(
          "setup.context_bootstrap",
          async (span) => {
            span.update({
              input: {
                documents: [
                  "base_context.md",
                  "data/ddl.sql",
                  "data/instrumentation_notes.md",
                ],
              },
            });

            const registry = await bootstrapContext(input.repoRoot);
            span.update({
              output: {
                features: registry.features.length,
                contradictions: registry.contradictions.length,
              },
            });
            return {
              features: registry.features.length,
              contradictions: registry.contradictions.length,
            };
          },
        );

        const summary = {
          load_id: loadId,
          base_data: loadSummary,
          context: contextSummary,
          trace_id: traceId,
        };

        await recordDataLoad({
          loadId,
          loadType: "base_tables_and_context",
          status: "completed",
          traceId,
          startedAt,
          completedAt: new Date().toISOString(),
          summary,
        });

        rootSpan.update({
          output: summary,
        });

        console.log("Local setup completed.");
        console.log(`Load ID: ${loadId}`);
        console.log(`Base tables loaded: ${loadSummary.loaded_tables}`);
        console.log(`Base rows loaded: ${loadSummary.total_rows}`);
        console.log(
          `Open context contradictions: ${contextSummary.contradictions}`,
        );
        console.log(`Langfuse trace ID: ${traceId}`);
      },
    );
  } catch (error) {
    await recordDataLoad({
      loadId,
      loadType: "base_tables_and_context",
      status: "failed",
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      summary: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  } finally {
    await shutdownLangfuse();
  }
}

async function runLoadScript(repoRoot: string) {
  const dataDir = path.join(repoRoot, "data");
  const childEnv = {
    ...process.env,
    CH: process.env.CH ?? defaultLoadCommand(repoRoot),
    DB: process.env.CLICKHOUSE_DATABASE ?? "schema_kings",
  };

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("bash", ["load.sh"], {
      cwd: dataDir,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `data/load.sh failed with exit code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        ),
      );
    });
  });
}

function defaultLoadCommand(repoRoot: string) {
  const config = getClickHouseConfig();
  const url = new URL(config.url);

  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return `docker compose -f ${path.join(repoRoot, "docker-compose.yml")} exec -T clickhouse clickhouse-client --user ${config.user} --password ${config.password}`;
  }

  const secure = url.protocol === "https:" ? " --secure" : "";
  const port = url.port ? ` --port ${url.port}` : "";
  return `clickhouse-client --host ${url.hostname}${port} --user ${config.user} --password ${config.password}${secure}`;
}
