/**
 * WP-2.8 — dedicated runner for the TC-PERF-001..005 perf suite.
 *
 * Lives under tests/ (the WP-2.8 write surface) so the root
 * vitest.config.ts stays untouched. It isolates the perf suite from the
 * regular 1114-case run:
 *   - `include` matches ONLY tests/perf/** (the regular suite never loads
 *     the 10k dataset);
 *   - `env.DSH_RUN_PERF=1` flips the `describe.runIf(PERF_ENABLED)` gate in
 *     every perf test file (the same flag also works ad-hoc:
 *     `DSH_RUN_PERF=1 npx vitest run tests/perf`);
 *   - generous test/hook timeouts: setup generates + validates 10k events
 *     against the real frozen registry and appends them to a real SQLite
 *     (seconds, not milliseconds).
 *
 * Run (from the plugin repo root):
 *   npx vitest run --config tests/perf/vitest.perf.config.ts
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Plugin repo root (this file is tests/perf/). */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export default defineConfig({
  root,
  test: {
    include: ['tests/perf/**/*.test.ts'],
    env: { DSH_RUN_PERF: '1' },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
