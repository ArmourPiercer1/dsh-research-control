/**
 * V3 PoC 独立 runner（#10 §2.1：与主门禁失败隔离；`pnpm run test:poc`）。
 * 侧车红线在测试内强制执行：源树只读、写入只允许 .poc-data/v3/**、
 * 通道标记混存必须失败。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['experiments/v3-semantic-poc/**/*.test.ts'],
    root: '../../',
  },
})
