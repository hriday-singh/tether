# Multi-stage Dockerfile for @tether/server (Self-contained in apps/server)
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Dependencies stage: use local workspace definitions
FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/sync-client/package.json ./packages/sync-client/

RUN pnpm install --no-frozen-lockfile

# Builder stage: compile shared packages, sync-client and server
FROM deps AS builder
COPY packages/shared ./packages/shared
COPY packages/sync-client ./packages/sync-client
COPY src ./src

RUN pnpm --filter @tether/shared build:pkg
RUN pnpm --filter @tether/sync-client build:pkg
RUN pnpm build
RUN pnpm --prod deploy /app/deploy

# Production runner stage
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV SQLITE_PATH=/data/tether.db

# Ensure persistent SQLite data directory exists with permissions for node user
RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder --chown=node:node /app/deploy ./

USER node

EXPOSE 4000
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
