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
#   DSH_HOME        NOT an override anymore (WP-0.7 / RR-003): the run ALWAYS
#                   uses $DSH_SMOKE_ROOT/dsh-home. An inherited DSH_HOME that
#                   resolves outside the smoke root (e.g. the caller's live
#                   ~/.dsh in a DSH session shell) is FATAL (exit 2) with both
#                   paths printed — loud failure, never a silent retarget.
#   E2E_PORT        web port (default 3199 — never 3080)
#   E2E_CYCLES      load/unload cycles N (default 2)
#   E2E_STATE       run ONE phase only and exit: loaded | unloaded
#                   (implies the matching plugin state; server left running
#                   unless E2E_KILL_AFTER=1)
#   E2E_KILL_AFTER  with E2E_STATE: kill the server at the end
#
# Flags:
#   --reset   WP-4.7 (G4 S3): the EXPLICIT reset step before seeding —
#             removes $E2E_REPO (the whole smoke workspace, incl. its .git
#             and the used .research/ tree) and $DSH_HOME/research-control
#             (the research DB), then re-seeds from zero. The factory's
#             once-only guard is preserved (it still refuses a second seed
#             over an existing research.sqlite without a reset); --reset is
#             what makes a re-run over a used smoke root green instead of
#             red (G4 round-1: 「对已用 root 重跑必红」 eliminated).
#
# Exclusive-workspace lock (WP-8.6 / G8 round-2 R4): EVERY instance of this
# script — full cycle or E2E_STATE single-phase — takes a NON-BLOCKING
# exclusive flock on $SMOKE_ROOT/.e2e-run.lock (fd 9) at entry and holds it
# for the process lifetime. Rationale: the smoke workspace, the research DB,
# the profile and the fixed port are shared state, and two concurrent runs
# destroy each other's evidence in ways that masquerade as product failures
# (G8 round-2 reproduced this twice: an external run's --reset wiped a live
# run's DB; a second run's SELECT materialization leaked into the first run's
# assertions). A second instance finds the lock held and exits LOUD at once
# (exit 3 — no waiting, no interference); the run log records the lock state.
# The kernel releases the lock when the process dies, so a crashed run can
# never wedge the workspace (no stale-lock cleanup step). Lock criteria:
# one lock per $SMOKE_ROOT — the default <repo>/../.smoke serializes every
# run of this workspace; a different DSH_SMOKE_ROOT is an independent
# workspace with its own lock (parallel runs are legal, concurrent runs
# over one smoke root are not).
#
# Exit codes: 0 ok · 1 run failure (die) · 2 inherited DSH_HOME outside the
#             smoke root · 3 exclusive lock already held (concurrent run).
#
# The playwright specs assume the server is already serving (they never
# start/stop it); this script owns start -> wait -> test -> kill -> verify.
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_ROOT="${DSH_SMOKE_ROOT:-$(cd "$REPO_DIR/.." && pwd)/.smoke}"
# WP-0.7 (G0 round-1 RR-003): the old `${DSH_HOME:-…}` inherited the caller's
# DSH_HOME — a DSH session shell exports DSH_HOME=~/.dsh, which silently
# retargeted the whole smoke run (storeDir write, plugin add, server home) at
# the user's LIVE home; only the file sandbox stood between that and a redline
# breach. The smoke home is now UNCONDITIONAL. An inherited DSH_HOME that
# resolves outside the smoke root is FATAL (exit 2, both paths printed) so the
# near-miss is auditable instead of silently overwritten; a value that stays
# inside the smoke root is tolerated but still normalized to the forced home.
FORCED_DSH_HOME="$SMOKE_ROOT/dsh-home"
if [ -n "${DSH_HOME:-}" ] && [ "$DSH_HOME" != "$FORCED_DSH_HOME" ]; then
  SMOKE_ROOT_ABS="$(realpath -- "$SMOKE_ROOT" 2>/dev/null || printf '%s' "$SMOKE_ROOT")"
  INHERITED_ABS="$(realpath -m -- "$DSH_HOME" 2>/dev/null || printf '%s' "$DSH_HOME")"
  case "$INHERITED_ABS" in
    "$SMOKE_ROOT_ABS" | "$SMOKE_ROOT_ABS"/*)
      # isolated value — tolerated, normalized to the forced home below
      ;;
    *)
      printf '[e2e-run] FATAL: inherited DSH_HOME=%s resolves outside the smoke root %s — refusing to run against a non-isolated home (forced smoke home: %s)\n' \
        "$DSH_HOME" "$SMOKE_ROOT_ABS" "$FORCED_DSH_HOME" >&2
      exit 2
      ;;
  esac
fi
DSH_HOME="$FORCED_DSH_HOME"
export DSH_HOME
DSH_BIN="$SMOKE_ROOT/cli/node_modules/.bin/dsh"
E2E_PORT="${E2E_PORT:-3199}"
E2E_BASE_URL="http://127.0.0.1:$E2E_PORT"
EVIDENCE_DIR="$SMOKE_ROOT/evidence"
# WP-4.6: the smoke workspace is the research repo root (the factory writes
# its `.research/` tree here) and carries the DSH sessions the GUI operates.
E2E_REPO="$SMOKE_ROOT/ws"
# SI-001: the frozen schema/ root lives at the WORKSPACE ROOT. The installed
# plugin cannot walk far enough up from the profile's node_modules to find it,
# so the host service is pointed at it explicitly via DSH_RESEARCH_SCHEMA_ROOT.
E2E_SCHEMA_ROOT="$(cd "$REPO_DIR/.." && pwd)/schema"
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

# WP-4.7 (G4 S3): the explicit reset step (--reset). Parsing happens after
# log/die exist so a bad flag is a loud FATAL in the run log.
RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset)
      RESET=1
      ;;
    *)
      die "unknown arg: $arg (usage: e2e-run.sh [--reset])"
      ;;
  esac
done
[ "$RESET" = "1" ] && log "reset requested (--reset): the smoke workspace + research DB will be wiped before seeding"

# ---------------------------------------------------------------------------
# WP-8.6 (G8 r2 R4/R1): the exclusive-workspace lock (see header).
# Acquired BEFORE any state is touched (preconditions, plugin rebuild/
# reinstall, seeding, server start): the destructive half of the run is the
# shared-profile reinstall + the shared smoke workspace, and a concurrent
# run's reinstall is exactly what killed the round-2 first attempt.
# fd 9 stays open until process exit (kernel release on crash — no stale
# lock). Contention = loud immediate exit 3 (never wait, never interfere).
# ---------------------------------------------------------------------------
LOCK_FILE="$SMOKE_ROOT/.e2e-run.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "FATAL: another e2e-run.sh instance holds the exclusive lock ($LOCK_FILE) — the smoke workspace $SMOKE_ROOT is busy; concurrent runs over one smoke root destroy each other's evidence (G8 r2). Refusing to run (exit 3): wait for the holder to finish, or point DSH_SMOKE_ROOT at an independent workspace."
  exit 3
fi
{
  echo "holder pid=$$ started=$(date '+%Y-%m-%dT%H:%M:%S%z') mode=${E2E_STATE:-full} reset=$RESET port=$E2E_PORT"
} >"$LOCK_FILE"
log "exclusive workspace lock acquired ($LOCK_FILE, fd 9 — held until process exit; a contender exits loud with code 3)"

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
      DSH_RESEARCH_SCHEMA_ROOT="$E2E_SCHEMA_ROOT" \
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

# WP-4.6: TC-E2E phase (a = pre-restart baseline assertions, b = post-restart
# persistence assertions). Empty for the plain smoke specs.
E2E_PHASE=""

run_spec() {
  local spec="$1"
  log "running e2e/$spec (E2E_PHASE=${E2E_PHASE:-<none>})"
  (
    cd "$REPO_DIR"
    E2E_BASE_URL="$E2E_BASE_URL" \
      E2E_PHASE="$E2E_PHASE" \
      E2E_REPO="$E2E_REPO" \
      pnpm exec playwright test --config e2e/playwright.config.ts "e2e/$spec" 2>&1 | tee -a "$RUN_LOG"
  )
}

# ---------------------------------------------------------------------------
# WP-4.6 — plugin (re)build + (re)install, and the TC-E2E data seed.
# ---------------------------------------------------------------------------
# The e2e suite asserts on THIS run's client bundle (the drill-down views are
# new in WP-4.6), so the profile's plugin is always rebuilt and force-relinked
# from a fresh pack — never the stale "install once" copy. `pnpm run build`
# emits lib/ (host + client) AND e2e/factory-dist/ (the seed script).
build_and_install_plugin() {
  log "building plugin (lib/ + factory-dist/) and force-reinstalling into the profile"
  ( cd "$REPO_DIR" && pnpm run build >>"$RUN_LOG" 2>&1 ) || die "pnpm run build failed"
  ( cd "$REPO_DIR" && pnpm pack >>"$RUN_LOG" 2>&1 ) || die "pnpm pack failed"
  TGZ="$(ls -1 "$REPO_DIR"/dsh-research-control-*.tgz 2>/dev/null | head -1 || true)"
  [ -n "$TGZ" ] || die "pnpm pack produced no tarball"
  # Force-relink: drop the stale row (if any) then install the fresh pack.
  if grep -q '"dsh-research-control"' "$PROFILE_DIR/package.json"; then
    log "removing stale plugin from profile"
    DSH_HOME="$DSH_HOME" "$DSH_BIN" plugin --profile web remove dsh-research-control >>"$RUN_LOG" 2>&1 || true
  fi
  log "installing fresh plugin pack: $(basename "$TGZ")"
  DSH_HOME="$DSH_HOME" "$DSH_BIN" plugin --profile web add "$TGZ" 2>&1 | tee -a "$RUN_LOG"
  grep -q '"dsh-research-control"' "$PROFILE_DIR/package.json" || die "plugin missing from profile after install"
}

# The TC-E2E data seed: run the factory (real host wiring, production mutation
# paths) against the smoke workspace + isolated home. Idempotent — the factory
# refuses to re-append over an existing research.sqlite, so seed exactly once
# per smoke home and skip on re-runs.
seed_research() {
  local data_dir="$DSH_HOME/research-control/PRJ-1"
  # WP-4.7 (G4 S3): the EXPLICIT reset step — wipe the used smoke workspace
  # (the whole $E2E_REPO: .research/ tree, the dirty git working copy, the
  # repo's .git) and the research DB, then re-seed from zero. The factory's
  # once-only guard is PRESERVED (below: an existing research.sqlite still
  # skips the factory) — --reset is the operator's declared intent to
  # reseed, and it is what makes a re-run over a used root green.
  # WP-7.4 / G7 S2: the reset ALSO wipes the plugin-ensured investigator
  # preset ($DSH_HOME/.agent-presets/research-investigator) — it is the
  # plugin's own ensure artifact in the SMOKE home (this home exists only
  # for smoke runs; never a user-authored file), so wiping it lets the next
  # launch re-ensure the CURRENT closed-set composition (the launcher never
  # overwrites an existing file by design — a stale shape would otherwise
  # survive resets and pin the machine half to an outdated preset).
  if [ "$RESET" = "1" ]; then
    log "reset: removing $E2E_REPO (smoke workspace), $DSH_HOME/research-control (research DB) and $DSH_HOME/.agent-presets/research-investigator (ensured investigator preset)"
    rm -rf "$E2E_REPO" "$DSH_HOME/research-control" "$DSH_HOME/.agent-presets/research-investigator"
    mkdir -p "$E2E_REPO"
  fi
  if [ -f "$data_dir/research.sqlite" ]; then
    log "research seed already present ($data_dir) — skipping factory (re-run)"
    return 0
  fi
  log "seeding TC-E2E research data into $E2E_REPO (factory)"
  ( cd "$REPO_DIR" && node e2e/factory-dist/factory.mjs \
      --repo "$E2E_REPO" --home "$DSH_HOME" --schema-root "$E2E_SCHEMA_ROOT" 2>&1 ) | tee -a "$RUN_LOG"
  [ -f "$data_dir/research.sqlite" ] || die "factory did not produce $data_dir/research.sqlite"
  log "research seed complete"
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

# Plugin install (WP-4.6: ALWAYS rebuild + force-relink — the suite asserts on
# this run's bundle, so a stale profile copy is never tolerated).
build_and_install_plugin

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
  seed_research
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
seed_research
start_server loaded-baseline
run_spec smoke.loaded.spec.ts
# WP-7.4 / G7 S2: TC-DSH-010 — the read-only Investigator machine half
# (GUI one-click launch → real session under the closed-set preset →
# /permission read-only settle; write-refusal evidence recorded honestly).
# Runs BEFORE tc-e2e on purpose: tc-e2e's TC-E2E-011 drives the only seeded
# intervention to CLOSED (terminal), and CLOSED rows carry no investigate
# face (§13); this spec performs ZERO research mutations, so tc-e2e's
# baseline is untouched by the investigator session it launches.
E2E_PHASE="a"
run_spec tc-dsh-010.spec.ts
# WP-4.6: TC-E2E phase a — the pre-restart baseline assertions (structure,
# zones, ordering, timeline, drill-down, PF select, intervention, flooding).
E2E_PHASE="a"
run_spec tc-e2e.spec.ts
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
  # WP-4.6: TC-E2E phase b — post-restart persistence (the seed + the
  # phase-a mutations must survive a full server restart).
  if [ "$round" = "1" ]; then
    E2E_PHASE="b"
    run_spec tc-e2e.spec.ts
  fi
  stop_server
done

set_plugin_state enabled
log "WP-0.6 smoke complete: N=$CYCLES cycles, final state ENABLED, run log: $RUN_LOG (exclusive workspace lock released on exit)"
