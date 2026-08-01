# Analytics Ask Harness

This folder owns the PM-facing analytics loop. It answers questions against the current ClickHouse warehouse and generated context memory. It is separate from the instrumentation agent: instrumentation builds/loads Silver tables and updates context; this harness uses those tables and context to answer arbitrary PM questions.

## Flow

```text
PM question
  -> 08a Query Understanding
  -> 08b PM Context Retrieval
  -> 08c Analysis Planner
  -> 08d Plan Critic
  -> 08e SQL Generator
  -> 08f SQL Guardrail
  -> 09 Gold Query Executor
  -> 09b Result Evaluator
       -> repair once when SQL/results are weak
  -> 10 Insight Synthesizer
  -> 11 Evidence Critic
```

## Try These Questions

Run from `backend/`:

```bash
pnpm cli ask "Give me a PM summary of express checkout performance. What is working and what needs attention?"
```

```bash
pnpm cli ask "Where are users dropping off in the express checkout funnel?"
```

```bash
pnpm cli ask "Is express checkout completion worse on iOS than Android or web?"
```

```bash
pnpm cli ask "Which segment has the lowest success rate for group family applications?"
```

```bash
pnpm cli ask "Are there any data quality issues in the instant forex instrumentation?"
```

```bash
pnpm cli ask "What tables and events are available for abandoned checkout recovery, and what metrics can we calculate?"
```

Best first smoke test:

```bash
pnpm cli ask "Where are users dropping off in the express checkout funnel, and is the drop concentrated by device or country?"
```

The LLM is allowed to parse, plan, generate SQL drafts, and synthesize PM-facing text. Deterministic code retrieves context, blocks mutating SQL, executes ClickHouse queries, checks result quality, and removes unsupported final claims.

## Agentic vs Deterministic

The analytics harness is intentionally hybrid. The LLM is used where PM language is ambiguous and interpretation is needed. Deterministic code owns safety, execution, evidence checks, and traceability.

Agentic stages:

- `08a_query_understanding`: parses the PM question into intent, feature hints, metric hints, segments, time hints, and ambiguity notes.
- `08c_analysis_planner`: decides what analyses are needed, which tables/joins may matter, what queries should be run, and what evidence standard is required.
- `08e_sql_generator`: drafts read-only ClickHouse SQL from the analysis plan and retrieved context.
- `10_insight_synthesizer`: turns compact query results into a PM-facing answer with findings, caveats, and recommended actions.

Deterministic stages:

- `08b_pm_context_retrieval`: scores and retrieves generated context memory for the PM query.
- `08d_plan_critic`: checks that the plan is usable before SQL generation.
- `08f_sql_guardrail`: blocks mutating SQL, strips formatting, checks known tables, and records warnings.
- `09_gold_query_executor`: executes approved ClickHouse queries and records every query.
- `09b_result_evaluator`: checks whether results are empty, weak, missing required evidence, or need repair.
- `11_evidence_critic`: removes unsupported final claims and adds caveats when evidence is weak.

The important trust boundary is:

```text
LLM drafts intent, plan, SQL, and prose
  -> deterministic code validates, executes, tracks, and constrains claims
```

## Tracking Contract

Every PM question produces three layers of tracking:

1. Langfuse trace
   - Root span: `schema-kings.analytics_ask`
   - Agentic generation spans:
     - `groq.analytics.query_intent`
     - `groq.analytics.analysis_plan`
     - `groq.analytics.sql_generator`
     - `groq.analytics.insight_synthesizer`
   - Stage spans for deterministic steps.

2. ClickHouse ops tables
   - `ops.pipeline_runs`: one row for the PM ask job lifecycle.
   - `ops.pipeline_stages`: one row per analytics stage with input/output JSON.
   - `ops.analytics_queries`: one row per SQL query with SQL text, purpose, guardrail warnings, status, row count, duration, and error.

3. Artifact files

   Each run writes artifacts under:

   ```text
   backend/artifacts/<job_id>/
   ```

   Important artifacts:
   - `08a_query_understanding/intent.json`
   - `08b_pm_context_retrieval/pm_context.json`
   - `08c_analysis_planner/analysis_plan.json`
   - `08d_plan_critic/plan_review.json`
   - `08e_sql_generator/sql_queries.json`
   - `08f_sql_guardrail/sql_guardrail.json`
   - `09_gold_query_executor/query_results.json`
   - `09b_result_evaluator/result_evaluation.json`
   - `10_insight_synthesizer/answer.md`
   - `11_evidence_critic/final_answer.md`
   - `ask_summary.json`

This is the evidence trail judges should be able to inspect: what the system thought the PM asked, what context it used, what SQL it generated, which queries actually ran, what came back from ClickHouse, and how the final answer was constrained by evidence.

## Why This Is Not Fixed To A Few Agents

The planner can create any set of query tasks needed for a PM question. The harness is not limited to a fixed funnel/segment/anomaly router. Common analyses still emerge naturally through the plan, but the control loop remains flexible for unseen questions.

## Context Retrieval

The existing context layer already stores generated feature, workflow, metric, column, join, contradiction, and schema quality memory. This folder adds PM-question retrieval over that memory. It is intentionally separate from `retrieveRelevantContextForSpec`, which is shaped for instrumentation prompts.

## Trust Boundaries

- Context is useful memory, not guaranteed truth.
- Generated SQL is a draft until guardrails and ClickHouse execution pass.
- Empty or weak results trigger repair once.
- The final answer is evidence-grounded; unsupported claims are downgraded or removed.
