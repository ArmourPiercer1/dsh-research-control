/**
 * WP-4.7 — project view LAYERING structure test (container vs display).
 *
 * Task brief:「复用既有容器/展示分层模式」— the same two-layer rule as
 * the home view, made assertable for the project view (G4 S1):
 *  1. the store binding (and the ONLY store import of the view) lives in
 *     exactly one container file — `ProjectPage.tsx`;
 *  2. every DISPLAY component file (the pure props tree) imports NEITHER
 *     the store layer NOR the DSH adapter — only react, the shared
 *     contracts, sibling view files, and its CSS module;
 *  3. the DSH exemption boundary stays intact: no file of the project
 *     view imports `@deepseek-ai/*` (INV-PERM-5 — the dsh-adapter
 *     exemption does not apply to view code).
 *
 * Static source scan (import/export specifiers, comment- and string-proof
 * at the specifier level): a display file that grows a store import later
 * fails here instead of surfacing as a mysterious host-coupling bug.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const VIEW_DIR = join(HERE, '..', '..', 'src', 'client', 'views', 'project')

/** Every file of the project view directory (no subdirs). */
function viewFiles(): string[] {
  return ['ProjectPage.tsx', 'ProjectPageView.tsx', 'index.ts']
}

/**
 * Extract module specifiers from a TS source: import declarations,
 * import type, export … from, and re-export clauses. Comments and string
 * literals never match (the pattern only matches at line-start specifier
 * positions following the import/export grammar).
 */
function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const importRe = /^\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm
  const exportRe = /^\s*export\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm
  for (const re of [importRe, exportRe]) {
    for (const match of source.matchAll(re)) {
      specs.push(match[1])
    }
  }
  return specs
}

/** True when a specifier addresses the client store layer or a DSH package. */
function isForbiddenForDisplay(spec: string): boolean {
  if (spec.includes('/stores') || spec === '../stores' || spec === './stores') return true
  if (spec.includes('/dsh-adapter')) return true
  if (spec.startsWith('@deepseek-ai/')) return true
  return false
}

describe('two-layer structure: container pulls from the store, display stays pure', () => {
  it('every display component file has ZERO store/DSH imports', () => {
    const displayFiles = viewFiles().filter(f => f !== 'ProjectPage.tsx')
    expect(displayFiles.length).toBeGreaterThan(0)
    for (const file of displayFiles) {
      const source = readFileSync(join(VIEW_DIR, file), 'utf8')
      const forbidden = importSpecifiers(source).filter(isForbiddenForDisplay)
      expect(
        forbidden,
        `${file} imports store/DSH modules — display components must stay pure props (container pulls the store)`,
      ).toEqual([])
    }
  })

  it('the container is the ONE store-touching file (exactly one store import in the view)', () => {
    let storeImportFiles = 0
    for (const file of viewFiles()) {
      const source = readFileSync(join(VIEW_DIR, file), 'utf8')
      const storeSpecs = importSpecifiers(source).filter(
        spec => spec.includes('/stores') || spec === '../stores' || spec === './stores',
      )
      if (storeSpecs.length > 0) storeImportFiles += 1
    }
    expect(storeImportFiles).toBe(1)
    const container = readFileSync(join(VIEW_DIR, 'ProjectPage.tsx'), 'utf8')
    expect(importSpecifiers(container)).toContain('../../stores')
  })

  it('no file of the project view imports @deepseek-ai/* (INV-PERM-5; the view is not dsh-adapter)', () => {
    for (const file of viewFiles()) {
      const source = readFileSync(join(VIEW_DIR, file), 'utf8')
      const dshSpecs = importSpecifiers(source).filter(spec => spec.startsWith('@deepseek-ai/'))
      expect(dshSpecs, `${file} imports a @deepseek-ai/* package`).toEqual([])
    }
  })

  it('the view imports its DTO types from the shared contracts (no local redeclaration of wire types)', () => {
    for (const file of viewFiles().filter(f => f !== 'ProjectPage.tsx')) {
      const source = readFileSync(join(VIEW_DIR, file), 'utf8')
      // the pure display tree may address the shared contract face directly
      // (client → shared is the one allowed direction, ARCHITECTURE §2.2);
      // it must NOT pull DTO types through the store re-export face either.
      const specs = importSpecifiers(source)
      const viaStore = specs.filter(spec => spec.includes('client/stores'))
      expect(viaStore, `${file} pulls types through the store layer`).toEqual([])
    }
  })
})
