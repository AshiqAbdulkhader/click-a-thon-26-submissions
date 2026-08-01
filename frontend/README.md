# Frontend / Visualization (Schema Kings · Atlys)

This folder is the **starting point for the visualization layer** in a new chat.  
It is intentionally thin: **do not** assume a full REST backend or chat product yet.

Langfuse already covers **agent/LLM tracing**. This layer is for **product-facing pipeline views** required by the problem statement.

---

## What the problem statement wants

A visualization layer (dashboard, lightweight UI, **or** structured output) showing:

1. **Schema changes over time**
2. **Agent-generated insights with confidence scores**
3. **Context layer diff / changelog**

Tracing (Langfuse) is separate and already working.

---

## What already exists (use these — do not re-fetch from LLMs)

### On disk (per job)

```text
backend/artifacts/<job_id>/
  03_spec_parser/feature_manifest.json
  04_schema_generator/schema.sql
  04_schema_generator/schema_plan.json
  04_schema_generator/schema_design_loop.json   # mode: llm_assisted | deterministic_fallback
  05_schema_critic/schema_review.md
  06_silver_loader/load_report.json
  07_context_agent/context_diff.md
  07_context_agent/updated_context.json
  11_evidence_critic/final_answer.md            # insights + confidence
  11_evidence_critic/final_answer.json
  run_summary.json / ask_summary.json           # includes langfuse_trace_id
```

### In ClickHouse

- `ops.pipeline_runs`, `ops.pipeline_stages`, `ops.analytics_queries`
- `context.feature_registry`, `context.column_registry`, `context.workflow_registry`
- `context.metric_registry`, `context.contradictions`, `context.schema_quality_registry`
- Silver/Gold feature tables

### Langfuse

- Full agent traces (open via `langfuse_trace_id` from summaries)

---

## Recommended approach (agreed direction)

**Prefer a static report generator over a massive API/UI.**

```text
pnpm cli report [--job <job_id>]
  → reads artifacts + light CH queries
  → writes frontend/dist/report.html (or similar)
  → open in browser
```

### No (for hackathon)

- Large REST API surface
- Auth / multi-user app
- Replacing Langfuse
- Streaming chat UI as the first deliverable

### Maybe later (optional)

- One-page “pick a job” browser UI
- Single `POST /ask` only if browser Q&A is needed for demo

---

## Suggested page sections

| Section                       | Source                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| Job picker / latest runs      | `ops.pipeline_runs` or artifact folder list                      |
| Schema (current)              | `schema.sql` + `schema_plan.json`                                |
| Schema over time              | compare jobs for same `feature_slug` / `schema_quality_registry` |
| Insights + confidence         | `final_answer.json` evidence array                               |
| Context diff                  | `context_diff.md`                                                |
| Contradictions / known issues | `context.contradictions`                                         |
| Trace link                    | Langfuse base URL + `trace_id`                                   |

---

## Design principles

1. **Read-only** — never re-run agents just to render UI.
2. **Artifacts first** — CH is optional enrichment.
3. **Judge-friendly** — one HTML open should tell the story.
4. **Keep backend analytics in `backend/`** — this folder is presentation only.

---

## Open questions for the next chat

1. Static HTML only, or a tiny Vite/React page?
2. Local-only demo vs needs to run on a shared machine?
3. Should `cli report` auto-run after `cli run` / `cli ask`?
4. Langfuse public URL for linking from the report?

---

## Current backend status (context for next agent)

- Instrumentation + context + analytics ask loop are implemented.
- Hybrid agentic design: LLM when usable, evidence fallback when not.
- Known polish area: insight short-answers should prefer warehouse aggregates (funnel/device math).
- Env models: `GROQ_MODEL` (20b SQL), `GROQ_SCHEMA_MODEL` / `GROQ_CRITIC_MODEL` (8b).

When starting a new chat, point the agent at:

- this file
- `PROBLEM_STATEMENT.md` (section on visualization)
- `backend/src/pipeline/analytics/README.md`
- a sample artifact job under `backend/artifacts/`
