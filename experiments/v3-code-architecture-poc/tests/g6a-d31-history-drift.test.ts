/**
 * 移植（血统）：`attacks/review/RE-REVIEW-G6-A.md` 附录 A.2 `G6B-D31-2`（§① D-31 历史面行，
 * F-G6A-5 非本轮修法对象——漂移的检出与救济归 G1 存储条目）。第五轮裁定第 1 条转存量：
 * 用例体与断言一字未动；**唯一的非深度改动**是夹具供给方式——
 * 原用例缺省路径 `POC_DATA_DIR/g6a-p5-drift.db` 且报告注释称「随本攻击文件入库于 .poc-data/」，
 * 该句不实：`.poc-data/` 被 `.gitignore:43` 忽略，原形态在新克隆上必红。现改由**入库工件**
 * `tests/fixtures/g6a-p5-drift.db`（d578208 包 5 代码经合法通道造出，配方 RE-REVIEW-G6-A.md
 * 附录 C.1；本轮按 C.1 逐字重跑，实测 dir/route/schema_version 三要素与 C.1 记述一致）在
 * beforeAll 按原缺省文件名复制到 `POC_DATA_DIR`（SqlitePort 侧车红线 `assertInsidePocData`
 * 要求打开面必须落在 .poc-data 内），并以 sha256 钉住工件完整性。环境变量覆盖语义原样保留。
 *
 * **夹具出处（provenance，须如实读）**：`tests/fixtures/g6a-p5-drift.db` 是按 G6-A 报告
 * §C.1 配方在 `d578208` 提取树（`git archive`，未动主树 git 状态）用包 5 代码**合法通道
 * 重建**的——它**不是第六席那枚原件（原件未随仓库保存），是一份第二证据**；三要素
 * （dir 行@dom_test_om / route@dom_test_om_v2 / schema_version=6）实测与 C.1 记述逐字一致；
 * sha `6674e78e0525b58d78a41e38746571381f313c99a6ec4ebbc7840854434ed6e4`。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld } from '../src/harness/world.ts';
import { migrateLegacyRecords } from '../src/storage-sqlite/sqlite-port.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_RECORDS } from '../src/domains/test-records.ts';
import { Refusal } from '../src/contracts/index.ts';

const GRANTS = {
  g6badmin: ['space-write', 'capability-admin', 'domain-admission'],
  g6bnobody: ['space-write'],
};

// —— 夹具供给（本轮新增的脚手架，不属于移植体）——
const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'g6a-p5-drift.db');
const ARTIFACT_SHA = '6674e78e0525b58d78a41e38746571381f313c99a6ec4ebbc7840854434ed6e4';
function refusalOf(fn: () => unknown): { code: string; detail: Record<string, unknown> } {
  try { fn(); return { code: 'NO_REFUSAL', detail: {} }; }
  catch (e) {
    if (e instanceof Refusal) return { code: e.code, detail: e.detail as Record<string, unknown> };
    return { code: 'BARE_ERROR', detail: { message: String((e as Error).message).slice(0, 120) } };
  }
}
let materialized: string | undefined;
beforeAll(() => {
  if (process.env.G6A_P5_FIXTURE) return; // 覆盖语义原样：显式指定则不物化
  const sha = createHash('sha256').update(readFileSync(ARTIFACT)).digest('hex');
  expect(sha, '历史库工件被改动（重建须同步更新本 sha 并在报告登记原因）').toBe(ARTIFACT_SHA);
  materialized = join(POC_DATA_DIR, 'g6a-p5-drift.db'); // 原缺省名；每次重拷（migrate 会改写副本）
  copyFileSync(ARTIFACT, materialized);
});
afterAll(() => { if (materialized) rmSync(materialized, { force: true }); });

describe('G6B-D31 移交删参 + 历史面（「修了入口没修历史」裁定实证）', () => {
  test('G6B-D31-2 历史面（父席点名）：**包 5 合法通道造出的漂移库**在 398df30 上被 v6→v7 版本墙整体拒开；版本墙之后无任何漂移检出/救济——auditRequiredIntegrity 不看 ns，migrateLegacyRecords 不修版本不修漂移', () => {
    // p5 worktree（d578208 代码）造的真·历史库，随本攻击文件入库于 .poc-data/；
    // 环境变量可覆盖，缺省走仓内相对路径——门禁重跑不依赖会话环境。
    const fixture = process.env.G6A_P5_FIXTURE
      ?? join(POC_DATA_DIR, 'g6a-p5-drift.db'); // p5 worktree 造的真·历史库（无则失败，不自造形状冒充）
    if (fixture && existsSync(fixture)) {
      // ① 真历史库（包 5 的 transferRoute 携 ns 合法写出，schema_version=6）在 398df30 上：
      const r = refusalOf(() => openWorld({ file: fixture, space: 'SP-P5', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] }));
      expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');       // 版本墙先拦住——漂移根本没被评估
      // ② 救济面：migrateLegacyRecords 不检查版本、也不修任何东西（只回填 records）——跑完仍拒开
      migrateLegacyRecords(fixture);
      const r2 = refusalOf(() => openWorld({ file: fixture, space: 'SP-P5', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] }));
      expect(r2.code).toBe('SCHEMA_UPGRADE_REQUIRED');
      return;
    }
    // 证据库缺失 ⇒ 显式红（不得 skip 冒充通过）
    expect(existsSync(fixture), `历史库证据缺失：${fixture}（应由 d578208 worktree 的合法通道造出）`).toBe(true);
  });
});
