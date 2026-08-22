/**
 * MetaStore — the persistence face for the operational `meta` table
 * (DOMAIN_SCHEMA.md §15, L628: 「`meta` | `key` | ID 计数器、DB schema 版本等」).
 *
 * WP-1.6 boundary: the storage backend is an INJECTABLE interface.
 *   - `memory` — `InMemoryMetaStore` (this WP): pre-persistence bootstrap and
 *     the test/allocator path;
 *   - `sqlite` — RESERVED for WP-2.1 (SQLite schema + append; the `meta`
 *     table lives in `$DSH_HOME/research-control/<project-id>/research.sqlite`
 *     per §15 L610). `SqliteMetaStoreOptions` below is the reserved
 *     interface: `createMetaStore` rejects it (fail-loud) until WP-2.1
 *     implements the backend with this exact surface.
 *
 * Synchronous by design: the planned WP-2.1 backend (node:sqlite
 * `DatabaseSync`) is synchronous, and the WP-1.6 `IdAllocator`
 * (src/shared/ids) is pure synchronous logic — an async store would force
 * the whole allocation path to be async without any frozen-contract benefit.
 *
 * Structural seam: `MetaStore` satisfies the shared `IdCounterPort`
 * (src/shared/ids/allocator.ts) — `getCounter` + `bumpCounter` are exactly
 * the counter surface the allocator consumes. The WP-2.1 sqlite backend must
 * provide the same two methods against the same key namespace, with
 * `bumpCounter` as a single atomic SQL statement.
 */

/** Backends the `MetaStore` interface admits. */
export type MetaStoreBackend = 'memory' | 'sqlite'

/**
 * The meta table as an injectable store: simple string KV plus the integer
 * counter face. All values are strings (SQLite `meta.value` is TEXT);
 * counter values are canonical decimal integers.
 */
export interface MetaStore {
  /** Which backend serves this store (discriminator + diagnostics). */
  readonly backend: MetaStoreBackend

  // --- simple KV (L628: DB schema 版本等) ---

  /** Read a value; `null` when the key is absent. */
  get(key: string): string | null
  /** Insert or overwrite a value. */
  set(key: string, value: string): void
  /** Delete a key (no-op when absent). Meta rows are bookkeeping, not first-
   *  class identity rows, so deletion is allowed here (unlike operational
   *  object tables, §15 通则). */
  delete(key: string): void
  /** All stored keys, sorted (deterministic for diagnostics/tests). */
  keys(): string[]

  // --- counter face (satisfies shared IdCounterPort) ---

  /**
   * Read the integer counter at `key`; 0 when unset or never bumped.
   * @throws when the stored value is not a non-negative safe integer
   *   (corruption guard — fail loud rather than mis-allocate).
   */
  getCounter(key: string): number
  /**
   * Atomically bump the integer counter at `key` by `delta` (default 1) and
   * return the NEW value; an unset counter starts at 0.
   *
   * The in-memory backend implements this as a synchronous read-modify-write
   * (atomic within a single process); the WP-2.1 sqlite backend maps it to a
   * single statement (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) so the
   * guarantee holds across connections too.
   * @throws when `delta` is not a positive safe integer, or on counter
   *   corruption (see `getCounter`).
   */
  bumpCounter(key: string, delta?: number): number
}

/**
 * Factory options. The `sqlite` variant is the RESERVED interface for
 * WP-2.1 — declaring it now fixes the seam (options shape included) so
 * WP-2.1 can implement `createMetaStore({ backend: 'sqlite', path })`
 * without touching this WP's surface.
 */
export type MetaStoreOptions =
  | { readonly backend: 'memory' }
  | { readonly backend: 'sqlite'; readonly path: string }
