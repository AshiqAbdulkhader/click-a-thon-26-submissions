# Problem Solution

## 12-word pitch

Traceable ClickHouse agent pipeline: spec in, validated tables and insights out.

## Current Architecture

The system is a local-first Medallion pipeline with an agentic control plane.

```text
Feature package: spec.md + events.ndjson
        ↓
Instrumentation Agent
        ↓
Schema Critic
        ↓
Silver Loader + Validator
        ↓
Context Agent v0
        ↓
Analytics Harness / specialist agents
        ↓
Gold metrics + PM-facing insights
        ↓
Langfuse trace + run artifacts
```

The key principle is accuracy before coverage:

```text
LLM proposes semantics.
Code profiles and transforms data.
ClickHouse stores and validates data.
Context is updated only with validated facts.
Langfuse proves what happened.
```

## Implemented Flow

The current CLI flow is:

```bash
cd backend
pnpm cli run ../specs/01_express_checkout
```

For each feature spec, the pipeline does:

1. Creates a `job_id`.
2. Reads `spec.md` and `events.ndjson`.
3. Profiles raw events deterministically.
4. Uses Groq `openai/gpt-oss-20b` to produce a feature manifest.
5. Generates ClickHouse Silver DDL and an event-to-column mapping.
6. Reviews schema quality.
7. Executes the generated `CREATE TABLE` in ClickHouse.
8. Normalizes raw NDJSON into ClickHouse `JSONEachRow`.
9. Inserts rows into `silver.<feature>_events`.
10. Validates row count, event names, event IDs, timestamp range, and success event.
11. Updates ClickHouse context memory only after validation passes.
12. Tracks run/stage state in ClickHouse `ops.*` tables.
13. Writes artifacts and a Langfuse trace ID.

Current artifacts:

```text
backend/artifacts/<job_id>/
  01_bronze_ingest/bronze_report.json
  02_event_profiler/event_profile.json
  03_spec_parser/feature_manifest.json
  04_schema_generator/schema_plan.json
  04_schema_generator/schema.sql
  04_schema_generator/mapping.json
  05_schema_critic/schema_review.md
  06_silver_loader/load_report.json
  07_context_agent/context_diff.md
  07_context_agent/updated_context.json
  run_summary.json
```

## Component Responsibilities

### 1. Instrumentation Agent

The Instrumentation Agent is responsible for feature onboarding.

It takes:

- feature spec markdown
- raw event NDJSON
- base context
- existing DDL
- previous generated context

It produces:

- `event_profile.json`
- `feature_manifest.json`
- `schema_plan.json`
- `schema.sql`
- `mapping.json`

It performs light, schema-safe normalization:

- parse JSON
- flatten nested fields
- standardize `event` into `event_name`
- standardize `id` into `event_id`
- parse timestamps
- preserve `raw_json`
- infer ClickHouse-compatible column types

It does not try to solve every possible data-quality issue. It focuses on
correctly representing the feature events that are present.

### 2. Schema Critic

The Schema Critic checks whether the generated schema is usable before loading.

Checks include:

- required analytical columns exist
- timestamps are typed
- event IDs exist
- nested fields are flattened
- `ORDER BY` supports time/entity/event queries
- schema is not an all-string dump
- ClickHouse types are valid for the local/server version

The output is:

```text
05_schema_critic/schema_review.md
```

### 3. Silver Loader + Validator

The Silver Loader is the stage that actually saves the feature data in
ClickHouse.

It does:

```text
execute schema.sql
normalize events.ndjson
insert rows into silver.<feature>_events
run validation queries
write load_report.json
```

Validation currently checks:

- inserted row count equals raw event count
- all observed event names exist in Silver
- `event_id` is present
- timestamp range is valid
- manifest success event exists

If validation fails, the pipeline fails before context is updated.

This matters because the context layer should not learn from bad loads.

### 4. Context Agent v1

The context step is now ClickHouse-backed. Local files are source inputs, but
ClickHouse is the source of truth for active context memory.

Current responsibilities:

- read `base_context.md`
- read existing table DDL
- read instrumentation notes
- ingest those documents into `context.context_documents`
- read generated feature/table/fact context from ClickHouse
- update ClickHouse context after a validated Silver load
- record known contradictions in the base context

Current context tables:

```text
context.context_documents
context.feature_registry
context.fact_registry
context.contradictions
```

The context update records:

- feature slug
- generated Silver table
- primary entity
- event names
- success event
- metric hints
- known context contradictions

The important rule:

```text
Context is updated only after the Silver Loader validation passes.
```

Active context reads use `FINAL` on replacing tables so the harness sees the
latest validated feature facts, while older attempts remain queryable for audit.

### 5. Analytics Harness

This is the next major component.

The Harness will be the PM-facing orchestrator. It will not blindly query raw
files. It will use:

- validated Silver tables
- structured context registry
- base Atlys context
- existing base tables in `schema_kings`
- specialist analytics modules

Planned specialist modules:

- Funnel Agent
- Segment Agent
- Revenue Agent
- Anomaly Agent
- Correlation Agent
- Insight Writer
- Evidence Critic

The Harness flow:

```text
PM question
    ↓
read context
    ↓
select relevant tables/metrics
    ↓
call specialist query modules
    ↓
run SQL in ClickHouse
    ↓
write Gold metrics
    ↓
generate PM-facing answer
    ↓
evidence-check answer
    ↓
return answer + SQL + trace
```

## Context Memory Strategy

The main source of context should be **validated structured context**, not a
generic memory layer.

Recommended source of truth:

```text
ClickHouse:
  bronze/silver/gold data
  validated tables
  context.context_documents
  context.feature_registry
  context.fact_registry
  context.contradictions
  ops.pipeline_runs
  ops.pipeline_stages

Versioned files:
  generated context diffs
  run artifacts
```

Why this is the best fit:

- ClickHouse is already the required primary datastore.
- Judges can inspect the data and SQL.
- Context facts can be tied to evidence.
- Validation can gate context updates.
- It avoids fuzzy retrieval becoming the source of truth.

External memory systems such as Supermemory can be useful later as a retrieval
layer, but should not be authoritative for this hackathon.

Use this rule:

```text
Memory/RAG can help retrieve context.
ClickHouse + validated registry decide truth.
```

Every context fact should eventually look like this:

```json
{
  "fact": "status_sharing uses share_id as the primary entity",
  "confidence": 1.0,
  "evidence": [
    "spec says recipient events are keyed by share_id",
    "event profile shows share_id on status-sharing events",
    "silver load validation passed"
  ],
  "source_artifacts": [
    "03_spec_parser/feature_manifest.json",
    "02_event_profiler/event_profile.json",
    "06_silver_loader/load_report.json"
  ]
}
```

That is the right architecture for the mentor's advice: cover a smaller surface
area, but make the facts defensible.

## Data Plane

### Base Tables

The eight provided base tables are loaded into the app ClickHouse database
`schema_kings`:

```text
destination_card_clicked
application_started
document_uploaded
purchase_completed
search_typed
landing_page_scrolled
auth_completed
pay_now_clicked
```

These are the existing Atlys product tables.

### Bronze

Bronze stores raw feature-package information and raw event payloads.

Current local init creates:

```text
bronze.feature_specs
bronze.feature_events
```

The current CLI writes Bronze artifacts locally; the next hardening pass should
also insert raw specs/events into the Bronze ClickHouse tables so replay input is
fully database-backed.

### Silver

Silver stores validated typed feature-event tables.

Examples:

```text
silver.express_checkout_events
silver.status_sharing_events
silver.instant_forex_events
```

Analytics should query Silver, not raw NDJSON.

### Gold

Gold will store business-ready outputs:

```text
gold.feature_metrics
gold.feature_insights
```

This is where the Analytics Harness will write aggregate metrics, insight
summaries, confidence scores, and evidence JSON.

## Tracing

Langfuse is integrated into the real pipeline.

ClickHouse also tracks run/stage state independently of Langfuse:

```text
ops.pipeline_runs
ops.pipeline_stages
```

Trace structure:

```text
schema-kings.pipeline
  00_context_provider
  01_bronze_ingest
  02_event_profiler
  03_spec_parser
    groq.feature_manifest
  04_schema_generator
  05_schema_critic
  06_silver_loader
  07_context_agent
  12_trace_summary
```

The Groq call is traced as a Langfuse generation with:

- model name
- compact input metadata
- parsed output status
- token usage when available

The run summary stores:

```text
langfuse_trace_id
```

## Local Development Flow

1. Start local ClickHouse.
2. Load the eight base tables.
3. Start Langfuse.
4. Run instrumentation for each known spec.
5. Confirm `silver.<feature>_events` tables exist.
6. Confirm `06_silver_loader/load_report.json` passes.
7. Build Analytics Harness on top of validated Silver data.

See:

```text
LOCAL_TO_PROD_RUNBOOK.md
```

## Demo Flow

For the final unseen spec:

```text
new spec folder
    ↓
pnpm cli run ../specs/06_unseen
    ↓
schema.sql generated
    ↓
Silver table created
    ↓
events inserted and validated
    ↓
context updated
    ↓
analytics harness generates PM-facing answer
    ↓
Langfuse trace proves the path
```

Demo artifacts to show:

- generated schema
- `load_report.json`
- context diff
- ClickHouse table with inserted rows
- SQL query output
- PM-facing insight
- Langfuse trace

## What Is Still To Build

Next major pieces:

1. Insert raw feature packages into Bronze ClickHouse tables, not only local
   artifacts.
2. Harden validation checks per workflow type.
3. Promote Context Agent v0 into a structured Context Agent with evidence-backed
   facts.
4. Build Analytics Harness.
5. Build specialist query modules.
6. Write Gold metrics and insights.
7. Add Evidence Critic for PM-facing summaries.

## Key Decisions

- ClickHouse remains the primary datastore.
- The system is local-first but can switch to Cloud through env vars.
- Groq `openai/gpt-oss-20b` is used for schema/context reasoning.
- LLM output is never trusted without deterministic validation.
- Context updates are gated by successful Silver loads.
- Langfuse traces every meaningful stage.
- Accuracy matters more than covering every possible analytic question.
