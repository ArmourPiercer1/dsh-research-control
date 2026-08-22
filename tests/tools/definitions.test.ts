/**
 * WP-3.3 — 11-tool definition completeness (task goal 1: 「11 工具定义
 * 完整性（schema 校验参数面）」; ARCHITECTURE §7.2; DSH_ADAPTER §10.1).
 *
 *  - the name set is EXACTLY the §7.2 frozen list (doc order);
 *  - the access classes are exactly the §7.2 writable (7) / read-only (4)
 *    groups, with requiresRun consistent;
 *  - every tool's parameter face is audited key-by-key against the frozen
 *    shapes (the host `defineTool` derives its JSON Schema from these —
 *    this audit pins the derived schema's input);
 *  - the output contracts are audited (real tools: the frozen record
 *    shapes; stubs: the permissive placeholder);
 *  - the Investigator registration subset is exactly the read-only group
 *    (DSH_ADAPTER §10.2 — INV-PERM-3 first layer).
 */

import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_REGISTER_ARG_KEYS,
  ARTIFACT_TYPES,
  CLAIM_RECORD_ARG_KEYS,
  CONTEXT_GET_ARG_KEYS,
  CONTRACT_READ_ARG_KEYS,
  FACT_RECORD_ARG_KEYS,
  HISTORY_ORDERS,
  HISTORY_QUERY_ARG_KEYS,
  INTERVENTION_CREATE_ARG_KEYS,
  INVESTIGATOR_TOOL_NAMES,
  NEXT_ACTION_CREATE_ARG_KEYS,
  OBJECT_KINDS,
  PLAN_FORK_CREATE_ARG_KEYS,
  PLAN_FORK_ITEM_KINDS,
  PLAN_FORK_TRIGGER_KINDS,
  PLAN_GET_ARG_KEYS,
  READ_TOOL_NAMES,
  RESEARCH_TOOL_NAMES,
  RUN_CHECKPOINT_ARG_KEYS,
  WRITE_TOOL_NAMES,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { makeRecordingDeps } from './fixtures.js'
import type { ToolObjectSpec, ToolParameters, ToolValueSpec } from '../../src/host/tools/index.js'

/** The frozen §7.2 list, verbatim from the document (doc order). */
const SECTION_7_2 = {
  writable: [
    'research_fact_record',
    'research_claim_record',
    'research_artifact_register',
    'research_intervention_create',
    'research_next_action_create',
    'research_plan_fork_create',
    'research_run_checkpoint',
  ],
  readOnly: ['research_context_get', 'research_plan_get', 'research_history_query', 'research_contract_read'],
} as const

const REQUIRED_TOP_LEVEL = [
  ...SECTION_7_2.writable,
  ...SECTION_7_2.readOnly,
] as unknown as string[]

function paramsOf(definition: { parameters: ToolParameters }): ToolParameters {
  return definition.parameters
}

function specOf(params: ToolParameters, key: string): ToolValueSpec & { required?: boolean } {
  const spec = params[key]
  if (spec === undefined) throw new Error(`missing parameter ${key}`)
  return spec
}

describe('definition completeness: the §7.2 frozen list', () => {
  const tools = createResearchTools(makeRecordingDeps())
  const byName = new Map(tools.map((t) => [t.name, t]))

  it('exactly 11 tools, exactly the §7.2 names, in doc order', () => {
    expect(REQUIRED_TOP_LEVEL).toHaveLength(11)
    expect([...RESEARCH_TOOL_NAMES]).toEqual([...SECTION_7_2.writable, ...SECTION_7_2.readOnly])
    expect(tools).toHaveLength(11)
    expect(tools.map((t) => t.name)).toEqual(RESEARCH_TOOL_NAMES)
    // no duplicates
    expect(new Set(tools.map((t) => t.name)).size).toBe(11)
  })

  it('access classes: exactly the §7.2 writable group writes, read-only group reads', () => {
    for (const name of SECTION_7_2.writable) {
      expect(byName.get(name)?.access, `${name} access`).toBe('write')
    }
    for (const name of SECTION_7_2.readOnly) {
      expect(byName.get(name)?.access, `${name} access`).toBe('read')
    }
    expect(WRITE_TOOL_NAMES).toEqual([...SECTION_7_2.writable])
    expect(READ_TOOL_NAMES).toEqual([...SECTION_7_2.readOnly])
  })

  it('requiresRun is true exactly for the write group (INV-PERM-1 run attribution)', () => {
    for (const t of tools) {
      expect(t.requiresRun, `${t.name} requiresRun`).toBe(t.access === 'write')
    }
  })

  it('the allowed actor set is AGENT-only for all 11 (the matrix column A)', () => {
    for (const t of tools) {
      expect([...t.allowedActorKinds], `${t.name} allowedActorKinds`).toEqual(['AGENT'])
    }
  })

  it('every definition is frozen with a renderable output contract', () => {
    for (const t of tools) {
      expect(Object.isFrozen(t), `${t.name} definition frozen`).toBe(true)
      expect(typeof t.description).toBe('string')
      expect(t.description.length).toBeGreaterThan(10)
      expect(typeof t.output.render).toBe('function')
      expect(t.output.schema, `${t.name} output schema`).toBeTypeOf('object')
    }
  })

  it('the Investigator preset subset is exactly the read-only group (DSH_ADAPTER §10.2)', () => {
    expect([...INVESTIGATOR_TOOL_NAMES]).toEqual([...SECTION_7_2.readOnly])
    for (const name of INVESTIGATOR_TOOL_NAMES) {
      expect(byName.get(name)?.access).toBe('read')
    }
  })
})

describe('definition completeness: parameter faces (the host-derived JSON Schema input)', () => {
  const tools = createResearchTools(makeRecordingDeps())
  const byName = new Map(tools.map((t) => [t.name, t]))

  it('research_plan_fork_create: the frozen §4 face — 7 keys, NO base, NO run', () => {
    const params = paramsOf(byName.get('research_plan_fork_create')!)
    expect(Object.keys(params).sort()).toEqual([...PLAN_FORK_CREATE_ARG_KEYS].sort())
    // INV-PLAN-6 at the tool face: no base variant of any spelling
    for (const key of Object.keys(params)) {
      expect(/^base/i.test(key), `base-less face: ${key}`).toBe(false)
    }
    // §4: actor/run come from the CALL CONTEXT, not the parameter face
    expect('created_by_run' in params).toBe(false)
    expect('run_id' in params).toBe(false)
    for (const key of PLAN_FORK_CREATE_ARG_KEYS) {
      expect(specOf(params, key).required, `${key} required`).toBe(true)
    }
  })

  it('research_plan_fork_create: proposed_items = array of KEEP/NEW oneOf (frozen $defs/ProposedItem shapes)', () => {
    const params = paramsOf(byName.get('research_plan_fork_create')!)
    const items = specOf(params, 'proposed_items') as { type: string; items?: { oneOf?: readonly (ToolObjectSpec & { oneOf?: readonly ToolObjectSpec[] })[] } }
    expect(items.type).toBe('array')
    const oneOf = items.items?.oneOf
    expect(oneOf?.length).toBe(2)
    const [keep, add] = oneOf!
    // KEEP branch: exact 3 keys, action const KEEP
    expect(keep.additionalProperties).toBe(false)
    expect(Object.keys(keep.properties!).sort()).toEqual(['action', 'kind', 'ref'])
    expect(keep.properties!.action).toMatchObject({ type: 'string', const: 'KEEP', required: true })
    expect(keep.properties!.kind).toMatchObject({ enum: [...PLAN_FORK_ITEM_KINDS], required: true })
    expect(keep.properties!.ref).toMatchObject({ type: 'string', required: true })
    // NEW branch: exact 3 keys + the per-kind spec oneOf (3 frozen shapes)
    expect(add.additionalProperties).toBe(false)
    expect(Object.keys(add.properties!).sort()).toEqual(['action', 'kind', 'spec'])
    expect(add.properties!.action).toMatchObject({ const: 'NEW', required: true })
    const spec = add.properties!.spec as { oneOf?: readonly ToolObjectSpec[]; required?: boolean }
    expect(spec.required).toBe(true)
    expect(spec.oneOf?.length).toBe(3)
    const [task, gate, milestone] = spec.oneOf!
    expect(Object.keys(task.properties!).sort()).toEqual(['acceptance_criteria', 'deliverables', 'goal', 'title'])
    expect(Object.keys(gate.properties!).sort()).toEqual(['criteria', 'references', 'title'])
    expect(Object.keys(milestone.properties!).sort()).toEqual(['statement', 'title'])
    for (const [s, requiredKeys] of [
      [task, ['title', 'goal']],
      [gate, ['title', 'criteria']],
      [milestone, ['title', 'statement']],
    ] as const) {
      for (const k of requiredKeys) {
        expect((s.properties![k] as { required?: boolean }).required, `${k} required`).toBe(true)
      }
    }
  })

  it('research_plan_fork_create: trigger_refs = frozen 5-kind typedRef face', () => {
    const params = paramsOf(byName.get('research_plan_fork_create')!)
    const refs = specOf(params, 'trigger_refs') as { type: string; items: ToolObjectSpec }
    expect(refs.type).toBe('array')
    expect(refs.items.additionalProperties).toBe(false)
    expect(Object.keys(refs.items.properties!)).toEqual(['kind', 'id'])
    expect(refs.items.properties!.kind).toMatchObject({ enum: [...PLAN_FORK_TRIGGER_KINDS], required: true })
    expect(refs.items.properties!.id).toMatchObject({ type: 'string', required: true })
  })

  it('research_run_checkpoint: frozen 2-key face (run_id required, note optional)', () => {
    const params = paramsOf(byName.get('research_run_checkpoint')!)
    expect(Object.keys(params).sort()).toEqual([...RUN_CHECKPOINT_ARG_KEYS].sort())
    expect(specOf(params, 'run_id').required).toBe(true)
    expect('required' in specOf(params, 'note')).toBe(false)
  })

  it('research_fact_record / research_claim_record: frozen 3-key payload faces', () => {
    for (const name of ['research_fact_record', 'research_claim_record']) {
      const params = paramsOf(byName.get(name)!)
      expect(Object.keys(params).sort(), name).toEqual([...FACT_RECORD_ARG_KEYS].sort())
      expect(specOf(params, 'workstream_id').required, name).toBe(true)
      expect(specOf(params, 'statement').required, name).toBe(true)
      expect('required' in specOf(params, 'references'), name).toBe(false)
    }
    expect([...FACT_RECORD_ARG_KEYS]).toEqual([...CLAIM_RECORD_ARG_KEYS])
  })

  it('research_artifact_register: frozen 7-key face with the artifactType enum', () => {
    const params = paramsOf(byName.get('research_artifact_register')!)
    expect(Object.keys(params).sort()).toEqual([...ARTIFACT_REGISTER_ARG_KEYS].sort())
    const type = specOf(params, 'type') as { enum?: readonly string[]; required?: boolean }
    expect(type.enum).toEqual([...ARTIFACT_TYPES])
    expect(type.required).toBe(true)
    for (const key of ['workstream_id', 'title', 'uri'] as const) {
      expect(specOf(params, key).required).toBe(true)
    }
    for (const key of ['content_hash', 'related_task', 'supersedes'] as const) {
      expect('required' in specOf(params, key)).toBe(false)
    }
  })

  it('research_intervention_create: frozen 4-key face (origin is NOT an argument — the agent lane is AGENT_REPORT)', () => {
    const params = paramsOf(byName.get('research_intervention_create')!)
    expect(Object.keys(params).sort()).toEqual([...INTERVENTION_CREATE_ARG_KEYS].sort())
    expect('origin' in params).toBe(false)
    expect(specOf(params, 'title').required).toBe(true)
    const sourceRefs = specOf(params, 'source_refs') as { items: ToolObjectSpec }
    expect(Object.keys(sourceRefs.items.properties!)).toEqual(['kind', 'id'])
    expect(sourceRefs.items.properties!.kind).toMatchObject({ enum: [...OBJECT_KINDS], required: true })
  })

  it('research_next_action_create: frozen 3-key face (status is NOT an argument — defaults PROPOSED)', () => {
    const params = paramsOf(byName.get('research_next_action_create')!)
    expect(Object.keys(params).sort()).toEqual([...NEXT_ACTION_CREATE_ARG_KEYS].sort())
    expect('status' in params).toBe(false)
    expect(specOf(params, 'statement').required).toBe(true)
    for (const key of ['workstream_id', 'rationale'] as const) {
      expect('required' in specOf(params, key)).toBe(false)
    }
  })

  it('research_context_get: NO parameters (the session binding is the subject)', () => {
    const params = paramsOf(byName.get('research_context_get')!)
    expect(Object.keys(params)).toEqual([])
    expect([...CONTEXT_GET_ARG_KEYS]).toEqual([])
  })

  it('research_plan_get / research_contract_read: single-key read faces', () => {
    const planParams = paramsOf(byName.get('research_plan_get')!)
    expect(Object.keys(planParams).sort()).toEqual([...PLAN_GET_ARG_KEYS].sort())
    expect(specOf(planParams, 'workstream_id').required).toBe(true)
    const contractParams = paramsOf(byName.get('research_contract_read')!)
    expect(Object.keys(contractParams).sort()).toEqual([...CONTRACT_READ_ARG_KEYS].sort())
    expect(specOf(contractParams, 'edge_id').required).toBe(true)
  })

  it('research_history_query: frozen 5-key face mirroring the WP-2.3 query surface', () => {
    const params = paramsOf(byName.get('research_history_query')!)
    expect(Object.keys(params).sort()).toEqual([...HISTORY_QUERY_ARG_KEYS].sort())
    expect(specOf(params, 'workstream_id').required).toBe(true)
    const order = specOf(params, 'order') as { enum?: readonly string[] }
    expect(order.enum).toEqual([...HISTORY_ORDERS])
    for (const key of ['after_seq', 'before_seq', 'limit'] as const) {
      expect((specOf(params, key) as { type?: string }).type, key).toBe('integer')
      expect('required' in specOf(params, key), key).toBe(false)
    }
  })

  it('output contracts: real tools declare the frozen record shapes; stubs the permissive placeholder', () => {
    const pf = byName.get('research_plan_fork_create')!.output.schema
    expect(pf.type).toBe('object')
    expect(pf.properties!.status).toMatchObject({ const: 'created' })
    const record = pf.properties!.plan_fork!
    expect(record.type).toBe('object')
    expect(record.additionalProperties).toBe(false)
    expect(Object.keys(record.properties!).sort()).toEqual(
      [
        'base_git_commit',
        'base_plan_objects',
        'created_at',
        'created_by_run',
        'dismissed_at',
        'fork_anchor',
        'id',
        'merge_anchor',
        'necessity',
        'proposed_items',
        'reason',
        'selected_at',
        'selected_by',
        'stale_reason',
        'status',
        'trigger_refs',
        'workstream_id',
      ].sort(),
    )
    expect(record.required!.length).toBe(12)
    expect(record.properties!.status).toMatchObject({ enum: ['OPEN', 'SELECTED', 'DISMISSED', 'STALE'] })
    expect(record.properties!.base_plan_objects!.items!.properties!.git_blob_oid).toMatchObject({
      pattern: '^[0-9a-f]{40}$',
    })

    const rc = byName.get('research_run_checkpoint')!.output.schema
    expect(rc.properties!.status).toMatchObject({ const: 'ok' })
    const run = rc.properties!.run!
    // the frozen RunRecord shape (run.schema.json — 12 properties, 5 required)
    expect(Object.keys(run.properties!)).toHaveLength(12)
    expect([...(run.required ?? [])].sort()).toEqual(['id', 'started_at', 'status', 'workstream_id', 'initiated_by'].sort())
    expect(run.properties!.status).toMatchObject({ enum: ['RUNNING', 'FINISHED', 'FAILED', 'CANCELLED'] })

    for (const name of [
      'research_fact_record',
      'research_claim_record',
      'research_artifact_register',
      'research_intervention_create',
      'research_next_action_create',
      'research_context_get',
      'research_plan_get',
      'research_history_query',
      'research_contract_read',
    ]) {
      const schema = byName.get(name)!.output.schema
      expect(schema.additionalProperties, `${name} stub schema permissive`).toBe(true)
    }
  })
})

describe('definition completeness: composition (createResearchTools)', () => {
  it('fail-loud on a malformed deps object', () => {
    expect(() => createResearchTools(null as never)).toThrow(TypeError)
    expect(() => createResearchTools({ recordCheckpoint: () => ({} as never) } as never)).toThrow(
      /planForkCreate/,
    )
    expect(() => createResearchTools({ planForkCreate: () => ({} as never) } as never)).toThrow(
      /recordCheckpoint/,
    )
  })

  it('composes the 11 definitions in the frozen §7.2 order (registration-ready)', () => {
    const tools = createResearchTools(makeRecordingDeps())
    expect(tools.map((t) => t.name)).toEqual(RESEARCH_TOOL_NAMES)
    for (const t of tools) {
      expect(Object.isFrozen(t)).toBe(true)
      expect(typeof t.execute).toBe('function')
    }
  })
})
