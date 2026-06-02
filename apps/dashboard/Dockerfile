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
# SPA fallback so client-side routes resolve to index.html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
