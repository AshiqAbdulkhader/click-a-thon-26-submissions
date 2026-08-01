# Setup steps

## Local

```bash
docker compose --profile langfuse down -v
docker compose up -d clickhouse
docker compose --profile langfuse up -d

cd backend
pnpm cli setup

pnpm cli run ../specs/01_express_checkout
pnpm cli run ../specs/02_group_family
pnpm cli run ../specs/03_status_sharing
pnpm cli run ../specs/04_abandoned_checkout_recovery
pnpm cli run ../specs/05_instant_forex

pnpm cli serve
```

- Langfuse: http://localhost:3000/
- ClickHouse: http://localhost:8123/
- Report UI: http://127.0.0.1:8787/

---

## Cloud

### 1. `.env` (Cloud ClickHouse + Langfuse can stay local)

```env
CLICKHOUSE_URL=https://<host>.aws.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<password>
CLICKHOUSE_DATABASE=atlys
SETUP_SKIP_BASE_LOAD=1
```

Langfuse still running locally: `docker compose --profile langfuse up -d`

### 2. Load base tables once

```bash
brew install clickhouse   # if needed; macOS binary is `clickhouse`, not clickhouse-client
# if Gatekeeper blocks: xattr -dr com.apple.quarantine /opt/homebrew/Caskroom/clickhouse

cd data
CH='clickhouse client --host <host>.aws.clickhouse.cloud --user default --password <password> --secure' \
DB=atlys \
./load.sh
```

### 3. Setup + specs + UI

```bash
cd backend
pnpm cli setup

pnpm cli run ../specs/01_express_checkout
pnpm cli run ../specs/02_group_family
pnpm cli run ../specs/03_status_sharing
pnpm cli run ../specs/04_abandoned_checkout_recovery
pnpm cli run ../specs/05_instant_forex

pnpm cli serve
```

Report UI: http://127.0.0.1:8787/
