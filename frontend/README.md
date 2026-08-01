# Frontend / Visualization (Schema Kings · Atlys)

Judge-facing static report from pipeline artifacts.

```bash
cd backend
pnpm cli report
open ../frontend/dist/report.html
```

## What you’re looking at

Sticky nav with **three sections**:

1. **Features** — instrumented Silver tables (SQL collapsed)
2. **Context** — memory / gaps after loads
3. **Insights** — 3 recent PM answers + Langfuse links

## Langfuse links

Set in `backend/.env`:

```bash
LANGFUSE_BASE_URL=http://localhost:3000
LANGFUSE_PROJECT_ID=cmsasx39h0006p507q5x1vdzj
```

Links become:

`{BASE}/project/{PROJECT_ID}/traces?search={trace_id}&searchType=id&searchType=content`
