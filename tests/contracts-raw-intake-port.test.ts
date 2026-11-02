import { describe, expect, test } from 'vitest';
import type {
  CommandReceipt, DeclareRawIntakeCommand, RawIntakeCommandPort, RawIntakeTransaction,
} from '../src/contracts';
import { Refusal } from '../src/contracts';

/**
 * PR-2 / R-9 的第一片：记录域命令 Port 的**形状契约**（还没有实现与接线）。
 *
 * 这一片刻意只落类型：接口本身不可写、不可调用，因此不会形成「注册了没改道」的半扇门。
 * 实现在下一片与 `ownsEventTypes` 登记、deny-by-default 翻转**同一提交**落地。
 */
describe('PR-2 记录域命令 Port 形状（DC-PORT / R-9）', () => {
  test('命令判别式是字面量：改一个字符就不是同一条命令', () => {
    const cmd: DeclareRawIntakeCommand = {
      command: 'test.records:declareRawIntake', recordId: 'R-1', text: 'x', sourceRef: 's',
    };
    expect(cmd.command).toBe('test.records:declareRawIntake');
    // @ts-expect-error 判别式是封闭字面量集合：拼错的命令名不可构造
    const bogus: DeclareRawIntakeCommand = { command: 'test.records:declareRawIntakeTypo', recordId: 'R-1', text: 'x', sourceRef: 's' };
    expect(bogus).toBeDefined();
  });

  test('`unparseable` 是载荷字段而不是闸门（DC-11）：两种取值都可构造', () => {
    const ok: DeclareRawIntakeCommand = { command: 'test.records:declareRawIntake', recordId: 'R-1', text: 'x', sourceRef: 's' };
    const bad: DeclareRawIntakeCommand = { ...ok, unparseable: true };
    expect(ok.unparseable).toBeUndefined();
    expect(bad.unparseable).toBe(true);
  });

  test('回执只有三字段：oid / revision / witnessSeq（不返回信封对象）', () => {
    const r: CommandReceipt = { oid: 'o' as CommandReceipt['oid'], revision: 1, witnessSeq: 1 as CommandReceipt['witnessSeq'] };
    expect(Object.keys(r).sort()).toEqual(['oid', 'revision', 'witnessSeq']);
  });

  test('端口只暴露一个方法：`declare`（DC-5：禁通用 run(name, payload)）', () => {
    const fake: RawIntakeCommandPort = {
      declare: (_tx: RawIntakeTransaction, cmd) => ({
        oid: 'o' as CommandReceipt['oid'], revision: 1, witnessSeq: (cmd.recordId.length as CommandReceipt['witnessSeq']),
      }),
    };
    expect(Object.keys(fake)).toEqual(['declare']);
    expect('run' in fake).toBe(false);
  });

  test('回执不是授权证据：伪造回执不构成任何可验事实（文档性断言）', () => {
    // 这条不能"测"出实现正确，只能钉住意图：回执里没有 axis/authorized/ctxId 之类别名，
    // 将来若有人往回执里加授权字段，这条断言会红。
    const r: CommandReceipt = { oid: 'o' as CommandReceipt['oid'], revision: 1, witnessSeq: 1 as CommandReceipt['witnessSeq'] };
    const keys = Object.keys(r);
    for (const forbidden of ['axis', 'authorized', 'ctxId', 'contractVersion', 'ruleSetVersion']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(Refusal).toBeTypeOf('function');
  });
});

describe('PR-2 记录域 Port 实现（未接线：不登记、不翻面）', () => {
  test('declare 转发为 appendAuthoritativeEvent，且事件名是正式事件常量', async () => {
    const { createRawIntakeCommandPort } = await import('../src/domains/raw-intake');
    const calls: unknown[] = [];
    const tx = { appendAuthoritativeEvent: (a: unknown) => { calls.push(a); return 7 as never; } };
    const r = createRawIntakeCommandPort().declare(tx as never, {
      command: 'test.records:declareRawIntake', recordId: 'RPT-1', text: '原文', sourceRef: 'src#a',
    });
    expect(r.witnessSeq).toBe(7);
    expect(calls).toHaveLength(1);
    const a = calls[0] as { eventType: string; payload: Record<string, unknown> };
    expect(a.eventType).toBe('raw-record-declared');
    expect(a.payload).toEqual({ recordId: 'RPT-1', text: '原文', sourceRef: 'src#a' });
  });

  test('unparseable 原样进载荷，不作为拒绝理由（DC-11）', async () => {
    const { createRawIntakeCommandPort } = await import('../src/domains/raw-intake');
    const calls: unknown[] = [];
    const tx = { appendAuthoritativeEvent: (a: unknown) => { calls.push(a); return 1 as never; } };
    createRawIntakeCommandPort().declare(tx as never, {
      command: 'test.records:declareRawIntake', recordId: 'RPT-2', text: '???', sourceRef: 's', unparseable: true,
    });
    expect((calls[0] as { payload: Record<string, unknown> }).payload.unparseable).toBe(true);
  });

  test('走的是 appendAuthoritativeEvent，不是 appendLedger（唯一入口）', async () => {
    const { createRawIntakeCommandPort } = await import('../src/domains/raw-intake');
    const seen: string[] = [];
    const tx = {
      appendAuthoritativeEvent: () => { seen.push('authoritative'); return 1 as never; },
      appendLedger: () => { seen.push('ledger'); return 1 as never; },
    };
    createRawIntakeCommandPort().declare(tx as never, {
      command: 'test.records:declareRawIntake', recordId: 'RPT-3', text: 'x', sourceRef: 's',
    });
    expect(seen).toEqual(['authoritative']);
  });
});
