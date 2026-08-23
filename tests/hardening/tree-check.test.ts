/**
 * WP-8.1 — check 2: the `.research/` loader error-aggregation
 * classification (ARCHITECTURE §10 row「`.research/` 文件非法 → 拒绝加载
 * 该文件并报错定位（文件+字段），不猜测修复；其余文件正常加载」→ 降级
 * 只读可用面 + loud 告警；root/contract 级损坏 → 启动拒绝).
 *
 * Every broken form is injected against a REAL temp `.research/` tree
 * (the loader fixtures' base tree, patched per test) loaded with the REAL
 * frozen declarative schemas (WR `schema/declarative`) — the same loader
 * the production wiring runs.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadResearchTree } from '../../src/host/domain/loader/index.js'
import { classifyTreeLoad } from '../../src/host/persistence/hardening/index.js'
import { DECLARATIVE_SCHEMA_DIR, FsReader, makeWorkspace } from './helpers.js'

function loadAt(researchRoot: string, schemaDir = DECLARATIVE_SCHEMA_DIR, reader?: FsReader) {
  return loadResearchTree(reader ?? new FsReader(), researchRoot, schemaDir)
}

describe('classifyTreeLoad — pass', () => {
  it('a clean tree passes with zero errors and full guidance silence', () => {
    const ws = makeWorkspace()
    const r = classifyTreeLoad(loadAt(ws.researchRoot))
    expect(r.status).toBe('pass')
    expect(r.usable).toBe(true)
    expect(r.fatalErrors).toEqual([])
    expect(r.degradedErrors).toEqual([])
    expect(r.guidance).toEqual([])
  })
})

describe('classifyTreeLoad — degraded (the §10 row: file rejected, the rest load)', () => {
  it('a schema-violating optional task: precisely located error, T-2 still loads', () => {
    // id 与文件名不一致 → PATH_ID_MISMATCH（精确到文件）; plan 随之 DANGLING_REF
    const ws = makeWorkspace({
      treePatch: {
        'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml': 'id: T-99\nworkstream_id: WS-1\ntitle: x\ngoal: y\ncreated_by: { kind: USER, label: t }\ncreated_at: 2026-08-21T09:30:00Z\n',
      },
    })
    const load = loadAt(ws.researchRoot)
    const r = classifyTreeLoad(load)
    expect(r.status).toBe('recoverable')
    expect(r.usable).toBe(true)
    expect(r.fatalErrors).toEqual([])
    expect(r.degradedErrors.length).toBeGreaterThanOrEqual(1)
    const t1 = r.degradedErrors.find((e) => e.file === 'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml')
    expect(t1).toBeDefined()
    expect(t1!.code).toBe('PATH_ID_MISMATCH')
    // 报错定位: file + field (the error carries the location)
    expect(t1!.message).toContain('T-99')
    // 其余文件正常加载: T-2 is untouched
    const ws1 = load.tree.topics[0]!.workstreams[0]!
    expect(ws1.tasks.find((t) => t.id === 'T-1')!.doc).toBeNull()
    expect(ws1.tasks.find((t) => t.id === 'T-2')!.doc).not.toBeNull()
    // loud + readonly: the guidance names the file and the narrowed surface
    const all = r.guidance.join('\n')
    expect(all).toContain('T-1.yaml')
    expect(all).toContain('READONLY')
    expect(all).toContain('no guess-repair')
  })

  it('a broken required topic.yaml degrades (topic null, its workstreams still load)', () => {
    const ws = makeWorkspace({
      treePatch: {
        'topics/TPC-1/topic.yaml': 'id: TPC-9\ntitle: mismatched\nproject_id: PRJ-1\ncreated_at: 2026-08-21T09:00:00Z\n',
      },
    })
    const load = loadAt(ws.researchRoot)
    const r = classifyTreeLoad(load)
    expect(r.status).toBe('recoverable')
    const topic = load.tree.topics[0]!
    expect(topic.doc).toBeNull()
    // the workstreams under it still load normally (the §10 row)
    expect(topic.workstreams[0]!.doc).not.toBeNull()
    expect(r.degradedErrors.some((e) => e.file === 'topics/TPC-1/topic.yaml' && e.code === 'PATH_ID_MISMATCH')).toBe(true)
  })

  it('a non-mapping project.yaml degrades (the file is rejected, not fatal: it EXISTS)', () => {
    const ws = makeWorkspace({
      treePatch: { 'project.yaml': '[1, 2, 3]' },
    })
    const load = loadAt(ws.researchRoot)
    const r = classifyTreeLoad(load)
    expect(r.status).toBe('recoverable')
    expect(r.usable).toBe(true)
    expect(load.tree.project).toBeNull()
    const e = r.degradedErrors.find((e) => e.file === 'project.yaml')
    expect(e).toBeDefined()
    expect(e!.code).toBe('SCHEMA')
  })

  it('an unknown layout entry degrades (reported per entry, the rest load)', () => {
    const ws = makeWorkspace()
    // a stray top-level file: not part of the §14 layout
    const stray = join(ws.researchRoot, 'stray.txt')
    writeFileSync(stray, 'stray\n')
    const r = classifyTreeLoad(loadAt(ws.researchRoot))
    expect(r.status).toBe('recoverable')
    expect(r.degradedErrors.some((e) => e.code === 'UNKNOWN_ENTRY' && e.file === 'stray.txt')).toBe(true)
  })

  it('a dangling plan reference degrades (the REFERRING file is rejected)', () => {
    const ws = makeWorkspace({
      treePatch: {
        'topics/TPC-1/workstreams/WS-1/plan.yaml': 'workstream: WS-1\nordered_items: [G-1, T-9]\n',
      },
    })
    const load = loadAt(ws.researchRoot)
    const r = classifyTreeLoad(load)
    expect(r.status).toBe('recoverable')
    expect(r.degradedErrors.some((e) => e.code === 'DANGLING_REF' && e.file === 'topics/TPC-1/workstreams/WS-1/plan.yaml')).toBe(true)
    // the task definitions themselves are fine
    expect(load.tree.topics[0]!.workstreams[0]!.tasks.find((t) => t.id === 'T-1')!.doc).not.toBeNull()
  })

  it('a YAML syntax error degrades with the file+line location', () => {
    const ws = makeWorkspace({
      treePatch: {
        'topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml': 'id: T-2\ngoal: [unclosed\n',
      },
    })
    const load = loadAt(ws.researchRoot)
    const r = classifyTreeLoad(load)
    expect(r.status).toBe('recoverable')
    const e = r.degradedErrors.find((e) => e.file === 'topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml')
    expect(e).toBeDefined()
    expect(e!.code).toBe('PARSE')
    expect(r.guidance.join('\n')).toContain('T-2.yaml')
  })
})

describe('classifyTreeLoad — fatal (startup refuses, fail loud)', () => {
  it('a missing research root is fatal (no 真源 at all)', () => {
    const ws = makeWorkspace()
    const r = classifyTreeLoad(loadAt(join(ws.repoRoot, 'no-such-dir')))
    expect(r.status).toBe('unrecoverable')
    expect(r.usable).toBe(false)
    expect(r.fatalErrors.some((e) => e.file === '' && e.code === 'MISSING_REQUIRED')).toBe(true)
    expect(r.guidance.join('\n')).toContain('carries no .research tree')
  })

  it('an unreadable research root (injected I/O failure) is fatal', () => {
    const ws = makeWorkspace()
    const reader = new FsReader([ws.researchRoot])
    const r = classifyTreeLoad(loadAt(ws.researchRoot, DECLARATIVE_SCHEMA_DIR, reader))
    expect(r.status).toBe('unrecoverable')
    expect(r.fatalErrors.some((e) => e.file === '' && e.code === 'READ')).toBe(true)
    expect(r.guidance.join('\n')).toContain('unreadable')
  })

  it('a missing project.yaml is fatal (the root object) with the git-restore remedy', () => {
    const ws = makeWorkspace({ treePatch: { 'project.yaml': null } })
    const r = classifyTreeLoad(loadAt(ws.researchRoot))
    expect(r.status).toBe('unrecoverable')
    expect(r.fatalErrors.some((e) => e.file === 'project.yaml' && e.code === 'MISSING_REQUIRED')).toBe(true)
    const all = r.guidance.join('\n')
    expect(all).toContain('project.yaml')
    expect(all).toContain('git restore')
  })

  it('a missing schema-version is fatal', () => {
    const ws = makeWorkspace({ treePatch: { 'schema-version': null } })
    const r = classifyTreeLoad(loadAt(ws.researchRoot))
    expect(r.status).toBe('unrecoverable')
    expect(r.fatalErrors.some((e) => e.file === 'schema-version' && e.code === 'MISSING_REQUIRED')).toBe(true)
  })

  it('an unsupported schema-version (2) is fatal (contract mismatch, not per-file)', () => {
    const ws = makeWorkspace({ treePatch: { 'schema-version': '2\n' } })
    const r = classifyTreeLoad(loadAt(ws.researchRoot))
    expect(r.status).toBe('unrecoverable')
    expect(r.fatalErrors.some((e) => e.code === 'SCHEMA_VERSION')).toBe(true)
    expect(r.guidance.join('\n')).toContain('schema-version')
  })

  it('a broken FROZEN schema set is fatal (plugin-side fault → reinstall)', () => {
    const ws = makeWorkspace()
    const badSchemaDir = join(ws.repoRoot, 'bad-schema')
    mkdirSync(badSchemaDir, { recursive: true })
    // every expected schema file missing → SCHEMA_LOAD per file
    const r = classifyTreeLoad(loadAt(ws.researchRoot, badSchemaDir))
    expect(r.status).toBe('unrecoverable')
    expect(r.fatalErrors.some((e) => e.code === 'SCHEMA_LOAD')).toBe(true)
    expect(r.guidance.join('\n')).toContain('reinstall')
  })
})
