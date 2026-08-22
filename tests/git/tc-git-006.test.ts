/**
 * TC-GIT-006 (TEST_MATRIX §3.3): branch switch.
 * 断言要点: 切换分支后 `.research/` 工作副本重新加载且顺序稳定.
 *
 * 说明: 分支切换 (`checkout`/`switch`) 是**用户**动作, 属插件禁止清单
 * (INV-GIT-7 / §4), 由测试基建注入; 本用例断言 git 层读面 (W7/W6) 对
 * 切换后的 working copy / 历史正确响应, 且同一文件重复读取逐字节一致
 * (「顺序稳定」的 git 面: 版本真源是 Git, 插件不自建版本表, INV-GIT-8)。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V1, PLAN_V2, planOrder, type TempRepo } from './temp-repo.js'

describe('TC-GIT-006 branch switch', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('切换分支后 .research/ 工作副本重载且顺序稳定', async () => {
    repo = await makeTempRepo()
    const root = repo.root

    // alt 分支: plan 顺序重排 (T-1,T-2 → T-2,T-1)
    await repo.git(['checkout', '-b', 'alt'])
    await repo.write(PLAN_PATH, PLAN_V2)
    await repo.git(['add', '--', PLAN_PATH])
    await repo.git(['commit', '-m', 'alt: reorder plan (fixture)'])
    await repo.git(['checkout', 'main'])

    // main: working copy = V1, 顺序 [T-1, T-2], 重复读取逐位一致
    expect(await repo.read(PLAN_PATH)).toBe(PLAN_V1)
    expect(planOrder(await repo.read(PLAN_PATH))).toEqual(['T-1', 'T-2'])
    expect(planOrder(await repo.read(PLAN_PATH))).toEqual(['T-1', 'T-2'])
    const mainHead = await repo.head()
    expect(await git.showFile(root, mainHead, PLAN_PATH)).toBe(PLAN_V1)
    const mainLog = await git.logFile(root, PLAN_PATH)
    expect(mainLog).toHaveLength(1)
    expect(mainLog[0]!.subject).toBe('fixture: initial commit')

    // 切到 alt: 工作副本重载为 V2, 顺序 [T-2, T-1], 同样稳定
    await repo.git(['checkout', 'alt'])
    expect(await repo.read(PLAN_PATH)).toBe(PLAN_V2)
    expect(planOrder(await repo.read(PLAN_PATH))).toEqual(['T-2', 'T-1'])
    expect(planOrder(await repo.read(PLAN_PATH))).toEqual(['T-2', 'T-1'])
    const altHead = await repo.head()
    expect(altHead).not.toBe(mainHead)
    expect(await git.showFile(root, altHead, PLAN_PATH)).toBe(PLAN_V2)
    const altLog = await git.logFile(root, PLAN_PATH)
    expect(altLog[0]!.subject).toBe('alt: reorder plan (fixture)')
    expect(altLog[0]!.oid).toBe(altHead)

    // 切回 main: 工作副本再次重载为 V1 (无插件侧缓存, Git 是唯一真源)
    await repo.git(['checkout', 'main'])
    expect(await repo.read(PLAN_PATH)).toBe(PLAN_V1)
    expect(planOrder(await repo.read(PLAN_PATH))).toEqual(['T-1', 'T-2'])
  })
})
