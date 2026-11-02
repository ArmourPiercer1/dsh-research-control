// E0 事件日志——「宿主 Session 事件面」的机制形复刻（模型形，非宿主链接）。
// 纪律来源：本文件整体 = 对宿主 Session 机制的复刻声明；逐点锚见各 E0-REUSE 标注。
// E0 专用、零生产依赖、零宿主 import。落盘见 jsonl.mjs。

// @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:447 — private log：宿主把日志字段私有化（`private log: SessionEvent[]`），外部拿不到可变异数组；本片用 WeakMap 复刻同一不可达性
const logs = new WeakMap();

// @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:744 — deepFreeze：宿主每条事件 deepFreeze + data 快照化（:739-752），读回「never the caller's still-mutable input」
function deepFreeze(v) {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

// @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:722 — append 签名：seq 由日志长度指派，调用方不可指定；返回冻结事件
// @e0-reuse own src/host/history/registry/types.ts:110 — 双时序信封：occurredAt（事件实际发生，调用方可给）+ recordedAt（记账时刻，「never caller-specified」:112）由本地时钟盖戳
export class E0EventLog {
  constructor({ onAppend } = {}) {
    logs.set(this, { entries: [], listeners: onAppend ? [onAppend] : [] });
  }

  subscribe(fn) {
    // @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:77 — 'session/event' 事件订阅形状：post-commit、fire-and-forget 的追加流
    const st = logs.get(this);
    st.listeners.push(fn);
    return () => {
      st.listeners = st.listeners.filter((f) => f !== fn);
    };
  }

  append(type, data, { sourceEventSeqs = [], occurredAt = null } = {}) {
    // @e0-reuse host tests/deepseek-harness/packages/core/session/src/types.ts:470 — 因果引用形状照宿主 SurfaceIntent 的 sourceEventSeqs（surface 事件必携；本片对四类事件一律要求显式因果数组，缺省空数组）
    const st = logs.get(this);
    const validate = appendPolicy.get(this);
    if (!validate) throw new Error("E0_LOG_UNBOUND");
    const event = deepFreeze(
      validate({
        seq: st.entries.length,
        type,
        sourceEventSeqs,
        occurredAt: occurredAt ?? Date.now(),
        recordedAt: Date.now(),
        data,
      }),
    );
    st.entries.push(event);
    // post-commit 广播（订阅者异常不回滚——照宿主 fire-and-forget 语义）
    for (const fn of st.listeners) {
      try {
        fn(event);
      } catch {
        /* fire-and-forget */
      }
    }
    return event;
  }

  get seq() {
    // @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:681 — 「always the log length」：seq 恒等于日志长度
    return logs.get(this).entries.length;
  }

  snapshotEvents(fromSeq = 0, toSeqExclusive = this.seq) {
    // @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:649 — 按时间窗读回：宿主 snapshotEvents(fromSeq, toSeqExclusive) 返回冻结数组；新读法已废弃同步读，E0 读回主路径 = 全量 replay（jsonl.mjs），此窗仅证形状
    return Object.freeze(logs.get(this).entries.slice(fromSeq, toSeqExclusive));
  }

  // 面封闭性：本类实例上不得出现任何 update/delete/truncate/pop 变异 API（宿主同判据：全文件无 .pop(/truncate）。run.mjs 对 Object.getOwnPropertyNames 逐名扫描。

  fork(atSeq) {
    // @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:663 — fork 前缀继承：inheritedEventCount/ownEvents，子日志继承前缀、只见前缀（截点语义）
    const st = logs.get(this);
    const child = new E0EventLog();
    appendPolicy.set(child, appendPolicy.get(this));
    const cst = logs.get(child);
    cst.entries = st.entries.slice(0, atSeq).slice();
    cst.inheritedEventCount = atSeq;
    return child;
  }

  get inheritedEventCount() {
    return logs.get(this).inheritedEventCount ?? 0;
  }

  // 仅 replay 路径可用：整条记录（含原 recordedAt）恢复，且必须先过 digest 链校验（jsonl.mjs）
  restoreRecord(record) {
    const st = logs.get(this);
    if (record.seq !== st.entries.length) throw new Error("E0_REFUSED REPLAY_SEQ_GAP");
    st.entries.push(deepFreeze(structuredClone(record)));
    return st.entries.at(-1);
  }
}

// 日志↔校验政策绑定：append 时强制过 validate.mjs 的政策（机制在 log，政策注入——政策缺失即拒绝写）
const appendPolicy = new WeakMap();
export function bindPolicy(log, validateFn) {
  appendPolicy.set(log, validateFn);
}
