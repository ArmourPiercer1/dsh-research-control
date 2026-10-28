#!/usr/bin/env bash
# smoke-root-guard.sh — 测试世界机械验证守卫（审查意见 P0#2，2026-10-27）。
#
# 为什么存在：`--reset` 对 $SMOKE_ROOT 下的工作区与研究库执行 rm -rf，而
# DSH_SMOKE_ROOT 是可覆盖项。文字纪律（AGENTS §3）不足以阻止错误配置下的
# 破坏性删除——这里把纪律变成机验：
#   root  模式：根（规范化后）必须位于工作区隔离区 <repo>/tests/dsh-homes/
#               之下；区域外的根必须显式放一个 .dsh-smoke-root 标记文件
#               （opt-in 的机械证明）。拒绝：符号链接根、以及等于 /、仓库根、
#               $HOME、homes 根本身的根。通过时打印 CANON=<规范化路径>。
#   reset 模式：破坏性目标必须严格位于 root 规范化路径之内且不是符号链接——
#               rm -rf 之前的最后一道二次校验。
# 退出码：0 通过 · 2 拒绝（与 e2e-run.sh 的隔离违规语义一致）。
set -u

canon() { realpath -m -- "$1" 2>/dev/null || printf '%s' "$1"; }

mode="${1:-}"; shift || true
case "$mode" in
  root)
    root="${1:?usage: smoke-root-guard.sh root <SMOKE_ROOT> <REPO_DIR>}"
    repo="${2:?usage: smoke-root-guard.sh root <SMOKE_ROOT> <REPO_DIR>}"
    c="$(canon "$root")"
    if [ -L "$root" ]; then
      printf 'FATAL: smoke root 本身是符号链接（%s -> 外部目标不可核验）\n' "$root" >&2
      exit 2
    fi
    case "$c" in
      /|"$repo"|"$HOME"|"$repo/tests/dsh-homes")
        printf 'FATAL: smoke root 等于要害目录（%s），rm -rf 面不可接受\n' "$c" >&2
        exit 2 ;;
    esac
    homes="$(canon "$repo/tests/dsh-homes")"
    case "$c" in
      "$homes"/*) : ;;
      *)
        if [ ! -f "$c/.dsh-smoke-root" ]; then
          printf 'FATAL: smoke root %s 不在工作区隔离区（%s/）之下，也未放置显式 opt-in 标记 .dsh-smoke-root——--reset 的 rm -rf 不得指向未经核验的位置（审查意见 P0#2）。并行世界请放标记文件或将根设入隔离区。\n' "$c" "$homes" >&2
          exit 2
        fi ;;
    esac
    printf 'CANON=%s\n' "$c"
    ;;
  reset)
    c="${1:?usage: smoke-root-guard.sh reset <SMOKE_ROOT_CANON> <target>...}"; c="${c%/}"; shift
    for t in "$@"; do
      if [ -L "$t" ]; then
        printf 'FATAL: reset 目标本身是符号链接（%s），拒绝跟随删除\n' "$t" >&2
        exit 2
      fi
      tc="$(canon "$t")"
      case "$tc" in
        "$c"/*) : ;;
        *)
          printf 'FATAL: reset 目标 %s 不严格位于 smoke root %s 之内\n' "$tc" "$c" >&2
          exit 2 ;;
      esac
    done
    ;;
  *)
    printf 'usage: smoke-root-guard.sh root <SMOKE_ROOT> <REPO_DIR> | reset <SMOKE_ROOT_CANON> <target>...\n' >&2
    exit 2 ;;
esac
