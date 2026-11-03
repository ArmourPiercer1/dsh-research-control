import { afterAll, describe, expect, test } from 'vitest';
import { cleanup, openBootstrapWorld, PRINCIPAL, tempDir } from './helpers/kernel-harness';
import type { PluginManifest } from '../src/contracts';
import { Refusal } from '../src/contracts';
import { createRawIntakeCommandPort } from '../src/domains/raw-intake';
import { BOOTSTRAP_PLUGIN } from './helpers/kernel-harness';

/**
 * PR-2 / R-9 记录域原始入口 —— **真实 Kernel + SQLite** 验收（方案 2 最小形态）。
 *
 * 归属判据（EA-1.2.3 / EA-3.2 / OA-4）：`raw-record-declared` 是**机制事件**，由机制内部签发；
 * 领域插件不得认领、领域不得经 `appendAuthoritativeEvent` 签发；Application 只保留
 * `RawIntakeCommandPort.declare()` 这一个具名入口，内部转调机制签发点。
 */
const dirs: string[] = [];
const mk = () => { const d = tempDir('g2-pr2-raw-'); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) cleanup(d); });

const ALICE = PRINCIPAL('alice');
const portFor = (w: ReturnType<typeof openBootstrapWorld>) =>
  createRawIntakeCommandPort((env) => w.kernel.declareRawIntake(env));
/** 应用入口必须在事务内调用（Q40 单一提交点）：测试统一用这个包一层。 */
const intake = (w: ReturnType<typeof openBootstrapWorld>, cmd: Parameters<ReturnType<typeof portFor>['declare']>[0]) =>
  w.uow(ALICE, () => portFor(w).declare(cmd));

describe('PR-2 记录域原始入口（机制签发，真实 SQLite）', () => {
  test('未解析材料正常收存（DC-11：解析失败是数据，不是闸门）', () => {
    const w = openBootstrapWorld(mk());
    const r = intake(w, {
      command: 'test.records:declareRawIntake', recordId: 'RAW-1', text: '<<坏字节>>',
      sourceRef: 'field-note#3', unparseable: true,
    });
    expect(r.recordId).toBe('RAW-1');
    expect(w.count(`select count(*) as c from records where record_id=?`, 'RAW-1')).toBe(1);
    const row = w.count(`select count(*) as c from ledger where event_type='raw-record-declared' and record_id=? and payload_json like '%"unparseable":true%'`, 'RAW-1');
    expect(row).toBe(1);
    expect(r.witnessSeq).toBeGreaterThan(0);
  });

  test('原始记录可被引用（引用既有记录不重复声明）', () => {
    const w = openBootstrapWorld(mk());
    intake(w, { command: 'test.records:declareRawIntake', recordId: 'RAW-2', text: 'x', sourceRef: 's' });
    const seq = w.uow(ALICE, (tx) => tx.appendLedger({
      // 用**未登记**的普通事件名：本测试只验证"引用既有记录"，不触碰正式事件的授权面。
      eventType: 'note-attached', payload: { note: 'refers RAW-2' }, recordId: 'RAW-2', declaresRecord: false,
    }));
    expect(seq).toBeGreaterThan(0);
    expect(w.count(`select count(*) as c from ledger where record_id='RAW-2'`)).toBe(2);
  });

  test('机制事件唯一签发：通用台账通道与领域权威通道都写不了', () => {
    const w = openBootstrapWorld(mk());
    // 通用台账通道：拒（预留名）
    expect(() => w.uow(ALICE, (tx) => tx.appendLedger({ eventType: 'raw-record-declared', payload: {}, recordId: 'RAW-X' })))
      .toThrowError(expect.objectContaining({ code: 'EVENT_AUTHORITY_REQUIRED' }));
    // 领域权威通道：`declareRecord` 也走同一预留判据（不是"换个方法就绕过"）
    expect(() => w.uow(ALICE, (tx) => tx.declareRecord({ recordId: 'RAW-Y', eventType: 'raw-record-declared', payload: {} })))
      .toThrowError(expect.objectContaining({ code: 'EVENT_AUTHORITY_REQUIRED' }));
    expect(w.count(`select count(*) as c from ledger where event_type='raw-record-declared'`)).toBe(0);
  });

  test('重复 recordId 正确拒绝，且失败事务零残留', () => {
    const w = openBootstrapWorld(mk());
    intake(w, { command: 'test.records:declareRawIntake', recordId: 'RAW-3', text: 'x', sourceRef: 's' });
    const before = w.count(`select count(*) as c from ledger`);
    expect(() => intake(w, { command: 'test.records:declareRawIntake', recordId: 'RAW-3', text: 'y', sourceRef: 's' }))
      .toThrowError(expect.objectContaining({ code: 'RECORD_ALREADY_DECLARED' }));
    expect(w.count(`select count(*) as c from ledger`)).toBe(before);
    expect(w.count(`select count(*) as c from records where record_id='RAW-3'`)).toBe(1);
  });

  test('可加入调用方已开启的事务（Q40：记录身份与事件同一提交点）', () => {
    const w = openBootstrapWorld(mk());
    const out = w.uow(ALICE, (tx) => {
      const r = w.kernel.declareRawIntake({ recordId: 'RAW-6', text: 'x', sourceRef: 's' }, ALICE);
      // 同一事务内即可读到刚写的记录行（同一条连接 ⇒ 未提交也可见）：
      // 证明这里是**加入**调用方事务，而不是自开第二条事务（后者在 SQLite 上直接报错）。
      expect(w.count(`select count(*) as c from records where record_id='RAW-6'`)).toBe(1);
      return r;
    });
    expect(out.witnessSeq).toBeGreaterThan(0);
    expect(w.count(`select count(*) as c from ledger where event_type='raw-record-declared' and record_id='RAW-6'`)).toBe(1);
  });

  test('事务失败零残留：调用方事务回滚时，机制签发的记录与事件一并消失', () => {
    const w = openBootstrapWorld(mk());
    expect(() => w.uow(ALICE, (tx) => {
      w.kernel.declareRawIntake({ recordId: 'RAW-7', text: 'x', sourceRef: 's' }, ALICE);
      throw new Error('后续业务失败');
    })).toThrowError('后续业务失败');
    expect(w.count(`select count(*) as c from records where record_id='RAW-7'`)).toBe(0);
    expect(w.count(`select count(*) as c from ledger where record_id='RAW-7'`)).toBe(0);
  });

  test('保留前缀 id 不得预占（身份 namespace 与 appendLedger 同族）', () => {
    const w = openBootstrapWorld(mk());
    expect(() => intake(w, { command: 'test.records:declareRawIntake', recordId: 'RPT-99', text: 'x', sourceRef: 's' }))
      .toThrowError(expect.objectContaining({ code: 'RECORD_ID_RESERVED' }));
    expect(w.count(`select count(*) as c from ledger`)).toBe(0);
  });

  test('领域插件冒领机制名被拒绝（装配期 AMBIGUOUS_AUTHORITY）', () => {
    const claim: PluginManifest = {
      ...BOOTSTRAP_PLUGIN,
      pluginId: 'synth:raw-intake',
      ownsEventTypes: [{
        eventType: 'raw-record-declared',
        capability: 'raw-intake' as never,
        requiresAuthority: 'space-write',
        truthSource: 'ledger-payload',
        interpretationRuleSetVersion: 'g1/fa3b892',
        contractVersion: 'ferry/v1',
        approval: { approvedBy: 'independent-review-seat', approvedOn: '2026-11-01', anchor: 'x#y' },
      }],
    };
    expect(() => openBootstrapWorld(mk(), { plugin: claim }))
      .toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_AUTHORITY' }));
  });

  test('回执不含伪造的 ObjectID / RevisionRef（只有 recordId + witnessSeq）', () => {
    const w = openBootstrapWorld(mk());
    const r = intake(w, { command: 'test.records:declareRawIntake', recordId: 'RAW-4', text: 'x', sourceRef: 's' });
    expect(Object.keys(r).sort()).toEqual(['recordId', 'witnessSeq']);
  });

  test('调用方无空间写权 ⇒ 拒绝（入口不是绕过授权的后门）', () => {
    const w = openBootstrapWorld(mk());
    const mallory = PRINCIPAL('mallory');
    // 无写权主体连事务都开不了 ⇒ 机制签发点也在门内（入口不是绕过授权的后门）
    expect(() => w.uow(mallory, () => w.kernel.declareRawIntake({ recordId: 'RAW-5', text: 'x', sourceRef: 's' }, mallory)))
      .toThrowError(expect.objectContaining({ code: 'NO_SPACE_WRITE' }));
    // 事务外调用 ⇒ 机制拒签（必须与调用方的其他写入同一提交点）
    expect(() => w.kernel.declareRawIntake({ recordId: 'RAW-8', text: 'x', sourceRef: 's' }, ALICE))
      .toThrowError(expect.objectContaining({ code: 'AUTHORITY_REQUIRED' }));
  });

  test('Refusal 是类而非字面量对象（保持错误面可 instanceof 判定）', () => {
    expect(Refusal).toBeTypeOf('function');
  });
});
