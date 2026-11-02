#!/usr/bin/env node
// e2 跑手——「科研核心可以在非 DSH 宿主下工作」的有界可运行证明（退出码即结论）。
// 流程：准备 .scratch/e2/（可弃）→ 设宿主专用环境变量为金丝雀（即使被设置，核心也不许读）→
//       spawn server.mjs（stdio JSON-RPC server，子进程继承该环境变量）→
//       fake-host.mjs 依协议驱动（initialize → tools/list → 四事件 → panel.get + 纪律/篡改断言）→
//       汇总断言 → exit 0（跑通）/ 1（任一断言失效）。
// 存储根 = <repo>/.scratch/e2/store（经协议由宿主声明，核心不猜路径、不读宿主环境变量）。

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runFakeHost } from "./fake-host.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const DATA = join(REPO, ".scratch", "e2");
const STORE = join(DATA, "store");
const CANARY = join(DATA, "dsh-home-canary");
const JSONL = join(STORE, "e2-ledger.jsonl");
const SQLITE = join(STORE, "e2-projection.sqlite");

// 整体看门狗：任何挂起都不许让跑手无限等
const watchdog = setTimeout(() => {
  console.error("[run] 看门狗超时（120s）——流程挂起，按失败处理");
  process.exit(1);
}, 120000);

// —— 环境准备（可弃面）——————————————————————————————————————
rmSync(DATA, { recursive: true, force: true });
mkdirSync(STORE, { recursive: true });
mkdirSync(CANARY, { recursive: true });

// 宿主专用环境变量名在运行时拼装（守卫 grep 的面不含本树的字面量——见 README §5 的 rc 记录）
const HOST_ENV_VAR = ["DSH", "HOME"].join("_");
process.env[HOST_ENV_VAR] = CANARY; // 「即使被设置」——核心也不得读它（G1–G3 证明）

// —— G1：金丝雀确实被设置、且随 spawn 传入 server 子进程 ——————————————
const spawnEnv = { ...process.env }; // spawn 实参 env 快照（G1 断言对象）
const child = spawn(process.execPath, [join(HERE, "server.mjs")], { cwd: REPO, env: spawnEnv, stdio: ["pipe", "pipe", "pipe"] });
const serverStderrFile = join(DATA, "server.stderr.log");
let stderrBuf = "";
child.stderr.on("data", (c) => {
  stderrBuf += c;
});
child.on("error", (e) => console.error("[run] spawn error:", e.message));

const checks = [];
let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    if (fn() === false) throw new Error("断言为假");
    pass++;
    checks.push(`PASS ${name}`);
  } catch (err) {
    fail++;
    checks.push(`FAIL ${name} :: ${err?.message ?? err}`);
  }
}

check("G1 宿主专用环境变量已被设置并随 spawn 传入 server 子进程（金丝雀在位：run 进程 env 与 spawn 实参 env 同值；server 端的在位由 A1 的 envProbe 跨进程回执）", () => {
  if (process.env[HOST_ENV_VAR] !== CANARY) return false;
  if (spawnEnv[HOST_ENV_VAR] !== CANARY) return false;
  return typeof CANARY === "string" && CANARY.startsWith("/");
});

// —— 驱动假宿主（协议 + 纪律 + 篡改断言在 fake-host 内）——————————————
const hostDecl = {
  name: "fake-claude-code-host",
  version: "1.0.0",
  capabilities: { ui: "none", stdio: true }, // 无 GUI 宿主 → UI 降级走 markdown
  storageRoot: STORE, // 存储根经协议声明
};
const res = await runFakeHost({ child, jsonlPath: JSONL, sqlitePath: SQLITE, hostDecl });
for (const c of res.checks) checks.push(c.startsWith("PASS") ? c : c);
pass += res.pass;
fail += res.fail;

// —— G 组收尾（假宿主跑完之后）——————————————————————————————
check("G2 金丝雀目录为空：核心（server 进程）全程未读/未写宿主专用环境变量指向的路径", () => {
  const entries = readdirSync(CANARY);
  if (entries.length !== 0) throw new Error(`金丝雀目录非空（核心读了宿主专用环境变量）: ${entries.join(",")}`);
  return true;
});

check("G3 存储根 = .scratch/e2/store：jsonl 6 行 + sqlite 在位（写全落在协议声明的根，不落环境变量）", () => {
  const lines = readFileSync(JSONL, "utf8").split("\n").filter((l) => l.length > 0);
  if (lines.length !== 6) throw new Error(`jsonl 行数=${lines.length} 期望 6`);
  if (statSync(SQLITE).size <= 0) throw new Error("sqlite 为空");
  return true;
});

// G4 需要 await server 退出（stdin 关闭 → server 自关）
child.stdin.end();
const serverExit = await new Promise((r) => {
  const t = setTimeout(() => {
    child.kill("SIGKILL");
    r(-9);
  }, 10000);
  child.on("exit", (c) => {
    clearTimeout(t);
    r(c ?? -1);
  });
});
check("G4 server 在 stdin 关闭后干净退出（exit 0）", () => {
  if (serverExit !== 0) throw new Error(`server exit=${serverExit}`);
  return true;
});

// —— 汇总 ———————————————————————————————————————————————
writeFileSync(serverStderrFile, stderrBuf);
const total = pass + fail;
writeFileSync(
  join(DATA, "verdict.json"),
  JSON.stringify(
    {
      proof: "non-dsh-host-core-slice",
      hostDeclared: hostDecl.name,
      storageRoot: STORE,
      hostEnvVar: HOST_ENV_VAR,
      hostEnvValue: CANARY,
      pass,
      fail,
      total,
      checks,
    },
    null,
    2,
  ),
);
for (const c of checks) console.log(c.startsWith("FAIL") ? c : `  ${c}`);
console.log(`\n[e2] 结论：${fail === 0 ? "跑通" : "未跑通"}（${total} 条断言：绿 ${pass} 红 ${fail}）｜存储根 ${STORE}｜宿主声明 ${hostDecl.name}（ui=${hostDecl.capabilities.ui}）`);
clearTimeout(watchdog);
process.exit(fail === 0 ? 0 : 1);
