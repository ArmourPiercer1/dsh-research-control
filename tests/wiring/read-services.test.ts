/**
 * G2 (§2d) — the four read tools over the REAL composed services
 * (tests/wiring/helpers.ts `makeWiring`: real temp Git repo + real
 * `.research` tree + real research.sqlite + the real frozen schemas +
 * the live `wiring.tools` face). This is the acceptance the stub
 * retirement promised: success DTOs from REAL service dependencies,
 * empty results and missing objects distinguished, pagination boundaries
 * on the real log, and a byte-level NO-WRITE-SIDE-EFFECT audit of every
 * read across all four lanes.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { HostWiring } from '../../src/host/service/wiring/index.js'
import type { ResearchToolDefinition } from '../../src/host/tools/index.js'
import type { ToolActorRef } from '../../src/host/tools/index.js'
import { ToolError } from '../../src/host/tools/index.js'
import { makeWiring, USER } from './helpers.js'
import { expectValueMatchesHostCodec } from '../helpers/host-output-codec.js'

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function tool(wiring: HostWiring, name: string): ResearchToolDefinition {
  const def = wiring.tools.find((t) => t.name === name)
  if (def === undefined) throw new Error(`wiring.tools carries no ${name}`)
  return def
}

function readExec(sessionId = 'sess-g2-a'): { signal: AbortSignal; actor: ToolActorRef } {
  return { signal: new AbortController().signal, actor: { kind: 'AGENT', session_id: sessionId } }
}

/** Execute one read tool, returning the canonical value (throwing is a failure). */
async function read(name: string, wiring: HostWiring, args: Record<string, unknown>, sessionId = 'sess-g2-a'): Promise<Record<string, unknown>> {
  const value = (await tool(wiring, name).execute(args, readExec(sessionId))) as Record<string, unknown>
  // every success value validates through the REAL host output codec
  expectValueMatchesHostCodec(tool(wiring, name).output.schema, value)
  return value
}

async function expectServiceCode(name: string, wiring: HostWiring, args: Record<string, unknown>, sessionId = 'sess-g2-a'): Promise<string> {
  let thrown: unknown
  try {
    await tool(wiring, name).execute(args, readExec(sessionId))
  } catch (e) {
    thrown = e
  }
  if (!(thrown instanceof ToolError) || thrown.code !== 'TOOL_SERVICE') {
    throw new Error(`expected TOOL_SERVICE, got ${String((thrown as Error)?.name)}(${String((thrown as ToolError)?.code)}): ${(thrown as Error)?.message}`)
  }
  const serviceCode = (thrown.detail as { serviceCode?: string } | undefined)?.serviceCode
  expect(thrown.message, `${name}: message names the tool`).toContain(name)
  return serviceCode ?? '<none>'
}

/** sha256 over EVERY file under `root` (path → content hash map). */
function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) out[relative(root, abs)] = createHash('sha256').update(readFileSync(abs)).digest('hex')
    }
  }
  walk(root)
  return out
}

/* ------------------------------------------------------------------ *
 * The real-service matrix
 * ------------------------------------------------------------------ */

describe('G2 read tools over the REAL wiring (tree + sqlite + frozen schemas)', () => {
  it('research_context_get: bound session → the full subject from runbinding + declarative loader', async () => {
    const { wiring } = makeWiring()
    const { run } = wiring.runBinding.registerRun({ workstreamId: 'WS-1', taskId: 'T-1', dshSessionId: 'sess-g2-a' }, USER)

    const value = await read('research_context_get', wiring, {})
    expect(value['status']).toBe('ok')
    expect(value['bound']).toBe(true)
    expect(value['session_id']).toBe('sess-g2-a')
    expect(value['run']).toMatchObject({
      id: run.id,
      workstream_id: 'WS-1',
      task_id: 'T-1',
      dsh_session_id: 'sess-g2-a',
      status: 'RUNNING',
    })
    expect(value['workstream']).toEqual({ id: 'WS-1', title: '主标定管线', topic_id: 'TPC-1' })
    expect(value['task']).toEqual({ id: 'T-1', title: '标定数据采集方案对比' })

    // the UNBOUND session: honest empty result (no error, no run invented)
    const unbound = await read('research_context_get', wiring, {}, 'sess-g2-unbound')
    expect(unbound).toEqual({ status: 'ok', session_id: 'sess-g2-unbound', bound: false })
  })

  it('research_plan_get: the canonical plan verbatim (INV-PLAN-1 order); absent plan = honest empty; unknown WS = structured', async () => {
    const { wiring } = makeWiring()

    const value = await read('research_plan_get', wiring, { workstream_id: 'WS-1' })
    expect(value['workstream_id']).toBe('WS-1')
    expect(value['title']).toBe('主标定管线')
    expect(value['topic_id']).toBe('TPC-1')
    expect(value['present']).toBe(true)
    expect(value['consistent']).toBe(true)
    expect(value['ordered_items']).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])

    // WS-2 exists in the tree but has NO plan.yaml — the honest empty plan
    const empty = await read('research_plan_get', wiring, { workstream_id: 'WS-2' })
    expect(empty['present']).toBe(false)
    expect(empty['ordered_items']).toEqual([])

    // a missing workstream is a missing OBJECT: structured, not empty
    expect(await expectServiceCode('research_plan_get', wiring, { workstream_id: 'WS-404' })).toBe('WS_NOT_FOUND')
  })

  it('research_history_query: real log pages — default 100, cursor walk, empty WS, boundaries', async () => {
    const { wiring } = makeWiring()
    const { run } = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g2-a' }, USER)
    wiring.runBinding.finishRun(run.id, { outcomeSummary: 'done' }, USER) // two events: RUN_STARTED + RUN_FINISHED

    // default page size (100) applied and ECHOED
    const page = await read('research_history_query', wiring, { workstream_id: 'WS-1' })
    expect(page['limit']).toBe(100)
    expect((page['events'] as unknown[]).length).toBe(2)
    expect(page['exhausted']).toBe(true)
    expect(page['next_after_seq']).toBeNull()
    const events = page['events'] as Record<string, unknown>[]
    expect(events.map((e) => e['eventSeq'])).toEqual([1, 2])
    expect(events.map((e) => e['eventType'])).toEqual(['RUN_STARTED', 'RUN_FINISHED'])

    // cursor walk over the REAL log: limit=1 → full window (density rule:
    // a full page never claims exhaustion) → the next short page ends it
    const first = await read('research_history_query', wiring, { workstream_id: 'WS-1', limit: 1 })
    expect(first['exhausted']).toBe(false)
    expect(first['next_after_seq']).toBe(1)
    const second = await read('research_history_query', wiring, { workstream_id: 'WS-1', limit: 1, after_seq: first['next_after_seq'], order: 'audit' })
    expect((second['events'] as Record<string, unknown>[]).map((e) => e['eventSeq'])).toEqual([2])
    expect(second['exhausted']).toBe(false) // full window [2..2] — density keeps scanning
    expect(second['next_after_seq']).toBe(2)
    const third = await read('research_history_query', wiring, { workstream_id: 'WS-1', limit: 1, after_seq: second['next_after_seq'] })
    expect(third['events']).toEqual([]) // short page: the log ended inside the window
    expect(third['exhausted']).toBe(true)
    expect(third['next_after_seq']).toBeNull()

    // the frozen semantic order presents by (occurredAt, eventSeq) — audit by seq
    const audit = await read('research_history_query', wiring, { workstream_id: 'WS-1', order: 'audit' })
    expect((audit['events'] as Record<string, unknown>[]).map((e) => e['eventSeq'])).toEqual([1, 2])

    // EMPTY RESULT: a known WS with no events
    const empty = await read('research_history_query', wiring, { workstream_id: 'WS-2' })
    expect(empty['events']).toEqual([])
    expect(empty['exhausted']).toBe(true)

    // MISSING OBJECT: unknown WS is structured, not an empty page
    expect(await expectServiceCode('research_history_query', wiring, { workstream_id: 'WS-404' })).toBe('WS_NOT_FOUND')

    // wire-boundary refusals never reach the log
    await expect(tool(wiring, 'research_history_query').execute({ workstream_id: 'WS-1', limit: 1001 }, readExec())).rejects.toSatisfy(
      (e: unknown) => e instanceof ToolError && e.code === 'TOOL_INPUT',
    )
    await expect(tool(wiring, 'research_history_query').execute({ workstream_id: 'WS-1', before_seq: 1, after_seq: 1 }, readExec())).rejects.toSatisfy(
      (e: unknown) => e instanceof ToolError && e.code === 'TOOL_SERVICE' && (e.detail as { serviceCode: string }).serviceCode === 'REPLAY_INPUT',
    )
  })

  it('research_contract_read: real contract.md bytes; edge-without-contract = null; unknown edge = structured', async () => {
    const { wiring } = makeWiring()

    const value = await read('research_contract_read', wiring, { edge_id: 'TE-2' })
    expect(value['edge']).toEqual({
      id: 'TE-2',
      topic_id: 'TPC-1',
      operation: 'MERGE',
      lifecycle: 'PLANNED',
      inputs: ['WS-1', 'WS-2'],
      outputs: ['WS-3'],
    })
    expect(String(value['content'])).toContain('# Merge Contract TE-2')
    expect(value['path']).toBe('merges/TE-2/contract.md')

    // TE-1 is a real edge WITHOUT a contract file — the ADJ-7 VALUE face
    const absent = await read('research_contract_read', wiring, { edge_id: 'TE-1' })
    expect(absent['content']).toBeNull()
    expect((absent['edge'] as Record<string, unknown>)['id']).toBe('TE-1')

    // a TE id naming no edge = missing object (the tree snapshot is the authority)
    expect(await expectServiceCode('research_contract_read', wiring, { edge_id: 'TE-404' })).toBe('EDGE_NOT_FOUND')
    // a malformed id keeps the kernel code
    expect(await expectServiceCode('research_contract_read', wiring, { edge_id: 'not-an-edge' })).toBe('INVALID_ID')
  })

  it('DROPPED-edge contract over the real tree validates through the host codec (frozen wsLifecycle enum)', async () => {
    const { wiring, researchRoot } = makeWiring()
    // the FILE is the truth (fresh-load discipline): flip TE-2's lifecycle on disk
    const topoPath = join(researchRoot, 'topics', 'TPC-1', 'topology.yaml')
    const topo = readFileSync(topoPath, 'utf8')
    expect(topo).toContain('TE-2')
    writeFileSync(topoPath, topo.replace('    - id: TE-2\n      topic_id: TPC-1\n      operation: MERGE\n      lifecycle: PLANNED', '    - id: TE-2\n      topic_id: TPC-1\n      operation: MERGE\n      lifecycle: DROPPED'), 'utf8')
    expect(readFileSync(topoPath, 'utf8')).toContain('lifecycle: DROPPED')

    const value = await read('research_contract_read', wiring, { edge_id: 'TE-2' })
    expect((value['edge'] as Record<string, unknown>)['lifecycle']).toBe('DROPPED')
    expect(String(value['content'])).toContain('# Merge Contract TE-2')
  })

  it('DELETED contract.md inside a legal merges/<TE> dir = content:null (not a tree failure); other lanes still fail loud', async () => {
    const { wiring, researchRoot } = makeWiring()
    // post-boot deletion: the file goes, the legal TE-2 dir remains (kernel →
    // CONTRACT_NOT_FOUND → null; the loader reports MISSING_REQUIRED for that
    // one file — the SELECTED edge's contract read must tolerate exactly it)
    rmSync(join(researchRoot, 'merges', 'TE-2', 'contract.md'))

    const value = await read('research_contract_read', wiring, { edge_id: 'TE-2' })
    expect(value['status']).toBe('ok')
    expect(value['content']).toBeNull()
    expect(value['path']).toBe('merges/TE-2/contract.md')

    // NARROW tolerance, not a blanket ignore: a DIFFERENT edge's read sees the
    // unresolved tree error and fails loud (the tree stays the authority).
    expect(await expectServiceCode('research_contract_read', wiring, { edge_id: 'TE-1' })).toBe('DECLARATIVE_TREE_UNAVAILABLE')
    expect(await expectServiceCode('research_plan_get', wiring, { workstream_id: 'WS-1' })).toBe('DECLARATIVE_TREE_UNAVAILABLE')
    expect(await expectServiceCode('research_history_query', wiring, { workstream_id: 'WS-1' })).toBe('DECLARATIVE_TREE_UNAVAILABLE')
    // and every OTHER loader error still fails the selected read too:
    // a broken topology.yaml rejects even the TE-2 read.
    writeFileSync(join(researchRoot, 'topics', 'TPC-1', 'topology.yaml'), 'topology:\n  topic_id: TPC-999\n  edges: []\n', 'utf8')
    expect(await expectServiceCode('research_contract_read', wiring, { edge_id: 'TE-2' })).toBe('DECLARATIVE_TREE_UNAVAILABLE')
  })

  it('inconsistent plan fails loud (the loader rejects it — no consistent:false success face, RPC-consistent)', async () => {
    const { wiring, researchRoot } = makeWiring()
    // §16.1 phase-2 violation on disk: a dangling ordered_items reference
    const planPath = join(researchRoot, 'topics', 'TPC-1', 'workstreams', 'WS-1', 'plan.yaml')
    writeFileSync(planPath, 'workstream: WS-1\nordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2, T-999]\n', 'utf8')
    expect(await expectServiceCode('research_plan_get', wiring, { workstream_id: 'WS-1' })).toBe('DECLARATIVE_TREE_UNAVAILABLE')
  })

  it('NO WRITE SIDE EFFECT: every read leaves the tree AND the state dir byte-identical', async () => {
    const { wiring, researchRoot, dataDir } = makeWiring()
    const { run } = wiring.runBinding.registerRun({ workstreamId: 'WS-1', taskId: 'T-1', dshSessionId: 'sess-g2-a' }, USER)
    wiring.runBinding.finishRun(run.id, {}, USER)
    void run

    const treeBefore = hashTree(researchRoot)
    const stateBefore = hashTree(dataDir)
    const runsBefore = wiring.tables.listAllRuns().length
    const eventsBefore = wiring.store.listRange('WS-1', 1).length

    // one sweep across all four read lanes (success AND structured-failure paths)
    await read('research_context_get', wiring, {})
    await read('research_plan_get', wiring, { workstream_id: 'WS-1' })
    await read('research_history_query', wiring, { workstream_id: 'WS-1', limit: 1 })
    await read('research_contract_read', wiring, { edge_id: 'TE-2' })
    await expectServiceCode('research_plan_get', wiring, { workstream_id: 'WS-404' })
    await expectServiceCode('research_history_query', wiring, { workstream_id: 'WS-404' })
    await expectServiceCode('research_contract_read', wiring, { edge_id: 'TE-404' })

    expect(hashTree(researchRoot)).toEqual(treeBefore) // declarative truth untouched
    expect(hashTree(dataDir)).toEqual(stateBefore) // operational state untouched (incl. WAL)
    expect(wiring.tables.listAllRuns()).toHaveLength(runsBefore)
    expect(wiring.store.listRange('WS-1', 1)).toHaveLength(eventsBefore)
    void statSync
  })

  it('read-only lanes need NO run: an AGENT session without any run serves all four reads', async () => {
    const { wiring } = makeWiring()
    // no registerRun at all — the actor below has only a session identity
    const ctx = { signal: new AbortController().signal, actor: { kind: 'AGENT' as const, session_id: 'sess-g2-runless' } }
    expect(((await tool(wiring, 'research_context_get').execute({}, ctx)) as Record<string, unknown>)['bound']).toBe(false)
    expect(((await tool(wiring, 'research_plan_get').execute({ workstream_id: 'WS-1' }, ctx)) as Record<string, unknown>)['status']).toBe('ok')
    expect(((await tool(wiring, 'research_history_query').execute({ workstream_id: 'WS-1' }, ctx)) as Record<string, unknown>)['status']).toBe('ok')
    expect(((await tool(wiring, 'research_contract_read').execute({ edge_id: 'TE-2' }, ctx)) as Record<string, unknown>)['status']).toBe('ok')
  })
})
