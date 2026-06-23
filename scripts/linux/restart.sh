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

wait_for_health() {
  local attempts="${HEALTH_CHECK_ATTEMPTS:-20}"
  local delay="${HEALTH_CHECK_DELAY:-2}"

  echo "Checking health: ${HEALTH_URL}"
  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      echo "Service is healthy."
      return 0
    fi
    sleep "${delay}"
  done

  echo "Service restarted, but health check did not pass." >&2
  echo "Run: sudo journalctl -u ${SERVICE_NAME} -n 100 --no-pager" >&2
  return 1
}

if ! run_sudo systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1; then
  echo "systemd service not found: ${SERVICE_NAME}" >&2
  exit 1
fi

echo "Restarting ${SERVICE_NAME}..."
run_sudo systemctl restart "${SERVICE_NAME}"
run_sudo systemctl status "${SERVICE_NAME}" --no-pager

wait_for_health
