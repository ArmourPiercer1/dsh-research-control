/**
 * V2-T3.1 — contract-layer tests for the 9-RPC research plane face
 * (design §12) + the §12.1 optional `projectId` on the 13 frozen request
 * schemas.
 *
 * Scope (T3.1 = 纯契约，无实现逻辑 — no `@Remote` methods, no service-
 * port wiring, no artifact registration yet; those land in T3.2):
 *  - DESCRIPTOR MIRROR CONSISTENCY: the 9 hand-written descriptors carry
 *    the frozen conventions (id grammar, direct receiver, no
 *    cancellation) and their strict codecs bind the SAME shared schema
 *    instances as the named exports — the mirror-identity rule the
 *    manifest test applies to the frozen 13;
 *  - ARITY: every plane method carries exactly ONE `args` json parameter
 *    (the flat parameter face — including `getHubOverview`/`rescan`,
 *    whose request object is the EMPTY strict object);
 *  - PER-METHOD SCHEMA REJECTION PATHS: missing field / extra field /
 *    type error for each of the 9 (the applicable classes per method),
 *    plus WIRE-VALID success paths (the fixture re-parse emulates the
 *    gateway's strict result decode);
 *  - §12.1 COMPATIBILITY: every one of the 11 parameterized frozen
 *    request schemas still parses its OLD shape byte-identically (the
 *    existing suite's request constructions, 逐个补验), gains the
 *    optional pattern-checked `projectId`, and the 13 RESULT schemas
 *    stay zero-touched (a `projectId` injected into ANY result is
 *    rejected — the strict schemas keep the frozen result shapes exact);
 *  - the PLANE_* named error family: closed 13-code vocabulary, every
 *    design §12 拒绝分支 named, the code embedded in the message (the
 *    wire carrier).
 */

import { isTypertRemoteSegment } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import {
  AckMissingReminderArgsSchema,
  AckMissingReminderResultSchema,
  ALL_RESEARCH_INVOCATIONS,
  RESEARCH_MANAGEMENT_RPC_METHODS,
  REGISTERED_RESEARCH_INVOCATIONS,
  type BindProjectArgs,
  BindProjectArgsSchema,
  BindProjectResultSchema,
  type GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsArgsSchema,
  GetPortfolioInterventionsResultSchema,
  type GetResearchPlaneStateArgs,
  GetResearchPlaneStateArgsSchema,
  GetResearchPlaneStateResultSchema,
  type GetHubOverviewArgs,
  GetHubOverviewArgsSchema,
  HubOverviewResultSchema,
  type GetTopicArgs,
  GetTopicArgsSchema,
  type GetWorkstreamArgs,
  GetWorkstreamArgsSchema,
  type InvocationDescriptorMirror,
  type PlaneErrorCode,
  PlaneError,
  PLANE_ERROR_CODES,
  type TypertCodecMirror,
  QueryHistoryArgsSchema,
  ReorderPlanArgsSchema,
  RestoreDeclarativeFileArgsSchema,
  type RescanArgs,
  RescanArgsSchema,
  RescanResultSchema,
  type RestoreProjectArgs,
  RestoreProjectArgsSchema,
  RestoreProjectResultSchema,
  type SetHubArgs,
  SetHubArgsSchema,
  SetHubResultSchema,
  type UnbindProjectArgs,
  UnbindProjectArgsSchema,
  UnbindProjectResultSchema,
  RESEARCH_PLANE_INVOCATIONS,
  RESEARCH_PLANE_RPC_METHODS,
  RESEARCH_RPC_METHODS,
  type TypertSchemaLike,
  DismissPlanForkArgsSchema,
  DismissPlanForkResultSchema,
  GetGitHistoryArgsSchema,
  GetGitHistoryResultSchema,
  RegisterInteractionArgsSchema,
  RegisterInteractionResultSchema,
  SaveResearchCheckpointArgsSchema,
  SaveResearchCheckpointResultSchema,
  SelectPlanForkArgsSchema,
  SelectPlanForkResultSchema,
  UpdateInterventionStateArgsSchema,
  UpdateInterventionStateResultSchema,
  DashboardSnapshotSchema,
  ProjectSnapshotSchema,
  TopicSnapshotSchema,
  WorkstreamSnapshotSchema,
  QueryHistoryResultSchema,
  ReorderPlanResultSchema,
  RestoreDeclarativeFileResultSchema,
} from '../../src/shared/rpc-contracts.js'
import {
  DASHBOARD_FIXTURE,
  DISMISS_FIXTURE,
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
  CHECKPOINT_FIXTURE,
} from './fixtures.js'
import {
  ACK_MISSING_REMINDER_FIXTURE,
  BIND_PROJECT_FIXTURE,
  BIND_PROJECT_STANDALONE_FIXTURE,
  HUB_OVERVIEW_FIXTURE,
  PLANE_STATE_EMPTY_FIXTURE,
  PLANE_STATE_FIXTURE,
  PLANE_STATE_HUB_TREE_FIXTURE,
  PLANE_STATE_UNREGISTERED_SESSION_FIXTURE,
  PORTFOLIO_INTERVENTIONS_FIXTURE,
  RESCAN_FIXTURE,
  RESTORE_PROJECT_FIXTURE,
  SET_HUB_FIXTURE,
  UNBIND_PROJECT_FIXTURE,
} from './plane-fixtures.js'

/* ===================================================================== *
 * A. Descriptor mirror consistency + the flat `args` parameter face
 * ===================================================================== */

/** The shared args-schema instances the codecs must bind (identity). */
const planeArgsSchemas: Readonly<Record<string, TypertSchemaLike>> = {
  getResearchPlaneState: GetResearchPlaneStateArgsSchema,
  getHubOverview: GetHubOverviewArgsSchema,
  getPortfolioInterventions: GetPortfolioInterventionsArgsSchema,
  setHub: SetHubArgsSchema,
  bindProject: BindProjectArgsSchema,
  unbindProject: UnbindProjectArgsSchema,
  restoreProject: RestoreProjectArgsSchema,
  rescan: RescanArgsSchema,
  ackMissingReminder: AckMissingReminderArgsSchema,
}

/** The codec typeSymbol each args codec carries (the named schema export). */
const planeArgsSymbols: Readonly<Record<string, string>> = {
  getResearchPlaneState: 'GetResearchPlaneStateArgs',
  getHubOverview: 'GetHubOverviewArgs',
  getPortfolioInterventions: 'GetPortfolioInterventionsArgs',
  setHub: 'SetHubArgs',
  bindProject: 'BindProjectArgs',
  unbindProject: 'UnbindProjectArgs',
  restoreProject: 'RestoreProjectArgs',
  rescan: 'RescanArgs',
  ackMissingReminder: 'AckMissingReminderArgs',
}

/** The shared result-schema instances the result codecs must bind (identity). */
const planeResultSchemas: Readonly<Record<string, TypertSchemaLike>> = {
  getResearchPlaneState: GetResearchPlaneStateResultSchema,
  getHubOverview: HubOverviewResultSchema,
  getPortfolioInterventions: GetPortfolioInterventionsResultSchema,
  setHub: SetHubResultSchema,
  bindProject: BindProjectResultSchema,
  unbindProject: UnbindProjectResultSchema,
  restoreProject: RestoreProjectResultSchema,
  rescan: RescanResultSchema,
  ackMissingReminder: AckMissingReminderResultSchema,
}

const planeResultSymbols: Readonly<Record<string, string>> = {
  getResearchPlaneState: 'GetResearchPlaneStateResult',
  getHubOverview: 'HubOverviewResult',
  getPortfolioInterventions: 'GetPortfolioInterventionsResult',
  setHub: 'SetHubResult',
  bindProject: 'BindProjectResult',
  unbindProject: 'UnbindProjectResult',
  restoreProject: 'RestoreProjectResult',
  rescan: 'RescanResult',
  ackMissingReminder: 'AckMissingReminderResult',
}

/** Narrow a descriptor codec to its strict arm (the manifest-test pattern). */
function strictCodec(codec: TypertCodecMirror): Extract<TypertCodecMirror, { mode: 'strict' }> {
  if (codec.mode !== 'strict') throw new Error(`expected strict codec, got ${codec.mode}`)
  return codec
}

describe('V2-T3.1 descriptor mirror consistency — the 9 plane descriptors', () => {
  it('RESEARCH_PLANE_RPC_METHODS is exactly the 9 design §12 names, in table order', () => {
    expect(RESEARCH_PLANE_RPC_METHODS).toEqual([
      'getResearchPlaneState',
      'getHubOverview',
      'getPortfolioInterventions',
      'setHub',
      'bindProject',
      'unbindProject',
      'restoreProject',
      'rescan',
      'ackMissingReminder',
    ])
  })

  it('RESEARCH_PLANE_INVOCATIONS matches the method list 1:1, in order', () => {
    expect(RESEARCH_PLANE_INVOCATIONS.map((d) => d.method)).toEqual([...RESEARCH_PLANE_RPC_METHODS])
    expect(new Set(RESEARCH_PLANE_INVOCATIONS.map((d) => d.id)).size).toBe(9)
  })

  for (const d of RESEARCH_PLANE_INVOCATIONS) {
    it(`${d.method}: id grammar + direct receiver + no cancellation + wire-segment grammar`, () => {
      expect(d.id).toBe(`researchControl#researchControl/${d.method}`)
      expect(d.service).toBe('researchControl')
      expect(d.namespace).toBe('researchControl')
      expect(d.invocation).toEqual({ kind: 'direct' })
      expect(d.cancellation).toBeUndefined()
      expect(d.sourceLocation).toBeUndefined()
      expect(isTypertRemoteSegment(d.method), `${d.method} must survive the carrier segment grammar`).toBe(true)
    })

    it(`${d.method}: arity — exactly one "args" json parameter (the flat face, design §12 {} shapes included)`, () => {
      expect(d.parameters, `${d.method} must carry exactly one args parameter`).toHaveLength(1)
      const p = d.parameters[0]
      expect(p.name, `${d.method} parameter name`).toBe('args')
      expect(p.wire, `${d.method} wire field`).toBe('args')
      expect(p.source, `${d.method} parameter source`).toBe('json')
      expect(p.codec.mode, `${d.method} codec mode`).toBe('strict')
      const codec = strictCodec(p.codec)
      // Mirror identity: the codec carries the SAME shared schema instance
      // (the no-drift-by-construction rule, applied at the contract layer).
      expect(codec.typeSymbol, `${d.method} args typeSymbol`).toBe(planeArgsSymbols[d.method])
      expect(codec.schema, `${d.method} args codec must be the shared schema instance`).toBe(
        planeArgsSchemas[d.method],
      )
      expect('_zod' in (codec.schema as object), `${d.method} args codec zod brand`).toBe(true)
    })

    it(`${d.method}: the result codec binds the shared result schema (mirror identity)`, () => {
      expect(d.result.mode, `${d.method} result codec mode`).toBe('strict')
      const result = strictCodec(d.result)
      expect(result.typeSymbol, `${d.method} result typeSymbol`).toBe(planeResultSymbols[d.method])
      expect(result.schema, `${d.method} result codec must be the shared schema instance`).toBe(
        planeResultSchemas[d.method],
      )
      expect('_zod' in (result.schema as object), `${d.method} result codec zod brand`).toBe(true)
    })
  }

  it('the frozen 14 stays untouched: ALL_RESEARCH_INVOCATIONS is still ping + the 13 (V2-T3.2a: the frozen list is the FROZEN face — the artifact faces register the SUPERSET)', () => {
    expect(ALL_RESEARCH_INVOCATIONS).toHaveLength(14)
    expect(ALL_RESEARCH_INVOCATIONS.map((d) => d.method)).toEqual(['ping', ...RESEARCH_RPC_METHODS])
    // The plane face is disjoint from the frozen face (no method-name collision).
    const frozen = new Set(ALL_RESEARCH_INVOCATIONS.map((d) => d.method))
    for (const name of RESEARCH_PLANE_RPC_METHODS) {
      expect(frozen.has(name), `plane method ${name} must not collide with the frozen face`).toBe(false)
    }
  })

  it('V2-T3.2b + UI-0.4 + UI-2 + UI-4 + UI-5 + V2-UI-6 D1+D2+D3: the REGISTERED face is the frozen 14 + all 9 plane RPCs + the 27 management RPCs (15 GUI (incl. the 5 V2-UI-6 topology/contract RPCs) + 7 attention + 5 plan-editor — the 6 change-family plane RPCs registered with their @Remote bodies)', () => {
    expect(REGISTERED_RESEARCH_INVOCATIONS).toHaveLength(50)
    expect(REGISTERED_RESEARCH_INVOCATIONS.map((d) => d.method)).toEqual([
      'ping',
      ...RESEARCH_RPC_METHODS,
      'getResearchPlaneState',
      'getHubOverview',
      'getPortfolioInterventions',
      'setHub',
      'bindProject',
      'unbindProject',
      'restoreProject',
      'rescan',
      'ackMissingReminder',
      ...RESEARCH_MANAGEMENT_RPC_METHODS,
    ])
    // The 6 change-family plane RPCs ARE registered now: each descriptor
    // pairs with a live @Remote body in the host service (design §12),
    // so the full 9-RPC plane face is dispatchable.
    const registered = new Set(REGISTERED_RESEARCH_INVOCATIONS.map((d) => d.method))
    for (const name of RESEARCH_PLANE_RPC_METHODS) {
      expect(registered.has(name), `plane method ${name} must be registered`).toBe(true)
    }
    // The management face is disjoint from the frozen + plane faces too.
    for (const name of RESEARCH_MANAGEMENT_RPC_METHODS) {
      expect(registered.has(name), `management method ${name} must be registered`).toBe(true)
    }
  })
})

/* ===================================================================== *
 * B. Success paths — wire-valid fixtures + args parse for all 9
 * ===================================================================== */

interface PlaneSuccessCase {
  readonly method: string
  readonly label: string
  readonly args: unknown
  readonly argsSchema: TypertSchemaLike
  readonly fixture: unknown
  readonly resultSchema: TypertSchemaLike
}

const successCases: readonly PlaneSuccessCase[] = [
  {
    method: 'getResearchPlaneState',
    label: 'full plane + HUB session (hubTreeProjectId null — hub carries no own tree)',
    args: { sessionId: 'sess-1' } satisfies GetResearchPlaneStateArgs,
    argsSchema: GetResearchPlaneStateArgsSchema,
    fixture: PLANE_STATE_FIXTURE,
    resultSchema: GetResearchPlaneStateResultSchema,
  },
  {
    method: 'getResearchPlaneState',
    label: 'HUB session with a hub-own tree (hubTreeProjectId attached)',
    args: { sessionId: 'sess-1' },
    argsSchema: GetResearchPlaneStateArgsSchema,
    fixture: PLANE_STATE_HUB_TREE_FIXTURE,
    resultSchema: GetResearchPlaneStateResultSchema,
  },
  {
    method: 'getResearchPlaneState',
    label: 'sessionId omitted → session null (the 设置页① read)',
    args: {},
    argsSchema: GetResearchPlaneStateArgsSchema,
    fixture: PLANE_STATE_EMPTY_FIXTURE,
    resultSchema: GetResearchPlaneStateResultSchema,
  },
  {
    method: 'getResearchPlaneState',
    label: 'UNREGISTERED session (引导卡 role, hubTreeProjectId omitted)',
    args: { sessionId: 'sess-2' },
    argsSchema: GetResearchPlaneStateArgsSchema,
    fixture: PLANE_STATE_UNREGISTERED_SESSION_FIXTURE,
    resultSchema: GetResearchPlaneStateResultSchema,
  },
  {
    method: 'getHubOverview',
    label: '§7.1 aggregation (聚合条 + 需关注行 + 卡墙)',
    args: {} satisfies GetHubOverviewArgs,
    argsSchema: GetHubOverviewArgsSchema,
    fixture: HUB_OVERVIEW_FIXTURE,
    resultSchema: HubOverviewResultSchema,
  },
  {
    method: 'getPortfolioInterventions',
    label: 'cross-project list with the projectId label',
    args: { status: 'OPEN' } satisfies GetPortfolioInterventionsArgs,
    argsSchema: GetPortfolioInterventionsArgsSchema,
    fixture: PORTFOLIO_INTERVENTIONS_FIXTURE,
    resultSchema: GetPortfolioInterventionsResultSchema,
  },
  {
    method: 'setHub',
    label: 'marker + empty registry created',
    args: { wsPath: '/home/u/hub' } satisfies SetHubArgs,
    argsSchema: SetHubArgsSchema,
    fixture: SET_HUB_FIXTURE,
    resultSchema: SetHubResultSchema,
  },
  {
    method: 'bindProject',
    label: 'hub plane: entry appended + standalone db migrated',
    args: { wsPath: '/home/u/ws2', displayName: 'Project Two', scaffold: false } satisfies BindProjectArgs,
    argsSchema: BindProjectArgsSchema,
    fixture: BIND_PROJECT_FIXTURE,
    resultSchema: BindProjectResultSchema,
  },
  {
    method: 'bindProject',
    label: 'no-hub plane: registryPath null (design §8 接入（无中枢）)',
    args: { wsPath: '/home/u/ws4', scaffold: true },
    argsSchema: BindProjectArgsSchema,
    fixture: BIND_PROJECT_STANDALONE_FIXTURE,
    resultSchema: BindProjectResultSchema,
  },
  {
    method: 'unbindProject',
    label: 'entry archived + tree renamed away',
    args: { wsPath: '/home/u/ws1' } satisfies UnbindProjectArgs,
    argsSchema: UnbindProjectArgsSchema,
    fixture: UNBIND_PROJECT_FIXTURE,
    resultSchema: UnbindProjectResultSchema,
  },
  {
    method: 'restoreProject',
    label: 'archived entry revived + tree renamed back',
    args: { projectId: 'PRJ-1' } satisfies RestoreProjectArgs,
    argsSchema: RestoreProjectArgsSchema,
    fixture: RESTORE_PROJECT_FIXTURE,
    resultSchema: RestoreProjectResultSchema,
  },
  {
    method: 'rescan',
    label: 'the plane summary (no session segment)',
    args: {} satisfies RescanArgs,
    argsSchema: RescanArgsSchema,
    fixture: RESCAN_FIXTURE,
    resultSchema: RescanResultSchema,
  },
  {
    method: 'ackMissingReminder',
    label: 'the runtime dedup flag set',
    args: { projectId: 'PRJ-3' },
    argsSchema: AckMissingReminderArgsSchema,
    fixture: ACK_MISSING_REMINDER_FIXTURE,
    resultSchema: AckMissingReminderResultSchema,
  },
]

describe('V2-T3.1 per-method success paths — wire-valid fixtures parse', () => {
  for (const c of successCases) {
    it(`${c.method}: ${c.label}`, () => {
      // The args parse (what the gateway's strict path does to the wire args).
      expect(c.argsSchema.parse(c.args), `${c.method} args must parse`).toEqual(c.args)
      // The fixture re-parses through the strict result schema (the
      // gateway's strict result decode, emulated) — wire validity.
      expect(c.resultSchema.parse(c.fixture), `${c.method} fixture must be wire-valid`).toEqual(c.fixture)
    })
  }
})

/* ===================================================================== *
 * C. Per-method schema rejection paths (missing / extra / type)
 * ===================================================================== */

interface PlaneNegativeCase {
  readonly method: string
  readonly face: 'args' | 'result'
  readonly kind: 'missing' | 'extra' | 'type'
  readonly bad: unknown
  readonly named: RegExp
}

// Pre-built result negatives (key removals need destructuring, not literals).
const { hub: _hubOmitted, ...PLANE_STATE_NO_HUB } = PLANE_STATE_FIXTURE
const { registry: _registryOmitted, ...PLANE_STATE_NO_REGISTRY } = PLANE_STATE_FIXTURE
const { cards: _cardsOmitted, ...HUB_OVERVIEW_NO_CARDS } = HUB_OVERVIEW_FIXTURE
const { items: _itemsOmitted, ...PORTFOLIO_NO_ITEMS } = PORTFOLIO_INTERVENTIONS_FIXTURE
const { projects: _projectsOmitted, ...RESCAN_NO_PROJECTS } = RESCAN_FIXTURE
const { registry: _rescanRegistryOmitted, ...RESCAN_NO_REGISTRY } = RESCAN_FIXTURE
const PORTFOLIO_ITEM_NO_PROJECT = (() => {
  const { projectId: _drop, ...rest } = PORTFOLIO_INTERVENTIONS_FIXTURE.items[0]!
  return { ...PORTFOLIO_INTERVENTIONS_FIXTURE, items: [rest] }
})()

const negativeCases: readonly PlaneNegativeCase[] = [
  // ---- getResearchPlaneState ------------------------------------------
  { method: 'getResearchPlaneState', face: 'args', kind: 'type', bad: { sessionId: 7 }, named: /sessionId/ },
  { method: 'getResearchPlaneState', face: 'args', kind: 'type', bad: { sessionId: '' }, named: /sessionId/ },
  { method: 'getResearchPlaneState', face: 'args', kind: 'type', bad: 'not-an-object', named: /object/ },
  { method: 'getResearchPlaneState', face: 'args', kind: 'extra', bad: { sessionId: 's', surprise: 1 }, named: /surprise/ },
  { method: 'getResearchPlaneState', face: 'result', kind: 'missing', bad: PLANE_STATE_NO_HUB, named: /hub/ },
  { method: 'getResearchPlaneState', face: 'result', kind: 'missing', bad: PLANE_STATE_NO_REGISTRY, named: /registry/ },
  { method: 'getResearchPlaneState', face: 'result', kind: 'extra', bad: { ...PLANE_STATE_FIXTURE, surprise: 1 }, named: /surprise/ },
  {
    method: 'getResearchPlaneState',
    face: 'result',
    kind: 'type',
    bad: { ...PLANE_STATE_FIXTURE, session: { cwd: 'x', role: 'ADMIN' } },
    named: /HUB|MANAGED|role/,
  },
  {
    method: 'getResearchPlaneState',
    face: 'result',
    kind: 'type',
    bad: { ...PLANE_STATE_FIXTURE, missing: [{ ...PLANE_STATE_FIXTURE.missing[0]!, deferred: 'yes' }] },
    named: /deferred/,
  },
  {
    method: 'getResearchPlaneState',
    face: 'result',
    kind: 'type',
    bad: {
      ...PLANE_STATE_FIXTURE,
      registry: [{ ...PLANE_STATE_FIXTURE.registry[0]!, status: 'dormant' }],
    },
    named: /status|active|archived/,
  },
  {
    method: 'getResearchPlaneState',
    face: 'result',
    kind: 'type',
    bad: {
      ...PLANE_STATE_FIXTURE,
      registry: [
        ...PLANE_STATE_FIXTURE.registry.slice(0, 1),
        { ...PLANE_STATE_FIXTURE.registry[1]!, archivedAt: 'yesterday' },
      ],
    },
    named: /archivedAt/,
  },
  {
    method: 'getResearchPlaneState',
    face: 'result',
    kind: 'type',
    bad: { ...PLANE_STATE_FIXTURE, session: { cwd: null, role: 'NO_CWD', hubTreeProjectId: 'PRJ-x' } },
    named: /PRJ|hubTreeProjectId/,
  },
  // ---- getHubOverview ---------------------------------------------------
  { method: 'getHubOverview', face: 'args', kind: 'extra', bad: { surprise: 1 }, named: /surprise/ },
  { method: 'getHubOverview', face: 'args', kind: 'type', bad: 'not-an-object', named: /object/ },
  { method: 'getHubOverview', face: 'result', kind: 'missing', bad: HUB_OVERVIEW_NO_CARDS, named: /cards/ },
  { method: 'getHubOverview', face: 'result', kind: 'extra', bad: { ...HUB_OVERVIEW_FIXTURE, surprise: 1 }, named: /surprise/ },
  {
    method: 'getHubOverview',
    face: 'result',
    kind: 'type',
    bad: {
      ...HUB_OVERVIEW_FIXTURE,
      attention: [{ ...HUB_OVERVIEW_FIXTURE.attention[0]!, openCount: 0 }],
    },
    named: /openCount/,
  },
  {
    method: 'getHubOverview',
    face: 'result',
    kind: 'type',
    bad: { ...HUB_OVERVIEW_FIXTURE, cards: [{ ...HUB_OVERVIEW_FIXTURE.cards[0]!, inboxCount: -1 }] },
    named: /inboxCount/,
  },
  {
    method: 'getHubOverview',
    face: 'result',
    kind: 'type',
    bad: { ...HUB_OVERVIEW_FIXTURE, cards: [{ ...HUB_OVERVIEW_FIXTURE.cards[0]!, attentionMode: 'HIGH' }] },
    named: /FOCUS|NORMAL|attentionMode/,
  },
  // ---- getPortfolioInterventions ----------------------------------------
  { method: 'getPortfolioInterventions', face: 'args', kind: 'type', bad: { status: 'DONE' }, named: /OPEN|PENDING|DONE/ },
  { method: 'getPortfolioInterventions', face: 'args', kind: 'extra', bad: { status: 'OPEN', surprise: 1 }, named: /surprise/ },
  { method: 'getPortfolioInterventions', face: 'result', kind: 'missing', bad: PORTFOLIO_NO_ITEMS, named: /items/ },
  { method: 'getPortfolioInterventions', face: 'result', kind: 'extra', bad: { ...PORTFOLIO_INTERVENTIONS_FIXTURE, surprise: 1 }, named: /surprise/ },
  {
    method: 'getPortfolioInterventions',
    face: 'result',
    kind: 'type',
    bad: { ...PORTFOLIO_INTERVENTIONS_FIXTURE, items: [{ ...PORTFOLIO_INTERVENTIONS_FIXTURE.items[0]!, id: 'IV-x' }] },
    named: /IV|id/,
  },
  {
    method: 'getPortfolioInterventions',
    face: 'result',
    kind: 'missing',
    bad: PORTFOLIO_ITEM_NO_PROJECT,
    named: /projectId/,
  },
  // ---- setHub -------------------------------------------------------------
  { method: 'setHub', face: 'args', kind: 'missing', bad: {}, named: /wsPath/ },
  { method: 'setHub', face: 'args', kind: 'type', bad: { wsPath: 'relative/ws' }, named: /wsPath/ },
  { method: 'setHub', face: 'args', kind: 'extra', bad: { wsPath: '/x', surprise: 1 }, named: /surprise/ },
  { method: 'setHub', face: 'result', kind: 'missing', bad: { hubPath: '/x' }, named: /registryPath/ },
  { method: 'setHub', face: 'result', kind: 'extra', bad: { ...SET_HUB_FIXTURE, surprise: 1 }, named: /surprise/ },
  { method: 'setHub', face: 'result', kind: 'type', bad: { hubPath: 7, registryPath: '/x' }, named: /hubPath/ },
  // ---- bindProject ---------------------------------------------------------
  { method: 'bindProject', face: 'args', kind: 'missing', bad: {}, named: /wsPath/ },
  { method: 'bindProject', face: 'args', kind: 'type', bad: { wsPath: '/x', scaffold: 'yes' }, named: /scaffold/ },
  { method: 'bindProject', face: 'args', kind: 'type', bad: { wsPath: '/x', displayName: '' }, named: /displayName/ },
  { method: 'bindProject', face: 'args', kind: 'extra', bad: { wsPath: '/x', surprise: 1 }, named: /surprise/ },
  { method: 'bindProject', face: 'result', kind: 'missing', bad: { projectId: 'PRJ-1', dbMigrated: false }, named: /registryPath/ },
  { method: 'bindProject', face: 'result', kind: 'extra', bad: { ...BIND_PROJECT_FIXTURE, surprise: 1 }, named: /surprise/ },
  { method: 'bindProject', face: 'result', kind: 'type', bad: { projectId: 'PRJ-x', registryPath: null, dbMigrated: false }, named: /PRJ|projectId/ },
  // ---- unbindProject --------------------------------------------------------
  { method: 'unbindProject', face: 'args', kind: 'missing', bad: {}, named: /wsPath/ },
  { method: 'unbindProject', face: 'args', kind: 'type', bad: { wsPath: 'ws' }, named: /wsPath/ },
  { method: 'unbindProject', face: 'args', kind: 'extra', bad: { wsPath: '/x', surprise: 1 }, named: /surprise/ },
  { method: 'unbindProject', face: 'result', kind: 'missing', bad: { projectId: 'PRJ-1' }, named: /archivedDir/ },
  { method: 'unbindProject', face: 'result', kind: 'extra', bad: { ...UNBIND_PROJECT_FIXTURE, surprise: 1 }, named: /surprise/ },
  { method: 'unbindProject', face: 'result', kind: 'type', bad: { projectId: 'prj-1', archivedDir: '/x' }, named: /PRJ|projectId/ },
  // ---- restoreProject --------------------------------------------------------
  { method: 'restoreProject', face: 'args', kind: 'missing', bad: {}, named: /projectId/ },
  { method: 'restoreProject', face: 'args', kind: 'type', bad: { projectId: 'PRJ-x' }, named: /PRJ|projectId/ },
  { method: 'restoreProject', face: 'args', kind: 'extra', bad: { projectId: 'PRJ-1', surprise: 1 }, named: /surprise/ },
  { method: 'restoreProject', face: 'result', kind: 'missing', bad: {}, named: /wsPath/ },
  { method: 'restoreProject', face: 'result', kind: 'extra', bad: { ...RESTORE_PROJECT_FIXTURE, surprise: 1 }, named: /surprise/ },
  { method: 'restoreProject', face: 'result', kind: 'type', bad: { wsPath: 7 }, named: /wsPath/ },
  // ---- rescan ------------------------------------------------------------------
  { method: 'rescan', face: 'args', kind: 'extra', bad: { surprise: 1 }, named: /surprise/ },
  { method: 'rescan', face: 'args', kind: 'type', bad: 'not-an-object', named: /object/ },
  { method: 'rescan', face: 'result', kind: 'missing', bad: RESCAN_NO_PROJECTS, named: /projects/ },
  { method: 'rescan', face: 'result', kind: 'missing', bad: RESCAN_NO_REGISTRY, named: /registry/ },
  { method: 'rescan', face: 'result', kind: 'extra', bad: { ...RESCAN_FIXTURE, surprise: 1 }, named: /surprise/ },
  {
    method: 'rescan',
    face: 'result',
    kind: 'type',
    bad: { ...RESCAN_FIXTURE, projects: [{ ...RESCAN_FIXTURE.projects[0]!, kind: 'LOST' }] },
    named: /MANAGED|STANDALONE|kind/,
  },
  // ---- ackMissingReminder ---------------------------------------------------------
  { method: 'ackMissingReminder', face: 'args', kind: 'missing', bad: {}, named: /projectId/ },
  { method: 'ackMissingReminder', face: 'args', kind: 'type', bad: { projectId: 'prj-1' }, named: /PRJ|projectId/ },
  { method: 'ackMissingReminder', face: 'args', kind: 'extra', bad: { projectId: 'PRJ-1', surprise: 1 }, named: /surprise/ },
  { method: 'ackMissingReminder', face: 'result', kind: 'missing', bad: {}, named: /acknowledged/ },
  { method: 'ackMissingReminder', face: 'result', kind: 'extra', bad: { ...ACK_MISSING_REMINDER_FIXTURE, surprise: 1 }, named: /surprise/ },
  { method: 'ackMissingReminder', face: 'result', kind: 'type', bad: { acknowledged: false }, named: /acknowledged|true/ },
]

describe('V2-T3.1 per-method schema rejection paths', () => {
  for (const n of negativeCases) {
    it(`${n.method} ${n.face} schema rejects (${n.kind}): ${JSON.stringify(n.bad).slice(0, 80)}`, () => {
      const schema = n.face === 'args' ? planeArgsSchemas[n.method]! : planeResultSchemas[n.method]!
      expect(() => schema.parse(n.bad), `${n.method} ${n.face} must reject the ${n.kind} case`).toThrow(n.named)
    })
  }

  it('every method has at least one missing/extra/type rejection pinned (discipline: ≥1 成功 + ≥1 拒绝 per method)', () => {
    const byMethod = new Map<string, Set<PlaneNegativeCase['kind']>>()
    for (const n of negativeCases) {
      const set = byMethod.get(n.method) ?? new Set<PlaneNegativeCase['kind']>()
      set.add(n.kind)
      byMethod.set(n.method, set)
    }
    expect(byMethod.size).toBe(9)
    for (const method of RESEARCH_PLANE_RPC_METHODS) {
      const kinds = byMethod.get(method)
      expect(kinds, `${method} must have pinned rejections`).toBeDefined()
      // Every method pins an extra-field rejection; the 7 methods with a
      // required/typed args field or a non-trivial result pin type errors;
      // the empty-arg pair (getHubOverview/rescan) pins type via the
      // non-object args + the result face. Missing-field rejections are
      // pinned wherever a required field exists (args or result).
      expect(kinds!.has('extra'), `${method} must pin an extra-field rejection`).toBe(true)
      expect(kinds!.has('type'), `${method} must pin a type-error rejection`).toBe(true)
      const hasRequired =
        method !== 'getHubOverview' && method !== 'rescan' && method !== 'getPortfolioInterventions'
      if (hasRequired) {
        expect(kinds!.has('missing'), `${method} must pin a missing-field rejection`).toBe(true)
      }
    }
  })
})

/* ===================================================================== *
 * D. V2 §12.1 — the optional projectId on the 13 frozen request schemas
 * ===================================================================== */

/**
 * The EXACT old request constructions the existing rpc-face suite uses
 * (the 逐个补验 compatibility probe — the same shapes, unchanged).
 */
const frozenOldShapes: readonly { method: string; schema: TypertSchemaLike; oldArgs: unknown }[] = [
  { method: 'getTopic', schema: GetTopicArgsSchema, oldArgs: { topicId: 'TPC-1' } satisfies GetTopicArgs },
  { method: 'getWorkstream', schema: GetWorkstreamArgsSchema, oldArgs: { workstreamId: 'WS-1' } satisfies GetWorkstreamArgs },
  { method: 'queryHistory', schema: QueryHistoryArgsSchema, oldArgs: { workstreamId: 'WS-1', order: 'audit', afterSeq: 0, beforeSeq: 100, limit: 50 } },
  { method: 'reorderPlan', schema: ReorderPlanArgsSchema, oldArgs: { workstreamId: 'WS-1', orderedItemIds: ['G-1', 'M-1', 'T-1'] } },
  { method: 'selectPlanFork', schema: SelectPlanForkArgsSchema, oldArgs: { planForkId: 'PF-1' } },
  { method: 'dismissPlanFork', schema: DismissPlanForkArgsSchema, oldArgs: { planForkId: 'PF-3' } },
  { method: 'updateInterventionState', schema: UpdateInterventionStateArgsSchema, oldArgs: { interventionId: 'IV-1', status: 'CLOSED', resolutionNote: 'reviewed and resolved' } },
  { method: 'registerInteraction', schema: RegisterInteractionArgsSchema, oldArgs: { kind: 'MEETING', title: 'Supervisor sync', occurredAt: 1755000000000, participants: ['alice'], relatedWorkstreams: ['WS-1'] } },
  { method: 'saveResearchCheckpoint', schema: SaveResearchCheckpointArgsSchema, oldArgs: { summary: 'save progress' } },
  { method: 'getGitHistory', schema: GetGitHistoryArgsSchema, oldArgs: { maxCount: 50, skip: 10 } },
  { method: 'restoreDeclarativeFile', schema: RestoreDeclarativeFileArgsSchema, oldArgs: { commitOid: 'a'.repeat(40), path: '.research/project.yaml' } },
]

describe('V2 §12.1 — the optional projectId on the 13 frozen request schemas', () => {
  it('exactly the 11 parameterized frozen methods carry a request schema; the two zero-arg queries are the exceptions', () => {
    expect(frozenOldShapes.map((c) => c.method)).toEqual([
      'getTopic',
      'getWorkstream',
      'queryHistory',
      'reorderPlan',
      'selectPlanFork',
      'dismissPlanFork',
      'updateInterventionState',
      'registerInteraction',
      'saveResearchCheckpoint',
      'getGitHistory',
      'restoreDeclarativeFile',
    ])
    for (const method of ['getDashboard', 'getProject']) {
      const d = ALL_RESEARCH_INVOCATIONS.find((x) => x.method === method) as InvocationDescriptorMirror
      expect(d.parameters, `${method} keeps the frozen zero-parameter face`).toEqual([])
    }
  })

  for (const c of frozenOldShapes) {
    it(`${c.method}: the OLD shape (no projectId) still parses, byte-identical`, () => {
      expect(c.schema.parse(c.oldArgs)).toEqual(c.oldArgs)
    })

    it(`${c.method}: the NEW shape (with projectId) parses and round-trips`, () => {
      const withId = { ...(c.oldArgs as Record<string, unknown>), projectId: 'PRJ-1' }
      expect(c.schema.parse(withId)).toEqual(withId)
    })

    it(`${c.method}: a projectId off the PRJ vocabulary is rejected (strict boundary)`, () => {
      const base = c.oldArgs as Record<string, unknown>
      expect(() => c.schema.parse({ ...base, projectId: 'PRJ-x' }), `${c.method} rejects a malformed id`).toThrow()
      expect(() => c.schema.parse({ ...base, projectId: 'prj-1' }), `${c.method} rejects a lowercase id`).toThrow()
      expect(() => c.schema.parse({ ...base, projectId: 7 }), `${c.method} rejects a non-string id`).toThrow()
    })
  }

  it('the 13 RESULT schemas stay zero-touched: an injected projectId is rejected by every one', () => {
    const resultFaces: readonly { method: string; schema: TypertSchemaLike; fixture: unknown }[] = [
      { method: 'getDashboard', schema: DashboardSnapshotSchema, fixture: DASHBOARD_FIXTURE },
      { method: 'getProject', schema: ProjectSnapshotSchema, fixture: PROJECT_FIXTURE },
      { method: 'getTopic', schema: TopicSnapshotSchema, fixture: TOPIC_FIXTURE },
      { method: 'getWorkstream', schema: WorkstreamSnapshotSchema, fixture: WORKSTREAM_FIXTURE },
      { method: 'queryHistory', schema: QueryHistoryResultSchema, fixture: HISTORY_FIXTURE },
      { method: 'reorderPlan', schema: ReorderPlanResultSchema, fixture: REORDER_FIXTURE },
      { method: 'selectPlanFork', schema: SelectPlanForkResultSchema, fixture: SELECT_FIXTURE },
      { method: 'dismissPlanFork', schema: DismissPlanForkResultSchema, fixture: DISMISS_FIXTURE },
      { method: 'updateInterventionState', schema: UpdateInterventionStateResultSchema, fixture: UPDATE_INTERVENTION_FIXTURE },
      { method: 'registerInteraction', schema: RegisterInteractionResultSchema, fixture: REGISTER_INTERACTION_FIXTURE },
      { method: 'saveResearchCheckpoint', schema: SaveResearchCheckpointResultSchema, fixture: CHECKPOINT_FIXTURE },
      { method: 'getGitHistory', schema: GetGitHistoryResultSchema, fixture: GIT_HISTORY_FIXTURE },
      { method: 'restoreDeclarativeFile', schema: RestoreDeclarativeFileResultSchema, fixture: RESTORE_FIXTURE },
    ]
    for (const c of resultFaces) {
      expect(
        () => c.schema.parse({ ...(c.fixture as Record<string, unknown>), projectId: 'PRJ-1' }),
        `${c.method} result schema must stay strict (zero 结果 schema 改动)`,
      ).toThrow()
    }
  })
})

/* ===================================================================== *
 * E. The PLANE_* named error family
 * ===================================================================== */

describe('V2-T3.1 — the PLANE_* named error family', () => {
  it('the family is a closed, unique, PLANE_-prefixed vocabulary', () => {
    expect(PLANE_ERROR_CODES).toHaveLength(13)
    expect(new Set(PLANE_ERROR_CODES).size).toBe(13)
    for (const code of PLANE_ERROR_CODES) {
      expect(code.startsWith('PLANE_'), `${code} must carry the PLANE_ prefix`).toBe(true)
    }
  })

  it('every PlaneErrorCode literal is covered by the exported list (a dropped code fails tsc here)', () => {
    const coverage: Record<PlaneErrorCode, boolean> = {
      PLANE_HUB_EXISTS: true,
      PLANE_HUB_MARKER_EXISTS: true,
      PLANE_NOT_REGISTERED_WORKSPACE: true,
      PLANE_ALREADY_MANAGED: true,
      PLANE_HUB_WORKSPACE: true,
      PLANE_TREE_MISSING: true,
      PLANE_TREE_EXISTS: true,
      PLANE_NOT_MANAGED: true,
      PLANE_NOT_ARCHIVED: true,
      PLANE_ARCHIVED_DIR_MISSING: true,
      PLANE_TARGET_NAME_TAKEN: true,
      PLANE_NOT_MISSING: true,
      PLANE_SESSION_UNKNOWN: true,
    }
    for (const code of PLANE_ERROR_CODES) {
      expect(coverage[code], `${code} must be a PlaneErrorCode literal`).toBe(true)
    }
  })

  it('every design §12 拒绝分支 names a code (branch → code mapping pinned)', () => {
    const branches: readonly [string, PlaneErrorCode][] = [
      ['setHub: 已有中枢', 'PLANE_HUB_EXISTS'],
      ['setHub: 标记已存在', 'PLANE_HUB_MARKER_EXISTS'],
      ['setHub: 路径非注册工作区', 'PLANE_NOT_REGISTERED_WORKSPACE'],
      ['bindProject: 已是受管', 'PLANE_ALREADY_MANAGED'],
      ['bindProject: 中枢占用', 'PLANE_HUB_WORKSPACE'],
      ['bindProject: scaffold=false 且无树', 'PLANE_TREE_MISSING'],
      ['bindProject: scaffold=true 且树已存在', 'PLANE_TREE_EXISTS'],
      ['unbindProject: 非受管项目', 'PLANE_NOT_MANAGED'],
      ['restoreProject: 非归档条目', 'PLANE_NOT_ARCHIVED'],
      ['restoreProject: 目录找不回', 'PLANE_ARCHIVED_DIR_MISSING'],
      ['restoreProject: 目标名被占', 'PLANE_TARGET_NAME_TAKEN'],
    ]
    for (const [, code] of branches) {
      expect(PLANE_ERROR_CODES, code).toContain(code)
    }
  })

  it('PlaneError keeps the structured code AND embeds it in the message (the { ok: false, error } wire carrier)', () => {
    const e = new PlaneError('PLANE_HUB_EXISTS', 'a hub already exists at /home/u/hub')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('PlaneError')
    expect(e.code).toBe('PLANE_HUB_EXISTS')
    expect(e.message).toContain('PLANE_HUB_EXISTS')
    expect(e.message).toContain('a hub already exists at /home/u/hub')
  })
})
