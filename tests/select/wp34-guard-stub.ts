/**
 * WP-3.4 TEMPORARY test seam (unblocking aid — see 报告「偏离与豁免」1).
 *
 * The parallel WP-3.6 worktree file `src/host/persistence/store/
 * connection-guard.ts` is syntactically incomplete in the shared tree
 * (its own doc comment contains a block-comment terminator sequence —
 * same bug class the WP-3.2 report documented), which breaks the vite
 * transform of EVERY module that imports `persistence/store/index.js`
 * (transitively: runbinding, tools, and therefore this WP's DB-backed
 * tests). This stub is aliased over that ONE file for the WP-3.4 test
 * runs only.
 *
 * Fidelity: the real guard is installed on `openDatabase`'s canonical
 * connection. WP-3.4's harness (like WP-3.1/3.2) does all real work over
 * its OWN raw `DatabaseSync` connections (双连接模式) and uses
 * `openDatabase` only to initialize/verify the schema file, then closes
 * that connection. The guard therefore has zero semantic role in this
 * WP's tests — the no-op preserves the schema-init path verbatim.
 *
 * Final verification runs the DEFAULT vitest config (real guard in place,
 * once WP-3.6's file is complete).
 */

export function installStoreConnectionGuard(_db: unknown): void {
  /* no-op test seam — see module doc */
}
