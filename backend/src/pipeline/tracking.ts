import { executeClickHouse } from "./clickhouse.js";

export async function ensureTrackingTables() {
  await executeClickHouse("CREATE DATABASE IF NOT EXISTS ops");
  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS ops.pipeline_runs
(
    job_id String,
    feature_slug LowCardinality(String),
    spec_folder String,
    status LowCardinality(String),
    trace_id String,
    started_at DateTime64(3),
    completed_at Nullable(DateTime64(3)),
    summary_json String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (job_id)
`);

  await executeClickHouse(`
CREATE TABLE IF NOT EXISTS ops.pipeline_stages
(
    job_id String,
    stage_id LowCardinality(String),
    stage_name LowCardinality(String),
    status LowCardinality(String),
    input_json String,
    output_json String,
    error String,
    recorded_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (job_id, stage_id, recorded_at)
`);
}

export async function recordPipelineRun(input: {
  jobId: string;
  featureSlug: string;
  specFolder: string;
  status: "started" | "completed" | "failed";
  traceId?: string;
  startedAt: string;
  completedAt?: string | null;
  summary?: Record<string, unknown>;
}) {
  await ensureTrackingTables();
  await executeClickHouse(`INSERT INTO ops.pipeline_runs FORMAT JSONEachRow
${JSON.stringify({
  job_id: input.jobId,
  feature_slug: input.featureSlug,
  spec_folder: input.specFolder,
  status: input.status,
  trace_id: input.traceId ?? "",
  started_at: input.startedAt,
  completed_at: input.completedAt ?? null,
  summary_json: JSON.stringify(input.summary ?? {}),
})}
`);
}

export async function recordPipelineStage(input: {
  jobId: string;
  stageId: string;
  stageName: string;
  status: "started" | "completed" | "failed";
  stageInput?: Record<string, unknown>;
  stageOutput?: Record<string, unknown>;
  error?: string;
}) {
  await ensureTrackingTables();
  await executeClickHouse(`INSERT INTO ops.pipeline_stages FORMAT JSONEachRow
${JSON.stringify({
  job_id: input.jobId,
  stage_id: input.stageId,
  stage_name: input.stageName,
  status: input.status,
  input_json: JSON.stringify(input.stageInput ?? {}),
  output_json: JSON.stringify(input.stageOutput ?? {}),
  error: input.error ?? "",
})}
`);
}
