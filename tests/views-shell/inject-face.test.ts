/**
 * V2-T4.1 — production inject-face test (dsh-adapter/ui.ts).
 *
 * Drives the REAL `registerResearchUI` against a FAKE slots service (a
 * plain object — no cordis): it pins the tab registration ITSELF unchanged
 * (design §5 标签页恒显: same slot key, id, order, 研究 label) and the NEW
 * inject face (the apply-world → view channel):
 *  - the registered component is the shell (the V2 tab body);
 *  - the inject thunk runs per session (the framework sessionId parameter)
 *    and returns the plain `loadPlaneState` face;
 *  - `loadPlaneState` carries the framework sessionId into
 *    `researchRpc.getResearchPlaneState` (the host resolves cwd → role —
 *    the client only ever passes its own session id) and resolves the wire
 *    result;
 *  - a business fault (`ok: false`) is folded into a plain rejection whose
 *    message carries the error code (the shell's failure face + 重试
 *    respond; the DSH-free view never sees a `RemoteResult`).
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  mountResearchRemotes,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'
import {
  CONVERSATION_VIEW_SLOT,
  registerResearchUI,
  type ResearchClientContext,
} from '../../src/client/dsh-adapter/ui.js'
import { ResearchShell } from '../../src/client/views/shell/index.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'

interface CapturedRegistration {
  readonly options: {
    readonly name: string
    readonly id: string
    readonly order?: number
    readonly label?: () => string
    readonly inject?: (sessionId: string) => unknown
  }
  readonly component: unknown
}

/** Build the fake slots service, capturing the injection-time registration. */
function makeFakeSlots(): { slots: unknown; get: () => CapturedRegistration } {
  let registration: CapturedRegistration | null = null
  let contribute: (() => unknown) | null = null
  const slots = {
    inject(slot: string, fn: () => unknown): void {
      expect(slot).toBe(CONVERSATION_VIEW_SLOT)
      contribute = fn
    },
    register(options: CapturedRegistration['options'], component: unknown): () => void {
      registration = { options, component }
      return () => undefined
    },
  }
  return {
    slots,
    get: () => {
      // Run the contribute callback (slot declaration time) to register.
      if (contribute === null) throw new Error('no injection contributed yet')
      contribute()
      if (registration === null) throw new Error('registration not captured')
      return registration
    },
  }
}

async function mountStub(stub: StubRpc): Promise<void> {
  const fakeCtx = {
    remote: {
      $mount: async (): Promise<() => void> => () => undefined,
      researchControl: stub.rpc,
    },
  } as unknown as RemoteContext
  await mountResearchRemotes(fakeCtx)
}

afterEach(() => {
  unmountResearchRemotes()
})

describe('registerResearchUI — the tab registration (unchanged, 标签恒显)', () => {
  it('registers the shell into the conversation.view slot with the same identity', () => {
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options, component } = fake.get()

    expect(options.name).toBe(CONVERSATION_VIEW_SLOT)
    expect(options.id).toBe('research')
    expect(options.order).toBe(20)
    expect(options.label?.()).toBe('研究')
    expect(component).toBe(ResearchShell)
    expect(typeof options.inject).toBe('function')
  })
})

describe('registerResearchUI — the injected plane-state fetch face', () => {
  it('carries the framework sessionId into getResearchPlaneState and resolves the wire result', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()

    const face = options.inject!('sess-1') as {
      loadPlaneState: () => Promise<{ session: { readonly role: string } | null }>
    }
    expect(typeof face.loadPlaneState).toBe('function')

    const result = await face.loadPlaneState()
    // The client passes ONLY its own session id (the host resolves the
    // cwd/role from the session registry).
    expect(stub.callsTo('getResearchPlaneState')).toHaveLength(1)
    expect(stub.callsTo('getResearchPlaneState')[0].args).toEqual({ sessionId: 'sess-1' })
    // The wire result passes through unchanged (the stub default is a
    // wire-valid plane state).
    expect(result.session?.role).toBe('STANDALONE')
  })

  it('folds a business fault (ok:false) into a plain rejection carrying the error code', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    stub.set('getResearchPlaneState', {
      ok: false,
      error: { code: 'PLANE_SESSION_UNKNOWN', message: 'session sess-9 names no known session', details: {} },
    })
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()

    const face = options.inject!('sess-9') as { loadPlaneState: () => Promise<unknown> }
    await expect(face.loadPlaneState()).rejects.toThrow(/PLANE_SESSION_UNKNOWN/)
  })
})

describe('registerResearchUI — the T5.1 HUB 总览 fetch face (design §12 row 2)', () => {
  it('calls getHubOverview with the empty {} request and resolves the wire result', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()

    const face = options.inject!('sess-hub') as {
      loadHubOverview: () => Promise<{ totals: { readonly projects: number } }>
    }
    expect(typeof face.loadHubOverview).toBe('function')

    const result = await face.loadHubOverview()
    // The uniform single-`args`-parameter convention: the overview request
    // is the empty object (the face carries no session identity — the
    // host aggregates the whole registry).
    expect(stub.callsTo('getHubOverview')).toHaveLength(1)
    expect(stub.callsTo('getHubOverview')[0]?.args).toEqual({})
    // The wire result passes through unchanged (the stub default is a
    // wire-valid overview — the empty-hub projection).
    expect(result.totals.projects).toBe(0)
  })

  it('folds a business fault (ok:false) into a plain rejection carrying the error code', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    stub.set('getHubOverview', {
      ok: false,
      error: { code: 'PLANE_NOT_MANAGED', message: 'the overview requires a hub', details: {} },
    })
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()

    const face = options.inject!('sess-9') as { loadHubOverview: () => Promise<unknown> }
    await expect(face.loadHubOverview()).rejects.toThrow(/PLANE_NOT_MANAGED/)
  })
})

describe('registerResearchUI — the T4.2 onboarding mutation faces (design §8)', () => {
  interface MutationFaces {
    readonly setHub: (args: { wsPath: string }) => Promise<unknown>
    readonly bindProject: (args: { wsPath: string; displayName?: string; scaffold?: boolean }) => Promise<unknown>
  }

  it('setHub forwards the args verbatim and resolves the wire result (success path)', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MutationFaces

    const result = (await face.setHub({ wsPath: '/workspace/unregistered' })) as { hubPath: string }
    expect(stub.callsTo('setHub')).toHaveLength(1)
    expect(stub.callsTo('setHub')[0].args).toEqual({ wsPath: '/workspace/unregistered' })
    // The wire result passes through unchanged (the stub default is a
    // wire-valid SetHubResult at the requested path).
    expect(result.hubPath).toBeTruthy()
  })

  it('bindProject forwards the args verbatim and resolves the wire result (success path)', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MutationFaces

    const args = { wsPath: '/workspace/unregistered', displayName: 'unregistered', scaffold: true }
    const result = (await face.bindProject(args)) as { projectId: string }
    expect(stub.callsTo('bindProject')).toHaveLength(1)
    expect(stub.callsTo('bindProject')[0].args).toEqual(args)
    expect(result.projectId).toBeTruthy()
  })

  it('folds a setHub business fault (ok:false) into a plain rejection carrying the error code', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    stub.set('setHub', {
      ok: false,
      error: { code: 'PLANE_HUB_EXISTS', message: 'a hub already exists at /workspace/hub', details: {} },
    })
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MutationFaces

    await expect(face.setHub({ wsPath: '/workspace/unregistered' })).rejects.toThrow(/PLANE_HUB_EXISTS/)
  })

  it('folds a bindProject business fault (ok:false) into a plain rejection carrying the error code', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    stub.set('bindProject', {
      ok: false,
      error: { code: 'PLANE_TREE_EXISTS', message: 'a research tree already exists at /workspace/unregistered/.research', details: {} },
    })
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MutationFaces

    await expect(
      face.bindProject({ wsPath: '/workspace/unregistered', displayName: 'unregistered', scaffold: true }),
    ).rejects.toThrow(/PLANE_TREE_EXISTS/)
  })
})

describe('registerResearchUI — the T4.3 MISSING-modal mutation faces (design §4)', () => {
  interface MissingModalFaces {
    readonly rescan: (args: Record<string, never>) => Promise<unknown>
    readonly unbindProject: (args: { wsPath: string }) => Promise<unknown>
    readonly ackMissingReminder: (args: { projectId: string }) => Promise<unknown>
  }

  it('rescan forwards the strict empty request verbatim and resolves the wire summary', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MissingModalFaces

    const result = (await face.rescan({})) as { missing: unknown[] }
    expect(stub.callsTo('rescan')).toHaveLength(1)
    expect(stub.callsTo('rescan')[0].args).toEqual({})
    // The wire summary passes through unchanged (the stub default is a
    // wire-valid PlaneStateSummary).
    expect(result.missing).toEqual([])
  })

  it('unbindProject forwards the registered wsPath verbatim (移除登记 — 归档口径)', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MissingModalFaces

    const result = (await face.unbindProject({ wsPath: '/workspace/proj-3' })) as { archivedDir: string }
    expect(stub.callsTo('unbindProject')).toHaveLength(1)
    expect(stub.callsTo('unbindProject')[0].args).toEqual({ wsPath: '/workspace/proj-3' })
    expect(result.archivedDir).toBeTruthy()
  })

  it('ackMissingReminder forwards the projectId verbatim (推后 — the runtime dedup flag set)', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MissingModalFaces

    const result = (await face.ackMissingReminder({ projectId: 'PRJ-3' })) as { acknowledged: boolean }
    expect(stub.callsTo('ackMissingReminder')).toHaveLength(1)
    expect(stub.callsTo('ackMissingReminder')[0].args).toEqual({ projectId: 'PRJ-3' })
    expect(result.acknowledged).toBe(true)
  })

  it('folds a rescan business fault (the §4 step-3 fail-loud: MULTIPLE_HUBS) into a plain rejection carrying the code', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    stub.set('rescan', {
      ok: false,
      error: {
        code: 'MULTIPLE_HUBS',
        message: '2 registered workspaces carry a .research-control management hub — the research control plane refuses to start',
        details: {},
      },
    })
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MissingModalFaces

    await expect(face.rescan({})).rejects.toThrow(/MULTIPLE_HUBS/)
  })

  it('folds an ackMissingReminder business fault (PLANE_NOT_MISSING) into a plain rejection carrying the code', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    stub.set('ackMissingReminder', {
      ok: false,
      error: {
        code: 'PLANE_NOT_MISSING',
        message: "project PRJ-9 is not in the plane's MISSING set — the 「推后处理」 flag is for live MISSING entries only",
        details: {},
      },
    })
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MissingModalFaces

    await expect(face.ackMissingReminder({ projectId: 'PRJ-9' })).rejects.toThrow(/PLANE_NOT_MISSING/)
  })

  it('folds an unbindProject business fault (PLANE_NOT_MANAGED) into a plain rejection carrying the code', async () => {
    const stub = makeStubRpc()
    await mountStub(stub)
    stub.set('unbindProject', {
      ok: false,
      error: {
        code: 'PLANE_NOT_MANAGED',
        message: 'the workspace /workspace/proj-3 is not an active managed project: no tree was discovered at /workspace/proj-3',
        details: {},
      },
    })
    const fake = makeFakeSlots()
    registerResearchUI({ slots: fake.slots } as unknown as ResearchClientContext)
    const { options } = fake.get()
    const face = options.inject!('sess-1') as MissingModalFaces

    await expect(face.unbindProject({ wsPath: '/workspace/proj-3' })).rejects.toThrow(/PLANE_NOT_MANAGED/)
  })
})
