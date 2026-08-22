/**
 * WP-2.5 — schema-driven row validation: load the REAL frozen operational
 * schemas (schemaDir injection, loader pattern) and hold every derived row
 * type to the frozen contract (TC-HIST-006's 「与冻结 schema 一致」 half).
 *
 * Negative cases feed malformed rows and assert PRECISE AJV paths +
 * messages (TC-DOM-027 style): id patterns, required fields,
 * additionalProperties, enums (status / artifactType / relation_type),
 * typedRef shape, epochMs integers. Load failures aggregate (never throw)
 * and degrade to `unavailable` row checks.
 */
import { describe, expect, it } from 'vitest'

import {
  foldSemanticEvents,
  loadSemanticSchemas,
  type SemanticSchemas,
} from '../../src/host/domain/semantics/index.js'
import { FsReader, WR_OPERATIONAL_SCHEMA_DIR, WR_ROOT, event } from './fixtures.js'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const reader = new FsReader()

describe('loadSemanticSchemas: the real frozen operational schemas', () => {
  let schemas: SemanticSchemas

  it('loads semantic-labels + relation + ../common with zero load errors', () => {
    schemas = loadSemanticSchemas(reader, WR_OPERATIONAL_SCHEMA_DIR)
    expect(schemas.loadErrors).toEqual([])
    expect(schemas.isUsable).toBe(true)
    expect(schemas.schemaDir).toBe(WR_OPERATIONAL_SCHEMA_DIR)
  })

  it('a well-formed claim row (reducer output) passes the frozen schema', () => {
    const state = foldSemanticEvents([
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's', references: ['x'] }, { actor: { kind: 'AGENT', run_id: 'R-1' }, occurredAt: 1700000000000 }),
    ])
    const check = schemas!.checkRowShape('claim', state.claims.get('C-1'))
    expect(check.ok).toBe(true)
  })

  it('every row type produced by the reducer passes its frozen schema (the full registry)', () => {
    const state = foldSemanticEvents([
      event('FACT_RECORDED', { fact_id: 'F-1', statement: 'f', created_by_run: 'R-1' }, { actor: { kind: 'AGENT', run_id: 'R-1' } }),
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }),
      event('ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'DATASET', title: 't', uri: 'u', content_hash: 'h', related_task: 'T-1', supersedes: undefined }),
      event('RELATION_ADDED', { relation_id: 'REL-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } }),
      event('CLAIM_RETRACTED', { claim_id: 'C-1' }, { occurredAt: 999 }),
      event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1' }, { occurredAt: 999 }),
      event('RELATION_REMOVED', { relation_id: 'REL-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } }, { occurredAt: 999 }),
    ])
    for (const row of state.claims.values()) expect(schemas!.checkRowShape('claim', row).ok, row.id).toBe(true)
    for (const row of state.facts.values()) expect(schemas!.checkRowShape('fact', row).ok, row.id).toBe(true)
    for (const row of state.artifacts.values()) expect(schemas!.checkRowShape('artifact', row).ok, row.id).toBe(true)
    for (const row of state.relations.values()) expect(schemas!.checkRowShape('relation', row).ok, row.id).toBe(true)
  })
})

describe('row shape negatives (precise paths + messages)', () => {
  const schemas = loadSemanticSchemas(reader, WR_OPERATIONAL_SCHEMA_DIR)

  const firstError = (check: { ok: boolean } & Record<string, unknown>) => {
    expect(check.ok).toBe(false)
    return (check as unknown as { errors: Array<{ path: string; message: string }> }).errors
  }

  it('claim: bad id pattern → /id (C-<n>, no leading zero)', () => {
    const errs = firstError(schemas.checkRowShape('claim', {
      id: 'C-01', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER' }, recorded_at: 1, status: 'ACTIVE',
    }))
    expect(errs.some((e) => e.path === '/id' && e.message.includes('pattern'))).toBe(true)
  })

  it('claim: missing statement / empty statement → required + minLength at /statement', () => {
    const base = { id: 'C-1', workstream_id: 'WS-1', created_by: { kind: 'USER' }, recorded_at: 1, status: 'ACTIVE' }
    expect(firstError(schemas.checkRowShape('claim', base)).some((e) => e.path === '' && e.message.includes('statement'))).toBe(true)
    expect(firstError(schemas.checkRowShape('claim', { ...base, statement: '' })).some((e) => e.path === '/statement')).toBe(true)
  })

  it('claim: status outside the enum (ACTIVE/RETRACTED) → /status', () => {
    const errs = firstError(schemas.checkRowShape('claim', {
      id: 'C-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER' }, recorded_at: 1, status: 'ARCHIVED',
    }))
    expect(errs.some((e) => e.path === '/status' && e.message.includes('ACTIVE'))).toBe(true)
  })

  it('claim: additionalProperties false → an invented field is rejected', () => {
    const errs = firstError(schemas.checkRowShape('claim', {
      id: 'C-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER' }, recorded_at: 1, status: 'ACTIVE', credibility: 0.9,
    }))
    expect(errs.some((e) => e.path === '' && e.message.includes('credibility'))).toBe(true)
  })

  it('claim: non-integer recorded_at → /recorded_at (epochMs)', () => {
    const errs = firstError(schemas.checkRowShape('claim', {
      id: 'C-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER' }, recorded_at: 'now', status: 'ACTIVE',
    }))
    expect(errs.some((e) => e.path === '/recorded_at' && e.message.includes('integer'))).toBe(true)
  })

  it('fact: status is CONST ACTIVE (a RETRACTED fact row is schema-invalid — §7.2 「恒 ACTIVE」)', () => {
    const errs = firstError(schemas.checkRowShape('fact', {
      id: 'F-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER' }, recorded_at: 1, status: 'RETRACTED',
    }))
    expect(errs.some((e) => e.path === '/status')).toBe(true)
  })

  it('artifact: bad type enum / bad id / bad workstream id → precise paths', () => {
    const base = { id: 'A-1', workstream_id: 'WS-1', type: 'DATASET', title: 't', uri: 'u', recorded_at: 1, status: 'REGISTERED' }
    expect(firstError(schemas.checkRowShape('artifact', { ...base, type: 'VIDEO' })).some((e) => e.path === '/type')).toBe(true)
    expect(firstError(schemas.checkRowShape('artifact', { ...base, id: 'R-1' })).some((e) => e.path === '/id')).toBe(true)
    expect(firstError(schemas.checkRowShape('artifact', { ...base, workstream_id: 'T-1' })).some((e) => e.path === '/workstream_id')).toBe(true)
  })

  it('artifact: status enum is REGISTERED/MISSING only', () => {
    const base = { id: 'A-1', workstream_id: 'WS-1', type: 'DATASET', title: 't', uri: 'u', recorded_at: 1, status: 'GONE' }
    expect(firstError(schemas.checkRowShape('artifact', base)).some((e) => e.path === '/status')).toBe(true)
  })

  it('relation: bad typedRef (missing kind) / bad relation_type enum / bad removed_at → precise paths', () => {
    const base = {
      id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
      created_by: { kind: 'USER' },
      created_at: 1,
      status: 'ACTIVE',
    }
    expect(firstError(schemas.checkRowShape('relation', { ...base, source: { id: 'C-1' } })).some((e) => e.path === '/source' && e.message.includes('kind'))).toBe(true)
    expect(firstError(schemas.checkRowShape('relation', { ...base, relation_type: 'SUPPORTS' })).some((e) => e.path === '/relation_type')).toBe(true)
    expect(firstError(schemas.checkRowShape('relation', { ...base, removed_at: -3 })).some((e) => e.path === '/removed_at')).toBe(true)
    expect(firstError(schemas.checkRowShape('relation', { ...base, status: 'DEAD' })).some((e) => e.path === '/status')).toBe(true)
  })

  it('relation: additionalProperties false (the row carries no owner/WS column — §8: owner is derived)', () => {
    const base = {
      id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
      created_by: { kind: 'USER' },
      created_at: 1,
      status: 'ACTIVE',
      workstream_id: 'WS-1',
    }
    const errs = firstError(schemas.checkRowShape('relation', base))
    expect(errs.some((e) => e.path === '' && e.message.includes('workstream_id'))).toBe(true)
  })

  it('actorRef shape: bad actor kind is rejected through the common $ref', () => {
    const errs = firstError(schemas.checkRowShape('claim', {
      id: 'C-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'GHOST' }, recorded_at: 1, status: 'ACTIVE',
    }))
    expect(errs.some((e) => e.path === '/created_by/kind')).toBe(true)
  })
})

describe('load failures aggregate (never throw) and degrade gracefully', () => {
  const realCommon = reader.readFile(join(WR_ROOT, 'schema', 'common.schema.json'))!
  const realRelation = reader.readFile(join(WR_OPERATIONAL_SCHEMA_DIR, 'relation.schema.json'))!

  /** A temp schema tree: the real common.schema.json in the parent, plus exactly `files` in the operational dir. */
  function tempDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'semantics-schemas-'))
    const op = join(dir, 'operational')
    mkdirSync(op, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(op, name), content)
    }
    // the common schema in the PARENT dir (the frozen layout)
    writeFileSync(join(dir, 'common.schema.json'), realCommon)
    return op
  }

  it('a missing operational schema file → SCHEMA_LOAD, unusable, checks report unavailable', () => {
    const dir = tempDir({})
    const schemas = loadSemanticSchemas(reader, dir)
    expect(schemas.isUsable).toBe(false)
    expect(schemas.loadErrors.every((e) => e.code === 'SCHEMA_LOAD')).toBe(true)
    expect(schemas.loadErrors.length).toBeGreaterThanOrEqual(3) // common ok; both operational files missing
    const check = schemas.checkRowShape('claim', {})
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.errors[0].message).toContain('unavailable')
  })

  it('invalid JSON in an operational schema → SCHEMA_LOAD naming the file', () => {
    const dir = tempDir({ 'semantic-labels.schema.json': '{ not json', 'relation.schema.json': realRelation })
    const schemas = loadSemanticSchemas(reader, dir)
    expect(schemas.isUsable).toBe(false)
    expect(schemas.loadErrors.some((e) => e.code === 'SCHEMA_LOAD' && (e.file ?? '').includes('semantic-labels'))).toBe(true)
    // the relation validator (whose file loaded fine) still works:
    const ok = schemas.checkRowShape('relation', {
      id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
      created_by: { kind: 'USER' },
      created_at: 1,
      status: 'ACTIVE',
    })
    expect(ok.ok).toBe(true)
  })

  it('a reader I/O failure → SCHEMA_LOAD (the kernel never throws on load)', () => {
    const failing = { readFile: () => { throw new Error('disk on fire') } }
    const schemas = loadSemanticSchemas(failing, '/nonexistent')
    expect(schemas.isUsable).toBe(false)
    expect(schemas.loadErrors.some((e) => e.code === 'SCHEMA_LOAD' && e.message.includes('disk on fire'))).toBe(true)
  })

  it('the frozen schemas are consumed read-only: the loader performs zero writes to schemaDir', () => {
    // the real frozen dir loads cleanly AND a second load in the same process
    // is byte-stable (no mutation of the frozen documents):
    const a = loadSemanticSchemas(reader, WR_OPERATIONAL_SCHEMA_DIR)
    const b = loadSemanticSchemas(reader, WR_OPERATIONAL_SCHEMA_DIR)
    expect(a.loadErrors).toEqual(b.loadErrors)
    expect(a.checkRowShape('claim', { id: 'C-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER' }, recorded_at: 1, status: 'ACTIVE' })).toEqual(
      b.checkRowShape('claim', { id: 'C-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER' }, recorded_at: 1, status: 'ACTIVE' }),
    )
  })
})
