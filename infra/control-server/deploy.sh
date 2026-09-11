#!/usr/bin/env bash
# Pull and (re)launch the control-server stack at a given image tag.
#
# All runtime secrets come from Doppler (DOPPLER_TOKEN must be set).
# GHCR_IMAGE_PREFIX and IMAGE_TAG are deploy-time vars — they always win
# over any same-named variables that may exist in Doppler.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/rmg-creator-os/control-server}"
GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:?GHCR_IMAGE_PREFIX is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
GHCR_USERNAME="${GHCR_USERNAME:?GHCR_USERNAME is required}"
GHCR_TOKEN="${GHCR_TOKEN:?GHCR_TOKEN is required}"
DOPPLER_TOKEN="${DOPPLER_TOKEN:?DOPPLER_TOKEN is required}"

# --- Post-deploy health gate (B1.3 §4, incident #65-#71) ---------------------
# A successful `docker compose up -d` is NOT evidence of a working deploy: it only proves the
# command that STARTS the container succeeded, not that the process stayed up. The #65 incident
# shipped five deploys across ~1.5h that all printed "deployed" while the gateway was crashing on
# every request — nothing in this script ever looked at what it had just gathered. These knobs
# are overridable per-invocation, but never so the gate can be silently skipped:
#   HEALTH_URL          — the public health endpoint this script curls FROM THE DEPLOY HOST,
#                          not from inside the container (the gateway image has no curl/wget —
#                          see apps/gateway/Dockerfile — and going out through the public domain
#                          also proves Caddy is actually routing to the new container, not just
#                          that the container itself is up).
#   STABILIZE_SECONDS    — total time budget for the container to come up AND stay up.
#   POLL_INTERVAL_SECONDS — how often to re-check within that budget.
HEALTH_URL="${HEALTH_URL:-https://rmg-creator-os.rmasters.group/api/health}"
STABILIZE_SECONDS="${STABILIZE_SECONDS:-30}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"

cd "$DEPLOY_DIR"

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

# Source Doppler secrets into the shell with auto-export so docker compose
# inherits every secret (POSTGRES_PASSWORD etc.). Then re-assert deploy-time
# vars so they cannot be shadowed by any same-named Doppler entries.
set -a
eval "$(DOPPLER_TOKEN="$DOPPLER_TOKEN" doppler secrets download --no-file --format env-no-quotes)"
set +a
export GHCR_IMAGE_PREFIX IMAGE_TAG

# Ensure the DB user password matches Doppler. The container superuser is
# rmgcreator (POSTGRES_USER), which connects via unix socket without a password.
if docker ps --format '{{.Names}}' | grep -q 'control-server-db-1'; then
  docker exec control-server-db-1 \
    psql -U rmgcreator -d rmgcreator \
    -c "ALTER USER rmgcreator WITH PASSWORD '${POSTGRES_PASSWORD}';" \
    && echo "db password synced" || echo "WARNING: db password sync failed"
fi

docker compose pull gateway dashboard allen
docker compose up -d
docker image prune -f

# Baseline restart count sampled right after `up -d`, before the stabilization window starts —
# this is what makes "did it crash-loop during the window" detectable rather than just "is it
# running at this one instant" (a container mid-crash-loop can be `running` at any given poll).
baseline_restarts="$(docker inspect control-server-gateway-1 --format '{{.RestartCount}}' 2>/dev/null || echo -1)"

dump_diagnostics() {
  echo "=== gateway logs (last 100 lines) ==="
  docker logs control-server-gateway-1 --tail 100 2>&1 || true
  echo "=== gateway container state ==="
  docker inspect control-server-gateway-1 --format '{{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}} started={{.State.StartedAt}}' 2>&1 || true
  echo "=== allen logs (last 30 lines) ==="
  docker logs control-server-allen-1 --tail 30 2>&1 || true
}

elapsed=0
healthy=false
last_reason=""
while [ "$elapsed" -lt "$STABILIZE_SECONDS" ]; do
  sleep "$POLL_INTERVAL_SECONDS"
  elapsed=$((elapsed + POLL_INTERVAL_SECONDS))

  status="$(docker inspect control-server-gateway-1 --format '{{.State.Status}}' 2>/dev/null || echo 'missing')"
  restarts="$(docker inspect control-server-gateway-1 --format '{{.RestartCount}}' 2>/dev/null || echo -1)"

  if [ "$status" != "running" ]; then
    last_reason="container status is '${status}', not 'running'"
    healthy=false
    continue
  fi
  if [ "$baseline_restarts" != "-1" ] && [ "$restarts" -gt "$baseline_restarts" ]; then
    last_reason="restart count increased during the stabilization window (${baseline_restarts} -> ${restarts}) — the process is crash-looping"
    healthy=false
    continue
  fi

  http_code="$(curl -s -o /tmp/deploy-health-body.json -w '%{http_code}' --max-time 5 "$HEALTH_URL" || echo '000')"
  if [ "$http_code" != "200" ]; then
    last_reason="${HEALTH_URL} returned HTTP ${http_code}, expected 200"
    healthy=false
    continue
  fi

  # Critical dependency checks must be 'ok' or 'unconfigured' (an intentionally-disabled
  # optional feature is not a deploy failure) — never 'fail'. Postgres is the one check that is
  # never allowed to be 'unconfigured' either: there is no such thing as a gateway with no
  # database.
  if command -v jq >/dev/null 2>&1; then
    pg_check="$(jq -r '.checks.postgres // "missing"' /tmp/deploy-health-body.json 2>/dev/null || echo 'missing')"
    any_fail="$(jq -r '[.checks[] | select(. == "fail")] | length' /tmp/deploy-health-body.json 2>/dev/null || echo '1')"
    if [ "$pg_check" != "ok" ]; then
      last_reason="/api/health reports checks.postgres='${pg_check}', expected 'ok'"
      healthy=false
      continue
    fi
    if [ "$any_fail" != "0" ]; then
      last_reason="/api/health reports ${any_fail} dependency check(s) as 'fail'"
      healthy=false
      continue
    fi
  fi

  healthy=true
  break
done

if [ "$healthy" != "true" ]; then
  echo "DEPLOY HEALTH GATE FAILED: gateway did not reach a stable, healthy state within ${STABILIZE_SECONDS}s."
  echo "Last observed problem: ${last_reason:-unknown}"
  dump_diagnostics
  echo ""
  echo "This script does NOT perform an automatic rollback — see infra/DEPLOYMENT.md. The" \
       "previous image is still available in GHCR (retag it and re-run this script, or run" \
       "'docker compose up -d --force-recreate gateway' after pointing IMAGE_TAG at the last" \
       "known-good tag) but that decision is an operator call, not an automated one."
  exit 1
fi

echo "=== gateway logs (last 60 lines) ==="
docker logs control-server-gateway-1 --tail 60 2>&1 || true
echo "=== gateway container state ==="
docker inspect control-server-gateway-1 --format '{{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' 2>&1 || true

echo "deployed ${GHCR_IMAGE_PREFIX} @ ${IMAGE_TAG} — health gate passed (${elapsed}s)"
