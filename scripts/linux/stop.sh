#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-xlyq-efficiency-engine}"

run_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

if ! run_sudo systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1; then
  echo "systemd service not found: ${SERVICE_NAME}" >&2
  exit 1
fi

echo "Stopping ${SERVICE_NAME}..."
run_sudo systemctl stop "${SERVICE_NAME}"
run_sudo systemctl status "${SERVICE_NAME}" --no-pager || true
echo "Service stopped."
