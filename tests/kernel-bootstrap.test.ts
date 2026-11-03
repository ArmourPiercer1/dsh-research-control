/**
 * Bootstrap Gate 的最小生产测试（`G2-DEV-PLAN` Bootstrap 节，2026-11-03）。
 *
 * 只证明**最小提交环**在真实 SQLite 上成立：
 *   开 UoW → 写一条权威台账行（真实 ledger 表）→ 提交 → 读回 → 注入失败回滚（零残留）。
 *
 * **不**断言「CommitSequence 与事件序两轴分离」——双轴完整验收归 PR-4（提交序/事件序分离）
 * 与 PR-5（提交账持久化）。Bootstrap 若先要求双轴，就是「为让前置门禁通过而提前实现后续 PR」。
 *
 * 夹具自足：`tests/helpers/kernel-harness.ts` 零 `experiments/**` 导入（下方有 import 断言）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, openBootstrapWorld, PRINCIPAL, tempDir, type BootstrapWorld } from './helpers/kernel-harness';
import { Refusal } from '../src/contracts';

const WRITER = PRINCIPAL('alice');
/**
 * 最小提交环的探针写点：**机制签发点** `declareRawIntake`。
 *
 * R-9 / EA-2.2 之后，通用 `appendLedger` 对三类事件名一律拒（domain / mechanism / unregistered），
 * 所以最小环不能再拿"随便一个未登记名"当探针——那正是 deny-by-default 要消灭的形态。
 * 这里改用机制自己唯一的记录入口：它写 records + ledger，且必须与调用方同一事务。
 */
let probe = 0;
const writeProbe = (w: BootstrapWorld, text = 'probe') =>
  w.uow(WRITER, () => {
    probe += 1;
    return w.kernel.declareRawIntake({ recordId: `RAW-BOOT-${probe}`, text, sourceRef: 'boot://probe' });
  });

describe('Bootstrap：最小 Kernel 提交环（真实 SQLite）', () => {
  let dir: string;
  let w: BootstrapWorld;
  beforeAll(() => { dir = tempDir(); w = openBootstrapWorld(dir); });
  afterAll(() => { cleanup(dir); });

  test('夹具自足：harness 与测试都不得从 experiments/** 导入', () => {
    for (const p of ['tests/helpers/kernel-harness.ts', 'tests/kernel-bootstrap.test.ts']) {
      const src = readFileSync(join(process.cwd(), p), 'utf8');
      expect(src).not.toMatch(/from\s+['"][^'"]*experiments\//);
      expect(src).not.toMatch(/require\(\s*['"][^'"]*experiments\//);
    }
  });

  test('开 UoW → 写台账行 → 提交 → 读回：seq 单调、载荷与主体如实落库', () => {
    const receipt = writeProbe(w, 'first');
    const seq = receipt.witnessSeq;
    expect(seq).toBeGreaterThan(0);

    let row: { seq: number; event_type: string; actor: string; payload_json: string } | undefined;
    w.port.read((raw) => {
      row = raw.get(`select seq, event_type, actor, payload_json from ledger where seq=?`, seq);
    });
    expect(row).toBeDefined();
    expect(row!.event_type).toBe('raw-record-declared');
    expect(row!.actor).toBe('alice');
    expect(JSON.parse(row!.payload_json)).toMatchObject({ text: 'first', sourceRef: 'boot://probe' });
  });

  test('第二次提交 seq 递增（同一空间内单调，不留空洞）', () => {
    const a = writeProbe(w).witnessSeq;
    const b = writeProbe(w).witnessSeq;
    expect(b).toBe(a + 1);
  });

  test('无写权主体：拒在写之前（NO_SPACE_WRITE），存储零残留', () => {
    const before = w.count('select count(*) c from ledger');
    expect(() => w.uow(PRINCIPAL('mallory'), () => w.kernel.declareRawIntake({ recordId: 'RAW-M', text: 'x', sourceRef: 's' })))
      .toThrowError(Refusal);
    try {
      w.uow(PRINCIPAL('mallory'), () => w.kernel.declareRawIntake({ recordId: 'RAW-M', text: 'x', sourceRef: 's' }));
    } catch (e) {
      expect((e as Refusal).code).toBe('NO_SPACE_WRITE');
    }
    expect(w.count('select count(*) c from ledger')).toBe(before);
  });

  test('事务内抛错 ⇒ 整笔回滚：已写台账行不落地（无 ghost）', () => {
    const before = w.count('select count(*) c from ledger');
    expect(() => w.uow(WRITER, () => {
      w.kernel.declareRawIntake({ recordId: 'RAW-DOOMED', text: 'x', sourceRef: 's' });
      throw new Error('注入失败：提交前抛错');
    })).toThrow(/注入失败/);
    expect(w.count('select count(*) c from ledger')).toBe(before);
  });

  test('提交阶段失败（failBeforeCommit）⇒ 同样零残留', () => {
    const before = w.count('select count(*) c from ledger');
    w.port.failBeforeCommit = new Error('注入失败：COMMIT 前');
    try {
      expect(() => writeProbe(w, 'doomed')).toThrowError();
    } finally {
      w.port.failBeforeCommit = undefined;
    }
    expect(w.count('select count(*) c from ledger')).toBe(before);
  });

  test('台账行不可改、不可删（存储层触发器在位）', () => {
    const seq = writeProbe(w, 'immutable').witnessSeq;
    expect(() => w.port.read((raw) => raw.run(`update ledger set payload_json='{}' where seq=?`, seq))).toThrowError();
    expect(() => w.port.read((raw) => raw.run(`delete from ledger where seq=?`, seq))).toThrowError();
  });
});
