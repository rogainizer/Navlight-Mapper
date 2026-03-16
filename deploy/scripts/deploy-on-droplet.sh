#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="${1:-$(pwd)}"
ENV_FILE="${PROJECT_ROOT}/.env"
COMPOSE_FILE="${PROJECT_ROOT}/deploy/docker-compose.droplet.yml"
MIGRATION_SQL="${PROJECT_ROOT}/deploy/sql/001_navlight_mapper_migration.sql"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file at ${ENV_FILE}"
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing compose file at ${COMPOSE_FILE}"
  exit 1
fi

if [[ ! -f "${MIGRATION_SQL}" ]]; then
  echo "Missing migration script at ${MIGRATION_SQL}"
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${DB_HOST:?DB_HOST is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${DB_NAME:?DB_NAME is required}"

if [[ -z "${GHCR_READ_USER:-}" || -z "${GHCR_READ_TOKEN:-}" ]]; then
  echo "GHCR_READ_USER and GHCR_READ_TOKEN must be provided in the runtime environment."
  exit 1
fi

echo "Logging into GHCR..."
echo "${GHCR_READ_TOKEN}" | docker login ghcr.io -u "${GHCR_READ_USER}" --password-stdin

echo "Running MySQL migration script..."
docker run --rm \
  -e MYSQL_PWD="${DB_PASSWORD}" \
  -e DB_HOST="${DB_HOST}" \
  -e DB_PORT="${DB_PORT:-3306}" \
  -e DB_USER="${DB_USER}" \
  -e DB_NAME="${DB_NAME}" \
  -v "${PROJECT_ROOT}/deploy/sql:/sql:ro" \
  mysql:8.4 \
  sh -c 'mysql --protocol=TCP -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}" < /sql/001_navlight_mapper_migration.sql'

echo "Pulling latest application images..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull

echo "Starting application containers..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans

echo "Deployment status:"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
