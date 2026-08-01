# Problem Solution

## 12-word pitch

Turn feature specs into ClickHouse schemas, analytics, context, insights, and traces.

## High-level summary

This project builds an agentic analytics system for Atlys. Given a new product
feature spec and raw event samples, the system should automatically prepare the
analytics layer that would normally require product, engineering, and analytics
handoffs.

At a high level, the system reads a feature brief, understands the emitted events,
designs ClickHouse tables, loads or maps the event data, updates the business
context layer, runs analysis, and produces a product-facing insight summary. The
important idea is not just "ask an LLM questions about data"; it is to create a
repeatable pipeline where every step produces an inspectable artifact.

## What we are building

We are building a feature-spec-to-insight pipeline for ClickHouse.

Input:

- Feature spec markdown
- Raw NDJSON event samples
- Existing Atlys context
- Existing ClickHouse tables

Output:

- Generated ClickHouse schema
- Event-to-table mapping
- Optional materialized views or aggregates
- Updated context layer
- SQL analysis results
- Product-facing insight summary
- Trace showing how the system produced the result

## Architecture

The intended architecture is a bounded multi-agent pipeline, not an open-ended
recursive agent loop.

Proposed stages:

1. Spec Parser
2. Event Profiler
3. Schema Generator
4. Schema Critic / Validator
5. ClickHouse Executor
6. Context Updater
7. Analytics Query Generator
8. Insight Writer
9. Insight Critic / Evidence Checker
10. Trace and Visualization Layer

Each stage should emit a concrete artifact that can be inspected during the demo.
For example, the schema stage emits DDL, the context stage emits a context diff,
and the analytics stage emits SQL plus result tables.

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
CREATE TABLE instant_forex_events
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

Runs the approved DDL and loads the feature events into ClickHouse.

Like I am 5:

The Executor actually builds the shelves and puts the boxes on them.

Example:

It runs:

```sql
CREATE TABLE instant_forex_events ...
```

Then inserts rows from:

```text
specs/05_instant_forex/events.ndjson
```

Implementation idea:

- Connect to ClickHouse.
- Create database/table.
- Flatten NDJSON according to the schema.
- Insert data.
- Run verification queries like row count by event.

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
- Table: `instant_forex_events`
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

Creates the SQL needed to answer the PM's questions.

Like I am 5:

The Query Generator writes the questions in a language ClickHouse understands.

Example PM question:

> Which destinations attach best?

Generated SQL:

```sql
SELECT
    destination,
    uniqIf(application_id, event_name = 'forex_offer_shown') AS offers,
    uniqIf(application_id, event_name = 'forex_purchased') AS purchases,
    purchases / offers AS attach_rate
FROM instant_forex_events
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
- Validate SQL before running it.

Output artifacts:

- `queries.sql`
- `query_plan.json`

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
- The system should push computation into ClickHouse instead of sending raw rows
  to an LLM.
- Agents should be used for reasoning-heavy steps such as schema design, context
  interpretation, and insight writing.
- Deterministic validation should be used wherever possible for types, SQL
  validity, required fields, and schema conventions.
- Tracing is a core deliverable, not a bonus. Judges should be able to follow the
  reasoning chain from feature spec to final insight.
- The design should optimize for the unseen sixth spec, not overfit the five
  known specs.

## What is working conceptually

- The problem can be modeled as a compiler-like pipeline:
  feature spec in, analytics artifacts out.
- The known specs share enough structure to support a reusable approach:
  event families, funnel steps, entities, dimensions, and PM questions.
- ClickHouse is well suited for this because most analysis can be expressed as
  grouped aggregations, funnels, segment comparisons, and distribution queries.
- A critic stage is useful because judges will care about schema quality, not just
  whether the SQL runs.
- A living context layer is useful because the Analytics Agent needs business
  meaning, not just table names.

## Known broken / unresolved

- The exact agent framework is not finalized yet.
- The exact table design strategy is not finalized yet:
  one table per feature, one table per event, or hybrid.
- The context layer storage format is not finalized yet.
- The visualization layer is not finalized yet.
- The Langfuse trace structure is not finalized yet.
- Human approval gates are not finalized yet.
- The system does not yet prove it can generalize to the unseen sixth spec.
- The base context may contain contradictions and stale definitions; the system
  must detect and handle these rather than blindly trusting it.

## Demo story

During the demo, we should be able to show a new feature spec entering the system
and the following artifacts coming out:

- generated schema
- schema validation notes
- created ClickHouse table
- loaded feature events
- updated context diff
- generated SQL analysis
- product insight summary
- confidence/evidence notes
- trace of the full pipeline

The strongest version of the demo is the unseen sixth spec: the system should run
on it with minimal manual intervention and produce credible artifacts that match
the trace.
