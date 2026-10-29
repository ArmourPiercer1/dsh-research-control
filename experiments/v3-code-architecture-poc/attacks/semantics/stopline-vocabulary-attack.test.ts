/**
 * 停线充分性攻击（独立审查员）— S-6：词汇扫描是"命名门"，不是"语义门"
 *
 * 问题（任务轴 2）：门禁能否拦住"用中性词承载的领域判定"？
 * 结论（本文件实证）：**拦不住**。最危险的规避不是发明新词，而是三种已存在的形态：
 *
 *  A. 同族词汇只禁一半：RPT 判定族 {PASS, FAIL, INDETERMINATE, NOT_APPLICABLE} 只禁了
 *     NOT_APPLICABLE（+层级的 NOT_ACHIEVED）；UN 五态族 {DECLARED, UNKNOWN, NOT_APPLICABLE,
 *     UNRESOLVED, ABSENT} 只禁了 NOT_APPLICABLE。`INDETERMINATE` 作为 RPT-02 的逐项判定词
 *     **已经躺在被扫描的机制契约文件里**（contracts/index.ts CoverageReport.status），
 *     而门禁绿灯放行。`declaredGaps`（RPT-00/05 的 B 线载体）、`describedAt`（T-05 对象时间载体）
 *     同理。门禁的禁词表相对它自称看守的 PR #42 词族是**欠包含**的。
 *  B. 大小写/JSON 键名编码：扫描正则大小写敏感、按标识符词界匹配；领域语义最现实的落点是
 *     payload 的 JSON 字段名（小写/snake：withheld、fact_standing、is_current、operating_context）——
 *     全部对门禁不可见。
 *  C. 结构性编码（无名词的规则）：SP-02 的"不存在/不可见合并"= resolvePresented 的二元形状；
 *     IC-R7/C06/C09 的"候选而已"= impactCandidates 的常量 claim；T-05/IC-H6 的谓词顺序 =
 *     readAsOf 的代码顺序；C12 的截断回显 = echo 字段。这些**已经全部写进 Kernel**，
 *     且注释里逐条引着 PR #42 规则号（扫描器按设计剥离注释——注释是门禁允许的"边界说明"，
 *     恰恰也是领域映射被文档化的地方）。命名扫描对形态 C 在构造上不可见。
 *
 * 本文件断言的是**门禁现状**（复制 arch-independence.test.ts 的扫描器，不改动它）——
 * 今天通过即证明上述缺口；修复（扩展禁词表/大小写/域扫描 DML 与 SELECT 形态）后应反转。
 * 最小修复建议（只收紧）：
 *  ① FORBIDDEN 补全 RPT/UN/T 词族：INDETERMINATE、UNRESOLVED、DECLARED、UNKNOWN、ABSENT、
 *     declaredGaps、describedAt（补全后对现文件的扫描会红——这正是"边界已被命名穿越"的证据，
 *     须由作者逐条裁定改名或给出机制词汇豁免的书面理由，豁免不得默默存在）；
 *  ② 词族级条目改为大小写不敏感（复合标识符由词界保护，误报面可控）；
 *  ③ 把"结构性编码"从注释证据升级为**人工审查清单**（停线声明从"机器可验"修正为
 *     "命名机器可验 + 结构人工审查"，避免 over-claim）。
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { POC_ROOT } from '../../src/harness/paths.ts';

// ---- 原样复制 tests/arch-independence.test.ts 的扫描器（门禁现状） ----
const FORBIDDEN = [
  'Proposition', 'Association', 'Argumentation', 'Entity', 'Concept', 'AssertionID',
  'FactStanding', 'S-L1', 'S-L0', 'R-L1', 'R-L0', 'SL1', 'RL1', 'WITHHELD', 'UNVERIFIABLE',
  'NOT_ACHIEVED', 'NOT_APPLICABLE', 'AUTHORITY_UNVERIFIED', 'domain-admission',
  'test.claim', 'test.subject', 'test.relation', 'synth:',
];

const filesUnder = (rel: string): string[] => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
  return walk(join(POC_ROOT, rel)).filter((f) => f.endsWith('.ts'));
};

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const scanSemantics = (src: string, forbidden: readonly string[] = FORBIDDEN): string[] => {
  const code = stripComments(src);
  return forbidden.filter((w) => {
    const esc = w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_$.])${esc}([^A-Za-z0-9_$]|$)`).test(code);
  });
};

// ---- 扩展扫描器：补齐 RPT/UN/T 词族（展示欠包含） ----
const EXTENDED = [...FORBIDDEN, 'INDETERMINATE', 'UNRESOLVED', 'declaredGaps', 'describedAt'];

const codeOf = (rel: string): string => stripComments(readFileSync(join(POC_ROOT, rel), 'utf-8'));

describe('S-6 停线命名门 vs 中性词承载的领域判定', () => {
  test('A：机制契约文件含 RPT 判定族词 INDETERMINATE 与 declaredGaps，门禁绿灯放行', () => {
    const contracts = filesUnder('src/contracts').map((f) => readFileSync(f, 'utf-8')).join('\n');
    const contractsCode = stripComments(contracts);
    // 门禁现状：通过
    expect(scanSemantics(contracts)).toEqual([]);
    // 而代码（非注释）里确实有这两个 PR #42 语义载体：
    expect(contractsCode).toContain('INDETERMINATE');   // CoverageReport.status 的 RPT-02 判定词
    expect(contractsCode).toContain('declaredGaps');    // CheckReportRecord 的 RPT-00/05 B 线载体
    // 扩展词表则立即报警 ⇒ 门禁词表相对 PR #42 词族欠包含：
    expect(scanSemantics(contracts, EXTENDED).sort()).toEqual(['INDETERMINATE', 'declaredGaps']);
  });

  test('A′：Kernel 读路径硬编码 T-05 对象时间键名 describedAt，门禁绿灯放行', () => {
    const src = readFileSync(join(POC_ROOT, 'src/kernel/read-context.ts'), 'utf-8');
    expect(scanSemantics(src)).toEqual([]);
    expect(codeOf('src/kernel/read-context.ts')).toContain('describedAt');
    expect(scanSemantics(src, EXTENDED)).toEqual(['describedAt']);
  });

  test('B：小写/JSON 键名形态的领域语义对门禁完全不可见', () => {
    // 若领域判定以 payload JSON 字段名落进 Kernel（最现实的载体形态）：
    const jsonStyle = `const f = (p) => { p.withheld = true; p.fact_standing = 'ACCEPTED'; p.is_current = 1; p.operating_context = 'W1'; return p; };`;
    expect(scanSemantics(jsonStyle)).toEqual([]);
    expect(scanSemantics(jsonStyle, EXTENDED)).toEqual([]);
    // 对照：同一语义用门禁认识的标识符形态则会被抓（大小写敏感的另一半）：
    expect(scanSemantics(`p.WITHHELD_REFERENCE = 1;`)).toContain('WITHHELD');
  });

  test('C：中性词承载的领域判定（跨空间即不可判定 ⇒ UNRESOLVED）可整体穿过门禁', () => {
    // 一个 SP-08 形态的规则，全程只用中性标识符：
    const neutralRule = `
      function triage(targetSpace: string, callerSpace: string, exists: boolean): string {
        if (!exists) return 'NOT_FOUND';
        if (targetSpace !== callerSpace) return 'UNRESOLVED';   // UN-04/05 的五态词
        return 'OK';
      }
    `;
    expect(scanSemantics(neutralRule)).toEqual([]);
    expect(scanSemantics(neutralRule, EXTENDED)).toEqual(['UNRESOLVED']);
  });

  test('门禁自洽性锚点：复制的扫描器与门禁自身一致（变异锚点）', () => {
    expect(scanSemantics(`if (kind === 'Proposition') return 'NOT_ACHIEVED';`)).toEqual(
      expect.arrayContaining(['Proposition', 'NOT_ACHIEVED']),
    );
    expect(scanSemantics(`// 本文件不得出现 Proposition 之类的词`)).toEqual([]);
  });
});
