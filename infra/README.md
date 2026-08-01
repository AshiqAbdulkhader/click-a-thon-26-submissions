# Local Infrastructure

This folder supports local development for the Schema Kings pipeline.

## Start app ClickHouse only

```bash
docker compose up -d clickhouse
```

Useful URLs/ports:

- HTTP: `http://localhost:8123`
- Native: `localhost:9000`
- User: `schema_kings`
- Password: `schema_kings`

## Start ClickHouse + Langfuse

```bash
docker compose --profile langfuse up -d
```

Useful URLs/ports:

- App ClickHouse: `http://localhost:8123`
- Langfuse UI: `http://localhost:3000`
- Langfuse ClickHouse: `http://localhost:8124`
- MinIO console: `http://localhost:9091`

The Langfuse stack is intentionally separate from the app ClickHouse instance.
That keeps product analytics data separate from observability data.

## Environment overrides

Copy `.env.docker.example` to `.env.docker` and run:

```bash
docker compose --env-file .env.docker up -d clickhouse
docker compose --env-file .env.docker --profile langfuse up -d
```

## Current databases

The app ClickHouse init script creates:

- `bronze`
- `silver`
- `gold`

It also creates placeholder Bronze and Gold tables so the CLI has stable local
targets once implementation begins.
