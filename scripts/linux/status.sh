#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-xlyq-efficiency-engine}"
PORT="${PORT:-9000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/v1/health}"

run_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_sudo systemctl status "${SERVICE_NAME}" --no-pager || true

echo
echo "Health check: ${HEALTH_URL}"
if curl -fsS "${HEALTH_URL}"; then
  echo
  echo "Health check passed."
else
  echo
  echo "Health check failed." >&2
  exit 1
fi
