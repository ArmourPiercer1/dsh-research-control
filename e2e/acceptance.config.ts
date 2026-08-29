/**
 * 验收运行配置 — 复用插件仓 e2e 设施，锚定 3180 测试实例（rc.2 checkout）。
 * 与 playwright.config.ts 同纪律：spec 不起停服务（生命周期由编排持有）。
 * T6.2（V2 全量验收）：V1 时代 spec（probe / smoke.* / tc-e2e / tc-dsh-010）
 * 已归档至 ./v1-archived/，两份配置均不再匹配该目录（testIgnore 显式排除）；
 * 现行验收集 = V2 spec 族（t42 + t51..t54 + t61 + t63 干净 profile 发布探针 +
 * t64 GUI 管理面 setCurrentFocus/getCurrentFocus 裸信封线级验证，UI-0.4 +
 * t65 层级 create 对 createTopic/createWorkstream 裸信封线级验证，UI-2A +
 * t66 真实客户端 store（createResearchStore）经 Proxy facade 驱动
 * setCurrentFocus/getCurrentFocus 走 3180 活线，UI-1）。
 */
import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

export default defineConfig({
  testDir: '.',
  testMatch: /(?:t42-onboarding-hub\.spec|t51-overview-drill\.spec|t52-attention-migration\.spec|t53-investigator\.spec|t54-settings-unbind\.spec|t61-settings-card\.spec|t63-clean-probe\.spec|t64-current-focus-rpc\.spec|t65-hierarchy-create\.spec|t66-current-focus-store\.spec)\.ts$/,
  // Archived V1 specs never run from either config, no matter how testMatch
  // evolves: the archive directory is excluded outright.
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
