/**
 * G2 (§2d) — the four read tools' real forwarding behavior (unit face):
 * the retired stubs must now (1) pass the permission gate, (2) re-check
 * the frozen wire face (TOOL_INPUT), (3) forward to their single narrow
 * service port, (4) return the FULL structured subject validated by the
 * REAL host output codec (`@deepseek-ai/dsh-tools`, tests/helpers/
 * host-output-codec.ts), and (5) map service failures to the structured
 * `TOOL_SERVICE` carrier (detail.serviceCode — the RB_CHECKPOINT_FOREIGN_RUN
 * precedent). No pagination/truncation is invented: context/plan/contract
 * return the single complete subject; history carries the frozen WP-2.3
 * seq-cursor page verbatim, with the tool-boundary page-size policy
 * (default 100, max 1000 REFUSED above — never silently truncated).
 *
 * The read-only guarantee at this face: the recording ports are
 * read-shaped (their signatures carry no write argument) and the
 * single-call audit pins that one tool call touches exactly its own
 * port once and nothing else.
 */

import { describe, expect, it } from 'vitest'

import {
  HISTORY_ORDERS,
  RESEARCH_CONTEXT_GET,
  RESEARCH_CONTRACT_READ,
  RESEARCH_HISTORY_QUERY,
  RESEARCH_PLAN_GET,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { ToolReadServiceError, type ToolHistoryPage, type ToolMergeContractView, type ToolSessionContext, type ToolWorkstreamPlanView } from '../../src/host/tools/read-ports.js'
import { ReplayInputError } from '../../src/host/history/replay/index.js'
import { TopologyStoreError } from '../../src/host/domain/topology/index.js'
import type { HistoryEventRecord } from '../../src/host/persistence/store/index.js'
import { expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'
import { expectValueMatchesHostCodec, expectValueRejectedByHostCodec } from '../helpers/host-output-codec.js'

/* ------------------------------------------------------------------ *
 * Fixture data (frozen shapes, verbatim field names)
 * ------------------------------------------------------------------ */

const RUN_ROW = {
  id: 'R-81',
  workstream_id: 'WS-1',
  task_id: 'T-1',
  dsh_session_id: 'sess-1',
  status: 'RUNNING' as const,
  intent: 'run the calibration sweep',
  initiated_by: { kind: 'AGENT' as const, run_id: 'R-81' },
  started_at: 1770000000000,
}

const BOUND_CONTEXT: ToolSessionContext = {
  session_id: 'sess-1',
  bound: true,
  run: RUN_ROW,
  workstream: { id: 'WS-1', title: '主标定管线', topic_id: 'TPC-1' },
  task: { id: 'T-1', title: '标定数据采集方案对比' },
}

const UNBOUND_CONTEXT: ToolSessionContext = { session_id: 'sess-x', bound: false }

const PLAN_VIEW: ToolWorkstreamPlanView = {
  workstream: { id: 'WS-1', title: '主标定管线' },
  topic_id: 'TPC-1',
  present: true,
  consistent: true,
  ordered_items: ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'],
}

const EVENT: HistoryEventRecord = {
  eventId: 'H-1',
  ownerWorkstreamId: 'WS-1',
  eventType: 'RUN_STARTED',
  schemaVersion: 1,
  occurredAt: 1770000000000,
  actor: { kind: 'AGENT', run_id: 'R-81', session_id: 'sess-1' },
  source: null,
  payload: { run_id: 'R-81', workstream_id: 'WS-1', intent: 'x', initiated_by: { kind: 'AGENT', run_id: 'R-81' } },
  eventSeq: 1,
  recordedAt: 1770000000001,
}

const PAGE: ToolHistoryPage = {
  workstream_id: 'WS-1',
  order: 'semantic',
  limit: 100,
  events: [EVENT],
  next_after_seq: null,
  exhausted: true,
}

const CONTRACT_VIEW: ToolMergeContractView = {
  edge: { id: 'TE-2', topic_id: 'TPC-1', operation: 'MERGE', lifecycle: 'PLANNED', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'], note: '分支出独立标定管线' },
  content: '# Merge Contract TE-2\n\nbody bytes verbatim\n',
  path: 'merges/TE-2/contract.md',
}

/** Exec for the READ lane: an AGENT actor with only a session (no run —
 *  reads are run-free; the session is the subject of context_get). */
function readExec(sessionId = 'sess-1') {
  return makeExec({ actor: { kind: 'AGENT', session_id: sessionId } })
}

function toolOf(name: string, deps = makeRecordingDeps()) {
  const tool = createResearchTools(deps).find((t) => t.name === name)
  if (tool === undefined) throw new Error(`tool ${name} not composed`)
  return { tool, deps }
}

/* ------------------------------------------------------------------ *
 * research_context_get
 * ------------------------------------------------------------------ */

describe('research_context_get — forwarded (no stub)', () => {
  it('returns the FULL bound subject; validates through the real host codec', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTEXT_GET)
    deps.setContextGet((sessionId) => (sessionId === 'sess-1' ? BOUND_CONTEXT : UNBOUND_CONTEXT))
    const value = (await tool.execute({}, readExec('sess-1'))) as Record<string, unknown>
    expect(value['status']).toBe('ok')
    expect(value['session_id']).toBe('sess-1')
    expect(value['bound']).toBe(true)
    // the frozen run row verbatim (single binding → complete subject, no cap)
    expect(value['run']).toMatchObject({ id: 'R-81', workstream_id: 'WS-1', task_id: 'T-1', status: 'RUNNING' })
    expect(value['workstream']).toEqual({ id: 'WS-1', title: '主标定管线', topic_id: 'TPC-1' })
    expect(value['task']).toEqual({ id: 'T-1', title: '标定数据采集方案对比' })
    expectValueMatchesHostCodec(tool.output.schema, value)
    // one call, its own port only — read-only forwarding shape
    expect(deps.contextGetCalls).toEqual(['sess-1'])
    expect(deps.planGetCalls).toHaveLength(0)
    expect(deps.historyQueryCalls).toHaveLength(0)
    expect(deps.contractReadCalls).toHaveLength(0)
  })

  it('an unbound session is an HONEST EMPTY RESULT (status ok, bound false) — reads never require a run', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTEXT_GET)
    deps.setContextGet(() => UNBOUND_CONTEXT)
    const value = (await tool.execute({}, readExec('sess-x'))) as Record<string, unknown>
    expect(value['status']).toBe('ok')
    expect(value['bound']).toBe(false)
    expect(value['run']).toBeUndefined()
    expectValueMatchesHostCodec(tool.output.schema, value)
  })

  it('an actor without session_id fails the SUBJECT gate (TOOL_ACTOR_FORBIDDEN) before the port', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTEXT_GET)
    deps.setContextGet(() => BOUND_CONTEXT)
    const error = await expectToolErrorAsync(
      () => tool.execute({}, makeExec({ actor: { kind: 'AGENT', run_id: 'R-1' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    expect(error.message).toContain(RESEARCH_CONTEXT_GET)
    expect(deps.contextGetCalls).toHaveLength(0)
  })

  it('any parameter at all is TOOL_INPUT (frozen no-arg face)', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTEXT_GET)
    deps.setContextGet(() => BOUND_CONTEXT)
    const error = await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-1' }, readExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/workstream_id')
    expect(deps.contextGetCalls).toHaveLength(0)
  })

  it('a structured read-service failure rides TOOL_SERVICE + serviceCode; unknown throws ride TOOL_SERVICE too', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTEXT_GET)
    deps.setContextGet(() => {
      throw new ToolReadServiceError('DECLARATIVE_TREE_UNAVAILABLE', 'fresh tree load failed')
    })
    const structured = await expectToolErrorAsync(() => tool.execute({}, readExec()), 'TOOL_SERVICE')
    expect(structured.detail).toMatchObject({ tool: RESEARCH_CONTEXT_GET, serviceCode: 'DECLARATIVE_TREE_UNAVAILABLE' })

    deps.setContextGet(() => {
      throw new Error('raw driver surprise')
    })
    const unstructured = await expectToolErrorAsync(() => tool.execute({}, readExec()), 'TOOL_SERVICE')
    expect(unstructured.message).toContain('raw driver surprise')
  })

  it('the strict schema rejects an invented extra key (host codec negative pin)', async () => {
    const { tool } = toolOf(RESEARCH_CONTEXT_GET)
    expectValueRejectedByHostCodec(tool.output.schema, { ...BOUND_CONTEXT, status: 'ok', extra: true })
  })
})

/* ------------------------------------------------------------------ *
 * research_plan_get
 * ------------------------------------------------------------------ */

describe('research_plan_get — forwarded (no stub)', () => {
  it('returns the FULL canonical plan of one WS (verbatim order, INV-PLAN-1); host-codec valid', async () => {
    const { tool, deps } = toolOf(RESEARCH_PLAN_GET)
    deps.setPlanGet((wsId) => (wsId === 'WS-1' ? PLAN_VIEW : { ...PLAN_VIEW, workstream: { id: wsId, title: null } }))
    const value = (await tool.execute({ workstream_id: 'WS-1' }, readExec())) as Record<string, unknown>
    expect(value['status']).toBe('ok')
    expect(value['workstream_id']).toBe('WS-1')
    expect(value['ordered_items']).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
    expect(value['present']).toBe(true)
    expect(value['consistent']).toBe(true)
    expectValueMatchesHostCodec(tool.output.schema, value)
    expect(deps.planGetCalls).toEqual(['WS-1'])
    expect(deps.contextGetCalls).toHaveLength(0)
  })

  it('an ABSENT plan.yaml is an honest empty subject (present false, ordered_items []) — the REAL provider surface; an INCONSISTENT plan never reaches the tool (the loader rejects the tree — fail loud, see tests/wiring)', async () => {
    const { tool, deps } = toolOf(RESEARCH_PLAN_GET)
    deps.setPlanGet(() => ({ ...PLAN_VIEW, present: false, consistent: true, ordered_items: [] }))
    const value = (await tool.execute({ workstream_id: 'WS-2' }, readExec())) as Record<string, unknown>
    expect(value['status']).toBe('ok')
    expect(value['present']).toBe(false)
    expect(value['consistent']).toBe(true)
    expect(value['ordered_items']).toEqual([])
    expect(value['problem']).toBeUndefined()
    expectValueMatchesHostCodec(tool.output.schema, value)
  })

  it('a missing workstream is a structured TOOL_SERVICE WS_NOT_FOUND', async () => {
    const { tool, deps } = toolOf(RESEARCH_PLAN_GET)
    deps.setPlanGet(() => {
      throw new ToolReadServiceError('WS_NOT_FOUND', 'workstream WS-404 does not exist')
    })
    const error = await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-404' }, readExec()), 'TOOL_SERVICE')
    expect(error.detail).toMatchObject({ tool: RESEARCH_PLAN_GET, serviceCode: 'WS_NOT_FOUND' })
  })

  it('the frozen 1-key face holds (missing → TOOL_INPUT; empty string → TOOL_INPUT; extra key → TOOL_INPUT)', async () => {
    const { tool, deps } = toolOf(RESEARCH_PLAN_GET)
    deps.setPlanGet(() => PLAN_VIEW)
    await expectToolErrorAsync(() => tool.execute({}, readExec()), 'TOOL_INPUT')
    await expectToolErrorAsync(() => tool.execute({ workstream_id: '' }, readExec()), 'TOOL_INPUT')
    const error = await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-1', limit: 1 }, readExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/limit')
    expect(deps.planGetCalls).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * research_history_query
 * ------------------------------------------------------------------ */

describe('research_history_query — forwarded (no stub)', () => {
  it('a full page passes through verbatim; host-codec valid; frozen cursor fields', async () => {
    const { tool, deps } = toolOf(RESEARCH_HISTORY_QUERY)
    deps.setHistoryQuery((q) => ({ ...PAGE, order: q.order ?? 'semantic', limit: q.limit }))
    const value = (await tool.execute({ workstream_id: 'WS-1' }, readExec())) as Record<string, unknown>
    expect(value['status']).toBe('ok')
    expect(value['workstream_id']).toBe('WS-1')
    expect(value['events']).toHaveLength(1)
    expect((value['events'] as Record<string, unknown>[])[0]).toMatchObject({ eventId: 'H-1', eventSeq: 1, eventType: 'RUN_STARTED' })
    expect(value['next_after_seq']).toBeNull()
    expect(value['exhausted']).toBe(true)
    expectValueMatchesHostCodec(tool.output.schema, value)
    expect(deps.historyQueryCalls).toHaveLength(1)
  })

  it('EMPTY RESULT: a known WS with no events is a valid empty page', async () => {
    const { tool, deps } = toolOf(RESEARCH_HISTORY_QUERY)
    deps.setHistoryQuery((q) => ({ workstream_id: q.workstreamId, order: q.order ?? 'semantic', limit: q.limit, events: [], next_after_seq: null, exhausted: true }))
    const value = (await tool.execute({ workstream_id: 'WS-1', order: 'audit' }, readExec())) as Record<string, unknown>
    expect(value['events']).toEqual([])
    expect(value['exhausted']).toBe(true)
    expect(deps.historyQueryCalls[0]).toMatchObject({ workstreamId: 'WS-1', order: 'audit' })
    expectValueMatchesHostCodec(tool.output.schema, value)
  })

  it('PAGE-SIZE POLICY (Q2, history only): default limit 100; above the 1000 cap is REFUSED (never silently truncated)', async () => {
    const { tool, deps } = toolOf(RESEARCH_HISTORY_QUERY)
    deps.setHistoryQuery((q) => ({ ...PAGE, limit: q.limit }))
    await tool.execute({ workstream_id: 'WS-1' }, readExec())
    expect(deps.historyQueryCalls[0]).toMatchObject({ limit: 100 })
    await tool.execute({ workstream_id: 'WS-1', limit: 1000 }, readExec())
    expect(deps.historyQueryCalls[1]).toMatchObject({ limit: 1000 })
    const error = await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-1', limit: 1001 }, readExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/limit')
    expect(deps.historyQueryCalls).toHaveLength(2)
  })

  it('integer validation is enforced (non-integer / negative / non-number → TOOL_INPUT)', async () => {
    const { tool, deps } = toolOf(RESEARCH_HISTORY_QUERY)
    deps.setHistoryQuery((q) => ({ ...PAGE, limit: q.limit }))
    for (const bad of [{ limit: 1.5 }, { limit: -3 }, { limit: '10' }, { after_seq: -1 }, { before_seq: 0.5 }]) {
      await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-1', ...bad }, readExec()), 'TOOL_INPUT')
    }
    expect(deps.historyQueryCalls).toHaveLength(0)
  })

  it('CURSOR BOUNDARY: after_seq/before_seq/order forward verbatim to the frozen query surface', async () => {
    const { tool, deps } = toolOf(RESEARCH_HISTORY_QUERY)
    deps.setHistoryQuery((q) => ({ ...PAGE, order: q.order ?? 'semantic', limit: q.limit, next_after_seq: null }))
    await tool.execute({ workstream_id: 'WS-1', after_seq: 10, before_seq: 20, order: 'audit', limit: 5 }, readExec())
    expect(deps.historyQueryCalls[0]).toEqual({ workstreamId: 'WS-1', afterSeq: 10, beforeSeq: 20, order: 'audit', limit: 5 })
    // an empty order value is enum-refused
    await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-1', order: 'temporal' }, readExec()), 'TOOL_INPUT')
    expect(HISTORY_ORDERS).toEqual(['semantic', 'audit'])
  })

  it('structured + unstructured service failures map to TOOL_SERVICE (query-internal REPLAY_INPUT keeps its serviceCode)', async () => {
    const { tool, deps } = toolOf(RESEARCH_HISTORY_QUERY)
    deps.setHistoryQuery(() => {
      throw new ToolReadServiceError('WS_NOT_FOUND', 'workstream WS-404 does not exist')
    })
    const missing = await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-404' }, readExec()), 'TOOL_SERVICE')
    expect(missing.detail).toMatchObject({ tool: RESEARCH_HISTORY_QUERY, serviceCode: 'WS_NOT_FOUND' })

    deps.setHistoryQuery(() => {
      throw new ReplayInputError('beforeSeq must be > afterSeq + 1')
    })
    const replay = await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-1' }, readExec()), 'TOOL_SERVICE')
    expect(replay.detail).toMatchObject({ serviceCode: 'REPLAY_INPUT' })

    deps.setHistoryQuery(() => {
      throw new Error('sqlite surprise')
    })
    await expectToolErrorAsync(() => tool.execute({ workstream_id: 'WS-1' }, readExec()), 'TOOL_SERVICE')
  })

  it('the strict schema rejects a mid-page truncation lie (truncated but not exhausted)', async () => {
    const { tool } = toolOf(RESEARCH_HISTORY_QUERY)
    expectValueRejectedByHostCodec(tool.output.schema, { ...PAGE, status: 'ok', bogus: 1 })
  })
})

/* ------------------------------------------------------------------ *
 * research_contract_read
 * ------------------------------------------------------------------ */

describe('research_contract_read — forwarded (no stub)', () => {
  it('returns the FULL single-edge subject (content byte-verbatim); host-codec valid', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTRACT_READ)
    deps.setContractRead((edgeId) => (edgeId === 'TE-2' ? CONTRACT_VIEW : { ...CONTRACT_VIEW, edge: { ...CONTRACT_VIEW.edge, id: edgeId }, content: null }))
    const value = (await tool.execute({ edge_id: 'TE-2' }, readExec())) as Record<string, unknown>
    expect(value['status']).toBe('ok')
    expect(value['edge']).toMatchObject({ id: 'TE-2', operation: 'MERGE', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] })
    expect(value['content']).toContain('# Merge Contract TE-2')
    expect(value['path']).toBe('merges/TE-2/contract.md')
    expectValueMatchesHostCodec(tool.output.schema, value)
    expect(deps.contractReadCalls).toEqual(['TE-2'])
  })

  it('a DROPPED-edge lifecycle passes the host codec (the FROZEN wsLifecycle enum: PLANNED/REALIZED/DROPPED — no VOID exists)', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTRACT_READ)
    deps.setContractRead(() => ({ ...CONTRACT_VIEW, edge: { ...CONTRACT_VIEW.edge, lifecycle: 'DROPPED' } }))
    const value = (await tool.execute({ edge_id: 'TE-2' }, readExec())) as Record<string, unknown>
    expect((value['edge'] as Record<string, unknown>)['lifecycle']).toBe('DROPPED')
    expectValueMatchesHostCodec(tool.output.schema, value)
  })

  it('AN EDGE WITHOUT A CONTRACT is content null (ADJ-7 VALUE face — absence is data, not an error)', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTRACT_READ)
    deps.setContractRead(() => ({ ...CONTRACT_VIEW, content: null }))
    const value = (await tool.execute({ edge_id: 'TE-1' }, readExec())) as Record<string, unknown>
    expect(value['status']).toBe('ok')
    expect(value['content']).toBeNull()
    expectValueMatchesHostCodec(tool.output.schema, value)
  })

  it('an unknown edge is a structured TOOL_SERVICE EDGE_NOT_FOUND; kernel TopologyStoreError keeps its code', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTRACT_READ)
    deps.setContractRead(() => {
      throw new ToolReadServiceError('EDGE_NOT_FOUND', 'TE-404 names no topology edge')
    })
    const missing = await expectToolErrorAsync(() => tool.execute({ edge_id: 'TE-404' }, readExec()), 'TOOL_SERVICE')
    expect(missing.detail).toMatchObject({ tool: RESEARCH_CONTRACT_READ, serviceCode: 'EDGE_NOT_FOUND' })

    deps.setContractRead(() => {
      throw new TopologyStoreError('INVALID_ID', 'edge id must match TE-<n>')
    })
    const bad = await expectToolErrorAsync(() => tool.execute({ edge_id: 'nope' }, readExec()), 'TOOL_SERVICE')
    expect(bad.detail).toMatchObject({ serviceCode: 'INVALID_ID' })
  })

  it('the frozen 1-key face holds (missing / empty / extra → TOOL_INPUT, port untouched)', async () => {
    const { tool, deps } = toolOf(RESEARCH_CONTRACT_READ)
    deps.setContractRead(() => CONTRACT_VIEW)
    await expectToolErrorAsync(() => tool.execute({}, readExec()), 'TOOL_INPUT')
    await expectToolErrorAsync(() => tool.execute({ edge_id: '' }, readExec()), 'TOOL_INPUT')
    const error = await expectToolErrorAsync(() => tool.execute({ edge_id: 'TE-1', workstream_id: 'WS-1' }, readExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/workstream_id')
    expect(deps.contractReadCalls).toHaveLength(0)
  })
})
