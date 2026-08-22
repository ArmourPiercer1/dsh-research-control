/**
 * WP-3.4 TEMPORARY full-suite vitest config (unblocking aid — see
 * `vitest.wp34.config.ts` and `wp34-guard-stub.ts` for the rationale).
 *
 * Same as the root config + the same one-file alias, but with the DEFAULT
 * test include (the whole suite) so the 四件套 vitest leg can be verified
 * while the parallel WP-3.6 file is broken in the shared tree.
 *
 * Run from the plugin repo root:
 *   npx vitest run -c tests/select/vitest.wp34-full.config.ts
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
        find: './connection-guard.js',
        replacement: fileURLToPath(new URL('./wp34-guard-stub.ts', import.meta.url)),
      },
    ],
  },
  test: {
    ...rootConfig.test,
    exclude: [...defaultExclude, 'e2e/**'],
  },
})
