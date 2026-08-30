/**
 * WP-4.1a — per-RPC positive cases for the host 13-RPC face:
 * each `@Remote` method must (a) forward the ZOD-DECODED args to the
 * injected `ResearchRpcServices` port, and (b) pass the port's result
 * through verbatim (the gateway's strict result decode is emulated by
 * re-parsing the returned value against the shared strict schema — the
 * same schema instance the descriptor's result codec carries).
 *
 * Scope (per WP-4.1a brief):
 *  - 13 positive cases (stub service asserts forwarded args/return);
 *  - zod negatives: bad params are rejected at the method boundary
 *    (missing required / wrong shape / off-vocabulary / strict unknown
 *    keys) BEFORE anything reaches the port;
 *  - spike mode: without the wiring (and no injected stub) all 13
 *    methods fail loud while `ping` (the 14th diagnostic method) serves.
 *
 * The service instance is built with the WP-4.1a constructor seam
 * (optional 3rd argument) — NO cordis App, no [Service.init], the stub
 * replaces the production port exactly where the method body forwards.
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import {
  ProductionResearchRpcServices,
  type ResearchRpcServices,
} from '../../src/host/dsh-adapter/host/rpc-services.js'
import {
  DashboardSnapshotSchema,
  DismissPlanForkResultSchema,
  GetGitHistoryResultSchema,
  ProjectSnapshotSchema,
  QueryHistoryResultSchema,
  RESEARCH_RPC_METHODS,
  ReorderPlanResultSchema,
  RegisterInteractionResultSchema,
  RestoreDeclarativeFileResultSchema,
  SaveResearchCheckpointResultSchema,
  SelectPlanForkResultSchema,
  TopicSnapshotSchema,
  UpdateInterventionStateResultSchema,
  WorkstreamSnapshotSchema,
  type GetTopicArgs,
  type QueryHistoryArgs,
} from '../../src/shared/rpc-contracts.js'
import {
  CHECKPOINT_FIXTURE,
  DISMISS_FIXTURE,
  DASHBOARD_FIXTURE,
  GIT_HISTORY_FIXTURE,
  HISTORY_FIXTURE,
  PROJECT_FIXTURE,
  REORDER_FIXTURE,
  REGISTER_INTERACTION_FIXTURE,
  RESTORE_FIXTURE,
  SELECT_FIXTURE,
  TOPIC_FIXTURE,
  UPDATE_INTERVENTION_FIXTURE,
  WORKSTREAM_FIXTURE,
} from './fixtures.js'

/** Minimal context double (construction wiring only — mirrors rpc-spike.test.ts). */
function minimalCtx(): Context {
  return {
    reflect: { provide: () => undefined },
    effect: () => ({}),
  } as unknown as Context
}

/** A recorded stub of the RPC service port (the test's "stub service"). */
function makeStub(): { stub: ResearchRpcServices; calls: Map<string, unknown[]> } {
  const calls = new Map<string, unknown[]>()
  const record = (name: string) =>
    (args?: unknown) => {
      calls.set(name, args === undefined ? [] : [args])
    }
  // The port is async for the two query RPCs that carry the WP-4.6
  // stale pre-check (getDashboard/getWorkstream) and for the write side;
  // sync for the remaining reads (matching ResearchRpcServices exactly).
  const stub: ResearchRpcServices = {
    async getDashboard() {
      record('getDashboard')()
      return DASHBOARD_FIXTURE
    },
    getProject() {
      record('getProject')()
      return PROJECT_FIXTURE
    },
    getTopic(a: GetTopicArgs) {
      record('getTopic')(a)
      return TOPIC_FIXTURE
    },
    async getWorkstream(a) {
      record('getWorkstream')(a)
      return WORKSTREAM_FIXTURE
    },
    queryHistory(a: QueryHistoryArgs) {
      record('queryHistory')(a)
      return HISTORY_FIXTURE
    },
    reorderPlan(a) {
      record('reorderPlan')(a)
      return REORDER_FIXTURE
    },
    async selectPlanFork(a) {
      record('selectPlanFork')(a)
      return SELECT_FIXTURE
    },
    async dismissPlanFork(a) {
      record('dismissPlanFork')(a)
      return DISMISS_FIXTURE
    },
    // UI-4 (D §10): the 7 attention-face port methods. This frozen-13
    // suite never invokes them (they are not in `cases`); the entries
    // exist so the stub satisfies the extended `ResearchRpcServices`
    // port exactly (the type-level no-drift rule). Parameters/results
    // resolve contextually from the port (the mid-literal position
    // keeps the pre-existing TS2740 preview's head/tail members stable).
    async getWorkstreamCurrent(a) {
      record('getWorkstreamCurrent')(a)
      return {
        workstreamId: a.workstreamId,
        objectives: [],
        explicitBlockers: [],
        derivedBlockers: [],
        nextActions: [],
        interventions: [],
        dependencyEdges: [],
      }
    },
    async updateObjective(a) {
      record('updateObjective')(a)
      return {
        objectiveId: a.objectiveId,
        status: a.status ?? 'ACTIVE',
        managementActionId: 'MA-1',
        updatedAt: 1,
      }
    },
    async createNextAction(a) {
      record('createNextAction')(a)
      return {
        nextAction: {
          id: 'NA-1',
          workstreamId: a.workstreamId ?? null,
          statement: a.statement,
          rationale: a.rationale ?? null,
          status: 'PROPOSED',
          promotedToTaskId: null,
          createdAt: 1,
        },
      }
    },
    async promoteNextAction(a) {
      record('promoteNextAction')(a)
      return {
        nextActionId: a.nextActionId,
        taskId: 'T-1',
        workstreamId: a.workstreamId ?? 'WS-1',
        planPath: 'workstreams/WS-1/plan.yaml',
        newOrder: ['T-1'],
        managementActionId: 'MA-1',
      }
    },
    async dismissNextAction(a) {
      record('dismissNextAction')(a)
      return {
        nextAction: {
          id: a.nextActionId,
          workstreamId: null,
          statement: 's',
          rationale: null,
          status: 'DISMISSED',
          promotedToTaskId: null,
          createdAt: 1,
        },
      }
    },
    async createBlocker(a) {
      record('createBlocker')(a)
      return {
        blocker: {
          id: 'BLK-1',
          statement: a.statement,
          affects: a.affects,
          status: 'ACTIVE',
          source: a.source,
          references: a.references ?? null,
          createdAt: 1,
          clearedAt: null,
        },
      }
    },
    async clearBlocker(a) {
      record('clearBlocker')(a)
      return {
        blocker: {
          id: a.blockerId,
          statement: 's',
          affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
          status: 'CLEARED',
          source: 's',
          references: null,
          createdAt: 1,
          clearedAt: 1,
        },
      }
    },
    // UI-5 (brief §3): the 5 plan-editor face port methods (the same
    // type-level no-drift rule as the UI-4 entries — this frozen-13
    // suite never invokes them).
    async createPlanItem(a) {
      record('createPlanItem')(a)
      return {
        itemId: 'T-9',
        workstreamId: a.workstreamId,
        kind: a.kind,
        planPath: 'workstreams/WS-1/plan.yaml',
        newOrder: ['T-9'],
        managementActionId: 'MA-1',
      }
    },
    async updatePlanItem(a) {
      record('updatePlanItem')(a)
      return {
        itemId: a.itemId,
        workstreamId: a.workstreamId,
        updatedAt: 1,
      }
    },
    async removePlanItem(a) {
      record('removePlanItem')(a)
      return {
        workstreamId: a.workstreamId,
        planPath: 'workstreams/WS-1/plan.yaml',
        newOrder: [],
        managementActionId: 'MA-1',
        currentFocusCleared: false,
      }
    },
    async addDependency(a) {
      record('addDependency')(a)
      return {
        relationId: 'REL-1',
        source: a.source,
        target: a.target,
      }
    },
    async removeDependency(a) {
      record('removeDependency')(a)
      return { relationId: a.relationId }
    },
    updateInterventionState(a) {
      record('updateInterventionState')(a)
      return UPDATE_INTERVENTION_FIXTURE
    },
    async registerInteraction(a) {
      record('registerInteraction')(a)
      return REGISTER_INTERACTION_FIXTURE
    },
    async saveResearchCheckpoint(a) {
      record('saveResearchCheckpoint')(a)
      return CHECKPOINT_FIXTURE
    },
    async getGitHistory(a) {
      record('getGitHistory')(a)
      return GIT_HISTORY_FIXTURE
    },
    async restoreDeclarativeFile(a) {
      record('restoreDeclarativeFile')(a)
      return RESTORE_FIXTURE
    },
  }
  return { stub, calls }
}

function makeService(stub: ResearchRpcServices): ResearchControlService {
  return new ResearchControlService(minimalCtx(), {}, stub)
}

/** One positive case: call → recorded forwarded args → wire-valid result. */
interface RpcCase {
  readonly method: (typeof RESEARCH_RPC_METHODS)[number]
  readonly invoke: (svc: ResearchControlService) => Promise<unknown>
  /** The args the method body must forward AFTER the zod decode. */
  readonly expectedArgs: readonly unknown[]
  readonly fixture: unknown
  readonly resultSchema: { parse(value: unknown): unknown }
}

const cases: readonly RpcCase[] = [
  {
    method: 'getDashboard',
    invoke: (svc) => svc.getDashboard(),
    expectedArgs: [],
    fixture: DASHBOARD_FIXTURE,
    resultSchema: DashboardSnapshotSchema,
  },
  {
    method: 'getProject',
    invoke: (svc) => svc.getProject(),
    expectedArgs: [],
    fixture: PROJECT_FIXTURE,
    resultSchema: ProjectSnapshotSchema,
  },
  {
    method: 'getTopic',
    invoke: (svc) => svc.getTopic({ topicId: 'TPC-1' }),
    expectedArgs: [{ topicId: 'TPC-1' }],
    fixture: TOPIC_FIXTURE,
    resultSchema: TopicSnapshotSchema,
  },
  {
    method: 'getWorkstream',
    invoke: (svc) => svc.getWorkstream({ workstreamId: 'WS-1' }),
    expectedArgs: [{ workstreamId: 'WS-1' }],
    fixture: WORKSTREAM_FIXTURE,
    resultSchema: WorkstreamSnapshotSchema,
  },
  {
    method: 'queryHistory',
    invoke: (svc) =>
      svc.queryHistory({ workstreamId: 'WS-1', order: 'audit', afterSeq: 0, beforeSeq: 100, limit: 50 }),
    expectedArgs: [{ workstreamId: 'WS-1', order: 'audit', afterSeq: 0, beforeSeq: 100, limit: 50 }],
    fixture: HISTORY_FIXTURE,
    resultSchema: QueryHistoryResultSchema,
  },
  {
    method: 'reorderPlan',
    invoke: (svc) => svc.reorderPlan({ workstreamId: 'WS-1', orderedItemIds: ['G-1', 'M-1', 'T-1'] }),
    expectedArgs: [{ workstreamId: 'WS-1', orderedItemIds: ['G-1', 'M-1', 'T-1'] }],
    fixture: REORDER_FIXTURE,
    resultSchema: ReorderPlanResultSchema,
  },
  {
    method: 'selectPlanFork',
    invoke: (svc) => svc.selectPlanFork({ planForkId: 'PF-1' }),
    expectedArgs: [{ planForkId: 'PF-1' }],
    fixture: SELECT_FIXTURE,
    resultSchema: SelectPlanForkResultSchema,
  },
  {
    method: 'dismissPlanFork',
    invoke: (svc) => svc.dismissPlanFork({ planForkId: 'PF-3' }),
    expectedArgs: [{ planForkId: 'PF-3' }],
    fixture: DISMISS_FIXTURE,
    resultSchema: DismissPlanForkResultSchema,
  },
  {
    method: 'updateInterventionState',
    invoke: (svc) =>
      svc.updateInterventionState({ interventionId: 'IV-1', status: 'CLOSED', resolutionNote: 'reviewed and resolved' }),
    expectedArgs: [{ interventionId: 'IV-1', status: 'CLOSED', resolutionNote: 'reviewed and resolved' }],
    fixture: UPDATE_INTERVENTION_FIXTURE,
    resultSchema: UpdateInterventionStateResultSchema,
  },
  {
    method: 'registerInteraction',
    invoke: (svc) =>
      svc.registerInteraction({
        kind: 'MEETING',
        title: 'Supervisor sync',
        occurredAt: 1755000000000,
        participants: ['alice'],
        relatedWorkstreams: ['WS-1'],
      }),
    expectedArgs: [
      {
        kind: 'MEETING',
        title: 'Supervisor sync',
        occurredAt: 1755000000000,
        participants: ['alice'],
        relatedWorkstreams: ['WS-1'],
      },
    ],
    fixture: REGISTER_INTERACTION_FIXTURE,
    resultSchema: RegisterInteractionResultSchema,
  },
  {
    method: 'saveResearchCheckpoint',
    invoke: (svc) => svc.saveResearchCheckpoint({ summary: 'save progress' }),
    expectedArgs: [{ summary: 'save progress' }],
    fixture: CHECKPOINT_FIXTURE,
    resultSchema: SaveResearchCheckpointResultSchema,
  },
  {
    method: 'getGitHistory',
    invoke: (svc) => svc.getGitHistory({ maxCount: 50, skip: 10 }),
    expectedArgs: [{ maxCount: 50, skip: 10 }],
    fixture: GIT_HISTORY_FIXTURE,
    resultSchema: GetGitHistoryResultSchema,
  },
  {
    method: 'restoreDeclarativeFile',
    invoke: (svc) =>
      svc.restoreDeclarativeFile({ commitOid: 'a'.repeat(40), path: '.research/project.yaml' }),
    expectedArgs: [{ commitOid: 'a'.repeat(40), path: '.research/project.yaml' }],
    fixture: RESTORE_FIXTURE,
    resultSchema: RestoreDeclarativeFileResultSchema,
  },
]

describe('WP-4.1a host RPC face — 13 positive cases (stub service)', () => {
  for (const c of cases) {
    it(`forwards ${c.method}: decoded args reach the port, result passes through wire-valid`, async () => {
      const { stub, calls } = makeStub()
      const svc = makeService(stub)
      const result = await c.invoke(svc)
      // (a) the exact decoded args were forwarded (nothing else called).
      expect([...calls.keys()]).toEqual([c.method])
      expect(calls.get(c.method)).toEqual(c.expectedArgs)
      // (b) the result is exactly the port's value AND it is wire-valid:
      // the gateway strict-decodes it through the descriptor's result codec
      // (the shared schema) — emulate that decode here.
      expect(result).toBe(c.fixture)
      expect(c.resultSchema.parse(result)).toEqual(c.fixture)
    })
  }

  it('ping stays the 14th diagnostic method (unchanged WP-0.3 contract)', async () => {
    const { stub } = makeStub()
    const svc = makeService(stub)
    const result = await svc.ping()
    expect(result.ok).toBe(true)
    expect(result.service).toBe('researchControl')
    expect(typeof result.time).toBe('number')
  })

  it('spike mode (no wiring, no stub): all 13 methods fail loud, ping still serves', async () => {
    const svc = new ResearchControlService(minimalCtx(), {})
    for (const c of cases) {
      await expect(c.invoke(svc)).rejects.toThrow(/not initialized \(spike mode\)/)
    }
    await expect(svc.ping()).resolves.toMatchObject({ ok: true, service: 'researchControl' })
  })
})

describe('WP-4.1a host RPC face — zod negatives (bad params rejected at the boundary)', () => {
  /** Each case: the bad wire args + what the rejection must name. */
  const negatives: readonly { method: string; bad: unknown; named: RegExp }[] = [
    { method: 'getTopic', bad: {}, named: /topicId/ },
    { method: 'getTopic', bad: { topicId: 'TPC-1', surprise: 1 }, named: /surprise/ },
    { method: 'getTopic', bad: { topicId: 'ws-1' }, named: /TPC/ },
    { method: 'getWorkstream', bad: { workstreamId: 'WS-0' }, named: /WS/ },
    { method: 'getWorkstream', bad: { workstreamId: 7 }, named: /workstreamId/ },
    { method: 'queryHistory', bad: { workstreamId: 'WS-1', afterSeq: -1 }, named: /afterSeq/ },
    { method: 'queryHistory', bad: { workstreamId: 'WS-1', order: 'reverse' }, named: /order/ },
    { method: 'queryHistory', bad: { workstreamId: 'WS-1', limit: 0.5 }, named: /limit/ },
    { method: 'reorderPlan', bad: { workstreamId: 'WS-1', orderedItemIds: 'T-1' }, named: /orderedItemIds/ },
    { method: 'selectPlanFork', bad: { planForkId: 'PF-0' }, named: /PF/ },
    { method: 'dismissPlanFork', bad: { planForkId: 42 }, named: /planForkId/ },
    { method: 'updateInterventionState', bad: { interventionId: 'IV-1', status: 'DONE' }, named: /status/ },
    { method: 'updateInterventionState', bad: { interventionId: 'IV-1', status: 'CLOSED', resolutionNote: 3 }, named: /resolutionNote/ },
    { method: 'registerInteraction', bad: { kind: 'CALL', title: 'x', occurredAt: 1 }, named: /kind/ },
    { method: 'registerInteraction', bad: { kind: 'MEETING', title: '', occurredAt: 1 }, named: /title/ },
    { method: 'registerInteraction', bad: { kind: 'MEETING', title: 'x', occurredAt: 'yesterday' }, named: /occurredAt/ },
    { method: 'saveResearchCheckpoint', bad: { summary: '' }, named: /summary/ },
    { method: 'saveResearchCheckpoint', bad: { summary: 'ok', extra: true }, named: /extra/ },
    { method: 'getGitHistory', bad: { baseline: 'short' }, named: /baseline/ },
    { method: 'getGitHistory', bad: { maxCount: 0 }, named: /maxCount/ },
    { method: 'restoreDeclarativeFile', bad: { commitOid: 'xyz', path: '.research/project.yaml' }, named: /commitOid/ },
    { method: 'restoreDeclarativeFile', bad: { commitOid: 'a'.repeat(40) }, named: /path/ },
    // V2-UI-0.4 UI-5 (brief §3): the 5 plan-editor faces reject bad wire
    // args at the boundary (strict shapes + frozen id patterns).
    { method: 'createPlanItem', bad: { workstreamId: 'WS-1', kind: 'TASK' }, named: /item/ },
    { method: 'createPlanItem', bad: { workstreamId: 'WS-1', kind: 'STEP', item: { task: { title: 'x' } } }, named: /kind/ },
    { method: 'createPlanItem', bad: { workstreamId: 'WS-1', kind: 'TASK', item: { task: { title: '' } } }, named: /title/ },
    { method: 'createPlanItem', bad: { workstreamId: 'WS-1', kind: 'TASK', item: { task: { title: 'x', surprise: 1 } } }, named: /surprise/ },
    { method: 'updatePlanItem', bad: { workstreamId: 'WS-1', itemId: 'T-1', changes: { surprise: 1 } }, named: /surprise/ },
    { method: 'updatePlanItem', bad: { workstreamId: 'WS-1', itemId: 'T-1', changes: { goal: 3 } }, named: /goal/ },
    { method: 'removePlanItem', bad: { workstreamId: 'WS-1', itemId: 'T-0' }, named: /T-/ },
    { method: 'addDependency', bad: { workstreamId: 'WS-1', source: { kind: 'TASK', id: 'T-1' }, target: { kind: 'EPIC', id: 'T-2' } }, named: /kind/ },
    { method: 'removeDependency', bad: { workstreamId: 'WS-1', relationId: 'REL-0' }, named: /REL/ },
  ]

  for (const n of negatives) {
    it(`${n.method} rejects ${JSON.stringify(n.bad)}`, async () => {
      const { stub, calls } = makeStub()
      const svc = makeService(stub)
      const invoke = (svc as unknown as Record<string, (a: unknown) => Promise<unknown>>)[n.method].bind(svc)
      await expect(invoke(n.bad)).rejects.toThrow(n.named)
      // The bad args never reach the port.
      expect(calls.get(n.method)).toBeUndefined()
    })
  }

  it('strict result schemas reject off-contract results (unknown keys)', () => {
    // The gateway strict-decodes host results; a facade that leaks an extra
    // key must fail loud at the boundary, not ship a widened contract.
    expect(() => DashboardSnapshotSchema.parse({ ...DASHBOARD_FIXTURE, surprise: 1 })).toThrow()
    expect(() => QueryHistoryResultSchema.parse({ ...HISTORY_FIXTURE, events: null })).toThrow()
    expect(() => ReorderPlanResultSchema.parse({ ...REORDER_FIXTURE, managementActionId: 'MA-0' })).toThrow()
    // …and the PHASE 5 placeholders are pinned to null (never fabricated).
    expect(() =>
      DashboardSnapshotSchema.parse({ ...DASHBOARD_FIXTURE, scheduledEvents: [{ id: 'SEV-1' }] }),
    ).toThrow()
    expect(() => ProjectSnapshotSchema.parse({ ...PROJECT_FIXTURE, upcomingInteractions: [] })).toThrow()
  })
})

/**
 * The production implementation (as opposed to the test stub) must carry
 * the full port surface — a future edit that drops a method (or the
 * disposer the dsh-adapter registers) fails here.
 */
describe('WP-4.1a host RPC face — production port surface', () => {
  it('ProductionResearchRpcServices exposes all 13 port methods + the disposer', () => {
    const names = new Set(
      Object.getOwnPropertyNames(ProductionResearchRpcServices.prototype).filter((n) => n !== 'constructor'),
    )
    for (const method of RESEARCH_RPC_METHODS) {
      expect(names.has(method), `port method ${method} missing on the production implementation`).toBe(true)
    }
    expect(typeof ProductionResearchRpcServices.prototype.close).toBe('function')
  })
})
