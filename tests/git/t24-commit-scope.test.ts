/**
 * V2-T2.4 (design §3.3) — the checkpoint COMMIT SCOPE at the whitelist:
 *
 *  1. 解绑改名后的归档树 (`.research.archived-<ts>/`) 不再匹配提交白名单 —
 *     提交 pathspec 是精确目录前缀 `.research/`, 不是名字 glob: 白名单面
 *     (W9/W10 形状) + 提交面谓词 (isWithinCommitScope) + 真实 repo 行为
 *     三层钉死「归档目录不会被 checkpoint 提交」;
 *  2. STANDALONE 的 state/ 子目录显式排除出提交白名单 — W9/W10 携带
 *     `:(exclude).research/state/` pathspec 魔法 (「.research/** 白名单
 *     里显式排除 .research/state/」), 提交面谓词同一口径; 真实 repo 行为
 *     (state/ 文件永不入 commit; 仅 state/ 变更 = 无可提交内容) 用真实
 *     git 2.53 固化.
 *
 * 夹具 = tests/git/temp-repo.ts 的 mkdtemp 真实 Git repo (TC-GIT 先例).
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { assertWhitelisted } from '../../src/host/git/whitelist.js'
import { PLAN_PATH, PLAN_V1, PLAN_V2, makeTempRepo, type TempRepo } from './temp-repo.js'

const ARCHIVED_DIR = '.research.archived-1770000000000'
const STATE_DB = '.research/state/research.sqlite'

/* ------------------------------------------------------------------ *
 * Unit — the commit-scope predicate (the checkpoint's status filter +
 * the service-layer changedFiles/leftover checks share this exact rule)
 * ------------------------------------------------------------------ */

describe('T2.4 unit — isWithinCommitScope (the W9/W10 commit scope as a predicate)', () => {
  it('accepts the .research/** tree paths (the declarative 真源 stays committable)', () => {
    expect(git.isWithinCommitScope('.research/project.yaml')).toBe(true)
    expect(git.isWithinCommitScope(PLAN_PATH)).toBe(true)
    expect(git.isWithinCommitScope('.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml')).toBe(true)
    // a wholly-untracked tree is reported collapsed as `?? .research/`
    expect(git.isWithinCommitScope('.research/')).toBe(true)
  })

  it('EXCLUDES the state/ sub-directory (design §3.3: outside the commit whitelist)', () => {
    expect(git.isWithinCommitScope(STATE_DB)).toBe(false)
    expect(git.isWithinCommitScope('.research/state/wal/whatever')).toBe(false)
    // status reports an untracked state dir collapsed with a trailing slash
    expect(git.isWithinCommitScope('.research/state/')).toBe(false)
  })

  it('EXCLUDES the unbind-rename-d archived tree (`.research.archived-<ts>/` is not under `.research/`)', () => {
    expect(git.isWithinCommitScope(`${ARCHIVED_DIR}/project.yaml`)).toBe(false)
    expect(git.isWithinCommitScope(`${ARCHIVED_DIR}/topics/TPC-1/workstreams/WS-1/plan.yaml`)).toBe(false)
    // the collapsed untracked-dir spelling
    expect(git.isWithinCommitScope(`${ARCHIVED_DIR}/`)).toBe(false)
    // and a plain sibling name-prefix trap (never matched: exact dir prefix rule)
    expect(git.isWithinCommitScope('research-other/project.yaml')).toBe(false)
    expect(git.isWithinCommitScope('.researchx/project.yaml')).toBe(false)
  })

  it('rejects everything outside .research/ (the INV-GIT-3 isolation is unchanged)', () => {
    expect(git.isWithinCommitScope('README.md')).toBe(false)
    expect(git.isWithinCommitScope('other/.research/x.yaml')).toBe(false)
    expect(git.isWithinCommitScope('')).toBe(false)
  })

  it('the W9/W10 whitelist shapes carry the explicit state/ exclude pathspec (frozen shape)', () => {
    const w9 = git.WHITELIST_ROWS.find((r) => r.id === 'W9')!
    expect(w9.argv).toEqual(['add', '--', '.research/', ':(exclude).research/state/'])
    const w10 = git.WHITELIST_ROWS.find((r) => r.id === 'W10')!
    expect(w10.argv.slice(-2)).toEqual(['.research/', ':(exclude).research/state/'])
    // the exact V2 shapes are whitelisted (both carry the exclude token)…
    expect(() =>
      assertWhitelisted(['add', '--', '.research/', ':(exclude).research/state/']),
    ).not.toThrow()
    expect(() =>
      assertWhitelisted(['commit', '-m', 'research: x', '--', '.research/', ':(exclude).research/state/']),
    ).not.toThrow()
    // …and the V1 shapes (no exclude) are NO LONGER whitelisted — the
    // commit scope tightened, the matcher pins it.
    expect(() => assertWhitelisted(['add', '--', '.research/'])).toThrow(git.GitWhitelistViolationError)
    expect(() => assertWhitelisted(['commit', '-m', 'research: x', '--', '.research/'])).toThrow(
      git.GitWhitelistViolationError,
    )
    // an archived-tree pathspec is not a shape the plugin can emit either
    expect(() => assertWhitelisted(['add', '--', `${ARCHIVED_DIR}/`])).toThrow(
      git.GitWhitelistViolationError,
    )
  })
})

/* ------------------------------------------------------------------ *
 * Real repo — the behavior the unit tests pin (git 2.53)
 * ------------------------------------------------------------------ */

describe('T2.4 real repo — the archived tree is never committed by a checkpoint', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('an untracked .research.archived-<ts>/ file stays OUT of the checkpoint commit (and stays untracked)', async () => {
    repo = await makeTempRepo()
    // a plan change (the committable content) + an archived-tree residue
    await repo.write(PLAN_PATH, PLAN_V2)
    await repo.write(`${ARCHIVED_DIR}/plan.yaml`, 'topic: TPC-1\nworkstream: WS-1\nordered_items:\n  - T-1\n')

    const cp = await git.saveCheckpoint(repo.root, 'T2.4 archived tree stays out of the commit')
    expect(cp.committed).toBe(true)
    expect(cp.commitOid).toMatch(/^[0-9a-f]{40}$/)

    // the commit carries the plan change and NOTHING from the archived dir
    const shown = await repo.git(['show', '--name-status', '--format=', 'HEAD'])
    const lines = shown.stdout.trim().split('\n').filter(Boolean)
    expect(lines).toContain(`M\t${PLAN_PATH}`)
    expect(lines.filter((l) => l.includes(ARCHIVED_DIR))).toEqual([])

    // the archived residue is still there, still untracked (the rename
    // directory is simply outside the plugin's git reach — INV-GIT-3)
    expect(await repo.read(`${ARCHIVED_DIR}/plan.yaml`)).toContain('workstream: WS-1')
    const tracked = await git.lsFiles(repo.root, `${ARCHIVED_DIR}`)
    expect(tracked).toEqual([])
    const st = await git.status(repo.root)
    expect(st.entries.some((e) => e.path.includes(ARCHIVED_DIR) && e.kind === 'untracked')).toBe(true)
  })
})

describe('T2.4 real repo — the state/ sub-directory is excluded from the commit whitelist', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('a state/ file is NEVER staged/committed — even when a plan change commits in the same checkpoint', async () => {
    repo = await makeTempRepo()
    await repo.write(PLAN_PATH, PLAN_V2)
    await repo.write(STATE_DB, 'SQLite format 3\0fake-db-bytes')

    const cp = await git.saveCheckpoint(repo.root, 'T2.4 state/ is outside the commit scope')
    expect(cp.committed).toBe(true)

    const shown = await repo.git(['show', '--name-status', '--format=', 'HEAD'])
    const lines = shown.stdout.trim().split('\n').filter(Boolean)
    expect(lines).toContain(`M\t${PLAN_PATH}`)
    // the runtime db file did NOT enter the commit…
    expect(lines.filter((l) => l.includes('state/'))).toEqual([])
    // …and it is still untracked in the working tree
    const st = await git.status(repo.root)
    const stateEntries = st.entries.filter((e) => e.path.startsWith('.research/state'))
    expect(stateEntries).toHaveLength(1)
    expect(stateEntries[0]!.kind).toBe('untracked')
    expect(await git.lsFiles(repo.root, '.research/')).not.toContain(STATE_DB)
  })

  it('a state/-only change is 「无可提交内容」: the checkpoint short-circuits (no commit, HEAD unchanged)', async () => {
    repo = await makeTempRepo()
    const headBefore = await repo.head()
    // ONLY the runtime db file appears (no tree change)
    await repo.write(STATE_DB, 'SQLite format 3\0fake-db-bytes')

    const cp = await git.saveCheckpoint(repo.root, 'T2.4 state-only must be a no-op')
    expect(cp.committed).toBe(false)
    expect(cp.shortCircuited).toBe(true)
    expect(cp.commitOid).toBeNull()
    // HEAD moved nowhere (no empty commit was produced)
    expect(await repo.head()).toBe(headBefore)
    // the state file is untouched by the flow (still untracked)
    const st = await git.status(repo.root)
    expect(st.entries.find((e) => e.path.startsWith('.research/state'))!.kind).toBe('untracked')
  })

  it('the service-layer save keeps the same scope: state/ never appears in changedFiles nor the leftover warnings', async () => {
    // The service face (save.ts) shares the W9/W10 scope predicate — a
    // state-only change is a clean no-op there too (the STANDALONE
    // project checkpoints on every append; a spurious leftover warning
    // per checkpoint would be a regression).
    repo = await makeTempRepo()
    await repo.write(STATE_DB, 'SQLite format 3\0fake-db-bytes')
    const { saveResearchCheckpoint } = await import('../../src/host/service/checkpoint/index.js')
    const { RecordingLogger } = await import('../checkpoint/recording-logger.js')
    const res = await saveResearchCheckpoint(repo.root, {
      logger: new RecordingLogger(),
      summary: 'T2.4 service scope check',
    })
    expect(res.committed).toBe(false)
    expect(res.changedFiles).toEqual([])
    expect(res.warnings).toEqual([])
    expect(res.commitOid).toBeNull()
  })
})
