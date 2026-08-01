# Schema Kings · Click-a-thon 2026 (Atlys)

**From feature spec to insight:** agents that instrument ClickHouse, keep business context fresh, analyze warehouse data, and explain results for a product audience — fully traced in Langfuse.

All dataset content is **synthetic**. No real customer data or PII.

---

## Problem we solve

Atlys ships product constantly. Every feature needs instrumentation, schema design, and analysis. Today that loop is slow and context gets lost across handoffs.

This project collapses it into one agentic pipeline on ClickHouse:

1. **Instrument** a feature spec → production-ready Silver tables + Gold MVs
2. **Remember** validated facts in a living context layer
3. **Answer** PM questions with warehouse-backed insights + confidence
4. **Trace** every agent/LLM step in Langfuse and show a judge-facing report

Official brief: [`PROBLEM_STATEMENT.md`](PROBLEM_STATEMENT.md) · package guide: [`README_START_HERE.md`](README_START_HERE.md)

---

## What’s covered (vs the problem statement)

| Deliverable               | Status | How                                                                                                           |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| **Instrumentation Agent** | Done   | Spec → Bronze → profile → LLM schema design/critic → guardrails → Silver load → Gold MVs                      |
| **Analytics Agent**       | Done   | `cli ask` / report UI → intent → plan → SQL → primitives → execute → numbers-first insights + evidence critic |
| **Context Agent**         | Done   | ClickHouse `context.*` registries; write only after Silver validation; contradictions/gaps surfaced           |
| **Langfuse tracing**      | Done   | Full pipeline + ask traces; report deep-links by project + trace id                                           |
| **Visualization**         | Done   | Static report + `cli serve` UI: schema over time, insights + confidence, context changelog                    |
| **Unseen 6th spec**       | Ready  | Same `cli run` / `cli ask` path; submit schema + insight + matching Langfuse trace                            |

Out of scope (per brief): auth, polished multi-user product, streaming ingest.

---

## Architecture

```text
Feature spec (spec.md + events.ndjson)
        │
        ▼
┌───────────────────────┐
│ Instrumentation Agent │  bronze → schema loop → silver → gold MVs
└───────────┬───────────┘
            │ validated only
            ▼
┌───────────────────────┐
│   Context memory      │  feature / column / metric / join / contradictions
│   (ClickHouse)        │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│   Analytics Agent     │  PM question → SQL in CH → PM insight + confidence
└───────────┬───────────┘
            │
            ├──────────► Langfuse (reasoning chain)
            ├──────────► ops.* (runs / stages / queries)
            └──────────► artifacts/<job_id>/ + report HTML
```

**Hybrid trust model:** LLMs draft intent, plans, SQL, and prose. Deterministic code retrieves context, blocks mutating SQL, executes ClickHouse, validates loads, and strips unsupported claims.

### Layers in ClickHouse

| Layer                             | Role                                    |
| --------------------------------- | --------------------------------------- |
| App DB (`schema_kings` / `atlys`) | 8 base Atlys event tables               |
| `bronze`                          | Raw spec + NDJSON audit copy            |
| `silver`                          | Typed feature event tables              |
| `gold`                            | Daily counts / conversion / segment MVs |
| `context`                         | Living business + schema memory         |
| `ops`                             | Pipeline run / stage / query tracking   |

---

## Repo layout

```text
├── PROBLEM_STATEMENT.md      # Official Atlys challenge
├── README_START_HERE.md      # Dataset package overview
├── STEPS.md                  # Local + Cloud setup (commands only)
├── base_context.md           # Business context (treat as fallible)
├── data/                     # 8 Parquet tables + ddl.sql + load.sh
├── specs/                    # 5 feature specs (+ 6th when released)
├── backend/                  # Agents, CLI, report server
│   ├── src/pipeline/
│   │   ├── instrumentation/  # Spec → schema → Silver
│   │   ├── context/          # Context memory read/write
│   │   ├── analytics/        # PM ask harness
│   │   └── report/           # HTML report + serve
│   └── artifacts/            # Per-job outputs (gitignored)
├── frontend/                 # Generated report (dist/) + README
└── infra/clickhouse/init/    # bronze/silver/gold DDL (local Docker + Cloud ensure)
```

Deeper docs:

- [`backend/src/pipeline/instrumentation/README.md`](backend/src/pipeline/instrumentation/README.md)
- [`backend/src/pipeline/context/README.md`](backend/src/pipeline/context/README.md)
- [`backend/src/pipeline/analytics/README.md`](backend/src/pipeline/analytics/README.md)
- [`frontend/README.md`](frontend/README.md)

---

## Quick start

Full command lists (local + Cloud): **[`STEPS.md`](STEPS.md)**

### Local (short)

```bash
docker compose up -d clickhouse
docker compose --profile langfuse up -d

cd backend
cp .env.example .env   # fill GROQ + LANGFUSE_* + LANGFUSE_PROJECT_ID
pnpm install
pnpm cli setup

pnpm cli run ../specs/01_express_checkout
# … remaining specs …

pnpm cli serve         # http://127.0.0.1:8787
```

### Cloud (short)

1. Point `.env` at ClickHouse Cloud (`CLICKHOUSE_DATABASE=atlys`, `SETUP_SKIP_BASE_LOAD=1`)
2. Load base tables once with `data/load.sh` (`clickhouse client …`)
3. `pnpm cli setup` → creates bronze/silver/gold + context
4. Run the five specs → `pnpm cli serve`

---

## CLI

From `backend/`:

| Command                      | Purpose                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm cli setup`             | Load/validate base tables (or skip with `SETUP_SKIP_BASE_LOAD=1`), ensure layers, bootstrap context |
| `pnpm cli run <spec-folder>` | Instrumentation agent for one feature                                                               |
| `pnpm cli ask "…"`           | Analytics agent; also writes focused HTML report                                                    |
| `pnpm cli report [job_id]`   | Overview or single-job report → `frontend/dist/report.html`                                         |
| `pnpm cli serve`             | Report UI + ask box (`POST /api/ask`) on port 8787                                                  |
| `pnpm cli context:bootstrap` | Context bootstrap only                                                                              |

Example asks:

```bash
pnpm cli ask "Where are users dropping off in the express checkout funnel?"
pnpm cli ask "Is express checkout completion worse on iOS than Android or web?"
pnpm cli ask "What tables and events are available for abandoned checkout recovery?"
```

---

## Visualization & demo flow

1. **Instrument** unseen / known specs with `cli run` (terminal is fine).
2. Open **http://127.0.0.1:8787** (`cli serve`).
3. Type a PM question in the **Ask** box (loading stages while the agent runs).
4. Read answer + findings + confidence; open **Langfuse** for the full chain.
5. Overview sections show features instrumented, context changelog, recent insights.

Report also works offline via `pnpm cli report` / `pnpm cli report <job_id>`.

---

## Tracing

- Root traces: `schema-kings.pipeline`, `schema-kings.analytics_ask`, `schema-kings.local-setup`
- Set `LANGFUSE_BASE_URL`, keys, and `LANGFUSE_PROJECT_ID` so report links resolve to:

  `{BASE}/project/{PROJECT_ID}/traces?search={trace_id}&searchType=id&searchType=content`

---

## Design choices (judge talking points)

- **Compute in ClickHouse, interpret in the LLM** — aggregates/primitives first; numbers-first scaffold when prose is weak.
- **Context is memory, not truth** — event evidence wins; writes gated on Silver validation.
- **Strict analytics** — prefer “unavailable” / caveats over invented metrics.
- **Artifacts + ops + Langfuse** — three evidence layers for every job.
- **Cloud vs local** — same agents; Cloud needs `load.sh` + `SETUP_SKIP_BASE_LOAD` because Docker init isn’t there (layers are ensured in setup/run).

---

## Env essentials

See [`backend/.env.example`](backend/.env.example).

| Variable                                            | Purpose                                            |
| --------------------------------------------------- | -------------------------------------------------- |
| `CLICKHOUSE_URL` / `USER` / `PASSWORD` / `DATABASE` | Warehouse                                          |
| `SETUP_SKIP_BASE_LOAD=1`                            | Cloud: skip re-running `load.sh` after manual load |
| `GROQ_API_KEY` + model envs                         | LLM stages                                         |
| `LANGFUSE_*` + `LANGFUSE_PROJECT_ID`                | Tracing + report links                             |

---

## Team

**Schema Kings** — ClickHouse Click-a-thon 2026 · Atlys track.
