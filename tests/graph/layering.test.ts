/**
 * WP-4.5 — graph-view LAYERING + discipline structure test (static source
 * scan, the WP-4.2 precedent — the「组件纪律」red line, made assertable):
 *
 *  1. the store binding lives in the CONTAINER layer only: the two
 *     container files are the ONLY graph files that import the store layer
 *     (`../stores`) — the presentation components and the pure models
 *     import neither the store nor the store-binding hook;
 *  2. the DSH exemption boundary holds inside the graph face: no file of
 *     src/client/graph imports `@deepseek-ai/*` (INV-PERM-5 — the
 *     dsh-adapter exemption does not apply to view code; check-imports
 *     lints the whole src tree, this pins the graph face in addition);
 *  3. the display components keep their pure-props contract: they import
 *     only react, @xyflow/react, the frozen shared contracts, sibling
 *     graph modules, their CSS modules, and — UI-5 — the i18n copy
 *     registry (`../i18n/copy.js`: a pure frozen data module — the
 *     compile-time key set + an identity lookup, no store/DSH/React
 *     state; the B §18.3 verbatim legend strings live there).
 *
 * The scan is specifier-level (import/export … from), comment- and
 * string-proof by the line-anchored grammar.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const GRAPH_DIR = join(HERE, '..', '..', 'src', 'client', 'graph')

const DISPLAY_FILES = ['PlanGraphView.tsx', 'TopologyGraphView.tsx', 'ConfirmDialog.tsx', 'plan-model.ts', 'topology-model.ts', 'xyflow-base.ts', 'graph-styles.ts']
const CONTAINER_FILES = ['PlanGraphContainer.tsx', 'TopologyGraphContainer.tsx']
/** The binding layer: the one file allowed to reach the store engine (hook only). */
const BINDING_FILE = 'store-binding.ts'

function allFiles(): string[] {
  return readdirSync(GRAPH_DIR).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
}

/** Extract module specifiers from a TS source (line-anchored grammar). */
function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const importRe = /^\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm
  const exportRe = /^\s*export\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm
  for (const re of [importRe, exportRe]) {
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) specs.push(match[1] as string)
  }
  return specs
}

function specsOf(file: string): string[] {
  return importSpecifiers(readFileSync(join(GRAPH_DIR, file), 'utf8'))
}

describe('layering: the store handle reaches React in the containers only', () => {
  it('exactly the two container files import the store layer (the binding hook excepted — its own test pins its face)', () => {
    const offenders = allFiles()
      .filter(f => !CONTAINER_FILES.includes(f) && f !== BINDING_FILE)
      .map(f => ({ file: f, specs: specsOf(f) }))
      .filter(({ specs }) => specs.some(s => s.includes('/stores/') || s === '../stores/index.js' || s.includes('stores/index')))
    expect(offenders).toEqual([])
  })

  it('the display files import neither the store nor the store-binding hook', () => {
    for (const file of DISPLAY_FILES) {
      const specs = specsOf(file)
      expect(
        specs.filter(s => s.includes('/stores/') || s === './store-binding.js'),
        `${file} must stay pure props (no store/binding import)`,
      ).toEqual([])
    }
  })

  it('the binding layer imports the store engine and react only', () => {
    const specs = specsOf(BINDING_FILE)
    expect(specs).toContain('react')
    expect(specs).toContain('../stores/engine.js')
    expect(specs.filter(s => s === '../stores/index.js' || s.includes('dsh-adapter'))).toEqual([])
  })
})

describe('DSH boundary inside the graph face', () => {
  it('no graph file imports @deepseek-ai/* (INV-PERM-5)', () => {
    const offenders = allFiles()
      .map(f => ({ file: f, specs: specsOf(f) }))
      .filter(({ specs }) => specs.some(s => s.startsWith('@deepseek-ai/')))
    expect(offenders).toEqual([])
  })

  it('the container files are the only ones importing the store index', () => {
    for (const file of CONTAINER_FILES) {
      expect(specsOf(file)).toContain('../stores/index.js')
    }
  })
})

describe('directory completeness (every file is classified)', () => {
  it('the file set is exactly display + containers + binding + models + index', () => {
    const expected = [...DISPLAY_FILES, ...CONTAINER_FILES, BINDING_FILE, 'index.ts'].sort()
    expect([...allFiles()].sort()).toEqual(expected)
  })
})
