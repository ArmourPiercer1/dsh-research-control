/**
 * WP-2.4 — permission surface (task goal: 「权限（Agent 无 BIND 路径——
 * 类型面断言不存在 agent-facing 绑定 API）」; ARCHITECTURE §6 权限矩阵;
 * INV-PERM-1/2).
 *
 * Three layers, matching the §6 matrix rows:
 *
 *  1. TYPE SURFACE (compile-time): the DiscoveredSession lifecycle
 *     operations (BIND/DETACH/IGNORE) take `UserActorRef` — an AGENT or
 *     PLUGIN actor literal is a COMPILE ERROR on that surface
 *     (`@ts-expect-error` below). The matrix gives the agent NO lane for
 *     session-binding operations (the agent's Run lane is the checkpoint
 *     report only — INV-PERM-1 「Run checkpoint 报告」).
 *
 *  2. RUNTIME SURFACE: forged non-USER actors (a JS caller bypassing the
 *     types) are rejected with RB_ACTOR_FORBIDDEN before any write.
 *
 *  3. MODULE SURFACE AUDIT: the runbinding module exports NO agent-facing
 *     binding API — no exported name and no service method matches the
 *     agent/tool namespaces (the agent tools land in src/host/tools, a
 *     separate WP, and per the matrix they carry no bind path).
 *
 *  4. EMITTER MATRIX CROSS-CHECK: the registry metadata for the RUN_*
 *     events matches the frozen catalog §4 E column verbatim — the
 *     wiring's emitter enforcement is the frozen matrix, not a local
 *     re-statement.
 */
import { describe, expect, it } from 'vitest'

import * as runbinding from '../../src/host/service/runbinding/index.js'
import { RunBindingError } from '../../src/host/service/runbinding/index.js'
import type { EmitterKind, HistoryEventType } from '../../src/host/history/registry/index.js'
import type {
  BindParams,
  UserActorRef,
} from '../../src/host/service/runbinding/index.js'
import { makeHarness, seedPendingDs, USER } from './helpers.js'

function expectCode(e: unknown, code: string): asserts e is RunBindingError {
  if (!(e instanceof RunBindingError) || e.code !== code) {
    throw new Error(`expected RunBindingError(${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}

describe('type surface: no agent-facing bind path (compile-time)', () => {
  it('bind/detach/ignore actor parameters are UserActorRef (AGENT/PLUGIN do not typecheck)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'perm-ts' })
    const params: BindParams = { workstreamId: 'WS-1' }
    const actor: UserActorRef = USER

    // The USER lane compiles:
    const ok = h.service.bindDiscoveredSession(ds.id, params, actor)
    expect(ok.ds.state).toBe('BOUND')

    // The AGENT lane does NOT (the matrix has no agent row for session
    // binding — INV-PERM-1's agent write set stops at the checkpoint).
    // The AGENT lane does NOT compile, AND the runtime guard catches a
    // forged actor (a JS caller bypassing the types):
    try {
      // @ts-expect-error AGENT actor is not assignable to UserActorRef (no agent-facing bind API)
      const agentBind: unknown = h.service.bindDiscoveredSession(ds.id, params, { kind: 'AGENT', run_id: 'R-1' })
      void agentBind
    } catch (e) {
      expectCode(e, 'RB_ACTOR_FORBIDDEN')
    }
    try {
      // @ts-expect-error PLUGIN actor is not assignable to UserActorRef (same surface)
      const pluginDetach: unknown = h.service.detachDiscoveredSession(ds.id, { kind: 'PLUGIN' })
      void pluginDetach
    } catch (e) {
      expectCode(e, 'RB_ACTOR_FORBIDDEN')
    }
    // …and nothing was written by either attempt.
    expect(h.service.listRuns()).toHaveLength(1) // only the USER bind above
    h.close()
  })

  it('the Run-lifecycle actor parameter is the wider RunLifecycleActorRef (U/A/P per the frozen matrix)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    // AGENT with a valid run_id compiles (the registry enforces the rest):
    h.service.finishRun(a.run.id, {}, { kind: 'AGENT', run_id: a.run.id })
    h.close()
  })
})

describe('runtime surface: forged actors are rejected before any write', () => {
  it('BIND refuses AGENT and PLUGIN actors (RB_ACTOR_FORBIDDEN)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'perm-rt' })
    for (const forged of [
      { kind: 'AGENT', run_id: 'R-1' },
      { kind: 'PLUGIN', label: 'bot' },
      { kind: 'SYSTEM' },
      {},
      null,
    ] as never[]) {
      try {
        h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1' }, forged)
        throw new Error('expected rejection')
      } catch (e) {
        expectCode(e, 'RB_ACTOR_FORBIDDEN')
      }
      expect(h.service.getDiscoveredSession(ds.id)?.state).toBe('PENDING')
      expect(h.service.listRuns()).toHaveLength(0)
    }
    h.close()
  })

  it('DETACH/IGNORE refuse non-USER actors the same way', () => {
    const h = makeHarness()
    const a = seedPendingDs(h, { sessionId: 'perm-rt-2' })
    const b = seedPendingDs(h, { sessionId: 'perm-rt-3' })
    try {
      h.service.detachDiscoveredSession(a.id, { kind: 'AGENT', run_id: 'R-1' } as never)
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_ACTOR_FORBIDDEN')
    }
    try {
      h.service.ignoreDiscoveredSession(b.id, { kind: 'PLUGIN' } as never)
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_ACTOR_FORBIDDEN')
    }
    expect(h.service.getDiscoveredSession(a.id)?.state).toBe('PENDING')
    expect(h.service.getDiscoveredSession(b.id)?.state).toBe('PENDING')
    h.close()
  })

  it('recordCheckpoint: AGENT is the matrix lane (checkpoint 报告), PLUGIN/SYSTEM are not', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    // AGENT with a run_id: the checkpoint-report lane (compiles + runs).
    const updated = h.service.recordCheckpoint(a.run.id, { note: 'agent report' }, { kind: 'AGENT', run_id: a.run.id })
    expect(updated.last_checkpoint_note).toBe('agent report')
    for (const forged of [{ kind: 'PLUGIN' }, { kind: 'SYSTEM' }] as never[]) {
      try {
        h.service.recordCheckpoint(a.run.id, { note: 'x' }, forged)
        throw new Error('expected rejection')
      } catch (e) {
        expectCode(e, 'RB_ACTOR_FORBIDDEN')
      }
    }
    h.close()
  })
})

describe('module surface audit: no agent-facing binding API is exported', () => {
  it('no exported name (function/type/const) sits in the agent/tool namespace', () => {
    const names = Object.keys(runbinding)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(/(agent|tool|investigator)/i.test(name), `unexpected agent-facing export: ${name}`).toBe(false)
    }
  })

  it('the service prototype has no agent-facing binding methods', () => {
    const methods = Object.getOwnPropertyNames(runbinding.RunBindingService.prototype).filter((n) => n !== 'constructor')
    for (const name of methods) {
      expect(/(agent|tool|investigator)/i.test(name), `unexpected agent-facing method: ${name}`).toBe(false)
    }
    // The DS lifecycle methods are the USER-bound surface (names + count pinned).
    for (const expected of [
      'bindDiscoveredSession',
      'detachDiscoveredSession',
      'ignoreDiscoveredSession',
      'registerRun',
      'finishRun',
      'failRun',
      'cancelRun',
      'recordCheckpoint',
      'getRun',
      'listRuns',
      'listDiscoveredSessions',
      'getDiscoveredSession',
      'findDiscoveredSessionBySessionId',
      'reconcileSessions',
      'startDiscovery',
    ]) {
      expect(methods, `missing service method ${expected}`).toContain(expected)
    }
  })
})

describe('emitter matrix cross-check (the frozen catalog §4 E column, verbatim)', () => {
  it('RUN_* emitters in the registry match the frozen matrix (U/A/P per event)', () => {
    const h = makeHarness()
    const expectEmitters = (type: HistoryEventType, expected: readonly EmitterKind[]): void => {
      const entry = h.registry.events.get(type)
      expect(entry, `registry entry for ${type}`).toBeDefined()
      expect([...entry!.emitters].sort()).toEqual([...expected].sort())
    }
    // HISTORY_EVENT_CATALOG §4 总表 (E column):
    expectEmitters('RUN_STARTED', ['USER', 'AGENT', 'PLUGIN'])
    expectEmitters('RUNS_STARTED', ['USER', 'PLUGIN'])
    expectEmitters('RUN_FINISHED', ['USER', 'AGENT', 'PLUGIN'])
    expectEmitters('RUN_FAILED', ['USER', 'AGENT', 'PLUGIN'])
    expectEmitters('RUN_CANCELLED', ['USER', 'AGENT'])
    h.close()
  })
})
