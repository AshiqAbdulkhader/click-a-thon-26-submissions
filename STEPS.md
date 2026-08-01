```bash
docker compose --profile langfuse down -v

docker compose up -d clickhouse

docker compose --profile langfuse up -d

# SETUP ENV
pnpm cli setup

pnpm cli run ../specs/01_express_checkout
pnpm cli run ../specs/02_group_family
pnpm cli run ../specs/03_status_sharing
pnpm cli run ../specs/04_abandoned_checkout_recovery
pnpm cli run ../specs/05_instant_forex
```

http://localhost:3000/
http://localhost:8123/

http://localhost:8787/
