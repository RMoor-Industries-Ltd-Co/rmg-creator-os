#!/usr/bin/env bash
# Pull and (re)launch the control-server stack at a given image tag.
#
# All runtime secrets come from Doppler (DOPPLER_TOKEN must be set).
# GHCR_IMAGE_PREFIX and IMAGE_TAG are deploy-time vars passed by the caller.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/rmg-creator-os/control-server}"
GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:?GHCR_IMAGE_PREFIX is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
GHCR_USERNAME="${GHCR_USERNAME:?GHCR_USERNAME is required}"
GHCR_TOKEN="${GHCR_TOKEN:?GHCR_TOKEN is required}"
DOPPLER_TOKEN="${DOPPLER_TOKEN:?DOPPLER_TOKEN is required}"

cd "$DEPLOY_DIR"

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

export GHCR_IMAGE_PREFIX IMAGE_TAG

DOPPLER_TOKEN="$DOPPLER_TOKEN" doppler run -- docker compose pull gateway dashboard allen
DOPPLER_TOKEN="$DOPPLER_TOKEN" doppler run -- docker compose up -d
docker image prune -f

echo "deployed ${GHCR_IMAGE_PREFIX} @ ${IMAGE_TAG}"
