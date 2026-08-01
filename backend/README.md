# Schema Kings Backend

Minimal CLI scaffold for the agentic Medallion pipeline.

For the full intended local flow, see [LOCAL_FLOW.md](./LOCAL_FLOW.md).

## Run

```bash
pnpm install
pnpm cli run ../specs/05_instant_forex
```

Current state: placeholder only. It prints the planned pipeline stages and does
not run ClickHouse, Langfuse, LLMs, or file-processing logic yet.

## Test Langfuse tracing

Create a project in Langfuse, then copy `backend/.env.example` to `backend/.env`
and fill in the project's public and secret keys.

```bash
pnpm install
pnpm trace:test
```

Then open `http://localhost:3000` and check the Traces view for
`schema-kings.mock-pipeline`.
