/**
 * TC-GIT-013 (TEST_MATRIX §3.3): 手工编辑 `.research/`.
 * 断言要点 (矩阵原文): 非法 YAML/schema 违规 → 拒载该文件、精确定位、其余
 * 文件正常.
 *
 * git 层边界 (ARCHITECTURE §2.2 无领域逻辑): 「拒载 + 精确定位 (文件+字段)」
 * 是 schema 加载层 (后续 WP) 的职责, 本层不实现 schema 校验。本用例固化
 * 矩阵场景的 **git 半边** (§9 对应行: 「.research/ 手工编辑致文件非法 |
 * schema 校验失败 | 拒载该文件并精确定位; 其余文件正常」的前置事实 +
 * 「.research/ 有未提交变更时执行读操作 → 不阻塞; 读 working copy」):
 *  - 手工编辑 (内容为非法 YAML) 后, 全部 git 读操作正常不阻塞;
 *  - working copy 逐字节可读 (canonical current state 就是 working copy);
 *  - 历史版本 (HEAD) 完好, 其余文件正常;
 *  - checkpoint 不做内容校验 (git 层无 schema 职责), 非法内容可被提交 —
 *    加载时拒载/定位由 schema 层兜底 (见报告「未决问题」)。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V1, type TempRepo } from './temp-repo.js'

const INVALID_YAML = 'ordered_items: [T-1, T-2\n  - broken\n'

describe('TC-GIT-013 手工编辑 .research/ (git 半边)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('非法 YAML 不阻塞 git 读操作; working copy 逐字节可读; 历史与其余文件完好', async () => {
    repo = await makeTempRepo()
    const root = repo.root
    const headBefore = await repo.head()

    await repo.write(PLAN_PATH, INVALID_YAML)

    // 状态/变更清单: 修改被如实报告 (audit 数据源, §8)
    const st = await git.status(root)
    expect(st.entries.find((e) => e.path === PLAN_PATH)!.x + st.entries.find((e) => e.path === PLAN_PATH)!.y).toBe('.M')
    const diff = await git.diffNameStatus(root)
    expect(diff.map((d) => d.path)).toEqual([PLAN_PATH])

    // hash-object 对非法内容照常计算 OID (working copy 基准)
    const oidDirty = await git.hashObject(root, PLAN_PATH)
    expect(oidDirty).toMatch(/^[0-9a-f]{40}$/)
    const oidHead = (await repo.git(['rev-parse', `HEAD:${PLAN_PATH}`])).stdout.trim()
    expect(oidDirty).not.toBe(oidHead)

    // 历史版本完好 (HEAD 仍是合法 V1)
    expect(await git.showFile(root, headBefore, PLAN_PATH)).toBe(PLAN_V1)
    expect(await git.logFile(root, PLAN_PATH)).toHaveLength(1)

    // working copy 逐字节可读 (不阻塞、不修改; 其余文件正常)
    expect(await repo.read(PLAN_PATH)).toBe(INVALID_YAML)
    expect(await git.lsFiles(root, '.research/')).toContain(PLAN_PATH)

    // checkpoint: git 层不做内容校验 (schema 校验是加载侧, WP 后续)
    const cp = await git.saveCheckpoint(root, 'TC-013 manual edit (invalid YAML)')
    expect(cp.committed).toBe(true)
    expect(await git.showFile(root, cp.commitOid!, PLAN_PATH)).toBe(INVALID_YAML)
  })
})
