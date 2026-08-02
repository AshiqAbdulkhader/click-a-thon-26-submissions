# Schema Kings — report UI + Ask API for Render / any container host
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Backend deps first (better layer cache)
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./backend/
COPY backend/tsconfig.json ./backend/
RUN cd backend && pnpm install --frozen-lockfile

# App source (specs + infra SQL used by agents; parquet NOT needed at runtime if Cloud already loaded)
COPY backend/src ./backend/src
COPY specs ./specs
COPY base_context.md ./base_context.md
COPY infra ./infra
COPY frontend ./frontend

# Bake report artifacts so the overview UI works on boot.
# Committed demo snapshot for overview UI on Render.
COPY demo_artifacts ./backend/artifacts

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Render injects PORT; local default
ENV PORT=8787

EXPOSE 8787

WORKDIR /app/backend
CMD ["pnpm", "cli", "serve"]
