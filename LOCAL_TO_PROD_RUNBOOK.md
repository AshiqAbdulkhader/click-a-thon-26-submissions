# Schema Kings Runbook

This is the command checklist for running everything locally first, then switching
the same flow to ClickHouse Cloud before the demo.

## Local Reset

From the repo root:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon
```

Stop local services and delete only this project's Docker volumes:

```bash
docker compose --profile langfuse down -v
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

## Load Base Data Locally

Load the 8 provided Atlys tables into the local `schema_kings` database:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon/data

CH='docker compose -f ../docker-compose.yml exec -T clickhouse clickhouse-client --user schema_kings --password schema_kings' \
DB=schema_kings \
./load.sh
```

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

Check pipeline databases/tables:

```bash
docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT database, name
FROM system.tables
WHERE database IN ('bronze', 'silver', 'gold', 'schema_kings')
ORDER BY database, name
"
```

Bootstrap base context into ClickHouse memory:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon/backend
pnpm cli context:bootstrap
```

Verify ClickHouse-backed context memory:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon

docker compose exec -T clickhouse clickhouse-client \
  --user schema_kings \
  --password schema_kings \
  --query "
SELECT database, name
FROM system.tables
WHERE database IN ('context', 'ops')
ORDER BY database, name
"
```

Expected context/ops tables:

```text
context.context_documents
context.contradictions
context.fact_registry
context.feature_registry
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

Load base data to Cloud:

```bash
cd /Users/shivamtaneja/projects/clickhouse/schema-kings-clickathon/data

CH='clickhouse-client --host <cloud-host> --user <user> --password <password> --secure' \
DB=atlys \
./load.sh
```

Update `backend/.env`:

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
