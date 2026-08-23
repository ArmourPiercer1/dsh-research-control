/**
 * WP-7.2 — context readers: 五类读者单元测试（stub face — 类型面纪律）。
 *
 * 覆盖（任务书主线目标 1）:
 *  - plugin 状态快照: 范围过滤（ws/topic/project）/ 未知 id RD_INPUT /
 *    face 失败 RD_STATE / Current 折叠默认值 / Intervention 分组;
 *  - session 查询: 指针面绑定语义（未绑定 = null 诚实; ws 范围 = 指针
 *    命中）/ 未知 topic RD_INPUT / face 失败 RD_SESSION;
 *  - git diff: 经 audit strict 面（真实 temp repo 成功路径 + 非 repo
 *    RD_GIT_DIFF + policy face 失败）;
 *  - git log: 经 git W6 只读面（真实 temp repo 历史 + HEAD / 非 repo
 *    RD_GIT_LOG / 范围换算失败 RD_INPUT 透传 / maxCount 护栏）;
 *  - artifact refs: 范围过滤 / 全状态保留（含 MISSING）/ 未知 topic
 *    RD_INPUT / face 失败 RD_ARTIFACT / 确定性 id 序。
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'

import type { ResearchTree } from '../../src/host/domain/loader/index.js'
import type { ArtifactRow } from '../../src/host/domain/semantics/index.js'
import { isReaderError, ReaderError } from '../../src/host/service/investigator/readers/types.js'
import {
  ArtifactRefsReader,
  GitDiffReader,
  GitLogReader,
  PluginStateReader,
  SessionQueryReader,
} from '../../src/host/service/investigator/readers/index.js'
import type { SessionSummary } from '../../src/shared/host-adapter-ports.js'

const roots: string[] = []
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * 树 stub（最小 ResearchTree 面 — 读者只读 project/topics 子面）
 * ------------------------------------------------------------------ */

function taskDoc(id: string, ws: string, title: string, ac: string[] = []) {
  return {
    id,
    workstream_id: ws,
    title,
    goal: `goal ${id}`,
    deliverables: [],
    acceptance_criteria: ac,
    created_by: { kind: 'USER' },
    created_at: 1,
  }
}

function makeTree(): ResearchTree {
  return {
    project: {
      id: 'PRJ-1',
      title: 'Project One',
      description: 'desc',
      importance: 3,
      attention_mode: 'NORMAL',
      current_objective_refs: [],
      created_at: 1,
    },
    workspace: null,
    objectives: [],
    topics: [
      {
        id: 'TPC-1',
        path: 'topics/TPC-1',
        doc: { id: 'TPC-1', project_id: 'PRJ-1', title: 'Topic One', objective_refs: [], created_at: 1 },
        workstreams: [
          {
            id: 'WS-1',
            topicId: 'TPC-1',
            path: 'topics/TPC-1/workstreams/WS-1',
            doc: { id: 'WS-1', topic_id: 'TPC-1', title: 'WS One', lifecycle: 'REALIZED', created_at: 1 },
            plan: null,
            tasks: [
              { id: 'T-1', doc: taskDoc('T-1', 'WS-1', 'Task 1', ['ac1']) },
              { id: 'T-2', doc: taskDoc('T-2', 'WS-1', 'Task 2') },
            ],
            gates: [],
            milestones: [],
          },
          {
            id: 'WS-2',
            topicId: 'TPC-1',
            path: 'topics/TPC-1/workstreams/WS-2',
            doc: { id: 'WS-2', topic_id: 'TPC-1', title: 'WS Two', lifecycle: 'PLANNED', created_at: 1 },
            plan: null,
            tasks: [{ id: 'T-3', doc: taskDoc('T-3', 'WS-2', 'Task 3') }],
            gates: [],
            milestones: [],
          },
        ],
        merges: [],
      },
    ],
  } as unknown as ResearchTree
}

const emptySemantic = { claims: 0, activeClaims: 0, retractedClaims: 0, facts: 0, artifacts: 0, missingArtifacts: 0 }

function makePluginStateReader(over: Partial<ConstructorParameters<typeof PluginStateReader>[0]> = {}) {
  return new PluginStateReader({
    readTree: () => makeTree(),
    taskStates: () => new Map(),
    runs: () => [
      { id: 'R-1', workstreamId: 'WS-1', taskId: 'T-1', status: 'RUNNING', intent: null, startedAt: 10, endedAt: null },
      { id: 'R-2', workstreamId: 'WS-2', taskId: null, status: 'SUCCEEDED', intent: 'probe', startedAt: 11, endedAt: 12 },
    ],
    interventions: () => [
      { id: 'IV-1', title: 'iv1', detail: null, status: 'OPEN', workstreamIds: ['WS-1'], createdAt: 1 },
      { id: 'IV-2', title: 'iv2', detail: null, status: 'PENDING', workstreamIds: ['WS-2'], createdAt: 2 },
      { id: 'IV-3', title: 'iv3', detail: null, status: 'OPEN', workstreamIds: ['WS-2'], createdAt: 3 },
    ],
    openPlanForkCount: () => 0,
    semanticCounts: () => emptySemantic,
    ...over,
  })
}

describe('reader 1/5 — plugin 状态快照（stub face）', () => {
  it('project-wide: 全集（双 WS + 全部 run + Intervention 分组 + 语义计数）', () => {
    const snap = makePluginStateReader().read({})
    expect(snap.project?.id).toBe('PRJ-1')
    expect(snap.workstreams.map((w) => w.id)).toEqual(['WS-1', 'WS-2'])
    expect(snap.topics).toEqual([{ id: 'TPC-1', title: 'Topic One', workstreamIds: ['WS-1', 'WS-2'] }])
    expect(snap.runs.map((r) => r.id)).toEqual(['R-1', 'R-2'])
    expect(snap.interventions.open.map((iv) => iv.id)).toEqual(['IV-1', 'IV-3'])
    expect(snap.interventions.pending.map((iv) => iv.id)).toEqual(['IV-2'])
    expect(snap.semantic).toEqual(emptySemantic)
    // 折叠缺省: 无事件 ⇒ PLANNED / NOT_REQUIRED。
    expect(snap.workstreams[0]!.tasks).toEqual([
      { id: 'T-1', title: 'Task 1', execution: 'PLANNED', validation: 'NOT_REQUIRED' },
      { id: 'T-2', title: 'Task 2', execution: 'PLANNED', validation: 'NOT_REQUIRED' },
    ])
  })

  it('workstream scope: 收窄到该 WS（topic 行的 workstreamIds 同步收窄）', () => {
    const snap = makePluginStateReader().read({ workstreamId: 'WS-2' })
    expect(snap.workstreams.map((w) => w.id)).toEqual(['WS-2'])
    expect(snap.topics).toEqual([{ id: 'TPC-1', title: 'Topic One', workstreamIds: ['WS-2'] }])
    expect(snap.runs.map((r) => r.id)).toEqual(['R-2'])
    // runningRuns 计数（R-1 在 WS-1, 不在范围内）。
    expect(snap.workstreams[0]!.runningRuns).toBe(0)
  })

  it('topic scope: 该 topic 全部 WS + 对应 run', () => {
    const snap = makePluginStateReader().read({ topicId: 'TPC-1' })
    expect(snap.workstreams.map((w) => w.id)).toEqual(['WS-1', 'WS-2'])
    expect(snap.runs).toHaveLength(2)
  })

  it('折叠态覆盖默认值（taskStates face — rpc getWorkstream 同口径）', () => {
    const snap = makePluginStateReader({
      taskStates: (ws) =>
        new Map(
          ws === 'WS-1'
            ? [
                ['T-1', { execution: 'EXECUTED', validation: 'PASSED' }],
                ['T-2', { execution: 'ACTIVE', validation: 'PENDING' }],
              ]
            : [],
        ),
    }).read({ workstreamId: 'WS-1' })
    expect(snap.workstreams[0]!.tasks).toEqual([
      { id: 'T-1', title: 'Task 1', execution: 'EXECUTED', validation: 'PASSED' },
      { id: 'T-2', title: 'Task 2', execution: 'ACTIVE', validation: 'PENDING' },
    ])
    expect(snap.workstreams[0]!.runningRuns).toBe(1)
  })

  it('未知 workstream / topic ⇒ RD_INPUT（大声, 不猜）', () => {
    const reader = makePluginStateReader()
    for (const scope of [{ workstreamId: 'WS-9' }, { topicId: 'TPC-9' }] as const) {
      try {
        reader.read(scope)
        expect.unreachable('must throw')
      } catch (e) {
        expect(isReaderError(e)).toBe(true)
        expect((e as ReaderError).code).toBe('RD_INPUT')
      }
    }
  })

  it('双指 scope ⇒ RD_INPUT', () => {
    expect(() => makePluginStateReader().read({ topicId: 'TPC-1', workstreamId: 'WS-1' })).toThrowError(ReaderError)
    try {
      makePluginStateReader().read({ topicId: 'TPC-1', workstreamId: 'WS-1' })
    } catch (e) {
      expect((e as ReaderError).code).toBe('RD_INPUT')
    }
  })

  it('readTree 失败 ⇒ RD_STATE（cause 保留）', () => {
    const boom = new Error('tree exploded')
    const reader = makePluginStateReader({ readTree: () => { throw boom } })
    try {
      reader.read({})
      expect.unreachable('must throw')
    } catch (e) {
      expect(isReaderError(e)).toBe(true)
      expect((e as ReaderError).code).toBe('RD_STATE')
      expect((e as Error).cause).toBe(boom)
    }
  })

  it('face 抛错 ⇒ RD_STATE（结构化, cause 保留）', () => {
    const boom = new Error('run table gone')
    const reader = makePluginStateReader({ runs: () => { throw boom } })
    try {
      reader.read({})
      expect.unreachable('must throw')
    } catch (e) {
      expect(isReaderError(e)).toBe(true)
      expect((e as ReaderError).code).toBe('RD_STATE')
      expect((e as Error).cause).toBe(boom)
    }
  })
})

/* ------------------------------------------------------------------ *
 * session 查询（stub face）
 * ------------------------------------------------------------------ */

const SESS_A: SessionSummary = { id: 'sess-a', running: true, createdAt: 100, blank: false, cwd: '/w' }
const SESS_B: SessionSummary = { id: 'sess-b', running: false, createdAt: 200, blank: true }

function makeSessionReader(over: Partial<ConstructorParameters<typeof SessionQueryReader>[0]> = {}) {
  return new SessionQueryReader({
    listSessions: () => [SESS_A, SESS_B],
    pointerOf: (id) => (id === 'sess-a' ? { workstreamId: 'WS-1', lastSeq: 7, runId: null, runStartedAt: null, intent: 'probe' } : null),
    runs: ({ dshSessionId }) => (dshSessionId === 'sess-a' ? [{ id: 'R-9', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 50, endedAt: null }] : []),
    topicWorkstreams: () => null,
    ...over,
  })
}

describe('reader 2/5 — session 查询（stub face）', () => {
  it('project scope: 全部 live session（未绑定 = pointer null 诚实; run 关联）', () => {
    const snap = makeSessionReader().read({})
    expect(snap.sessions).toHaveLength(2)
    const a = snap.sessions[0]!
    expect(a.sessionId).toBe('sess-a')
    expect(a.pointer).toEqual({ workstreamId: 'WS-1', taskId: null, intent: 'probe', lastSeq: 7, runId: null, runStartedAt: null })
    expect(a.run).toEqual({ id: 'R-9', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 50, endedAt: null })
    const b = snap.sessions[1]!
    expect(b.pointer).toBeNull()
    expect(b.run).toBeNull()
    expect(b.cwd).toBeNull() // SESS_B 无 cwd ⇒ null（不虚构）
  })

  it('workstream scope: 仅指针命中该 WS 的 session（绑定语义 — 不用 cwd 猜）', () => {
    const snap = makeSessionReader().read({ workstreamId: 'WS-1' })
    expect(snap.sessions.map((s) => s.sessionId)).toEqual(['sess-a'])
    const snapNone = makeSessionReader().read({ workstreamId: 'WS-9' })
    expect(snapNone.sessions).toEqual([])
  })

  it('topic scope: 该 topic WS 集合命中; 未知 topic ⇒ RD_INPUT', () => {
    const reader = makeSessionReader({ topicWorkstreams: (t) => (t === 'TPC-1' ? ['WS-1'] : null) })
    expect(reader.read({ topicId: 'TPC-1' }).sessions.map((s) => s.sessionId)).toEqual(['sess-a'])
    try {
      reader.read({ topicId: 'TPC-9' })
      expect.unreachable('must throw')
    } catch (e) {
      expect((e as ReaderError).code).toBe('RD_INPUT')
    }
  })

  it('face 失败 ⇒ RD_SESSION（listSessions / pointerOf）', () => {
    for (const over of [{ listSessions: () => { throw new Error('dsh down') } }, { pointerOf: () => { throw new Error('meta down') } }] as const) {
      try {
        makeSessionReader(over).read({})
        expect.unreachable('must throw')
      } catch (e) {
        expect(isReaderError(e)).toBe(true)
        expect((e as ReaderError).code).toBe('RD_SESSION')
      }
    }
  })
})

/* ------------------------------------------------------------------ *
 * git diff / git log（真实 temp repo — git 面真实执行）
 * ------------------------------------------------------------------ */

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function makeGitRepo(): { root: string; file: string } {
  const root = temp('wp72-git-')
  const file = join(root, 'outside.md')
  writeFileSync(file, 'v1\n')
  git(root, 'init', '-q', '--initial-branch=main')
  git(root, 'config', 'user.email', 't@local')
  git(root, 'config', 'user.name', 't')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  return { root, file }
}

describe('reader 3/5 — git diff（经 audit strict 面 — 真实 repo）', () => {
  it('干净 repo ⇒ 空变化报告（research consistent）', async () => {
    const { root } = makeGitRepo()
    const reader = new GitDiffReader({ workspaceRoot: root, policy: () => null })
    const report = await reader.read({})
    expect(report.trackedChanges).toEqual([])
    expect(report.newFiles.outsideResearch).toEqual([])
    expect(report.research.consistent).toBe(true)
  })

  it('tracked 修改（.research 外）⇒ trackedChanges 原样透出（不重投影）', async () => {
    const { root, file } = makeGitRepo()
    writeFileSync(file, 'v2\n')
    const reader = new GitDiffReader({ workspaceRoot: root, policy: () => null })
    const report = await reader.read({})
    expect(report.trackedChanges.map((c) => c.path)).toEqual(['outside.md'])
    // W4 冻结分类: 未暂存的工作树变更 = kind 'tracked', x='.' (index 无变化),
    // y='M' (worktree 变更)。
    expect(report.trackedChanges[0]).toMatchObject({ kind: 'tracked', x: '.', y: 'M' })
  })

  it('非 repo ⇒ RD_GIT_DIFF（audit NotARepo 原样大声）', async () => {
    const root = temp('wp72-nogit-')
    const reader = new GitDiffReader({ workspaceRoot: root, policy: () => null })
    await expect(reader.read({})).rejects.toMatchObject({ name: 'ReaderError', code: 'RD_GIT_DIFF' })
  })

  it('policy face 失败 ⇒ RD_GIT_DIFF', async () => {
    const { root } = makeGitRepo()
    const reader = new GitDiffReader({ workspaceRoot: root, policy: () => { throw new Error('policy face down') } })
    await expect(reader.read({})).rejects.toMatchObject({ code: 'RD_GIT_DIFF' })
  })

  it('构造护栏: workspaceRoot 空 ⇒ RD_INPUT', () => {
    expect(
      () => new GitDiffReader({ workspaceRoot: '', policy: () => null } as unknown as ConstructorParameters<typeof GitDiffReader>[0]),
    ).toThrowError(ReaderError)
  })
})

describe('reader 4/5 — git log（经 git W6 只读面 — 真实 repo）', () => {
  it('声明式路径历史 + HEAD（默认窗口 20）', async () => {
    const { root } = makeGitRepo()
    const reader = new GitLogReader({ repoRoot: root, resolveLogPath: () => 'outside.md' })
    const snap = await reader.read({})
    expect(snap.path).toBe('outside.md')
    expect(snap.maxCount).toBe(20)
    expect(snap.headOid).toBe(git(root, 'rev-parse', 'HEAD'))
    expect(snap.entries).toHaveLength(1)
    expect(snap.entries[0]!.oid).toBe(snap.headOid)
    expect(snap.entries[0]!.subject).toBe('init')
    expect(typeof snap.entries[0]!.authorDate).toBe('string')
  })

  it('maxCount 截断（多提交触及该路径 — 窗口面）', async () => {
    const { root, file } = makeGitRepo()
    for (const [i, v] of ['second', 'third'].entries()) {
      writeFileSync(file, `v${2 + i}\n`)
      git(root, 'add', 'outside.md')
      git(root, 'commit', '-q', '-m', v)
    }
    const reader = new GitLogReader({ repoRoot: root, resolveLogPath: () => 'outside.md', maxCount: 2 })
    const snap = await reader.read({})
    expect(snap.entries.map((e) => e.subject)).toEqual(['third', 'second'])
    expect(snap.maxCount).toBe(2)
  })

  it('范围换算失败（face 抛 ReaderError RD_INPUT）⇒ 原样透传', async () => {
    const { root } = makeGitRepo()
    const reader = new GitLogReader({
      repoRoot: root,
      resolveLogPath: () => {
        throw new ReaderError('RD_INPUT', 'gitLog: topic TPC-9 does not exist in the declarative tree')
      },
    })
    await expect(reader.read({ topicId: 'TPC-9' })).rejects.toMatchObject({ code: 'RD_INPUT' })
  })

  it('非 repo ⇒ RD_GIT_LOG', async () => {
    const root = temp('wp72-nogit2-')
    const reader = new GitLogReader({ repoRoot: root, resolveLogPath: () => '.research' })
    await expect(reader.read({})).rejects.toMatchObject({ code: 'RD_GIT_LOG' })
  })

  it('构造护栏: maxCount 负数 ⇒ RD_INPUT', () => {
    expect(
      () => new GitLogReader({ repoRoot: '/x', resolveLogPath: () => 'p', maxCount: -1 } as unknown as ConstructorParameters<typeof GitLogReader>[0]),
    ).toThrowError(ReaderError)
  })
})

/* ------------------------------------------------------------------ *
 * artifact refs（stub face）
 * ------------------------------------------------------------------ */

function artifactRow(id: string, ws: string, status: 'REGISTERED' | 'MISSING', uri = `data/${id}/`): ArtifactRow {
  return {
    id,
    workstream_id: ws,
    type: 'DATASET',
    title: `artifact ${id}`,
    uri,
    status,
    recorded_at: 1000,
    related_task: null,
  } as unknown as ArtifactRow
}

describe('reader 5/5 — artifact refs（stub face）', () => {
  const rows = new Map<string, ArtifactRow>([
    ['A-2', artifactRow('A-2', 'WS-2', 'MISSING')],
    ['A-1', artifactRow('A-1', 'WS-1', 'REGISTERED')],
    ['A-3', artifactRow('A-3', 'WS-1', 'REGISTERED', 'results/fig1.png')],
  ])

  it('project scope: 全集 + 确定性 id 序 + 全状态保留（MISSING 在）', () => {
    const reader = new ArtifactRefsReader({ readArtifacts: () => rows, workstreamsInScope: () => undefined })
    const snap = reader.read({})
    expect(snap.count).toBe(3)
    expect(snap.artifacts.map((a) => a.id)).toEqual(['A-1', 'A-2', 'A-3'])
    expect(snap.artifacts.find((a) => a.id === 'A-2')!.status).toBe('MISSING')
    expect(snap.artifacts[0]!).toMatchObject({
      id: 'A-1',
      workstreamId: 'WS-1',
      type: 'DATASET',
      title: 'artifact A-1',
      uri: 'data/A-1/',
      status: 'REGISTERED',
      relatedTask: null,
      recordedAt: 1000,
    })
  })

  it('workstream scope: workstream_id 命中过滤', () => {
    const reader = new ArtifactRefsReader({ readArtifacts: () => rows, workstreamsInScope: (s) => (s.workstreamId ? [s.workstreamId] : undefined) })
    expect(reader.read({ workstreamId: 'WS-1' }).artifacts.map((a) => a.id)).toEqual(['A-1', 'A-3'])
  })

  it('topic scope: face 数组命中; 未知 topic（face null）⇒ RD_INPUT', () => {
    const reader = new ArtifactRefsReader({
      readArtifacts: () => rows,
      workstreamsInScope: (s) => (s.topicId === 'TPC-1' ? ['WS-1', 'WS-2'] : null),
    })
    expect(reader.read({ topicId: 'TPC-1' }).count).toBe(3)
    try {
      reader.read({ topicId: 'TPC-9' })
      expect.unreachable('must throw')
    } catch (e) {
      expect((e as ReaderError).code).toBe('RD_INPUT')
    }
  })

  it('readArtifacts face 抛错 ⇒ RD_ARTIFACT（cause 保留）', () => {
    const boom = new Error('derived row corrupt')
    const reader = new ArtifactRefsReader({ readArtifacts: () => { throw boom }, workstreamsInScope: () => undefined })
    try {
      reader.read({})
      expect.unreachable('must throw')
    } catch (e) {
      expect(isReaderError(e)).toBe(true)
      expect((e as ReaderError).code).toBe('RD_ARTIFACT')
      expect((e as Error).cause).toBe(boom)
    }
  })
})
