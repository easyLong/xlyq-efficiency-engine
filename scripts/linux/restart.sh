#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ensure_service_exists

echo "Restarting ${SERVICE_NAME}..."
run_sudo systemctl restart "${SERVICE_NAME}"
run_sudo systemctl status "${SERVICE_NAME}" --no-pager

wait_for_health
