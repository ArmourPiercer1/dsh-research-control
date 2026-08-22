/**
 * WP-0.6 — Playwright smoke config (real-host `dsh web` on the isolated smoke
 * DSH_HOME, port 3199 by default).
 *
 * The config does NOT start or stop the server: the web server lifecycle is
 * owned by `scripts/e2e-run.sh` (start → run → kill → verify port free).
 * Run raw (server already up) via `pnpm run test:e2e:playwright`.
 */
import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3199'

export default defineConfig({
  testDir: '.',
  testMatch: /smoke\..+\.spec\.ts$/,
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
