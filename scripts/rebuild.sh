#!/bin/bash
set -e

echo "==> Pulling latest changes..."
git pull

echo "==> Stopping containers..."
docker compose -f compose.deploy.yaml down

echo "==> Pruning Docker system..."
docker system prune -a --volumes -f

echo "==> Building images (no cache)..."
docker compose -f compose.deploy.yaml build --no-cache

echo "==> Starting containers..."
docker compose -f compose.deploy.yaml up -d

echo "==> Done."
