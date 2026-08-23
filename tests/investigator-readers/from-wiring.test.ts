/**
 * WP-7.2 — readers 生产组装（`createWiringReaders`）集成测试:
 * 真实 `makeWiring`（真实 temp git repo + 真实 `.research` 树 + 真实
 * `research.sqlite` + 真实冻结 schema）上的五类读者 + 组装器。
 *
 * 覆盖（生产面 — 非 stub）:
 *  - 干净仓: 五段全 ok; plugin 状态 = 树 + 折叠真值; git diff = 干净;
 *    git log = 声明式树真实历史 + HEAD; artifact refs = 空集;
 *  - session 查询: sessionlink 指针面真值（wireSession 后指针命中;
 *    未绑定 = null 诚实）;
 *  - artifact refs: 真实语义注册表（ARTIFACT_REGISTERED 事件追加后
 *    derived 行 → 读者投影; 范围过滤 ws/topic/project）;
 *  - scope 收窄（workstream scope 的 plugin 状态子集）。
 */

import { describe, expect, it } from 'vitest'

import { investigationContext } from '../../src/host/service/investigator/readers/context.js'
import { createWiringReaders } from '../../src/host/service/investigator/readers/from-wiring.js'
import { gitHead, makeClock, makeWiring, T0, type WiringBundle } from '../wiring/helpers.js'
import { makeSession } from '../runbinding/helpers.js'
import type { HistoryEventInput } from '../../src/host/persistence/store/index.js'

function seedArtifact(wiring: WiringBundle['wiring'], i: number): void {
  const evt: HistoryEventInput = {
    schemaVersion: 1,
    occurredAt: T0 + i * 1000,
    actor: { kind: 'USER', user_id: 'u-1' },
    eventId: `H-A${i}`,
    ownerWorkstreamId: 'WS-2',
    eventType: 'ARTIFACT_REGISTERED',
    payload: { artifact_id: `A-${200 + i}`, type: 'DATASET', title: `traces ${i}`, uri: `data/traces-${i}/` },
  }
  wiring.store.appendEvents([evt])
}

describe('createWiringReaders — 生产组装（真实 wiring）', () => {
  it('干净仓: 五段全 ok（树真值 + 干净 git + 空注册表）', async () => {
    const bundle = makeWiring()
    const { wiring, repoRoot } = bundle
    const readers = createWiringReaders(wiring)
    const ctx = await investigationContext({}, readers, makeClock())

    expect(ctx.pluginState.ok).toBe(true)
    if (ctx.pluginState.ok) {
      const p = ctx.pluginState.data
      expect(p.project).toMatchObject({ id: 'PRJ-1' })
      expect(p.workstreams.map((w) => w.id)).toEqual(['WS-1', 'WS-2', 'WS-3'])
      const ws1 = p.workstreams.find((w) => w.id === 'WS-1')!
      expect(ws1.tasks.map((t) => t.id)).toEqual(['T-1', 'T-2', 'T-3', 'T-4'])
      // 无事件史 ⇒ 折叠缺省 PLANNED（Current 区初始态, rpc 同口径）。
      expect(ws1.tasks[0]).toMatchObject({ execution: 'PLANNED' })
      expect(ws1.lifecycle).toBe('PLANNED')
    }
    expect(ctx.sessions.ok).toBe(true)
    if (ctx.sessions.ok) expect(ctx.sessions.data.sessions).toEqual([])
    expect(ctx.gitDiff.ok).toBe(true)
    if (ctx.gitDiff.ok) {
      expect(ctx.gitDiff.data.trackedChanges).toEqual([])
      expect(ctx.gitDiff.data.research.consistent).toBe(true)
    }
    expect(ctx.gitLog.ok).toBe(true)
    if (ctx.gitLog.ok) {
      const g = ctx.gitLog.data
      expect(g.path).toBe('.research')
      expect(g.headOid).toBe(gitHead(repoRoot))
      expect(g.entries.length).toBeGreaterThan(0)
      expect(g.maxCount).toBe(20)
    }
    expect(ctx.artifactRefs.ok).toBe(true)
    if (ctx.artifactRefs.ok) expect(ctx.artifactRefs.data.count).toBe(0)
  })

  it('workstream scope: plugin 状态收窄 + 组装透传', async () => {
    const bundle = makeWiring()
    const readers = createWiringReaders(bundle.wiring)
    const ctx = await investigationContext({ workstreamId: 'WS-1' }, readers, makeClock())
    expect(ctx.pluginState.ok).toBe(true)
    if (ctx.pluginState.ok) {
      expect(ctx.pluginState.data.workstreams.map((w) => w.id)).toEqual(['WS-1'])
      expect(ctx.pluginState.data.topics).toEqual([{ id: 'TPC-1', title: expect.any(String), workstreamIds: ['WS-1'] }])
    }
    expect(ctx.scope).toEqual({ workstreamId: 'WS-1' })
  })

  it('session 查询: sessionlink 指针面真值（绑定命中 + 未绑定 null）', async () => {
    const bundle = makeWiring()
    const { wiring, adapter, repoRoot } = bundle
    adapter.addSession(makeSession({ id: 'sess-1', cwd: repoRoot }))
    adapter.addSession(makeSession({ id: 'sess-2', cwd: repoRoot }))
    wiring.sessionLink.wireSession('sess-1', { workstreamId: 'WS-1', intent: 'probe' })

    const readers = createWiringReaders(wiring)
    const ctx = await investigationContext({}, readers, makeClock())
    expect(ctx.sessions.ok).toBe(true)
    if (!ctx.sessions.ok) return
    const entries = ctx.sessions.data.sessions
    expect(entries).toHaveLength(2)
    const bound = entries.find((e) => e.sessionId === 'sess-1')!
    expect(bound.pointer).toMatchObject({ workstreamId: 'WS-1', intent: 'probe', taskId: null })
    expect(bound.run).toBeNull() // 无 run 行（诚实 — 不虚构）
    const unbound = entries.find((e) => e.sessionId === 'sess-2')!
    expect(unbound.pointer).toBeNull()

    // workstream scope: 仅指针命中 WS-1 的 session（sess-2 未绑定 ⇒ 出局）。
    const scoped = await investigationContext({ workstreamId: 'WS-1' }, readers, makeClock())
    expect(scoped.sessions.ok).toBe(true)
    if (scoped.sessions.ok) {
      expect(scoped.sessions.data.sessions.map((s) => s.sessionId)).toEqual(['sess-1'])
    }
  })

  it('artifact refs: 真实语义注册表（事件追加 → derived 行 → 投影 + 范围过滤）', async () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    seedArtifact(wiring, 1) // A-201 @ WS-2
    seedArtifact(wiring, 2) // A-202 @ WS-2

    const readers = createWiringReaders(wiring)
    const all = await investigationContext({}, readers, makeClock())
    expect(all.artifactRefs.ok).toBe(true)
    if (!all.artifactRefs.ok) return
    expect(all.artifactRefs.data.count).toBe(2)
    expect(all.artifactRefs.data.artifacts.map((a) => a.id)).toEqual(['A-201', 'A-202'])
    expect(all.artifactRefs.data.artifacts[0]).toMatchObject({
      workstreamId: 'WS-2',
      type: 'DATASET',
      uri: 'data/traces-1/',
      status: 'REGISTERED',
    })
    // plugin 状态的语义计数面同源（artifacts=2）。
    expect(all.pluginState.ok).toBe(true)
    if (all.pluginState.ok) expect(all.pluginState.data.semantic.artifacts).toBe(2)

    // scope 过滤: WS-1 无 artifact; WS-2 全集; topic 全集。
    const ws1 = await investigationContext({ workstreamId: 'WS-1' }, readers, makeClock())
    expect(ws1.artifactRefs.ok && ws1.artifactRefs.data.count).toBe(0)
    const ws2 = await investigationContext({ workstreamId: 'WS-2' }, readers, makeClock())
    expect(ws2.artifactRefs.ok && ws2.artifactRefs.data.count).toBe(2)
    const tpc = await investigationContext({ topicId: 'TPC-1' }, readers, makeClock())
    expect(tpc.artifactRefs.ok && tpc.artifactRefs.data.count).toBe(2)
  })

  it('git log scope 路径换算（ws → 声明式 ws 目录; 未知 id = RD_INPUT 段）', async () => {
    const bundle = makeWiring()
    const readers = createWiringReaders(bundle.wiring)
    const ws = await investigationContext({ workstreamId: 'WS-1' }, readers, makeClock())
    expect(ws.gitLog.ok).toBe(true)
    if (ws.gitLog.ok) {
      expect(ws.gitLog.data.path).toBe('.research/topics/TPC-1/workstreams/WS-1')
      // 初始提交包含整个树 ⇒ 该路径有历史。
      expect(ws.gitLog.data.entries.length).toBeGreaterThan(0)
    }
    const tpc = await investigationContext({ topicId: 'TPC-1' }, readers, makeClock())
    expect(tpc.gitLog.ok).toBe(true)
    if (tpc.gitLog.ok) expect(tpc.gitLog.data.path).toBe('.research/topics/TPC-1')
    const unknown = await investigationContext({ topicId: 'TPC-9' }, readers, makeClock())
    // 未知 id = 所有范围过滤段同时大声 RD_INPUT（不猜）; git diff 是
    // workspace 级事实面（无 scope 过滤）⇒ 照常产出（隔离 + 诚实）。
    expect(unknown.gitLog).toEqual({ ok: false, error: { code: 'RD_INPUT', message: expect.stringContaining('TPC-9') } })
    expect(unknown.pluginState).toEqual({ ok: false, error: { code: 'RD_INPUT', message: expect.stringContaining('TPC-9') } })
    expect(unknown.sessions.ok).toBe(false)
    expect(unknown.artifactRefs.ok).toBe(false)
    expect(unknown.gitDiff.ok).toBe(true)
  })
})
