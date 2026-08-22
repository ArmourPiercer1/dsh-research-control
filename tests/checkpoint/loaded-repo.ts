/**
 * WP-1.5 测试基建 — 预置**完整合法** `.research/` 树的临时 Git repo 工厂.
 *
 * 复用 WP-1.2 的 `makeTempRepo` (TEST_MATRIX §5.1 临时 repo 工厂) 与
 * WP-1.1 的 `baseTreeFiles()` (附录 A 逐字示例 + 全 11 类声明式文件 +
 * contract, 经真实冻结 schema 零错误加载, 见 tests/loader/real-schema.test.ts)。
 *
 * 为什么需要: `restoreResearchFile` 恢复后经真实 loader + 真实冻结 schema
 * (WR/schema/declarative) 校验 (§6「恢复后触发该文件的 schema 校验」) —
 * 校验面必须是**可零错误加载**的完整树, 才能把「恢复导致的新错误」与
 * 「预置树本来就有错误」区分开。
 *
 * 夹具边界 (同 temp-repo.ts): 测试基建刻意执行插件在用户仓库上被禁止的
 * 任意 add/commit (装配初始提交); 纯 argv 数组, 无 shell。
 */
import { makeTempRepo, type TempRepo } from '../git/temp-repo.js'
import { baseTreeFiles } from '../loader/fixtures.js'

export type { TempRepo } from '../git/temp-repo.js'

/** `.research/merges/TE-2/contract.md` (baseTreeFiles 的 merge contract). */
export const CONTRACT_PATH = '.research/merges/TE-2/contract.md'
/** `.research/topics/TPC-1/workstreams/WS-1/plan.yaml`. */
export const PLAN_PATH = '.research/topics/TPC-1/workstreams/WS-1/plan.yaml'
/** 树中尚不存在的 gate 文件 (用于新增/删除/不在历史等场景). */
export const GATE3_PATH = '.research/topics/TPC-1/workstreams/WS-1/items/gates/G-3.yaml'
export const GATE3_V1 = [
  'id: G-3',
  'workstream_id: WS-1',
  'title: 独立评审门',
  'criteria: 三方案对比数据经独立复核',
  'created_by: { kind: USER, label: researcher }',
  'created_at: 2026-08-21T09:41:00Z',
  '',
].join('\n')
/** 非法 plan 内容 (恢复后 loader 校验必报错: YAML 解析失败 → PARSE). */
export const PLAN_GARBAGE = 'workstream: WS-1\nordered_items: [ : {{{\n'

/**
 * 种子 = 完整合法树 + 一次初始提交 ('fixture: loaded tree v0');
 * 可再附加一个**无关的** tracked 文件提交 (README.md), 用于验证
 * diff 范围限定 `.research/**` 与无关 staged 保护。
 */
export async function makeLoadedRepo(withForeignCommit = false): Promise<TempRepo> {
  const repo = await makeTempRepo({ seedResearch: false })
  const files = baseTreeFiles()
  for (const [rel, content] of Object.entries(files)) {
    await repo.write(`.research/${rel}`, content)
  }
  if (withForeignCommit) {
    await repo.write('README.md', 'fixture repo — unrelated tracked file\n')
  }
  await repo.git(['add', '--', '.research', ...(withForeignCommit ? ['README.md'] : [])])
  await repo.git(['commit', '-m', 'fixture: loaded tree v0'])
  return repo
}
