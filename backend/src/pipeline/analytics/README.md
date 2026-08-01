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

## Why This Is Not Fixed To A Few Agents

The planner can create any set of query tasks needed for a PM question. The harness is not limited to a fixed funnel/segment/anomaly router. Common analyses still emerge naturally through the plan, but the control loop remains flexible for unseen questions.

## Context Retrieval

The existing context layer already stores generated feature, workflow, metric, column, join, contradiction, and schema quality memory. This folder adds PM-question retrieval over that memory. It is intentionally separate from `retrieveRelevantContextForSpec`, which is shaped for instrumentation prompts.

## Trust Boundaries

- Context is useful memory, not guaranteed truth.
- Generated SQL is a draft until guardrails and ClickHouse execution pass.
- Empty or weak results trigger repair once.
- The final answer is evidence-grounded; unsupported claims are downgraded or removed.
