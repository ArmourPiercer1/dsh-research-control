#!/usr/bin/env bash
# G0 P2 (PR#2 review) — ONE normalization point for the e2e schema root.
#
# WHY: the caller-supplied DSH_RESEARCH_SCHEMA_ROOT used to flow through
# e2e-run.sh verbatim. Two consumers then interpreted a RELATIVE value
# independently (and disagreeingly): the seed factory requires an absolute
# path outright (e2e/factory/factory.ts parseArgs `abs()` throws), and the
# host-service launch resolves it against ITS cwd — so the same relative
# string could mean different roots (or fail late and confusingly).
#
# This helper resolves the value ONCE, absolutely, before ANY consumer sees
# it. Relative overrides anchor at $REPO_DIR (the checkout) — never at the
# launcher's cwd — so the meaning is stable wherever e2e-run.sh is invoked.
# A value that does not resolve to an existing directory is a loud error
# here (non-zero return), not a late factory/boot failure downstream.
#
# Usage (caller keeps its own FATAL/exit policy, e.g. e2e-run.sh exit 1):
#   . "$(dirname "$0")/resolve-e2e-schema-root.sh"
#   E2E_SCHEMA_ROOT="$(resolve_e2e_schema_root "$REPO_DIR" "${DSH_RESEARCH_SCHEMA_ROOT:-}")" || exit 1
#
# Stdout: the absolute resolved path (no trailing slash). Stderr: the failure
# detail on non-zero return. Safe under `set -Eeuo pipefail` callers.

resolve_e2e_schema_root() {
  local repo_dir="$1" override="${2:-}" input abs
  if [ -z "$override" ]; then
    # default: the COMMITTED in-package snapshot (SI-001 content-identical
    # mirror of the workspace-root canonical) — standalone checkouts included.
    abs="$(cd "$repo_dir/schema" 2>/dev/null && pwd)" || {
      printf 'resolve_e2e_schema_root: the in-package snapshot %s/schema is missing (broken checkout?)\n' "$repo_dir" >&2
      return 1
    }
    printf '%s' "$abs"
    return 0
  fi
  case "$override" in
    /*) input="$override" ;;
    *)  input="$repo_dir/$override" ;;
  esac
  abs="$(cd "$input" 2>/dev/null && pwd)" || {
    printf 'resolve_e2e_schema_root: DSH_RESEARCH_SCHEMA_ROOT=%s does not resolve to an existing directory (relative values anchor at %s)\n' "$override" "$repo_dir" >&2
    return 1
  }
  printf '%s' "$abs"
}
