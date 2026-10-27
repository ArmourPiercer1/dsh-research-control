#!/usr/bin/env bash
# e2e V2 验收世界 bootstrap（正式入口之一；审查意见 P0#2，2026-10-27）。
#
# 世界 = tests/dsh-homes/e2e-v2（AGENTS §3 隔离区；E2E_V2_WORLD 可指向带
# .dsh-smoke-root 标记的并行根——经 scripts/smoke-root-guard.sh 机验）。
# 阶段：prep（骨架 + lib-shim + 插件塔包 + fixture 种子）→ profiles（web profile
# 装插件 ×t61 世界与 t63 干净世界）→ seed（t63 非空会话，train 生产后端）→
# clone（spec 根 + 新鲜 e2e/ 拷贝）。跑完用 `bash e2e/run.sh <spec>` 起服执行。
# 世界整体可弃（AGENTS §3）：重置 = 删目录重跑本脚本。
set -Eeuo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="${E2E_V2_WORLD:-$REPO/tests/dsh-homes/e2e-v2}"
TRAIN="${TRAIN:-$REPO/tests/deepseek-harness}"
CLI="$TRAIN/apps/cli/lib/bin.js"
STAGE="${1:-all}"

# P0#2 机械守卫：世界根（rm -rf/播种的落点）必须经守卫核验（隔离区内，或带
# 显式 opt-in 标记）。
SMOKE_ROOT_CANON="$(bash "$REPO/scripts/smoke-root-guard.sh" root "$W" "$REPO" | sed -n 's/^CANON=//p')"
export HOME="$W/home"
export DSH_HOME=""

stage() { printf '\n===== [%s] %s =====\n' "$(date +%H:%M:%S)" "$*"; }
[ -f "$CLI" ] || { echo "FATAL: train CLI missing ($CLI)——先按 AGENTS §2 构建测试实例"; exit 1; }

# ---------------------------------------------------------------- prep
if [ "$STAGE" = all ] || [ "$STAGE" = prep ]; then
  stage "prep: world skeleton + fake HOME + lib-shim + dirs"
  mkdir -p "$W/home" "$W/pnpm-store" "$W/logs" "$W/pw-out" "$W/lib-shim" \
    "$W/.acceptance/v2-t61/screenshots" "$W/.acceptance/v2-t63"
  printf 'confirm-modules-purge=true\n' > "$W/home/.npmrc"
  # lib-shim：playwright chromium 的系统库（沙箱内无 apt）——从 gnome snap 运行时
  # 借五个 .so（docs/testing.md「0.2 世界无头浏览器注记」）。找不到就 FATAL，
  # 不假装能跑。
  if [ ! -e "$W/lib-shim/libnss3.so" ]; then
    GLIB=""
    for cand in /snap/gnome-*/current/usr/lib/x86_64-linux-gnu /snap/gnome-*/current/lib/x86_64-linux-gnu /usr/lib/x86_64-linux-gnu; do
      [ -e "$cand/libnss3.so" ] && { GLIB="$cand"; break; }
    done
    [ -n "$GLIB" ] || { echo "FATAL: 找不到含 libnss3 的 gnome snap 运行时（chromium 依赖库无来源）——见 docs/testing.md"; exit 1; }
    for so in libnspr4.so libnss3.so libnssutil3.so libplc4.so libplds4.so libasound.so.2; do
      cp -n "$GLIB/$so" "$W/lib-shim/" 2>/dev/null || cp "$GLIB/$so" "$W/lib-shim/"
    done
  fi
  stage "prep: pnpm pack (plugin tarball)"
  ( cd "$REPO" && pnpm pack --pack-destination "$W" >"$W/logs/pack.log" 2>&1 )
  TGZ="$W/dsh-research-control-0.1.0.tgz"
  [ -f "$TGZ" ] || { echo "FATAL: no tarball at $TGZ"; tail -5 "$W/logs/pack.log"; exit 1; }
  echo "tarball: $TGZ ($(stat -c %s "$TGZ") bytes)"
  stage "prep: fixture seeding (t61 + t63 workspaces + workspace.json)"
  ( cd "$REPO" && E2E_V2_WORLD="$W" pnpm exec tsx e2e/seed-fixtures.mts )
fi

# ---------------------------------------------------------------- profiles
for WORLDHOME in .dsh-dev .dsh-dev-clean; do
  if [ "$STAGE" = all ] || [ "$STAGE" = profiles ]; then
    stage "profiles: $WORLDHOME"
    H="$W/$WORLDHOME"
    mkdir -p "$H/storages" "$H/sessions"
    TGZ="$W/dsh-research-control-0.1.0.tgz"
    # profile 冷启动（首次 plugin list 建 profiles/web）；行已在而 node_modules
    # 被清时 list 会崩——非致命，真正的门是下面的 add + 行检查。
    DSH_HOME="$H" node "$CLI" plugin --profile web list >"$W/logs/profile-boot-$WORLDHOME.log" 2>&1 || true
    cat > "$H/profiles/web/pnpm-workspace.yaml" <<EOF
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

storeDir: $W/pnpm-store
EOF
    DSH_HOME="$H" node "$CLI" plugin --profile web add "$TGZ" >"$W/logs/plugin-add-$WORLDHOME.log" 2>&1 \
      || { echo "FATAL: plugin add failed"; tail -20 "$W/logs/plugin-add-$WORLDHOME.log"; exit 1; }
    grep -q '"dsh-research-control"' "$H/profiles/web/package.json" || { echo "FATAL: row missing after add"; exit 1; }
    [ -d "$H/profiles/web/node_modules/dsh-research-control" ] || { echo "FATAL: node_modules row missing after add"; exit 1; }
    echo "$WORLDHOME: plugin row installed"
  fi
done

# ---------------------------------------------------------------- t63 session seed
if [ "$STAGE" = all ] || [ "$STAGE" = seed ]; then
  stage "seed: t63 non-blank hub session via train production backend"
  ( cd "$REPO" && node e2e/seed-session.mjs \
      --train "$TRAIN" \
      --home "$W/.dsh-dev-clean" \
      --cwd "$W/t63-ws/hub-ws" \
      --id "session-$(cat /proc/sys/kernel/random/uuid)" \
      --title "t63 clean profile probe" \
      --workspace-json "$W/.dsh-dev-clean/storages/workspace.json" \
      --workspace-title hub-ws )
fi

# ---------------------------------------------------------------- clone
if [ "$STAGE" = all ] || [ "$STAGE" = clone ]; then
  stage "clone: spec root (../.. = world root) + fresh e2e/ copy"
  mkdir -p "$W/clone"
  ln -sfn "$REPO/node_modules" "$W/clone/node_modules"
  cp "$REPO/package.json" "$W/clone/package.json"
  rm -rf "$W/clone/e2e"
  cp -r "$REPO/e2e" "$W/clone/e2e"
fi

echo "WORLD READY: $W (canonical: $SMOKE_ROOT_CANON)"
