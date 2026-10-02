#!/usr/bin/env bash
# G0 P2 focused regression check for scripts/resolve-e2e-schema-root.sh.
# Path semantics ONLY — starts no server, no playwright, no smoke root, no
# stable service. Each case records the REAL exit code; any expectation
# mismatch = exit 1. Companion evidence run: see docs/G0_REPRODUCIBLE_TEST_ROOT.md.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./resolve-e2e-schema-root.sh
. "$HERE/resolve-e2e-schema-root.sh"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/g0-schema-root-check.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# fixture layout: $TMP/repo/schema (default anchor), $TMP/repo/custom/schema
# (relative-override target), $TMP/elsewhere (absolute-override target).
mkdir -p "$TMP/repo/schema/history" "$TMP/repo/custom/schema" "$TMP/elsewhere"
: > "$TMP/repo/schema/common.schema.json"

fails=0
expect_ok() { # name expected repo override
  local name="$1" want="$2" repo="$3" override="${4:-}" got rc
  got="$(resolve_e2e_schema_root "$repo" "$override" 2>"$TMP/err")"; rc=$?
  if [ "$rc" -ne 0 ] || [ "$got" != "$want" ]; then
    printf 'FAIL %s: rc=%d got=%s want=%s (stderr: %s)\n' "$name" "$rc" "$got" "$want" "$(cat "$TMP/err")"
    fails=$((fails + 1))
  else
    printf 'PASS %s -> %s\n' "$name" "$got"
  fi
}
expect_err() { # name repo override
  local name="$1" repo="$2" override="$3" got rc errtxt
  got="$(resolve_e2e_schema_root "$repo" "$override" 2>"$TMP/err")"; rc=$?
  errtxt="$(cat "$TMP/err")"
  if [ "$rc" -eq 0 ]; then
    printf 'FAIL %s: expected non-zero, got rc=0 out=%s\n' "$name" "$got"
    fails=$((fails + 1))
  elif printf '%s' "$got" | grep -q /; then
    printf 'FAIL %s: failure must not print a path (got %s)\n' "$name" "$got"
    fails=$((fails + 1))
  else
    printf 'PASS %s -> rc=%d stderr=%s\n' "$name" "$rc" "$errtxt"
  fi
}

# canonical expectations computed the same physical way (pwd) — tmpdirs may be symlinks
DEF="$(cd "$TMP/repo/schema" && pwd)"
REL="$(cd "$TMP/repo/custom/schema" && pwd)"
ABS="$(cd "$TMP/elsewhere" && pwd)"

expect_ok   "default(unset->in-repo)"        "$DEF" "$TMP/repo" ""
expect_ok   "relative(custom/schema)"        "$REL" "$TMP/repo" "custom/schema"
expect_ok   "relative(dot-segments(custom/schema/../schema))" "$REL" "$TMP/repo" "custom/schema/../schema"
expect_ok   "absolute(/-prefixed passthru)"  "$ABS" "$TMP/repo" "$ABS"
expect_ok   "absolute(dot-segments normalized)" "$ABS" "$TMP/repo" "$TMP/elsewhere/../elsewhere/."
expect_err  "invalid(relative missing)"      "$TMP/repo" "does/not/exist"
expect_err  "invalid(absolute missing)"      "$TMP/repo" "/nonexistent-g0-schema-root-$$"
expect_err  "invalid(file not dir)"          "$TMP/repo" "$TMP/repo/schema/common.schema.json"
expect_err  "invalid(default missing schema)" "$TMP/repo-empty" ""

# absolute-ness invariant: whatever comes out of a success path is /-rooted
OUT="$(resolve_e2e_schema_root "$TMP/repo" "custom/schema")" && case "$OUT" in
  /*) printf 'PASS output-is-absolute\n' ;;
  *)  printf 'FAIL output-not-absolute: %s\n' "$OUT"; fails=$((fails + 1)) ;;
esac

if [ "$fails" -gt 0 ]; then printf 'RESULT: %d FAILURE(S)\n' "$fails"; exit 1; fi
printf 'RESULT: all schema-root cases passed\n'
