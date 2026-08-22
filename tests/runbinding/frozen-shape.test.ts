/**
 * WP-2.4 — frozen-schema conformance: every RunRecord /
 * DiscoveredSessionRecord the service produces must validate against the
 * FROZEN `schema/operational/run.schema.json` $defs (additionalProperties:
 * false — the record key sets are EXACTLY the frozen keys, snake_case;
 * id patterns `R-<n>` / `DS-<n>`; epochMs ≥ 0; the frozen enums).
 *
 * AJV 2020-12, the frozen schemas consumed exactly as shipped (the
 * WP-2.5 `schemas.ts` loader pattern: common.schema.json registered
 * under its own $id so the `#/$defs/...` refs resolve).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  WR_OPERATIONAL_SCHEMA_DIR,
  makeHarness,
  seedPendingDs,
  USER,
} from './helpers.js'

interface FrozenDoc {
  $id: string
  [key: string]: unknown
}

/** Compile both $defs of the frozen run.schema.json. */
function loadFrozenRunSchemas(): { run: (doc: unknown) => boolean; ds: (doc: unknown) => boolean; errors: string[] } {
  const errors: string[] = []
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  const read = (path: string): FrozenDoc | null => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as FrozenDoc
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }
  // Frozen layout: schema/common.schema.json (PARENT of operational/) +
  // schema/operational/run.schema.json — the $refs are relative
  // (`../common.schema.json#/$defs/...`) and resolve against the $ids.
  const common = read(join(WR_OPERATIONAL_SCHEMA_DIR, '..', 'common.schema.json'))
  const runDoc = read(join(WR_OPERATIONAL_SCHEMA_DIR, 'run.schema.json'))
  if (common === null || runDoc === null) return { run: () => false, ds: () => false, errors }
  try {
    ajv.addSchema(common, common.$id)
    ajv.addSchema(runDoc, runDoc.$id)
  } catch (e) {
    errors.push(`addSchema: ${e instanceof Error ? e.message : String(e)}`)
    return { run: () => false, ds: () => false, errors }
  }
  const run = ajv.getSchema(`${runDoc.$id}#/$defs/Run`)
  const ds = ajv.getSchema(`${runDoc.$id}#/$defs/DiscoveredSession`)
  if (run === undefined) errors.push('compile failed: $defs/Run')
  if (ds === undefined) errors.push('compile failed: $defs/DiscoveredSession')
  return {
    run: (doc) => (run ? (run(doc) as boolean) : false),
    ds: (doc) => (ds ? (ds(doc) as boolean) : false),
    errors,
  }
}

const schemas = loadFrozenRunSchemas()

function expectValid(fn: (doc: unknown) => boolean, doc: unknown, label: string): void {
  if (!fn(doc)) {
    throw new Error(`${label} does not validate against the frozen schema`)
  }
}

describe('frozen run.schema.json conformance (additionalProperties:false)', () => {
  it('loads the frozen schemas cleanly', () => {
    expect(schemas.errors).toEqual([])
  })

  it('a bind-produced RunRecord passes the frozen Run $def', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'fs-run-1' })
    const result = h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1', taskId: 'T-1', intent: 'x' }, USER)
    expectValid(schemas.run, result.run, 'bind RunRecord')
    expect(result.run.id).toMatch(/^R-[1-9][0-9]*$/)
    h.close()
  })

  it('an end-state RunRecord passes (ended_at present, status terminal)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    h.service.finishRun(a.run.id, { outcomeSummary: 's' })
    expectValid(schemas.run, h.service.getRun(a.run.id)!, 'finished RunRecord')
    h.close()
  })

  it('a checkpoint-updated RunRecord passes (last_checkpoint_* fields)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    h.service.recordCheckpoint(a.run.id, { note: 'n' }, USER)
    expectValid(schemas.run, h.service.getRun(a.run.id)!, 'checkpoint RunRecord')
    h.close()
  })

  it('PENDING / BOUND / DETACHED / IGNORED DiscoveredSessionRecords pass the frozen DS $def', () => {
    const h = makeHarness()
    const a = seedPendingDs(h, { sessionId: 'fs-ds-a' })
    expectValid(schemas.ds, a, 'PENDING DS')
    const b = seedPendingDs(h, { sessionId: 'fs-ds-b' })
    h.service.bindDiscoveredSession(b.id, { workstreamId: 'WS-1' })
    expectValid(schemas.ds, h.service.getDiscoveredSession(b.id)!, 'BOUND DS (bound_run_id present)')
    const c = seedPendingDs(h, { sessionId: 'fs-ds-c' })
    h.service.detachDiscoveredSession(c.id)
    expectValid(schemas.ds, h.service.getDiscoveredSession(c.id)!, 'DETACHED DS')
    const d = seedPendingDs(h, { sessionId: 'fs-ds-d' })
    h.service.ignoreDiscoveredSession(d.id)
    expectValid(schemas.ds, h.service.getDiscoveredSession(d.id)!, 'IGNORED DS')
    expect(d.id).toMatch(/^DS-[1-9][0-9]*$/)
    h.close()
  })

  it('the frozen schema is strict: unknown keys are rejected (the additionalProperties pin)', () => {
    expectValid(schemas.run, {
      id: 'R-1',
      workstream_id: 'WS-1',
      status: 'RUNNING',
      initiated_by: { kind: 'USER' },
      started_at: 1,
    }, 'minimal RunRecord')
    expect(schemas.run({
      id: 'R-1',
      workstream_id: 'WS-1',
      status: 'RUNNING',
      initiated_by: { kind: 'USER' },
      started_at: 1,
      not_a_frozen_key: true,
    })).toBe(false)
    expect(schemas.run({
      id: 'R-1',
      workstream_id: 'WS-1',
      status: 'NOT_A_STATUS',
      initiated_by: { kind: 'USER' },
      started_at: 1,
    })).toBe(false)
    expect(schemas.run({
      id: 'R-1',
      workstream_id: 'WS-1',
      status: 'RUNNING',
      initiated_by: { kind: 'USER' },
      started_at: -5,
    })).toBe(false)
    expect(schemas.ds({
      id: 'DS-1',
      dsh_session_id: 's',
      workspace_root: 'w',
      discovered_at: 1,
      state: 'NOT_A_STATE',
    })).toBe(false)
  })
})
