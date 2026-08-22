/**
 * WP-2.1 — the PLANNED→REALIZED atomic-realize seam (TC-DOM-033
 * persistence half): 「首个事件接受与其 PLANNED→REALIZED 迁移
 * （workstream.yaml 更新 + derived_state 写入）为同一原子操作」.
 *
 * The store provides the MECHANISM: inside the same write transaction as
 * the event rows, `realize.apply` fires exactly once per listed workstream
 * whose FIRST event (log empty before the batch) is appended. The callback
 * performs the declarative half (workstream.yaml flip — here a real file
 * write standing in for the service's atomic writer) + the derived_state
 * half. ANY failure → the event row and all derived_state writes roll
 * back: 「事件被拒则 WS 保持 PLANNED」.
 *
 * (The workstream.yaml FILE-side rollback on failure is the service
 * layer's job — the service owns the declarative 真源 writer; the DB half
 * is atomic on its own, which is what this file proves.)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  openDatabase,
  type RealizeContext,
  type ResearchStore,
} from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

/** Fake service-side effect: the workstream.yaml lifecycle flip. */
function fakeWorkstreamYaml(dir: string, ws: string): string {
  const p = join(dir, 'workstreams', ws, 'workstream.yaml')
  return p
}

function wsLifecycleFromYaml(p: string): string | null {
  try {
    const text = readFileSync(p, 'utf8')
    const m = /lifecycle:\s*(\w+)/.exec(text)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

function derivedWsState(store: ResearchStore, ws: string): unknown {
  // read via a raw connection: derived_state is internal to the store
  const db = new DatabaseSync(store.path)
  const row = db
    .prepare('SELECT state FROM derived_state WHERE object_kind = ? AND object_id = ?')
    .get('workstream', ws)
  db.close()
  return row ? JSON.parse(String((row as { state: string }).state)) : null
}

/** The canonical fake callback: file flip + derived_state write. */
function realizeBothHalves(dir: string) {
  const calls: RealizeContext[] = []
  return {
    calls,
    hooks: {
      workstreamIds: () => calls.map((c) => c.workstreamId),
      apply: (ctx: RealizeContext) => {
        calls.push(ctx)
        const yaml = fakeWorkstreamYaml(dir, ctx.workstreamId)
        // (the file half is fake: real workstream.yaml goes through the
        // service's atomic writer in a later WP)
        try {
          mkdirSync(join(dir, 'workstreams', ctx.workstreamId), { recursive: true })
          writeFileSync(yaml, `id: ${ctx.workstreamId}\nlifecycle: REALIZED\n`)
        } catch {
          // file half failure is a callback error: rethrow as-is
          throw new Error(`realize: cannot write ${yaml}`)
        }
        // derived_state half — same transaction as the event row
        ctx.tx.setDerivedState('workstream', ctx.workstreamId, {
          lifecycle: 'REALIZED',
          realized_event_id: ctx.event.eventId,
        })
      },
    } as const,
  }
}

describe('realize seam (TC-DOM-033 persistence half)', () => {
  it('fires exactly once for the FIRST event of a listed workstream, with the right context', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const fake = realizeBothHalves(dir)
    store.appendEvents([makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-7' })], {
      realize: {
        workstreamIds: ['WS-7'],
        apply: fake.hooks.apply,
      },
    })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].workstreamId).toBe('WS-7')
    expect(fake.calls[0].event.eventId).toBe('H-1')
    expect(fake.calls[0].event.eventSeq).toBe(1)
    // both halves committed together with the event
    expect(wsLifecycleFromYaml(fakeWorkstreamYaml(dir, 'WS-7'))).toBe('REALIZED')
    expect(derivedWsState(store, 'WS-7')).toEqual({
      lifecycle: 'REALIZED',
      realized_event_id: 'H-1',
    })
    expect(store.getEvent('WS-7', 1)?.eventId).toBe('H-1')
    store.close()
  })

  it('does NOT fire for a subsequent event of the same workstream', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const fake = realizeBothHalves(dir)
    const realize = { workstreamIds: ['WS-7'], apply: fake.hooks.apply }
    store.appendEvents([makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-7' })], { realize })
    store.appendEvents([makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-7' })], { realize })
    store.close()
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].event.eventSeq).toBe(1)
  })

  it('does NOT fire for a workstream whose log is already non-empty', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-7' })])
    const fake = realizeBothHalves(dir)
    store.appendEvents([makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-7' })], {
      realize: { workstreamIds: ['WS-7'], apply: fake.hooks.apply },
    })
    store.close()
    expect(fake.calls).toHaveLength(0)
  })

  it('does NOT fire for listed workstreams with no event in the batch', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const fake = realizeBothHalves(dir)
    store.appendEvents([makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-1' })], {
      realize: { workstreamIds: ['WS-1', 'WS-9'], apply: fake.hooks.apply },
    })
    store.close()
    expect(fake.calls.map((c) => c.workstreamId)).toEqual(['WS-1'])
  })

  it('fires once per workstream in a multi-WS batch, in batch order', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const fake = realizeBothHalves(dir)
    store.appendEvents(
      [
        makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-1' }),
        makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-2' }),
        makeEvent({ eventId: 'H-3', ownerWorkstreamId: 'WS-1' }),
      ],
      { realize: { workstreamIds: ['WS-1', 'WS-2'], apply: fake.hooks.apply } },
    )
    store.close()
    expect(fake.calls.map((c) => c.workstreamId)).toEqual(['WS-1', 'WS-2'])
    expect(fake.calls.map((c) => c.event.eventSeq)).toEqual([1, 1])
  })

  it('a throwing realize callback rolls back the EVENT and the derived_state (WS stays PLANNED)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    // simulate: the file flip SUCCEEDS, then something downstream fails —
    // the DB half must still roll back completely
    const yaml = fakeWorkstreamYaml(dir, 'WS-3')
    mkdirSync(join(dir, 'workstreams', 'WS-3'), { recursive: true })
    expect(() =>
      store.appendEvents([makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-3' })], {
        derivedState: [
          { objectKind: 'run', objectId: 'R-1', state: { status: 'RUNNING' } },
        ],
        realize: {
          workstreamIds: ['WS-3'],
          apply: (ctx) => {
            writeFileSync(yaml, `id: WS-3\nlifecycle: REALIZED\n`)
            ctx.tx.setDerivedState('workstream', 'WS-3', { lifecycle: 'REALIZED' })
            throw new Error('simulated downstream failure in realize')
          },
        },
      }),
    ).toThrow('simulated downstream failure in realize')
    // DB half fully rolled back: no event → the WS never got its first
    // event → it stays PLANNED (nothing in the event log says otherwise)
    const db = new DatabaseSync(path)
    const ev = db.prepare('SELECT COUNT(*) AS c FROM history_event').get()
    const dv = db.prepare('SELECT COUNT(*) AS c FROM derived_state').get()
    db.close()
    expect(Number((ev as { c: number }).c)).toBe(0)
    expect(Number((dv as { c: number }).c)).toBe(0)
    expect(store.getEvent('WS-3', 1)).toBeNull()
    // the file half is the service's to undo — it remains (documented)
    expect(wsLifecycleFromYaml(yaml)).toBe('REALIZED')
    store.close()
  })

  it('realize + validate compose: validate sees the event with its seq before realize fires', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const order: string[] = []
    store.appendEvents([makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-1' })], {
      validate: (events) => {
        order.push(`validate:${events[0].eventSeq}`)
      },
      realize: {
        workstreamIds: ['WS-1'],
        apply: (ctx) => {
          order.push(`realize:${ctx.event.eventSeq}`)
        },
      },
    })
    store.close()
    expect(order).toEqual(['validate:1', 'realize:1'])
  })
})
