/**
 * 语义组合与停线攻击（独立审查员，F-10…F-14 之后的新轮次）— S-0
 *
 * 被违反的契约：
 *  - ST-5 / CONTRACTS.md §3「append 式；旧 revision 行永不覆盖 [实测]」——domain_state 无触发器，可原地改写；
 *  - RF-02 / RD-05 硬引用完整性——ref_edge.required 可被原始 DML 降权，F-12 的提交期校验形同虚设；
 *  - F-11（capability-admin 路由管控）与 F-13（records 唯一声明）——在存储层可被原始 DML 整体绕过；
 *  - F-04（登记序无空洞/无重用）——meta.ledger_seq 可被原始 DML 改写，下一次合法提交撞 PK 或留空洞；
 *  - #44 §7.1 历史/状态不可变是**存储层**属性——当前只有 ledger / check_report / object_directory 有触发器，
 *    domain_state / ref_edge / records / capability_route / meta / journal / projection_* 零触发器。
 *
 * 根因：阶段 D 第 1 轮 F-14 的守卫（`guard`，sqlite-port.ts）只拒 DDL/PRAGMA/ATTACH，
 * 而 `SqlitePort.read` 交出的守卫视图**仍带 `run`**，非 DDL 的 DML 全部放行；
 * `Kernel.port` 是公开只读字段，任何触达 kernel 的调用方（harness 的 World.raw 之外的第二条路、
 * 门禁放行前的领域代码、或未来任何绕过 F-22/23 门禁的插件代码）即可执行：
 *   kernel.port.read(raw => raw.run('update ...'))  —— 无拒绝、无 journal、无 ledger、无任何痕迹。
 * 这是机制层的「错误但静默」路径：不是"没人去删触发器时保证不可变"（F-14 的措辞），
 * 而是"没人去**改写无触发器表**时保证不可变"。
 *
 * 第 3 轮缓解（对 HEAD 3b2625f 如实记录）：F-22/23 新增门禁禁止 `src/domains/**` 出现
 * `: Kernel` / `.port` / `.raw` / `node:sqlite` / `verified: true`——**已发布领域**的触达向量
 * 被门禁封住；但机制本身未动（Kernel.port 公开、读句柄 run() 放行 DML、四张表零触发器），
 * 而门禁本身正是 F-31 审计对象（可绕的扫描器不能当唯一屏障）。本测试直接持 kernel，
 * 不落在门禁扫描面内，因此今天全绿（断言的是有缺陷的现状）；机制修复后应变红并按更强形态改写。
 *
 * 本文件断言的是**当前（有缺陷的）行为**——今天通过，修复后应变红并按更强形态改写：
 * 最小机制修复（不引入科研语义）：
 *  ① 读路径守卫视图改为**只读视图**：run() 对一切非 SELECT/WITH 语句抛 RAW_SQL_REFUSED
 *     （写路径 tx 的守卫保持现状：DDL 拒、DML 放——Kernel 自己的写仍走 tx）；
 *  ② 纵深防御：给 domain_state / ref_edge / records 补 no_update/no_delete 触发器
 *     （Kernel 自身从不做这些表的 UPDATE/DELETE，触发器不会误伤机制路径；
 *      capability_route 需要 UPDATE，不能加触发器，靠 ① + API 权威校验）；
 *  ③ `Kernel.port` 从公开面移除（private），领域经 Kernel 的具名读 API 取数
 *     （同时封住 check_report 原始读，见 checkreport-raw-read-attack.test.ts）。
 * 回归测试：本文件即攻击证据；修复后断言改为"raw.run('update …') 被 RAW_SQL_REFUSED 拒绝
 * 且触发器二次拒绝 DML"（与 attacks/host 守卫例同形态）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';

const ALICE = PRINCIPAL('alice');

function world(prefix: string) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-0', grants: { alice: ['space-write'] } });
  return { dir, w };
}

describe('S-0 守卫只拒 DDL，读句柄的 run() 可对无触发器表执行 DML', () => {
  test('ref_edge.required 可被原始 DML 降权（F-12 硬引用完整性在存储层失效）', () => {
    const { dir, w } = world('sem-dml-reledge-');
    try {
      const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const b = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      w.uow(ALICE, (tx) =>
        tx.linkRef({ from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'object-ref', oid: b }, role: 'r', required: true }),
      );
      expect(w.raw.get<{ required: number }>(`select required from ref_edge where from_oid=?`, a)?.required).toBe(1);
      const journalBefore = w.raw.get<{ c: number }>(`select count(*) as c from journal`)?.c;

      // 攻击：领域持有 kernel，经 port.read 的守卫视图执行 DML——守卫只查 DDL 词表，UPDATE 放行。
      w.kernel.port.read((raw) => raw.run('update ref_edge set required=0 where from_oid=?', a));

      expect(w.raw.get<{ required: number }>(`select required from ref_edge where from_oid=?`, a)?.required).toBe(0);
      // 且没有任何 journal/ledger 行记录这次改写：
      expect(w.raw.get<{ c: number }>(`select count(*) as c from journal`)?.c).toBe(journalBefore);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('domain_state 可被原地改写（"旧 revision 行永不覆盖 [实测]" 不成立）', () => {
    const { dir, w } = world('sem-dml-domstate-');
    try {
      const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const journalBefore = w.raw.get<{ c: number }>(`select count(*) as c from journal`)?.c;

      w.kernel.port.read((raw) =>
        raw.run('update domain_state set payload_json=? where ns=? and oid=? and revision=?',
          JSON.stringify({ v: 999 }), 'dom_test_om', a, 1),
      );

      expect(w.readObject(a)?.payload).toEqual({ v: 999 });
      // 无痕迹：journal 行数不变，ledger 里没有对应事件。
      expect(w.raw.get<{ c: number }>(`select count(*) as c from journal`)?.c).toBe(journalBefore);
      expect(w.raw.all(`select seq from ledger where event_type like '%tamper%'`)).toEqual([]);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('records 声明内容可被改写（F-13 的"首次声明唯一化"只管得住声明，管不住篡改）', () => {
    const { dir, w } = world('sem-dml-records-');
    try {
      w.uow(ALICE, (tx) => tx.declareRecord({ recordId: 'REC-S0', eventType: 'e', payload: { n: 1 } }));
      w.kernel.port.read((raw) => raw.run('update records set payload_json=? where record_id=?', JSON.stringify({ n: 2 }), 'REC-S0'));
      expect(w.readRecord('REC-S0')?.payload).toEqual({ n: 2 });
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('capability_route 可被原始 DML 劫持（F-11 的 capability-admin 在存储层可绕过）', () => {
    const { dir, w } = world('sem-dml-route-');
    try {
      expect(w.raw.get<{ plugin_id: string }>(
        `select plugin_id from capability_route where capability=?`, 'cap.test.object-model',
      )?.plugin_id).toBe('test.object-model');

      // 无任何 principal、无任何授权检查：
      w.kernel.port.read((raw) =>
        raw.run("update capability_route set plugin_id='attacker.plugin', ns='dom_attacker' where capability='cap.test.object-model'"),
      );

      expect(w.raw.get<{ plugin_id: string }>(
        `select plugin_id from capability_route where capability=?`, 'cap.test.object-model',
      )?.plugin_id).toBe('attacker.plugin');
      // 后果：下一次读写经 routeNs 时，Directory 登记的 ns(dom_test_om) 与路由声明的 ns(dom_attacker)
      // 不一致 ⇒ 合法对象在机制层"消失"（SCHEMA_INCOMPATIBLE fail-loud，但数据被破坏在先）。
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('meta.ledger_seq 可被改写 ⇒ 下一次合法提交撞 PK（F-04 的登记序不变量可拆）', () => {
    const { dir, w } = world('sem-dml-meta-');
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); // seq 1
      w.kernel.port.read((raw) => raw.run('update meta set value=0 where key=?', 'ledger_seq'));
      // 计数器归零后，下一次合法提交试图再发 seq=1 ⇒ ledger PK 冲突：
      expect(() => w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } }))).toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('反差锚点：ledger 的 UPDATE 被触发器拒绝（当前唯一受保护的表）', () => {
    const { dir, w } = world('sem-dml-ledger-anchor-');
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      expect(() => w.kernel.port.read((raw) => raw.run('update ledger set event_type=? where seq=1', 'forged')))
        .toThrow(/HISTORY_IMMUTABLE/);
      expect(w.raw.get<{ event_type: string }>(`select event_type from ledger where seq=1`)?.event_type).toBe('object-registered');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
