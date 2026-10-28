/**
 * V3 PoC · P0 —— 写入边界守卫（SPEC.md「写入边界」；#10 §2.1 范围隔离）。
 *
 * 只允许写 `experiments/v3-semantic-poc/.poc-data/v3/**`；其余一切路径
 * （src/**、schema/**、.research/**、生产 DB、仓根 lib/** 等）FATAL 抛出——
 * 不是静默跳过。任何写入方（poc-run --export、未来 P1 投影落盘）必须先过
 * assertWritable 再触文件系统。
 *
 * 纯 node 内置模块；相对路径按进程 cwd 规范化，`..` 逃逸在 resolve 后仍被
 * 边界比较捕获。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

/** 本 PoC 根目录（src/ 的上一级 = experiments/v3-semantic-poc/）。 */
export const POC_ROOT = path.resolve(MODULE_DIR, '..')

/** 唯一允许的写入区：<poc>/experiments/v3-semantic-poc/.poc-data/v3。 */
export const ALLOWED_WRITE_ROOT = path.join(POC_ROOT, '.poc-data', 'v3')

/** realpath of the deepest EXISTING ancestor (target may not exist yet). */
function canonicalExisting(abs: string): string {
  let cur = abs
  const tail: string[] = []
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail)
    } catch {
      tail.unshift(path.basename(cur))
      const parent = path.dirname(cur)
      if (parent === cur) return abs // filesystem root — nothing exists; keep lexical
      cur = parent
    }
  }
}

/**
 * 校验 target 是否落在允许写入区内；返回规范化后的绝对路径。
 * 越界（含经 `..` 归一化后越界、指向允许区父目录、跨盘/相对漂移）一律抛
 * FATAL——调用方不得捕获后继续写。
 *
 * 符号链接语义（审查意见 P0#2，2026-10-27）：前缀比较前先做**真实路径**
 * 比较——允许区内任何已存在的符号链接分量若把解析引到区外，拒绝；写入区
 * 自身经符号链接搬家同样拒绝（真实落点必须真在允许区内）。
 */
export function assertWritable(target: string): string {
  if (typeof target !== 'string' || target.length === 0 || target.includes('\0')) {
    throw new Error(`FATAL: PoC writeguard 拒绝了无效路径 ${JSON.stringify(target)}；只允许写 ${ALLOWED_WRITE_ROOT} 之下`)
  }
  const abs = path.resolve(process.cwd(), target)
  if (abs !== ALLOWED_WRITE_ROOT && !abs.startsWith(ALLOWED_WRITE_ROOT + path.sep)) {
    throw new Error(
      `FATAL: PoC writeguard 拒绝了越界写入 "${target}"（规范化为 ${abs}）；只允许写 ${ALLOWED_WRITE_ROOT} 之下（src/、schema/、.research/、仓根 lib/ 与生产 DB 一律拒绝）`,
    )
  }
  const real = canonicalExisting(abs)
  const realRoot = fs.existsSync(ALLOWED_WRITE_ROOT) ? fs.realpathSync(ALLOWED_WRITE_ROOT) : canonicalExisting(ALLOWED_WRITE_ROOT)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error(
      `FATAL: PoC writeguard 拒绝了经符号链接逃逸的写入 "${target}"（词法在允许区内，真实解析为 ${real}，允许区真实为 ${realRoot}）`,
    )
  }
  return abs
}
