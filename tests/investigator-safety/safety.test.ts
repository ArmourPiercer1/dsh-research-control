/**
 * R3 unit surface — the investigator SAFETY row decision table.
 *
 * Scope (the reviewer's admission-guard framing): these tests pin the
 * PURE decision (deny strings / pass-through) and the visibility
 * subscription. The registry-level effects (guard evaluated after
 * approval, restrict masking, scope-chain coverage, generation detach)
 * are asserted against the real tools service in
 * tests/investigator/investigator-safety-lifecycle.test.ts (mounted
 * preset harness) — never faked into a green here.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  INVESTIGATOR_DENY_PREFIX,
  INVESTIGATOR_WRITER_TOOL_NAMES,
  installWriterVisibility,
  makeInvestigatorSafetyGuard,
  readConfinement,
  requestsSandboxWidening,
  type ConfinementSources,
  type SafetyContext,
  type SafetyExecution,
  type SafetyToolsFace,
} from '../../src/host/dsh-adapter/investigator-safety/index.js'

const session = { id: 's-1' }
const writer = INVESTIGATOR_WRITER_TOOL_NAMES[0]!
const exec = (name: string, overrides: Partial<SafetyExecution> = {}): SafetyExecution => ({
  name,
  arguments: {},
  agent: { session },
  ...overrides,
})
const confined: ConfinementSources = {
  sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) },
  shell: { sandboxMode: 'read-only' },
}

describe('investigator safety guard — admission decisions', () => {
  it('denies every writer WHETHER REGISTERED OR NOT (the guard never consults registration)', () => {
    const guard = makeInvestigatorSafetyGuard(() => confined)
    for (const name of INVESTIGATOR_WRITER_TOOL_NAMES) {
      const denial = guard(exec(name))
      expect(denial, name).toContain(INVESTIGATOR_DENY_PREFIX)
      expect(denial, name).toContain('write capability')
    }
    // an unregistered writer name is denied exactly the same way
    expect(guard(exec('research_not_even_registered'))).toBeUndefined() // not a writer → passes the writer test
    expect(guard(exec(writer))).toContain('write capability')
  })

  it('leaves the 4 readers (and all non-writers) alone under confinement', () => {
    const guard = makeInvestigatorSafetyGuard(() => confined)
    expect(guard(exec('research_project_read'))).toBeUndefined()
    expect(guard(exec('fs_read'))).toBeUndefined()
  })

  it('bash sandbox_permissions WIDENING is refused with its own reason, FIRST (ask does not ceiling the sandbox)', () => {
    const guard = makeInvestigatorSafetyGuard(() => ({
      // confinement BROKEN: the widening refusal must still be the first,
      // honest reason — the request itself disqualifies.
      sandboxPolicy: undefined,
      shell: undefined,
    }))
    const denial = guard(exec('bash', { arguments: { command: 'echo', sandbox_permissions: 'danger-full-access' } }))
    expect(denial).toContain('WIDENING')
    expect(denial).toContain('never widens')
    // no request → the plain writer refusal (below the confinement failure here)
    const plain = guard(exec('bash', { arguments: { command: 'echo' } }))
    expect(plain).toContain('sandboxPolicy service is missing')
  })

  it('fails closed on EVERY weak evidence state — writers AND readers refused', () => {
    const cases: ReadonlyArray<[string, ConfinementSources, string]> = [
      ['sandboxPolicy missing', { sandboxPolicy: undefined, shell: { sandboxMode: 'read-only' } }, 'sandboxPolicy service is missing'],
      ['shell missing', { sandboxPolicy: confined.sandboxPolicy, shell: undefined }, 'confining shell executor is missing'],
      ['shell does not sandbox (undefined mode)', { sandboxPolicy: confined.sandboxPolicy, shell: { sandboxMode: undefined } }, 'no sandboxMode'],
      ['resolve throws', { sandboxPolicy: { resolve: () => { throw new Error('projection exploded') } }, shell: { sandboxMode: 'read-only' } }, 'projection exploded'],
      ['effective mode workspace-write', { sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) }, shell: { sandboxMode: 'workspace-write' } }, 'not "read-only"'],
      ['effective mode undefined', { sandboxPolicy: { resolve: () => ({}) }, shell: { sandboxMode: 'read-only' } }, 'not "read-only"'],
    ]
    for (const [label, sources, reason] of cases) {
      const guard = makeInvestigatorSafetyGuard(() => sources)
      expect(guard(exec('research_project_read')), label).toContain(reason)
      expect(guard(exec('research_project_read')), label).toContain('fail closed')
      expect(guard(exec(writer)), label).toContain(reason)
    }
  })

  it('agent/session-less admissions fail closed (no session = no proof)', () => {
    const guard = makeInvestigatorSafetyGuard(() => confined)
    expect(guard(exec('fs_read', { agent: undefined }))).toContain('no agent session')
    expect(guard(exec('fs_read', { agent: {} }))).toContain('no agent session')
  })

  it('confinement is LIVE-READ per admission (no caching between calls)', () => {
    let sources: ConfinementSources = confined
    const guard = makeInvestigatorSafetyGuard(() => sources)
    expect(guard(exec('fs_read'))).toBeUndefined()
    sources = { sandboxPolicy: undefined, shell: { sandboxMode: 'read-only' } } // service loss mid-session
    expect(guard(exec('fs_read'))).toContain('sandboxPolicy service is missing')
    sources = { sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) }, shell: { sandboxMode: 'read-only' } } // durable widening event
    expect(guard(exec('fs_read'))).toContain('not "read-only"')
  })

  it('readConfinement passes ONLY the exact all-evidence state', () => {
    expect(readConfinement(confined, exec('x'))).toBeUndefined()
    expect(readConfinement({ sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) }, shell: { sandboxMode: 'danger-full-access' } }, exec('x'))).toBeUndefined() // executor DEFAULT irrelevant — session mode is the live authority (launcher PRESERVED case)
    expect(readConfinement({ sandboxPolicy: confined.sandboxPolicy, shell: { sandboxMode: 'read-only' } }, exec('x', { agent: { session: undefined } }))).toBeDefined()
  })

  it('requestsSandboxWidening is narrow: bash + present sandbox_permissions only', () => {
    expect(requestsSandboxWidening(exec('bash', { arguments: { sandbox_permissions: 'workspace-write' } }))).toBe(true)
    expect(requestsSandboxWidening(exec('bash', { arguments: { sandbox_permissions: undefined } }))).toBe(false)
    expect(requestsSandboxWidening(exec('bash', { arguments: 'not-an-object' }))).toBe(false)
    expect(requestsSandboxWidening(exec('pwsh', { arguments: { sandbox_permissions: 'workspace-write' } }))).toBe(false) // pwsh is a writer anyway
  })
})

describe('writer visibility — ONE generation-owned tools/change subscription', () => {
  interface FakeTools extends SafetyToolsFace {
    restrictCalls: Array<readonly string[]>
    disposeCounts: number[]
    registered: Set<string>
  }
  const makeCtx = (registered: Iterable<string>) => {
    const events: Array<{ event: string; listener: () => void }> = []
    const tools: FakeTools = {
      restrictCalls: [],
      disposeCounts: [],
      registered: new Set(registered),
      guard: () => () => {},
      restrict: (filter) => {
        tools.restrictCalls.push([...(filter.deny ?? [])])
        tools.disposeCounts.push(0)
        return () => {
          tools.disposeCounts[tools.disposeCounts.length - 1] = (tools.disposeCounts[tools.disposeCounts.length - 1] ?? 0) + 1
        }
      },
      get: (name) => (tools.registered.has(name) ? { name } : undefined),
    }
    const ctx: SafetyContext = {
      tools,
      get: () => undefined,
      on: (event, listener) => {
        events.push({ event, listener })
        return () => {
          const i = events.findIndex((e) => e.listener === listener)
          if (i >= 0) events.splice(i, 1)
        }
      },
      off: (event, listener) => {
        const i = events.findIndex((e) => e.event === event && e.listener === listener)
        if (i >= 0) events.splice(i, 1)
      },
    }
    return { ctx, tools, events, fire: () => events.filter((e) => e.event === 'tools/change').forEach((e) => e.listener()) }
  }

  it('masks EXACTLY the present intersection on install (restrict throws on unknown names — never hand it absent writers)', () => {
    const present = INVESTIGATOR_WRITER_TOOL_NAMES.slice(0, 3)
    const { ctx, tools } = makeCtx(present)
    installWriterVisibility(ctx)
    expect(tools.restrictCalls).toHaveLength(1)
    expect([...tools.restrictCalls[0]!].sort()).toEqual([...present].sort())
  })

  it('re-applies on registry churn and NEVER re-enters when the set is unchanged (restrict itself emits change)', () => {
    const { ctx, tools, fire } = makeCtx([INVESTIGATOR_WRITER_TOOL_NAMES[0]!])
    installWriterVisibility(ctx)
    expect(tools.restrictCalls).toHaveLength(1)
    // `restrict` itself emitted a change — firing the event with an
    // unchanged set must NOT call restrict again (fence).
    fire()
    fire()
    expect(tools.restrictCalls).toHaveLength(1)
    // a writer appears → exactly one re-apply disposing the old restriction
    tools.registered.add(INVESTIGATOR_WRITER_TOOL_NAMES[1]!)
    fire()
    expect(tools.restrictCalls).toHaveLength(2)
    expect([...tools.restrictCalls[1]!].sort()).toEqual([INVESTIGATOR_WRITER_TOOL_NAMES[0]!, INVESTIGATOR_WRITER_TOOL_NAMES[1]!].sort())
    expect(tools.disposeCounts[0]).toBe(1) // the previous restriction was lifted before the new one
  })

  it('nothing registered ⇒ no restriction call at all, and the disposer detaches listener + restriction', () => {
    const { ctx, tools, events, fire } = makeCtx([INVESTIGATOR_WRITER_TOOL_NAMES[0]!])
    const dispose = installWriterVisibility(ctx)
    expect(tools.restrictCalls).toHaveLength(1)
    dispose()
    expect(tools.disposeCounts[0]).toBe(1)
    fire() // stale event must be a no-op (listener removed)
    expect(tools.restrictCalls).toHaveLength(1)
    expect(events.filter((e) => e.event === 'tools/change')).toHaveLength(0)
  })
})

describe('safety plugin class — row wiring', () => {
  it('static inject is tools ONLY (mounts even when the sandbox stack is missing)', async () => {
    const mod = await import('../../src/host/dsh-adapter/investigator-safety/index.js')
    expect((mod.default as unknown as { inject?: readonly string[] }).inject).toEqual(['tools'])
  })

  it('[Service.init] installs guard + visibility and the returned disposer detaches both', async () => {
    const mod = await import('../../src/host/dsh-adapter/investigator-safety/index.js')
    const Row = mod.default as unknown as new (ctx: SafetyContext) => { [Symbol: symbol]: unknown }
    const guardDispose = vi.fn()
    const restrictDispose = vi.fn()
    const tools: SafetyToolsFace = {
      guard: (g) => {
        lastGuard = g
        return guardDispose
      },
      restrict: () => restrictDispose,
      get: () => undefined,
    }
    let lastGuard: ((execution: SafetyExecution) => string | undefined) | undefined
    const ctx: SafetyContext = {
      tools,
      get: (name) =>
        name === 'sandboxPolicy'
          ? { resolve: () => ({ mode: 'read-only' }) }
          : name === 'shell'
            ? { sandboxMode: 'read-only' }
            : undefined,
    }
    const row = new Row(ctx)
    const initKey = Object.getOwnPropertySymbols(Row.prototype).find((s) => String(s).includes('init'))
    expect(initKey, '[Service.init] symbol method').toBeDefined()
    const initFn = (row as unknown as Record<symbol, () => unknown>)[initKey!]
    const dispose = initFn.call(row) as () => void // cordis invokes the init bound to the instance
    expect(typeof dispose).toBe('function')
    expect(lastGuard, 'guard registered on the preset-generation ctx').toBeDefined()
    // the installed guard is THE decision function: writer denied under confinement
    expect(
      lastGuard?.({ name: INVESTIGATOR_WRITER_TOOL_NAMES[0]!, arguments: {}, agent: { session } }),
    ).toContain('write capability')
    dispose()
    expect(guardDispose).toHaveBeenCalledTimes(1)
    // no writers registered → visibility never restricted, but its dispose ran
    expect(restrictDispose).not.toHaveBeenCalled()
  })
})
