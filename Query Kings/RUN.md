# RUN.md — Schema Kings

Env vars, ClickHouse connection, and **one command** to run the pipeline end to end.

Install prerequisites first — see [README.md](./README.md#how-to-run-it).

**Platforms:** `./run-local.sh` is bash — works on **macOS** and **Linux**. On Windows, **WSL2 only** — native PowerShell / CMD / Git Bash will **not** work. The script checks Docker, Node 22+, pnpm, and `.env` before doing anything.

---

## One command (local, end to end)

Once `backend/.env` is filled (see below):

```bash
cd source_code
chmod +x run-local.sh   # once, if needed
./run-local.sh
```

That single script:

1. Starts ClickHouse + Langfuse (`docker compose`)
2. Waits for ClickHouse
3. `pnpm install` + `pnpm cli setup` (8 base tables + context bootstrap)
4. Runs instrumentation for all 5 known specs
5. Starts the report UI at http://127.0.0.1:8787

Flags:

```bash
./run-local.sh --setup-only   # Docker + setup only (no specs / no UI)
./run-local.sh --no-serve     # setup + all specs, then exit
```

Useful URLs after it runs:

- Report UI: http://127.0.0.1:8787
- Langfuse: http://localhost:3000
- ClickHouse: http://localhost:8123

Ask from the UI or:

```bash
cd source_code/backend
pnpm cli ask "Where are we losing conversions, and for which segments (device / geo / destination)?"
```

---

## Environment (required before the one command)

```bash
cd source_code/backend
cp .env.example .env
# edit: set GROQ_API_KEY only — local ClickHouse + Langfuse keys already match docker-compose
```

**Local Docker** values in `.env.example` are real defaults (not placeholders):

| Variable                                            | Local default                                           | Source                              |
| --------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| `CLICKHOUSE_*`                                      | `schema_kings` @ `localhost:8123`                       | `docker-compose.yml` app ClickHouse |
| `CLICKHOUSE_DOCKER_CONTAINER`                       | `schema-kings-clickhouse`                               | compose `container_name`            |
| `LANGFUSE_PUBLIC_KEY` / `SECRET_KEY` / `PROJECT_ID` | `lf_pk_schema_kings_local` / `lf_sk_…` / `schema-kings` | compose `LANGFUSE_INIT_*` seed      |
| `LANGFUSE_BASE_URL`                                 | `http://localhost:3000`                                 | Langfuse web                        |
| `GROQ_API_KEY`                                      | _(you must set)_                                        | Groq console                        |

Langfuse UI login (local): `local@schema-kings.dev` / `schemakingslocal`

If Langfuse was started **before** the init seed existed, recreate Langfuse volumes once (keeps app ClickHouse data):

```bash
cd source_code
docker compose --profile langfuse down -v
docker compose --profile langfuse up -d
# sync Langfuse keys from backend/.env.example into backend/.env
```

**ClickHouse Cloud** uses a different `.env` block — see below / comments in `.env.example`.

---

## ClickHouse Cloud (demo / submission warehouse)

### `.env`

```env
CLICKHOUSE_URL=https://<host>.aws.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<password>
CLICKHOUSE_DATABASE=atlys
SETUP_SKIP_BASE_LOAD=1
```

Langfuse can stay local (`docker compose --profile langfuse up -d`) or use Langfuse Cloud — set `LANGFUSE_BASE_URL` accordingly.

### Load base tables once

`load.sh` needs a ClickHouse CLI on the host (or in WSL on Windows):

| OS      | Client                                                                                  |
| ------- | --------------------------------------------------------------------------------------- |
| macOS   | `brew install clickhouse` → use `clickhouse client …`                                   |
| Linux   | `curl https://clickhouse.com/ \| sh` → `./clickhouse client …` or `clickhouse-client …` |
| Windows | Use **WSL**; install the Linux client there. Do not use `brew`.                         |

```bash
# macOS example (Homebrew binary is `clickhouse`, not `clickhouse-client`)
# if Gatekeeper blocks: xattr -dr com.apple.quarantine /opt/homebrew/Caskroom/clickhouse

cd source_code/data
CH='clickhouse client --host <host>.aws.clickhouse.cloud --user default --password YOUR_PASSWORD --secure' \
DB=atlys \
./load.sh

clickhouse client --host <host>.aws.clickhouse.cloud --user default --password YOUR_PASSWORD --secure \
  --query "SELECT count() FROM atlys.destination_card_clicked"
```

On Linux/WSL you can instead set `CH='clickhouse-client --host … --secure'` if that binary is what you installed.

### One-command pipeline on Cloud (after load + `.env`)

There is no separate Cloud bootstrap script — same agents, point `.env` at Cloud, then:

```bash
cd source_code/backend
pnpm install && pnpm cli setup

pnpm cli run ../specs/01_express_checkout
pnpm cli run ../specs/02_group_family
pnpm cli run ../specs/03_status_sharing
pnpm cli run ../specs/04_abandoned_checkout_recovery
pnpm cli run ../specs/05_instant_forex

pnpm cli serve
```

Or reuse local Docker only for Langfuse and run the CLI against Cloud CH via `.env`.

---

## CLI cheat sheet

| Command | Purpose |
| --- | --- |
| `./run-local.sh` | **One command** local e2e |
| `./clean-local.sh` | Reset local Docker volumes |
| `pnpm cli setup` | Load/validate base tables + bootstrap context |
| `pnpm cli run <spec-folder>` | Instrumentation → `ops.job_artifacts` in CH |
| `pnpm cli ask "…"` | Analytics → same |
| `pnpm cli report [job_id]` | HTML report **from ClickHouse** |
| `pnpm cli serve` | UI + Ask (CH-backed) |

Artifacts live only in **ClickHouse** `ops.job_artifacts` (local Docker or Cloud via `CLICKHOUSE_*`). No local `demo_artifacts` / disk job folders.

### Clean local (reset)

Wipes local ClickHouse + Langfuse Docker volumes (including local `ops.job_artifacts`). Does **not** touch source, specs, Parquet, or `backend/.env`.

```bash
cd source_code
./clean-local.sh
./run-local.sh
```
