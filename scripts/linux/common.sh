#!/usr/bin/env bash

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$(pwd)/backend" ]; then
  DEFAULT_APP_DIR="$(pwd)"
else
  DEFAULT_APP_DIR="$(cd "${COMMON_DIR}/../.." && pwd)"
fi

SERVICE_NAME="${SERVICE_NAME:-xlyq-efficiency-engine}"
APP_DIR="${APP_DIR:-${DEFAULT_APP_DIR}}"
BACKEND_DIR="${BACKEND_DIR:-${APP_DIR}/backend}"
ENV_FILE="${ENV_FILE:-${BACKEND_DIR}/.env}"
RUN_DIR="${RUN_DIR:-${APP_DIR}/.runtime}"
LOG_DIR="${LOG_DIR:-${APP_DIR}/logs}"
PID_FILE="${PID_FILE:-${RUN_DIR}/${SERVICE_NAME}.pid}"
OUT_LOG="${OUT_LOG:-${LOG_DIR}/${SERVICE_NAME}.out.log}"
ERR_LOG="${ERR_LOG:-${LOG_DIR}/${SERVICE_NAME}.err.log}"

run_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

env_value() {
  local key="$1"
  local fallback="${2:-}"

  if [ ! -f "${ENV_FILE}" ]; then
    printf '%s' "${fallback}"
    return
  fi

  local line
  line="$(grep -E "^[[:space:]]*${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  if [ -z "${line}" ]; then
    printf '%s' "${fallback}"
    return
  fi

  local value="${line#*=}"
  value="${value%%#*}"
  value="$(printf '%s' "${value}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  printf '%s' "${value:-${fallback}}"
}

resolve_health_url() {
  if [ -n "${HEALTH_URL:-}" ]; then
    printf '%s' "${HEALTH_URL}"
    return
  fi

  local port="${PORT:-$(env_value PORT 9000)}"
  local bind_host="${HOST:-$(env_value HOST 0.0.0.0)}"
  local health_host="${HEALTH_HOST:-${bind_host}}"

  case "${health_host}" in
    ""|"0.0.0.0"|"::")
      health_host="127.0.0.1"
      ;;
  esac

  printf 'http://%s:%s/api/v1/health' "${health_host}" "${port}"
}

ensure_backend_dir() {
  if [ ! -d "${BACKEND_DIR}" ]; then
    echo "Backend directory not found: ${BACKEND_DIR}" >&2
    echo "Run this script from the repository copy, or set APP_DIR=/path/to/xlyq-efficiency-engine." >&2
    echo "If backend lives elsewhere, set BACKEND_DIR=/path/to/backend." >&2
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

systemd_service_exists() {
  run_sudo systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1
}

direct_pid() {
  if [ -f "${PID_FILE}" ]; then
    cat "${PID_FILE}"
  fi
}

direct_is_running() {
  local pid
  pid="$(direct_pid || true)"
  [ -n "${pid}" ] && kill -0 "${pid}" >/dev/null 2>&1
}

start_direct() {
  mkdir -p "${RUN_DIR}" "${LOG_DIR}"
  if direct_is_running; then
    echo "${SERVICE_NAME} is already running in direct mode. PID: $(direct_pid)"
    return 0
  fi

  cd "${BACKEND_DIR}"
  echo "Starting ${SERVICE_NAME} directly..."
  echo "Logs: ${OUT_LOG}, ${ERR_LOG}"
  nohup node dist/main.js >"${OUT_LOG}" 2>"${ERR_LOG}" &
  echo "$!" >"${PID_FILE}"
  echo "PID: $(direct_pid)"
}

stop_direct() {
  if ! direct_is_running; then
    echo "${SERVICE_NAME} is not running in direct mode."
    rm -f "${PID_FILE}"
    return 0
  fi

  local pid
  pid="$(direct_pid)"
  echo "Stopping ${SERVICE_NAME} direct process. PID: ${pid}"
  kill "${pid}"
  for _ in $(seq 1 20); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      rm -f "${PID_FILE}"
      echo "Service stopped."
      return 0
    fi
    sleep 1
  done

  echo "Process did not stop gracefully, killing PID ${pid}."
  kill -9 "${pid}" >/dev/null 2>&1 || true
  rm -f "${PID_FILE}"
}

status_direct() {
  if direct_is_running; then
    echo "${SERVICE_NAME} direct mode: running. PID: $(direct_pid)"
    echo "Logs: ${OUT_LOG}, ${ERR_LOG}"
  else
    echo "${SERVICE_NAME} direct mode: not running."
    [ -f "${PID_FILE}" ] && echo "Stale PID file: ${PID_FILE}"
  fi
}

wait_for_health() {
  local health_url="${1:-$(resolve_health_url)}"
  local attempts="${HEALTH_CHECK_ATTEMPTS:-20}"
  local delay="${HEALTH_CHECK_DELAY:-2}"

  echo "Checking health: ${health_url}"
  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS "${health_url}" >/dev/null 2>&1; then
      echo "Service is healthy."
      return 0
    fi
    sleep "${delay}"
  done

  echo "Service started, but health check did not pass." >&2
  echo "Run: sudo journalctl -u ${SERVICE_NAME} -n 100 --no-pager" >&2
  return 1
}
