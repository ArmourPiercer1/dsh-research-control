/**
 * WP-1.4 — TE lifecycle state machine (DOMAIN_SCHEMA §13 L548 WsLifecycle
 * row, applied to TopologyEdge per §3.1) + the transition executor
 * (store.transitionEdge) with its HISTORY_EVENT_CATALOG §5.8 preconditions.
 */
import { describe, expect, it } from 'vitest'

import {
  isLegalTransition,
  legalTargets,
  TE_TRANSITIONS,
} from '../../src/host/domain/topology/index.js'
import type { WsLifecycle } from '../../src/host/domain/loader/index.js'
import {
  expectStoreError,
  makeIo,
  makeStore,
  parseTopologyFile,
  TOPOLOGY_PATH,
} from './fixtures.js'

const STATES: readonly WsLifecycle[] = ['PLANNED', 'REALIZED', 'DROPPED']

describe('TE_TRANSITIONS table (frozen §13 semantics)', () => {
  it('encodes exactly: PLANNED → [REALIZED, DROPPED]; REALIZED → [DROPPED]; DROPPED → []', () => {
    expect(Object.keys(TE_TRANSITIONS).sort()).toEqual(['DROPPED', 'PLANNED', 'REALIZED'])
    expect(legalTargets('PLANNED')).toEqual(['REALIZED', 'DROPPED'])
    expect(legalTargets('REALIZED')).toEqual(['DROPPED'])
    expect(legalTargets('DROPPED')).toEqual([])
  })

  it('isLegalTransition: the full 3×3 matrix', () => {
    const matrix: Record<WsLifecycle, Record<WsLifecycle, boolean>> = {
      PLANNED: { PLANNED: false, REALIZED: true, DROPPED: true },
      REALIZED: { PLANNED: false, REALIZED: false, DROPPED: true },
      DROPPED: { PLANNED: false, REALIZED: false, DROPPED: false },
    }
    for (const from of STATES) {
      for (const to of STATES) {
        expect(isLegalTransition(from, to), `${from} -> ${to}`).toBe(matrix[from][to])
      }
    }
  })
})

describe('transitionEdge — legal transitions persist', () => {
  it('PLANNED → REALIZED: back-fills realized_event_id and persists', () => {
    const io = makeIo()
    const store = makeStore(io)
    const result = store.transitionEdge('TE-1', 'REALIZED', { actor: 'USER', realized_event_id: 'H-1001' })
    expect(result).toMatchObject({ id: 'TE-1', lifecycle: 'REALIZED', realized_event_id: 'H-1001' })
    // other fields preserved
    expect(result.operation).toBe('FORK')
    expect(result.inputs).toEqual(['WS-1'])
    expect(result.outputs).toEqual(['WS-2'])
    expect(result.note).toBe('分支出独立标定管线')
    // persisted (file + reload)
    const reloaded = parseTopologyFile(io).topology.edges[0]!
    expect(reloaded.lifecycle).toBe('REALIZED')
    expect(reloaded.realized_event_id).toBe('H-1001')
    expect(store.getEdge('TE-1').lifecycle).toBe('REALIZED')
  })

  it('PLANNED → DROPPED (USER) persists', () => {
    const io = makeIo()
    const store = makeStore(io)
    const result = store.transitionEdge('TE-2', 'DROPPED', { actor: 'USER' })
    expect(result.lifecycle).toBe('DROPPED')
    expect(result.realized_event_id).toBeUndefined()
    expect(parseTopologyFile(io).topology.edges[1]!.lifecycle).toBe('DROPPED')
  })

  it('REALIZED → DROPPED (USER) persists (DROPPED reachable from both non-terminal states)', () => {
    const io = makeIo()
    const store = makeStore(io)
    store.transitionEdge('TE-1', 'REALIZED', { actor: 'USER', realized_event_id: 'H-1' })
    const result = store.transitionEdge('TE-1', 'DROPPED', { actor: 'USER' })
    expect(result.lifecycle).toBe('DROPPED')
    expect(parseTopologyFile(io).topology.edges[0]!.lifecycle).toBe('DROPPED')
  })

  it('the executor wrote the file through the atomic protocol (tmp write + rename)', () => {
    const io = makeIo()
    makeStore(io).transitionEdge('TE-1', 'DROPPED', { actor: 'USER' })
    const ops = io.ops.map((o) => o.op)
    expect(ops).toEqual(['writeFile', 'rename'])
    const rename = io.ops.find((o) => o.op === 'rename')!
    expect(rename.path).toBe(TOPOLOGY_PATH + '.dshrc-tmp')
    expect(rename.to).toBe(TOPOLOGY_PATH)
  })
})

describe('transitionEdge — illegal transitions are rejected (current/target/legal in the error)', () => {
  it('same-state no-ops are not in the table (all three states)', () => {
    const store = makeStore()
    const e1 = expectStoreError(() => store.transitionEdge('TE-1', 'PLANNED', { actor: 'USER' }), 'INVALID_TRANSITION')
    expect(e1.message).toContain('TE-1')
    expect(e1.message).toContain('PLANNED -> PLANNED')
    expect(e1.message).toContain('legal targets from PLANNED: [REALIZED, DROPPED]')

    const io = makeIo()
    const realized = makeStore(io)
    realized.transitionEdge('TE-1', 'REALIZED', { actor: 'USER', realized_event_id: 'H-1' })
    const e2 = expectStoreError(() => makeStore(io).transitionEdge('TE-1', 'REALIZED', { actor: 'USER', realized_event_id: 'H-2' }), 'INVALID_TRANSITION')
    expect(e2.message).toContain('REALIZED -> REALIZED')
    expect(e2.message).toContain('legal targets from REALIZED: [DROPPED]')

    const dropped = makeStore(makeIo())
    dropped.transitionEdge('TE-2', 'DROPPED', { actor: 'USER' })
    const e3 = expectStoreError(() => dropped.transitionEdge('TE-2', 'DROPPED', { actor: 'USER' }), 'INVALID_TRANSITION')
    expect(e3.message).toContain('DROPPED -> DROPPED')
    expect(e3.message).toContain('DROPPED is terminal')
  })

  it('REALIZED → PLANNED is illegal (plan change does not rewrite history, §3.1)', () => {
    const io = makeIo()
    makeStore(io).transitionEdge('TE-1', 'REALIZED', { actor: 'USER', realized_event_id: 'H-1' })
    const err = expectStoreError(() => makeStore(io).transitionEdge('TE-1', 'PLANNED', { actor: 'USER' }), 'INVALID_TRANSITION')
    expect(err.message).toContain('REALIZED -> PLANNED')
    expect(err.message).toContain('legal targets from REALIZED: [DROPPED]')
    // file untouched by the rejected transition
    expect(parseTopologyFile(io).topology.edges[0]!.lifecycle).toBe('REALIZED')
  })

  it('DROPPED is terminal: DROPPED → PLANNED and DROPPED → REALIZED rejected', () => {
    const dropped = makeStore(makeIo())
    dropped.transitionEdge('TE-2', 'DROPPED', { actor: 'USER' })
    const e1 = expectStoreError(() => dropped.transitionEdge('TE-2', 'PLANNED', { actor: 'USER' }), 'INVALID_TRANSITION')
    expect(e1.message).toContain('DROPPED -> PLANNED')
    expect(e1.message).toContain('DROPPED is terminal')
    const e2 = expectStoreError(() => dropped.transitionEdge('TE-2', 'REALIZED', { actor: 'USER', realized_event_id: 'H-9' }), 'INVALID_TRANSITION')
    expect(e2.message).toContain('DROPPED -> REALIZED')
  })

  it('every illegal pair (all 6) is rejected with the exact message shape', () => {
    // Prepare one store with edges in each state: TE-1 PLANNED, TE-2 DROPPED,
    // then realize a third edge for the REALIZED state.
    const io = makeIo()
    const store = makeStore(io)
    store.addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-3'] })
    store.transitionEdge('TE-2', 'DROPPED', { actor: 'USER' })
    store.transitionEdge('TE-3', 'REALIZED', { actor: 'USER', realized_event_id: 'H-3' })

    const attempt = (teId: string, to: WsLifecycle) =>
      expectStoreError(() => store.transitionEdge(teId, to, { actor: 'USER', realized_event_id: 'H-9' }), 'INVALID_TRANSITION')

    // PLANNED (TE-1): self
    expect(attempt('TE-1', 'PLANNED').message).toContain('legal targets from PLANNED: [REALIZED, DROPPED]')
    // REALIZED (TE-3): -> PLANNED, self
    expect(attempt('TE-3', 'PLANNED').message).toContain('legal targets from REALIZED: [DROPPED]')
    expect(attempt('TE-3', 'REALIZED').message).toContain('legal targets from REALIZED: [DROPPED]')
    // DROPPED (TE-2): -> PLANNED, -> REALIZED, self
    expect(attempt('TE-2', 'PLANNED').message).toContain('DROPPED is terminal')
    expect(attempt('TE-2', 'REALIZED').message).toContain('DROPPED is terminal')
    expect(attempt('TE-2', 'DROPPED').message).toContain('DROPPED is terminal')
    // no transition survived
    expect(store.edges().map((e) => [e.id, e.lifecycle])).toEqual([
      ['TE-1', 'PLANNED'],
      ['TE-2', 'DROPPED'],
      ['TE-3', 'REALIZED'],
    ])
  })
})

describe('transitionEdge — authorization (§13 「仅用户」)', () => {
  it('DROPPED by AGENT / PLUGIN / SYSTEM is rejected (UNAUTHORIZED_TRANSITION names the actor)', () => {
    const store = makeStore()
    for (const actor of ['AGENT', 'PLUGIN', 'SYSTEM'] as const) {
      const err = expectStoreError(() => store.transitionEdge('TE-2', 'DROPPED', { actor }), 'UNAUTHORIZED_TRANSITION')
      expect(err.message).toContain('user-only')
      expect(err.message).toContain(`actor=${actor}`)
    }
  })

  it('DROPPED by USER is accepted; a non-USER actor cannot UN-REJECT a legal transition otherwise', () => {
    const store = makeStore()
    expect(() => store.transitionEdge('TE-2', 'DROPPED', { actor: 'USER' })).not.toThrow()
  })
})

describe('transitionEdge — realize preconditions (§5.8)', () => {
  it('→ REALIZED without realized_event_id is rejected (MISSING_REALIZED_EVENT_ID)', () => {
    const err = expectStoreError(() => makeStore().transitionEdge('TE-1', 'REALIZED', { actor: 'USER' }), 'MISSING_REALIZED_EVENT_ID')
    expect(err.message).toContain('TE-1')
    expect(err.message).toContain('PLANNED -> REALIZED')
  })

  it('→ REALIZED with a malformed H id is rejected (INVALID_ID)', () => {
    for (const bad of ['H-0', 'H-x', 'X-1']) {
      expectStoreError(() => makeStore().transitionEdge('TE-1', 'REALIZED', { actor: 'USER', realized_event_id: bad }), 'INVALID_ID')
    }
  })

  it('→ REALIZED on a multi-input FORK edge is rejected (REALIZE_ARITY, §5.8 V1)', () => {
    const io = makeIo()
    const store = makeStore(io)
    store.addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] }) // arity NOT enforced on add (§3.1 V1 不强制基数)
    const err = expectStoreError(
      () => store.transitionEdge('TE-3', 'REALIZED', { actor: 'USER', realized_event_id: 'H-1' }),
      'REALIZE_ARITY',
    )
    expect(err.message).toContain('TE-3')
    expect(err.message).toContain('exactly 1 input')
    expect(err.message).toContain('[WS-1, WS-2]')
    // file untouched
    expect(parseTopologyFile(io).topology.edges[2]!.lifecycle).toBe('PLANNED')
  })

  it('→ REALIZED on a multi-output MERGE edge is rejected (REALIZE_ARITY, §5.8 V1)', () => {
    const io = makeIo()
    const store = makeStore(io)
    store.addEdge({ id: 'TE-4', operation: 'MERGE', inputs: ['WS-1'], outputs: ['WS-2', 'WS-3'] })
    const err = expectStoreError(
      () => store.transitionEdge('TE-4', 'REALIZED', { actor: 'USER', realized_event_id: 'H-1' }),
      'REALIZE_ARITY',
    )
    expect(err.message).toContain('TE-4')
    expect(err.message).toContain('exactly 1 output')
    expect(err.message).toContain('[WS-2, WS-3]')
  })

  it('a single-input MERGE and multi-output FORK pass the arity check (complementary side unconstrained)', () => {
    const io = makeIo()
    const store = makeStore(io)
    store.addEdge({ id: 'TE-5', operation: 'MERGE', inputs: ['WS-1'], outputs: ['WS-2'] }) // degenerate 1→1: legal
    store.addEdge({ id: 'TE-6', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2', 'WS-3'] }) // typical 1→N: legal
    expect(store.transitionEdge('TE-5', 'REALIZED', { actor: 'USER', realized_event_id: 'H-5' }).lifecycle).toBe('REALIZED')
    expect(store.transitionEdge('TE-6', 'REALIZED', { actor: 'USER', realized_event_id: 'H-6' }).lifecycle).toBe('REALIZED')
  })
})

describe('transitionEdge — edge lookup', () => {
  it('rejects unknown edges (EDGE_NOT_FOUND) and malformed teIds (INVALID_ID)', () => {
    const err = expectStoreError(() => makeStore().transitionEdge('TE-9', 'DROPPED', { actor: 'USER' }), 'EDGE_NOT_FOUND')
    expect(err.message).toContain('TE-9')
    expectStoreError(() => makeStore().transitionEdge('T-1', 'DROPPED', { actor: 'USER' }), 'INVALID_ID')
  })
})
