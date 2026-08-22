/**
 * InMemoryMetaStore — the WP-1.6 `MetaStore` implementation (backend
 * `memory`).
 *
 * A `Map<string, string>` with the counter face on top:
 *   - `getCounter` / `bumpCounter` store counters as canonical decimal
 *     strings under their key (the same encoding the WP-2.1 sqlite backend
 *     uses for `meta.value`, so values port 1:1);
 *   - `bumpCounter` is a synchronous read-modify-write: atomic within a
 *     single process (the WP-1.6 operating context; the WP-2.1 sqlite
 *     backend upgrades the guarantee to cross-connection via one SQL
 *     statement).
 *
 * Corruption guard: a counter key whose value is not a non-negative safe
 * integer throws on read/bump — fail loud, never mis-allocate.
 */

import type { MetaStore } from './meta-store.js'

function validateDelta(delta: number): void {
  if (!Number.isSafeInteger(delta) || delta < 1) {
    throw new RangeError(`invalid counter delta ${String(delta)} — must be a positive safe integer`)
  }
}

/** Read + sanity-check a stored counter value (`undefined` → 0). */
function readCounter(values: ReadonlyMap<string, string>, key: string): number {
  const raw = values.get(key)
  if (raw === undefined) return 0
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`meta corruption: counter "${key}" holds ${JSON.stringify(raw)}, expected a non-negative integer`)
  }
  return value
}

export class InMemoryMetaStore implements MetaStore {
  readonly backend = 'memory' as const

  private readonly values = new Map<string, string>()

  get(key: string): string | null {
    const value = this.values.get(key)
    return value === undefined ? null : value
  }

  set(key: string, value: string): void {
    this.values.set(key, value)
  }

  delete(key: string): void {
    this.values.delete(key)
  }

  keys(): string[] {
    return [...this.values.keys()].sort()
  }

  getCounter(key: string): number {
    return readCounter(this.values, key)
  }

  bumpCounter(key: string, delta = 1): number {
    validateDelta(delta)
    const next = readCounter(this.values, key) + delta
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`counter "${key}" overflowed Number.MAX_SAFE_INTEGER at ${String(next)}`)
    }
    this.values.set(key, String(next))
    return next
  }
}
