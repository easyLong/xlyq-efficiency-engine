#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ensure_backend_dir
load_node_env
require_command node

if systemd_service_exists; then
  echo "Restarting ${SERVICE_NAME} with systemd..."
  run_sudo systemctl restart "${SERVICE_NAME}"
  run_sudo systemctl status "${SERVICE_NAME}" --no-pager
else
  echo "systemd service not found. Restarting direct background process."
  stop_direct
  if [ ! -f "${BACKEND_DIR}/dist/main.js" ]; then
    cd "${BACKEND_DIR}"
    ensure_build_dependencies
    echo "Building backend..."
    npm run build
  fi
  start_direct
fi

wait_for_health
