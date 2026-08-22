/**
 * src/host/persistence/meta — public surface (WP-1.6).
 *
 *   - meta-store.ts — the `MetaStore` interface (simple KV + counter face;
 *     `sqlite` backend RESERVED for WP-2.1)
 *   - in-memory.ts  — `InMemoryMetaStore` (the WP-1.6 backend)
 *
 * The sqlite backend (WP-2.1) implements the SAME `MetaStore` surface —
 * including the `IdCounterPort` seam consumed by `src/shared/ids`'
 * `IdAllocator` — against the §15 `meta` table.
 */

import { InMemoryMetaStore } from './in-memory.js'
import type { MetaStore, MetaStoreOptions } from './meta-store.js'

export type { MetaStore, MetaStoreBackend, MetaStoreOptions } from './meta-store.js'
export { InMemoryMetaStore } from './in-memory.js'

/**
 * MetaStore factory (WP-1.6).
 *
 * `sqlite` is the reserved interface for WP-2.1: the factory rejects it
 * (fail-loud) until that WP implements the backend — a silent no-op store
 * would let a future caller persist counters into a store that forgets
 * everything.
 */
export function createMetaStore(options: MetaStoreOptions = { backend: 'memory' }): MetaStore {
  if (options.backend === 'sqlite') {
    throw new Error(
      `createMetaStore: sqlite backend not implemented yet — reserved interface for WP-2.1 ` +
        `(SQLite schema + append, DOMAIN_SCHEMA §15 meta table); requested path=${options.path}`,
    )
  }
  return new InMemoryMetaStore()
}
