#!/usr/bin/env bash
# Pull and (re)launch the control-server stack at a given image tag.
#
# Secrets (POSTGRES_PASSWORD, REDIS_PASSWORD, TAILSCALE_IP) live in the server
# .env and are NOT touched here — we only inject the registry prefix + tag,
# which the shell environment overrides .env for.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/rmg-creator-os/control-server}"
GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:?GHCR_IMAGE_PREFIX is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
GHCR_USERNAME="${GHCR_USERNAME:?GHCR_USERNAME is required}"
GHCR_TOKEN="${GHCR_TOKEN:?GHCR_TOKEN is required}"

cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $DEPLOY_DIR/.env (POSTGRES_PASSWORD, REDIS_PASSWORD, TAILSCALE_IP)" >&2
  exit 1
fi

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

export GHCR_IMAGE_PREFIX IMAGE_TAG

docker compose pull gateway dashboard
docker compose up -d
docker image prune -f

echo "deployed ${GHCR_IMAGE_PREFIX} @ ${IMAGE_TAG}"
