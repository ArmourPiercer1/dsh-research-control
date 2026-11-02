// E0 sqlite 镜像——生产 history 物理形（表 + 追加不可改触发器）的最小复刻。
// 证明：生产触发器 DDL 可直接搬运；「standing 不是对象」在本 schema 上机验（无 standing 表可查）。

import { DatabaseSync } from "node:sqlite";

// @e0-reuse own src/host/persistence/store/schema.ts:99 — history_event 表形（seq/事件类型/时间/JSON 载荷）——E0 表是其最小化搬运（列取 E0 所需，非冻结面、E0 专用文件）
// @e0-reuse own src/host/persistence/store/schema.ts:131 — 「history_event_no_update/no_delete（INV-HIST-1）append-only 触发器」DDL 逐字搬运形（仅表名与消息改 E0）——这是自家重构复用里最可白捡的一格
const DDL = `
CREATE TABLE IF NOT EXISTS e0_event (
  seq INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  source_event_seqs TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  digest TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS e0_event_no_update
  BEFORE UPDATE ON e0_event
  BEGIN
    SELECT RAISE(ABORT, 'e0_event is append-only (E0-INV-1)');
  END;
CREATE TRIGGER IF NOT EXISTS e0_event_no_delete
  BEFORE DELETE ON e0_event
  BEGIN
    SELECT RAISE(ABORT, 'e0_event is append-only (E0-INV-1)');
  END;
`;

export function openLedger(path) {
  const db = new DatabaseSync(path);
  db.exec(DDL);
  return db;
}

// @e0-reuse own src/host/persistence/store/store.ts:282 — appendEventsImpl 的「校验后逐条 insert、单写者串行」形状（本片单进程，串行由调用序保证；事务 fold 不搬——E0 单表无需）
export function mirrorEvent(db, ev) {
  db.prepare(
    "INSERT INTO e0_event (seq, type, source_event_seqs, occurred_at, recorded_at, data_json, digest) VALUES (?,?,?,?,?,?,?)",
  ).run(ev.seq, ev.type, JSON.stringify(ev.sourceEventSeqs), ev.occurredAt, ev.recordedAt, JSON.stringify(ev.data), ev.digest ?? "");
}

// @e0-reuse new — 「standing 不是对象」的机验：schema 面不存在 standing 表（撤回只能表达为事件追加，不是某对象行的改写）。
// 生产无 standing 对象（standing 语义在事件词汇里）；V3 也刻意不把 FactStanding 建成 kind——此断言把该立场钉在 DDL 上。
export function assertNoStandingObject(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const bad = rows.filter((n) => /standing/i.test(n));
  if (bad.length) throw new Error(`E0_INVARIANT standing 被建成了对象表: ${bad.join(",")}`);
  return true;
}

export function tryTamper(db) {
  // 物理篡改尝试：应被触发器拒（返回拒绝理由 = 绿；改写成功 = 调用方记红）
  try {
    db.prepare("UPDATE e0_event SET data_json = '{\"tampered\":true}' WHERE seq = 0").run();
    return { blocked: false };
  } catch (err) {
    const blockedDelete = (() => {
      try {
        db.prepare("DELETE FROM e0_event WHERE seq = 0").run();
        return false;
      } catch {
        return true;
      }
    })();
    return { blocked: true, code: err.message, deleteAlsoBlocked: blockedDelete };
  }
}
