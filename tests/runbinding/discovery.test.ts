/**
 * WP-2.4 — DiscoveredSession discovery (TC-DSH-001; DOMAIN_SCHEMA §6.2
 * 规则; DSH_ADAPTER §7/§8/§11; U9 seam per DSH_ADAPTER §13-U9 fallback).
 *
 * Covered here:
 *  - cwd attribution: exact root match, nested-under-root containment,
 *    external-workspace 忽略, missing cwd 忽略, sibling-prefix trap
 *    (DSH_ADAPTER §8 canonical comparison — the trailing-separator
 *    guard), non-existent cwd (resolve fallback);
 *  - reconcile idempotency (no re-discovery, TC-DSH-001/003);
 *  - the push surface `startDiscovery` over the FakeSessionAdapter:
 *    initial full pass + the `created` edge; the disposer is exact;
 *  - the §6.2 three-way rule through the U9 seam: default resolver
 *    (always null) → PENDING (the frozen fallback); an injected
 *    resolver → auto-registered BOUND DS + Run + RUN_STARTED
 *    (matrix P, 「session 绑定自动登记」).
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll } from 'vitest'

import { queryEvents } from '../../src/host/history/replay/index.js'
import {
  RunBindingError,
  matchWorkspaceRoot,
  NO_RESEARCH_CONTEXT,
  type ResearchContextResolver,
} from '../../src/host/service/runbinding/index.js'
import {
  FakeSessionAdapter,
  makeHarness,
  makeSession,
  seedPendingDs,
} from './helpers.js'

const tmpRoots: string[] = []
function extraTempDir(prefix = 'wp24d-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmpRoots.push(d)
  return d
}
afterAll(() => {
  for (const r of tmpRoots) rmSync(r, { recursive: true, force: true })
})

function expectCode(e: unknown, code: string): asserts e is RunBindingError {
  if (!(e instanceof RunBindingError) || e.code !== code) {
    throw new Error(`expected RunBindingError(${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}

describe('cwd attribution (DSH_ADAPTER §8 canonical containment)', () => {
  it('matches an exact root, a nested cwd, and rejects external/sibling paths', () => {
    const h = makeHarness()
    const nested = join(h.rootA, 'sub', 'deep')
    mkdirSync(nested, { recursive: true })
    const external = extraTempDir()
    const sibling = join(h.dir, 'ws-a-sibling')
    mkdirSync(sibling)

    expect(matchWorkspaceRoot(h.rootA, [h.rootA, h.rootB])).toBe(h.rootA)
    expect(matchWorkspaceRoot(nested, [h.rootA, h.rootB])).toBe(h.rootA)
    expect(matchWorkspaceRoot(external, [h.rootA, h.rootB])).toBeNull()
    // The sibling-prefix trap: 'ws-a-sibling' must NOT match 'ws-a'.
    expect(matchWorkspaceRoot(sibling, [h.rootA, h.rootB])).toBeNull()
    expect(matchWorkspaceRoot(undefined, [h.rootA, h.rootB])).toBeNull()
    expect(matchWorkspaceRoot('', [h.rootA, h.rootB])).toBeNull()
    expect(matchWorkspaceRoot(h.rootA, [])).toBeNull()
    h.close()
  })

  it('attributes a vanished cwd by resolve() fallback (no crash)', () => {
    const h = makeHarness()
    const gone = join(h.rootA, 'deleted-subdir')
    mkdirSync(gone, { recursive: true })
    rmSync(gone, { recursive: true })
    expect(matchWorkspaceRoot(gone, [h.rootA, h.rootB])).toBe(h.rootA)
    h.close()
  })
})

describe('reconcileSessions (TC-DSH-001: 注册 workspace 内无 context → DiscoveredSession(PENDING))', () => {
  it('creates a PENDING row for an in-root session with the attribution fields', () => {
    const h = makeHarness()
    const tBefore = h.now()
    const created = h.service.reconcileSessions([
      makeSession({ id: 'sess-disc-1', cwd: h.rootA, title: 'a session title' }),
    ])
    expect(created).toHaveLength(1)
    const ds = created[0]!
    expect(ds.state).toBe('PENDING')
    expect(ds.dsh_session_id).toBe('sess-disc-1')
    expect(ds.workspace_root).toBe(h.rootA)
    expect(ds.discovered_at).toBeGreaterThanOrEqual(tBefore)
    expect(ds.summary).toBe('a session title')
    expect(ds.bound_run_id).toBeUndefined()
    expect(ds.id).toMatch(/^DS-[1-9][0-9]*$/)
    expect(h.service.findDiscoveredSessionBySessionId('sess-disc-1')?.id).toBe(ds.id)
    h.close()
  })

  it('skips external sessions and cwd-less sessions (外部 workspace → 忽略)', () => {
    const h = makeHarness()
    const external = extraTempDir()
    const created = h.service.reconcileSessions([
      makeSession({ id: 'sess-ext-1', cwd: external }),
      makeSession({ id: 'sess-nocwd-1' }),
      makeSession({ id: 'sess-in-1', cwd: h.rootB }),
    ])
    expect(created.map((d) => d.dsh_session_id)).toEqual(['sess-in-1'])
    expect(created[0]!.workspace_root).toBe(h.rootB)
    expect(h.service.listDiscoveredSessions()).toHaveLength(1)
    h.close()
  })

  it('is idempotent: re-reconcile creates nothing (TC-DSH-003 no re-discovery)', () => {
    const h = makeHarness()
    const session = makeSession({ id: 'sess-idem-1', cwd: h.rootA })
    expect(h.service.reconcileSessions([session])).toHaveLength(1)
    expect(h.service.reconcileSessions([session])).toHaveLength(0)
    expect(h.service.reconcileSessions([session, session])).toHaveLength(0)
    expect(h.service.listDiscoveredSessions()).toHaveLength(1)
    h.close()
  })

  it('never resurrects DETACHED/IGNORED/BOUND rows (TC-DSH-003)', () => {
    const h = makeHarness()
    const a = seedPendingDs(h, { sessionId: 'sess-nr-a' })
    const b = seedPendingDs(h, { sessionId: 'sess-nr-b' })
    const c = seedPendingDs(h, { sessionId: 'sess-nr-c' })
    const d = seedPendingDs(h, { sessionId: 'sess-nr-d' })
    h.service.detachDiscoveredSession(a.id)
    h.service.ignoreDiscoveredSession(b.id)
    h.service.bindDiscoveredSession(c.id, { workstreamId: 'WS-1' })
    h.service.finishRun(h.service.getDiscoveredSession(c.id)!.bound_run_id!)

    const created = h.service.reconcileSessions([
      makeSession({ id: 'sess-nr-a', cwd: h.rootA }),
      makeSession({ id: 'sess-nr-b', cwd: h.rootA }),
      makeSession({ id: 'sess-nr-c', cwd: h.rootA }),
      makeSession({ id: 'sess-nr-d', cwd: h.rootA }),
    ])
    expect(created).toHaveLength(0)
    expect(h.service.listDiscoveredSessions()).toHaveLength(4)
    h.close()
  })

  it('rejects a malformed session row (RB_INPUT) without partial writes', () => {
    const h = makeHarness()
    expect(() => h.service.reconcileSessions([null as never])).toThrowError(RunBindingError)
    expect(h.service.listDiscoveredSessions()).toHaveLength(0)
    h.close()
  })
})

describe('startDiscovery (push surface over the DshSessionAdapter port)', () => {
  it('runs the initial full pass and the created edge; disposer is exact', () => {
    const h = makeHarness()
    const adapter = new FakeSessionAdapter([makeSession({ id: 'sess-p-1', cwd: h.rootA })])
    const dispose = h.service.startDiscovery(adapter)

    // Initial pass discovered the pre-existing session.
    expect(h.service.findDiscoveredSessionBySessionId('sess-p-1')?.state).toBe('PENDING')

    // A new session created after the start is discovered on its edge.
    adapter.addSession(makeSession({ id: 'sess-p-2', cwd: h.rootB }))
    adapter.emitCreated('sess-p-2')
    expect(h.service.findDiscoveredSessionBySessionId('sess-p-2')?.state).toBe('PENDING')

    // The disposed edge changes nothing (rows persist).
    adapter.emitDisposed('sess-p-1')
    expect(h.service.findDiscoveredSessionBySessionId('sess-p-1')?.state).toBe('PENDING')

    // After dispose, edges are no longer observed (exact rollback).
    dispose()
    adapter.addSession(makeSession({ id: 'sess-p-3', cwd: h.rootA }))
    adapter.emitCreated('sess-p-3')
    expect(h.service.findDiscoveredSessionBySessionId('sess-p-3')).toBeNull()
    h.close()
  })

  it('reconcile is the pull half the host wiring calls on reset (idempotent full pass)', () => {
    const h = makeHarness()
    const adapter = new FakeSessionAdapter()
    const dispose = h.service.startDiscovery(adapter)
    expect(h.service.listDiscoveredSessions()).toHaveLength(0)
    adapter.addSession(makeSession({ id: 'sess-r-1', cwd: h.rootA }))
    // No edge fired (simulated reset) — the wiring's explicit reconcile picks it up.
    expect(h.service.reconcileSessions(adapter.listSessions())).toHaveLength(1)
    dispose()
    h.close()
  })
})

describe('the §6.2 three-way rule through the U9 seam (researchContextResolver)', () => {
  it('V1 default resolver = always null → PENDING (the frozen U9 fallback)', () => {
    expect(NO_RESEARCH_CONTEXT(makeSession({ id: 'x' }))).toBeNull()
    const h = makeHarness()
    const created = h.service.reconcileSessions([
      makeSession({ id: 'sess-uc-1', cwd: h.rootA, agentPreset: 'research-WS-1' }),
    ])
    // Even a research-flavored preset name yields NO auto-registration in
    // V1 (no native carrier — the U9 结论): the session is a plain DS.
    expect(created).toHaveLength(1)
    expect(created[0]!.state).toBe('PENDING')
    h.close()
  })

  // TC-DSH-002 (TEST_MATRIX L179: 「绑定即 Run：显式 ResearchContext/
  // workstream -> 自动注册 formal Run（含 workstream_id）」). V1 载体依
  // U9 定案为注入式 seam（真实载体缺位，见 WP-2.4 报告 U9 节）——the
  // WP-2.4 报告 U9 节）— the test covers the seam level (injected resolver
  // activates §6.2 规则 1 without a service API change); no real-host
  // carrier exists in V1, and none is claimed here.
  it('an injected resolver auto-registers: BOUND DS + Run + RUN_STARTED (matrix P, 规则 1) [TC-DSH-002]', () => {
    const resolver: ResearchContextResolver = (session) =>
      session.title === 'research:WS-1'
        ? { workstreamId: 'WS-1', taskId: 'T-1', intent: 'auto from research context' }
        : null
    const h = makeHarness({ researchContextResolver: resolver })

    const created = h.service.reconcileSessions([
      makeSession({ id: 'sess-auto-1', cwd: h.rootA, title: 'research:WS-1' }),
      makeSession({ id: 'sess-auto-2', cwd: h.rootA, title: 'ordinary' }),
    ])
    expect(created).toHaveLength(2)
    const auto = created.find((d) => d.dsh_session_id === 'sess-auto-1')!
    const plain = created.find((d) => d.dsh_session_id === 'sess-auto-2')!
    expect(plain.state).toBe('PENDING')

    // The auto-registered session is straight BOUND with its run.
    expect(auto.state).toBe('BOUND')
    expect(auto.bound_run_id).toBeDefined()
    const run = h.service.getRun(auto.bound_run_id!)!
    expect(run.status).toBe('RUNNING')
    expect(run.workstream_id).toBe('WS-1')
    expect(run.task_id).toBe('T-1')
    expect(run.dsh_session_id).toBe('sess-auto-1')
    expect(run.initiated_by.kind).toBe('PLUGIN')

    // The RUN_STARTED landed with a PLUGIN actor (matrix P column).
    const events = queryEvents(h.store, 'WS-1').events
    expect(events.map((e) => e.eventType)).toEqual(['RUN_STARTED'])
    expect(events[0]!.actor).toEqual(run.initiated_by)
    expect(events[0]!.payload).toMatchObject({ run_id: run.id, dsh_session_id: 'sess-auto-1' })
    expect(events[0]!.source).toEqual({ kind: 'DSH_SESSION', session_id: 'sess-auto-1' })
    h.close()
  })

  it('an auto-register failure rejects loudly and leaves the session undiscovered (no partial row)', () => {
    const resolver: ResearchContextResolver = (session) =>
      session.title === 'research:WS-1' ? { workstreamId: 'WS-99' } : null // unknown WS
    const h = makeHarness({ researchContextResolver: resolver })
    try {
      h.service.reconcileSessions([makeSession({ id: 'sess-auto-3', cwd: h.rootA, title: 'research:WS-1' })])
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_WORKSTREAM_NOT_FOUND')
    }
    // No DS row, no run, no event (the check precedes every write).
    expect(h.service.listDiscoveredSessions()).toHaveLength(0)
    expect(h.service.listRuns()).toHaveLength(0)
    expect(queryEvents(h.store, 'WS-1').events).toHaveLength(0)
    h.close()
  })
})
