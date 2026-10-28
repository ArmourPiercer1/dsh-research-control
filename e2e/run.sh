#!/usr/bin/env bash
# e2e V2 验收执行入口（正式化；审查意见 P0#2）。用法：
#   bash e2e/run.sh t61-settings-card.spec.ts [t63-clean-probe.spec.ts ...]
# 每个 spec：起 pin 世界服务器（token URL 上行 cookie）→ playwright 执行
# acceptance.config.ts → 关停并确认端口释放——全部发生在本脚本一次调用内
# （会话会在调用边界回收后台进程；tail 绝不继承作业 stdout）。
# 前置：bash e2e/world-bootstrap.sh（世界 tests/dsh-homes/e2e-v2）。
set -Eeuo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="${E2E_V2_WORLD:-$REPO/tests/dsh-homes/e2e-v2}"
TRAIN="${TRAIN:-$REPO/tests/deepseek-harness}"
PORT="${E2E_PORT:-3299}"
PW_BROWSERS="${E2E_V2_PW_BROWSERS:-$REPO/tests/dsh-homes/.smoke/pw-browsers}"
[ $# -ge 1 ] || { echo "usage: e2e/run.sh <spec-file>..."; exit 2; }
bash "$REPO/scripts/smoke-root-guard.sh" root "$W" "$REPO" >/dev/null
LOG_DIR="$W/logs"; mkdir -p "$LOG_DIR"
RC_ALL=0

for SPEC in "$@"; do
  # t63 走干净画像世界（.dsh-dev-clean），其余走 t61 世界（.dsh-dev）
  case "$SPEC" in
    t63*) HOMEDIR=".dsh-dev-clean"; TEE_T61=0 ;;
    *) HOMEDIR=".dsh-dev"; TEE_T61=1 ;;
  esac
  LOG="$LOG_DIR/server-$(basename "$SPEC" .spec.ts).log"
  echo "===== $SPEC (world: $HOMEDIR, port $PORT) ====="
  (
    cd "$REPO"
    env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
      HOME="$W/home" DSH_HOME="$W/$HOMEDIR" \
      nohup node "$TRAIN/apps/cli/lib/bin.js" web --port "$PORT" --no-open >"$LOG" 2>&1 &
    SPID=$!
    trap 'kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true' EXIT
    READY=0
    for _ in $(seq 1 90); do
      grep -q "dsh web: http" "$LOG" && curl -s --noproxy '*' -m 2 -o /dev/null "http://127.0.0.1:$PORT/" && { READY=1; break; }
      kill -0 $SPID 2>/dev/null || { echo "SERVER DIED EARLY:"; tail -8 "$LOG"; exit 1; }
      sleep 1
    done
    [ "$READY" = 1 ] || { echo "SERVER NOT READY"; tail -8 "$LOG"; exit 1; }
    TOKEN_URL=$(grep -o "http://127.0.0.1:$PORT/?[^ ]*" "$LOG" | tail -1)
    echo "SERVER UP pid=$SPID"
    TAILPID=""
    if [ "$TEE_T61" = 1 ]; then
      # t61 spec 从头注记里读 server.log 的 tee 位置取证（rescan 块）
      tail -f -n +1 "$LOG" > "$W/.acceptance/v2-t61/server.log" 2>/dev/null &
      TAILPID=$!
      trap 'kill $TAILPID 2>/dev/null || true; kill $SPID 2>/dev/null || true; wait 2>/dev/null || true' EXIT
    fi
    RC=0
    { ( cd "$W/clone" && exec env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
        LD_LIBRARY_PATH="$W/lib-shim" \
        PLAYWRIGHT_BROWSERS_PATH="$PW_BROWSERS" \
        E2E_BASE_URL="$TOKEN_URL" \
        "$REPO/node_modules/.bin/playwright" test --config e2e/acceptance.config.ts "e2e/$SPEC" ) 2>&1 | tee "$LOG_DIR/pw-$(basename "$SPEC" .spec.ts).log"; } || RC=$?
    [ -n "$TAILPID" ] && kill $TAILPID 2>/dev/null || true
    kill $SPID 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 $SPID 2>/dev/null || break; sleep 0.5; done
    kill -9 $SPID 2>/dev/null || true
    sleep 1
    curl -s --noproxy '*' -m 2 -o /dev/null "http://127.0.0.1:$PORT/" && echo "PORT $PORT STILL OPEN" || echo "PORT $PORT RELEASED"
    exit $RC
  ) || RC_ALL=1
done
exit $RC_ALL
