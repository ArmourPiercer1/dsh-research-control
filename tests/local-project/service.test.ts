/**
 * UI-2B — `LocalProjectService` kernel unit tests: createLocalResearchProject
 * (the Create journey's three-stage failure contract, D §8.5).
 *
 * This file is the kernel-level coverage the t67 e2e header promises:
 * every I/O seam of the port bag is an injected counted mock, so each
 * case pins (a) the gate ORDER (which ladder rung fired), (b) the
 * failure DTO's strict shape (code / failedStep / completedSteps /
 * partialChangeNote / detail carrying the injected cause message), and
 * (c) that the pre-check rejections leave all FIVE step ports untouched
 * (THROW stage — no partial change has been made). The live triggering
 * of the PLANE_* rungs, git and the real scaffold live in
 * e2e/t67-local-project-rpc.spec.ts; this file covers the decision
 * logic + DTO discipline.
 *
 * F1 pinned string (the first-step-failure note): the exact em-dash
 * sentence `No partial change — nothing was created.` is asserted
 * byte-for-byte in CASE 5.
 */

import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PlaneError } from '../../src/shared/rpc-contracts.js'
import { LocalProjectService } from '../../src/host/service/local-project/index.js'
import {
  LocalProjectError,
  type CreateLocalResearchProjectFailure,
  type CreateLocalResearchProjectInput,
  type CreateLocalResearchProjectSuccess,
  type LocalProjectServicePorts,
} from '../../src/host/service/local-project/types.js'

const WS = '/workspace/ws-a'
const TREE_DIR = '.research'
const TREE_PATH = path.join(WS, TREE_DIR)

const BASE_INPUT: CreateLocalResearchProjectInput = {
  wsPath: WS,
  treeDir: TREE_DIR,
  title: 'T67 local project',
}

type PortBag = Record<keyof LocalProjectServicePorts, ReturnType<typeof vi.fn>>

/** The benign default implementations (the happy path completes). */
const DEFAULT_IMPLS: Record<keyof LocalProjectServicePorts, unknown> = {
  listWorkspacePaths: () => [WS],
  hubWorkspacePath: () => undefined,
  hubMarkerDir: () => null,
  isDirectory: () => true,
  pathExists: () => false,
  hasGitRepo: () => false,
  probeTree: () => ({ present: false, valid: false }),
  isAlreadyManaged: () => false,
  mkdirTree: () => undefined,
  initGit: async () => undefined,
  scaffoldTree: () => ({ projectId: 'PRJ-7', treePath: TREE_PATH }),
  writeProjectMetadata: () => undefined,
  registerProject: async () => ({
    projectId: 'PRJ-7',
    registryPath: '/registry/projects.yaml',
    dbMigrated: false,
  }),
  knownProjectIds: () => [],
}

/** The full port bag as counted `vi.fn`s: each port IS the mock the
 *  service receives (so call counts and call args are assertable);
 *  `patch` overrides the seams a case needs. */
function makePorts(patch: Partial<LocalProjectServicePorts> = {}): { ports: PortBag; svc: LocalProjectService } {
  const impls = { ...DEFAULT_IMPLS, ...patch }
  const ports = {} as PortBag
  for (const key of Object.keys(impls) as (keyof LocalProjectServicePorts)[]) {
    ports[key] = vi.fn(impls[key] as (...a: unknown[]) => unknown)
  }
  const svc = new LocalProjectService(ports as unknown as LocalProjectServicePorts)
  return { ports, svc }
}

/** The five STEP ports — the pre-check stage must leave all of them
 *  untouched (a throw means nothing was created). */
const STEP_PORTS: readonly (keyof LocalProjectServicePorts)[] = [
  'mkdirTree',
  'initGit',
  'scaffoldTree',
  'writeProjectMetadata',
  'registerProject',
]

function assertStepPortsUntouched(ports: PortBag, context: string): void {
  for (const key of STEP_PORTS) {
    expect(ports[key].mock.calls.length, `${context}: the ${key} step port must not be touched`).toBe(0)
  }
}

/** Await a create rejection and pin the carrier shape (the built-in
 *  `[research-control] <CODE>` message prefix). Returns the error for
 *  extra assertions (class / code / detail). */
async function expectCarrier(p: Promise<unknown>, code: string, context: string): Promise<Error> {
  let caught: unknown
  try {
    await p
  } catch (e) {
    caught = e
  }
  expect(caught, `${context}: expected a carrier rejection`).toBeInstanceOf(Error)
  const e = caught as Error
  expect(e.message, `${context}: the carrier prefix must be built into the message`).toContain(
    `[research-control] ${code}`,
  )
  return e
}

function asFailure(out: unknown, context: string): CreateLocalResearchProjectFailure {
  expect(out, `${context}: the step failure must RETURN a DTO (ok:false)`).toMatchObject({ ok: false })
  return out as CreateLocalResearchProjectFailure
}

function asSuccess(out: unknown, context: string): CreateLocalResearchProjectSuccess {
  expect(out, `${context}: the success arm must be ok:true`).toMatchObject({ ok: true })
  return out as CreateLocalResearchProjectSuccess
}

describe('local-project — createLocalResearchProject: the pre-check ladder (THROW — zero step I/O)', () => {
  it('CASE 1 — PLANE_NOT_REGISTERED_WORKSPACE: an unregistered wsPath throws the frozen PlaneError (rung 1)', async () => {
    const { ports, svc } = makePorts({ listWorkspacePaths: () => ['/workspace/someone-else'] })
    const err = await expectCarrier(
      svc.createLocalResearchProject(BASE_INPUT),
      'PLANE_NOT_REGISTERED_WORKSPACE',
      'unregistered workspace',
    )
    expect(err, 'the rung 1 rejection is the FROZEN PlaneError (not extended locally)').toBeInstanceOf(PlaneError)
    expect((err as PlaneError).code).toBe('PLANE_NOT_REGISTERED_WORKSPACE')
    expect(err.message).toContain(`${WS} is not a registered DSH workspace`)
    assertStepPortsUntouched(ports, 'CASE 1')
  })

  it('CASE 2 — PLANE_HUB_WORKSPACE: the hub itself is refused (rung 2a: the live plane hub path)', async () => {
    const { ports, svc } = makePorts({ hubWorkspacePath: () => WS })
    const err = await expectCarrier(
      svc.createLocalResearchProject(BASE_INPUT),
      'PLANE_HUB_WORKSPACE',
      'hub workspace',
    )
    expect(err).toBeInstanceOf(PlaneError)
    expect((err as PlaneError).code).toBe('PLANE_HUB_WORKSPACE')
    expect(err.message).toContain(`${WS} is the hub workspace itself`)
    assertStepPortsUntouched(ports, 'CASE 2')
  })

  it('CASE 3 — LP_PARENT_INVALID: a non-existing workspace directory is refused (LocalProjectError, no step I/O)', async () => {
    const { ports, svc } = makePorts({ isDirectory: () => false })
    const err = await expectCarrier(svc.createLocalResearchProject(BASE_INPUT), 'LP_PARENT_INVALID', 'missing parent')
    expect(err).toBeInstanceOf(LocalProjectError)
    expect((err as LocalProjectError).code).toBe('LP_PARENT_INVALID')
    expect(err.message).toContain(`the workspace directory does not exist: ${WS}`)
    assertStepPortsUntouched(ports, 'CASE 3')
  })

  it('CASE 4 — LP_DIR_EXISTS: an existing tree path is refused (a tree never overwrites)', async () => {
    const { ports, svc } = makePorts({ pathExists: () => true })
    const err = await expectCarrier(svc.createLocalResearchProject(BASE_INPUT), 'LP_DIR_EXISTS', 'existing tree')
    expect(err).toBeInstanceOf(LocalProjectError)
    expect((err as LocalProjectError).code).toBe('LP_DIR_EXISTS')
    expect(err.message).toContain(TREE_PATH)
    assertStepPortsUntouched(ports, 'CASE 4')
  })
})

describe('local-project — createLocalResearchProject: step failures (RETURN the failure DTO — no rollback)', () => {
  it('CASE 5 — LP_MKDIR: the first step fails ⇒ completedSteps [] + the F1 pinned no-partial-change note + cause in detail', async () => {
    const { ports, svc } = makePorts({
      mkdirTree: () => {
        throw new Error('mkdir exploded (disk full)')
      },
    })
    const out = await svc.createLocalResearchProject(BASE_INPUT)
    expect(out).toMatchObject({
      ok: false,
      code: 'LP_MKDIR',
      failedStep: 'mkdir',
      completedSteps: [],
      // F1 pinned string (byte-for-byte, em dash): the mkdir-gate fix —
      // a first-step failure must NOT claim the directory was created.
      partialChangeNote: 'No partial change — nothing was created.',
    })
    const f = asFailure(out, 'CASE 5')
    expect(Object.keys(f).sort()).toEqual(['code', 'completedSteps', 'detail', 'failedStep', 'ok', 'partialChangeNote'])
    expect(f.detail, 'detail must carry the injected cause message').toContain('mkdir exploded (disk full)')
    expect(ports.mkdirTree.mock.calls.length).toBe(1)
    for (const key of ['initGit', 'scaffoldTree', 'writeProjectMetadata', 'registerProject'] as const) {
      expect(ports[key].mock.calls.length, `CASE 5: ${key} must not run after the mkdir failure`).toBe(0)
    }
  })

  it('CASE 6 — LP_GIT_INIT: mkdir done ⇒ completedSteps [mkdir] + the single-sentence note (gated on the mkdir completion)', async () => {
    const { ports, svc } = makePorts({
      initGit: async () => {
        throw new Error('git died (binary missing)')
      },
    })
    const out = await svc.createLocalResearchProject(BASE_INPUT)
    const f = asFailure(out, 'CASE 6')
    expect(f).toMatchObject({
      code: 'LP_GIT_INIT',
      failedStep: 'gitInit',
      completedSteps: ['mkdir'],
      partialChangeNote: `The tree directory ${TREE_PATH} was created.`,
    })
    expect(f.detail).toContain('git died (binary missing)')
    expect(ports.initGit.mock.calls.length).toBe(1)
    expect(ports.scaffoldTree.mock.calls.length).toBe(0)
  })

  it('CASE 7 — LP_SCAFFOLD: mkdir+gitInit done ⇒ the two-sentence note (no scaffold/metadata sentence)', async () => {
    const { ports, svc } = makePorts({
      scaffoldTree: () => {
        throw new Error('scaffold refused (allocator exhausted)')
      },
    })
    const out = await svc.createLocalResearchProject(BASE_INPUT)
    const f = asFailure(out, 'CASE 7')
    expect(f).toMatchObject({
      code: 'LP_SCAFFOLD',
      failedStep: 'scaffold',
      completedSteps: ['mkdir', 'gitInit'],
    })
    expect(f.partialChangeNote).toContain(`The tree directory ${TREE_PATH} was created`)
    expect(f.partialChangeNote).toContain(`git was initialized at ${WS}`)
    // byte-exact whole string: the two sentences joined with ' and '
    expect(f.partialChangeNote).toBe(
      `The tree directory ${TREE_PATH} was created and git was initialized at ${WS}.`,
    )
    expect(f.partialChangeNote).not.toContain('scaffolded')
    expect(f.partialChangeNote).not.toContain('metadata was written')
    expect(f.detail).toContain('scaffold refused (allocator exhausted)')
    expect(ports.scaffoldTree.mock.calls.length).toBe(1)
  })

  it('CASE 8 — LP_METADATA: mkdir+gitInit+scaffold done (input carries description ⇒ the metadata step runs) ⇒ the scaffold sentence carries the projectId', async () => {
    const input: CreateLocalResearchProjectInput = { ...BASE_INPUT, description: 'what it tracks' }
    const { ports, svc } = makePorts({
      writeProjectMetadata: () => {
        throw new Error('metadata write failed (yaml gone)')
      },
    })
    const out = await svc.createLocalResearchProject(input)
    const f = asFailure(out, 'CASE 8')
    expect(f).toMatchObject({
      code: 'LP_METADATA',
      failedStep: 'metadata',
      completedSteps: ['mkdir', 'gitInit', 'scaffold'],
    })
    expect(f.partialChangeNote).toContain('the research tree was scaffolded (project PRJ-7)')
    expect(f.partialChangeNote).not.toContain('metadata was written')
    expect(f.detail).toContain('metadata write failed (yaml gone)')
    expect(ports.writeProjectMetadata.mock.calls.length).toBe(1)
    expect(ports.writeProjectMetadata.mock.calls[0]?.[0]).toEqual({
      treePath: TREE_PATH,
      updates: { description: 'what it tracks' },
    })
    expect(ports.registerProject.mock.calls.length).toBe(0)
  })

  it('CASE 9 — LP_REGISTER: all four prior steps done ⇒ completedSteps carries them all + the four-sentence note', async () => {
    const input: CreateLocalResearchProjectInput = { ...BASE_INPUT, description: 'what it tracks' }
    const { ports, svc } = makePorts({
      registerProject: async () => {
        throw new Error('registry commit failed (hub gone)')
      },
    })
    const out = await svc.createLocalResearchProject(input)
    const f = asFailure(out, 'CASE 9')
    expect(f).toMatchObject({
      code: 'LP_REGISTER',
      failedStep: 'register',
      completedSteps: ['mkdir', 'gitInit', 'scaffold', 'metadata'],
    })
    expect(f.partialChangeNote).toContain(`The tree directory ${TREE_PATH} was created`)
    expect(f.partialChangeNote).toContain(`git was initialized at ${WS}`)
    expect(f.partialChangeNote).toContain('the research tree was scaffolded (project PRJ-7)')
    expect(f.partialChangeNote).toContain('the project metadata was written')
    expect(f.detail).toContain('registry commit failed (hub gone)')
    expect(ports.registerProject.mock.calls.length).toBe(1)
  })
})

describe('local-project — createLocalResearchProject: the success arm (strict DTO + step order)', () => {
  it('CASE 10 — all steps happy ⇒ ok:true with the exact key set, the registration identity + the full step order', async () => {
    const order: string[] = []
    const input: CreateLocalResearchProjectInput = {
      ...BASE_INPUT,
      description: 'what it tracks',
      importance: 4,
      attentionMode: 'FOCUS',
      targetDate: '2026-12-31',
    }
    const { ports, svc } = makePorts({
      mkdirTree: () => {
        order.push('mkdir')
      },
      initGit: async () => {
        order.push('gitInit')
      },
      scaffoldTree: () => {
        order.push('scaffold')
        return { projectId: 'PRJ-7', treePath: TREE_PATH }
      },
      writeProjectMetadata: () => {
        order.push('metadata')
      },
      registerProject: async () => {
        order.push('register')
        return { projectId: 'PRJ-7', registryPath: '/registry/projects.yaml', dbMigrated: false }
      },
    })
    const out = await svc.createLocalResearchProject(input)
    const s = asSuccess(out, 'CASE 10')
    expect(Object.keys(s).sort()).toEqual(['dbMigrated', 'ok', 'projectId', 'registryPath', 'treePath'])
    expect(s).toEqual({
      ok: true,
      projectId: 'PRJ-7',
      treePath: TREE_PATH,
      registryPath: '/registry/projects.yaml',
      dbMigrated: false,
    })
    expect(order, 'the step order is frozen: mkdir → gitInit → scaffold → metadata → register').toEqual([
      'mkdir',
      'gitInit',
      'scaffold',
      'metadata',
      'register',
    ])
    expect(ports.writeProjectMetadata.mock.calls[0]?.[0]).toEqual({
      treePath: TREE_PATH,
      updates: {
        description: 'what it tracks',
        importance: 4,
        attentionMode: 'FOCUS',
        targetDate: '2026-12-31',
      },
    })
    expect(ports.registerProject.mock.calls[0]?.[0]).toEqual({ wsPath: path.resolve(WS), displayName: 'T67 local project' })
    expect(ports.knownProjectIds.mock.calls.length, 'the scaffold allocator seed is consulted').toBe(1)
    for (const key of STEP_PORTS) {
      expect(ports[key].mock.calls.length, `CASE 10: ${key} must run exactly once`).toBe(1)
    }
  })
})
