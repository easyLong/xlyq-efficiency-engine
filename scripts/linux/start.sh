#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

BUILD_ON_START="${BUILD_ON_START:-0}"
NPM_INSTALL_ON_START="${NPM_INSTALL_ON_START:-0}"
ENABLE_ON_BOOT="${ENABLE_ON_BOOT:-1}"

ensure_backend_dir

cd "${BACKEND_DIR}"
load_node_env
require_command node

if [ "${NPM_INSTALL_ON_START}" = "1" ]; then
  echo "Installing backend dependencies..."
  install_backend_dependencies
fi

if [ "${BUILD_ON_START}" = "1" ] || [ ! -f "${BACKEND_DIR}/dist/main.js" ]; then
  ensure_build_dependencies
  echo "Building backend..."
  npm run build
fi

if systemd_service_exists; then
  echo "Starting with systemd: ${SERVICE_NAME}"
  echo "Reloading systemd..."
  run_sudo systemctl daemon-reload

  if [ "${ENABLE_ON_BOOT}" = "1" ]; then
    echo "Enabling ${SERVICE_NAME} on boot..."
    run_sudo systemctl enable "${SERVICE_NAME}" >/dev/null
  fi

  run_sudo systemctl start "${SERVICE_NAME}"
  run_sudo systemctl status "${SERVICE_NAME}" --no-pager
else
  echo "systemd service not found. Falling back to direct background mode."
  start_direct
fi

wait_for_health
