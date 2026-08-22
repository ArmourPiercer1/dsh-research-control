/**
 * TC-DOM-005 — plan 顺序稳定（TEST_MATRIX L109）: 「写入 -> 重载 -> 重启模拟，
 * 顺序逐位相等」，plus the proof-level serialization guarantees behind it:
 *
 *   (a) 三态：write (mutation ops) → reload (same fs, same instance) →
 *       restart simulation (fresh MemoryFs from the byte snapshot + a fresh
 *       PlanStore instance — new process over new disk) ⇒ ordered_items
 *       position-for-position equal in all three states (INV-PLAN-1);
 *   (b) 序列化字节稳定：同数据两次 save 逐字节相等（cross-instance included）;
 *   (c) 计划文件形态逐位：file bytes = `workstream: WS\nordered_items: […]\n`
 *       with the exact stored order (no sort, no dedup, no reformat);
 *   (d) loader 互操作（字节级契约）：WP-1.1 `loadResearchTree` reads the
 *       store's bytes with ZERO errors and reports the identical order —
 *       the official read path consumes the store's writes verbatim.
 */
import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { loadResearchTree } from '../../src/host/domain/loader/index.js'
import { serializeMilestoneDoc, serializePlan, serializeTaskDoc } from '../../src/host/domain/plan/index.js'
import { load } from '../loader/fixtures.js'
import {
  ABS_PLAN,
  absItem,
  absPlanFor,
  baseFs,
  T09,
  WS,
  WS2,
  makeStore,
  milestoneDoc,
  taskDoc,
} from './fixtures.js'
import { MemoryFs } from './memory-fs.js'

/** Position-for-position equality (INV-PLAN-1: no reordering of ANY kind). */
function assertOrderEqual(actual: readonly string[], expected: readonly string[], label: string): void {
  expect(actual.length, `${label}: length`).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i], `${label}: position ${i}`).toBe(expected[i])
  }
}

describe('TC-DOM-005 plan order stability (INV-PLAN-1)', () => {
  it('三态: 写入 → 重载 → 重启模拟, 顺序逐位相等', () => {
    const fs = baseFs()
    const store = makeStore(fs)

    // --- write: a mutation sequence exercising insert/move/remove ---------
    store.removeItem('M-1') // [G-1, T-1, T-2, T-3, T-4, G-2]
    store.moveItem('T-3', 0) // [T-3, G-1, T-1, T-2, T-4, G-2]
    store.insertItemAt('M-1', 3) // [T-3, G-1, T-1, M-1, T-2, T-4, G-2]
    const expected = ['T-3', 'G-1', 'T-1', 'M-1', 'T-2', 'T-4', 'G-2']

    // --- state 1: the writer's own view (write) ---------------------------
    const state1 = store.loadPlan().items

    // --- state 2: reload — fresh instance, same on-disk bytes (刷新) ------
    const store2 = makeStore(fs)
    const state2 = store2.loadPlan().items

    // --- state 3: restart simulation — fresh disk (byte snapshot) + -------
    // --- fresh process (new PlanStore) over it (重启) ---------------------
    const fs3 = new MemoryFs(fs.snapshot())
    const store3 = makeStore(fs3)
    const state3 = store3.loadPlan().items

    assertOrderEqual(state1, expected, 'state1 (write)')
    assertOrderEqual(state2, expected, 'state2 (reload)')
    assertOrderEqual(state3, expected, 'state3 (restart)')
  })

  it('序列化字节稳定: 同数据两次 save 逐字节相等 (cross-instance)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.removeItem('G-1')
    const items = store.loadPlan().items

    store.savePlan(items)
    const bytes1 = fs.content(ABS_PLAN)!
    store.savePlan(items) // same data, same instance
    const bytes2 = fs.content(ABS_PLAN)!
    expect(bytes2).toBe(bytes1)

    // fresh instance over the same bytes — identical output again
    const store2 = makeStore(fs)
    store2.savePlan(items)
    expect(fs.content(ABS_PLAN)).toBe(bytes1)

    // fresh disk (restart) — the saved form is stable across restarts too
    const fs2 = new MemoryFs(fs.snapshot())
    const store3 = makeStore(fs2)
    store3.savePlan(items)
    expect(fs2.content(ABS_PLAN)).toBe(bytes1)

    // the pure serializer agrees with the on-disk bytes (no hidden state)
    expect(serializePlan(WS, items)).toBe(bytes1)
    expect(serializePlan(WS, items)).toBe(serializePlan(WS, items))
  })

  it('计划文件形态逐位: 字节即 workstream + 有序流序列 (no sort/dedup/reformat)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    // The base tree's plan.yaml is the frozen 附录 A example — load + save
    // must reproduce it byte-for-byte (the file was never reformatted).
    const original = fs.content(ABS_PLAN)!
    const items = store.loadPlan().items
    store.savePlan(items)
    expect(fs.content(ABS_PLAN)).toBe(original)
    expect(original).toBe('workstream: WS-1\nordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]\n')

    // after mutations: exact bytes for the exact order
    store.moveItem('T-4', 0)
    const expected = ['T-4', 'G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'G-2']
    assertOrderEqual(store.loadPlan().items, expected, 'post-move')
    expect(fs.content(ABS_PLAN)).toBe(`workstream: WS-1\nordered_items: [${expected.join(', ')}]\n`)

    // and a YAML re-parse of those bytes gives the same order (round-trip)
    const reparsed = yamlParse(fs.content(ABS_PLAN)!) as { workstream: string; ordered_items: string[] }
    expect(reparsed.workstream).toBe(WS)
    assertOrderEqual(reparsed.ordered_items, expected, 'yaml round-trip')
  })

  it('空计划与定义文件序列化的字节稳定', () => {
    expect(serializePlan(WS, [])).toBe('workstream: WS-1\nordered_items: []\n')

    const fs = baseFs()
    const store = makeStore(fs)

    // WS-2 has no plan yet: saving an empty one is byte-stable too
    const store2 = makeStore(fs, WS2)
    store2.savePlan([])
    const empty1 = fs.content(absPlanFor(WS2))!
    store2.savePlan([])
    expect(fs.content(absPlanFor(WS2))).toBe(empty1)
    expect(empty1).toBe(`workstream: ${WS2}\nordered_items: []\n`)

    // definition files: the serializer is byte-stable for the same doc, the
    // on-disk bytes ARE that serialization, and a read-back round-trips every
    // field (epoch-ms included)
    const doc = taskDoc({
      id: 'T-30',
      goal: '多行目标\n含冒号: 与 #井号 & 特殊字符',
      deliverables: ['docs/x.md'],
      acceptance_criteria: ['AC-1', 'AC-2'],
      created_by: { kind: 'AGENT', run_id: 'R-3', label: 'agent' },
      created_at: T09,
      note: 'n:1',
    })
    const s1 = serializeTaskDoc(doc)
    expect(serializeTaskDoc({ ...doc })).toBe(s1)
    store.createItem('task', doc)
    const bytes1 = fs.content(absItem('tasks', 'T-30'))!
    expect(bytes1).toBe(s1)
    const reloaded = store.readItem('task', 'T-30')
    expect(reloaded.created_at).toBe(T09)
    expect(reloaded.title).toBe(doc.title)
    expect(reloaded.goal).toBe(doc.goal)
    expect(reloaded.created_by).toEqual({ kind: 'AGENT', run_id: 'R-3', label: 'agent' })
    // byte form: field-table order, ISO time, quoting where YAML needs it
    expect(bytes1).toBe(
      'id: T-30\n' +
        'workstream_id: WS-1\n' +
        'title: 新建任务\n' +
        'goal: |-\n  多行目标\n  含冒号: 与 #井号 & 特殊字符\n' +
        'deliverables:\n  - docs/x.md\n' +
        'acceptance_criteria:\n  - AC-1\n  - AC-2\n' +
        'created_by:\n  kind: AGENT\n  run_id: R-3\n  label: agent\n' +
        'created_at: 2026-08-21T09:00:00Z\n' +
        'note: n:1\n',
    )
    // milestone byte form (no references/AC fields; statement is the body)
    const m = milestoneDoc({ id: 'M-30' })
    expect(serializeMilestoneDoc(m)).toBe(
      'id: M-30\n' +
        'workstream_id: WS-1\n' +
        'title: 新状态\n' +
        'statement: 达成状态的明确陈述\n' +
        'created_by:\n  kind: USER\n  label: researcher\n' +
        'created_at: 2026-08-21T09:00:00Z\n',
    )
  })

  it('loader 互操作: loadResearchTree 以零错误读取 store 写入的字节, 顺序逐位一致', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.removeItem('T-2')
    store.moveItem('G-2', 1)
    const expected = store.loadPlan().items

    // the WP-1.1 loader over the SAME in-memory bytes (its real-fixture path)
    const files: Record<string, string> = {}
    for (const [p, c] of Object.entries(fs.snapshot())) {
      if (p.startsWith('/mem/ws/.research/')) files[p.slice('/mem/ws/.research/'.length)] = c
    }
    const { tree, errors } = load(files)
    expect(errors).toEqual([])
    const ws1 = tree.topics.find((t) => t.id === 'TPC-1')!.workstreams.find((w) => w.id === WS)!
    expect(ws1.plan).not.toBeNull()
    assertOrderEqual(ws1.plan!.ordered_items, expected, 'loader view')
  })
})
