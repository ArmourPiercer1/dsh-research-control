/**
 * TC-GIT-005 (TEST_MATRIX §3.3): contract restore.
 * 断言要点: `git log`/`show`/`restore --source` 全链路; 恢复后 schema 校验;
 * 非法内容不静默回滚.
 *
 * git 层边界 (ARCHITECTURE §2.2 无领域逻辑): 本用例固化 W6/W7/W8 全链路 +
 * INV-GIT-5 (恢复产生新 working copy, 不改写历史, 不产生新 commit) +
 * 「不静默回滚」的 git 半边 (恢复逐字节落盘, 无自动回退逻辑)。
 * 「恢复后 schema 校验」是 WP-1.5 service 半边 (校验失败 → 警告并保留文件
 * 原状, §6) — 见报告「未决问题」。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, type TempRepo } from './temp-repo.js'

const CONTRACT = '.research/merges/TE-1/contract.md'
const V1 = '# Contract TE-1\n\nversion: 1\nstatus: agreed\n'
const V2 = '# Contract TE-1\n\nversion: 2\nstatus: renegotiated\n'
const GARBAGE = 'NOT-A-VALID-CONTRACT {{{ broken yaml ::'

describe('TC-GIT-005 contract restore (W6/W7/W8 全链路)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('log/show/restore 全链路; 恢复不改写历史; 非法内容不静默回滚', async () => {
    repo = await makeTempRepo()
    const root = repo.root

    // 两个历史版本
    await repo.write(CONTRACT, V1)
    const cp1 = await git.saveCheckpoint(root, 'TC-005 contract v1')
    const oid1 = cp1.commitOid!
    await repo.write(CONTRACT, V2)
    const cp2 = await git.saveCheckpoint(root, 'TC-005 contract v2')
    const oid2 = cp2.commitOid!
    expect(oid2).not.toBe(oid1)

    // W6 文件历史: 新→旧, 格式串 %H%x1f%aI%x1f%s 解析正确
    const log = await git.logFile(root, CONTRACT)
    expect(log.map((e) => e.oid)).toEqual([oid2, oid1])
    expect(log[0]!.subject).toBe('research: TC-005 contract v2')
    expect(log[0]!.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)

    // W7 历史版本内容
    expect(await git.showFile(root, oid1, CONTRACT)).toBe(V1)
    expect(await git.showFile(root, oid2, CONTRACT)).toBe(V2)

    // W8 restore → 新的 working copy 状态; 不修改旧 commit、不产生新 commit (INV-GIT-5)
    const headBefore = await repo.head()
    await git.restoreFile(root, oid1, CONTRACT)
    expect(await repo.read(CONTRACT)).toBe(V1)
    expect(await repo.head()).toBe(headBefore)
    const st = await git.status(root)
    const c = st.entries.find((e) => e.path === CONTRACT)!
    expect(c.x + c.y).toBe('.M') // working tree 相对 HEAD 已修改, 未 staged (v2: '.' = unchanged)

    // 非法内容不静默回滚 (git 半边): 恢复「非法」版本 → 文件逐字节保留,
    // 无自动回退; 是否拒载/警告由恢复后 schema 校验 (WP-1.5) 决定 (§6)
    await repo.write(CONTRACT, GARBAGE)
    const cp3 = await git.saveCheckpoint(root, 'TC-005 contract v3 (garbage)')
    const oid3 = cp3.commitOid!
    await git.restoreFile(root, oid3, CONTRACT)
    expect(await repo.read(CONTRACT)).toBe(GARBAGE) // 原样落盘, 不静默回滚
    expect(await repo.head()).toBe(oid3) // 历史未改写
  })

  it('restore 仅 .research/**: 越界路径被 GitScopeViolationError 拒绝 (§6 边界)', async () => {
    repo = await makeTempRepo()
    const root = repo.root
    const oid = await repo.head()
    await expect(git.restoreFile(root, oid, 'README.md')).rejects.toMatchObject({
      code: 'GIT_SCOPE',
    })
    await expect(git.restoreFile(root, oid, '../outside.yaml')).rejects.toMatchObject({
      code: 'GIT_SCOPE',
    })
    // 拒绝发生在 spawn 之前 (类型+运行时双保险), README 未变
    expect(await repo.read('README.md')).toContain('fixture repo')
  })
})
