/**
 * WP-1.6 — boundary guard: src/shared/ids/** stays pure.
 *
 * Task boundary: 「shared 面不得 import 任何 I/O 与 DSH 包」and 「shared/ids
 * 全部纯类型+纯函数」. This test walks every source file in the tree and
 * asserts that every module specifier it uses is RELATIVE to the tree —
 * i.e. no node: builtins (fs/path/os/… no I/O), no @deepseek-ai/* (DSH
 * packages), no npm packages of any kind, no deepseek-harness path escape.
 * The WP-0.7 parser-level lint (INV-PERM-5) catches the DSH half on every
 * run; this test additionally pins the I/O-free + zero-npm half of the
 * shared/ids contract.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const IDS_DIR = join(fileURLToPath(new URL('../../src/shared/ids', import.meta.url)))

/** Collect every module specifier in a TS source (static imports, export-from, side-effect imports, dynamic import of literals). */
function collectSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bexport\s+['"]([^'"]+)['"]/g,
  ]
  for (const re of patterns) {
    for (const match of source.matchAll(re)) {
      specifiers.push(match[1]!)
    }
  }
  return specifiers
}

describe('shared/ids purity (boundary: zero I/O, zero DSH, zero npm)', () => {
  const files = readdirSync(IDS_DIR).filter(name => name.endsWith('.ts'))

  it('has source files to guard', () => {
    expect(files.length).toBeGreaterThanOrEqual(6)
  })

  it.each(files)('%s: every module specifier is relative to the tree', file => {
    const source = readFileSync(join(IDS_DIR, file), 'utf8')
    const specifiers = collectSpecifiers(source)
    for (const specifier of specifiers) {
      expect(
        specifier.startsWith('./'),
        `${file} imports non-relative module ${JSON.stringify(specifier)} — shared/ids must be I/O- and DSH-free (WP-1.6 boundary)`,
      ).toBe(true)
    }
    // no CJS escape hatch in the shared surface
    expect(source, `${file} contains require(…)`).not.toMatch(/[^.\w]require\s*\(/)
  })
})
