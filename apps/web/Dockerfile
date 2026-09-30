# Multi-stage Dockerfile for @tether/web (Next.js standalone)
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Dependencies stage: cache dependencies across the workspace
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/sync-client/package.json ./packages/sync-client/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY tests/chaos/package.json ./tests/chaos/

RUN pnpm install --frozen-lockfile

# Builder stage: build packages and Next.js standalone application
FROM deps AS builder
COPY packages/shared ./packages/shared
COPY packages/sync-client ./packages/sync-client
COPY apps/web ./apps/web

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build arguments for client-side configuration
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000
ARG NEXT_PUBLIC_SYNC_MODE=server
ARG NEXT_PUBLIC_DEMO_MODE=false

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_SYNC_MODE=$NEXT_PUBLIC_SYNC_MODE
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE

RUN pnpm --filter @tether/shared build:pkg
RUN pnpm --filter @tether/sync-client build:pkg
RUN pnpm --filter @tether/web build

# Production runner stage
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

USER node

# Copy Next.js standalone server and static assets
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000)).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/server.js"]
