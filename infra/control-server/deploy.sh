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

cd "$DEPLOY_DIR"

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

# Source Doppler secrets into the shell, then re-assert deploy-time vars so
# they cannot be shadowed by any same-named Doppler entries.
eval "$(DOPPLER_TOKEN="$DOPPLER_TOKEN" doppler secrets download --no-file --format env-no-quotes)"
export GHCR_IMAGE_PREFIX IMAGE_TAG

# Only pull images owned by this org; allen is managed by piaar/rmg-ai separately.
docker compose pull gateway dashboard
docker compose up -d
docker image prune -f

echo "deployed ${GHCR_IMAGE_PREFIX} @ ${IMAGE_TAG}"
