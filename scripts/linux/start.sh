#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

BUILD_ON_START="${BUILD_ON_START:-0}"
NPM_INSTALL_ON_START="${NPM_INSTALL_ON_START:-0}"
ENABLE_ON_BOOT="${ENABLE_ON_BOOT:-1}"

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
