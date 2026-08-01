# Schema Kings Runbook

This is the command checklist for running everything locally first, then switching
the same flow to ClickHouse Cloud before the demo.

## Start Clean Locally

From the repo root:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon
```

This deletes only this project's local Docker state. It does not delete source
files, specs, Parquet data, or code.

```bash
docker compose --profile langfuse down -v
```

Optional: clear regenerated local run artifacts. These are ignored by git and
can always be recreated by running the pipeline again.

```bash
rm -rf backend/artifacts
```

Start app ClickHouse:

```bash
docker compose up -d clickhouse
```

Check ClickHouse is ready:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query 'SELECT 1'
```

At this point ClickHouse is fresh and has only init-created databases/tables:

```text
bronze
silver
gold
context
ops
schema_kings
```

## Load Base Data And Context Locally

Use one traced setup command. Start Langfuse first so base data loading and
context bootstrap are both visible in the trace.

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon
docker compose --profile langfuse up -d
cd backend
pnpm cli setup
```

This command loads the 8 provided Atlys tables, bootstraps ClickHouse-backed
context memory, records setup status in `ops.data_loads` and
`ops.data_load_tables`, and emits a Langfuse trace named
`schema-kings.local-setup`.

Under the hood it invokes the provided `data/load.sh` script, then validates and
tracks the loaded tables. Because `data/load.sh` is a fresh-service loader, run
this after `docker compose --profile langfuse down -v` locally or against an
empty Cloud database.

Verify the 8 base tables:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon

docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --database schema_kings \
  --query "
SELECT *
FROM
(
  SELECT 'destination_card_clicked' AS tbl, count() AS rows FROM destination_card_clicked
  UNION ALL SELECT 'application_started', count() FROM application_started
  UNION ALL SELECT 'document_uploaded', count() FROM document_uploaded
  UNION ALL SELECT 'purchase_completed', count() FROM purchase_completed
  UNION ALL SELECT 'search_typed', count() FROM search_typed
  UNION ALL SELECT 'landing_page_scrolled', count() FROM landing_page_scrolled
  UNION ALL SELECT 'auth_completed', count() FROM auth_completed
  UNION ALL SELECT 'pay_now_clicked', count() FROM pay_now_clicked
)
ORDER BY tbl
"
```

Expected approximate counts:

```text
application_started          154413
auth_completed               183790
destination_card_clicked    1000000
document_uploaded             20446
landing_page_scrolled        499786
pay_now_clicked               14739
purchase_completed             7054
search_typed                 599630
```

Check pipeline/context/ops databases and tables:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT database, name
FROM system.tables
WHERE database IN ('bronze', 'silver', 'gold', 'context', 'ops', 'schema_kings')
ORDER BY database, name
"
```

Verify setup tracking:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT load_id, status, trace_id
FROM ops.data_loads FINAL
ORDER BY updated_at DESC
LIMIT 5
"
```

Verify loaded table tracking:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT table_name, actual_rows, status
FROM ops.data_load_tables FINAL
WHERE load_id = (
  SELECT load_id
  FROM ops.data_loads FINAL
  WHERE status = 'completed'
  ORDER BY updated_at DESC
  LIMIT 1
)
ORDER BY table_name
"
```

Expected context/ops tables include:

```text
context.context_documents
context.contradictions
context.fact_registry
context.feature_registry
ops.data_loads
ops.data_load_tables
ops.pipeline_runs
ops.pipeline_stages
```

## Start Langfuse Locally

Start Langfuse plus its separate observability ClickHouse:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon
docker compose --profile langfuse up -d
```

Useful local URLs:

```text
App ClickHouse: http://localhost:8123
Langfuse UI:   http://localhost:3000
Langfuse CH:   http://localhost:8124
```

Check services:

```bash
docker compose ps
```

## Full Local Fresh-Start Sequence

Use this when you want to start from zero and get back to a ready local system:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon

# 1. Stop and delete this project's Docker volumes.
docker compose --profile langfuse down -v

# 2. Start app ClickHouse.
docker compose up -d clickhouse

# 3. Wait/check ClickHouse.
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query 'SELECT 1'

# 4. Start Langfuse before setup so setup is traced.
docker compose --profile langfuse up -d

# 5. If you used down -v, recreate/update Langfuse project keys in backend/.env
# before this command if you want traces to appear in Langfuse.
#
# 6. Load base data and bootstrap context in one traced command.
cd backend
pnpm cli setup

# 7. Run one pipeline smoke test.
pnpm exec tsc --noEmit
pnpm cli run ../specs/01_express_checkout
pnpm cli run ../specs/02_group_family
pnpm cli run ../specs/03_status_sharing
pnpm cli run ../specs/04_abandoned_checkout_recovery
pnpm cli run ../specs/05_instant_forex
```

## Backend Env For Local

Create or update `backend/.env`:

```env
GROQ_API_KEY=gsk-your-key
GROQ_MODEL=openai/gpt-oss-20b

LANGFUSE_PUBLIC_KEY=pk-lf-your-public-key
LANGFUSE_SECRET_KEY=sk-lf-your-secret-key
LANGFUSE_BASE_URL=http://localhost:3000

CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=schema_kings
CLICKHOUSE_PASSWORD=schema_kings
CLICKHOUSE_DATABASE=schema_kings
```

## Run Instrumentation Pipeline Locally

Run one known spec:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon/backend
pnpm cli run ../specs/01_express_checkout
```

Run the tricky shape checks:

```bash
pnpm cli run ../specs/03_status_sharing
pnpm cli run ../specs/05_instant_forex
```

Expected output includes:

```text
Generated table: silver.<feature>_events
06_silver_loader: Silver Loader
Langfuse trace ID: <trace-id>
```

Generated artifacts land in:

```text
backend/artifacts/<job_id>/
```

Check that Silver rows landed:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT job_id, count() AS rows, uniqExact(event_name) AS events
FROM silver.express_checkout_events
GROUP BY job_id
ORDER BY job_id
"
```

Open the loader report:

```text
backend/artifacts/<job_id>/06_silver_loader/load_report.json
```

Check active context for generated features:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT feature_slug, job_id, table_name, primary_entity, workflow_type, success_event
FROM context.feature_registry FINAL
ORDER BY updated_at DESC
LIMIT 10
"
```

Check pipeline run tracking:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT job_id, status, trace_id
FROM ops.pipeline_runs FINAL
ORDER BY updated_at DESC
LIMIT 10
"
```

Check stage tracking for one job:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT stage_id, status
FROM ops.pipeline_stages
WHERE job_id = '<job_id>'
ORDER BY recorded_at
"
```

## Current Pipeline Behavior

```text
1. Reads spec.md and events.ndjson.
2. Profiles raw events.
3. Uses Groq to create a feature manifest.
4. Generates schema.sql and mapping.json.
5. Reviews schema quality.
6. Executes schema.sql in ClickHouse.
7. Normalizes events.ndjson into JSONEachRow.
8. Inserts rows into silver.<feature>_events.
9. Validates row count, event names, event IDs, timestamp range, and success event.
10. Updates ClickHouse context memory only after validation passes.
11. Tracks run/stage state in ops.pipeline_runs and ops.pipeline_stages.
12. Writes a Langfuse trace ID into run_summary.json.
```

## Production / Demo Switch

For demo, point the same pipeline to ClickHouse Cloud.

Update `backend/.env` first:

```env
CLICKHOUSE_URL=https://<cloud-host>:8443
CLICKHOUSE_USER=<user>
CLICKHOUSE_PASSWORD=<password>
CLICKHOUSE_DATABASE=atlys
```

Keep Langfuse either local or cloud-hosted:

```env
LANGFUSE_BASE_URL=http://localhost:3000
```

or:

```env
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

Then run the same traced setup command against Cloud:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon/backend
pnpm cli setup
```

This command uses `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, and `CLICKHOUSE_DATABASE`, so it targets local ClickHouse or ClickHouse Cloud depending on `backend/.env`.

The command invokes `data/load.sh`; for Cloud, make sure `clickhouse-client` is
available and the target database is empty/fresh.

Before final demo, run:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon/backend
pnpm exec tsc --noEmit
pnpm cli run ../specs/06_unseen_spec_folder
```

Final artifacts to show:

```text
schema.sql
validation_report.json
context_diff.md
run_summary.json
Langfuse trace
```
