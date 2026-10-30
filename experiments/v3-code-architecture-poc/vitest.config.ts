/**
 * V3 代码架构 PoC 独立 runner（与主门禁失败隔离；`pnpm run test:poc:arch`）。
 * 根 `pnpm test` 不收集本目录（根 vitest.config.ts 的 include 只覆盖 tests/**）。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['experiments/v3-code-architecture-poc/**/*.test.ts'],
    // vitest 的相对 root 按 cwd 解析；以本配置文件锚定仓根，与 cwd 无关。
    root: fileURLToPath(new URL('../../', import.meta.url)),
  },
})
