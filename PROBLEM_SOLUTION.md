# Problem Solution

## 12-word pitch

Agentic Medallion pipeline turning feature specs into ClickHouse insights and traces.

## High-level summary

This project builds an agentic Medallion architecture for Atlys feature analytics.
Each feature folder is treated as a feature package: a product spec plus raw event
samples. The system ingests that package into Bronze, normalizes it into typed
ClickHouse tables in Silver, and produces product-ready metrics, insights, and
answers in Gold.

The important idea is not just "ask an LLM questions about data". The system must
show a repeatable path from feature spec to analytics output, with inspectable
artifacts and Langfuse traces proving what happened at each step.

## What we are building

We are building a feature-spec-to-insight pipeline for ClickHouse using a
Medallion data plane and an agentic control plane.

Input:

- Feature spec markdown
- Raw NDJSON event samples
- Existing Atlys context
- Existing ClickHouse tables

Output:

- Bronze raw feature-event records
- Silver typed feature-event tables
- Gold business metrics and insights
- Generated ClickHouse schema
- Event-to-table mapping
- Updated context layer
- SQL analysis results
- Product-facing insight summary
- Trace showing how the system produced the result

## Architecture

The architecture has two parts:

1. Data plane: Bronze, Silver, and Gold layers in ClickHouse.
2. Control plane: orchestrator, specialist agents, MCP/tool access, and tracing.

The intended architecture is a disciplined multi-agent system, not an open-ended
recursive agent group chat. Agents can specialize, but every stage should produce
inspectable artifacts.

```text
Feature package: spec.md + events.ndjson
        ↓
Bronze Layer
raw spec, raw event JSON, job metadata
        ↓
Instrumentation Agent
profiles events, designs schema, validates mapping
        ↓
Silver Layer
typed normalized ClickHouse feature tables
        ↓
Context Agent
updates feature, metric, entity, and table context
        ↓
Analytics Orchestrator
calls funnel, segment, correlation, revenue, and anomaly analysis modules/agents
        ↓
Gold Layer
business metrics, insight summaries, confidence scores, recommendations
        ↓
PM Interface / Demo UI
answers user questions using Gold, Silver, context, and ClickHouse
        ↓
Langfuse Trace
proves the full path from input to answer
```

### Bronze layer

Bronze preserves the raw feature package exactly as received.

Bronze stores:

- `spec.md`
- raw `events.ndjson`
- raw JSON event payloads
- `feature_slug`
- `job_id`
- source path
- ingestion timestamp

Example table:

```text
bronze_feature_events
```

Purpose:

- never lose source data
- allow replaying a run
- prove what input the system received
- support the unseen sixth spec without manual preparation

LLM usage:

- not required for Bronze
- this layer should be deterministic and boring

### Silver layer

Silver turns raw feature events into reliable typed analytical tables.

Silver does:

- flatten JSON
- cast timestamps and primitive types
- standardize event names
- deduplicate if needed
- extract common columns like `user_id`, `application_id`, `device_type`,
  `geoip_country_code`, and `destination`
- create feature-specific typed ClickHouse tables

Example tables:

```text
silver_express_checkout_events
silver_group_family_events
silver_status_sharing_events
silver_abandoned_checkout_recovery_events
silver_instant_forex_events
silver_unseen_feature_events
```

Important nuance:

Silver is not only "load the data". Silver is where schema quality lives. The
Instrumentation Agent must decide what table to create, what columns and types to
use, which fields to flatten, which entity key matters, and what `ORDER BY` makes
sense for ClickHouse analytics.

LLM usage:

- not needed for basic flattening, deduping, or type casting
- useful for schema reasoning and semantic choices, such as knowing that
  `share_id` is the key for recipient-side status-sharing events

### Gold layer

Gold is the business-ready layer the PM and judges care about.

Gold contains:

- funnel metrics
- segment metrics
- revenue/add-on metrics
- correlation findings
- anomaly findings
- product insight summaries
- confidence/evidence notes
- PM-facing recommendations

Example Gold outputs:

```text
gold_feature_funnel_metrics
gold_feature_segment_metrics
gold_feature_insights
gold_context_registry
```

Gold is where the Analytics Orchestrator invokes specialist analysis agents or
modules and writes the final answerable business layer.

### Agent control plane

The agent layer coordinates the transformations and reasoning.

Proposed agents/modules:

1. Main Orchestrator
2. Instrumentation Agent
3. Schema Critic / Validator
4. Context Agent
5. Analytics Orchestrator
6. Funnel Agent
7. Segment Agent
8. Correlation Agent
9. Revenue Agent
10. Anomaly Agent
11. Insight Writer Agent
12. Evidence Critic Agent

The PM should experience one coherent system. Internally, specialist agents can
divide the work, but the orchestrator owns the flow.

MCP/tool usage:

- query ClickHouse
- inspect schemas
- execute DDL/DML
- read/write run artifacts
- read/write context
- run validations

Langfuse usage:

- trace every agent step
- trace every LLM call
- trace important SQL/DDL decisions
- attach generated artifacts and confidence/evidence notes
- prove the sixth spec output came from the pipeline

## Pipeline flow

For every known spec folder, and eventually the unseen sixth spec, the system
should run the same flow:

1. Create a `job_id`.
2. Ingest `spec.md` and `events.ndjson` into Bronze.
3. Profile raw events.
4. Parse the feature spec into a structured manifest.
5. Generate a Silver ClickHouse schema and mapping.
6. Validate the schema.
7. Create Silver table(s) and load normalized events.
8. Update the context layer.
9. Generate and run analytics queries.
10. Store Gold metrics/results.
11. Write product-facing insights.
12. Validate insights against evidence.
13. Save a run summary and Langfuse trace.

Each stage should emit a concrete artifact that can be inspected during the demo.
For example, the schema stage emits DDL, the context stage emits a context diff,
and the analytics stage emits SQL plus result tables.

## Demo modes

### Mode 1: feature onboarding

Show the system ingesting each known feature package:

```text
specs/01_express_checkout
specs/02_group_family
specs/03_status_sharing
specs/04_abandoned_checkout_recovery
specs/05_instant_forex
```

For each package, show:

- Bronze raw ingest
- Silver generated schema and normalized table
- Gold metrics and insights
- context update
- Langfuse trace

### Mode 2: PM query

A PM asks a natural-language question, for example:

> Why did iOS users drop from completing checkout for Dubai visa?

The flow:

```text
PM question
    ↓
Main Orchestrator
    ↓
Context Agent resolves business meaning
    ↓
Analytics Orchestrator chooses analysis plan
    ↓
Specialist agents/modules run ClickHouse SQL
    ↓
Insight Writer explains the result
    ↓
Evidence Critic checks the claims
    ↓
Answer + SQL evidence + trace
```

### Mode 3: unseen sixth spec

When the sixth spec is released, the same pipeline should run without hand-written
schema or hand-written insights:

```text
specs/06_unseen
    ↓
Bronze
    ↓
Silver
    ↓
Gold
    ↓
trace-backed submission artifacts
```

## Stage-by-stage explanation

### 1. Spec Parser

What it does:

Reads the product feature brief and turns it into a structured understanding of
the feature.

Like I am 5:

The spec is a story. The Spec Parser turns the story into a checklist.

Example:

Input says:

> Instant Forex lets users add foreign currency at checkout.

The parser outputs:

- Feature name: Instant Forex
- Goal: increase order value
- Main success event: `forex_purchased`
- Main metric: attach rate
- Funnel: offer shown -> amount entered -> added to cart -> purchased

Implementation idea:

- Use code to read `spec.md`.
- Use code to parse obvious sections like "What it does", "User actions", and
  "Questions the PM will ask".
- Use an LLM prompt to convert the spec into strict JSON.
- Validate the JSON before letting the next stage use it.

Output artifact:

- `feature_manifest.json`

### 2. Event Profiler

What it does:

Reads the raw `events.ndjson` sample and learns what the data actually contains.

Like I am 5:

The spec says what should happen. The Event Profiler checks what actually showed
up in the event box.

Example:

It sees rows like:

```json
{"event": "forex_offer_shown", "fx_rate": 83.1}
{"event": "forex_purchased", "addon_value_inr": 5000}
```

It outputs:

- Event names found
- Fields found per event
- Field types
- Nested fields
- Missing fields
- Example values
- Candidate IDs such as `user_id`, `application_id`, `share_id`, `group_id`

Implementation idea:

- This should mostly be deterministic code, not LLM.
- Read NDJSON line by line.
- Flatten nested fields.
- Infer simple types: string, integer, float, boolean, timestamp.
- Count how often each field appears.

Output artifact:

- `event_profile.json`

### 3. Schema Generator

What it does:

Designs the ClickHouse table or tables for the new feature.

Like I am 5:

The Schema Generator designs the shelves where the new event data will be stored.
It decides which labels each shelf needs and how to arrange them so finding things
later is fast.

Example:

For Instant Forex, it may generate:

```sql
CREATE TABLE silver_instant_forex_events
(
    id UUID,
    timestamp DateTime64(3),
    user_id String,
    application_id Nullable(String),
    event_name LowCardinality(String),
    device_type LowCardinality(Nullable(String)),
    destination LowCardinality(Nullable(String)),
    from_currency LowCardinality(Nullable(String)),
    to_currency LowCardinality(Nullable(String)),
    fx_rate Nullable(Float64),
    amount Nullable(Float64),
    addon_value_inr Nullable(Float64)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, application_id, user_id, event_name);
```

Implementation idea:

- Use the `feature_manifest.json` and `event_profile.json`.
- Use rules for common fields like `id`, `timestamp`, `user_id`,
  `application_id`, `device_type`, and `destination`.
- Use an LLM for schema reasoning, but constrain it with ClickHouse rules.
- Save the generated DDL.

Output artifacts:

- `schema.sql`
- `schema_plan.json`

### 4. Schema Critic / Validator

What it does:

Checks whether the generated schema is good enough before it is used.

Like I am 5:

The Schema Critic is the teacher checking the homework before it gets submitted.

Example checks:

- Does every observed event field have a destination column?
- Are money fields numeric?
- Are repeated categories using `LowCardinality`?
- Is the table ordered by useful query fields, not just random IDs?
- Are nested JSON fields flattened?
- Is the schema valid ClickHouse SQL?
- Are materialized views actually useful, or just decoration?

Implementation idea:

- Use deterministic checks where possible.
- Use an LLM critic for judgement-heavy checks.
- Return either "pass" or "needs revision".
- If needed, send feedback back to the Schema Generator once or twice.

Output artifacts:

- `schema_review.md`
- `schema_review.json`

### 5. ClickHouse Executor

What it does:

Runs the approved DDL and moves data through Bronze and Silver in ClickHouse.

Like I am 5:

The Executor stores the raw box first, then builds clean shelves and puts the
right items on them.

Example:

It first stores raw events in Bronze, then runs:

```sql
CREATE TABLE silver_instant_forex_events ...
```

Then inserts rows from:

```text
specs/05_instant_forex/events.ndjson
```

Implementation idea:

- Connect to ClickHouse.
- Insert raw event JSON into Bronze.
- Create Silver database/table.
- Flatten NDJSON according to the approved schema.
- Insert typed normalized rows.
- Run verification queries like row count by event and null/missing checks.

Output artifacts:

- `execution_log.md`
- `load_report.json`
- `row_counts.json`

### 6. Context Updater

What it does:

Updates the living business/data context so later analysis understands the new
feature.

Like I am 5:

The Context Updater adds a new page to the team's notebook explaining what this
new feature means.

Example:

For Instant Forex, it adds:

- Feature: Instant Forex Add-on
- Table: `silver_instant_forex_events`
- Main entity: `application_id`
- Main metric: attach rate = purchased / offer shown
- Revenue field: `addon_value_inr`
- Related funnel step: checkout/payment

Implementation idea:

- Read existing `base_context.md`.
- Read the generated feature manifest and schema.
- Write a generated context entry.
- Flag contradictions or missing definitions.

Output artifacts:

- `context.generated.md`
- `context_diff.md`

### 7. Analytics Query Generator

What it does:

Creates the SQL needed to build Gold metrics and answer the PM's questions.

Like I am 5:

The Query Generator writes the questions in a language ClickHouse understands.
Specialist analytics agents can own different query families.

Example PM question:

> Which destinations attach best?

Generated SQL:

```sql
SELECT
    destination,
    uniqIf(application_id, event_name = 'forex_offer_shown') AS offers,
    uniqIf(application_id, event_name = 'forex_purchased') AS purchases,
    purchases / offers AS attach_rate
FROM silver_instant_forex_events
GROUP BY destination
ORDER BY attach_rate DESC;
```

Implementation idea:

- Use the feature manifest's PM questions and metrics.
- Generate a small query pack:
  - overall funnel
  - stage drop-off
  - segment cuts
  - latency or revenue distribution if present
  - comparison with existing funnel tables if relevant
- Route query families through specialist modules/agents:
  - Funnel Agent
  - Segment Agent
  - Correlation Agent
  - Revenue Agent
  - Anomaly Agent
- Validate SQL before running it.

Output artifacts:

- `queries.sql`
- `query_plan.json`
- Gold metric tables or result files

### 8. Insight Writer

What it does:

Turns query results into a clear product-facing summary.

Like I am 5:

The Insight Writer reads the numbers and explains what they mean.

Example:

Instead of saying:

> iOS attach rate is 0.11 and Android attach rate is 0.19.

It says:

> Instant Forex is underperforming on iOS. Android users attach at a meaningfully
> higher rate, so the product team should inspect the iOS checkout placement or
> rate display before expanding the rollout.

Implementation idea:

- Give the LLM only aggregated results, not raw rows.
- Include relevant context and known issues.
- Require evidence-backed claims.
- Produce a PM memo with confidence scores.

Output artifacts:

- `insights.md`
- `insights.json`

### 9. Insight Critic / Evidence Checker

What it does:

Checks whether the insight summary is actually supported by the query results.

Like I am 5:

The Insight Critic asks: "Did you really see that in the numbers, or are you
guessing?"

Example checks:

- Does every recommendation have supporting data?
- Are segment claims backed by a query result?
- Is the sample size large enough?
- Did the insight confuse correlation with causation?
- Did it mention relevant known issues from context?

Implementation idea:

- Use deterministic checks for missing evidence and low sample size.
- Use an LLM critic to review the memo.
- Add or reduce confidence where needed.

Output artifacts:

- `insight_review.md`
- `insight_review.json`

### 10. Trace and Visualization Layer

What it does:

Shows the full path from input spec to final insight.

Like I am 5:

The trace is the receipt. It proves what the system did.

Example trace:

```text
Read spec
Parsed feature
Profiled 10,000 events
Generated schema
Reviewed schema
Created ClickHouse table
Loaded rows
Updated context
Ran 8 queries
Generated insight
Reviewed insight
```

Implementation idea:

- Use Langfuse for agent and LLM traces.
- Store run artifacts locally as files.
- Build a simple dashboard or CLI output that shows:
  - current run
  - generated schema
  - context diff
  - SQL queries
  - insight summary
  - trace ID or trace link

Output artifacts:

- Langfuse trace
- `run_summary.md`
- optional dashboard view

## Key decisions

- ClickHouse is the primary datastore and analytical engine.
- The solution uses a Medallion architecture:
  - Bronze preserves raw feature packages and raw events.
  - Silver stores typed normalized feature-event tables.
  - Gold stores business-ready metrics, insights, and recommendations.
- The agent system is a control plane over the Medallion data plane.
- The system should push computation into ClickHouse instead of sending raw rows
  to an LLM.
- Agents should be used for reasoning-heavy steps such as schema design, context
  interpretation, metric selection, segment analysis, and insight writing.
- Analytics can be multi-agent internally, but the PM-facing experience should be
  one coherent orchestrated system.
- Deterministic validation should be used wherever possible for types, SQL
  validity, required fields, and schema conventions.
- Tracing is a core deliverable, not a bonus. Judges should be able to follow the
  reasoning chain from feature spec to final insight.
- The design should optimize for the unseen sixth spec, not overfit the five
  known specs.

## What is working conceptually

- The problem can be modeled as an agentic Medallion pipeline:
  feature package in, Bronze/Silver/Gold artifacts out.
- The known specs share enough structure to support a reusable approach:
  event families, funnel steps, entities, dimensions, and PM questions.
- The five known specs can be onboarded through the same path that will later
  handle the sixth unseen spec.
- ClickHouse is well suited for this because most analysis can be expressed as
  grouped aggregations, funnels, segment comparisons, and distribution queries.
- A critic stage is useful because judges will care about schema quality, not just
  whether the SQL runs.
- A living context layer is useful because the Analytics Agent needs business
  meaning, not just table names.

## Known broken / unresolved

- The exact agent framework is not finalized yet.
- The exact Silver table strategy is not finalized yet:
  one typed table per feature, one table per event, or hybrid.
- The context layer storage format is not finalized yet.
- The visualization layer is not finalized yet.
- The Langfuse trace structure is not finalized yet.
- Human approval gates are not finalized yet.
- The exact split between Analytics Orchestrator, Funnel Agent, Segment Agent,
  Correlation Agent, Revenue Agent, and Anomaly Agent is not finalized yet.
- The system does not yet prove it can generalize to the unseen sixth spec.
- The base context may contain contradictions and stale definitions; the system
  must detect and handle these rather than blindly trusting it.

## Demo story

During the demo, we should be able to show a new feature spec entering the system
and the following artifacts coming out:

- Bronze raw feature package and raw events
- generated schema
- schema validation notes
- created Silver ClickHouse table
- normalized feature events
- updated context diff
- Gold metrics and generated SQL analysis
- product insight summary
- confidence/evidence notes
- trace of the full pipeline

The strongest version of the demo is the unseen sixth spec: the system should run
on it with minimal manual intervention and produce credible artifacts that match
the trace.
