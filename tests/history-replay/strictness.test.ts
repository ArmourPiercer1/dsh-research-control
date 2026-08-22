/**
 * WP-2.3 — TC-HIST-008 (schema strictness: unknown eventType / unknown
 * schemaVersion / payload violation → 拒绝写入) at the WRITE GATE that
 * protects the replay face: the real frozen-schema registry (WP-2.2)
 * wired into the store's `validate` hook (WP-2.1 seam). Rejected events
 * never reach the log — and therefore never reach any replay — and a
 * rejected batch consumes no seq (TC-HIST-003 interaction).
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { loadHistoryEventRegistry, type HistoryEventRegistry } from '../../src/host/history/registry/index.js'
import { queryEvents } from '../../src/host/history/replay/index.js'
import {
  appendValidated,
  FsReader,
  makeEvent,
  ShapeValidationError,
  WR_HISTORY_SCHEMA_DIR,
} from './helpers.js'
import { freshStore } from './helpers.js'
import type { ResearchStore } from '../../src/host/persistence/store/index.js'

let registry: HistoryEventRegistry
let store: ResearchStore

/** A shape-valid RUN_STARTED payload (catalog §5.1: run_id + initiated_by
 *  are the required pair; run_id itself is the isolated negative in the
 *  payload-violation case below). */
const RUN_STARTED_PAYLOAD = (runId: string) => ({
  run_id: runId,
  initiated_by: { kind: 'USER', user_id: 'u-alice' },
})

beforeAll(() => {
  registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
  store = freshStore()
})

describe('TC-HIST-008: schema strictness at the write gate (replay face protected)', () => {
  it('the real frozen registry loads: 20 event types, all schemaVersion 1 (positive control)', () => {
    expect(registry.isUsable).toBe(true)
    expect(registry.eventTypes).toHaveLength(20)
  })

  it('unknown eventType → rejected (structured errors), log stays empty, NO seq consumed', () => {
    expect(() =>
      appendValidated(store, registry, [
        makeEvent({ eventId: 'H-9001', eventType: 'RUN_STARTED_NOPE', payload: { run_id: 'R-9' } }),
      ]),
    ).toThrow(ShapeValidationError)
    try {
      appendValidated(store, registry, [
        makeEvent({ eventId: 'H-9001', eventType: 'RUN_STARTED_NOPE', payload: { run_id: 'R-9' } }),
      ])
    } catch (e) {
      expect((e as ShapeValidationError).errors.length).toBeGreaterThan(0)
    }
    expect(store.listRange('WS-1', 1)).toEqual([])
    // the rejection consumed no seq: the first VALID append still takes seq 1
    appendValidated(store, registry, [makeEvent({ eventId: 'H-9010', eventType: 'RUN_STARTED', payload: RUN_STARTED_PAYLOAD('R-1') })])
    expect(store.getEvent('WS-1', 1)?.eventId).toBe('H-9010')
  })

  it('unknown schemaVersion (2) → rejected (V1 is the only version, catalog §1)', () => {
    expect(() =>
      appendValidated(store, registry, [
        makeEvent({ eventId: 'H-9002', eventType: 'RUN_STARTED', schemaVersion: 2, payload: RUN_STARTED_PAYLOAD('R-2') }),
      ]),
    ).toThrow(ShapeValidationError)
    expect(store.listRange('WS-1', 2)).toEqual([])
  })

  it('payload violation (RUN_STARTED without the required run_id) → rejected', () => {
    expect(() =>
      appendValidated(store, registry, [
        makeEvent({ eventId: 'H-9003', eventType: 'RUN_STARTED', payload: { initiated_by: { kind: 'USER', user_id: 'u-alice' } } }),
      ]),
    ).toThrow(ShapeValidationError)
    expect(store.listRange('WS-1', 2)).toEqual([])
  })

  it('payload violation with a precise AJV path (TASK_EXECUTION_CHANGED missing `to`)', () => {
    try {
      appendValidated(store, registry, [
        makeEvent({
          eventId: 'H-9004',
          eventType: 'TASK_EXECUTION_CHANGED',
          payload: { task_id: 'T-1', from: 'PLANNED' },
        }),
      ])
      expect.unreachable('expected a rejection')
    } catch (e) {
      expect(e).toBeInstanceOf(ShapeValidationError)
      const paths = (e as ShapeValidationError).errors.map(
        (er) => JSON.stringify((er as { path?: unknown }).path ?? (er as { instancePath?: unknown }).instancePath ?? ''),
      )
      expect(paths.join(' ')).toMatch(/to/)
    }
    expect(store.listRange('WS-1', 2)).toEqual([])
  })

  it('a mixed batch (one valid + one invalid) → the WHOLE batch rolls back', () => {
    expect(() =>
      appendValidated(store, registry, [
        makeEvent({ eventId: 'H-9005', eventType: 'RUN_STARTED', payload: RUN_STARTED_PAYLOAD('R-5A') }),
        makeEvent({ eventId: 'H-9006', eventType: 'NOT_A_TYPE', payload: {} }),
      ]),
    ).toThrow(ShapeValidationError)
    // H-9005 (valid on its own) did NOT survive the failed batch
    expect(store.listRange('WS-1', 1).map((e) => e.eventId)).toEqual(['H-9010'])
  })

  it('a valid event with the correct (eventType, schemaVersion, payload) → accepted (the gate is not over-rejecting)', () => {
    appendValidated(store, registry, [
      makeEvent({
        eventId: 'H-9011',
        eventType: 'TASK_EXECUTION_CHANGED',
        payload: { task_id: 'T-1', from: 'PLANNED', to: 'ACTIVE' },
      }),
    ])
    expect(store.getEvent('WS-1', 2)?.eventId).toBe('H-9011')
  })

  it('the replay view stays consistent across rejections: queries see exactly the accepted events', () => {
    const page = queryEvents(store, 'WS-1', { order: 'audit' })
    expect(page.events.map((e) => e.eventId)).toEqual(['H-9010', 'H-9011'])
    expect(page.exhausted).toBe(true)
  })
})
