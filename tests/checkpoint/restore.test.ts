/**
 * WP-1.5 — restoreResearchFile: §6 恢复链路测试 (真实临时 Git repo +
 * 真实冻结 schema 的 loader 校验).
 *
 * 场景 ↔ 契约映射:
 *  - TC-GIT-005 恢复往返: save→改→restore→**内容相等** + 恢复后 loader 校验
 *    通过; 恢复产生新 working copy, 不修改旧 commit / 不产生新 commit (INV-GIT-5)
 *  - TC-GIT-005 「恢复后 schema 校验; 非法内容不静默」: 恢复一个历史版本为
 *    非法内容 → validation.ok=false + 精确错误定位 + 警告; **保留文件原状,
 *    不静默回滚** (§6); 工作副本其余文件仍可检 (loader 全树可跑)
 *  - §6「log 定位」: commit 不在该文件历史 → RestoreNotInHistoryError
 *  - TC-GIT-005 「恢复失败精确报错且工作副本不被破坏到不可检态」: 删除性
 *    commit (在 log 中但路径已不存在) → W7 show 失败 → RestoreFailedError
 *    (git 原始 stderr 精确保留) + workingCopyIntact + loader 仍可检
 *  - §6 边界: 路径越出 .research/** → GIT_SCOPE (spawn 之前); 非法 OID → GIT_INPUT
 *  - §2: 非 repo → CP_NOT_A_REPO
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import * as git from '../../src/host/git/index.js'
import { loadResearchTree } from '../../src/host/domain/loader/index.js'
import {
  FsResearchReader,
  NotARepoError,
  RestoreFailedError,
  RestoreNotInHistoryError,
  restoreResearchFile,
  saveResearchCheckpoint,
} from '../../src/host/service/checkpoint/index.js'
import { WR_SCHEMA_DIR } from '../loader/fixtures.js'
import { GATE3_PATH, GATE3_V1, PLAN_GARBAGE, PLAN_PATH, CONTRACT_PATH, makeLoadedRepo, type TempRepo } from './loaded-repo.js'
import { RecordingLogger } from './recording-logger.js'

const RESTORE_OK_EVENTS = [
  'restore.start',
  'restore.repo-detected',
  'restore.log-locate',
  'restore.show',
  'restore.restore',
  'restore.verify-content',
  'restore.validate',
  'restore.done',
]

describe('WP-1.5 restoreResearchFile', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('TC-GIT-005 往返: save→改→restore→内容相等 + loader 校验通过 + 不产生新 commit (INV-GIT-5)', async () => {
    repo = await makeLoadedRepo()
    const root = repo.root
    const logger = new RecordingLogger()

    // 两个历史版本
    const c1 = '# Contract TE-2\n\n- 接口: v1 (初始)\n'
    const c2 = '# Contract TE-2\n\n- 接口: v2 (修订)\n'
    await repo.write(CONTRACT_PATH, c1)
    const cp1 = await saveResearchCheckpoint(root, { logger, summary: 'contract v1' })
    const oid1 = cp1.commitOid!
    await repo.write(CONTRACT_PATH, c2)
    const cp2 = await saveResearchCheckpoint(root, { logger, summary: 'contract v2' })
    const oid2 = cp2.commitOid!
    expect(oid2).not.toBe(oid1)

    // working tree 又改了 (未提交) — restore 必须精确回到 oid1 内容
    await repo.write(CONTRACT_PATH, '# Contract TE-2\n\n- 接口: v3 (working, 未提交)\n')

    const headBefore = await repo.head()
    const rlog = new RecordingLogger() // restore 独立日志面 (save 的日志不混入)
    const res = await restoreResearchFile(root, oid1, CONTRACT_PATH, { logger: rlog, schemaDir: WR_SCHEMA_DIR })

    // 内容相等 (逐字节)
    expect(await repo.read(CONTRACT_PATH)).toBe(c1)
    expect(res.path).toBe(CONTRACT_PATH)
    expect(res.commitOid).toBe(oid1)
    // 恢复后 loader 校验通过 (真实冻结 schema)
    expect(res.validation.ok).toBe(true)
    expect(res.validation.errors).toEqual([])
    expect(res.warnings).toEqual([])
    // 不修改旧 commit、不产生新 commit (INV-GIT-5); 恢复 = 新 working copy 状态
    expect(await repo.head()).toBe(headBefore)
    const st = await git.status(root)
    expect(st.entries.find((e) => e.path === CONTRACT_PATH)).toMatchObject({ x: '.', y: 'M' }) // 未 staged
    expect(rlog.events()).toEqual(RESTORE_OK_EVENTS)
  })

  it('TC-GIT-005 非法内容不静默: 恢复非法历史版本 → validation.ok=false + 精确错误 + 保留原状不回滚', async () => {
    repo = await makeLoadedRepo()
    const root = repo.root
    const logger = new RecordingLogger()

    // v0 的 plan 是合法的; 写非法版本 (YAML 解析必失败) 并提交
    await repo.write(PLAN_PATH, PLAN_GARBAGE)
    const cp = await saveResearchCheckpoint(root, { logger, summary: 'broken plan (fixture)' })
    const oidBad = cp.commitOid!

    const res = await restoreResearchFile(root, oidBad, PLAN_PATH, { logger, schemaDir: WR_SCHEMA_DIR })

    // 不静默: 校验失败被显式报告 (精确到文件 + 代码)
    expect(res.validation.ok).toBe(false)
    expect(res.validation.errors.length).toBeGreaterThan(0)
    const relPlan = 'topics/TPC-1/workstreams/WS-1/plan.yaml'
    expect(res.validation.errors.every((e) => e.file === relPlan)).toBe(true)
    expect(res.validation.errors[0]!.code).toBe('PARSE')
    // §6: 警告并保留文件原状供用户处理, 不静默回滚
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toMatch(/kept as-is.*no silent rollback/u)
    expect(await repo.read(PLAN_PATH)).toBe(PLAN_GARBAGE) // 原样保留
    expect(await repo.head()).toBe(oidBad) // 历史未改写

    // 工作副本未被破坏到不可检态: loader 全树仍可运行, 错误只落在 plan 文件
    const reader = new FsResearchReader(join(root, '.research'))
    const tree = loadResearchTree(reader, join(root, '.research'), WR_SCHEMA_DIR)
    expect(tree.errors).toEqual(res.validation.errors) // 无级联, 其余文件正常加载
  })

  it('§6 log 定位: commit 不在该文件历史 → RestoreNotInHistoryError (附实际版本列表), 文件原状', async () => {
    repo = await makeLoadedRepo()
    const root = repo.root
    const logger = new RecordingLogger()
    const oid0 = await repo.head() // v0: 树中无 G-3

    await repo.write(GATE3_PATH, GATE3_V1)
    const cp = await saveResearchCheckpoint(root, { logger, summary: 'add gate G-3' })
    const oidNew = cp.commitOid!

    const rlog = new RecordingLogger()
    await expect(
      restoreResearchFile(root, oid0, GATE3_PATH, { logger: rlog, schemaDir: WR_SCHEMA_DIR }),
    ).rejects.toMatchObject({ code: 'CP_RESTORE_NOT_IN_HISTORY' })
    expect(rlog.events()).toEqual(['restore.start', 'restore.repo-detected', 'restore.log-locate'])
    // 文件原状 (拒绝发生在任何写操作之前)
    expect(await repo.read(GATE3_PATH)).toBe(GATE3_V1)

    // 同一文件的正确 commit → 成功 (定位通过)
    const ok = await restoreResearchFile(root, oidNew, GATE3_PATH, { logger: new RecordingLogger(), schemaDir: WR_SCHEMA_DIR })
    expect(ok.validation.ok).toBe(true)
    expect(ok.path).toBe(GATE3_PATH)
  })

  it('TC-GIT-005 恢复失败精确报错: 删除性 commit → W7 失败 → RestoreFailedError + 工作副本可检', async () => {
    repo = await makeLoadedRepo()
    const root = repo.root
    const logger = new RecordingLogger()

    // v1 创建 G-3 → 提交; 随后删除 G-3 → 提交 (删除性 commit 在文件 log 中)
    await repo.write(GATE3_PATH, GATE3_V1)
    const cpA = await saveResearchCheckpoint(root, { logger, summary: 'add gate G-3' })
    expect(cpA.commitOid).toBeTruthy()
    await repo.git(['rm', '-q', '--', GATE3_PATH]) // 夹具: 删除 + stage
    const cpDel = await saveResearchCheckpoint(root, { logger, summary: 'delete gate G-3' })
    const oidDel = cpDel.commitOid!
    expect(existsSync(join(root, GATE3_PATH))).toBe(false)

    const headBefore = await repo.head()
    const rlog = new RecordingLogger()
    let caught: unknown
    try {
      await restoreResearchFile(root, oidDel, GATE3_PATH, { logger: rlog, schemaDir: WR_SCHEMA_DIR })
      expect.unreachable('restore from a deletion commit must fail')
    } catch (e) {
      caught = e
    }

    // 精确报错: service 结构化错误 + git 原始 stderr 保留
    const err = caught as RestoreFailedError
    expect(err).toBeInstanceOf(RestoreFailedError)
    expect(err.code).toBe('CP_RESTORE_FAILED')
    expect(err.path).toBe(GATE3_PATH)
    expect(err.commitOid).toBe(oidDel)
    const gitErr = err.cause as git.GitCommandError
    expect(gitErr.code).toBe('GIT_COMMAND')
    expect(gitErr.stderr).toContain('does not exist') // git 精确信息原样展示 (§9)
    // 工作副本不被破坏到不可检态: 与失败前一致 + loader 仍可运行 (零错误)
    expect(err.workingCopyIntact).toBe(true)
    expect(err.workingCopyLoaderErrors).toEqual([])
    expect(await repo.head()).toBe(headBefore)
    expect(existsSync(join(root, GATE3_PATH))).toBe(false) // 无半成品写入
    expect(rlog.events()).toEqual([
      'restore.start',
      'restore.repo-detected',
      'restore.log-locate',
      'restore.show',
    ])
    expect(rlog.recordsOf('restore.show')[0].level).toBe('error')
  })

  it('§6 边界: 越界路径 → GIT_SCOPE (spawn 之前); 非法 OID → GIT_INPUT; 非 repo → CP_NOT_A_REPO', async () => {
    repo = await makeLoadedRepo()
    const root = repo.root
    const oid = await repo.head()

    // 越界: .research/ 之外 / .. 逃逸 — 均在任何 git 调用之前拒绝
    for (const bad of ['README.md', '../escape.yaml', '/abs.yaml']) {
      await expect(
        restoreResearchFile(root, oid, bad, { logger: new RecordingLogger(), schemaDir: WR_SCHEMA_DIR }),
      ).rejects.toMatchObject({ code: 'GIT_SCOPE' })
    }
    // 非法 OID (短 OID / 非 hex)
    for (const bad of ['abc', 'HEAD', 'a'.repeat(39), 'g'.repeat(40)]) {
      await expect(
        restoreResearchFile(root, bad, CONTRACT_PATH, { logger: new RecordingLogger(), schemaDir: WR_SCHEMA_DIR }),
      ).rejects.toMatchObject({ code: 'GIT_INPUT' })
    }
    // 非 repo 目录
    await expect(
      restoreResearchFile('/definitely/not/a/repo', oid, CONTRACT_PATH, {
        logger: new RecordingLogger(),
        schemaDir: WR_SCHEMA_DIR,
      }),
    ).rejects.toMatchObject({ code: 'CP_NOT_A_REPO' })
    // 拒绝路径未触碰磁盘
    expect(await repo.read(GATE3_PATH).catch(() => null)).toBe(null) // G-3 从未创建
    expect(existsSync(join(root, 'README.md'))).toBe(false)
  })
})
