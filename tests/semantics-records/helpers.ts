/**
 * V2-UI-0.4 UI-7 — shared assertions for the semantics-records suite.
 */

import { DatabaseSync } from 'node:sqlite'
import type { ResearchStore } from '../../src/host/persistence/store/types.js'

/** The service carrier format (errors.ts): `[research-control] <CODE>: <message>`. */
export function carrierCode(e: unknown): string {
  const m = /^\[research-control\] ([A-Z_]+):/.exec(e instanceof Error ? e.message : String(e))
  return m !== null ? m[1]! : `(not a carrier: ${String(e)})`
}

/** Assert the thrown value is the service carrier with the given domain code. */
export function expectCarrier(e: unknown, code: string): void {
  if (!(e instanceof Error)) throw new Error(`expected a thrown Error, got ${String(e)}`)
  const actual = carrierCode(e)
  if (actual !== code) throw new Error(`expected carrier code ${code}, got ${actual} (message: ${e.message})`)
}

/** Assert a call throws the service carrier with the given domain code. */
export function expectCarrierCode(fn: () => unknown, code: string): Error {
  try {
    fn()
  } catch (e) {
    expectCarrier(e, code)
    return e as Error
  }
  throw new Error(`expected a throw with carrier code ${code}, but the call succeeded`)
}

/** Count of `derived_state` rows of one object kind (ADJ-1: management_action must stay 0). */
export function countDerivedKind(store: ResearchStore, objectKind: string): number {
  const raw = new DatabaseSync(store.path)
  try {
    const row = raw
      .prepare('SELECT COUNT(*) AS n FROM derived_state WHERE object_kind = ?')
      .get(objectKind) as { n: number }
    return row.n
  } finally {
    raw.close()
  }
}
