#!/usr/bin/env bash
# WP-0.6 — Playwright smoke runner (server lifecycle owner).
#
# Orchestrates the full TC-DSH-005/007/008/009 evidence run against an
# ISOLATED smoke DSH_HOME (never the user's ~/.dsh):
#
#   baseline (enabled)  -> smoke.loaded.spec.ts    (TC-DSH-007, U1, U2, U3)
#   for round in 1..N:
#     disabled          -> smoke.unloaded.spec.ts  (TC-DSH-005: nothing residual)
#     enabled (recover) -> smoke.loaded.spec.ts    (TC-DSH-009: clean reload)
#
# Disable/enable is the documented §3.5 mechanism: the profile user patch
# layer ($DSH_HOME/profiles/web/cordis.patch.yml) sets `disabled: true` on the
# `research-control` row (id-diffed; the row is kept), then the server is
# restarted cold (the web-app composition is cold-restart by design — the
# base `hmr` row is disabled there).
#
# Env overrides:
#   DSH_SMOKE_ROOT  smoke root (default: <repo>/../.smoke)
#   DSH_HOME        smoke dsh home (default: $DSH_SMOKE_ROOT/dsh-home)
#   E2E_PORT        web port (default 3199 — never 3080)
#   E2E_CYCLES      load/unload cycles N (default 2)
#   E2E_STATE       run ONE phase only and exit: loaded | unloaded
#                   (implies the matching plugin state; server left running
#                   unless E2E_KILL_AFTER=1)
#   E2E_KILL_AFTER  with E2E_STATE: kill the server at the end
#
# The playwright specs assume the server is already serving (they never
# start/stop it); this script owns start -> wait -> test -> kill -> verify.
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_ROOT="${DSH_SMOKE_ROOT:-$(cd "$REPO_DIR/.." && pwd)/.smoke}"
DSH_HOME="${DSH_HOME:-$SMOKE_ROOT/dsh-home}"
DSH_BIN="$SMOKE_ROOT/cli/node_modules/.bin/dsh"
E2E_PORT="${E2E_PORT:-3199}"
E2E_BASE_URL="http://127.0.0.1:$E2E_PORT"
EVIDENCE_DIR="$SMOKE_ROOT/evidence"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$SMOKE_ROOT/pw-browsers}"
EXPECTED_DSH_VERSION="0.1.0-rc.8"
CYCLES="${E2E_CYCLES:-2}"

PROFILE_DIR="$DSH_HOME/profiles/web"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
SERVER_PID=""
TS="$(date +%Y%m%d-%H%M%S)"
RUN_LOG="$EVIDENCE_DIR/e2e-run-$TS.log"

mkdir -p "$EVIDENCE_DIR"
log() { printf '[e2e-run] %s\n' "$*" | tee -a "$RUN_LOG"; }
die() { log "FATAL: $*"; exit 1; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    log "cleanup: stopping server pid $SERVER_PID"
    kill "$SERVER_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

port_open() { curl -s --noproxy '*' -m 2 -o /dev/null "http://127.0.0.1:$E2E_PORT/" 2>/dev/null; }

wait_port_free() {
  for _ in $(seq 1 40); do port_open || return 0; sleep 0.5; done
  return 1
}

start_server() {
  local state="$1"
  SERVER_LOG="$EVIDENCE_DIR/web-server-$state-$TS.log"
  log "starting server ($state) on port $E2E_PORT (log: $SERVER_LOG)"
  (
    cd "$SMOKE_ROOT/cli"
    env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
      DSH_HOME="$DSH_HOME" \
      nohup "$DSH_BIN" web --port "$E2E_PORT" --no-open >>"$SERVER_LOG" 2>&1 &
    echo $! > "$EVIDENCE_DIR/server.pid"
  )
  SERVER_PID="$(cat "$EVIDENCE_DIR/server.pid")"
  for _ in $(seq 1 60); do
    port_open && { log "server up (pid $SERVER_PID)"; return 0; }
    kill -0 "$SERVER_PID" 2>/dev/null || { log "server process died early:"; tail -5 "$SERVER_LOG" | tee -a "$RUN_LOG"; die "server crashed on startup (state: $state)"; }
    sleep 1
  done
  die "server did not open port $E2E_PORT within 60s (log: $SERVER_LOG)"
}

stop_server() {
  [ -z "$SERVER_PID" ] && return 0
  log "stopping server pid $SERVER_PID"
  kill "$SERVER_PID" 2>/dev/null || true
  for _ in $(seq 1 40); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.5; done
  if kill -0 "$SERVER_PID" 2>/dev/null; then kill -9 "$SERVER_PID" 2>/dev/null || true; fi
  SERVER_PID=""
  wait_port_free || die "port $E2E_PORT still in use after stop (refusing to proceed)"
  log "port $E2E_PORT verified free"
}

set_plugin_state() {
  local state="$1"
  case "$state" in
    enabled)
      cat > "$PATCH_FILE" <<'EOF'
# WP-0.6 smoke: plugin row enabled (default user layer)
[]
EOF
      ;;
    disabled)
      cat > "$PATCH_FILE" <<'EOF'
# WP-0.6 smoke: plugin row disabled (TC-DSH-005/009 cycle)
- id: research-control
  disabled: true
EOF
      ;;
    *) die "unknown plugin state: $state" ;;
  esac
  log "plugin state -> $state"
}

run_spec() {
  local spec="$1"
  log "running e2e/$spec"
  (
    cd "$REPO_DIR"
    E2E_BASE_URL="$E2E_BASE_URL" \
      pnpm exec playwright test --config e2e/playwright.config.ts "e2e/$spec" 2>&1 | tee -a "$RUN_LOG"
  )
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
[ -x "$DSH_BIN" ] || die "dsh CLI not found at $DSH_BIN (CLI prep: pnpm add @deepseek-ai/dsh@$EXPECTED_DSH_VERSION in $SMOKE_ROOT/cli)"
[ -d "$PROFILE_DIR" ] || die "smoke profile missing at $PROFILE_DIR (run one dsh command with DSH_HOME=$DSH_HOME first)"
[ -f "$REPO_DIR/node_modules/@playwright/test/package.json" ] || die "@playwright/test not installed (run pnpm install in $REPO_DIR)"
[ -d "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1234" ] || die "chromium not found under $PLAYWRIGHT_BROWSERS_PATH (run: PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH pnpm exec playwright install chromium)"

# TC-DSH-008: pinned CLI version — loud failure on mismatch, never silent.
ACTUAL_VERSION="$("$DSH_BIN" --version)"
[ "$ACTUAL_VERSION" = "$EXPECTED_DSH_VERSION" ] || die "dsh version $ACTUAL_VERSION != pinned $EXPECTED_DSH_VERSION (TC-DSH-008 pin)"
log "dsh CLI version: $ACTUAL_VERSION (pinned)"

# pnpm 11 (this sandbox build) reads project config from pnpm-workspace.yaml,
# not .npmrc/npm_config_* env, and the default store is read-only here: make
# sure the profile's pnpm uses the smoke store.
if ! grep -q '^storeDir:' "$PROFILE_DIR/pnpm-workspace.yaml" 2>/dev/null; then
  printf '\nstoreDir: %s/pnpm-store\n' "$SMOKE_ROOT" >> "$PROFILE_DIR/pnpm-workspace.yaml"
  log "storeDir added to profile pnpm-workspace.yaml"
fi

# Plugin installed in the profile? (pnpm add file:tgz + bundle reconcile)
if ! grep -q '"dsh-research-control"' "$PROFILE_DIR/package.json"; then
  log "plugin not in profile — installing from fresh pack"
  ( cd "$REPO_DIR" && pnpm pack >>"$RUN_LOG" 2>&1 )
  TGZ="$(ls -1 "$REPO_DIR"/dsh-research-control-*.tgz 2>/dev/null | head -1 || true)"
  [ -n "$TGZ" ] || die "pnpm pack produced no tarball"
  DSH_HOME="$DSH_HOME" "$DSH_BIN" plugin --profile web add "$TGZ" 2>&1 | tee -a "$RUN_LOG"
else
  log "plugin already installed in profile"
fi

# dump-config evidence (TC-DSH-008): the composed tree must carry the row.
DSH_HOME="$DSH_HOME" "$DSH_BIN" --profile web --dump-config > "$EVIDENCE_DIR/dump-config-run-$TS.yml" 2>&1
grep -q 'id: research-control' "$EVIDENCE_DIR/dump-config-run-$TS.yml" || die "dump-config lacks the research-control row after install"
log "dump-config carries the research-control row (evidence: dump-config-run-$TS.yml)"

# ---------------------------------------------------------------------------
# Single-phase mode (manual use)
# ---------------------------------------------------------------------------
if [ -n "${E2E_STATE:-}" ]; then
  case "$E2E_STATE" in
    loaded) set_plugin_state enabled; SPEC=smoke.loaded.spec.ts ;;
    unloaded) set_plugin_state disabled; SPEC=smoke.unloaded.spec.ts ;;
    *) die "E2E_STATE must be loaded|unloaded" ;;
  esac
  if port_open; then log "server already up on $E2E_PORT — reusing"; else start_server "$E2E_STATE"; fi
  run_spec "$SPEC"
  if [ "${E2E_KILL_AFTER:-0}" = "1" ]; then stop_server; fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Full cycle run: baseline + N load/unload rounds, ending ENABLED.
# ---------------------------------------------------------------------------
port_open && die "port $E2E_PORT already in use — stop the other server first (3080 is the live GUI, never touched here)"

set_plugin_state enabled
start_server loaded-baseline
run_spec smoke.loaded.spec.ts
stop_server

for round in $(seq 1 "$CYCLES"); do
  log "=== load/unload round $round/$CYCLES: disable ==="
  set_plugin_state disabled
  start_server "unloaded-$round"
  run_spec smoke.unloaded.spec.ts
  stop_server

  log "=== load/unload round $round/$CYCLES: re-enable (recovery) ==="
  set_plugin_state enabled
  start_server "loaded-$round"
  run_spec smoke.loaded.spec.ts
  stop_server
done

set_plugin_state enabled
log "WP-0.6 smoke complete: N=$CYCLES cycles, final state ENABLED, run log: $RUN_LOG"
