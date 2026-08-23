/**
 * WP-0.5 — client slot spike tests (U1 artifact preparation).
 *
 * Scope: the bundle artifact and the plugin shape are verifiable in this
 * repo; the runtime tail (real `dsh web` load, slot visibility, HMR
 * behavior) is owned by WP-0.6.
 *
 * ① the client entry is a FUNCTIONAL client plugin: named `inject`
 *    (slots + remote), an `apply` function, NO default export (a
 *    service-form default export mixed with the function form makes the
 *    Loader discard the function plugin's namespace);
 * ② the spike view renders (renderToString smoke — no DOM needed);
 * ③ the ModuleLoader bundle artifact exists with the head/tail contract
 *    (banner id line, factory signature, `return module.exports; } });`
 *    tail, sourcemap reference) plus the `.map` file;
 * ④ externals: the react family reaches the browser through the module
 *    table's `require` (no React implementation inlined), and zod — the
 *    "everything else inlines" half of the baseline — carries exactly
 *    one version in the bundle.
 *
 * ③/④ read the BUILT `lib/` artifacts: run `pnpm run build` before the
 * test (the WP-0.5 validation chain orders build before test).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as clientEntry from '../src/client/index'
import { ResearchSpikeView } from '../src/client/views/ResearchSpikeView'

const LIB_DIR = fileURLToPath(new URL('../lib/', import.meta.url))
const BUNDLE_PATH = join(LIB_DIR, 'client.js')
const BUNDLE_MAP_PATH = join(LIB_DIR, 'client.js.map')

describe('① client entry export shape (functional client plugin)', () => {
  it('declares inject = slots + remote', () => {
    expect(Array.isArray(clientEntry.inject)).toBe(true)
    expect(clientEntry.inject).toContain('slots')
    expect(clientEntry.inject).toContain('remote')
  })

  it('exports apply as a function (async — the cordis fiber awaits it)', () => {
    expect(typeof clientEntry.apply).toBe('function')
  })

  it('has NO default export (service-form mix-up would drop the plugin)', () => {
    // The module namespace type already proves this at compile time (no
    // `default` member); the runtime assertions lock it for the built face.
    const entryAsRecord = clientEntry as unknown as Record<string, unknown>
    expect(entryAsRecord.default).toBeUndefined()
    expect(Object.hasOwn(clientEntry, 'default')).toBe(false)
  })
})

describe('② spike view render smoke', () => {
  it('renders the title, the spike marker line, and the ping placeholder', () => {
    const html = renderToString(
      ResearchSpikeView({ pingStatus: '占位：未接线（Phase 4 接入 ping）' }),
    )
    expect(html).toContain('研究控制台')
    expect(html).toContain('Research Cockpit spike（U1 验证用）')
    expect(html).toContain('占位：未接线（Phase 4 接入 ping）')
  })
})

describe('③ ModuleLoader bundle artifact contract', () => {
  it('client.js exists with the banner head and module.exports tail', () => {
    expect(existsSync(BUNDLE_PATH)).toBe(true)
    const lines = readFileSync(BUNDLE_PATH, 'utf8').split('\n')
    // rolldown pretty-prints the balanced banner/footer together with the
    // body as one code unit, so the contract is asserted line-structurally:
    // head — banner opens the __ModuleLoader__.load object with the entry id
    // and the factory signature the host module loader invokes;
    expect(lines[0]).toBe('window.__ModuleLoader__.load({')
    expect(lines[1]).toBe('\tid: "dsh-research-control",')
    expect(lines[2]).toBe('\tfactory: (require) => {')
    // tail — footer closes the factory and the load call, then the map ref;
    const nonEmpty = lines.filter(line => line.trim() !== '')
    expect(nonEmpty[nonEmpty.length - 1]).toBe('//# sourceMappingURL=client.js.map')
    expect(nonEmpty[nonEmpty.length - 2].trim()).toBe('});')
    expect(nonEmpty[nonEmpty.length - 3].trim()).toBe('}')
    expect(nonEmpty[nonEmpty.length - 4].trim()).toBe('return module.exports;')
  })

  it('client.js.map exists and is a v3 source map', () => {
    expect(existsSync(BUNDLE_MAP_PATH)).toBe(true)
    const map = JSON.parse(readFileSync(BUNDLE_MAP_PATH, 'utf8'))
    expect(map.version).toBe(3)
    expect(Array.isArray(map.sources)).toBe(true)
    expect(map.sources.length).toBeGreaterThan(0)
  })
})

describe('④ externals: module-table require, nothing inlined from the baseline', () => {
  it('the only require in the bundle is the react-family module-table row', () => {
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    // The automatic JSX runtime is the react-family value import in this
    // spike (the view's own `react` import is type-only and erased); it
    // must arrive through the loader's injected require — never inlined.
    //
    // WP-4.5 update: the inlined graph runtime (@xyflow/react + zustand)
    // adds live `require("react")` / `require("react-dom")` calls. They
    // are react-family module-table rows the host loader answers, so the
    // asserted contract holds: NO require outside the react-family rows —
    // nothing the module table cannot provide is inlined-and-required.
    const requires = bundle.match(/require\("[^"]*"\)/g) ?? []
    const externalRows = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])
    expect(requires.length).toBeGreaterThan(0)
    expect(requires).toContain('require("react/jsx-runtime")')
    for (const r of requires) {
      expect(externalRows.has(r.slice(9, -2)), `non-external require in client bundle: ${r}`).toBe(true)
    }
  })

  it('carries no React implementation code', () => {
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    // React 18 build markers (dev/prod) must be absent:
    expect(bundle).not.toContain('Symbol.for("react.element")')
    expect(bundle).not.toMatch(/react\.(development|production)\.js/)
  })

  it('inlines exactly one zod version (baseline complement: everything else inlines)', () => {
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    // The strict codecs are live zod v4 instances (the `_zod` brand the
    // typert loader duck-checks) — inlined per the baseline contract. A
    // second zod copy would mean a require the module table cannot answer.
    expect(bundle).toContain('_zod')
    const versions = new Set(
      [...bundle.matchAll(/zod@(\d+\.\d+\.\d+)/g)].map(match => match[1]),
    )
    expect(versions.size).toBe(1)
  })
})
