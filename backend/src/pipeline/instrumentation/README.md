# Instrumentation Pipeline

This folder owns only the instrumentation agent flow: taking one feature spec package, preserving the raw input in Bronze, retrieving current context, designing a typed Silver table through a schema feedback loop, loading validated rows, creating reusable aggregation views, and updating context for the next spec.

The public entrypoint is `runInstrumentationAgent` in `orchestrator.ts`. The compatibility export used by the rest of the backend is `backend/src/pipeline/instrumentation.ts`.

## Scope

Instrumentation does:

- Read `spec.md` and `events.ndjson` from one spec folder.
- Persist raw spec/event data into Bronze ClickHouse tables.
- Profile raw events.
- Parse product semantics into a feature manifest.
- Run a schema design feedback loop: LLM full-plan draft, LLM schema critic, LLM revision when needed, deterministic fallback, guardrail review, repair.
- Generate and review a Silver ClickHouse schema.
- Define reusable materialized views / aggregations when useful.
- Create/load the Silver table and materialized views.
- Update context memory only after Silver validation passes.
- Emit Langfuse observations and `ops.pipeline_stages` records for each step.

Instrumentation does not:

- Run PM-facing analytics.
- Produce the full PM-facing Gold analytics layer.
- Generate insights or recommendations.
- Answer user questions.

Those later concerns belong to the analytics/orchestration/gold layers outside this folder.

## Main Flow

`orchestrator.ts` wires the stages in this exact order:

```text
spec folder
  -> 01 Bronze Ingest
  -> 02 Event Profiler
  -> 03 Spec Parser
  -> 04 Schema Generator
       -> Groq full schema plan draft when available
       -> Groq schema critic review
       -> Groq schema revision when critic requests changes
       -> deterministic fallback when unavailable or invalid
       -> deterministic guardrail review
       -> deterministic repair when needed
       -> materialized view / aggregation plan
  -> 05 Schema Critic (blocking gate)
  -> 06 Silver Loader
  -> 07 Context Updater
```

The important agent loop is:

```text
observe raw spec/events + retrieve context
  -> reason about entities, workflow, schema, ordering, TTL, and aggregations
  -> critique the plan with an LLM schema critic
  -> revise with the schema designer when needed
  -> validate with deterministic guardrails
  -> repair unsafe output before execution
  -> act in ClickHouse
  -> remember the validated schema in context
```

Each stage has a small file and a single main function. Shared types live in `types.ts`. Shared event utilities live in `eventUtils.ts`. Tracking definitions live in `trackingEvents.ts`.

## Tracking Contract

`trackingEvents.ts` is the control file for instrumentation tracking.

It defines, for every instrumentation step:

- Langfuse observation name.
- `ops.pipeline_stages` stage ID and stage name.
- Agent label.
- Source layer and target layer.
- ClickHouse tables written by the step.
- Artifact files created by the step.
- Tracked inputs.
- Tracked outputs.
- Human description.

When adding or renaming an instrumentation step, update `trackingEvents.ts` first. The stage modules import from this file so the tracked event names are not scattered across the codebase.

## Step Details

### 01 Bronze Ingest

File: `bronzeIngest.ts`

Main function: `runBronzeIngest`

Tracking event: `instrumentationTrackingEvents.bronzeIngest`

Input:

- `jobId`
- `featureSlug`
- path to `spec.md`
- path to `events.ndjson`
- artifact root

What happens:

- Reads the raw spec markdown.
- Reads raw NDJSON events.
- Parses NDJSON only enough to validate that each line is valid JSON and extract `event`.
- Inserts the full spec into `bronze.feature_specs`.
- Inserts every raw event into `bronze.feature_events`.
- Validates that Bronze row counts match the expected file counts.

ClickHouse writes:

- `bronze.feature_specs`
- `bronze.feature_events`

Artifact:

- `01_bronze_ingest/bronze_report.json`

Output to next step:

- `specMarkdown`
- `eventsNdjson`
- `rawEvents`
- Bronze ingest report

Why this matters:

Bronze is the audit layer. If Silver looks wrong later, the raw payload is still queryable by `job_id`, `feature_slug`, and `source_line`.

### 02 Event Profiler

File: `eventProfiler.ts`

Main function: `runEventProfiler`

Tracking event: `instrumentationTrackingEvents.eventProfiler`

Input:

- `rawEvents` from Bronze ingest
- `featureSlug`

What happens:

- Counts rows.
- Counts events by event name.
- Finds field paths.
- Infers simple JSON types.
- Tracks null counts.
- Stores sample values for schema inference.

ClickHouse writes:

- None.

Artifact:

- `02_event_profiler/event_profile.json`

Output to next step:

- `EventProfile`

Why this matters:

The schema generator should not guess blindly. It uses the event profile to decide column names, nullability, and rough ClickHouse types.

### 03 Spec Parser

File: `specParser.ts`

Main function: `runSpecParser`

Tracking event: `instrumentationTrackingEvents.specParser`

LLM generation event:

- `groq.feature_manifest`

Input:

- spec markdown from Bronze ingest
- event profile from Event Profiler
- context bundle from the context layer

What happens:

- Sends spec, event profile, and compact context to Groq.
- Uses `openai/gpt-oss-20b` unless `GROQ_MODEL` overrides it.
- Asks for a strict JSON feature manifest.
- Falls back to deterministic parsing if Groq fails.
- Repairs obvious semantic mistakes using event evidence.

Manifest fields:

- `feature_slug`
- `feature_name`
- `primary_entity`
- `workflow_type`
- `event_order`
- `success_event`
- `metric_hints`
- `context_notes`

ClickHouse writes:

- None.

Artifact:

- `03_spec_parser/feature_manifest.json`

Output to next step:

- `FeatureManifest`

Why this matters:

This is the semantic observation step. It converts raw product language into structured feature semantics that drive the schema design loop and later analytics.

### 04 Schema Generator

File: `schemaGenerator.ts`

Main function: `runSchemaGenerator`

Tracking event: `instrumentationTrackingEvents.schemaGenerator`

Input:

- feature manifest from Spec Parser
- event profile from Event Profiler
- current context bundle from the Context Provider

What happens:

- Asks Groq for a full schema plan using the manifest, event profile, and current context when a model is available.
- Asks a Groq schema critic to review whether the plan answers PM questions, handles context contradictions, and uses ClickHouse well.
- Sends critic feedback back into a Groq schema revision round when the critic asks for changes.
- Treats the event profile and spec as source of truth; context is supporting evidence because the base context can be wrong.
- Falls back to a deterministic evidence-based schema plan when Groq is unavailable or returns invalid JSON.
- Normalizes the LLM draft: existing raw paths only, allowed pipeline columns only, valid ClickHouse types only, nullable source fields stay nullable, non-nullable `ORDER BY` columns only, and `event_id` retained for safe `ReplacingMergeTree` dedupe.
- Runs deterministic guardrails over the plan.
- Repairs missing required columns, unmapped fields, invalid ordering keys, missing timestamp ordering, and unsafe dedupe keys before execution.
- Adds standard analytical columns such as `job_id`, `event_name`, `event_id`, and `timestamp`.
- Converts raw event field paths into ClickHouse column names.
- Infers ClickHouse types.
- Avoids nullable columns in `ORDER BY`.
- Preserves raw payload as `raw_json`.
- Defines a reusable Gold materialized view for daily event and unique-user counts, adding segment dimensions when present.
- Creates the final `CREATE TABLE` SQL.
- Creates a mapping plan from raw JSON fields to Silver columns.

ClickHouse writes:

- None in this stage. SQL is generated but not executed here.

Artifacts:

- `04_schema_generator/schema_design_loop.json`
- `04_schema_generator/schema_plan.json`
- `04_schema_generator/schema.sql`
- `04_schema_generator/materialized_views.sql`
- `04_schema_generator/mapping.json`

Output to next step:

- `schemaPlan`
- `schemaSql`
- `mappingPlan`

Why this matters:

This is the core Instrumentation Agent reasoning loop. LLM help is allowed for schema strategy, but deterministic guardrails own correctness before anything touches ClickHouse.

### 05 Schema Critic

File: `schemaCritic.ts`

Main function: `runSchemaCritic`

Tracking event: `instrumentationTrackingEvents.schemaCritic`

Input:

- schema plan from Schema Generator
- event profile
- feature manifest

What happens:

- Checks for important analytical columns.
- Checks whether `ORDER BY` contains `timestamp`.
- Checks whether `ORDER BY` contains `event_id` to prevent accidental `ReplacingMergeTree` collapse.
- Checks whether repeated dimensions use `LowCardinality`.
- Checks nested fields were flattened.
- Checks that a reusable materialized view / aggregation was defined.
- Writes a markdown review.
- Blocks execution when warnings remain.

ClickHouse writes:

- None.

Artifact:

- `05_schema_critic/schema_review.md`

Output to next step:

- Structured review with markdown text and warnings.

Why this matters:

This is the final quality gate before SQL execution. The schema design loop should repair issues before this point; if it does not, the critic stops the run so bad schemas do not become bad memory.

### 06 Silver Loader

File: `silverLoader.ts`

Main function: `runSilverLoader`

Tracking event: `instrumentationTrackingEvents.silverLoader`

Input:

- schema SQL from Schema Generator
- schema plan from Schema Generator
- raw events from Bronze ingest
- event profile
- feature manifest

What happens:

- Executes `CREATE TABLE IF NOT EXISTS silver.<feature_slug>_events`.
- Executes any generated Gold aggregation target tables and materialized views.
- Normalizes each raw event into the generated schema.
- Inserts rows with `FORMAT JSONEachRow`.
- Validates the inserted Silver rows.

Validation checks:

- actual row count equals expected row count
- expected event names exist
- `event_id` is not missing
- timestamp min/max can be queried
- success event exists if the manifest defines one

ClickHouse writes:

- `silver.<feature_slug>_events`
- `gold.<feature_slug>_daily_event_counts`
- `gold.<feature_slug>_daily_event_counts_mv`

Artifact:

- `06_silver_loader/load_report.json`

Output to next step:

- `SilverLoadReport`

Why this matters:

This is where Bronze becomes useful typed data. Context is updated only after this stage passes validation.

### 07 Context Updater

File: `contextUpdater.ts`

Main function: `runContextUpdater`

Tracking event: `instrumentationTrackingEvents.contextUpdater`

Input:

- feature manifest
- schema plan
- Silver load report

What happens:

- Writes validated feature/table/entity/event context into ClickHouse context memory.
- Writes feature facts into the fact registry.
- Produces a context diff artifact.

ClickHouse writes:

- `context.feature_registry`
- `context.fact_registry`

Artifacts:

- `07_context_agent/context_diff.md`
- `07_context_agent/updated_context.json`

Output:

- Updated generated context registry.

Why this matters:

This is how spec 02 can know what spec 01 created. The context layer becomes the memory source for future instrumentation and analytics.

## File Map

Instrumentation files:

- `orchestrator.ts`: calls the stages in order.
- `trackingEvents.ts`: single source of truth for instrumentation tracking events.
- `bronzeIngest.ts`: raw spec/event persistence into Bronze.
- `eventProfiler.ts`: deterministic event profiling.
- `specParser.ts`: Groq-backed manifest generation plus deterministic fallback/repair.
- `schemaGenerator.ts`: schema design feedback loop, Silver schema, materialized view plan, and mapping generation.
- `schemaCritic.ts`: blocking schema review.
- `silverLoader.ts`: Silver table / materialized view creation, normalization, insert, validation.
- `contextUpdater.ts`: writes validated context memory.
- `eventUtils.ts`: NDJSON parsing, event profiling helpers, field-name utilities.
- `artifacts.ts`: writes per-stage local debug artifacts.
- `types.ts`: shared TypeScript contracts.

External files used by instrumentation:

- `../clickhouse.ts`: executes ClickHouse SQL and queries.
- `../context.ts`: loads context and updates generated context memory.
- `../groq.ts`: calls Groq/OpenAI-compatible JSON generation.
- `../tracking.ts`: writes `ops.pipeline_runs`, `ops.pipeline_stages`, and setup tracking.
- `../../tracing/langfuse.ts`: starts/shuts down Langfuse tracing from the outer runner.
- `../runPipeline.ts`: outer pipeline runner that loads context and calls instrumentation.
- `../stages.ts`: full pipeline stage list; imports instrumentation stage metadata from `trackingEvents.ts`.

## Data Lineage

For one spec run, the important IDs are:

- `job_id`: unique run ID
- `feature_slug`: normalized spec folder name
- `event_id`: raw event ID from `id`
- `source_line`: original NDJSON line number in Bronze

Lineage path:

```text
specs/<feature>/events.ndjson
  -> bronze.feature_events.raw_json
  -> silver.<feature_slug>_events.raw_json
  -> gold.<feature_slug>_daily_event_counts
  -> context.feature_registry / context.fact_registry
```

Use `job_id` to connect:

- Bronze raw rows
- Silver normalized rows
- Context updates
- `ops.pipeline_stages`
- Langfuse trace observations

## How To Inspect A Run

Replace `<job_id>` and `<feature_table>` with the values printed by the CLI.

```sql
SELECT count()
FROM bronze.feature_events
WHERE job_id = '<job_id>';
```

```sql
SELECT event_name, count()
FROM bronze.feature_events
WHERE job_id = '<job_id>'
GROUP BY event_name
ORDER BY event_name;
```

```sql
SELECT count()
FROM silver.<feature_table>
WHERE job_id = '<job_id>';
```

```sql
SELECT stage_id, status, stage_output_json
FROM ops.pipeline_stages
WHERE job_id = '<job_id>'
ORDER BY recorded_at;
```

```sql
SELECT feature_slug, table_name, primary_entity, workflow_type, success_event
FROM context.feature_registry FINAL
ORDER BY updated_at DESC;
```

## Accuracy Notes

Current accuracy guarantees:

- Raw input is preserved in Bronze.
- Silver row count must match the profiled raw event count.
- Expected event names must exist in Silver.
- Missing `event_id` fails validation.
- Missing success event fails validation when a success event is defined.
- Schema Critic blocks execution if warnings remain after the design loop.
- Reusable daily event-count materialized views are created for every generated feature table.
- Context is updated only after Silver validation passes.

Current limitations:

- Duplicate collapse relies on `ReplacingMergeTree` behavior and ClickHouse merges.
- The manifest can use Groq, so deterministic repair exists to correct common feature semantics.
- The current materialized view is a reusable instrumentation aggregate, not the full PM-facing Gold analytics layer.
- Context memory still stores feature-level facts; richer column-level memory belongs in the next Context Agent pass.
