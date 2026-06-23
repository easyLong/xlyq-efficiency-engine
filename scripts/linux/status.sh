#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

if systemd_service_exists; then
  run_sudo systemctl status "${SERVICE_NAME}" --no-pager || true
else
  status_direct
fi

HEALTH_URL="$(resolve_health_url)"
echo
echo "Health check: ${HEALTH_URL}"
if curl -fsS --connect-timeout "${HEALTH_CONNECT_TIMEOUT:-2}" --max-time "${HEALTH_MAX_TIME:-5}" "${HEALTH_URL}"; then
  echo
  echo "Health check passed."
else
  echo
  echo "Health check failed." >&2
  exit 1
fi
