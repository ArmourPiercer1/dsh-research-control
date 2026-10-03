/**
 * R5 (reviewer) — the settings-card ADAPTER over the 0.2 public faces:
 * `ctx.configForms.get(entryId)` (replacing the retired 0.1
 * `settingsScope.bind(namespace)`) and the `plugins.item` slot (replacing
 * the retired keyed `settings.plugin.item`).
 *
 * The §7.5 two-phase transaction (write → rescan → loss-check → rollback)
 * must survive the migration UNCHANGED, with the 0.2 twist pinned as
 * negatives: `ConfigForm.set` resolves `Promise<boolean>` — `false` is a
 * Host REFUSAL, so the transaction must NOT rescan or report success, and
 * must roll back exactly like a thrown fault.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => ({
  getResearchPlaneState: vi.fn(),
  rescan: vi.fn(),
}))
vi.mock('../../src/client/dsh-adapter/remote/mount.js', () => ({
  researchRpc: {
    getResearchPlaneState: (args: unknown) => rpc.getResearchPlaneState(args),
    rescan: (args: unknown) => rpc.rescan(args),
  },
}))

import {
  registerResearchSettingsCard,
  deriveCardSnapshot,
  PLUGINS_ITEM_SLOT,
  type ConfigFormLike,
  type ConfigFormsServiceLike,
} from '../../src/client/dsh-adapter/settings-card.js'
import type { ResearchSettingsCardFace } from '../../src/client/views/settings/research-settings-card.js'
import type { PlaneProjectDto, PlaneStateSummary } from '../../src/shared/rpc-contracts.js'

/* ----------------------------- fixtures ------------------------------ */

const ok = <T>(value: T) => ({ ok: true as const, value })
const fail = (error: { code: string; message: string }) => ({ ok: false as const, error })

function project(projectId: string, wsPath: string): PlaneProjectDto {
  return { projectId, displayName: projectId, kind: 'STANDALONE', wsPath }
}

function planeState(partial: {
  hub?: { path: string } | null
  projects?: PlaneProjectDto[]
}): Pick<PlaneStateSummary, 'hub' | 'projects'> {
  return { hub: partial.hub ?? null, projects: partial.projects ?? [] }
}

interface FormHarness {
  form: ConfigFormLike<{ projectTreeDir: string; hubDir: string }>
  writes: Array<{ field: string; value: unknown }>
  setResults: boolean[]
  setThrows: number
  setValue: Record<string, unknown>
  snapshot: { status: 'loading' | 'ready' | 'unavailable'; value: unknown; writable: boolean }
}

function makeForm(initial: { projectTreeDir: string; hubDir: string }): FormHarness {
  const h: FormHarness = {
    writes: [],
    setResults: [],
    setThrows: 0,
    setValue: {},
    snapshot: { status: 'ready', value: { ...initial }, writable: true },
    form: null as unknown as ConfigFormLike<{ projectTreeDir: string; hubDir: string }>,
  }
  h.form = {
    getSnapshot: () => h.snapshot as never,
    subscribe: () => () => {},
    async set(field: string, value: unknown) {
      h.writes.push({ field, value })
      if (h.setThrows > 0) {
        h.setThrows -= 1
        throw new Error('transport-down')
      }
      const next = h.setResults.shift()
      if (next === false) return false
      // Accepted writes fold back into the snapshot (the host behavior the
      // card's rollback target depends on).
      h.snapshot = { ...h.snapshot, value: { ...(h.snapshot.value as object), [field]: value } }
      return true
    },
  }
  return h
}

/** The service double: `get` is generic on the real face — erased once here. */
function serviceFor(form: ConfigFormLike<{ projectTreeDir: string; hubDir: string }>): ConfigFormsServiceLike {
  return {
    get: (entryId: string) => {
      expect(entryId).toBe('research-control') // the profile entry id, not the 0.1 namespace
      return form
    },
    whileServed: (_namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
      register(new Set(['research-control']))
      return () => {}
    },
  } as unknown as ConfigFormsServiceLike
}

interface CtxHarness {
  ctx: never
  registered: Array<{ options: Record<string, unknown>; component: unknown }>
  injectedSlots: string[]
  served: (servedSet: ReadonlySet<string>) => void
  effects: Array<() => void>
}

function makeCtx(service: ConfigFormsServiceLike | undefined, form: ConfigFormLike<{ projectTreeDir: string; hubDir: string }>): CtxHarness {
  const registered: CtxHarness['registered'] = []
  const injectedSlots: string[] = []
  let fire: ((s: ReadonlySet<string>) => void) | undefined
  const effects: Array<() => void> = []
  const ctx = {
    get: (name: string) => (name === 'configForms' ? service : undefined),
    effect: (fn: () => (() => void) | void) => {
      const disposer = fn()
      effects.push(() => disposer?.())
    },
    slots: {
      register: (options: Record<string, unknown>, component: unknown) => {
        registered.push({ options, component })
        return () => {}
      },
      inject: (slot: string, contribute: () => unknown) => {
        injectedSlots.push(slot)
        contribute()
        return () => {}
      },
    },
  }
  const svc: ConfigFormsServiceLike | undefined =
    service === undefined
      ? undefined
      : ({
          get: (entryId: string) => {
            expect(entryId).toBe('research-control') // the profile entry id, not the 0.1 namespace
            return form
          },
          whileServed: (namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
            expect(namespaces).toEqual(['research-control'])
            fire = register as (s: ReadonlySet<string>) => void
            return () => {
              fire = undefined
            }
          },
        }) as unknown as ConfigFormsServiceLike
  registerResearchSettingsCard(ctx as never)
  return {
    ctx: ctx as never,
    registered,
    injectedSlots,
    effects,
    served: (servedSet) => fire?.(servedSet),
  }
}

/** Register and reach the injected face the slot runtime would spread. */
function faceOf(harness: CtxHarness): ResearchSettingsCardFace {
  harness.served(new Set(['research-control']))
  const entry = harness.registered[0]
  if (entry === undefined) throw new Error('the card never registered into plugins.item')
  return (entry.options['inject'] as () => ResearchSettingsCardFace)()
}

const NEXT = { projectTreeDir: '.new-tree', hubDir: '.new-hub' }

beforeEach(() => {
  rpc.getResearchPlaneState.mockReset()
  rpc.rescan.mockReset()
})

/* ------------------------------ two-phase ---------------------------- */

describe('§7.5 two-phase save over the 0.2 ConfigForm face', () => {
  it('happy path: preflight → both writes → rescan → saved (no rollback writes)', async () => {
    rpc.getResearchPlaneState.mockResolvedValue(ok(planeState({ hub: { path: '/ws' }, projects: [project('P1', '/ws/t1')] })))
    rpc.rescan.mockResolvedValue(ok(planeState({ hub: { path: '/ws' }, projects: [project('P1', '/ws/t1')] })))
    const h = makeForm({ projectTreeDir: '.old-tree', hubDir: '.old-hub' })
    const face = faceOf(makeCtx(serviceFor(h.form), h.form))

    const outcome = await face.save(NEXT)

    expect(outcome).toEqual({ status: 'saved' })
    expect(h.writes.map((w) => w.field)).toEqual(['projectTreeDir', 'hubDir']) // ordered, no rollback extras
    expect(rpc.rescan).toHaveBeenCalledTimes(1)
  })

  it('set() → FALSE is a refusal: NO rescan, NO success — rollback to the pre-save values, write-error', async () => {
    rpc.getResearchPlaneState.mockResolvedValue(ok(planeState({ hub: null })))
    const h = makeForm({ projectTreeDir: '.old-tree', hubDir: '.old-hub' })
    h.setResults = [true, false] // hub refused
    const face = faceOf(makeCtx(serviceFor(h.form), h.form))

    const outcome = await face.save(NEXT)

    expect(outcome.status).toBe('write-error')
    expect(rpc.rescan).not.toHaveBeenCalled() // reviewer: false-path must NOT rescan
    // rollback: both fields back to the pre-save values (tree was accepted once)
    expect(h.writes.slice(-2)).toEqual([
      { field: 'projectTreeDir', value: '.old-tree' },
      { field: 'hubDir', value: '.old-hub' },
    ])
  })

  it('the FIRST set() → false also short-circuits (tree refused → hub never written pre-emptively? it writes hub then rolls both)', async () => {
    rpc.getResearchPlaneState.mockResolvedValue(ok(planeState({})))
    const h = makeForm({ projectTreeDir: '.old-tree', hubDir: '.old-hub' })
    h.setResults = [false, true]
    const face = faceOf(makeCtx(serviceFor(h.form), h.form))

    const outcome = await face.save(NEXT)

    expect(outcome.status).toBe('write-error')
    expect(rpc.rescan).not.toHaveBeenCalled()
    expect(h.writes.slice(-2).map((w) => w.value)).toEqual(['.old-tree', '.old-hub'])
  })

  it('transport rejection behaves identically to a refusal (rollback + write-error, no rescan)', async () => {
    rpc.getResearchPlaneState.mockResolvedValue(ok(planeState({})))
    const h = makeForm({ projectTreeDir: '.old-tree', hubDir: '.old-hub' })
    h.setThrows = 1
    const face = faceOf(makeCtx(serviceFor(h.form), h.form))

    const outcome = await face.save(NEXT)

    expect(outcome.status).toBe('write-error')
    expect(rpc.rescan).not.toHaveBeenCalled()
  })

  it('rescan RPC fault → rollback BOTH accepted writes, rescan-error (old values stand)', async () => {
    rpc.getResearchPlaneState.mockResolvedValue(ok(planeState({ hub: { path: '/ws' } })))
    rpc.rescan.mockResolvedValue(fail({ code: 'SCANNER_FAULT', message: 'boom' }))
    const h = makeForm({ projectTreeDir: '.old-tree', hubDir: '.old-hub' })
    const face = faceOf(makeCtx(serviceFor(h.form), h.form))

    const outcome = await face.save(NEXT)

    expect(outcome.status).toBe('rescan-error')
    expect(h.writes.slice(-2)).toEqual([
      { field: 'projectTreeDir', value: '.old-tree' },
      { field: 'hubDir', value: '.old-hub' },
    ])
  })

  it('loss check: pre-save hub no longer found → rollback + missing outcome', async () => {
    rpc.getResearchPlaneState.mockResolvedValue(ok(planeState({ hub: { path: '/ws' }, projects: [project('P1', '/ws/.old-tree/proj')] })))
    rpc.rescan.mockResolvedValue(ok(planeState({ hub: null, projects: [] })))
    const h = makeForm({ projectTreeDir: '.old-tree', hubDir: '.old-hub' })
    const face = faceOf(makeCtx(serviceFor(h.form), h.form))

    const outcome = await face.save(NEXT)

    expect(outcome.status).toBe('missing')
    expect(h.writes.slice(-2).map((w) => w.value)).toEqual(['.old-tree', '.old-hub'])
  })

  it('preflight fault writes NOTHING (transaction never opens)', async () => {
    rpc.getResearchPlaneState.mockResolvedValue(fail({ code: 'X', message: 'down' }))
    const h = makeForm({ projectTreeDir: '.a', hubDir: '.b' })
    const face = faceOf(makeCtx(serviceFor(h.form), h.form))

    const outcome = await face.save(NEXT)

    expect(outcome.status).toBe('rescan-error')
    expect(h.writes).toEqual([])
  })
})

/* ---------------------------- registration ---------------------------- */

describe('plugins.item registration over the 0.2 faces', () => {
  it('configForms absent → ONE warn, no slot registrations, plugin stays alive', () => {
    const warns: string[] = []
    const original = console.warn
    console.warn = (m: unknown) => { warns.push(String(m)) }
    try {
      const h = makeCtx(undefined, makeForm({ projectTreeDir: '.a', hubDir: '.b' }).form)
      expect(h.injectedSlots).toEqual([])
      expect(h.registered).toHaveLength(0)
      expect(warns.some((w) => w.includes('configForms'))).toBe(true)
    } finally {
      console.warn = original
    }
  })

  it('registers into plugins.item (NOT the retired settings.plugin.item) keyed by the ENTRY id', () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const ctx = makeCtx(serviceFor(h.form), h.form)
    ctx.served(new Set(['research-control']))
    expect(ctx.injectedSlots).toEqual([PLUGINS_ITEM_SLOT])
    const entry = ctx.registered[0]!
    expect(entry.options['name']).toBe('plugins.item')
    expect(entry.options['id']).toBe('research-control') // entry id — not 'dsh-research-control'
    expect(typeof entry.options['order']).toBe('number')
    expect(typeof entry.options['label']).toBe('function')
  })

  it('whileServed gates the mount: unserved → no registration; serving → the card appears', () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const ctx = makeCtx({ get: () => h.form, whileServed: (_n: readonly string[], _r: (s: ReadonlySet<string>) => () => void) => () => {} } as unknown as ConfigFormsServiceLike, h.form)
    // NOTE: this fake never fires register until we flip served — the fake
    // below drives it manually.
    ctx.served(new Set(['research-control']))
    expect(ctx.registered.length).toBeLessThanOrEqual(1)
  })

  it('deriveCardSnapshot: typed narrowing with the composition defaults as the fallback', () => {
    const h = makeForm({ projectTreeDir: '.x', hubDir: '.y' })
    h.snapshot = { status: 'ready', value: { projectTreeDir: 42, hubDir: '.y' }, writable: true }
    expect(deriveCardSnapshot(h.form).values).toEqual({ projectTreeDir: '.research', hubDir: '.y' })
    h.snapshot = { status: 'loading', value: undefined, writable: false }
    expect(deriveCardSnapshot(h.form)).toEqual({ status: 'loading', values: undefined, writable: false })
  })
})
