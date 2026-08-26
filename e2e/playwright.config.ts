/**
 * WP-0.6 — Playwright smoke config (real-host `dsh web` on the isolated smoke
 * DSH_HOME, port 3199 by default).
 *
 * The config does NOT start or stop the server: the web server lifecycle is
 * owned by `scripts/e2e-run.sh` (start → run → kill → verify port free).
 * Run raw (server already up) via `pnpm run test:e2e:playwright`.
 *
 * T6.2 (V2 full acceptance): the V1-era live set (smoke.* / tc-e2e /
 * tc-dsh-010) has been archived to ./v1-archived/ — nothing under that
 * directory matches this config (testIgnore), and no live V1 specs remain at
 * the e2e root. The current live set runs under acceptance.config.ts.
 */
import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3199'

export default defineConfig({
  testDir: '.',
  // WP-4.6: the smoke specs (WP-0.6/0.7) plus the TC-E2E-001..013 suite.
  // WP-7.4 / G7 S2: plus TC-DSH-010 (investigator read-only, machine half).
  // All archived (see header); the pattern is retained for provenance.
  testMatch: /(?:smoke\..+|tc-e2e\.spec|tc-dsh-010\.spec)\.ts$/,
  // The archive directory is excluded outright so it can never be collected
  // by this config, regardless of testMatch evolution.
  testIgnore: /v1-archived\//,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'off',
  },
})
