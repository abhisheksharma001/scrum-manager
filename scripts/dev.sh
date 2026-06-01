#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[ellavox]${NC} $1"; }
ok()   { echo -e "${GREEN}[ellavox]${NC} $1"; }
warn() { echo -e "${YELLOW}[ellavox]${NC} $1"; }
err()  { echo -e "${RED}[ellavox]${NC} $1"; }

# Helper: extract a JSON string value by key from supabase status --output json
json_val() {
  local json="$1" key="$2"
  echo "$json" | grep -o "\"${key}\": *\"[^\"]*\"" | head -1 | sed "s/\"${key}\": *\"\([^\"]*\)\"/\1/"
}

upsert_env() {
  local file="$1" key="$2" value="$3" tmp
  if [ ! -f "$file" ]; then
    printf "# Local development environment. Do not commit.\n" > "$file"
  fi

  if grep -q "^${key}=" "$file"; then
    tmp="$(mktemp)"
    awk -v key="$key" -v value="$value" 'BEGIN { prefix = key "=" } $0 ~ "^" key "=" { print prefix value; next } { print }' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf "%s=%s\n" "$key" "$value" >> "$file"
  fi
}

ensure_env() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ] || ! grep -q "^${key}=" "$file"; then
    upsert_env "$file" "$key" "$value"
  fi
}

cleanup() {
  log "Shutting down..."
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
  ok "All processes stopped."
}
trap cleanup EXIT INT TERM

# ─── Preflight checks ───────────────────────────────────────────────────────

log "Running preflight checks..."

if ! command -v node &>/dev/null; then
  err "Node.js is required. Install it from https://nodejs.org"
  exit 1
fi

if ! command -v supabase &>/dev/null; then
  err "Supabase CLI is required. Install: brew install supabase/tap/supabase"
  exit 1
fi

if ! command -v redis-server &>/dev/null; then
  warn "Redis not found. Rate limiting will be disabled locally."
  warn "Install with: brew install redis (optional)"
fi

if ! docker info &>/dev/null 2>&1; then
  err "Docker must be running for Supabase local dev."
  err "Start Docker Desktop, then re-run this script."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  log "Installing pnpm dependencies..."
  pnpm install
fi

# ─── .env setup ──────────────────────────────────────────────────────────────

if [ ! -f ".env" ] && [ ! -f ".env.local" ]; then
  warn "No .env file found. Creating .env.local for generated local values..."
  printf "# Local development environment. Do not commit.\n" > .env.local
  warn "Add external credentials to .env.local when you need AI, Jira, Slack, or repo brief delivery."
fi

# ─── Start Supabase ─────────────────────────────────────────────────────────

log "Starting Supabase (Postgres, Auth, Storage, Realtime)..."

# Check if already running by trying to get status JSON
SUPABASE_JSON=$(supabase status --output json 2>/dev/null || echo '{}')

if [ "$SUPABASE_JSON" = "{}" ] || ! echo "$SUPABASE_JSON" | grep -q "API_URL"; then
  supabase start
  # Re-fetch status after start
  SUPABASE_JSON=$(supabase status --output json 2>/dev/null || echo '{}')
else
  ok "Supabase is already running."
fi

# Extract credentials from JSON output
SB_URL=$(json_val "$SUPABASE_JSON" "API_URL")
SB_ANON_KEY=$(json_val "$SUPABASE_JSON" "ANON_KEY")
SB_SERVICE_KEY=$(json_val "$SUPABASE_JSON" "SERVICE_ROLE_KEY")
SB_STUDIO_URL=$(json_val "$SUPABASE_JSON" "STUDIO_URL")
DB_URL=$(json_val "$SUPABASE_JSON" "DB_URL")

if [ -n "$SB_URL" ] && [ -n "$SB_SERVICE_KEY" ]; then
  upsert_env .env.local "SUPABASE_URL" "$SB_URL"
  upsert_env .env.local "SUPABASE_SERVICE_KEY" "$SB_SERVICE_KEY"
  upsert_env .env.local "NEXT_PUBLIC_SUPABASE_URL" "$SB_URL"
  upsert_env .env.local "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$SB_ANON_KEY"
  ensure_env .env.local "REDIS_HOST" "localhost"
  ensure_env .env.local "REDIS_PORT" "6379"
  ensure_env .env.local "NEXT_PUBLIC_APP_URL" "http://localhost:3000"
  ensure_env .env.local "LOG_LEVEL" "debug"
  ok "Supabase credentials updated in .env.local"
else
  warn "Could not extract Supabase credentials. Check 'supabase status'."
fi

# ─── Run migrations ─────────────────────────────────────────────────────────

log "Applying database migrations..."

if [ -n "${DB_URL:-}" ]; then
  for migration in supabase/migrations/*.sql; do
    if [ -f "$migration" ]; then
      log "  Applying $(basename "$migration")..."
      psql "$DB_URL" -f "$migration" -q 2>&1 | grep -v "^$" || warn "  Migration may have already been applied: $(basename "$migration")"
    fi
  done
  ok "Migrations applied."
else
  warn "Could not get DB URL. Run migrations manually."
fi

# ─── Start Redis (optional, for rate limiting) ──────────────────────────────

if command -v redis-cli &>/dev/null && redis-cli ping &>/dev/null 2>&1; then
  ok "Redis is already running (rate limiting enabled)."
elif command -v redis-server &>/dev/null; then
  log "Starting Redis..."
  redis-server --daemonize yes --loglevel warning
  sleep 1
  if redis-cli ping &>/dev/null 2>&1; then
    ok "Redis started."
  else
    warn "Failed to start Redis. Rate limiting will be disabled."
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Ellavox dev environment is ready!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}App:${NC}        http://localhost:3000"
[ -n "${SB_STUDIO_URL:-}" ] && echo -e "  ${BLUE}Supabase:${NC}   ${SB_STUDIO_URL}"
echo -e "  ${BLUE}Queues:${NC}     Vercel Queues (runs inline with next dev)"
echo ""

# ─── Start app services ─────────────────────────────────────────────────────

# Next.js in foreground (Ctrl+C stops everything via trap)
pnpm exec next dev
