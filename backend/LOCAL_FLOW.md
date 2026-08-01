# Local Flow

This file describes the intended local development flow for the Schema Kings
backend.

## Final system flow

The final system is an agentic Medallion pipeline:

```text
feature package
spec.md + events.ndjson
        ↓
Bronze
raw spec, raw events, job metadata
        ↓
Silver
typed normalized ClickHouse feature tables
        ↓
Gold
business metrics, insights, recommendations
        ↓
PM query / demo UI
SQL-backed answer with trace
```

The agents act as the control plane over this data pipeline:

```text
Main Orchestrator
    ↓
Instrumentation Agent
    ↓
Schema Critic
    ↓
Context Agent
    ↓
Analytics Orchestrator
    ↓
Funnel / Segment / Correlation / Revenue / Anomaly logic
    ↓
Insight Writer
    ↓
Evidence Critic
```

Langfuse traces the whole run so the demo can prove how each artifact was
generated.

## Local services

### App ClickHouse

Used for the actual product analytics data:

```text
http://localhost:8123
```

This stores:

- `bronze.feature_specs`
- `bronze.feature_events`
- future `silver.<feature>_events` tables
- `gold.feature_metrics`
- `gold.feature_insights`

Start it with:

```bash
docker compose up -d
```

### Langfuse

Used only for tracing and observability:

```text
http://localhost:3000
```

Langfuse also runs its own internal ClickHouse on:

```text
http://localhost:8124
```

Do not put feature/spec data into Langfuse's internal ClickHouse. Your data goes
to `8123`; traces go to Langfuse.

Start Langfuse with:

```bash
docker compose --profile langfuse up -d
```

## Current CLI commands

### Pipeline placeholder

```bash
cd backend
pnpm cli run ../specs/05_instant_forex
```

Current behavior:

- prints the planned pipeline stages
- does not write artifacts yet
- does not touch ClickHouse yet
- does not call LLMs yet

### Langfuse mock trace

Create/select a Langfuse project, then add project keys to `backend/.env`:

```env
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://localhost:3000
```

Run:

```bash
cd backend
pnpm trace:test
```

Expected result:

- a trace named `schema-kings.mock-pipeline` appears in Langfuse
- it contains mock spans for Bronze, profiling, schema generation, context,
  analytics orchestration, and insight writing

## Intended real pipeline stages

### 1. Create job

Input:

```text
../specs/05_instant_forex
```

Output:

```text
job_id = 20260801T093000_05_instant_forex
```

Future artifact folder:

```text
backend/artifacts/<job_id>/
```

### 2. Bronze ingest

Reads:

```text
spec.md
events.ndjson
```

Writes to app ClickHouse `8123`:

```text
bronze.feature_specs
bronze.feature_events
```

Also writes local artifacts:

```text
01_bronze_ingest/bronze_ingest_report.json
```

Trace span:

```text
01_bronze_ingest
```

### 3. Event profiler

Reads raw events and summarizes:

- event names
- fields per event
- inferred field types
- nested fields
- missing rates
- candidate entity keys

Output:

```text
02_event_profiler/event_profile.json
```

Trace span:

```text
02_event_profiler
```

### 4. Spec parser

Reads:

- `spec.md`
- `event_profile.json`
- base context

Outputs structured feature understanding:

```text
03_spec_parser/feature_manifest.json
```

Example contents:

```json
{
  "feature_slug": "instant_forex",
  "primary_entity": "application_id",
  "funnel_order": [
    "forex_offer_shown",
    "currency_selected",
    "amount_entered",
    "forex_added_to_cart",
    "forex_purchased"
  ],
  "success_event": "forex_purchased",
  "primary_metrics": ["attach_rate", "aov_uplift"]
}
```

Trace span:

```text
03_spec_parser
```

### 5. Schema generator

Uses:

- feature manifest
- event profile
- ClickHouse schema rules

Generates:

```text
04_schema_generator/schema.sql
04_schema_generator/schema_plan.json
```

Example table:

```text
silver.silver_instant_forex_events
```

Trace span:

```text
04_schema_generator
```

### 6. Schema critic

Checks:

- are all fields covered?
- are types reasonable?
- is `ORDER BY` useful?
- are low-cardinality fields identified?
- are nested fields flattened?
- is the schema valid ClickHouse SQL?

Output:

```text
05_schema_critic/schema_review.json
05_schema_critic/schema_review.md
```

Trace span:

```text
05_schema_critic
```

### 7. Silver loader

Creates the approved Silver table and loads normalized events.

Writes to app ClickHouse `8123`:

```text
silver.silver_instant_forex_events
```

Output:

```text
06_silver_loader/load_report.json
```

Trace span:

```text
06_silver_loader
```

### 8. Context agent

Updates context with:

- new feature meaning
- new table
- event roles
- entity relationships
- metric definitions
- warnings or contradictions

Outputs:

```text
07_context_agent/context.generated.md
07_context_agent/context.json
07_context_agent/context_diff.md
```

Trace span:

```text
07_context_agent
```

### 9. Analytics orchestrator

Plans analysis and routes work to specialist logic:

- Funnel analysis
- Segment analysis
- Revenue analysis
- Correlation analysis
- Anomaly analysis

Outputs:

```text
08_analytics_orchestrator/query_plan.json
08_analytics_orchestrator/queries.sql
```

Trace span:

```text
08_analytics_orchestrator
```

### 10. Gold metrics

Runs SQL against Silver and existing tables.

Writes to app ClickHouse `8123`:

```text
gold.feature_metrics
```

Also writes:

```text
09_gold_metrics/metrics.json
09_gold_metrics/query_results.json
```

Trace span:

```text
09_gold_metrics
```

### 11. Insight writer

Turns aggregated results into PM-facing insight.

Output:

```text
10_insight_writer/insights.md
10_insight_writer/insights.json
```

Example:

```text
Instant Forex attach is strongest for UAE trips. Most drop-off happens after
amount entry, suggesting interest exists but users hesitate before adding forex
to cart.
```

Trace span:

```text
10_insight_writer
```

### 12. Evidence critic

Checks the insight against SQL results and context.

Output:

```text
11_evidence_critic/insight_review.md
11_evidence_critic/insight_review.json
```

Trace span:

```text
11_evidence_critic
```

### 13. Trace summary

Final output:

```text
12_trace_summary/run_summary.md
```

Includes:

- job id
- feature slug
- tables created
- metrics generated
- insight summary
- confidence notes
- Langfuse trace id/link

Trace span:

```text
12_trace_summary
```

## Demo flow

### Known specs

Run the pipeline for each known feature:

```bash
pnpm cli run ../specs/01_express_checkout
pnpm cli run ../specs/02_group_family
pnpm cli run ../specs/03_status_sharing
pnpm cli run ../specs/04_abandoned_checkout_recovery
pnpm cli run ../specs/05_instant_forex
```

Show:

- Bronze raw records
- generated Silver schema
- Gold metrics
- context diff
- insights
- Langfuse trace

### PM question

Example:

```text
Why did iOS users drop from completing checkout for Dubai visa?
```

Flow:

```text
PM question
    ↓
Context Agent resolves terms
    ↓
Analytics Orchestrator plans queries
    ↓
Specialist analysis runs SQL
    ↓
Insight Writer explains result
    ↓
Evidence Critic validates answer
    ↓
answer + evidence + trace
```

### Unseen sixth spec

When the sixth spec arrives:

```bash
pnpm cli run ../specs/06_unseen
```

The system should produce the same artifacts without hand-written schema or
hand-written insights.
