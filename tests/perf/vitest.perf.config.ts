/**
 * WP-2.8 / WP-8.2 — dedicated runner for the TC-PERF-001..006 perf suite
 * (`pnpm test:perf` / `npm run test:perf` — the WP-8.2 性能回归钩子; the
 * script is package.json `test:perf` = `vitest run --config
 * tests/perf/vitest.perf.config.ts`).
 *
 * Lives under tests/ (the perf WP write surface) so the root
 * vitest.config.ts stays untouched. It isolates the perf suite from the
 * regular suite run:
 *   - `include` matches ONLY tests/perf/** (the regular suite never loads
 *     the 10k dataset — perf files self-skip via `describe.runIf(PERF_ENABLED)`);
 *   - `env.DSH_RUN_PERF=1` flips the gate in every perf test file (the same
 *     flag also works ad-hoc: `DSH_RUN_PERF=1 npx vitest run tests/perf`);
 *   - generous test/hook timeouts: setup generates + validates 10k full-
 *     spectrum events (all 20 catalog types, 8 workstreams) against the
 *     real frozen registry and appends them to a real SQLite (seconds, not
 *     milliseconds).
 *
 * Run (from the plugin repo root):
 *   npm run test:perf
 *   # = npx vitest run --config tests/perf/vitest.perf.config.ts
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
