/**
 * UI-5 D1 — Plan Writer Service test suite (memory-fs driven; ADJ-14:
 * operational-DB agnostic).
 *
 * Coverage per the brief §5 matrix (D1 rows):
 *   - create: per-kind (task/gate/milestone) + index (head/tail/middle) +
 *     ADJ-3 empty-plan (WS-2, no plan.yaml) + orphan id skipping (ADJ-2) +
 *     ledger PLAN_ITEM_ADDED row + ledger-failure compensation
 *     (release + fail-loud, mutation stands) + BOUNDARY index +
 *     inconsistent-plan gate + schema-required field rejection (SCHEMA
 *     carrier, no file written) + kind/payload mismatch (TYPE_MISMATCH).
 *   - update: RMW (omit = unchanged) + explicit null clears an optional
 *     field + required-field null ⇒ SCHEMA + unknown field ⇒ SCHEMA +
 *     immutable field ⇒ IMMUTABLE_FIELD + NOT_FOUND + malformed id ⇒
 *     TYPE_MISMATCH + NO ledger row (ADJ-4).
 *   - remove: plan membership + definition file RETAINED (INV-PLAN-9) +
 *     ledger PLAN_ITEM_REMOVED + NOT_FOUND for unlisted + empty-plan result.
 */
import { describe, expect, it } from 'vitest'
import { SQL_INSERT_MANAGEMENT_ACTION } from '../../src/host/domain/planfork/index.js'
import { PlanStore } from '../../src/host/domain/plan/index.js'
import type { UpdatePlanItemChanges } from '../../src/host/service/plan-writer/index.js'
import { baseFs, MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR } from '../plan/fixtures.js'
import { makeService } from './harness.js'

const TOPIC = 'TPC-1'
const WS = 'WS-1'
const WS_REL = `topics/${TOPIC}/workstreams/${WS}`
const PLAN_PATH = `${WS_REL}/plan.yaml`
const BASE_ORDER = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']
const absItem = (dir: 'tasks' | 'gates' | 'milestones', id: string) =>
  `${MEM_RESEARCH_ROOT}/${WS_REL}/items/${dir}/${id}.yaml`

/** The T-5 orphan seed (a failed prior materialization left it unlisted). */
const ORPHAN_T5_YAML = `id: T-5
workstream_id: WS-1
title: 上次失败物化留下的孤儿定义
goal: 孤儿定义文件（INV-PLAN-9 保留不删，id 分配必须跳过）
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:30:00Z
`

function ledgerCall(h: ReturnType<typeof makeService>) {
  return h.db.calls[0]
}

/* ================================================================== *
 * createPlanItem
 * ================================================================== */

describe('createPlanItem — per-kind + index', () => {
  it('creates a TASK at the tail by default (ADJ-2: T-5 after max seq 4)', () => {
    const h = makeService()
    const res = h.service.createPlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      kind: 'TASK',
      item: { task: { title: '新任务', goal: '目标' } },
    })
    expect(res.itemId).toBe('T-5')
    expect(res.workstreamId).toBe(WS)
    expect(res.kind).toBe('TASK')
    expect(res.planPath).toBe(PLAN_PATH)
    expect(res.newOrder).toEqual([...BASE_ORDER, 'T-5'])
    expect(res.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)
    // The definition file + the rewritten plan are on disk.
    expect(h.fs.readFile(absItem('tasks', 'T-5'))).toContain('新任务')
    expect(h.fs.readFile(`${MEM_RESEARCH_ROOT}/${PLAN_PATH}`)).toContain('T-5')
  })

  it('creates a GATE at the head with index 0', () => {
    const h = makeService()
    const res = h.service.createPlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      kind: 'GATE',
      item: { gate: { title: '新门禁', criteria: '验收标准' } },
      index: 0,
    })
    expect(res.itemId).toBe('G-3')
    expect(res.newOrder[0]).toBe('G-3')
    expect(res.newOrder).toHaveLength(BASE_ORDER.length + 1)
    expect(h.fs.readFile(absItem('gates', 'G-3'))).toContain('新门禁')
  })

  it('creates a MILESTONE at a middle index', () => {
    const h = makeService()
    const res = h.service.createPlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      kind: 'MILESTONE',
      item: { milestone: { title: '新状态', statement: '达成陈述' } },
      index: 3,
    })
    expect(res.itemId).toBe('M-2')
    expect(res.newOrder[3]).toBe('M-2')
    expect(res.newOrder).toEqual(['G-1', 'T-1', 'T-2', 'M-2', 'T-3', 'M-1', 'T-4', 'G-2'])
    expect(h.fs.readFile(absItem('milestones', 'M-2'))).toContain('新状态')
  })

  it('maps the optional arrays (deliverables/acceptanceCriteria/references)', () => {
    const h = makeService()
    const res = h.service.createPlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      kind: 'TASK',
      item: {
        task: {
          title: '带字段任务',
          goal: '目标',
          deliverables: ['docs/a.md'],
          acceptanceCriteria: ['标准一'],
          note: '备注',
        },
      },
    })
    const file = h.fs.readFile(absItem('tasks', res.itemId))
    expect(file).toContain('docs/a.md')
    expect(file).toContain('标准一')
    expect(file).toContain('备注')
  })
})

describe('createPlanItem — ADJ-3 empty plan (WS-2 has no plan.yaml)', () => {
  it('creates the plan on first item', () => {
    const h = makeService()
    const res = h.service.createPlanItem({
      workstreamId: 'WS-2',
      topicId: TOPIC,
      kind: 'TASK',
      item: { task: { title: '首个任务', goal: '目标' } },
    })
    expect(res.itemId).toBe('T-1')
    expect(res.newOrder).toEqual(['T-1'])
    expect(res.planPath).toBe(`topics/${TOPIC}/workstreams/WS-2/plan.yaml`)
    expect(h.fs.readFile(`${MEM_RESEARCH_ROOT}/${res.planPath}`)).toContain('T-1')
    expect(h.fs.readFile(`${MEM_RESEARCH_ROOT}/topics/${TOPIC}/workstreams/WS-2/items/tasks/T-1.yaml`)).toContain('首个任务')
  })

  it('index 0 is the only legal index on an empty plan', () => {
    const h = makeService()
    expect(() =>
      h.service.createPlanItem({
        workstreamId: 'WS-2',
        topicId: TOPIC,
        kind: 'TASK',
        item: { task: { title: 'x', goal: 'y' } },
        index: 1,
      }),
    ).toThrowError(/\[research-control\] BOUNDARY/)
  })
})

describe('createPlanItem — ADJ-2 orphan skipping', () => {
  it('skips an unlisted orphan definition (T-5 on disk ⇒ allocate T-6)', () => {
    const fs = baseFs()
    fs.addFile(absItem('tasks', 'T-5'), ORPHAN_T5_YAML)
    const h = makeService(fs)
    const res = h.service.createPlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      kind: 'TASK',
      item: { task: { title: '新任务', goal: '目标' } },
    })
    expect(res.itemId).toBe('T-6')
    // The orphan stays untouched on disk (INV-PLAN-9).
    expect(h.fs.readFile(absItem('tasks', 'T-5'))).toBe(ORPHAN_T5_YAML)
  })
})

describe('createPlanItem — failures', () => {
  it('rejects an out-of-range index (BOUNDARY carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'TASK',
        item: { task: { title: 'x', goal: 'y' } },
        index: BASE_ORDER.length + 1,
      }),
    ).toThrowError(/\[research-control\] BOUNDARY/)
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'TASK',
        item: { task: { title: 'x', goal: 'y' } },
        index: -1,
      }),
    ).toThrowError(/\[research-control\] BOUNDARY/)
  })

  it('rejects a task WITHOUT goal (schema-required; SCHEMA carrier, nothing written)', () => {
    const h = makeService()
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'TASK',
        item: { task: { title: '缺 goal' } },
      }),
    ).toThrowError(/\[research-control\] SCHEMA/)
    // No definition file, no plan rewrite, no ledger row.
    expect(h.fs.readFile(absItem('tasks', 'T-5'))).toBeNull()
    expect(h.fs.writes.filter((w) => w.ok)).toHaveLength(0)
    expect(h.db.calls).toHaveLength(0)
  })

  it('rejects a gate WITHOUT criteria (SCHEMA carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'GATE',
        item: { gate: { title: '缺 criteria' } },
      }),
    ).toThrowError(/\[research-control\] SCHEMA/)
  })

  it('rejects a milestone WITHOUT statement (SCHEMA carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'MILESTONE',
        item: { milestone: { title: '缺 statement' } },
      }),
    ).toThrowError(/\[research-control\] SCHEMA/)
  })

  it('rejects a kind/payload discriminator mismatch (TYPE_MISMATCH carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'TASK',
        item: { milestone: { title: 'x', statement: 'y' } },
      }),
    ).toThrowError(/\[research-control\] TYPE_MISMATCH/)
  })

  it('surfaces the FIRST load error on an inconsistent plan (dangling ref)', () => {
    const fs = baseFs()
    fs.addFile(
      `${MEM_RESEARCH_ROOT}/${PLAN_PATH}`,
      'workstream: WS-1\nordered_items:\n  - T-99\n',
    )
    const h = makeService(fs)
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'TASK',
        item: { task: { title: 'x', goal: 'y' } },
      }),
    ).toThrowError(/createPlanItem: the canonical plan failed to load/)
  })
})

describe('createPlanItem — ledger (ADJ-4: ADDED row)', () => {
  it('writes ONE PLAN_ITEM_ADDED row with the mechanical detail', () => {
    const h = makeService()
    const before = h.now()
    const res = h.service.createPlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      kind: 'TASK',
      item: { task: { title: '新任务', goal: '目标' } },
    })
    const after = h.now()
    expect(h.db.calls).toHaveLength(1)
    const call = ledgerCall(h)
    expect(call.sql).toBe(SQL_INSERT_MANAGEMENT_ACTION)
    const [id, kind, actor, subjects, gitCommit, gitBlobs, detail, occurredAt] = call.params as unknown[]
    expect(id).toBe(res.managementActionId)
    expect(kind).toBe('PLAN_ITEM_ADDED')
    expect(actor).toBe(JSON.stringify({ kind: 'USER' }))
    expect(subjects).toBe(JSON.stringify([{ kind: 'WORKSTREAM', id: WS }]))
    expect(gitCommit).toBeNull()
    expect(gitBlobs).toBeNull()
    expect(detail).toBe(
      `canonical plan of ${WS} gained T-5: new order [${[...BASE_ORDER, 'T-5'].join(', ')}]`,
    )
    expect(occurredAt).toBeGreaterThan(before)
    expect(occurredAt).toBeLessThanOrEqual(after)
    // The reservation lifecycle: reserve → commit (no release).
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'commit'])
  })

  it('on ledger failure: release the reservation + fail loud (the mutation stands)', () => {
    const h = makeService()
    h.db.failNext = true
    expect(() =>
      h.service.createPlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        kind: 'TASK',
        item: { task: { title: '新任务', goal: '目标' } },
      }),
    ).toThrowError(/manual reconciliation\): injected ledger write failure/)
    // The plan mutation STANDS (the reorderPlan fail-loud precedent).
    expect(h.fs.readFile(`${MEM_RESEARCH_ROOT}/${PLAN_PATH}`)).toContain('T-5')
    expect(h.fs.readFile(absItem('tasks', 'T-5'))).not.toBeNull()
    // The burned sequence is released (never reused), never committed.
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'release'])
  })
})

/* ================================================================== *
 * updatePlanItem
 * ================================================================== */

describe('updatePlanItem — RMW semantics', () => {
  it('updates the title; omitted fields stay (RMW) — and NO ledger row (ADJ-4)', () => {
    const h = makeService()
    const res = h.service.updatePlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      itemId: 'T-2',
      changes: { title: '候选方案 A 实现（修订）' },
    })
    expect(res.itemId).toBe('T-2')
    expect(res.workstreamId).toBe(WS)
    expect(typeof res.updatedAt).toBe('number')
    expect('managementActionId' in res).toBe(false)
    const file = h.fs.readFile(absItem('tasks', 'T-2'))
    expect(file).toContain('候选方案 A 实现（修订）')
    // goal untouched (omit = unchanged)
    expect(file).toContain('实现基于棋盘格的标定采集与求解')
    // ADJ-4: update writes NO ledger row.
    expect(h.db.calls).toHaveLength(0)
    expect(h.allocatorEvents).toHaveLength(0)
  })

  it('explicit null CLEARS an optional field (note added then cleared)', () => {
    const h = makeService()
    h.service.updatePlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      itemId: 'T-2',
      changes: { note: '临时备注' },
    })
    expect(h.fs.readFile(absItem('tasks', 'T-2'))).toContain('临时备注')
    h.service.updatePlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      itemId: 'T-2',
      changes: { note: null },
    })
    expect(h.fs.readFile(absItem('tasks', 'T-2'))).not.toContain('note:')
  })

  it('explicit null clears arrays (deliverables/acceptanceCriteria)', () => {
    const h = makeService()
    h.service.updatePlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      itemId: 'T-1',
      changes: { deliverables: ['docs/a.md', 'docs/b.md'], acceptanceCriteria: ['标准'] },
    })
    let file = h.fs.readFile(absItem('tasks', 'T-1'))
    expect(file).toContain('docs/b.md')
    h.service.updatePlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      itemId: 'T-1',
      changes: { deliverables: null, acceptanceCriteria: null },
    })
    file = h.fs.readFile(absItem('tasks', 'T-1'))
    // Cleared = schema-default empty arrays (the values are gone).
    expect(file).not.toContain('docs/b.md')
    expect(file).not.toContain('标准')
    expect(file).toContain('deliverables: []')
    expect(file).toContain('acceptance_criteria: []')
  })

  it('updates GATE (criteria/references) and MILESTONE (statement)', () => {
    const h = makeService()
    h.service.updatePlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      itemId: 'G-1',
      changes: { criteria: '修订标准', references: ['docs/spec.md'] },
    })
    expect(h.fs.readFile(absItem('gates', 'G-1'))).toContain('修订标准')
    expect(h.fs.readFile(absItem('gates', 'G-1'))).toContain('docs/spec.md')
    h.service.updatePlanItem({
      workstreamId: WS,
      topicId: TOPIC,
      itemId: 'M-1',
      changes: { statement: '修订陈述' },
    })
    expect(h.fs.readFile(absItem('milestones', 'M-1'))).toContain('修订陈述')
  })
})

describe('updatePlanItem — failures', () => {
  it('rejects a null on a schema-required field (goal — SCHEMA carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.updatePlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        itemId: 'T-2',
        changes: { goal: null },
      }),
    ).toThrowError(/\[research-control\] SCHEMA/)
  })

  it('rejects an unknown field (SCHEMA unknown-field carrier)', () => {
    const h = makeService()
    // Service-level probe: the D3 wire .strict() rejects this first; the
    // kernel guard is the backstop (derived/runtime state must not ride).
    const malicious = { execution: 'DOING' } as unknown as UpdatePlanItemChanges
    expect(() =>
      h.service.updatePlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        itemId: 'T-2',
        changes: malicious,
      }),
    ).toThrowError(/\[research-control\] SCHEMA/)
  })

  it('rejects id/workstream_id changes (IMMUTABLE_FIELD carrier)', () => {
    const h = makeService()
    const malicious = { id: 'T-99' } as unknown as UpdatePlanItemChanges
    expect(() =>
      h.service.updatePlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        itemId: 'T-2',
        changes: malicious,
      }),
    ).toThrowError(/\[research-control\] IMMUTABLE_FIELD/)
  })

  it('rejects a malformed itemId (TYPE_MISMATCH carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.updatePlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        itemId: 'X-1',
        changes: { title: 'x' },
      }),
    ).toThrowError(/\[research-control\] TYPE_MISMATCH/)
  })

  it('rejects an item without a definition (NOT_FOUND carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.updatePlanItem({
        workstreamId: WS,
        topicId: TOPIC,
        itemId: 'T-99',
        changes: { title: 'x' },
      }),
    ).toThrowError(/\[research-control\] NOT_FOUND/)
  })
})

/* ================================================================== *
 * removePlanItem
 * ================================================================== */

describe('removePlanItem', () => {
  it('removes from the middle; the definition file STAYS (INV-PLAN-9)', () => {
    const h = makeService()
    const res = h.service.removePlanItem({ workstreamId: WS, topicId: TOPIC, itemId: 'T-2' })
    expect(res.workstreamId).toBe(WS)
    expect(res.planPath).toBe(PLAN_PATH)
    expect(res.newOrder).toEqual(['G-1', 'T-1', 'T-3', 'M-1', 'T-4', 'G-2'])
    expect(res.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)
    // INV-PLAN-9: declaration-only — the definition file is retained.
    expect(h.fs.readFile(absItem('tasks', 'T-2'))).not.toBeNull()
    expect(h.fs.readFile(`${MEM_RESEARCH_ROOT}/${PLAN_PATH}`)).not.toContain('T-2')
  })

  it('writes ONE PLAN_ITEM_REMOVED ledger row', () => {
    const h = makeService()
    const res = h.service.removePlanItem({ workstreamId: WS, topicId: TOPIC, itemId: 'G-2' })
    expect(h.db.calls).toHaveLength(1)
    const call = ledgerCall(h)
    expect(call.sql).toBe(SQL_INSERT_MANAGEMENT_ACTION)
    const [id, kind, , , , , detail] = call.params as unknown[]
    expect(id).toBe(res.managementActionId)
    expect(kind).toBe('PLAN_ITEM_REMOVED')
    expect(detail).toBe(`canonical plan of ${WS} lost G-2: new order [${['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4'].join(', ')}]`)
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'commit'])
  })

  it('releases + fails loud on ledger failure (the removal stands)', () => {
    const h = makeService()
    h.db.failNext = true
    expect(() =>
      h.service.removePlanItem({ workstreamId: WS, topicId: TOPIC, itemId: 'T-1' }),
    ).toThrowError(/manual reconciliation/)
    expect(h.fs.readFile(`${MEM_RESEARCH_ROOT}/${PLAN_PATH}`)).not.toContain('T-1')
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'release'])
  })

  it('rejects an unlisted item (NOT_FOUND carrier)', () => {
    const h = makeService()
    expect(() =>
      h.service.removePlanItem({ workstreamId: WS, topicId: TOPIC, itemId: 'T-99' }),
    ).toThrowError(/\[research-control\] NOT_FOUND/)
    // Nothing written, nothing ledgered.
    expect(h.fs.writes.filter((w) => w.ok)).toHaveLength(0)
    expect(h.db.calls).toHaveLength(0)
  })

  it('removing the last item yields an empty plan (legal — no minItems)', () => {
    const h = makeService()
    for (const id of [...BASE_ORDER]) {
      h.service.removePlanItem({ workstreamId: WS, topicId: TOPIC, itemId: id })
    }
    // A fresh store load: the empty plan is CONSISTENT (no minItems rule).
    const store = new PlanStore({
      reader: h.fs,
      writer: h.fs,
      researchRoot: MEM_RESEARCH_ROOT,
      schemaDir: MEM_SCHEMA_DIR,
      topicId: TOPIC,
      wsId: WS,
    })
    const loaded = store.loadPlan()
    expect(loaded.errors).toHaveLength(0)
    expect(loaded.present).toBe(true)
    expect(loaded.items).toEqual([])
    // All definition files retained (INV-PLAN-9).
    for (const id of BASE_ORDER) {
      const kind = id.startsWith('T-') ? 'tasks' : id.startsWith('G-') ? 'gates' : 'milestones'
      expect(h.fs.readFile(absItem(kind, id)), id).not.toBeNull()
    }
  })
})
