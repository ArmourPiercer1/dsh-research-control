import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 中心装配模块的适应性棘轮（审查意见 P1#5，2026-10-27）。
 *
 * 判断前提（审查原文）：Host/RPC/Wiring 是集中点但**未失控**，不以"文件大"
 * 开全面重构。本测试不评价设计，只把「继续膨胀必须显式过审」机械化：
 * 每个中心文件的规模上限 = 登记值，**只降不升**（ratchet）；V3 接线若确实
 * 需要抬高上限，PR 里点名说明新增了什么域规则、为什么不能落在领域模块，
 * 由用户批准后才许改登记值。新增业务逻辑的正确落点是领域/服务模块，
 * 中心文件只做装配与接线——抬高棘轮即该原则被侵蚀的信号。
 */
const REPO = resolve(dirname(dirname(__dirname)))

interface Ratchet {
  file: string
  why: string
  lines?: number
  bytes?: number
}

const RATCHETS: Ratchet[] = [
  { file: 'src/host/dsh-adapter/host/index.ts', lines: 2221, why: '宿主装配集中点' },
  { file: 'src/host/dsh-adapter/host/rpc-services.ts', lines: 2595, why: 'RPC 业务接线集中点' },
  { file: 'src/host/service/wiring/create.ts', bytes: 64459, why: '服务构建与资源生命周期集中点' },
]

describe('hub ratchet — 装配中心不随新功能无声膨胀', () => {
  for (const r of RATCHETS) {
    it(`${r.file} 不超过登记上限（${r.lines ? `${r.lines} 行` : `${r.bytes} 字节`}，只降不升）`, () => {
      const buf = readFileSync(join(REPO, r.file))
      if (r.bytes !== undefined) {
        expect(buf.length, `${r.why}：字节数超棘轮 = 新增逻辑未经适应性评审落进装配中心`).toBeLessThanOrEqual(r.bytes)
      } else {
        const n = buf.toString('utf8').split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length // 与 wc -l 同口径（行数=换行内容行）
        expect(n, `${r.why}：行数超棘轮 = 新增逻辑未经适应性评审落进装配中心`).toBeLessThanOrEqual(r.lines ?? Number.MAX_SAFE_INTEGER)
      }
    })
  }
})
