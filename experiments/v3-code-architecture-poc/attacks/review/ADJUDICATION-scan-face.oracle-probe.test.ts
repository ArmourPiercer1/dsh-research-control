/**
 * 裁决探针（独立裁决用，配合 ADJUDICATION-scan-face.md）：
 * 实测 `hiddenByContractSkew` 的信息面，并检验"只回数量不回 oid"是否防得住
 * 改截点 / 启停能力两类差分探测把被隐藏对象的身份枚举出来。
 *
 * 纪律：本文件是 attacks/review/ 内新建的裁决附件，不改 src/**、tests/** 与任何既有文件；
 * 临时 DB 落 `.poc-data/**`，用完即删。断言全部针对**当前实现的实际行为**（记录事实，不主张修复）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import { asOid, Refusal, type ObjectOid, type ReadContextSpec } from '../../src/contracts/index.ts';
import { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';

const ADMIN = PRINCIPAL('skew-admin');
const GRANTS = { 'skew-admin': ['space-write', 'capability-admin'] };
const SPACE = 'SP-ADJ';
/** 同 ns、同 capability，只有契约版本不同 ⇒ 跨所有者移交后产生"行戳 v1 / 路由 v2"的混合库。 */
const SPLIT_V2 = { ...TEST_OBJECT_MODEL_SPLIT, provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }] };

const ctx = (w: World, recordedAsOf?: number): ReadContextSpec => ({
  space: w.kernel.space, principal: ADMIN, mode: 'as-recorded', consistency: 'required',
  ...(recordedAsOf !== undefined ? { recordedAsOf } : {}),
});

interface Mixed { file: string; w: World; v1: readonly { oid: string; seq: number }[]; v2Oid: string }

/** v1 世界建 3 行（记下 oid↔seq 真值）→ 移交 v2 → 重开 v2 世界 → 加 1 行 v2 新行。 */
function buildMixed(): Mixed {
  const file = join(mkdtempSync(join(POC_DATA_DIR, 'adj-skew-')), 'space.db');
  const w1 = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const v1Oids: string[] = [];
  w1.uow(ADMIN, (tx) => {
    for (let i = 0; i < 3; i += 1) v1Oids.push(tx.createObject({ kind: 'test.claim', payload: { a: i } }));
    return null;
  });
  const v1 = readAsOf(w1.kernel, ctx(w1)).rows.map((r) => ({ oid: r.oid as string, seq: r.recordedSeq }));
  w1.transferCapability(CAP_OBJECT_MODEL, SPLIT_V2, ADMIN);
  w1.close();
  const w2 = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [SPLIT_V2] });
  const v2Oid = w2.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { a: 99 } }));
  return { file, w: w2, v1, v2Oid };
}

const cleanup = (m: Mixed): void => { m.w.close(); rmSync(m.file, { force: true }); };

/** 截点走表：返回 [X, C_skew(X)] 全表与 C 的上升步位置（隐藏行的 recorded_seq）。 */
function walkCutoffs(w: World, head: number): { table: [number, number][]; steps: number[] } {
  const table: [number, number][] = [];
  const steps: number[] = [];
  let prev = 0;
  for (let x = 0; x <= head; x += 1) {
    const c = readAsOf(w.kernel, ctx(w, x)).echo.hiddenByContractSkew;
    table.push([x, c]);
    if (c > prev) steps.push(x);
    prev = c;
  }
  return { table, steps };
}

describe('hiddenByContractSkew 信息面实测（裁决附件）', () => {
  test('echo 形状：只回数量，无 oid、无版本对、无 seq（当前状态确认）', () => {
    const m = buildMixed();
    try {
      const r = readAsOf(m.w.kernel, ctx(m.w));
      expect(r.rows.map((x) => x.oid)).toEqual([m.v2Oid as ObjectOid]);
      expect(r.echo.hiddenByContractSkew).toBe(3);
      expect(r.echo.hiddenByInactiveCapability).toBe(0);
      const keys = Object.keys(r.echo).sort();
      expect(keys).toEqual([
        'hiddenByContractSkew', 'hiddenByInactiveCapability', 'mode', 'moreRows',
        'recordedAsOfWasDefaulted', 'timeFieldMissing', 'truncated', 'usedDescribedAt', 'usedRecordedAsOf',
      ]);
      console.log('[probe] echo =', JSON.stringify(r.echo));
    } finally { cleanup(m); }
  });

  test('改截点：C(X) 前缀计数差分可枚举隐藏行的**精确** recorded_seq（线性走表）', () => {
    const m = buildMixed();
    try {
      const head = m.w.ledgerHead();
      // head 本身不需要旁路：默认截点读的回显 usedRecordedAsOf 就是 head（T-05 回显纪律）
      expect(readAsOf(m.w.kernel, ctx(m.w)).echo.usedRecordedAsOf).toBe(head);
      const { table, steps } = walkCutoffs(m.w, head);
      expect(steps).toEqual(m.v1.map((g) => g.seq));
      console.log('[probe] (X, C_skew(X)) =', table.map(([x, c]) => `(${x},${c})`).join(' '), '⇒ steps =', steps.join(','));
    } finally { cleanup(m); }
  });

  test('改截点（二分版）：第 k 个隐藏行的位置 = 满足 C(X)≥k 的最小 X，O(log head) 次读', () => {
    const m = buildMixed();
    try {
      const head = m.w.ledgerHead();
      const kth = (k: number): number => {
        let lo = 0, hi = head;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (readAsOf(m.w.kernel, ctx(m.w, mid)).echo.hiddenByContractSkew >= k) hi = mid;
          else lo = mid + 1;
        }
        return lo;
      };
      expect(kth(1)).toBe(m.v1[0]!.seq);
      expect(kth(2)).toBe(m.v1[1]!.seq);
      expect(kth(3)).toBe(m.v1[2]!.seq);
      console.log('[probe] 二分定位 k=1,2,3 ⇒', kth(1), kth(2), kth(3), '（真值', m.v1.map((g) => g.seq).join(','), '）');
    } finally { cleanup(m); }
  });

  test('身份推断：oid 形如 OBJ-<space>-<n> 且 n 按创建序单调 ⇒ 隐藏创建行按"创建 seq 排序中的秩"即可命名（无 revise 场景下身份可完全枚举）', () => {
    const m = buildMixed();
    try {
      const head = m.w.ledgerHead();
      const visible = readAsOf(m.w.kernel, ctx(m.w)).rows;
      const { steps } = walkCutoffs(m.w, head);
      // 攻击者视角：可见行 (oid, revision, seq) + C 的步位置 = 全部创建 seq 的有序表
      // （可见行 revision=1 为创建行；本夹具无 revise/append，隐藏步也全是创建行）
      const createSeqs = [...steps, ...visible.map((r) => r.recordedSeq)].sort((a, b) => a - b);
      const visibleBySeq = new Map(visible.map((r) => [r.recordedSeq, r.oid as string] as const));
      const inferred = createSeqs.map((seq, j) => ({
        seq,
        oid: `OBJ-${SPACE}-${j + 1}`,
        isHidden: !visibleBySeq.has(seq),
      }));
      expect(inferred).toEqual([
        { seq: m.v1[0]!.seq, oid: m.v1[0]!.oid, isHidden: true },
        { seq: m.v1[1]!.seq, oid: m.v1[1]!.oid, isHidden: true },
        { seq: m.v1[2]!.seq, oid: m.v1[2]!.oid, isHidden: true },
        { seq: visible[0]!.recordedSeq, oid: m.v2Oid as string, isHidden: false },
      ]);
      console.log('[probe] 身份推断 =', JSON.stringify(inferred));
    } finally { cleanup(m); }
  });

  test('启停能力：只在两个计数器之间重新分桶，不提供任何行级身份', () => {
    const m = buildMixed();
    try {
      const read3 = (w: World) => {
        const r = readAsOf(w.kernel, ctx(w));
        return [r.rows.length, r.echo.hiddenByContractSkew, r.echo.hiddenByInactiveCapability] as const;
      };
      const before = read3(m.w);
      m.w.unloadCapability(CAP_OBJECT_MODEL, ADMIN);
      const off = read3(m.w);
      m.w.loadCapability(CAP_OBJECT_MODEL, ADMIN);
      const after = read3(m.w);
      expect(before).toEqual([1, 3, 0]);
      expect(off).toEqual([0, 0, 4]); // 4 行（含 v2 新行）全归 inactive 桶
      expect(after).toEqual([1, 3, 0]);
      console.log('[probe] 启停分桶 (rows, skew, inactive): before =', before, ' off =', off, ' after =', after);
    } finally { cleanup(m); }
  });

  test('旁证：单对象面本身是逐 oid 判别器（skew 行抛错且带版本对 payload；可见行照常；不存在 ⇒ undefined）', () => {
    const m = buildMixed();
    try {
      const hiddenOid = m.v1[0]!.oid;
      expect(() => m.w.readObject(hiddenOid as ObjectOid)).toThrow(Refusal);
      let code: string | undefined; let detail: Record<string, unknown> | undefined;
      try { m.w.readObject(hiddenOid as ObjectOid); }
      catch (e) { if (e instanceof Refusal) { code = e.code; detail = e.detail; } }
      expect(code).toBe('SCHEMA_INCOMPATIBLE');
      expect(detail?.recordedContractVersion).toBe('v1');
      expect(detail?.effectiveContractVersion).toBe('v2');
      console.log('[probe] 单对象面 skew 行拒绝 payload =', JSON.stringify({ code, detail }));
      expect(m.w.readObject(m.v2Oid as ObjectOid)?.revision).toBe(1);
      expect(m.w.readObject(asOid(`OBJ-${SPACE}-999`))).toBeUndefined();
    } finally { cleanup(m); }
  });
});
