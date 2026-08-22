/**
 * WP-2.2 — registry loading: the REAL frozen WR/schema/history pipeline
 * (fs-backed reader, real `../common.schema.json` $ref resolution, 20
 * per-event validators) + the failure paths (SCHEMA_LOAD / CATALOG_SYNC —
 * the frozen-contract sync check, catalog §7.2).
 *
 * Tampering never touches the frozen files: copies are made into an mkdtemp
 * dir (the frozen bytes stay byte-identical — asserted at the end).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadHistoryEventRegistry, validateEvent, type HistorySchemaReader } from '../../src/host/history/registry/index.js'
import { WR_HISTORY_SCHEMA_DIR, WR_ROOT, envelope, makeCtx } from './fixtures.js'

const SCHEMA_FILES = ['history-event-envelope.schema.json', 'history-events.schema.json']

/** Tmp dirs created by the tampering tests (self-cleanup, suite convention). */
const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
})

function makeReader(files: Map<string, string | null>): HistorySchemaReader {
  return {
    readFile(path: string): string | null {
      return files.get(path) ?? null
    },
  }
}

/** Build a tmp schema dir (history/ + ../common.schema.json) from file overrides. */
function tmpSchemaDir(overrides: { historyEvents?: string; common?: string | null; extraFiles?: Record<string, string> }): string {
  const tmp = mkdtempSync(join(tmpdir(), 'wp22-schema-'))
  tmpDirs.push(tmp)
  const historyDir = join(tmp, 'schema', 'history')
  mkdirSync(historyDir, { recursive: true })
  if (overrides.common !== undefined) {
    if (overrides.common === null) {
      // explicitly absent
    } else {
      writeFileSync(join(tmp, 'schema', 'common.schema.json'), overrides.common, 'utf8')
    }
  } else {
    writeFileSync(join(tmp, 'schema', 'common.schema.json'), readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8'), 'utf8')
  }
  for (const name of SCHEMA_FILES) {
    if (name === 'history-events.schema.json' && overrides.historyEvents !== undefined) {
      writeFileSync(join(historyDir, name), overrides.historyEvents, 'utf8')
    } else {
      writeFileSync(join(historyDir, name), readFileSync(join(WR_HISTORY_SCHEMA_DIR, name), 'utf8'), 'utf8')
    }
  }
  return historyDir
}

describe('WP-2.2 — registry loading with the REAL frozen WR/schema/history', () => {
  it('the frozen dir is what we load (hard precondition)', () => {
    expect(existsSync(join(WR_HISTORY_SCHEMA_DIR, 'history-events.schema.json'))).toBe(true)
    expect(existsSync(join(WR_ROOT, 'schema', 'common.schema.json'))).toBe(true)
  })

  it('per-event validators produce PRECISE errors (path + value) on the real schemas', () => {
    const registry = loadHistoryEventRegistry({
      readFile: (path) => readFileSync(path, 'utf8'),
    }, WR_HISTORY_SCHEMA_DIR)
    expect(registry.isUsable).toBe(true)
    // precise payload path, real id pattern from common.schema.json:
    const result = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'X-1' }), makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const err = result.errors.find((e) => e.path === '/payload/run_id')
      expect(err, JSON.stringify(result.errors)).toBeDefined()
      expect(err!.code).toBe('ENVELOPE')
      expect(err!.message).toContain('R-[1-9]')
      expect(err!.message).toContain('X-1')
    }
    // precise const error for an unknown schemaVersion:
    const v2 = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-1' }, { schemaVersion: 2 }), makeCtx())
    if (!v2.ok) {
      expect(v2.errors.some((e) => e.path === '/schemaVersion' && e.message.includes('must equal 1'))).toBe(true)
    }
  })
})

describe('WP-2.2 — registry load failures (SCHEMA_LOAD / CATALOG_SYNC)', () => {
  it('missing history-events.schema.json ⇒ SCHEMA_LOAD, registry unusable', () => {
    const dir = tmpSchemaDir({})
    const readerFiles = new Map<string, string | null>()
    for (const f of SCHEMA_FILES) readerFiles.set(join(dir, f), null)
    readerFiles.set(join(dir, '..', 'common.schema.json'), readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8'))
    readerFiles.set(join(dir, 'history-event-envelope.schema.json'), readFileSync(join(WR_HISTORY_SCHEMA_DIR, 'history-event-envelope.schema.json'), 'utf8'))
    const registry = loadHistoryEventRegistry(makeReader(readerFiles), dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.some((e) => e.code === 'SCHEMA_LOAD' && (e.file ?? '').endsWith('history-events.schema.json'))).toBe(true)
    const result = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-1' }), makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.code).toBe('REGISTRY_UNUSABLE')
  })

  it('missing common.schema.json (parent dir) ⇒ SCHEMA_LOAD, registry unusable', () => {
    const dir = tmpSchemaDir({ common: null })
    const readerFiles = new Map<string, string | null>()
    readerFiles.set(join(dir, 'history-events.schema.json'), readFileSync(join(WR_HISTORY_SCHEMA_DIR, 'history-events.schema.json'), 'utf8'))
    readerFiles.set(join(dir, 'history-event-envelope.schema.json'), readFileSync(join(WR_HISTORY_SCHEMA_DIR, 'history-event-envelope.schema.json'), 'utf8'))
    readerFiles.set(join(dir, '..', 'common.schema.json'), null)
    const registry = loadHistoryEventRegistry(makeReader(readerFiles), dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.some((e) => e.code === 'SCHEMA_LOAD' && (e.file ?? '').endsWith('common.schema.json'))).toBe(true)
  })

  it('invalid JSON ⇒ SCHEMA_LOAD', () => {
    const dir = tmpSchemaDir({ historyEvents: '{ not json' })
    const readerFiles = new Map<string, string | null>()
    readerFiles.set(join(dir, 'history-events.schema.json'), '{ not json')
    readerFiles.set(join(dir, '..', 'common.schema.json'), readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8'))
    const registry = loadHistoryEventRegistry(makeReader(readerFiles), dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.some((e) => e.code === 'SCHEMA_LOAD')).toBe(true)
  })

  it('reader I/O failure (throw) ⇒ SCHEMA_LOAD, never a crash', () => {
    const dir = tmpSchemaDir({})
    const registry = loadHistoryEventRegistry({
      readFile: () => {
        throw new Error('disk on fire')
      },
    }, dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.every((e) => e.code === 'SCHEMA_LOAD')).toBe(true)
    expect(registry.loadErrors.length).toBeGreaterThanOrEqual(1)
  })

  it('oneOf branch removed ⇒ CATALOG_SYNC (metadata name has no schema branch), unusable', () => {
    const raw = JSON.parse(readFileSync(join(WR_HISTORY_SCHEMA_DIR, 'history-events.schema.json'), 'utf8')) as { oneOf: unknown[] }
    raw.oneOf = raw.oneOf.slice(0, 19) // drop TOPOLOGY_MERGE_REALIZED
    const dir = tmpSchemaDir({ historyEvents: JSON.stringify(raw) })
    const readerFiles = new Map<string, string | null>()
    readerFiles.set(join(dir, 'history-events.schema.json'), JSON.stringify(raw))
    readerFiles.set(join(dir, '..', 'common.schema.json'), readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8'))
    const registry = loadHistoryEventRegistry(makeReader(readerFiles), dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.some((e) => e.code === 'CATALOG_SYNC' && e.message.includes('TOPOLOGY_MERGE_REALIZED'))).toBe(true)
  })

  it('a renamed oneOf branch ⇒ CATALOG_SYNC on BOTH sides (unknown schema name + missing branch)', () => {
    const raw = JSON.parse(readFileSync(join(WR_HISTORY_SCHEMA_DIR, 'history-events.schema.json'), 'utf8')) as { oneOf: { properties?: { eventType?: { const?: string } } }[] }
    raw.oneOf[0]!.properties!.eventType!.const = 'RUN_LAUNCHED'
    const dir = tmpSchemaDir({ historyEvents: JSON.stringify(raw) })
    const readerFiles = new Map<string, string | null>()
    readerFiles.set(join(dir, 'history-events.schema.json'), JSON.stringify(raw))
    readerFiles.set(join(dir, '..', 'common.schema.json'), readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8'))
    const registry = loadHistoryEventRegistry(makeReader(readerFiles), dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.some((e) => e.code === 'CATALOG_SYNC' && e.message.includes('RUN_LAUNCHED'))).toBe(true)
    expect(registry.loadErrors.some((e) => e.code === 'CATALOG_SYNC' && e.message.includes('RUN_STARTED'))).toBe(true)
  })

  it('a duplicated oneOf branch ⇒ CATALOG_SYNC duplicate, unusable', () => {
    const raw = JSON.parse(readFileSync(join(WR_HISTORY_SCHEMA_DIR, 'history-events.schema.json'), 'utf8')) as { oneOf: unknown[] }
    raw.oneOf.push(raw.oneOf[0])
    const dir = tmpSchemaDir({ historyEvents: JSON.stringify(raw) })
    const readerFiles = new Map<string, string | null>()
    readerFiles.set(join(dir, 'history-events.schema.json'), JSON.stringify(raw))
    readerFiles.set(join(dir, '..', 'common.schema.json'), readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8'))
    const registry = loadHistoryEventRegistry(makeReader(readerFiles), dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.some((e) => e.code === 'CATALOG_SYNC' && e.message.includes('duplicate'))).toBe(true)
  })

  it('a schemaVersion ≠ 1 branch ⇒ CATALOG_SYNC (V1 registry expects 1)', () => {
    const raw = JSON.parse(readFileSync(join(WR_HISTORY_SCHEMA_DIR, 'history-events.schema.json'), 'utf8')) as { oneOf: { properties?: { schemaVersion?: { const?: number } } }[] }
    raw.oneOf[5]!.properties!.schemaVersion!.const = 2
    const dir = tmpSchemaDir({ historyEvents: JSON.stringify(raw) })
    const readerFiles = new Map<string, string | null>()
    readerFiles.set(join(dir, 'history-events.schema.json'), JSON.stringify(raw))
    readerFiles.set(join(dir, '..', 'common.schema.json'), readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8'))
    const registry = loadHistoryEventRegistry(makeReader(readerFiles), dir)
    expect(registry.isUsable).toBe(false)
    expect(registry.loadErrors.some((e) => e.code === 'CATALOG_SYNC' && e.message.includes('TASK_EXECUTION_CHANGED'))).toBe(true)
  })
})

describe('WP-2.2 — frozen files stay untouched (read-only contract)', () => {
  const frozenBytes = () =>
    SCHEMA_FILES.map((f) => readFileSync(join(WR_HISTORY_SCHEMA_DIR, f), 'utf8')).join('§') +
    readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8')

  let before: string
  beforeAll(() => {
    before = frozenBytes()
  })

  it('the real schema files are readable and non-empty at the frozen location', () => {
    expect(frozenBytes().length).toBeGreaterThan(10_000)
  })

  afterAll(() => {
    // every tampering test worked on tmp copies; the frozen bytes are identical
    expect(frozenBytes()).toBe(before)
  })
})
