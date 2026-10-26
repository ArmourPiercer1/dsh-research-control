/**
 * V3 PoC 独立 runner（#10 §2.1：与主门禁失败隔离；`pnpm run test:poc`）。
 * 侧车红线在测试内强制执行：源树只读、写入只允许 .poc-data/v3/**、
 * 通道标记混存必须失败。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['experiments/v3-semantic-poc/**/*.test.ts'],
    // vitest 的相对 root 按进程 cwd 解析（骨架里 '../../' 在仓根运行会错到
    // /home/user）；改为以本配置文件锚定仓根绝对路径，与 cwd 无关。
    root: fileURLToPath(new URL('../../', import.meta.url)),
  },
})
