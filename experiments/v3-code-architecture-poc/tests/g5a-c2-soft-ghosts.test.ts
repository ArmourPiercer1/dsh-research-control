/**
 * C2 巡检盲区（包 6，席位 G5-A 反审，P2）：`auditRequiredIntegrity` 覆盖 `required:false`
 * 的目标存在性，产 `softGhosts` 计数——**只报不阻塞**。
 *
 * 席位事实（附录 A C2 移植）：巡检只巡 `required=1` ⇒ 幽灵软边（目标身份不存在）在位时
 * 它照样打印「0 违规」（`ref_edge` 无触发器、软边不校验）——**清白回执本身是误导**。
 *
 * 修法（CONTRACTS.md §16.3）：`required:false` 的边逐条查**目标存在性**（object-ref 查目录、
 * record-ref 查 records；不做 revision 级判定——`required:false` 语义内含允许悬空修订，
 * 计入幽灵的只有身份级悬空）。计数只进回执：不改 `violations`、不阻塞任何提交。
 * 「0 违规」与「无幽灵」从此脱钩。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { asOid, type ObjectOid } from '../src/contracts/index.ts';

const ADMIN = PRINCIPAL('c2admin');
const NOBODY = PRINCIPAL('c2nobody'); // 只有 space-write 的无关主体
const GRANTS = { c2admin: ['space-write', 'capability-admin', 'domain-admission'], c2nobody: ['space-write'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-c2-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-C2', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });

describe('G5A-C2（移植）：幽灵软边可见化——violations 与 softGhosts 脱钩，只报不阻', () => {
  test('C2-A 幽灵软边在位：violations=0 但 softGhosts>0（修前两者都是 0——清白回执误导）；无关主体照常提交', () => {
    const w = open('c2-a');
    try {
      const a = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      // 幽灵软边：object-ref 指向不存在的 oid（身份级悬空；软边不校验，提交照常）
      w.uow(ADMIN, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'object-ref', oid: asOid('OBJ-SP-C2-9999') },
        role: 'g5a-soft-ghost', required: false,
      }));
      // 幽灵 record-ref：指向从未声明的记录
      w.uow(ADMIN, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'record-ref', recordId: 'REC-g5a-never-declared' },
        role: 'g5a-soft-record-ghost', required: false,
      }));
      // 健康软边：目标存在，不得计入幽灵
      const b = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } })) as ObjectOid;
      w.uow(ADMIN, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'object-ref', oid: b }, role: 'g5a-soft-live', required: false,
      }));
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.checked, '无 required=1 边').toBe(0);
      expect(audit.violations, '修前修后都必须是 0——softGhosts 不改硬判据').toEqual([]);
      expect(audit.softChecked).toBe(3);
      expect(audit.softGhosts, '两条身份级悬空可见化').toBe(2);
      // **只报不阻塞**：幽灵在位，无关主体（只有 space-write）照常提交
      expect(() => w.uow(NOBODY, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 3 } }))).not.toThrow();
      expect(w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: 'REC-c2-live', eventType: 'ext.c2', payload: {} })))
        .toBeGreaterThan(0);
    } finally { w.close(); }
  });

  test('C2-B 悬空修订不算幽灵：required:false 的 revision-ref 指向存在 oid 的缺失修订 ⇒ softGhosts=0（语义边界钉）', () => {
    const w = open('c2-b');
    try {
      const a = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      const b = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } })) as ObjectOid;
      w.uow(ADMIN, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'revision-ref', oid: b, revision: 42 },
        role: 'g5a-dangling-rev-soft', required: false,
      }));
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.softChecked).toBe(1);
      expect(audit.softGhosts, '软边的修订级悬空是 required:false 的合法语义，不计幽灵').toBe(0);
      // 同形状的**硬**边是另一码事：提交期硬判据当场拒（两码事互不掺混——软巡检放行 ≠ 硬边放行）
      let hard = 'NO_REFUSAL';
      try {
        w.uow(ADMIN, (tx) => tx.linkRef({
          from: { kind: 'revision-ref', oid: b, revision: 1 }, to: { kind: 'revision-ref', oid: a, revision: 42 },
          role: 'g5a-dangling-rev-hard', required: true,
        }));
      } catch (e) { hard = (e as { code?: string }).code ?? 'OTHER'; }
      expect(hard, '修订级悬空走既有硬判据（level=revision 的 REQUIRED_REF_MISSING）').toBe('REQUIRED_REF_MISSING');
      // 存量损坏（裸面植入的硬边）巡检仍照常列 violations——soft 巡检查不改硬判据的形状
      w.raw.run(
        `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, role, required) values(?,?,?,?,?,1)`,
        b, 1, a, 42, 'g5a-legacy-hard',
      );
      const audit2 = w.kernel.auditRequiredIntegrity();
      expect(audit2.checked).toBe(1);
      expect(audit2.violations).toHaveLength(1);
      expect(audit2.softGhosts).toBe(0);
    } finally { w.close(); }
  });

  test('C2-C 干净库正例锚：无软边时 softChecked=0、softGhosts=0（巡检不是恒红噪音）', () => {
    const w = open('c2-c');
    try {
      w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit).toEqual({ checked: 0, violations: [], softChecked: 0, softGhosts: 0 });
    } finally { w.close(); }
  });
});
