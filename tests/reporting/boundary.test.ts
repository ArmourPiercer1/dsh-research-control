/**
 * WP-5.3 — 边界断言: 「不接外部 Calendar」(DOMAIN_SCHEMA §10.3 /
 * 编排计划 Phase 5 边界列 / ARCHITECTURE 边界节): reporting 层
 * (host service + client 切片 + client 视图) **无任何外部 API import**。
 *
 * 断言口径 (白名单, 比黑名单更强):
 *  1. 每个 import/export-from 说明符必须 ∈ { 相对路径, 允许的外部面 };
 *     host service 允许面 = ∅ (纯逻辑 + 注入端口, 零 import);
 *     client 切片/视图允许面 = { 'react' } (渲染原语 — 非 API);
 *  2. 无任何网络/日历载体: 无 http(s) URL 字面量, 无 fetch/XHR/
 *     WebSocket/node:net/node:https/undici 用法 — 日历厂商 (Google
 *     Calendar / Outlook / iCal/ICS 等) 必然经由这些载体, 白名单 (1)
 *     已结构性排除; (2) 是第二道网 (防御字符串级 API 调用);
 *  3. 无任何 DSH 包 import (INV-PERM-5 — reporting 层在豁免目录之外)。
 *
 * 扫描面 = 本 WP 三个产出目录的全部 .ts/.tsx 源文件 (源级 — 注释/
 * 字符串中的 API 名不算 import, 但 (2) 的 URL/调用扫描连字符串也扫,
 * 白名单口径下更严)。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', '..', 'src')

/** Recursively collect every source file under `dir`. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...collectSourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const HOST_REPORTING_FILES = collectSourceFiles(join(SRC, 'host', 'service', 'reporting'))
const CLIENT_REPORTING_FILES = [
  join(SRC, 'client', 'stores', 'reporting-slices.ts'),
  ...collectSourceFiles(join(SRC, 'client', 'views', 'reporting')),
]

/**
 * Extract every module specifier (import/export-from, 动态 import, require).
 * 逐行语句锚定 (防散文误报): 字符串字面量里的「from」(如
 * `'filter.from'`) 不构成语句 — 只认三种行形: ① 行首 import/export
 * 语句且 from 子句同行; ② 行首 import 'x' 副作用导入; ③ 多行 import/
 * export 块的末行 `} from 'x'` (行首 `}` 定界 — 代码/模板串不产生该形)。
 */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const push = (m: RegExpMatchArray | null): void => {
    if (m !== null && m[1] !== undefined) specifiers.push(m[1])
  }
  for (const line of source.split('\n')) {
    // ① 单行 import/export … from '…'
    push(line.match(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/))
    // ② 副作用 import '…'
    push(line.match(/^\s*import\s*['"]([^'"]+)['"]/))
    // ③ 多行块的末行: } from '…'
    push(line.match(/^\s*\}\s*from\s*['"]([^'"]+)['"]/))
    // 动态 import('…') / require('…') (行内, 单引号定界)
    push(line.match(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/))
    push(line.match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/))
  }
  return specifiers
}

const DSH_SHAPE = /(^|\/)@deepseek-ai\//

describe('无外部 Calendar 集成 (白名单 import 面 + 网络/日历载体零面)', () => {
  it('the reporting layer actually has files to scan (非空扫描面)', () => {
    expect(HOST_REPORTING_FILES.length).toBeGreaterThanOrEqual(5)
    expect(CLIENT_REPORTING_FILES.length).toBeGreaterThanOrEqual(8)
    expect(HOST_REPORTING_FILES.some((f) => f.endsWith('service.ts'))).toBe(true)
    expect(CLIENT_REPORTING_FILES.some((f) => f.endsWith('reporting-slices.ts'))).toBe(true)
  })

  it('host reporting service: 相对 import 白名单 (零外部面 — 纯逻辑 + 注入端口)', () => {
    for (const file of HOST_REPORTING_FILES) {
      const specifiers = extractSpecifiers(readFileSync(file, 'utf8'))
      for (const spec of specifiers) {
        expect(
          spec.startsWith('.'),
          `${file}: external module ${JSON.stringify(spec)} is not allowed in the host reporting layer (no DSH, no network, no calendar)`,
        ).toBe(true)
      }
    }
  })

  it('client reporting slices + views: 相对 + react 白名单 (渲染原语 — 非 API)', () => {
    for (const file of CLIENT_REPORTING_FILES) {
      const specifiers = extractSpecifiers(readFileSync(file, 'utf8'))
      for (const spec of specifiers) {
        expect(
          spec.startsWith('.') || spec === 'react',
          `${file}: module ${JSON.stringify(spec)} is outside the reporting client whitelist (relative | 'react')`,
        ).toBe(true)
      }
    }
  })

  it('no DSH package import anywhere in the reporting layer (INV-PERM-5 — 非豁免目录)', () => {
    for (const file of [...HOST_REPORTING_FILES, ...CLIENT_REPORTING_FILES]) {
      const specifiers = extractSpecifiers(readFileSync(file, 'utf8'))
      const dsh = specifiers.filter((s) => DSH_SHAPE.test(s))
      expect(dsh, `${file}: DSH import(s) ${JSON.stringify(dsh)}`).toEqual([])
    }
  })

  it('no network/calendar carriers (URL 字面量 / fetch / XHR / WebSocket / node:net 族)', () => {
    const carriers: readonly RegExp[] = [
      /https?:\/\//, // 任何 URL 字面量 (日历 API 端点 / OData / iCal 服务端)
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /\bWebSocket\b/,
      /from\s+['"]node:(net|https|http|dgram|tls)['"]/,
      /from\s+['"]undici['"]/,
      // 日历厂商面 (防御性 — 白名单已排除, 此处点名留痕):
      /googleapis/i,
      /calendar\.google/i,
      /outlook/i,
      /microsoft\.com/i,
      /\bical\b/i,
      /text\/calendar/i,
    ]
    for (const file of [...HOST_REPORTING_FILES, ...CLIENT_REPORTING_FILES]) {
      const source = readFileSync(file, 'utf8')
      for (const re of carriers) {
        expect(re.test(source), `${file}: network/calendar carrier ${re} present`).toBe(false)
      }
    }
  })
})
