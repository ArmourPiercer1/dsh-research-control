#!/usr/bin/env bash
# smoke-root-guard-check.sh — smoke-root 守卫的红/绿矩阵（审查意见 P0#2）。
# 每个负例都必须真实触发拒绝（exit 2），每个正例必须放行——红→绿证据即本脚本本身。
set -u
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/smoke-root-guard.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail=0
expect() { # expect <want-rc> <desc> -- cmd...
  local want="$1" desc="$2"; shift 3; shift 0
  local rc=0
  "$@" >/dev/null 2>&1 || rc=$?
  if [ "$rc" = "$want" ]; then
    printf 'ok   [%s] rc=%s\n' "$desc" "$rc"
  else
    printf 'FAIL [%s] want rc=%s got rc=%s\n' "$desc" "$want" "$rc"
    fail=1
  fi
}
# fake repo + isolation zone
mkdir -p "$T/repo/tests/dsh-homes"
# 1) 正例：隔离区内的子目录
expect 0 "inside homes" -- bash "$GUARD" root "$T/repo/tests/dsh-homes/.smoke" "$T/repo"
# 2) 负例：homes 根本身（rm -rf 会扫掉一切世界）
expect 2 "homes root itself" -- bash "$GUARD" root "$T/repo/tests/dsh-homes" "$T/repo"
# 3) 负例：仓库根 / 文件系统根 / HOME
expect 2 "repo root" -- bash "$GUARD" root "$T/repo" "$T/repo"
expect 2 "fs root" -- bash "$GUARD" root / "$T/repo"
expect 2 "HOME" -- bash "$GUARD" root "$HOME" "$T/repo"
# 4) 负例：区域外、无标记
expect 2 "outside without marker" -- bash "$GUARD" root "$T/outside" "$T/repo"
# 5) 正例：区域外但显式 opt-in 标记
mkdir -p "$T/outside-marked" && touch "$T/outside-marked/.dsh-smoke-root"
expect 0 "outside with marker" -- bash "$GUARD" root "$T/outside-marked" "$T/repo"
# 6) 负例：符号链接根（指向合规的隔离区内目录也被拒——不可核验）
ln -s "$T/repo/tests/dsh-homes/real" "$T/link-root"
expect 2 "symlinked root" -- bash "$GUARD" root "$T/link-root" "$T/repo"
# reset 模式：目标必须严格位于 root 之内且非符号链接
R="$T/repo/tests/dsh-homes/.smoke"
mkdir -p "$R/ws" "$R/dsh-home/research-control"
expect 0 "reset in-root" -- bash "$GUARD" reset "$R" "$R/ws" "$R/dsh-home/research-control"
expect 2 "reset at-root-not-inside" -- bash "$GUARD" reset "$R" "$R"
mkdir -p "$T/elsewhere/ws"
expect 2 "reset outside target" -- bash "$GUARD" reset "$R" "$T/elsewhere/ws"
ln -s "$T/elsewhere" "$R/evil-link"
expect 2 "reset symlink target" -- bash "$GUARD" reset "$R" "$R/evil-link"
# 符号链接分量：ws 是区内符号链接但指向区外 → canonical 落点出区，拒绝
expect 2 "reset symlinked component" -- bash "$GUARD" reset "$R" "$R/evil-link/ws"
echo "---"
[ "$fail" = 0 ] && echo "smoke-root-guard: ALL PASS" || { echo "smoke-root-guard: FAILURES"; exit 1; }
