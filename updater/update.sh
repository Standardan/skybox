#!/bin/sh
# Runs inside the `updater` container, which is the only thing in this
# deployment with Docker access at all (see docker-compose.yml + README's
# "Updating Skybox" section). Pulls the latest commit and rebuilds/restarts
# just the `skybox` service — never touches `updater`/`caddy` themselves.
set -e

cd /workspace
echo "[updater] pulling latest..."
git pull --ff-only
echo "[updater] rebuilding skybox..."
docker compose build skybox
echo "[updater] restarting skybox..."
docker compose up -d skybox
echo "[updater] done."
