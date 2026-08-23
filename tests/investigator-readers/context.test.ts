/**
 * WP-7.2 — 组装器（主线目标 2）: `investigationContext` 的逐段隔离纪律。
 *
 * 覆盖:
 *  - 五段全成功（数据 + generatedAt + scope 回显）;
 *  - 单类失败 = 结构化失败段（ReaderError 机器码原样 / 非 Reader 错误
 *    = 该段兜底码）— 其余四段照常产出（绝不静默省略）;
 *  - 同步段与异步段的失败同样隔离;
 *  - 两段 git 面并发失败也不互吞。
 */

import { describe, expect, it } from 'vitest'

import { investigationContext, type InvestigationReaders } from '../../src/host/service/investigator/readers/context.js'
import { ReaderError } from '../../src/host/service/investigator/readers/types.js'
import type {
  ArtifactRefsSnapshot,
  GitDiffSnapshot,
  GitLogSnapshot,
  PluginStateSnapshot,
  SessionQuerySnapshot,
} from '../../src/host/service/investigator/readers/types.js'

const NOW = 1_700_000_000_000

const okPlugin: PluginStateSnapshot = {
  project: null,
  topics: [],
  workstreams: [],
  runs: [],
  interventions: { open: [], pending: [] },
  semantic: { claims: 0, activeClaims: 0, retractedClaims: 0, facts: 0, artifacts: 0, missingArtifacts: 0 },
}
const okSessions: SessionQuerySnapshot = { sessions: [] }
const okDiff: GitDiffSnapshot = {} as GitDiffSnapshot
const okLog: GitLogSnapshot = { path: '.research', headOid: null, entries: [], maxCount: 20 }
const okArtifacts: ArtifactRefsSnapshot = { count: 0, artifacts: [] }

function makeReaders(over: Partial<InvestigationReaders> = {}): InvestigationReaders {
  return {
    pluginState: { read: () => okPlugin },
    sessions: { read: () => okSessions },
    gitDiff: { read: async () => okDiff },
    gitLog: { read: async () => okLog },
    artifactRefs: { read: () => okArtifacts },
    ...over,
  }
}

describe('investigationContext — 组装器', () => {
  it('五段全成功: 数据齐 + generatedAt（注入时钟）+ scope 回显', async () => {
    const ctx = await investigationContext({ workstreamId: 'WS-1' }, makeReaders(), () => NOW)
    expect(ctx.generatedAt).toBe(NOW)
    expect(ctx.scope).toEqual({ workstreamId: 'WS-1' })
    expect(ctx.pluginState).toEqual({ ok: true, data: okPlugin })
    expect(ctx.sessions).toEqual({ ok: true, data: okSessions })
    expect(ctx.gitDiff).toEqual({ ok: true, data: okDiff })
    expect(ctx.gitLog).toEqual({ ok: true, data: okLog })
    expect(ctx.artifactRefs).toEqual({ ok: true, data: okArtifacts })
  })

  it('同步段失败（ReaderError）= 结构化失败段, 其余四段照常', async () => {
    const boom = new ReaderError('RD_STATE', 'pluginState: the readTree face failed: tree exploded')
    const ctx = await investigationContext({}, makeReaders({ pluginState: { read: () => { throw boom } } }), () => NOW)
    expect(ctx.pluginState).toEqual({ ok: false, error: { code: 'RD_STATE', message: boom.message } })
    expect(ctx.sessions.ok).toBe(true)
    expect(ctx.gitDiff.ok).toBe(true)
    expect(ctx.gitLog.ok).toBe(true)
    expect(ctx.artifactRefs.ok).toBe(true)
  })

  it('同步段失败（非 ReaderError）= 该段兜底机器码（大声, 不吞）', async () => {
    const ctx = await investigationContext({}, makeReaders({ sessions: { read: () => { throw new Error('adapter down') } } }), () => NOW)
    expect(ctx.sessions).toEqual({ ok: false, error: { code: 'RD_SESSION', message: 'adapter down' } })
    expect(ctx.pluginState.ok).toBe(true)
  })

  it('异步段失败（ReaderError / 裸错误）= 隔离失败段, 同步段不受影响', async () => {
    const ctx = await investigationContext(
      {},
      makeReaders({
        gitDiff: { read: async () => { throw new ReaderError('RD_GIT_DIFF', 'gitDiff: not a git repository') } },
        gitLog: { read: async () => { throw new Error('git wrapper exploded') } },
      }),
      () => NOW,
    )
    expect(ctx.gitDiff).toEqual({ ok: false, error: { code: 'RD_GIT_DIFF', message: 'gitDiff: not a git repository' } })
    expect(ctx.gitLog).toEqual({ ok: false, error: { code: 'RD_GIT_LOG', message: 'git wrapper exploded' } })
    expect(ctx.pluginState.ok).toBe(true)
    expect(ctx.sessions.ok).toBe(true)
    expect(ctx.artifactRefs.ok).toBe(true)
  })

  it('五段全失败也不抛（组装器永不因读者失败 abort — 聚合本身是查询面）', async () => {
    const fail = () => { throw new ReaderError('RD_INPUT', 'bad scope') }
    const ctx = await investigationContext({}, makeReaders({
      pluginState: { read: fail },
      sessions: { read: fail },
      gitDiff: { read: async () => { throw new ReaderError('RD_INPUT', 'bad scope') } },
      gitLog: { read: async () => { throw new ReaderError('RD_INPUT', 'bad scope') } },
      artifactRefs: { read: fail },
    }), () => NOW)
    expect(ctx.pluginState.ok).toBe(false)
    expect(ctx.sessions.ok).toBe(false)
    expect(ctx.gitDiff.ok).toBe(false)
    expect(ctx.gitLog.ok).toBe(false)
    expect(ctx.artifactRefs.ok).toBe(false)
    expect(ctx.generatedAt).toBe(NOW)
  })

  it('scope 回显 = 冻结副本（调用方后续修改不影响聚合）', async () => {
    const scope: { topicId?: string } = { topicId: 'TPC-1' }
    const ctx = await investigationContext(scope, makeReaders(), () => NOW)
    delete scope.topicId
    expect(ctx.scope).toEqual({ topicId: 'TPC-1' })
  })
})
