#!/usr/bin/env bash

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$(pwd)/backend" ]; then
  DEFAULT_APP_DIR="$(pwd)"
else
  DEFAULT_APP_DIR="$(cd "${COMMON_DIR}/../.." && pwd)"
fi

SERVICE_NAME="${SERVICE_NAME:-xlyq-efficiency-engine}"
SERVICE_MODE="${SERVICE_MODE:-auto}"
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

load_node_env() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  local nvm_paths=(
    "${NVM_DIR:-}/nvm.sh"
    "${HOME:-}/.nvm/nvm.sh"
    "/root/.nvm/nvm.sh"
    "/home/${SUDO_USER:-}/.nvm/nvm.sh"
  )

  for nvm_sh in "${nvm_paths[@]}"; do
    if [ -n "${nvm_sh}" ] && [ -f "${nvm_sh}" ]; then
      # shellcheck disable=SC1090
      source "${nvm_sh}"
      break
    fi
  done
}

require_command() {
  local command_name="$1"
  if command -v "${command_name}" >/dev/null 2>&1; then
    return 0
  fi

  echo "Command not found: ${command_name}" >&2
  echo "Install Node.js 20+ and npm first, then rerun this script." >&2
  echo "Ubuntu/Debian example:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -" >&2
  echo "  sudo apt-get install -y nodejs" >&2
  echo "If you use nvm, run:" >&2
  echo "  source ~/.nvm/nvm.sh && nvm install 20 && nvm use 20" >&2
  exit 1
}

install_backend_dependencies() {
  require_command npm
  cd "${BACKEND_DIR}"
  if [ -f "${BACKEND_DIR}/package-lock.json" ]; then
    npm ci --include=dev
  else
    npm install --include=dev
  fi
}

ensure_build_dependencies() {
  if [ -x "${BACKEND_DIR}/node_modules/.bin/nest" ]; then
    return 0
  fi

  echo "Build dependency not found: node_modules/.bin/nest"
  echo "Installing backend dependencies including devDependencies..."
  install_backend_dependencies
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

  local public_base_url="${APP_PUBLIC_BASE_URL:-$(env_value APP_PUBLIC_BASE_URL "")}"
  if [ -n "${public_base_url}" ]; then
    public_base_url="${public_base_url%/}"
    printf '%s/api/v1/health' "${public_base_url}"
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
  if [ "${SERVICE_MODE}" = "direct" ]; then
    return 1
  fi
  run_sudo systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1
}

print_systemd_logs() {
  echo "Recent systemd logs:" >&2
  run_sudo journalctl -u "${SERVICE_NAME}" -n "${JOURNAL_LINES:-80}" --no-pager >&2 || true
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
  local connect_timeout="${HEALTH_CONNECT_TIMEOUT:-2}"
  local max_time="${HEALTH_MAX_TIME:-5}"

  if [ "${SKIP_HEALTH_CHECK:-0}" = "1" ]; then
    echo "Skipping health check because SKIP_HEALTH_CHECK=1."
    return 0
  fi

  echo "Checking health: ${health_url}"
  for attempt in $(seq 1 "${attempts}"); do
    if curl -fsS --connect-timeout "${connect_timeout}" --max-time "${max_time}" "${health_url}" >/dev/null 2>&1; then
      echo "Service is healthy."
      return 0
    fi
    echo "Health check failed (${attempt}/${attempts}), retrying in ${delay}s..."
    sleep "${delay}"
  done

  echo "Service started, but health check did not pass." >&2
  if systemd_service_exists; then
    echo "Run: sudo journalctl -u ${SERVICE_NAME} -n 100 --no-pager" >&2
    echo >&2
    print_systemd_logs
  else
    echo "Check logs:" >&2
    echo "  tail -n 100 ${ERR_LOG}" >&2
    echo "  tail -n 100 ${OUT_LOG}" >&2
    if [ -f "${ERR_LOG}" ]; then
      echo >&2
      echo "Last error log lines:" >&2
      tail -n 30 "${ERR_LOG}" >&2 || true
    fi
  fi
  return 1
}
