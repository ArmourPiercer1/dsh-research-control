// E0 宿主适配——真宿主优先：若 tests/deepseek-harness 的 0.2.0-rc.2 构建产物在位，
// E0 的「机制真源」直接用宿主 Session 对象（append/deepFreeze/seq/fork 全为宿主代码）；
// 否则退回 lib/eventlog.mjs 的模型形并如实标注。两种模式跑同一政策、同一投影、同一断言。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// @e0-reuse host tests/deepseek-harness/packages/core/session/lib/index.js — 宿主 Session 构建产物（0.2.0-rc.2 @ c1b47e41fc，AGENTS §2 测试实例）：在位则机制层为宿主直用，不是复刻
const HOST_REL = "tests/deepseek-harness";

let seqCounter = 0;
function nextId(SessionId, prefix) {
  return SessionId(`${prefix}-${process.pid}-${++seqCounter}`);
}

export async function openHost({ repoRoot }) {
  const sessionLib = join(repoRoot, HOST_REL, "packages/core/session/lib/index.js");
  if (existsSync(sessionLib)) {
    const m = await import(pathToFileURL(sessionLib).href);
    return { mode: "real-host-session", root: join(repoRoot, HOST_REL), ...m };
  }
  return { mode: "model-form" };
}

// 统一门面：宿主形与模型形暴露同一面（append/seq/snapshotEvents/fork/subscribe）
export function adaptHostLog(host, { policy, seed = null, inherited = 0 } = {}) {
  if (host.mode !== "real-host-session") return null;
  const { Session, SessionId, SessionSeq, SESSION_FORMAT_VERSION } = host;
  const id = nextId(SessionId, seed ? "e0-fork" : "e0-main");
  const inner = seed
    ? Session.create(id, seed, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: true }, inherited)
    : Session.create(id);
  const listeners = new Set();

  const wrap = (ev) => {
    const { __e0, ...data } = ev.data;
    return Object.freeze({
      seq: Number(ev.seq),
      type: ev.type,
      sourceEventSeqs: __e0?.sourceEventSeqs ?? [],
      occurredAt: __e0?.occurredAt ?? ev.time,
      recordedAt: __e0?.recordedAt ?? ev.time,
      data: Object.freeze(data),
    });
  };

  return {
    backend: "host",
    sessionId: String(id),
    get inheritedEventCount() {
      return inherited;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    append(type, data, { sourceEventSeqs = [], occurredAt = null } = {}) {
      // E0 纪律在写侧（政策不过即抛 E0_REFUSED）；通过后交给宿主——seq/私有日志/deepFreeze 全由宿主机制强制
      const now = Date.now();
      const pre = { seq: Number(inner.seq), type, sourceEventSeqs, occurredAt: occurredAt ?? now, recordedAt: now, data };
      policy(pre);
      const ev = inner.append(type, { ...structuredClone(data), __e0: { sourceEventSeqs, occurredAt: pre.occurredAt, recordedAt: pre.recordedAt } });
      const wrapped = wrap(ev);
      for (const fn of listeners) {
        try {
          fn(wrapped);
        } catch {
          /* fire-and-forget（宿主 'session/event' 同语义） */
        }
      }
      return wrapped;
    },
    get seq() {
      return Number(inner.seq);
    },
    snapshotEvents(fromSeq = 0, toSeqExclusive = Number(inner.seq)) {
      // @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:649 — 时点窗读回直接落宿主 snapshotEvents（宿主已 @deprecated 同步读，E0 用它只做形状证明，重放主路径走 jsonl）
      return Object.freeze(inner.snapshotEvents(SessionSeq(fromSeq), SessionSeq(toSeqExclusive)).map(wrap));
    },
    fork(atSeq) {
      // @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:507 — fork 前缀截点 = 宿主 Session.create(seed, header, inheritedEventCount) 原生语义，E0 不自建截点
      const forkSeed = inner.snapshotEvents(SessionSeq(0), SessionSeq(atSeq));
      return adaptHostLog(host, { policy, seed: forkSeed, inherited: forkSeed.length });
    },
  };
}
