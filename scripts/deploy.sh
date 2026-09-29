#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  npm run deploy -- prod
  npm run deploy:prod
  bash scripts/deploy.sh prod [--dry-run]

Options:
  --dry-run   Print the planned steps without changing the checkout or restarting services.

Environment overrides:
  DEPLOY_SERVICE_NAME   systemd service to restart (default: lead-os)
  DEPLOY_NPM_BIN        npm binary used for install, validation, and build (default: /usr/bin/npm)
  DEPLOY_MANAGER_URL    manager URL for health checks (default: https://lead.daycommand.online)
  DEPLOY_DEVELOPER_URL  developer URL for route checks (default: https://developer.daycommand.online)
  DEPLOY_HEALTH_TIMEOUT_SECONDS   total time to wait for health checks (default: 30)
  DEPLOY_HEALTH_RETRY_DELAY_SECONDS   pause between health retries (default: 2)
EOF
}

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

run_cmd() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi

  "$@"
}

run_npm() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run] %s %s\n' "${NPM_BIN}" "$*"
    return 0
  fi

  env PATH="${NPM_PATH}" "${NPM_BIN}" "$@"
}

has_configured_secret() {
  if [[ -n "${JIRA_TOKEN_ENCRYPTION_KEY:-}" || -n "${LEADOS_SECRET_KEY:-}" ]]; then
    return 0
  fi

  if [[ ! -f ".env" ]]; then
    return 1
  fi

  grep -Eq '^[[:space:]]*(export[[:space:]]+)?(JIRA_TOKEN_ENCRYPTION_KEY|LEADOS_SECRET_KEY)[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env
}

require_production_secret() {
  if has_configured_secret; then
    return 0
  fi

  cat >&2 <<'EOF'
Missing production secret: set JIRA_TOKEN_ENCRYPTION_KEY or LEADOS_SECRET_KEY before deploying.

This key is not the Jira API token. It is the stable app-side encryption key used
to encrypt stored Jira API tokens in SQLite. Generate one with:

  openssl rand -base64 32

Then add it to the production .env file and keep it backed up outside the repo.
EOF
  return 1
}

# Production sits behind cloudflared/nginx, so without TRUST_PROXY every login
# arrives from 127.0.0.1 and the throttle keys on one shared address (docs/23).
require_trust_proxy() {
  if [[ -n "${TRUST_PROXY:-}" ]]; then
    return 0
  fi

  if [[ -f ".env" ]] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?TRUST_PROXY[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env; then
    return 0
  fi

  cat >&2 <<'EOF'
Missing TRUST_PROXY: production runs behind a reverse proxy, so the login throttle
needs it to see the real client IP. Add this to the production .env file:

  TRUST_PROXY=loopback

See docs/23 "Client IP And TRUST_PROXY".
EOF
  return 1
}

wait_for_check() {
  local label="$1"
  shift

  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run] wait for %s: %s\n' "${label}" "$*"
    return 0
  fi

  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))

  while true; do
    if "$@"; then
      return 0
    fi

    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for ${label} after ${HEALTH_TIMEOUT_SECONDS}s." >&2
      return 1
    fi

    log "${label} not ready yet; retrying in ${HEALTH_RETRY_DELAY_SECONDS}s"
    sleep "${HEALTH_RETRY_DELAY_SECONDS}"
  done
}

MODE="${1:-}"
DRY_RUN="0"

if [[ $# -ge 1 ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ -z "${MODE}" || "${MODE}" == "-h" || "${MODE}" == "--help" ]]; then
  usage
  exit 1
fi

if [[ "${MODE}" != "prod" ]]; then
  echo "Unsupported deploy target: ${MODE}" >&2
  echo "Only 'prod' is supported for this repository." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXPECTED_BASENAME="lead-os-prod"
SERVICE_NAME="${DEPLOY_SERVICE_NAME:-lead-os}"
NPM_BIN="${DEPLOY_NPM_BIN:-/usr/bin/npm}"
MANAGER_URL="${DEPLOY_MANAGER_URL:-https://lead.daycommand.online}"
DEVELOPER_URL="${DEPLOY_DEVELOPER_URL:-https://developer.daycommand.online}"
HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-30}"
HEALTH_RETRY_DELAY_SECONDS="${DEPLOY_HEALTH_RETRY_DELAY_SECONDS:-2}"

if [[ ! -x "${NPM_BIN}" ]]; then
  NPM_BIN="$(command -v npm)"
fi

NPM_PATH="$(dirname "${NPM_BIN}"):/usr/bin:/bin:${PATH}"

if [[ "$(basename "${ROOT_DIR}")" != "${EXPECTED_BASENAME}" ]]; then
  ROOT_DIR="/home/ubuntu/apps/${EXPECTED_BASENAME}"
fi

if [[ ! -d "${ROOT_DIR}/.git" ]]; then
  echo "Production checkout not found at '${ROOT_DIR}'." >&2
  exit 1
fi

if [[ "$(basename "${ROOT_DIR}")" != "${EXPECTED_BASENAME}" ]]; then
  echo "Refusing to deploy from '${ROOT_DIR}'." >&2
  echo "Expected the production checkout to be named '${EXPECTED_BASENAME}'." >&2
  exit 1
fi

cd "${ROOT_DIR}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Clean or commit local changes before deploying." >&2
  git status --short >&2
  exit 1
fi

require_production_secret
require_trust_proxy

log "Fetching latest production target"
run_cmd git fetch origin main

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

if [[ "${LOCAL_HEAD}" != "${REMOTE_HEAD}" ]]; then
  log "Updating checkout to origin/main"
  run_cmd git pull --ff-only origin main
else
  log "Checkout already matches origin/main"
fi

log "Installing dependencies from lockfile"
run_npm ci

log "Running production validation gate"
run_npm run guard:data
run_npm run typecheck
run_npm test
run_npm run lint
run_npm run format:check
run_npm run build:check

log "Building client and server"
run_npm run build

log "Restarting ${SERVICE_NAME}"
run_cmd sudo systemctl restart "${SERVICE_NAME}"

log "Checking ${SERVICE_NAME} status"
run_cmd sudo systemctl status "${SERVICE_NAME}" --no-pager

log "Verifying manager URL"
wait_for_check "manager URL" curl -fsS -I "${MANAGER_URL}"

log "Verifying developer URL"
wait_for_check "developer URL" curl -fsS -I "${DEVELOPER_URL}/my-day"

log "Verifying health endpoint"
wait_for_check "health endpoint" curl -fsS "${MANAGER_URL}/api/health"

log "Production deploy completed"
