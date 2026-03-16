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

DB_PORT="${DB_PORT:-3306}"
DB_HOST_FOR_CONTAINERS="${DB_HOST}"

case "${DB_HOST}" in
  localhost|127.0.0.1|::1)
    # Containers cannot reach host loopback directly on Linux; use host-gateway alias.
    DB_HOST_FOR_CONTAINERS="host.docker.internal"
    echo "DB_HOST=${DB_HOST} detected; using ${DB_HOST_FOR_CONTAINERS} for container connectivity."
    ;;
esac

RUNTIME_ENV_FILE="${PROJECT_ROOT}/.env.runtime"
grep -Ev '^(DB_HOST|DB_PORT)=' "${ENV_FILE}" > "${RUNTIME_ENV_FILE}"
{
  echo "DB_HOST=${DB_HOST_FOR_CONTAINERS}"
  echo "DB_PORT=${DB_PORT}"
} >> "${RUNTIME_ENV_FILE}"

if [[ -z "${GHCR_READ_USER:-}" || -z "${GHCR_READ_TOKEN:-}" ]]; then
  echo "GHCR_READ_USER and GHCR_READ_TOKEN must be provided in the runtime environment."
  exit 1
fi

echo "Logging into GHCR..."
echo "${GHCR_READ_TOKEN}" | docker login ghcr.io -u "${GHCR_READ_USER}" --password-stdin

run_mysql_migration() {
  docker run --rm \
    --add-host host.docker.internal:host-gateway \
    -e MYSQL_PWD="${DB_PASSWORD}" \
    -e DB_HOST="${DB_HOST_FOR_CONTAINERS}" \
    -e DB_PORT="${DB_PORT}" \
    -e DB_USER="${DB_USER}" \
    -e DB_NAME="${DB_NAME}" \
    -v "${PROJECT_ROOT}/deploy/sql:/sql:ro" \
    mysql:8.4 \
    sh -c '
      mysql --protocol=TCP -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" \
        -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
      mysql --protocol=TCP -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}" < /sql/001_navlight_mapper_migration.sql
    '
}

echo "Running MySQL migration script against ${DB_HOST_FOR_CONTAINERS}:${DB_PORT}..."
max_attempts=5
attempt=1
until run_mysql_migration; do
  if (( attempt >= max_attempts )); then
    echo "MySQL migration failed after ${max_attempts} attempts."
    echo "Verify DB_HOST/DB_PORT are reachable from the droplet and Docker containers."
    echo "For MySQL on the droplet host, set DB_HOST=localhost or 127.0.0.1."
    exit 1
  fi

  echo "MySQL migration failed on attempt ${attempt}/${max_attempts}; retrying in 5 seconds..."
  attempt=$((attempt + 1))
  sleep 5
done

echo "Pulling latest application images..."
docker compose --env-file "${RUNTIME_ENV_FILE}" -f "${COMPOSE_FILE}" pull

echo "Starting application containers..."
docker compose --env-file "${RUNTIME_ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans

echo "Deployment status:"
docker compose --env-file "${RUNTIME_ENV_FILE}" -f "${COMPOSE_FILE}" ps
