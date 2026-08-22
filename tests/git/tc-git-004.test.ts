/**
 * TC-GIT-004 (TEST_MATRIX §3.3): plan hash 前后对比.
 * 断言要点: 编辑前后 `hash-object` OID 变化; 相同内容重写 OID 不变;
 * `hash-object` == `rev-parse HEAD:<path>` (内容一致时).
 *
 * §5.2 实测行为固化 (2026-08-21) 第 4 条: 「git hash-object -- <file> 与
 * git rev-parse HEAD:<file> 内容相同时 OID 完全一致; 文件修改后 OID 改变
 * (stale 检测的正确性基础)」— 对应 PLAN_FORK_SPEC §3.2/§5 的 stale 判定基础。
 *
 * 说明: 插件侧只走白名单 W3 (hash-object); 对照值 `rev-parse HEAD:<path>`
 * 不在 W1–W13 内, 由测试基建 raw git 计算 (夹具校验, 非插件路径)。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V1, type TempRepo } from './temp-repo.js'

describe('TC-GIT-004 plan hash 前后对比 (§5.2 回归)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('编辑前 OID 变化 / 相同内容重写 OID 不变 / == rev-parse HEAD:<path>', async () => {
    repo = await makeTempRepo()
    const root = repo.root

    // 与 HEAD 内容一致时: hash-object == rev-parse HEAD:<path> (OID 完全一致)
    const oid1 = await git.hashObject(root, PLAN_PATH)
    expect(oid1).toMatch(/^[0-9a-f]{40}$/)
    const headOid = (await repo.git(['rev-parse', `HEAD:${PLAN_PATH}`])).stdout.trim()
    expect(oid1).toBe(headOid)

    // 编辑 → OID 改变
    await repo.write(PLAN_PATH, `${PLAN_V1}# edited\n`)
    const oid2 = await git.hashObject(root, PLAN_PATH)
    expect(oid2).toMatch(/^[0-9a-f]{40}$/)
    expect(oid2).not.toBe(oid1)

    // 相同内容重写 (无实质变化, 新 mtime) → OID 不变, 不误报 (PLAN_FORK_SPEC §5)
    await repo.write(PLAN_PATH, PLAN_V1)
    const oid3 = await git.hashObject(root, PLAN_PATH)
    expect(oid3).toBe(oid1)

    // hash-object 对 working copy 内容计算, 无需 commit: 未提交时 OID 也已变化
    const shown = await git.showFile(root, (await repo.head()), PLAN_PATH)
    expect(shown).toBe(PLAN_V1) // HEAD 版本未被「重写」触碰
  })
})
