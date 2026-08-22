/**
 * WP-1.5 — saveResearchCheckpoint: 完整流程测试 (真实临时 Git repo).
 *
 * 场景 ↔ TEST_MATRIX 映射 (每用例独立 mkdtemp 仓库, §1 原则):
 *  - TC-GIT-014  空 checkpoint: 无变更 → 「无可提交内容」成功短路, 无空 commit
 *  - TC-GIT-001  dirty working tree: checkpoint 仅 `.research/**`, 无关变更不受影响
 *  - TC-GIT-002  无关 staged 变更保护: 不在 commit 中**且**事后仍保持 staged
 *                (§5.2 实测固化; service 层断言 — 含违例路径单测)
 *  - TC-GIT-007  detached HEAD: 允许但明确警告
 *  - TC-GIT-008/009/010  merge/rebase/cherry-pick 进行中: 结构化拒绝, 零写入
 *  - §2  非 repo 目录: CP_NOT_A_REPO 结构化拒绝
 *
 * 「一步一结构化日志」的事件序列在 explicit-trigger.test.ts 统一锁定;
 * 本文件聚焦流程语义。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import * as git from '../../src/host/git/index.js'
import type { GitStatus } from '../../src/host/git/index.js'
import {
  NotARepoError,
  StagedPreservationError,
  assertUnrelatedStagedPreserved,
  saveResearchCheckpoint,
} from '../../src/host/service/checkpoint/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V2, type TempRepo } from '../git/temp-repo.js'
import { RecordingLogger } from './recording-logger.js'

const T3_PATH = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml'
const T3_CONTENT = 'id: T-3\nworkstream_id: WS-1\ntitle: 新任务\n'

const SAVE_OK_EVENTS = [
  'save.start',
  'save.repo-detected',
  'save.conflict-check',
  'save.status',
  'save.stage',
  'save.commit',
  'save.rev-parse',
  'save.staged-check',
  'save.done',
]

function foreignStagedOnly(path: string, x: string, y: string): GitStatus {
  return { entries: [{ kind: 'tracked', x, y, path }], raw: '', truncated: false }
}

describe('WP-1.5 saveResearchCheckpoint', () => {
  let repo: TempRepo | undefined
  let plainDir: string | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
    if (plainDir) await rm(plainDir, { recursive: true, force: true })
    plainDir = undefined
  })

  it('TC-GIT-014: 干净树 → 成功空操作 (无 commit, 无报错, HEAD 不动)', async () => {
    repo = await makeTempRepo()
    const logger = new RecordingLogger()
    const headBefore = await repo.head()

    const res = await saveResearchCheckpoint(repo.root, { logger, summary: 'nothing to do' })

    expect(res.committed).toBe(false)
    expect(res.commitOid).toBeNull()
    expect(res.changedFiles).toEqual([])
    expect(res.warnings).toEqual([])
    expect(await repo.head()).toBe(headBefore) // 无空 commit
    expect(logger.events()).toEqual([
      'save.start',
      'save.repo-detected',
      'save.conflict-check',
      'save.status',
      'save.no-op',
    ])
  })

  it('TC-GIT-001: dirty tree → 仅 .research/** 进入 commit, 无关变更原样保留', async () => {
    repo = await makeTempRepo()
    const logger = new RecordingLogger()

    // .research 内: 修改 tracked plan + 新增 untracked 文件
    await repo.write(PLAN_PATH, PLAN_V2)
    await repo.write(T3_PATH, T3_CONTENT)
    // 无关: 修改 tracked README (未 staged) + 新增 untracked notes.txt
    await repo.write('README.md', 'fixture repo — dirtied by user\n')
    await repo.write('notes.txt', 'unrelated scratch\n')

    const res = await saveResearchCheckpoint(repo.root, { logger, summary: 'TC-001 dirty tree' })

    expect(res.committed).toBe(true)
    expect(res.commitOid).toBe(await repo.head())
    expect(res.message).toBe('research: TC-001 dirty tree') // §5 message 格式
    expect(res.changedFiles).toEqual([T3_PATH, PLAN_PATH].sort())

    // commit 内容审计 (TC-GIT-015 语义的 save 半边): 只含两个 .research 文件
    const tree = await repo.git(['diff-tree', '--name-only', '-r', 'HEAD~1', 'HEAD'])
    const committed = tree.stdout.trim().split('\n').filter(Boolean)
    expect(committed).toEqual([T3_PATH, PLAN_PATH].sort())

    // 无关变更原样保留: README 未 staged 修改仍在; notes.txt 仍 untracked; .research 已干净
    const st = await git.status(repo.root)
    expect(st.entries.find((e) => e.path === 'README.md')).toMatchObject({ x: '.', y: 'M' })
    expect(st.entries.find((e) => e.path === 'notes.txt')).toMatchObject({ kind: 'untracked' })
    expect(st.entries.filter((e) => e.path.startsWith('.research/'))).toEqual([])

    expect(logger.events()).toEqual(SAVE_OK_EVENTS)
  })

  it('TC-GIT-002: 无关 staged 保护 → 不在 commit 中且事后仍保持 staged', async () => {
    repo = await makeTempRepo()
    const logger = new RecordingLogger()

    // 无关 staged 修改 (index 已改, 工作区与 index 一致 → x=M y=.)
    await repo.write('README.md', 'fixture repo — staged by user\n')
    await repo.git(['add', '--', 'README.md'])
    // .research: tracked 修改 + untracked 新增
    await repo.write(PLAN_PATH, PLAN_V2)
    await repo.write(T3_PATH, T3_CONTENT)

    const res = await saveResearchCheckpoint(repo.root, { logger, summary: 'TC-002 staged protection' })

    expect(res.committed).toBe(true)
    // 无关 staged 修改**未**进入 commit
    const tree = await repo.git(['diff-tree', '--name-only', '-r', 'HEAD~1', 'HEAD'])
    const committed = tree.stdout.trim().split('\n').filter(Boolean)
    expect(committed).toEqual([T3_PATH, PLAN_PATH].sort())
    expect(committed).not.toContain('README.md')
    expect(res.changedFiles).not.toContain('README.md')

    // 事后**仍保持 staged** (§5.2 实测固化, service 层断言通过 = 未违例)
    const st = await git.status(repo.root)
    expect(st.entries.find((e) => e.path === 'README.md')).toMatchObject({ x: 'M', y: '.' })
    // 无关 staged 内容未被 checkpoint 触碰
    expect(await repo.read('README.md')).toBe('fixture repo — staged by user\n')
    expect(logger.recordsOf('save.staged-check')[0]?.fields).toMatchObject({
      unrelatedStagedPreserved: true,
      researchClean: true,
    })
  })

  it.each(['merge', 'rebase-apply', 'rebase-merge', 'cherry-pick'] as const)(
    'TC-GIT-008/009/010: 冲突态 (%s 进行中) → 结构化拒绝, 零写入',
    async (kind) => {
      repo = await makeTempRepo({ conflict: kind })
      const logger = new RecordingLogger()
      const headBefore = await repo.head()
      const planBefore = await repo.read(PLAN_PATH)

      await expect(
        saveResearchCheckpoint(repo.root, { logger, summary: 'must be refused' }),
      ).rejects.toMatchObject({ code: 'GIT_CONFLICT' })

      // 零写入: HEAD 不动, .research 内容原样 (未被 add/commit)
      expect(await repo.head()).toBe(headBefore)
      expect(await repo.read(PLAN_PATH)).toBe(planBefore)
      // 流程在冲突检测步终止: 无 stage/commit 事件
      expect(logger.events()).toEqual(['save.start', 'save.repo-detected', 'save.conflict-check'])
      const rec = logger.recordsOf('save.conflict-check')[0]!
      expect(rec.level).toBe('error')
      const flag = { merge: 'mergeHead', 'rebase-apply': 'rebaseApply', 'rebase-merge': 'rebaseMerge', 'cherry-pick': 'cherryPickHead' }[kind]!
      expect((rec.fields?.['flags'] as Record<string, boolean>)[flag]).toBe(true)
    },
  )

  it('TC-GIT-007: detached HEAD → 允许 checkpoint 但给出明确警告', async () => {
    repo = await makeTempRepo({ detachedHead: true })
    const logger = new RecordingLogger()
    await repo.write(PLAN_PATH, PLAN_V2)

    const res = await saveResearchCheckpoint(repo.root, { logger, summary: 'detached save' })

    expect(res.committed).toBe(true)
    expect(res.commitOid).toBe(await repo.head())
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toMatch(/detached HEAD/)
    // 警告也落在结构化日志里
    expect(logger.recordsOf('save.status')[0]?.fields).toMatchObject({
      head: { kind: 'detached' },
    })
  })

  it('§2: 非 repo 目录 → CP_NOT_A_REPO 结构化拒绝 (W1 检测, 无后续 git 调用)', async () => {
    plainDir = await mkdtemp(join(tmpdir(), 'dsh-cp-notrepo-'))
    const logger = new RecordingLogger()
    await expect(
      saveResearchCheckpoint(plainDir, { logger, summary: 'no repo here' }),
    ).rejects.toMatchObject({ code: 'CP_NOT_A_REPO' })
    expect(logger.events()).toEqual(['save.start', 'save.repo-detected'])
    expect(logger.recordsOf('save.repo-detected')[0].level).toBe('error')
  })

  it('§5: 空 summary → GIT_INPUT 拒绝 (message 格式 research: <摘要>, 先于任何 I/O)', async () => {
    const logger = new RecordingLogger()
    // 非 repo 目录仍报 GIT_INPUT → 证明输入校验先于仓库检测/任何 git 调用
    await expect(
      saveResearchCheckpoint('/definitely/not/a/repo', { logger, summary: '' }),
    ).rejects.toMatchObject({ code: 'GIT_INPUT' })
    expect(logger.events()).toEqual(['save.input'])
  })

  it('service 断言助手: 无关 staged 被吞/消失 → StagedPreservationError; 保持 staged → 通过', () => {
    const before = foreignStagedOnly('README.md', 'M', '.')
    // 被吞: checkpoint 后变 clean
    let caught: unknown
    try {
      assertUnrelatedStagedPreserved(before, foreignStagedOnly('README.md', '.', '.'))
      expect.unreachable('should have thrown')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(StagedPreservationError)
    expect(caught).toMatchObject({ code: 'CP_STAGED_NOT_PRESERVED' })
    // 消失: 条目整个不见了
    expect(() => assertUnrelatedStagedPreserved(before, { entries: [], raw: '', truncated: false })).toThrow(
      StagedPreservationError,
    )
    // 未 staged 的无关条目不参与断言 (x=.)
    expect(() =>
      assertUnrelatedStagedPreserved(
        { entries: [{ kind: 'tracked', x: '.', y: 'M', path: 'other.md' }], raw: '', truncated: false },
        { entries: [{ kind: 'tracked', x: '.', y: 'M', path: 'other.md' }], raw: '', truncated: false },
      ),
    ).not.toThrow()
    // 保持 staged → 通过
    expect(() => assertUnrelatedStagedPreserved(before, foreignStagedOnly('README.md', 'M', '.'))).not.toThrow()
  })

  it('断言错误携带前后快照 (精确报告, 供 GUI 呈现)', () => {
    const before = foreignStagedOnly('README.md', 'M', '.')
    let caught: unknown
    try {
      assertUnrelatedStagedPreserved(before, foreignStagedOnly('README.md', '.', '.'))
      expect.unreachable('should have thrown')
    } catch (e) {
      caught = e
    }
    const err = caught as InstanceType<typeof StagedPreservationError>
    expect(err).toBeInstanceOf(StagedPreservationError)
    expect(err.code).toBe('CP_STAGED_NOT_PRESERVED')
    expect(err.expected).toEqual(['tracked M. README.md'])
    expect(err.actual).toEqual([expect.stringContaining('README.md')])
    expect(String(err.message)).toContain('swallowed or unstaged')
  })
})
