/**
 * WP-3.4 TEMPORARY vitest config (unblocking aid — see 报告「偏离与豁免」1
 * and `wp34-guard-stub.ts`).
 *
 * Extends the root vitest config verbatim and aliases the parallel WP-3.6
 * in-progress file `src/host/persistence/store/connection-guard.ts` (broken
 * in the shared worktree — its own doc comment contains a block-comment
 * terminator sequence) to a no-op stub, so this WP's DB-backed tests can
 * run against the REAL store schema-init path + REAL raw `DatabaseSync`
 * connections.
 *
 * Run from the plugin repo root:
 *   npx vitest run -c tests/select/vitest.wp34.config.ts
 *
 * The FINAL 四件套 verification uses the default config (no alias) with
 * WP-3.6's file complete.
 */

import { fileURLToPath } from 'node:url'
import { defaultExclude, defineConfig } from 'vitest/config'

import rootConfig from '../../vitest.config.js'

export default defineConfig({
  ...rootConfig,
  resolve: {
    ...rootConfig.resolve,
    alias: [
      ...(Array.isArray(rootConfig.resolve?.alias)
        ? rootConfig.resolve.alias
        : rootConfig.resolve?.alias !== undefined
          ? [rootConfig.resolve.alias]
          : []),
      {
        // Exact specifier (store.ts / index.ts both import './connection-guard.js').
        find: './connection-guard.js',
        replacement: fileURLToPath(new URL('./wp34-guard-stub.ts', import.meta.url)),
      },
    ],
  },
  test: {
    ...rootConfig.test,
    // Only this WP's tests (the rest of the suite runs via the default
    // config; this config exists solely to survive the parallel worktree).
    include: ['tests/select/**/*.test.ts'],
    exclude: [...defaultExclude, 'e2e/**'],
  },
})
