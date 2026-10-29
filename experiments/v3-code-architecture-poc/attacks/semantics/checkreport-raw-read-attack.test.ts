/**
 * 语义组合攻击（独立审查员）— S-5：check_report 可被原始 SELECT 旁路单一呈现路径
 *
 * 被违反的契约：
 *  - RPT-09/RPT-10/XC-25：无权者视图必须把 REF_UNRESOLVED 与 WITHHELD_REFERENCE 合并为
 *    UNVERIFIABLE_REFERENCE，且"不存在/不可见"不可区分；SP-10：审计视图与呈现视图
 *    共享同一份不可改记录，**脱敏只在呈现层**——前提是呈现层是**唯一出口**；
 *  - 停线（arch-independence.test.ts「领域不绕过机制直接写核心表」）：其正则
 *    /(insert|update|delete)\s+into\s+(object_directory|domain_state|ledger|ref_edge|check_report)/i
 *    只覆盖原始**写**、且只覆盖 `… INTO <表>` 词形。
 *
 * 现状（缺陷，两处；对 HEAD 3b2625f 如实记录）：
 *  1. 机制面：`Kernel.port` 仍是公开只读字段，任何触达 kernel 的调用方经 `kernel.port.read`
 *    即可对 check_report 原始 SELECT（F-14 的守卫只拒 DDL/PRAGMA/ATTACH，SELECT 放行）。
 *    F-22/23 已把**已发布领域**改造成只接窄面 PluginFace（FactStandingService 现走
 *    `face.eventsOf` 机制原语），门禁也禁 `src/domains/**` 出现 `.port`——所以当前没有
 *    已发布领域在走这条路；但机制屏障仍为零：RPT-09 的合并（presentReport）是**约定**，
 *    拿到完整审计内容不需要任何授权——含 REF_UNRESOLVED 与 WITHHELD 的区分、含计数与 reportId，
 *    XC-25 的存在性侧信道在机制层没有任何屏障（本测试直接持 kernel，不落在门禁扫描面内）。
 *  2. 门禁面：上面那条域扫描正则连**合法 DML 词形**都抓不到——
 *     `update check_report set …` 不匹配 `update\s+into`，`delete from ledger` 不匹配 `delete\s+into`；
 *     实际只有 `insert into <核心表>` 一种词形被检测（变异锚点也是这个词形）。
 *     即：门禁对"绕过机制"的检测面比其宣称的（"写核心表"）窄，且对读完全失明。
 *
 * 本文件断言的是**当前（有缺陷的）行为**——今天通过，修复后应变红：
 * 最小修复（不引入科研语义）：
 *  ① `Kernel.port` 从公开面移除；领域经 Kernel 具名读 API 取数（readLedgerSince / readReport 等），
 *     check_report 的读必须带 principal（机制只绑定与回显，不解码 findings——脱敏仍在呈现层）；
 *  ② 停线域扫描正则改为覆盖全部 DML/SELECT 形态：
 *     /\b(insert\s+into|update|delete\s+from|select\s+.*\bfrom)\s+(object_directory|domain_state|ledger|ref_edge|check_report|records|capability_route|meta)\b/i
 *     （只收紧、不放宽；本测试文件位于 attacks/，不受该扫描约束）。
 * 回归测试：本文件即攻击证据（修复后"原始 SELECT 拿审计内容"必须被机制拒绝/改道）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import type { CheckReportRecord } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');

describe('S-5 check_report 原始读旁路 + 停线正则词形盲点', () => {
  test('领域形态的原始 SELECT 直接拿到未脱敏审计内容（无 principal、无 presentReport）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-rawread-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-5', grants: { alice: ['space-write'] } });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const report: Omit<CheckReportRecord, 'reportId' | 'recordedAt'> = {
        target: { kind: 'revision-ref', oid: oid as never, revision: 1 },
        validatorId: 'synth.claim-checker', ruleVersion: 'v1', schemaVersion: 'synth-1',
        environment: 'synth-env', executedAt: Date.now(), guaranteeScope: 'SYNTH-STRUCTURAL-ONLY',
        verdict: 'INDETERMINATE',
        // 领域自定的 findings（Kernel 不透明）——这里故意放进两个本应合并的码：
        findings: [
          { code: 'REF_UNRESOLVED', outcome: 'INDETERMINATE', severity: 'NOTE' },
          { code: 'WITHHELD_REFERENCE', outcome: 'INDETERMINATE', severity: 'NOTE' },
        ],
        declaredGaps: [],
      };
      const out = w.uow(ALICE, (tx) => tx.recordReport(report));

      // 攻击：触达 kernel 的调用方直接原始 SELECT（F-23 前 FactStandingService 曾同型，
      // 现由门禁挡住已发布领域；机制层该路仍开着，本测试即机制层证据）：
      const rows = w.kernel.port.read((raw) =>
        raw.all<{ findings_json: string; verdict: string }>(
          `select findings_json, verdict from check_report where report_id=?`, out.reportId,
        ),
      );
      const findings = JSON.parse(rows[0].findings_json) as { code: string }[];
      // 未脱敏内容完整到手：两个本应合并为 UNVERIFIABLE_REFERENCE 的码可区分：
      expect(findings.map((f) => f.code).sort()).toEqual(['REF_UNRESOLVED', 'WITHHELD_REFERENCE']);
      // 附带侧信道：reportId 与计数对原始读者透明（XC-23/XC-25 的精确计数形态）：
      const count = w.kernel.port.read((raw) =>
        raw.get<{ c: number }>(`select count(*) as c from check_report where target_oid=?`, oid),
      );
      expect(count?.c).toBe(1);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('停线域扫描正则的词形盲点（变异锚点自证：只抓 insert into）', () => {
    // 原样复制 arch-independence.test.ts 的域 rawWrite 判据：
    const rawWrite = /(insert|update|delete)\s+into\s+(object_directory|domain_state|ledger|ref_edge|check_report)/i;

    // 变异锚点（门禁自己证明有效的词形）：
    expect(rawWrite.test('insert into ledger values(1)')).toBe(true);

    // 合法 DML 词形全部漏网：
    expect(rawWrite.test("update check_report set verdict='x' where 1")).toBe(false); // UPDATE 真实形态
    expect(rawWrite.test('delete from ledger where seq=1')).toBe(false);             // DELETE 真实形态
    // 读完全失明：
    expect(rawWrite.test('select findings_json from check_report where 1')).toBe(false);
  });
});
