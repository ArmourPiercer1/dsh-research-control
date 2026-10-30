/**
 * N6/N7 修法验收锚（包 4）：FIXPROBE-1/2/3/4 **原样移植**自复审席攻击文件
 * `attacks/review/RE-REVIEW-G3-A.md` §附录 `g3a-q2-prototype.test.ts`（父席指定验收；
 * 只改了 import 深度 `../../src/…` → `../src/…`，**断言一字未动**——本组测试是复审者
 * 提的反例，作者只负责让它绿）。
 * 验收语义：修法（hasOwnProperty + 形状校验 + 字面相等，CONTRACTS.md §16.2 投影信任模型
 * 第 4 条包 4 纪律）落地前 **3 红 1 绿**（FIXPROBE-4 是对照组恒绿），落地后 **4 绿**。
 * 原文头注保留如下：
 *
 * > G3-A ② 精确通路测试（父席三问）：
 * >  插件可达面（faceFor→writerFor→appendAuthoritativeEvent，不碰 port.raw）签发
 * >  policyVersion='constructor' / '__proto__' 的正式事件 ⇒ 能不能落库？读者看到什么？
 * > 以及「修法落地前必红」探针两条（父席指定的修法：hasOwnProperty + 形状校验 + 字面相等）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import {
  CAP_RECORDS, TEST_RECORDS, FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION,
} from '../src/domains/test-records.ts';
import { asOid } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('q2adm');   // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('q2nobody'); // 只有 space-write
const GRANTS = {
  q2adm: ['space-write', 'capability-admin', 'domain-admission'],
  q2nobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g3a-q2-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-Q2', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });

const pluginIssue = (w: World, actor: typeof ADM, payload: Record<string, unknown>, oid: string): string => {
  try {
    w.uow(actor, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
      eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1, payload,
    }));
    return 'STORED';
  } catch (e) { return (e as { code?: string }).code ?? `OTHER:${String(e)}`; }
};

// ── 修法落地前必红探针（父席指定修法：hasOwnProperty + 形状校验 + policyVersion 字面相等）──
describe('FIXPROBE 修法落地前必红（落地后转绿）', () => {
  test('FIXPROBE-1（必红）"constructor" 行即便见证 true 也**不得**计入——判据表查表必须先 hasOwnProperty', () => {
    const w = open('fix-1');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'constructor' }, oid);
      // 期望的正确行为（修法落地后此行绿）：原型链键 ⇒ 不计入。
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('FIXPROBE-2（必红）"__proto__" 行不得让读者崩——未知/原型键 ⇒ fail-closed 不计入，standingAt 必须正常返回', () => {
    const w = open('fix-2');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: '__proto__' }, oid);
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED'); // 现在先 TypeError
    } finally { w.close(); }
  });

  test('FIXPROBE-3（必红）命中的规则必须过形状校验：policyVersion 字面相等 + designationSchema 匹配 + 值必须是登记过的函数——"toString" 同拦', () => {
    const w = open('fix-3');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'toString' }, oid);
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('FIXPROBE-4（对照组恒绿）正当 v3 声明在修法前后都必须 ADOPTED——修法不得伤及正例', () => {
    const w = open('fix-4');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: FACT_STANDING_POLICY_VERSION,
        designationSchema: FACT_DESIGNATION_SCHEMA }, oid);
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('ADOPTED');
    } finally { w.close(); }
  });
});
