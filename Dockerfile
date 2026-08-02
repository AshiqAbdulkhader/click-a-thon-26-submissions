# Render entrypoint (repo root — avoids spaces in Root Directory).
# App lives under Query Kings/source_code/
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY ["Query Kings/source_code/backend/package.json", "./backend/"]
COPY ["Query Kings/source_code/backend/pnpm-lock.yaml", "./backend/"]
COPY ["Query Kings/source_code/backend/pnpm-workspace.yaml", "./backend/"]
COPY ["Query Kings/source_code/backend/tsconfig.json", "./backend/"]
RUN cd backend && pnpm install --frozen-lockfile

COPY ["Query Kings/source_code/backend/src", "./backend/src"]
COPY ["Query Kings/source_code/specs", "./specs"]
COPY ["Query Kings/source_code/base_context.md", "./base_context.md"]
COPY ["Query Kings/source_code/infra", "./infra"]
COPY ["Query Kings/source_code/frontend", "./frontend"]

RUN mkdir -p frontend/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

WORKDIR /app/backend
CMD ["pnpm", "cli", "serve"]
