/**
 * 验收运行配置 — 复用插件仓 e2e 设施，锚定 3180 测试实例（rc.2 checkout）。
 * 与 playwright.config.ts 同纪律：spec 不起停服务（生命周期由编排持有），
 * 区别仅在 baseURL 默认值与 testMatch 多含 probe.spec.ts（兼容性读数）。
 */
import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

export default defineConfig({
  testDir: '.',
  testMatch: /(?:smoke\..+|tc-e2e\.spec|tc-dsh-010\.spec|t42-onboarding-hub\.spec|t51-overview-drill\.spec|t52-attention-migration\.spec|t53-investigator\.spec|t54-settings-unbind\.spec|t61-settings-card\.spec|probe\.spec)\.ts$/,
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
