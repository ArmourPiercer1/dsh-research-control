/**
 * TC-GIT-015 (TEST_MATRIX §3.3): commit 内容审计.
 * 断言要点: checkpoint commit 的 diff 只含 `.research/**`; 无 revision 表
 * (schema 断言).
 *
 * 追溯: INV-GIT-3 (只提交 .research/**) + INV-GIT-8 (不自建版本表: 无
 * PlanRevision/ContractRevision/TopologyRevision — Git 是声明式状态唯一
 * 版本真源) + AC-13 (无第二套文件版本系统)。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, TASK1_PATH, type TempRepo } from './temp-repo.js'

/** 冻结 schema 目录 (WR 根, 只读). tests/git/ → 3 级上 = research-control-plane 根. */
const SCHEMA_DIR = fileURLToPath(new URL('../../../schema', import.meta.url))

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...walkFiles(p))
    else out.push(p)
  }
  return out
}

describe('TC-GIT-015 commit 内容审计 (INV-GIT-3 / INV-GIT-8)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('checkpoint commit 的 diff 只含 .research/** (无关 staged/untracked 均不在内)', async () => {
    repo = await makeTempRepo()
    const root = repo.root

    // 混合 dirty: .research 修改 + 无关 staged + 无关 untracked
    await repo.write(TASK1_PATH, 'id: T-1\ngoal: audited edit\n')
    await repo.write('README.md', 'staged unrelated\n')
    await repo.git(['add', '--', 'README.md'])
    await repo.write('stray.txt', 'untracked\n')

    const cp = await git.saveCheckpoint(root, 'TC-015 commit content audit')
    expect(cp.committed).toBe(true)

    // ① commit diff 逐行审计: 每个路径都在 .research/ 下 (INV-GIT-3)
    const shown = await repo.git(['show', '--name-status', '--format=', 'HEAD'])
    const lines = shown.stdout.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const parts = line.split('\t')
      const path = parts[parts.length - 1]!
      expect(path.startsWith('.research/')).toBe(true)
    }
    expect(lines.join('\n')).toContain(`M\t${TASK1_PATH}`)
    expect(lines.join('\n')).not.toContain('README.md')
    expect(lines.join('\n')).not.toContain('stray.txt')

    // ② commit message 符合 §5 格式 (research: <摘要>)
    const msg = (await repo.git(['log', '-1', '--format=%s'])).stdout.trim()
    expect(msg).toBe('research: TC-015 commit content audit')
  })

  it('无 revision 表 (INV-GIT-8): 冻结 schema 无 Plan/Contract/TopologyRevision', () => {
    // Git 是声明式状态唯一版本真源; 插件不自建版本表 (INV-GIT-8 / AC-13)。
    const offenders: string[] = []
    for (const f of walkFiles(SCHEMA_DIR)) {
      const text = readFileSync(f, 'utf8')
      for (const name of ['PlanRevision', 'ContractRevision', 'TopologyRevision']) {
        if (new RegExp(`\\b${name}\\b`).test(text)) offenders.push(`${f}: ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
