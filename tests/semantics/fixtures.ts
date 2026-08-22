/**
 * WP-2.5 test fixtures.
 *
 * - The real frozen operational schema dir: WR/schema/operational
 *   (read-only contract; schemas.ts loads these exact bytes through an
 *   fs-backed reader — the kernel itself performs no I/O).
 * - Envelope/event builders: full 9-field envelopes with snake_case payloads
 *   (the SAME shape the frozen `history-events.schema.json` payloads carry,
 *   so registry-shaped events fold through the reducer without adaptation).
 * - `deepFreeze`: pure-function pinning (frozen input states — any mutation
 *   attempt by the reducer throws under strict mode).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  ActorRefDoc,
  SemanticInputEvent,
  SemanticState,
} from '../../src/host/domain/semantics/index.js'
const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/semantics → tests → plugin repo → WR). */
export const WR_ROOT = join(HERE, '..', '..', '..')
/** The real frozen operational schema dir (read-only contract). */
export const WR_OPERATIONAL_SCHEMA_DIR = join(WR_ROOT, 'schema', 'operational')
/** The real frozen history schema dir (for cross-suite sync checks). */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** fs-backed `SemanticSchemaReader` (tests may do I/O; the kernel may not). */
export class FsReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/* ------------------------------------------------------------------ *
 * Reference times & envelope builder
 * ------------------------------------------------------------------ */

/** Reference "now" for all fixtures (epoch ms). */
export const T0 = Date.parse('2026-08-22T09:00:00Z')

/** A well-formed USER actor (the row's created_by). */
export const USER_ALICE: ActorRefDoc = { kind: 'USER', user_id: 'u-alice' }
export const AGENT_R1: ActorRefDoc = { kind: 'AGENT', run_id: 'R-1' }
export const PLUGIN_AUDIT: ActorRefDoc = { kind: 'PLUGIN', label: 'audit' }

/**
 * Build a full 9-field envelope. `over` is intentionally untyped: the
 * negative suites feed bad values on purpose (bad ids, missing fields).
 */
export function event(
  eventType: string,
  payload: unknown,
  over: Record<string, unknown> = {},
): SemanticInputEvent {
  return {
    eventId: 'H-1001',
    ownerWorkstreamId: 'WS-1',
    eventSeq: 1,
    eventType,
    schemaVersion: 1,
    occurredAt: T0,
    recordedAt: T0 + 1000,
    actor: USER_ALICE,
    payload,
    ...over,
  }
}

/* ------------------------------------------------------------------ *
 * State builders
 * ------------------------------------------------------------------ */

/** A fully-populated semantic state (one object per registry, mixed statuses). */
export function makeState(): SemanticState {
  return {
    claims: new Map([
      [
        'C-1',
        {
          id: 'C-1',
          workstream_id: 'WS-1',
          statement: 'the treatment reduces latency by 20%',
          created_by: USER_ALICE,
          recorded_at: T0,
          status: 'ACTIVE',
        },
      ],
      [
        'C-2',
        {
          id: 'C-2',
          workstream_id: 'WS-1',
          statement: 'the treatment has no effect',
          created_by: USER_ALICE,
          recorded_at: T0,
          status: 'RETRACTED',
        },
      ],
    ]),
    facts: new Map([
      [
        'F-1',
        {
          id: 'F-1',
          workstream_id: 'WS-1',
          statement: 'benchmark run #42 completed with 12 ms p95',
          created_by: AGENT_R1,
          created_by_run: 'R-1',
          recorded_at: T0,
          status: 'ACTIVE',
        },
      ],
    ]),
    artifacts: new Map([
      [
        'A-1',
        {
          id: 'A-1',
          workstream_id: 'WS-1',
          type: 'DATASET',
          title: 'raw benchmark traces',
          uri: 'data/traces-42/',
          recorded_at: T0,
          status: 'REGISTERED',
        },
      ],
      [
        'A-2',
        {
          id: 'A-2',
          workstream_id: 'WS-1',
          type: 'FIGURE',
          title: 'p95 chart',
          uri: 'figs/p95.png',
          recorded_at: T0,
          status: 'MISSING',
        },
      ],
    ]),
    relations: new Map([
      [
        'REL-1',
        {
          id: 'REL-1',
          source: { kind: 'CLAIM', id: 'C-1' },
          relation_type: 'SUPPORTED_BY',
          target: { kind: 'FACT', id: 'F-1' },
          created_by: USER_ALICE,
          created_at: T0,
          status: 'ACTIVE',
        },
      ],
      [
        'REL-2',
        {
          id: 'REL-2',
          source: { kind: 'CLAIM', id: 'C-2' },
          relation_type: 'CONTRADICTED_BY',
          target: { kind: 'FACT', id: 'F-1' },
          created_by: USER_ALICE,
          created_at: T0,
          status: 'REMOVED',
          removed_at: T0,
        },
      ],
    ]),
    conflict: new Map(),
  }
}

/* ------------------------------------------------------------------ *
 * Deep freeze (purity pinning)
 * ------------------------------------------------------------------ */

/** Recursively freeze a value (maps, sets, arrays, plain objects). */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  if (value instanceof Map) {
    for (const [k, v] of value) {
      deepFreeze(k)
      deepFreeze(v)
    }
  } else if (value instanceof Set) {
    for (const v of value) deepFreeze(v)
  } else {
    for (const v of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[v])
    }
  }
  return value
}

/** Canonical JSON of a state (Maps in insertion order) — for byte-equality assertions. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v instanceof Map ? [...v.entries()].map(([mk, mv]) => [mk, mv]) : v,
  )
}
