/**
 * D-26（包 4）：注册期校验授权轴的**值**，不只校验"有没有"（CONTRACTS.md §16.2，包 4 轴值判据段）。
 *
 * 修前形状（席位 G3-A A1-1/A1-3 实测绿）：`requiresAuthority` 只验 `typeof==='string' && !==''`
 * ⇒ 恶意清单声明 `requiresAuthority:'space-write'`，只有写权、无任何业务轴的主体经正当通道即得
 * `{axis:'space-write',authorized:true}` 见证——「授权结论由机制证据支撑」坍缩为「写权即授权」。
 * 修后：机制资源轴（`space-write`/`capability-admin`）在**装配期**即 `ACTIVATION_IMPOSSIBLE`，
 * 零签发面。判据是「机制资源联合的排除谓词」，Kernel 零业务知识（CONTRACTS 已写明不构成回流）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { CAP_RECORDS, TEST_RECORDS, FACT_DESIGNATION_EVENT } from '../src/domains/test-records.ts';
import type { PluginManifest } from '../src/contracts/index.ts';
import { asOid } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('d26adm');       // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('d26nobody'); // 只有 space-write——「写权即授权」正是它要走的路
const GRANTS = {
  d26adm: ['space-write', 'capability-admin', 'domain-admission'],
  d26nobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'd26-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string, plugins?: readonly PluginManifest[]): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-D26', grants: GRANTS,
    plugins: plugins ?? [TEST_OBJECT_MODEL, TEST_RECORDS] });

const code = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) { return (e as { code?: string }).code ?? `OTHER:${String(e)}`; }
};

/** 恶意但形状合法的清单：把授权轴声明成一根机制轴（席位 A1-1 的 evilManifest 同型）。 */
const evilManifest = (axis: string, suffix: string): PluginManifest => ({
  pluginId: `d26.evil.${suffix}`, codeVersion: '0', provides: [{ capability: `cap.d26.evil.${suffix}`, contractVersion: 'v1' }],
  requires: [], storageNamespace: `dom_d26_evil_${suffix}`, eventAuthority: 'none',
  ownsEventTypes: [{ eventType: `d26:evil-${suffix}`, capability: `cap.d26.evil.${suffix}`, requiresAuthority: axis }],
});

describe('D-26 授权轴值的注册期判据', () => {
  test('D26-1 恶意清单声明 requiresAuthority:"space-write" ⇒ 装配期 ACTIVATION_IMPOSSIBLE（修前：装配合题 + 写权主体平凡拿到 authorized:true）', () => {
    expect(code(() => open('d26-1', [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest('space-write', 'w')]))).toBe('ACTIVATION_IMPOSSIBLE');
  });

  test('D26-2 capability-admin 同样被排除（席位 A1-3 的轴）：机制自身权限轴一律不得当业务授权轴登记', () => {
    expect(code(() => open('d26-2', [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest('capability-admin', 'a')]))).toBe('ACTIVATION_IMPOSSIBLE');
  });

  test('D26-3 正当清单（机制联合之外的业务轴）照常装配；同一"只有写权"的主体取证恒 authorized:false——A1-1 攻击链两头都断', () => {
    const w = open('d26-3');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(code(() => w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1,
        payload: { designationSchema: 'synth:fact-designation/2', stance: 'ACCEPTED', issuer: 'd26nobody', authorization: 'AUTHORIZED', policyVersion: 'fact-standing/v3' },
      })))).toBe('NO_REFUSAL');
      const row = w.raw.get<{ auth: number; axis: string }>(
        `select json_extract(authority_basis,'$.authorized') auth, json_extract(authority_basis,'$.axis') axis
           from ledger where event_type=?`, FACT_DESIGNATION_EVENT)!;
      expect([row.auth, row.axis]).toEqual([0, 'domain-admission']); // 见证 false，且轴不是人人持有的写权
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('D26-4 判据停在 fail-closed 一侧：机制联合之外的"怪轴"仍可登记但取证恒 false（Kernel 无从判定其业务语义；业务无知的负空间由 arch 词汇硬门守，非本测）', () => {
    // 排除判据只用 MECHANISM_RESOURCES（机制自我陈述）；业务轴叫什么都不影响判据形态——
    // 空白轴 ' ' 仍能过登记（Kernel 无从判定机制联合之外字符串的业务语义），但取证据恒 false，
    // fail-closed 方向可接受（席位 A1-2 的边界，CONTRACTS 包 4 段如实登记）。
    const blank = open('d26-4', [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest(' ', 'b')]);
    try {
      const oid = blank.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(code(() => blank.uow(NOBODY, (tx) => blank.kernel.faceFor('cap.d26.evil.b' as never).writerFor(tx).appendAuthoritativeEvent({
        eventType: 'd26:evil-b', objectId: asOid(oid), revision: 1, payload: {},
      })))).toBe('NO_REFUSAL');
      const row = blank.raw.get<{ auth: number }>(
        `select json_extract(authority_basis,'$.authorized') auth from ledger where event_type=?`, 'd26:evil-b')!;
      expect(row.auth).toBe(0); // 轴再怪，没人持有它就永远 false —— 判据停在 fail-closed 一侧
    } finally { blank.close(); }
  });
});
