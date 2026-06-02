# Gateway (Fastify orchestrator). Built from the workspace root context.
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rmg-creator-os/types build \
 && pnpm --filter @rmg-creator-os/db build \
 && pnpm --filter @rmg-creator-os/gateway build

# Produce a self-contained production deployment (workspace deps inlined).
RUN pnpm --filter @rmg-creator-os/gateway --prod --legacy deploy /app/out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/out ./
EXPOSE 8080
CMD ["node", "dist/server.js"]
