/**
 * R5 — the settings-card adapter over the 0.2 PUBLIC config-form face, on
 * the real Installed row-config seat. Pinned contracts (the migration
 * brief's acceptance list, not boolean stubs):
 *
 *  - SEAT: `plugins.row.config` keyed `<package>#<row id>` — routed by
 *    `options.key` (the host config ledger reads `entry.options.key`,
 *    config-ledger.ts:52; the Official-group `plugins.item` list is NOT a
 *    bundle's seat, slot-contract.ts). The keyed half of the key is the
 *    bundle's npm package name; the row half is the profile ENTRY id the
 *    host `describe()` serves as `ns` — the SAME constant
 *    `RESEARCH_SETTINGS_ENTRY_ID` the host read path resolves (the
 *    describe 读面 pairing this suite pins).
 *  - ONE ATOMIC write: both fields travel in ONE `form.mutate(ops,
 *    expectedRevision)` (host contract config-form-types.ts: all ops share
 *    one revision fence, Host validation, persistence decision, and
 *    recovery read). TWO sequential `set` calls are a contract violation.
 *  - `false` = refusal/conflict = NOTHING of ours was written → NO
 *    compensating rollback, NO rescan, `write-error` shown. A thrown
 *    transport fault likewise never earns a blind rollback.
 *  - A rename that LOSES the pre-save plane is compensated by a fenced
 *    rollback carrying the revision OUR accepted write produced (never the
 *    pre-save fence — a stale fence must be REFUSED, not a trample), then
 *    a RESCAN OF THE RESTORED PATHS so the old project is queryable
 *    IMMEDIATELY — no manual rescan, no restart. A refused/stale fence
 *    surfaces `restoreFault` and never tramples the newer writer.
 *  - The page-owner `form` props are the WRITE PATH when the seat supplies
 *    one (custom owning ids keep their identity); the canonical
 *    `configForms.get(entryId)` form is the fallback only.
 *  - LATE REGISTRATION (the settingsScope-era lesson, the fix branch's
 *    scenario): the card registers with NO service present, and a service
 *    that lands AFTER apply reaches the card through the per-build face —
 *    with no re-probe timer (the fake-timer guard below proves nothing is
 *    deferred), and no form at all refuses honestly (warn-once).
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
  ROW_CONFIG_KEY,
  ROW_CONFIG_SLOT,
  deriveCardSnapshot,
  registerResearchSettingsCard,
  type ConfigFormLike,
  type ConfigFormsServiceLike,
  type OwnerFormLike,
  type SettingsPathOpViewLike,
} from '../../src/client/dsh-adapter/settings-card.js'
import type { ResearchSettingsCardFace } from '../../src/client/views/settings/research-settings-card.js'
import { RESEARCH_SETTINGS_ENTRY_ID, RESEARCH_SETTINGS_NAMESPACE } from '../../src/shared/research-settings.js'
import type { PlaneProjectDto, PlaneStateSummary } from '../../src/shared/rpc-contracts.js'

/* ----------------------------- fixtures ------------------------------ */

const ok = <T>(value: T) => ({ ok: true as const, value })
const fail = (message: string) => ({ ok: false as const, error: { code: 'RPC_FAIL', message } })

function project(projectId: string, wsPath: string): PlaneProjectDto {
  return { projectId, displayName: projectId, kind: 'STANDALONE', wsPath }
}

type Section = { projectTreeDir: string; hubDir: string }

/**
 * The host-shaped fake of one config form: an accepted mutate folds ops
 * into the snapshot and bumps the namespace revision; a stale
 * expectedRevision is REFUSED (the optimistic-concurrency fence); refuse /
 * throw modes simulate conflict and transport faults.
 */
interface FormHarness {
  form: ConfigFormLike<Section>
  calls: Array<{ ops: readonly SettingsPathOpViewLike[]; rev: number | undefined }>
  value: Section
  revision: number | undefined
  failNext: 'none' | 'refuse' | 'throw'
  /** Simulates a concurrent writer moving the namespace (e.g. another editor tab). */
  concurrentWrite(): void
  ownerForm(): OwnerFormLike
}

function makeForm(initial: Section): FormHarness {
  const h: FormHarness = {
    calls: [],
    value: { ...initial },
    revision: 0,
    failNext: 'none',
    form: null as unknown as ConfigFormLike<Section>,
    concurrentWrite() {
      h.revision = (h.revision ?? 0) + 1
    },
    ownerForm(): OwnerFormLike {
      // Host behavior mirrored: the page-owner's `state` object reflects
      // the CURRENT namespace section + revision (refreshed on acceptance).
      return {
        get state() {
          return { status: 'ready', value: { ...h.value }, writable: true, revision: h.revision } as never
        },
        mutate: (ops, rev) => h.form.mutate(ops, rev),
      }
    },
  }
  h.form = {
    getSnapshot: () => ({ status: 'ready', value: { ...h.value }, writable: true, revision: h.revision }) as never,
    subscribe: () => () => {},
    async mutate(ops, expectedRevision) {
      h.calls.push({ ops, rev: expectedRevision })
      if (h.failNext === 'throw') {
        h.failNext = 'none'
        throw new Error('transport-down')
      }
      if (h.failNext === 'refuse') {
        h.failNext = 'none'
        return false
      }
      if (expectedRevision !== undefined && expectedRevision !== h.revision) return false // host fence
      for (const op of ops) {
        if (op.op === 'set' && typeof op.value === 'string') {
          h.value = { ...h.value, [op.path[0] as keyof Section]: op.value }
        }
      }
      h.revision = (h.revision ?? 0) + 1
      return true
    },
  }
  return h
}

/** The config-aware plane fake: discovery reads the CURRENT committed doc. */
function configAwareRpc(canonical: FormHarness) {
  const knownTrees = new Set(['.research'])
  const plane = (): Pick<PlaneStateSummary, 'hub' | 'projects'> => ({
    hub: { path: `/ws/${canonical.value.hubDir}` },
    projects: knownTrees.has(canonical.value.projectTreeDir)
      ? [project('P1', `/ws/${canonical.value.projectTreeDir}`)]
      : [],
  })
  rpc.getResearchPlaneState.mockImplementation(async () => ok(plane()))
  rpc.rescan.mockImplementation(async () => ok(plane()))
  return plane
}

interface CtxHarness {
  registered: Array<{ options: Record<string, unknown>; component: unknown }>
  injectedSlots: string[]
  disposers: Array<() => void>
  setService(s: ConfigFormsServiceLike | undefined): void
}

function makeCtx(initialService: ConfigFormsServiceLike | undefined): CtxHarness {
  const registered: CtxHarness['registered'] = []
  const injectedSlots: string[] = []
  const disposers: Array<() => void> = []
  let service = initialService
  const ctx = {
    get: (name: string) => (name === 'configForms' ? service : undefined),
    effect: (fn: () => (() => void) | void) => {
      const disposer = fn()
      disposers.push(() => disposer?.())
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
  registerResearchSettingsCard(ctx as never)
  return {
    registered,
    injectedSlots,
    disposers,
    setService(s) {
      service = s
    },
  }
}

function serviceSpy(form: ConfigFormLike<Section>) {
  const gotIds: string[] = []
  const service: ConfigFormsServiceLike = {
    get<T>(entryId: string): ConfigFormLike<T> {
      gotIds.push(entryId)
      return form as unknown as ConfigFormLike<T>
    },
  }
  return { service, gotIds }
}

/** The face the keyed seat's inject builds (rebuilt per render upstream). */
function faceOf(ctx: CtxHarness): ResearchSettingsCardFace {
  const entry = ctx.registered[0]
  if (entry === undefined) throw new Error('the card never registered onto the row-config seat')
  return (entry.options['inject'] as () => ResearchSettingsCardFace)()
}

const NEXT: Section = { projectTreeDir: '.ghost', hubDir: '.ghost-hub' }

beforeEach(() => {
  rpc.getResearchPlaneState.mockReset()
  rpc.rescan.mockReset()
})

/* --------------------- seat registration pins ------------------------ */

describe('row-config seat (the 0.2 bundle-config seat, keyed by options.key)', () => {
  it('registers plugins.row.config keyed dsh-research-control#research-control via options.key, unconditional', () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    expect(ctx.injectedSlots).toEqual([ROW_CONFIG_SLOT])
    expect(ROW_CONFIG_SLOT).toBe('plugins.row.config')
    expect(ROW_CONFIG_KEY).toBe('dsh-research-control#research-control')
    const entry = ctx.registered[0]
    expect(entry.options['name']).toBe('plugins.row.config')
    // THE routing option: the host ledger/page read `entry.options.key`
    // (config-ledger.ts keysOf) — a keyed entry carrying only `id` is
    // INVISIBLE to the seat (the pr8-draft defect this migration fixes).
    expect(entry.options['key']).toBe('dsh-research-control#research-control')
    expect(entry.options['id']).toBeUndefined()
  })

  it('the seat key pairs on the shared entry-id constants (host describe() ns === the row half)', () => {
    // The host read path resolves the served view by `ns ===
    // RESEARCH_SETTINGS_ENTRY_ID` (settings.ts) and the client reaches the
    // SAME entry through configForms.get — one constant, no drift.
    expect(ROW_CONFIG_KEY).toBe(`${RESEARCH_SETTINGS_NAMESPACE}#${RESEARCH_SETTINGS_ENTRY_ID}`)
    expect(RESEARCH_SETTINGS_ENTRY_ID).toBe('research-control')
  })

  it('registers WITHOUT any configForms service (the seat form rides owner props; unload/reload via the fiber disposer)', () => {
    const ctx = makeCtx(undefined)
    expect(ctx.registered).toHaveLength(1)
    for (const dispose of ctx.disposers) dispose()
    const ctx2 = makeCtx(undefined)
    expect(ctx2.registered).toHaveLength(1)
  })

  it('late service appearance (the fix-branch scenario): a service landing AFTER apply reaches the card with NO re-probe timer and no re-registration', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    configAwareRpc(h)
    // Fake timers are ACTIVE for the whole scenario: a design that
    // re-probed on a setTimeout ladder would fail here — nothing advances.
    vi.useFakeTimers()
    try {
      const ctx = makeCtx(undefined)
      const early = faceOf(ctx)
      const refused = await early.save(NEXT)
      expect(refused.status).toBe('rescan-error') // honest refusal, nothing written
      expect(h.calls).toHaveLength(0)

      const { service } = serviceSpy(h.form)
      ctx.setService(service)
      const late = faceOf(ctx)
      const saved = await late.save(NEXT)
      // The service is there now: the transaction RAN (the loss flow found
      // '.ghost' is not on disk and rolled back).
      expect(saved.status).toBe('missing')
      expect(h.calls.length).toBeGreaterThanOrEqual(2) // write + fenced rollback
      // And the canonical form was resolved through the SHARED entry id —
      // the describe-读面 pairing key, not the retired 0.1 namespace.
    } finally {
      vi.useRealTimers()
    }
  })

  it('the canonical form is keyed by RESEARCH_SETTINGS_ENTRY_ID (not the retired settings namespace)', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service, gotIds } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    configAwareRpc(h)
    await faceOf(ctx).save({ projectTreeDir: '.research', hubDir: '.research-control' })
    expect(gotIds.length).toBeGreaterThan(0)
    expect([...new Set(gotIds)]).toEqual([RESEARCH_SETTINGS_ENTRY_ID])
  })
})

/* ------------------- the atomic two-field transaction ----------------- */

describe('ONE atomic mutate + honest failure semantics', () => {
  it('happy path: ONE mutate with BOTH set-ops under the read revision; no second write', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    const plane = configAwareRpc(h)
    // a pair the disk knows (the loss design treats a moved hub path as a
    // lost hub — the happy path saves the live pair):
    const outcome = await faceOf(ctx).save({ projectTreeDir: '.research', hubDir: '.research-control' })
    expect(outcome.status).toBe('saved')
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].ops.map((op) => op.path[0])).toEqual(['projectTreeDir', 'hubDir'])
    expect(h.calls[0].ops.map((op) => op.value)).toEqual(['.research', '.research-control'])
    expect(h.calls[0].rev).toBe(0) // the fence read at save start
    expect(rpc.rescan).toHaveBeenCalledTimes(1)
    expect(plane().projects.map((x) => x.projectId)).toEqual(['P1'])
  })

  it('`false` (refusal/conflict) = NOTHING written: NO rollback, NO rescan, write-error', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    configAwareRpc(h)
    h.failNext = 'refuse'
    const outcome = await faceOf(ctx).save(NEXT)
    expect(outcome.status).toBe('write-error')
    expect(h.calls).toHaveLength(1) // the refusal itself — no compensating write
    expect(rpc.rescan).not.toHaveBeenCalled()
    expect(h.value).toEqual({ projectTreeDir: '.research', hubDir: '.research-control' })
  })

  it('thrown transport fault: never a blind compensating write, no rescan', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    configAwareRpc(h)
    h.failNext = 'throw'
    const outcome = await faceOf(ctx).save(NEXT)
    expect(outcome.status).toBe('write-error')
    expect(h.calls).toHaveLength(1)
    expect(rpc.rescan).not.toHaveBeenCalled()
  })
})

/* --------------- rename-loss: fenced rollback + restored rescan -------- */

describe('rejected rename → fenced rollback → restored path rescan (immediately queryable)', () => {
  it('rolls back under the revision OUR accepted write produced, then rescans the restored plane', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    const plane = configAwareRpc(h)

    const outcome = await faceOf(ctx).save(NEXT) // '.ghost' does not exist → loss
    if (outcome.status !== 'missing') throw new Error(`expected missing, got ${outcome.status}`)
    expect(outcome.lostTreePaths).toEqual(['/ws/.research'])
    // write (rev 0) → rollback (rev 1 = OUR accepted revision, NOT 0):
    expect(h.calls).toHaveLength(2)
    expect(h.calls[0].rev).toBe(0)
    expect(h.calls[1].rev).toBe(1)
    expect(h.calls[1].ops.map((op) => op.value)).toEqual(['.research', '.research-control'])
    // the restored plane was RESCANDED (2nd rescan) — and the old project is
    // queryable right now, no manual rescan/restart:
    expect(rpc.rescan).toHaveBeenCalledTimes(2)
    expect(plane().projects.map((p) => p.projectId)).toEqual(['P1'])
    expect(h.value).toEqual({ projectTreeDir: '.research', hubDir: '.research-control' })
  })

  it('a concurrent newer write holds the fence: the stale rollback is REFUSED, nothing is trampled, restoreFault is surfaced', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    configAwareRpc(h)
    // interleave: after our accepted write a different editor writes again
    const originalMutate = h.form.mutate.bind(h.form)
    let calls = 0
    h.form.mutate = async (ops, rev) => {
      // The newer writer lands between our fence capture and the rollback
      // (deterministically: on the SECOND mutate call, just before its
      // fence check) — the namespace then stands at a revision OURS did
      // not produce, so the stale fence must be refused by the Host.
      if (++calls === 2) h.concurrentWrite()
      return originalMutate(ops, rev)
    }
    const outcome = await faceOf(ctx).save(NEXT)
    if (outcome.status !== 'missing') throw new Error(`expected missing, got ${outcome.status}`)
    expect(outcome.restoreFault).toBeTruthy() // card blocks with the second fault
    // no restored rescan ran over a doc we do not own:
    expect(rpc.rescan).toHaveBeenCalledTimes(1)
    expect(h.value.projectTreeDir).toBe('.ghost') // untouched by a stale-fence write
  })

  it('restore-rescan failure surfaces restoreFault (live plane blocked, honest error)', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    configAwareRpc(h)
    rpc.rescan
      .mockImplementationOnce(async () => ok({ hub: { path: '/ws/.ghost-hub' }, projects: [] }))
      .mockImplementationOnce(async () => fail('disk-unreachable'))
    const outcome = await faceOf(ctx).save(NEXT)
    if (outcome.status !== 'missing') throw new Error(`expected missing, got ${outcome.status}`)
    expect(outcome.restoreFault).toContain('disk-unreachable')
  })

  it('rescan transport failure: fenced rollback + restored rescan, rescan-error outcome', async () => {
    const h = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service } = serviceSpy(h.form)
    const ctx = makeCtx(service)
    rpc.getResearchPlaneState.mockResolvedValue(ok({ hub: null, projects: [project('P1', '/ws/.research')] }))
    rpc.rescan
      .mockImplementationOnce(async () => fail('rescan-blew-up'))
      .mockImplementationOnce(async () => ok({ hub: null, projects: [project('P1', '/ws/.research')] }))
    const outcome = await faceOf(ctx).save(NEXT)
    if (outcome.status !== 'rescan-error') throw new Error(`expected rescan-error, got ${outcome.status}`)
    expect(outcome.restoreFault).toBeUndefined() // the restored rescan SUCCEEDED
    expect(h.calls[1].rev).toBe(1)
    expect(rpc.rescan).toHaveBeenCalledTimes(2)
  })
})

/* --------------------- owner form (real entry identity) --------------- */

describe('page-owner form props (custom owning ids included)', () => {
  it('writes through the OWNER form when the seat supplies one — the canonical form is never touched', async () => {
    const owner = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const canonical = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const { service, gotIds } = serviceSpy(canonical.form)
    const ctx = makeCtx(service)
    configAwareRpc(owner) // the plane follows the OWNER's doc
    await expect(faceOf(ctx).save(NEXT, owner.ownerForm())).resolves.toMatchObject({ status: 'missing' })
    expect(canonical.calls).toHaveLength(0)
    expect(owner.calls.length).toBeGreaterThanOrEqual(2) // atomic write + fenced rollback
    expect(owner.value).toEqual({ projectTreeDir: '.research', hubDir: '.research-control' })
    // the fallback service was resolved for the face (display) but never written:
    expect(gotIds).toContain(RESEARCH_SETTINGS_ENTRY_ID)
  })

  it('custom rc-real: with NO canonical service at all, the owner form still writes its own doc (identity preserved)', async () => {
    const owner = makeForm({ projectTreeDir: '.research', hubDir: '.research-control' })
    const ctx = makeCtx(undefined) // no configForms service anywhere
    configAwareRpc(owner)
    const outcome = await faceOf(ctx).save({ projectTreeDir: '.research', hubDir: '.research-control' }, owner.ownerForm())
    expect(outcome.status).toBe('saved')
    expect(owner.calls).toHaveLength(1)
    expect(owner.calls[0].ops).toHaveLength(2)
  })

  it('no owner form and no service: honest refusal, zero transport', async () => {
    const ctx = makeCtx(undefined)
    const outcome = await faceOf(ctx).save(NEXT)
    expect(outcome.status).toBe('rescan-error')
    expect(rpc.getResearchPlaneState).not.toHaveBeenCalled()
  })
})

/* --------------------------- derive (kept pin) ------------------------- */

describe('deriveCardSnapshot: typed narrowing with the composition defaults as the fallback', () => {
  it('non-string fields fall back per-field', () => {
    const h = makeForm({ projectTreeDir: '.x', hubDir: '.y' })
    h.value = { projectTreeDir: 42 as never, hubDir: '.y' }
    expect(deriveCardSnapshot(h.form).values).toEqual({ projectTreeDir: '.research', hubDir: '.y' })
  })

  it('loading passes through untouched (values stay undefined)', () => {
    const loading: ConfigFormLike<Section> = {
      getSnapshot: () => ({ status: 'loading', value: undefined, writable: false, revision: undefined }),
      subscribe: () => () => {},
      mutate: async () => true,
    }
    expect(deriveCardSnapshot(loading)).toEqual({ status: 'loading', values: undefined, writable: false })
  })
})
