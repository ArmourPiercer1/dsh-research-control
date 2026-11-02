// prex/crash-probe.mjs — 进程级中断探针（中断场景用）。
// 用法：node prex/crash-probe.mjs <ledgerDir> <specJson>
// specJson = { events: [ { typeKey, actor, payload } ] }（typeKey = PREX_EVENTS 的键名）
//
// 行为：打开台账（只读重建；无撕裂尾时零写入）→ beginTx → 走真实 staging 路径逐条备好（内存）→
//       打印 staging 证据 → **不 commit** 直接 process.exit(9)（进程级中断）。
// 建模口径（任务书）：「提交点之前崩溃 = 零落盘」。staging 全部在内存；
// 台账文件在 commit() 之前没有任何 append —— 本探针验证的就是这一形态。

import { Prex, PREX_EVENTS } from "./core.mjs";

const [, , dir, specJson] = process.argv;
if (!dir || !specJson) {
  console.error("usage: node crash-probe.mjs <ledgerDir> <specJson>");
  process.exit(2);
}
const spec = JSON.parse(specJson);
const prex = new Prex(dir);
const tx = prex.beginTx();
for (const ev of spec.events) {
  const typeKey = PREX_EVENTS[ev.typeKey] ? ev.typeKey : null;
  if (!typeKey) throw new Error(`未知事件键: ${ev.typeKey}`);
  prex._stage(tx, PREX_EVENTS[typeKey], ev.payload, ev.actor);
}
// 中断点：object-registered 已备好、check-report 未 staging 也未落盘；提交点之前进程死亡
console.log(`CRASH-PROBE staged=${tx.events.length} committed=0`);
process.exit(9);
