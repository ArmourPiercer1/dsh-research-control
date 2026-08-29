/**
 * WP-4.1a — manifest validation for the FULL registered face (V2-T3.2a:
 * the 3 read-only plane RPCs of design §12 rows 1-3; V2-T3.2b: the 6
 * change-family plane RPCs of design §12 rows 4-6/8/9 — the 23-endpoint
 * face — ping + the 13 §7.1 RPCs + the 9 plane RPCs), extending the WP-0.3
 * rpc-spike test form:
 *  - the mirrored loader `validateTypertManifest` (rc.8 semantics, ported
 *    to tests/rpc-face/loader-validation.ts) passes on TYPERT;
 *  - the host manifest's invocations/schemas/members describe the whole
 *    face with the shared strict zod codecs;
 *  - the client `./remote` contribution exports the SAME descriptor
 *    objects (identity — no drift by construction, the WP-0.3 rule
 *    extended from ping to the whole face);
 *  - every endpoint survives the shared RPC carrier's wire segment
 *    grammar;
 *  - the mirrored loader rejects the same corruption classes against the
 *    full manifest (negative probes).
 */

import { isTypertRemoteSegment, type TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { TYPERT } from '../../src/host/dsh-adapter/host/typert.artifact.js'
import { researchRemotes } from '../../src/client/dsh-adapter/remote/contribution.js'
import {
  AckMissingReminderArgsSchema,
  AckMissingReminderResultSchema,
  BindProjectArgsSchema,
  BindProjectResultSchema,
  CreateTopicArgsSchema,
  CreateTopicResultSchema,
  CreateWorkstreamArgsSchema,
  CreateWorkstreamResultSchema,
  DashboardSnapshotSchema,
  DismissPlanForkArgsSchema,
  DismissPlanForkResultSchema,
  GetCurrentFocusArgsSchema,
  GetCurrentFocusResultSchema,
  GetGitHistoryArgsSchema,
  GetGitHistoryResultSchema,
  GetHubOverviewArgsSchema,
  GetPortfolioInterventionsArgsSchema,
  GetPortfolioInterventionsResultSchema,
  GetResearchPlaneStateArgsSchema,
  GetResearchPlaneStateResultSchema,
  GetTopicArgsSchema,
  GetWorkstreamArgsSchema,
  HubOverviewResultSchema,
  PingResultSchema,
  ProjectSnapshotSchema,
  QueryHistoryArgsSchema,
  QueryHistoryResultSchema,
  RESEARCH_CONTROL_PACKAGE,
  RESEARCH_MANAGEMENT_INVOCATIONS,
  RESEARCH_RPC_INVOCATIONS,
  RESEARCH_RPC_METHODS,
  pingInvocation,
  ReorderPlanArgsSchema,
  ReorderPlanResultSchema,
  RegisterInteractionArgsSchema,
  RegisterInteractionResultSchema,
  RescanArgsSchema,
  RescanResultSchema,
  RestoreDeclarativeFileArgsSchema,
  RestoreDeclarativeFileResultSchema,
  RestoreProjectArgsSchema,
  RestoreProjectResultSchema,
  SaveResearchCheckpointArgsSchema,
  SaveResearchCheckpointResultSchema,
  SetCurrentFocusArgsSchema,
  SetCurrentFocusResultSchema,
  SetHubArgsSchema,
  SetHubResultSchema,
  SelectPlanForkArgsSchema,
  SelectPlanForkResultSchema,
  TopicSnapshotSchema,
  UnbindProjectArgsSchema,
  UnbindProjectResultSchema,
  UpdateInterventionStateArgsSchema,
  UpdateInterventionStateResultSchema,
  WorkstreamSnapshotSchema,
  type InvocationDescriptorMirror,
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
import {
  ACK_MISSING_REMINDER_FIXTURE,
  BIND_PROJECT_FIXTURE,
  HUB_OVERVIEW_FIXTURE,
  PLANE_STATE_FIXTURE,
  PORTFOLIO_INTERVENTIONS_FIXTURE,
  RESCAN_FIXTURE,
  RESTORE_PROJECT_FIXTURE,
  SET_HUB_FIXTURE,
  UNBIND_PROJECT_FIXTURE,
} from './plane-fixtures.js'
import { validateTypertManifest } from './loader-validation.js'

const pingFixture = { ok: true, service: 'researchControl', time: 1755000000000 }

/** UI-0.4 — wire-valid result fixtures for the 4 GUI management RPCs
 *  (the 2 current-focus + the 2 hierarchy-create). */
const setCurrentFocusFixture = { workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: 1755000001000 }
const getCurrentFocusFixture = { workstreamId: 'WS-1', focus: { planItemId: 'T-1', updatedAt: 1755000001000 } }
const createTopicFixture = { topicId: 'TPC-2', title: 'New topic', path: 'topics/TPC-2/topic.yaml', createdAt: 1755000002000 }
const createWorkstreamFixture = {
  workstreamId: 'WS-4',
  topicId: 'TPC-1',
  title: 'New workstream',
  path: 'topics/TPC-1/workstreams/WS-4/workstream.yaml',
  createdAt: 1755000003000,
}

/** The 27 endpoints in wire order (V2-T3.2a: the 3 read-only plane RPCs +
 *  V2-T3.2b: the 6 change-family plane RPCs + UI-0.4: the 4 GUI
 *  management RPCs (the 2 current-focus + the 2 hierarchy-create),
 *  appended after the frozen 14), each with its
 *  wire-valid result fixture. */
const endpointFixtures: readonly { method: string; resultFixture: unknown }[] = [
  { method: 'ping', resultFixture: pingFixture },
  { method: 'getDashboard', resultFixture: DASHBOARD_FIXTURE },
  { method: 'getProject', resultFixture: PROJECT_FIXTURE },
  { method: 'getTopic', resultFixture: TOPIC_FIXTURE },
  { method: 'getWorkstream', resultFixture: WORKSTREAM_FIXTURE },
  { method: 'queryHistory', resultFixture: HISTORY_FIXTURE },
  { method: 'reorderPlan', resultFixture: REORDER_FIXTURE },
  { method: 'selectPlanFork', resultFixture: SELECT_FIXTURE },
  { method: 'dismissPlanFork', resultFixture: DISMISS_FIXTURE },
  { method: 'updateInterventionState', resultFixture: UPDATE_INTERVENTION_FIXTURE },
  { method: 'registerInteraction', resultFixture: REGISTER_INTERACTION_FIXTURE },
  { method: 'saveResearchCheckpoint', resultFixture: CHECKPOINT_FIXTURE },
  { method: 'getGitHistory', resultFixture: GIT_HISTORY_FIXTURE },
  { method: 'restoreDeclarativeFile', resultFixture: RESTORE_FIXTURE },
  { method: 'getResearchPlaneState', resultFixture: PLANE_STATE_FIXTURE },
  { method: 'getHubOverview', resultFixture: HUB_OVERVIEW_FIXTURE },
  { method: 'getPortfolioInterventions', resultFixture: PORTFOLIO_INTERVENTIONS_FIXTURE },
  { method: 'setHub', resultFixture: SET_HUB_FIXTURE },
  { method: 'bindProject', resultFixture: BIND_PROJECT_FIXTURE },
  { method: 'unbindProject', resultFixture: UNBIND_PROJECT_FIXTURE },
  { method: 'restoreProject', resultFixture: RESTORE_PROJECT_FIXTURE },
  { method: 'rescan', resultFixture: RESCAN_FIXTURE },
  { method: 'ackMissingReminder', resultFixture: ACK_MISSING_REMINDER_FIXTURE },
  { method: 'setCurrentFocus', resultFixture: setCurrentFocusFixture },
  { method: 'getCurrentFocus', resultFixture: getCurrentFocusFixture },
  { method: 'createTopic', resultFixture: createTopicFixture },
  { method: 'createWorkstream', resultFixture: createWorkstreamFixture },
]

/** The args-schema identity table (24 parameterized RPCs: the frozen 11
 *  + the 9 plane RPCs + the 4 GUI management RPCs — every one carries a
 *  strict args object). */
const argsSchemaTable: Readonly<Record<string, unknown>> = {
  getTopic: GetTopicArgsSchema,
  getWorkstream: GetWorkstreamArgsSchema,
  queryHistory: QueryHistoryArgsSchema,
  reorderPlan: ReorderPlanArgsSchema,
  selectPlanFork: SelectPlanForkArgsSchema,
  dismissPlanFork: DismissPlanForkArgsSchema,
  updateInterventionState: UpdateInterventionStateArgsSchema,
  registerInteraction: RegisterInteractionArgsSchema,
  saveResearchCheckpoint: SaveResearchCheckpointArgsSchema,
  getGitHistory: GetGitHistoryArgsSchema,
  restoreDeclarativeFile: RestoreDeclarativeFileArgsSchema,
  getResearchPlaneState: GetResearchPlaneStateArgsSchema,
  getHubOverview: GetHubOverviewArgsSchema,
  getPortfolioInterventions: GetPortfolioInterventionsArgsSchema,
  setHub: SetHubArgsSchema,
  bindProject: BindProjectArgsSchema,
  unbindProject: UnbindProjectArgsSchema,
  restoreProject: RestoreProjectArgsSchema,
  rescan: RescanArgsSchema,
  ackMissingReminder: AckMissingReminderArgsSchema,
  setCurrentFocus: SetCurrentFocusArgsSchema,
  getCurrentFocus: GetCurrentFocusArgsSchema,
  createTopic: CreateTopicArgsSchema,
  createWorkstream: CreateWorkstreamArgsSchema,
}

/** Narrow a descriptor codec to its strict arm. */
function strictCodec(codec: TypertCodec): Extract<TypertCodec, { mode: 'strict' }> {
  if (codec.mode !== 'strict') throw new Error(`expected strict codec, got ${codec.mode}`)
  return codec
}

describe('WP-4.1a manifest — the full 27-endpoint registered face (V2-T3.2a + V2-T3.2b + UI-0.4)', () => {
  it('TYPERT passes the mirrored loader validation (validateTypertManifest semantics)', () => {
    expect(() => validateTypertManifest(RESEARCH_CONTROL_PACKAGE, TYPERT)).not.toThrow()
  })

  it('TYPERT.invocations is exactly the frozen 14 + the 9 plane RPCs + the 4 GUI management RPCs, in order', () => {
    expect(TYPERT.invocations).toHaveLength(27)
    expect(TYPERT.invocations.map((i) => i.method)).toEqual([
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
      'setCurrentFocus',
      'getCurrentFocus',
      'createTopic',
      'createWorkstream',
    ])
    // The host manifest re-exports the SHARED descriptors (identity):
    // index 0 is the shared ping descriptor, indices 1..13 are the shared
    // RESEARCH_RPC_INVOCATIONS in order, indices 23..26 are the shared
    // RESEARCH_MANAGEMENT_INVOCATIONS in order.
    expect(TYPERT.invocations[0]).toBe(pingInvocation)
    expect(TYPERT.invocations[1]).toBe(RESEARCH_RPC_INVOCATIONS[0])
    expect(TYPERT.invocations[13]).toBe(RESEARCH_RPC_INVOCATIONS[12])
    expect(TYPERT.invocations[23]).toBe(RESEARCH_MANAGEMENT_INVOCATIONS[0])
    expect(TYPERT.invocations[24]).toBe(RESEARCH_MANAGEMENT_INVOCATIONS[1])
    expect(TYPERT.invocations[25]).toBe(RESEARCH_MANAGEMENT_INVOCATIONS[2])
    expect(TYPERT.invocations[26]).toBe(RESEARCH_MANAGEMENT_INVOCATIONS[3])
  })

  it('every invocation carries the id grammar + direct receiver + strict codecs', () => {
    for (const invocation of TYPERT.invocations as readonly InvocationDescriptorMirror[]) {
      expect(invocation.id).toBe(`researchControl#researchControl/${invocation.method}`)
      expect(invocation.service).toBe('researchControl')
      expect(invocation.namespace).toBe('researchControl')
      expect(invocation.invocation).toEqual({ kind: 'direct' })
      expect(invocation.cancellation).toBeUndefined()
      expect(invocation.sourceLocation).toBeUndefined()
      const result = strictCodec(invocation.result)
      expect('_zod' in (result.schema as object)).toBe(true)
      // The endpoint must survive the shared RPC carrier's segment grammar.
      expect(isTypertRemoteSegment(invocation.namespace)).toBe(true)
      expect(isTypertRemoteSegment(invocation.method)).toBe(true)
    }
  })

  it('parameterized descriptors bind the shared args schema as their strict codec', () => {
    for (const invocation of TYPERT.invocations as readonly InvocationDescriptorMirror[]) {
      const expected = argsSchemaTable[invocation.method]
      if (expected === undefined) {
        expect(invocation.parameters, `${invocation.method} must be zero-param`).toEqual([])
        continue
      }
      expect(invocation.parameters).toHaveLength(1)
      expect(strictCodec(invocation.parameters[0].codec).schema).toBe(expected)
    }
  })

  it('every strict result codec parses its wire-valid fixture (and the shared schema is the codec schema)', () => {
    const resultSchemaTable: Readonly<Record<string, unknown>> = {
      ping: PingResultSchema,
      getDashboard: DashboardSnapshotSchema,
      getProject: ProjectSnapshotSchema,
      getTopic: TopicSnapshotSchema,
      getWorkstream: WorkstreamSnapshotSchema,
      queryHistory: QueryHistoryResultSchema,
      reorderPlan: ReorderPlanResultSchema,
      selectPlanFork: SelectPlanForkResultSchema,
      dismissPlanFork: DismissPlanForkResultSchema,
      updateInterventionState: UpdateInterventionStateResultSchema,
      registerInteraction: RegisterInteractionResultSchema,
      saveResearchCheckpoint: SaveResearchCheckpointResultSchema,
      getGitHistory: GetGitHistoryResultSchema,
      restoreDeclarativeFile: RestoreDeclarativeFileResultSchema,
      getResearchPlaneState: GetResearchPlaneStateResultSchema,
      getHubOverview: HubOverviewResultSchema,
      getPortfolioInterventions: GetPortfolioInterventionsResultSchema,
      setHub: SetHubResultSchema,
      bindProject: BindProjectResultSchema,
      unbindProject: UnbindProjectResultSchema,
      restoreProject: RestoreProjectResultSchema,
      rescan: RescanResultSchema,
      ackMissingReminder: AckMissingReminderResultSchema,
      setCurrentFocus: SetCurrentFocusResultSchema,
      getCurrentFocus: GetCurrentFocusResultSchema,
      createTopic: CreateTopicResultSchema,
      createWorkstream: CreateWorkstreamResultSchema,
    }
    for (const { method, resultFixture } of endpointFixtures) {
      const invocation = (TYPERT.invocations as readonly InvocationDescriptorMirror[]).find(
        (i) => i.method === method,
      )
      expect(invocation, `descriptor for ${method}`).toBeDefined()
      const schema = strictCodec(invocation!.result).schema
      // The named manifest schema entry is the same zod instance the codec carries.
      const manifestSchema = (TYPERT.schemas as readonly { name: string; schema: unknown }[]).find(
        (s) => s.name === strictCodec(invocation!.result).typeSymbol,
      )
      expect(manifestSchema?.schema).toBe(schema)
      expect(schema).toBe(resultSchemaTable[method])
      // The fixture parses through the strict codec — wire validity.
      expect((schema as { parse(v: unknown): unknown }).parse(resultFixture)).toEqual(resultFixture)
    }
  })

  it('TYPERT.schemas covers the full contract: ping + 24 args + 26 results, live zod instances, unique names', () => {
    const names = TYPERT.schemas.map((s) => s.name)
    expect(names).toHaveLength(51)
    expect(new Set(names).size).toBe(51)
    for (const s of TYPERT.schemas) {
      expect('_zod' in (s.schema as object), `${s.name} must be a live zod v4 instance`).toBe(true)
    }
    for (const expected of [
      'PingResult',
      'DashboardSnapshot', 'ProjectSnapshot',
      'GetTopicArgs', 'TopicSnapshot',
      'GetWorkstreamArgs', 'WorkstreamSnapshot',
      'QueryHistoryArgs', 'QueryHistoryResult',
      'ReorderPlanArgs', 'ReorderPlanResult',
      'SelectPlanForkArgs', 'SelectPlanForkResult',
      'DismissPlanForkArgs', 'DismissPlanForkResult',
      'UpdateInterventionStateArgs', 'UpdateInterventionStateResult',
      'RegisterInteractionArgs', 'RegisterInteractionResult',
      'SaveResearchCheckpointArgs', 'SaveResearchCheckpointResult',
      'GetGitHistoryArgs', 'GetGitHistoryResult',
      'RestoreDeclarativeFileArgs', 'RestoreDeclarativeFileResult',
      'GetResearchPlaneStateArgs', 'GetResearchPlaneStateResult',
      'GetHubOverviewArgs', 'HubOverviewResult',
      'GetPortfolioInterventionsArgs', 'GetPortfolioInterventionsResult',
      'SetHubArgs', 'SetHubResult',
      'BindProjectArgs', 'BindProjectResult',
      'UnbindProjectArgs', 'UnbindProjectResult',
      'RestoreProjectArgs', 'RestoreProjectResult',
      'RescanArgs', 'RescanResult',
      'AckMissingReminderArgs', 'AckMissingReminderResult',
      'SetCurrentFocusArgs', 'SetCurrentFocusResult',
      'GetCurrentFocusArgs', 'GetCurrentFocusResult',
      'CreateTopicArgs', 'CreateTopicResult',
      'CreateWorkstreamArgs', 'CreateWorkstreamResult',
    ]) {
      expect(names, `missing schema entry ${expected}`).toContain(expected)
    }
  })

  it('the model carries the full 27-member service face', () => {
    const [service] = TYPERT.model.services
    expect(TYPERT.model.events).toEqual([])
    expect(TYPERT.model.objects).toEqual([])
    expect(service.key).toBe('researchControl')
    expect(service.exportName).toBe('ResearchControlService')
    expect(service.members.map((m) => m.name)).toEqual([
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
      'setCurrentFocus',
      'getCurrentFocus',
      'createTopic',
      'createWorkstream',
    ])
    for (const member of service.members) {
      expect(member.kind).toBe('method')
      expect(member.signature.length).toBeGreaterThan(0)
    }
    expect(service.types.map((t) => t.name)).toContain('PingResult')
    expect(service.types.map((t) => t.name)).toContain('WorkstreamSnapshot')
    expect(service.types.map((t) => t.name)).toContain('HubOverviewResult')
    expect(service.types.map((t) => t.name)).toContain('SetHubResult')
    expect(service.types.map((t) => t.name)).toContain('BindProjectResult')
    expect(service.types.map((t) => t.name)).toContain('RescanResult')
    expect(service.types.map((t) => t.name)).toContain('AckMissingReminderResult')
    expect(service.types.map((t) => t.name)).toContain('SetCurrentFocusResult')
    expect(service.types.map((t) => t.name)).toContain('GetCurrentFocusResult')
    expect(service.types.map((t) => t.name)).toContain('CreateTopicResult')
    expect(service.types.map((t) => t.name)).toContain('CreateWorkstreamResult')
  })

  it('③ the client contribution exports the SAME 27 strict descriptor objects (no drift)', () => {
    expect(researchRemotes.package).toBe(RESEARCH_CONTROL_PACKAGE)
    expect(researchRemotes.descriptors).toHaveLength(27)
    for (let i = 0; i < 27; i += 1) {
      expect(researchRemotes.descriptors[i], `descriptor ${i} identity`).toBe(TYPERT.invocations[i])
    }
    // And the first (ping) remains the WP-0.3 shared object.
    expect(researchRemotes.descriptors[0]).toBe(TYPERT.invocations[0])
  })

  it('②c the mirrored loader validation rejects the same corruption classes on the full manifest', () => {
    const first = TYPERT.invocations[0]
    const probes: readonly Record<string, unknown>[] = [
      { package: 'other-package' },
      { face: 'client' },
      { schemas: [{ name: 'PingResult', schema: { parse: () => undefined } }] },
      { invocations: [{ ...first, namespace: '' }] },
      { invocations: [{ ...first, result: { mode: 'src-json' } }] },
      {
        invocations: [
          {
            ...first,
            parameters: [
              { name: 'a', wire: 'w', source: 'json', codec: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema } },
              { name: 'b', wire: 'w', source: 'json', codec: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema } },
            ],
          },
        ],
      },
      { invocations: [{ ...first, cancellation: { parameter: 'abort' } }] },
      {
        invocations: [
          {
            ...first,
            parameters: [
              { name: 'x', wire: 'x', source: 'lookup', codec: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema } },
            ],
          },
        ],
      },
      {
        model: {
          services: [
            {
              key: 'researchControl',
              exportName: 'ResearchControlService',
              tags: [],
              members: [{ name: 'ping', signature: 'ping(): Promise<PingResult>', kind: 'function' }],
              types: [],
            },
          ],
          events: [],
          objects: [],
        },
      },
    ]
    for (const patch of probes) {
      expect(() => validateTypertManifest(RESEARCH_CONTROL_PACKAGE, { ...TYPERT, ...patch })).toThrow()
    }
  })
})
