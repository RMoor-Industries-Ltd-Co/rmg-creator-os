# RMG Creator OS — Claude Orientation

> **Cross-project contracts and architecture** live in [`rmg-piaar-system`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system). Read that first for the full system picture.

## Server Layout

| Thing | Path |
|---|---|
| **Control server deploy dir** | `/opt/rmg-creator-os/control-server/` |
| **docker-compose.yml** (on server) | `/opt/rmg-creator-os/control-server/docker-compose.yml` |
| **.env** (on server, Doppler-injected) | `/opt/rmg-creator-os/control-server/.env` _(gitignored)_ |
| **Repo copy of compose** | `infra/control-server/docker-compose.yml` |
| **Deploy script** | `infra/control-server/deploy.sh` |

Server IP: `45.33.96.135`. SSH as `root`.

## Container Names (docker compose project = `control-server`)

| Service | Container name |
|---|---|
| Gateway (Fastify API) | `control-server-gateway-1` |
| Dashboard (Vite/React) | `control-server-dashboard-1` |
| ALLEN (AI + WhatsApp) | `control-server-allen-1` |
| Postgres 16 | `control-server-db-1` |
| Redis 7 | `control-server-redis-1` |
| Caddy (reverse proxy) | `control-server-caddy-1` |

## Secrets Model

- **Doppler project `master-atelier`, config `prd`** holds all runtime secrets.
- `DATABASE_URL` is **never a Doppler secret** — docker-compose assembles it:
  `postgres://rmgcreator:${POSTGRES_PASSWORD}@db:5432/rmgcreator`
- `REDIS_URL` similarly: `redis://:${REDIS_PASSWORD}@redis:6379`
- The deploy script (`deploy.sh`) calls `doppler secrets download` with `DOPPLER_TOKEN`
  (a GitHub Actions secret) to inject everything before `docker compose up -d`.
- **Manual restarts on the server** do NOT have Doppler available — use the
  `--env-file` approach below instead.

## Manual Gateway Restart (no Doppler on server)

```bash
cd /opt/rmg-creator-os/control-server
docker compose up -d --force-recreate gateway
```

The `.env` file in that directory is written by the CI deploy and persists between
deploys — `docker compose` reads it automatically. This is always safe to run.

## Useful One-liners

```bash
# Tail gateway logs live
docker logs control-server-gateway-1 -f --tail 50

# Check all container health
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

# Run a migration check (psql into DB)
docker exec control-server-db-1 psql -U rmgcreator rmgcreator -c "\d productions"

# Restart everything
cd /opt/rmg-creator-os/control-server && docker compose up -d
```

## Architecture Quick-Reference

- **Monorepo**: pnpm workspaces — `apps/gateway`, `apps/dashboard`, `packages/db`
- **DB**: Drizzle ORM + PostgreSQL 16. Migrations in `packages/db/drizzle/`. Run automatically on gateway startup via `runMigrations(DATABASE_URL)`.
- **Queue**: `production_jobs` table, claimed by `POST /worker/tick`.
- **CI/CD**: push to `main` → CI → Publish Images (GHCR) → Deploy (auto-triggered).

## UI Validation (Playwright)

Run `pnpm test:e2e` from the repo root to smoke-test production.
Tests in `e2e/` target `https://rmg-creator-os.rmasters.group` — no local server needed.

For authenticated tests, set `E2E_SESSION_COOKIE=<value of rmg_sess cookie>` in the environment.
Grab the cookie from DevTools → Application → Cookies after logging in once, then add it to the
Claude Code web environment variables so it persists across sessions.

## Doppler Secret Gaps to Watch

| Secret | Project | Status |
|---|---|---|
| `YOUTUBE_API_KEY` | master-atelier prd | Added Jun 27 2026 |
| `GDRIVE_LIBRARY_FOLDER_ID` | master-atelier prd | Added Jun 28 2026 — brand asset library |
| `DATABASE_URL` | master-atelier prd | **Do not add** — built by compose |
| `STEP_UP_COOKIE_SECRET` | master-atelier prd | **Added by the founder** (2026-09-11). Distinct strong secret from `COOKIE_SECRET`. Still needs the one-time GCP console step, not a Doppler secret: add `https://<dashboard host>/stepup-callback.html` as an authorized redirect URI on the existing `GOOGLE_CLIENT_ID` OAuth client, or the step-up popup's redirect will be rejected by Google — no evidence in this repo that step has been done. |
| `FOUNDER_PRINCIPALS` | master-atelier prd | **Present but WRONG FORMAT** (found 2026-09-11, B1.3 follow-up). Must be comma-separated `email=principalId` pairs (e.g. `rahm@rmasters.group=rahm@business`) — the value currently set is a bare comma-separated email list with no `=principalId`, which `parseFounderPrincipals()` rejects entirely (every entry flagged malformed, founder set is empty). Fails closed (no founder-gated write is authorized), not a security gap — but re-enter it in the correct syntax once the canonical principal ids are decided (Contract 36). See `docs/atelier/b1-3-operational-activation.md` §5. |
