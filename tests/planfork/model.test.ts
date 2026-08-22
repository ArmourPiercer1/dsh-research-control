/**
 * WP-3.1 — 模型往返 (schema 同构): `PlanForkRecord` / `ProposedItem` /
 * `BasePlanObject` 与 REAL 冻结 `plan-fork.schema.json` $defs 的逐字同构
 * 证明 — 正例全过 + 负例 (额外键/坏 OID 模式/空 trigger_refs/坏 status/
 * 缺失必填) 全部被真实冻结 schema 拒绝。行映射往返 (record → SQL 参数
 * JSON 形状 → 行 → record) 也在此钉死。
 */

import { describe, expect, it } from 'vitest'

import {
  loadPlanForkSchemas,
  planForkToParams,
  rowToPlanFork,
  type PlanForkRecord,
} from '../../src/host/domain/planfork/index.js'
import { MEM_OPERATIONAL_SCHEMA_DIR, openRecord, realOperationalSchemaFiles } from './fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'

function makeSchemas() {
  const reader = new MemoryReader(realOperationalSchemaFiles())
  const schemas = loadPlanForkSchemas(reader, MEM_OPERATIONAL_SCHEMA_DIR)
  expect(schemas.isUsable).toBe(true)
  return schemas
}

describe('PlanForkRecord ↔ frozen plan-fork.schema.json (isomorphism round-trip)', () => {
  it('accepts the §11-shaped OPEN record against the REAL frozen $defs/PlanFork', () => {
    const schemas = makeSchemas()
    const check = schemas.checkRecordShape(openRecord())
    expect(check.ok).toBe(true)
    expect(check.errors).toEqual([])
  })

  it('accepts records in every status with the co-occurring fields', () => {
    const schemas = makeSchemas()
    const base = openRecord()
    const selected: PlanForkRecord = {
      ...base,
      status: 'SELECTED',
      selected_at: base.created_at + 1000,
      selected_by: { kind: 'USER', label: 'researcher' },
    }
    const dismissed: PlanForkRecord = { ...base, status: 'DISMISSED', dismissed_at: base.created_at + 2000 }
    const stale: PlanForkRecord = { ...base, status: 'STALE', stale_reason: 'T-2 goal 变更 (items/tasks/T-2.yaml OID 变化)' }
    expect(schemas.checkRecordShape(selected).ok).toBe(true)
    expect(schemas.checkRecordShape(dismissed).ok).toBe(true)
    expect(schemas.checkRecordShape(stale).ok).toBe(true)
  })

  it('round-trips record → row params → row → record (JSON columns re-parse verbatim)', () => {
    const record = openRecord()
    const params = planForkToParams(record)
    expect(params).toHaveLength(17)
    const row: Record<string, unknown> = {
      id: params[0] as string,
      workstream_id: params[1] as string,
      base_plan_objects: params[2] as string,
      base_git_commit: params[3],
      fork_anchor: params[4] as string,
      merge_anchor: params[5] as string,
      proposed_items: params[6] as string,
      trigger_refs: params[7] as string,
      reason: params[8] as string,
      necessity: params[9] as string,
      created_by_run: params[10] as string,
      created_at: params[11] as number,
      status: params[12] as string,
      selected_at: params[13],
      selected_by: params[14],
      dismissed_at: params[15],
      stale_reason: params[16],
    }
    const back = rowToPlanFork(row)
    expect(back).toEqual(record)
  })

  it('rejects extra properties (additionalProperties:false — 类型面封闭的运行时同构)', () => {
    const schemas = makeSchemas()
    const check = schemas.checkRecordShape({ ...openRecord(), rogue: true })
    expect(check.ok).toBe(false)
    expect(check.errors.some((e) => e.message.includes('unexpected property "rogue"'))).toBe(true)
  })

  it('rejects missing required fields', () => {
    const schemas = makeSchemas()
    const rec = openRecord()
    const { necessity, ...noNecessity } = rec
    void necessity
    const check = schemas.checkRecordShape(noNecessity)
    expect(check.ok).toBe(false)
    expect(check.errors.some((e) => e.message.includes('missing required property "necessity"'))).toBe(true)
  })

  it('rejects malformed git_blob_oid (pattern ^[0-9a-f]{40}$) and empty base set (minItems 1)', () => {
    const schemas = makeSchemas()
    const badOid = openRecord({
      base_plan_objects: [{ path: 'topics/TPC-1/workstreams/WS-1/plan.yaml', git_blob_oid: 'XYZ' }],
    })
    expect(schemas.checkRecordShape(badOid).ok).toBe(false)
    const emptyBase = openRecord({ base_plan_objects: [] })
    expect(schemas.checkRecordShape(emptyBase).ok).toBe(false)
    expect(schemas.checkBasePlanObjects([]).ok).toBe(false)
    expect(schemas.checkBasePlanObjects([{ path: '', git_blob_oid: 'a'.repeat(40) }]).ok).toBe(false)
    expect(schemas.checkBasePlanObjects([{ path: 'p', git_blob_oid: 'a'.repeat(40) }]).ok).toBe(true)
  })

  it('rejects unknown status values and bad anchor tokens', () => {
    const schemas = makeSchemas()
    const badStatus = openRecord({ status: 'ARCHIVED' as PlanForkRecord['status'] })
    expect(schemas.checkRecordShape(badStatus).ok).toBe(false)
    const badAnchor = openRecord({ fork_anchor: 'NOT_AN_ID' })
    expect(schemas.checkRecordShape(badAnchor).ok).toBe(false)
    // 哨兵是合法 anchor token (schema: oneOf planItemId | __START__/__END__)
    const start = openRecord({ fork_anchor: '__START__', merge_anchor: 'G-2' })
    expect(schemas.checkRecordShape(start).ok).toBe(true)
    const end = openRecord({ fork_anchor: 'G-1', merge_anchor: '__END__' })
    expect(schemas.checkRecordShape(end).ok).toBe(true)
  })

  it('rejects empty trigger_refs / proposed_items (minItems 1) and non-listing trigger kinds', () => {
    const schemas = makeSchemas()
    expect(schemas.checkRecordShape(openRecord({ trigger_refs: [] })).ok).toBe(false)
    expect(schemas.checkRecordShape(openRecord({ proposed_items: [] })).ok).toBe(false)
    const runTrigger = openRecord({ trigger_refs: [{ kind: 'RUN' as never, id: 'R-1' }] })
    expect(schemas.checkRecordShape(runTrigger).ok).toBe(false)
  })

  it('accepts all 5 frozen trigger kinds', () => {
    const schemas = makeSchemas()
    for (const kind of ['CLAIM', 'FACT', 'ARTIFACT', 'MILESTONE', 'OBJECTIVE'] as const) {
      const id = kind === 'CLAIM' ? 'C-1' : kind === 'FACT' ? 'F-1' : kind === 'ARTIFACT' ? 'A-1' : kind === 'MILESTONE' ? 'M-1' : 'OBJ-1'
      expect(schemas.checkRecordShape(openRecord({ trigger_refs: [{ kind, id }] })).ok).toBe(true)
    }
  })
})

describe('ProposedItem ↔ frozen $defs/ProposedItem (the §2.1 two forms)', () => {
  it('accepts the KEEP form (action/kind/ref closed) and the NEW form per kind', () => {
    const schemas = makeSchemas()
    expect(schemas.checkProposedItem({ action: 'KEEP', kind: 'TASK', ref: 'T-3' }).ok).toBe(true)
    expect(schemas.checkProposedItem({ action: 'NEW', kind: 'TASK', spec: { title: 't', goal: 'g' } }).ok).toBe(true)
    expect(schemas.checkProposedItem({ action: 'NEW', kind: 'GATE', spec: { title: 't', criteria: 'c' } }).ok).toBe(true)
    expect(schemas.checkProposedItem({ action: 'NEW', kind: 'MILESTONE', spec: { title: 't', statement: 's' } }).ok).toBe(true)
    // 可选字段
    expect(
      schemas.checkProposedItem({
        action: 'NEW',
        kind: 'TASK',
        spec: { title: 't', goal: 'g', deliverables: ['d.md'], acceptance_criteria: ['a1'] },
      }).ok,
    ).toBe(true)
    expect(schemas.checkProposedItem({ action: 'NEW', kind: 'GATE', spec: { title: 't', criteria: 'c', references: ['F-1'] } }).ok).toBe(true)
  })

  it('rejects shape violations (unknown action, extra keys, missing ref/spec)', () => {
    const schemas = makeSchemas()
    expect(schemas.checkProposedItem({ action: 'DELETE', kind: 'TASK', ref: 'T-1' }).ok).toBe(false)
    expect(schemas.checkProposedItem({ action: 'KEEP', kind: 'TASK' }).ok).toBe(false)
    expect(schemas.checkProposedItem({ action: 'NEW', kind: 'TASK' }).ok).toBe(false)
    expect(schemas.checkProposedItem({ action: 'KEEP', kind: 'TASK', ref: 'T-1', rogue: 1 }).ok).toBe(false)
  })

  it('rejects NEW specs failing the PER-KIND frozen def (kind↔spec 对应)', () => {
    const schemas = makeSchemas()
    // kind=TASK 但 gate 形 spec (无 goal) → 过不了 Task 定义
    expect(schemas.checkNewItemSpec('TASK', { title: 't', criteria: 'c' }).ok).toBe(false)
    expect(schemas.checkNewItemSpec('TASK', { title: 't', goal: 'g' }).ok).toBe(true)
    // kind=GATE 但缺 criteria
    expect(schemas.checkNewItemSpec('GATE', { title: 't' }).ok).toBe(false)
    // kind=MILESTONE 但缺 statement
    expect(schemas.checkNewItemSpec('MILESTONE', { title: 't' }).ok).toBe(false)
    // 空 title (minLength 1)
    expect(schemas.checkNewItemSpec('TASK', { title: '', goal: 'g' }).ok).toBe(false)
    // 超长 title (maxLength 200)
    expect(schemas.checkNewItemSpec('TASK', { title: 'x'.repeat(201), goal: 'g' }).ok).toBe(false)
    // 额外键 (additionalProperties:false)
    expect(schemas.checkNewItemSpec('MILESTONE', { title: 't', statement: 's', goal: 'g' }).ok).toBe(false)
  })
})
