#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

if systemd_service_exists; then
  echo "Stopping ${SERVICE_NAME} with systemd..."
  run_sudo systemctl stop "${SERVICE_NAME}"
  run_sudo systemctl status "${SERVICE_NAME}" --no-pager || true
  echo "Service stopped."
else
  stop_direct
fi
