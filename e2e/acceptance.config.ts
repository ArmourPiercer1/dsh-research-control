/**
 * 验收运行配置 — 复用插件仓 e2e 设施，锚定 3180 测试实例（rc.2 checkout）。
 * 与 playwright.config.ts 同纪律：spec 不起停服务（生命周期由编排持有）。
 * T6.2（V2 全量验收）：V1 时代 spec（probe / smoke.* / tc-e2e / tc-dsh-010）
 * 已归档至 ./v1-archived/，两份配置均不再匹配该目录（testIgnore 显式排除）；
 * 现行验收集 = V2 spec 族（t42 + t51..t54 + t61 + t63 干净 profile 发布探针 +
 * t64 GUI 管理面 setCurrentFocus/getCurrentFocus 裸信封线级验证，UI-0.4 +
 * t65 层级 create 对 createTopic/createWorkstream 裸信封线级验证，UI-2A +
 * t66 真实客户端 store（createResearchStore）经 Proxy facade 驱动
 * setCurrentFocus/getCurrentFocus 走 3180 活线，UI-1 +
 * t67 六个剩余 GUI 管理面（updateProjectMetadata/updateTopic/
 * updateWorkstream/dropWorkstream + inspectProjectDirectory/
 * createLocalResearchProject）裸信封线级验证，UI-2 +
 * t68 Create/Bind 旅程浏览器端真实用户路径（5 步 Create 向导 + 4 态
 * Bind 流 + reload 持久化），UI-2 +
  * t69 §10.8 Gate 四流浏览器端真实用户路径（CF 四流 NO-REFRESH + derived
  * 机械用例 + reload 无漂移 + 五跳导航首落 WS 页），UI-4 +
  * t70 D §11.9 UI-5 Gate 十项动作面浏览器端真实用户路径（strip/graph
  * 全 UI 动作 NO-REFRESH + reorder≠dependency 不变式 + 无 plan create
  * 分支 ADJ-3 + Remove 清 CF currentFocusCleared + reload 无漂移），UI-5 +
  * t71 D §12.6 UI-6 拓扑突变面浏览器端真实用户路径（fork/planned
  * merge/drop + merge contract editor 全 GUI 路径 NO-REFRESH + 双
  * 负向载体 + reload 无漂移，RECON §9.3 全序列），UI-6 +
   * t72 D §13 Records 七写 + queryRecords 浏览器端真实用户路径（seeded
   * 基线 + Add Fact/Claim/Artifact + Add relation + Retract claim +
   * Mark artifact missing 全 GUI NO-REFRESH + 双负向 wire 载体 +
   * 过滤维度 + B §26 时间线 Related 入口 + 两阶段 restart/stopped
   * gate，DB-seeded 窗口，UI-7）。
 */
import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

export default defineConfig({
  testDir: '.',
  testMatch: /(?:t42-onboarding-hub\.spec|t51-overview-drill\.spec|t52-attention-migration\.spec|t53-investigator\.spec|t54-settings-unbind\.spec|t61-settings-card\.spec|t63-clean-probe\.spec|t64-current-focus-rpc\.spec|t65-hierarchy-create\.spec|t66-current-focus-store\.spec|t67-local-project-rpc\.spec|t68-create-bind-ui\.spec|t69-gate-four-flows\.spec|t70-plan-editor-gates\.spec|t71-topology-fork-merge\.spec|t72-research-records\.spec)\.ts$/,
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
