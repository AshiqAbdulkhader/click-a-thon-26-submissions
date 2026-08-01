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

