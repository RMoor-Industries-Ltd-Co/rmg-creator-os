# Dashboard (Vite + React static SPA, served by nginx).
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rmg-creator-os/types build \
 && pnpm --filter @rmg-creator-os/dashboard build

FROM nginx:stable-alpine
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
# SPA fallback + public /privacy and /terms routes.
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
