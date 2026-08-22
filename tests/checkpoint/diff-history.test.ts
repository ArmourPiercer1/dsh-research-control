/**
 * WP-1.5 — diffHistory: §6 历史查看 + 文件级差异摘要测试 (真实临时 Git repo).
 *
 * 场景 ↔ 契约映射:
 *  - §6/W6 版本列表: 单文件历史 (给定 path) 与整个 .research/** 历史 (缺省),
 *    新→旧, 冻结格式串 (%H/%aI/%s) 解析正确
 *  - §6/W5 文件级差异摘要: 基线版本 ↔ 当前 working tree (W5 单基线形状),
 *    范围限定 .research/** (INV-GIT-3 — 无关 tracked 变更剔除)
 *  - W7 单文件两版本内容判定 (pathContent): 与基线逐字节比较;
 *    基线不含该路径 → null
 *  - §6 边界: 越界 path → GIT_SCOPE; 非法 baseline OID → GIT_INPUT
 *  - 纯查看: 全程零写入 (HEAD 不动, 无 stage)
 */
import { afterEach, describe, expect, it } from 'vitest'

import * as git from '../../src/host/git/index.js'
import { diffHistory } from '../../src/host/service/checkpoint/index.js'
import { saveResearchCheckpoint } from '../../src/host/service/checkpoint/index.js'
import { GATE3_PATH, GATE3_V1, CONTRACT_PATH, PLAN_PATH, makeLoadedRepo, type TempRepo } from './loaded-repo.js'
import { RecordingLogger } from './recording-logger.js'

const C1 = '# Contract TE-2\n\n- 接口: v1\n'
const C2 = '# Contract TE-2\n\n- 接口: v2\n'
const PLAN_EDITED = 'workstream: WS-1\nordered_items: [T-1]\n' // 简化但 schema 合法 (T-1 存在)

describe('WP-1.5 diffHistory', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  async function setupVersions() {
    repo = await makeLoadedRepo(true) // 含无关 tracked README.md
    const root = repo.root
    const logger = new RecordingLogger()
    const oid0 = await repo.head()
    await repo.write(CONTRACT_PATH, C1)
    const oid1 = (await saveResearchCheckpoint(root, { logger, summary: 'contract v1' })).commitOid!
    await repo.write(CONTRACT_PATH, C2)
    const oid2 = (await saveResearchCheckpoint(root, { logger, summary: 'contract v2' })).commitOid!
    await repo.write(PLAN_PATH, PLAN_EDITED)
    const oid3 = (await saveResearchCheckpoint(root, { logger, summary: 'plan edit' })).commitOid!
    return { root, logger, oid0, oid1, oid2, oid3 }
  }

  it('W6 版本列表: 单文件 (新→旧, 格式串解析) 与整个 .research/** (缺省 path)', async () => {
    const { root, oid0, oid1, oid2, oid3 } = await setupVersions()

    const perFile = await diffHistory(root, { logger: new RecordingLogger(), path: CONTRACT_PATH })
    expect(perFile.versions.map((v) => v.oid)).toEqual([oid2, oid1, oid0])
    expect(perFile.versions[0]!.subject).toBe('research: contract v2')
    for (const v of perFile.versions) {
      expect(v.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    }

    const whole = await diffHistory(root, { logger: new RecordingLogger() })
    // 缺省 = 整个 .research/** 历史: 三个 checkpoint + v0 种子提交 (均触碰 .research)
    expect(whole.versions.map((v) => v.oid)).toEqual([oid3, oid2, oid1, oid0])
    // 未给 baseline → 无 fileDiff
    expect(whole.fileDiff).toBeUndefined()
    expect(whole.pathContent).toBeUndefined()
  })

  it('W5 文件级差异: 基线↔working tree, 范围限定 .research/** (无关 tracked 变更剔除)', async () => {
    const { root, oid2 } = await setupVersions()
    const logger = new RecordingLogger()

    // working tree (相对 oid2): plan 又改了 (未提交) + 无关 README 又改了 (tracked, 未提交)
    await repo!.write(PLAN_PATH, 'workstream: WS-1\nordered_items: [T-1, T-2]\n')
    await repo!.write('README.md', 'fixture repo — dirtied after oid2\n')

    const res = await diffHistory(root, { logger, baseline: oid2 })

    // 仅 .research/** 内的文件级 M/A/D/R; 无关 README 被剔除
    expect(res.baseline).toBe(oid2)
    expect(res.fileDiff).toEqual([{ status: 'M', path: PLAN_PATH }])
    expect(logger.recordsOf('diff.file-diff')[0]?.fields).toMatchObject({
      entries: 1,
      outOfScopeDropped: 1,
    })
    // 版本列表仍是全部 (与 fileDiff 独立)
    expect(res.versions.length).toBeGreaterThanOrEqual(3)
    expect(logger.events()).toEqual(['diff.start', 'diff.repo-detected', 'diff.log', 'diff.file-diff', 'diff.done'])
  })

  it('W7 pathContent: 单文件两版本内容判定 (false → 改回 → true; 基线不含该路径 → null)', async () => {
    const { root, oid0, oid1 } = await setupVersions()

    // working 的 contract = C2 (oid2), 基线 oid1 的 contract = C1 → 不等;
    // plan 在 oid3 已提交修改 → oid1↔working 的 fileDiff 含 contract + plan
    let res = await diffHistory(root, { logger: new RecordingLogger(), path: CONTRACT_PATH, baseline: oid1 })
    expect(res.pathContent).toEqual({ path: CONTRACT_PATH, sameAsBaseline: false })
    expect(res.fileDiff).toEqual([
      { status: 'M', path: CONTRACT_PATH },
      { status: 'M', path: PLAN_PATH },
    ])

    // 改回 C1 → 相等; 剩余差异只有 plan (oid3 提交, 基线 oid1 之前)
    await repo!.write(CONTRACT_PATH, C1)
    res = await diffHistory(root, { logger: new RecordingLogger(), path: CONTRACT_PATH, baseline: oid1 })
    expect(res.pathContent).toEqual({ path: CONTRACT_PATH, sameAsBaseline: true })
    expect(res.fileDiff).toEqual([{ status: 'M', path: PLAN_PATH }])

    // 基线不含该路径 (G-3 在 v0 之后才创建): null + 日志记录原因
    await repo!.write(GATE3_PATH, GATE3_V1)
    const res2 = await diffHistory(root, {
      logger: new RecordingLogger(),
      path: GATE3_PATH,
      baseline: oid0,
    })
    expect(res2.pathContent).toBeNull()
  })

  it('§6 边界 + 纯查看: 越界 path → GIT_SCOPE; 非法 baseline → GIT_INPUT; 全程零写入', async () => {
    const { root, oid1 } = await setupVersions()
    const headBefore = await repo!.head()

    for (const bad of ['README.md', '../x.yaml']) {
      await expect(
        diffHistory(root, { logger: new RecordingLogger(), path: bad }),
      ).rejects.toMatchObject({ code: 'GIT_SCOPE' })
    }
    for (const bad of ['short', 'HEAD', 'zzz'.repeat(14)]) {
      await expect(
        diffHistory(root, { logger: new RecordingLogger(), baseline: bad }),
      ).rejects.toMatchObject({ code: 'GIT_INPUT' })
    }
    // 非 repo
    await expect(
      diffHistory('/definitely/not/a/repo', { logger: new RecordingLogger() }),
    ).rejects.toMatchObject({ code: 'CP_NOT_A_REPO' })

    // 纯查看: 拒绝/成功路径都不产生写入
    const ok = await diffHistory(root, { logger: new RecordingLogger(), path: CONTRACT_PATH, baseline: oid1 })
    expect(ok.versions.length).toBeGreaterThan(0)
    expect(await repo!.head()).toBe(headBefore)
    const st = await git.status(root)
    expect(st.entries.filter((e) => e.kind === 'untracked' || e.x !== '.')).toEqual([]) // 无 stage 产生
  })
})
