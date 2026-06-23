#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-xlyq-efficiency-engine}"
APP_DIR="${APP_DIR:-/opt/xlyq-efficiency-engine}"
BACKEND_DIR="${BACKEND_DIR:-${APP_DIR}/backend}"
PORT="${PORT:-9000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/v1/health}"
BUILD_ON_START="${BUILD_ON_START:-0}"
NPM_INSTALL_ON_START="${NPM_INSTALL_ON_START:-0}"
ENABLE_ON_BOOT="${ENABLE_ON_BOOT:-1}"

run_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_backend_dir() {
  if [ ! -d "${BACKEND_DIR}" ]; then
    echo "Backend directory not found: ${BACKEND_DIR}" >&2
    echo "Set APP_DIR=/path/to/xlyq-efficiency-engine or BACKEND_DIR=/path/to/backend." >&2
    exit 1
  fi
}

ensure_service_exists() {
  if ! run_sudo systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1; then
    echo "systemd service not found: ${SERVICE_NAME}" >&2
    echo "Create /etc/systemd/system/${SERVICE_NAME}.service first, then run this script again." >&2
    exit 1
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

  echo "Service started, but health check did not pass." >&2
  echo "Run: sudo journalctl -u ${SERVICE_NAME} -n 100 --no-pager" >&2
  return 1
}

ensure_backend_dir
ensure_service_exists

cd "${BACKEND_DIR}"

if [ "${NPM_INSTALL_ON_START}" = "1" ]; then
  echo "Installing backend dependencies..."
  npm ci
fi

if [ "${BUILD_ON_START}" = "1" ] || [ ! -f "${BACKEND_DIR}/dist/main.js" ]; then
  echo "Building backend..."
  npm run build
fi

echo "Reloading systemd..."
run_sudo systemctl daemon-reload

if [ "${ENABLE_ON_BOOT}" = "1" ]; then
  echo "Enabling ${SERVICE_NAME} on boot..."
  run_sudo systemctl enable "${SERVICE_NAME}" >/dev/null
fi

echo "Starting ${SERVICE_NAME}..."
run_sudo systemctl start "${SERVICE_NAME}"
run_sudo systemctl status "${SERVICE_NAME}" --no-pager

wait_for_health
