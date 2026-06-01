#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[ellavox]${NC} $1"; }
ok()   { echo -e "${GREEN}[ellavox]${NC} $1"; }

log "Stopping Ellavox dev services..."

# Stop Redis
if redis-cli ping &>/dev/null 2>&1; then
  redis-cli shutdown nosave &>/dev/null 2>&1 || true
  ok "Redis stopped."
fi

# Stop Supabase
if command -v supabase &>/dev/null; then
  log "Stopping Supabase..."
  supabase stop 2>/dev/null || true
  ok "Supabase stopped."
fi

ok "All services stopped."
