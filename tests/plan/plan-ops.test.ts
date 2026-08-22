/**
 * WP-1.3 — plan 变更操作 (insertItemAt / moveItem / removeItem / addItem)：
 *  - 位置边界 (BOUNDARY: 非整数 / 负 / 超界);
 *  - 重复 id (DUPLICATE_ID, 精确定位);
 *  - 类型一致性 (TYPE_MISMATCH: 非 T/G/M 或格式非法, §4.4 原文);
 *  - 定义文件存在 ∧ 属于本 WS (DANGLING_REF: 缺失 / 跨 WS / 定义损坏);
 *  - remove 仅从 plan.yaml 摘除, 定义文件保留 (INV-PLAN-9, 逐字节断言);
 *  - addItem = 创建定义文件 + 同时入列 (双原子写; 失败序的合法部分状态);
 *  - 不一致 plan 上的 mutation 拒绝 (no guess-repair, ARCHITECTURE §10)。
 */
import { describe, expect, it } from 'vitest'

import {
  ABS_PLAN,
  absItem,
  absPlanFor,
  baseFs,
  gateDoc,
  itemRel,
  makeStore,
  taskDoc,
} from './fixtures.js'
import { PlanStoreError } from '../../src/host/domain/plan/index.js'

const PLAN_REL = 'topics/TPC-1/workstreams/WS-1/plan.yaml'

function expectReject(fn: () => void, code: string, file: string, path?: string, msgPart?: string): void {
  let threw: unknown = null
  try {
    fn()
  } catch (e) {
    threw = e
  }
  expect(threw, `expected PlanStoreError(${code})`).toBeInstanceOf(PlanStoreError)
  const err = threw as PlanStoreError
  expect(err.code, `code (message: ${err.message})`).toBe(code)
  expect(err.file).toBe(file)
  if (path !== undefined) expect(err.path).toBe(path)
  if (msgPart !== undefined) expect(err.message).toContain(msgPart)
}

describe('insertItemAt — 入列已有定义', () => {
  it('重复入列拒绝: DUPLICATE_ID (定位到已列位置)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.insertItemAt('T-1', 0),
      'DUPLICATE_ID',
      PLAN_REL,
      '/ordered_items/1',
      'already listed at position 1',
    )
    expect(fs.writes).toEqual([])
  })

  it('拒绝: BOUNDARY (负 / 超界 / 非整数)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.removeItem('M-1') // 6 项
    const w0 = fs.writes.length
    expectReject(() => store.insertItemAt('M-1', -1), 'BOUNDARY', PLAN_REL, '/ordered_items', 'out of range')
    expectReject(() => store.insertItemAt('M-1', 7), 'BOUNDARY', PLAN_REL, '/ordered_items', 'out of range')
    expectReject(() => store.insertItemAt('M-1', 2.5), 'BOUNDARY', PLAN_REL, '/ordered_items', 'position 2.5 out of range')
    expect(fs.writes.length).toBe(w0) // 拒绝全部发生在写入前
    // 边界值本身合法: 0 与 length
    store.insertItemAt('M-1', 6)
    expect(store.loadPlan().items[6]).toBe('M-1')
    store.removeItem('M-1')
    store.insertItemAt('M-1', 0)
    expect(store.loadPlan().items[0]).toBe('M-1')
  })

  it('拒绝: TYPE_MISMATCH (非 T/G/M 前缀 / 非法 id, §4.4 类型一致性)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(() => store.insertItemAt('R-3', 0), 'TYPE_MISMATCH', PLAN_REL, '/ordered_items', 'not a plan item kind')
    expectReject(() => store.insertItemAt('TE-2', 0), 'TYPE_MISMATCH', PLAN_REL, '/ordered_items', 'not a plan item kind')
    expectReject(() => store.insertItemAt('garbage', 0), 'TYPE_MISMATCH', PLAN_REL, '/ordered_items', 'not a well-formed research id')
    expect(fs.writes).toEqual([])
  })

  it('拒绝: DANGLING_REF (定义缺失 / 跨 WS / 本 WS 定义损坏)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    // 本 WS 无定义文件
    expectReject(
      () => store.insertItemAt('T-99', 0),
      'DANGLING_REF',
      PLAN_REL,
      '/ordered_items/0',
      'has no definition file',
    )
    // 定义在别的 WS (WS-2 有 T-50)
    fs.addFile(absItem('tasks', 'T-50').replace('WS-1', 'WS-2'), 'id: T-50\nworkstream_id: WS-2\ntitle: x\ngoal: y\ncreated_by: { kind: USER }\ncreated_at: 2026-08-21T09:00:00Z\n')
    expectReject(
      () => store.insertItemAt('T-50', 0),
      'DANGLING_REF',
      PLAN_REL,
      '/ordered_items/0',
      'has no definition file at',
    )
    // 本 WS 定义文件存在但校验失败 (缺 goal)
    fs.addFile(absItem('tasks', 'T-51'), 'id: T-51\nworkstream_id: WS-1\ntitle: x\ncreated_by: { kind: USER }\ncreated_at: 2026-08-21T09:00:00Z\n')
    expectReject(
      () => store.insertItemAt('T-51', 0),
      'DANGLING_REF',
      PLAN_REL,
      '/ordered_items/0',
      'failed validation',
    )
    expect(fs.writes.filter((w) => w.ok)).toEqual([])
  })

  it('头/中/尾插入 (干净序列)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.removeItem('M-1')
    store.insertItemAt('M-1', 3)
    expect(store.loadPlan().items).toEqual(['G-1', 'T-1', 'T-2', 'M-1', 'T-3', 'T-4', 'G-2'])
    store.removeItem('M-1')
    store.insertItemAt('M-1', 0)
    expect(store.loadPlan().items[0]).toBe('M-1')
    store.removeItem('M-1')
    store.insertItemAt('M-1', 6)
    expect(store.loadPlan().items[6]).toBe('M-1')
    expect(store.loadPlan().items).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'T-4', 'G-2', 'M-1'])
  })
})

describe('moveItem — 重排', () => {
  it('首→尾 / 尾→首 / 中段移动, 其余项相对顺序不变', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.moveItem('G-1', 6) // [T-1, T-2, T-3, M-1, T-4, G-2, G-1]
    expect(store.loadPlan().items).toEqual(['T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2', 'G-1'])
    store.moveItem('G-1', 0) // [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
    expect(store.loadPlan().items).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
    store.moveItem('T-3', 1) // [G-1, T-3, T-1, T-2, M-1, T-4, G-2]
    expect(store.loadPlan().items).toEqual(['G-1', 'T-3', 'T-1', 'T-2', 'M-1', 'T-4', 'G-2'])
    store.moveItem('T-4', 2) // [G-1, T-3, T-4, T-1, T-2, M-1, G-2]
    expect(store.loadPlan().items).toEqual(['G-1', 'T-3', 'T-4', 'T-1', 'T-2', 'M-1', 'G-2'])
  })

  it('单元素计划: moveItem(id, 0) 是 no-op 且字节不变', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.savePlan(['T-1'])
    const before = fs.content(ABS_PLAN)!
    store.moveItem('T-1', 0)
    expect(fs.content(ABS_PLAN)).toBe(before)
    expect(store.loadPlan().items).toEqual(['T-1'])
  })

  it('拒绝: NOT_FOUND (未列) / BOUNDARY (目标越界)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.removeItem('M-1') // 6 项
    const w0 = fs.writes.length
    expectReject(() => store.moveItem('M-1', 0), 'NOT_FOUND', PLAN_REL, '/ordered_items', 'not listed')
    expectReject(() => store.moveItem('G-1', 6), 'BOUNDARY', PLAN_REL, '/ordered_items', 'out of range')
    expectReject(() => store.moveItem('G-1', -1), 'BOUNDARY', PLAN_REL, '/ordered_items', 'out of range')
    expectReject(() => store.moveItem('G-1', 2.5), 'BOUNDARY', PLAN_REL, '/ordered_items', 'target position out of range')
    expect(fs.writes.length).toBe(w0)
    // 合法边界: toIndex = length-1 (移到最尾)
    store.moveItem('G-1', 5)
    expect(store.loadPlan().items[5]).toBe('G-1')
  })
})

describe('removeItem — 仅摘 plan.yaml, 定义文件保留 (INV-PLAN-9)', () => {
  it('摘除后: plan 少该项, 定义文件逐字节保留, 可再次入列', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    const defBefore = fs.content(absItem('tasks', 'T-2'))!
    const planBefore = fs.content(ABS_PLAN)!
    store.removeItem('T-2')
    const planAfter = fs.content(ABS_PLAN)!
    expect(planAfter).not.toBe(planBefore)
    expect(planAfter).toBe('workstream: WS-1\nordered_items: [G-1, T-1, T-3, M-1, T-4, G-2]\n')
    // INV-PLAN-9: 定义文件长期保留 — 逐字节未动
    expect(fs.content(absItem('tasks', 'T-2'))).toBe(defBefore)
    // 离开计划后再入列: 无需重建定义
    store.insertItemAt('T-2', 1)
    expect(store.loadPlan().items).toEqual(['G-1', 'T-2', 'T-1', 'T-3', 'M-1', 'T-4', 'G-2'])
  })

  it('重复摘除: 第二次 NOT_FOUND', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.removeItem('G-2')
    expectReject(() => store.removeItem('G-2'), 'NOT_FOUND', PLAN_REL, '/ordered_items', 'not listed')
    expect(fs.content(absItem('gates', 'G-2'))).not.toBeNull()
  })

  it('拒绝: NOT_FOUND (未列)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(() => store.removeItem('T-99'), 'NOT_FOUND', PLAN_REL, '/ordered_items', 'not listed')
    expect(fs.writes).toEqual([])
  })
})

describe('addItem — 创建定义文件 + 同时入列', () => {
  it('默认追加到尾部: 两文件都被原子写入, 顺序精确', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.addItem('task', taskDoc({ id: 'T-50', title: '新任务' }))
    expect(fs.hasFile(absItem('tasks', 'T-50'))).toBe(true)
    const items = store.loadPlan().items
    expect(items[items.length - 1]).toBe('T-50')
    expect(items.length).toBe(8)
    // 两次成功写入: 定义文件, 然后 plan.yaml
    const paths = fs.writes.map((w) => [w.path, w.ok])
    expect(paths).toContainEqual([absItem('tasks', 'T-50'), true])
    expect(paths[paths.length - 1]).toEqual([ABS_PLAN, true])
    const defIdx = paths.findIndex((p) => p[0] === absItem('tasks', 'T-50'))
    expect(paths[defIdx + 1]).toEqual([ABS_PLAN, true]) // 先定义后计划
  })

  it('指定 index 插入', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.addItem('gate', gateDoc({ id: 'G-50' }), 2)
    expect(store.loadPlan().items).toEqual(['G-1', 'T-1', 'G-50', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
    store.addItem('milestone', { id: 'M-50', workstream_id: 'WS-1', title: 'ms', statement: 'st', created_by: { kind: 'USER' }, created_at: Date.parse('2026-08-21T10:00:00Z') }, 0)
    expect(store.loadPlan().items[0]).toBe('M-50')
  })

  it('拒绝: FILE_EXISTS (定义已存在, 不论是否入列)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.addItem('task', taskDoc({ id: 'T-1' })),
      'FILE_EXISTS',
      itemRel('tasks', 'T-1'),
      undefined,
      'already exists',
    )
    // 定义存在但未入列: 先 remove 再 addItem 同 id
    store.removeItem('T-2')
    const w1 = fs.writes.length
    expectReject(
      () => store.addItem('task', taskDoc({ id: 'T-2' })),
      'FILE_EXISTS',
      itemRel('tasks', 'T-2'),
      undefined,
      'already exists',
    )
    expect(fs.writes.length).toBe(w1)
  })

  it('拒绝: BOUNDARY / TYPE_MISMATCH / SCHEMA (全部在写入前)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(() => store.addItem('task', taskDoc({ id: 'T-51' }), 8), 'BOUNDARY', PLAN_REL, '/ordered_items', 'out of range')
    expectReject(() => store.addItem('task', taskDoc({ id: 'T-51' }), -1), 'BOUNDARY', PLAN_REL, '/ordered_items', 'out of range')
    expectReject(
      () => store.addItem('gate', gateDoc({ id: 'T-52' })),
      'TYPE_MISMATCH',
      itemRel('gates', 'T-52'),
      '/id',
      'not a GATE id',
    )
    expectReject(
      () => store.addItem('task', taskDoc({ id: 'T-53', goal: '' })),
      'SCHEMA',
      itemRel('tasks', 'T-53'),
      '/goal',
      'fewer than 1 characters',
    )
    expect(fs.writes).toEqual([])
    expect(fs.hasFile(absItem('tasks', 'T-51'))).toBe(false)
  })

  it('失败序: 定义已写、plan 写失败 ⇒ 合法部分状态 (定义保留, plan 不变)', () => {
    const fs = baseFs()
    const planBefore = fs.content(ABS_PLAN)!
    fs.failWriteAt(2) // 第二次写 (plan.yaml) 失败; 第一次 (定义文件) 成功
    const store = makeStore(fs)
    expectReject(
      () => store.addItem('task', taskDoc({ id: 'T-60' })),
      'WRITE',
      PLAN_REL,
      undefined,
      'injected write failure',
    )
    // INV-PLAN-9 安全序: 未入列的定义文件是合法状态 — 保留
    expect(fs.hasFile(absItem('tasks', 'T-60'))).toBe(true)
    expect(fs.content(ABS_PLAN)).toBe(planBefore)
    // 修复后重试: 同 id 会 FILE_EXISTS (定义已存在) — 幂等路径由 service 层处理
    expectReject(
      () => store.addItem('task', taskDoc({ id: 'T-60' })),
      'FILE_EXISTS',
      itemRel('tasks', 'T-60'),
    )
  })

  it('失败序: 定义写即失败 ⇒ 零落盘', () => {
    const fs = baseFs()
    fs.failNextWrite(1)
    const store = makeStore(fs)
    expectReject(
      () => store.addItem('task', taskDoc({ id: 'T-61' })),
      'WRITE',
      itemRel('tasks', 'T-61'),
      undefined,
      'injected write failure',
    )
    expect(fs.hasFile(absItem('tasks', 'T-61'))).toBe(false)
    expect(store.loadPlan().items.length).toBe(7)
  })

  it('WS-2 空计划: addItem 创建 plan.yaml (首个 item 在位置 0)', () => {
    const fs = baseFs()
    const store2 = makeStore(fs, 'WS-2')
    expect(store2.loadPlan()).toEqual({ present: false, items: [], errors: [] })
    store2.addItem('task', taskDoc({ id: 'T-70', workstream_id: 'WS-2' }))
    expect(store2.loadPlan().items).toEqual(['T-70'])
    expect(fs.content(absPlanFor('WS-2'))).toBe('workstream: WS-2\nordered_items: [T-70]\n')
  })
})

describe('savePlan 直接语义 + 不一致 plan 的拒绝', () => {
  it('savePlan: 重复 / 非 T/G/M / 悬空 / 空列表', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.savePlan(['G-1', 'T-1', 'G-1']),
      'DUPLICATE_ID',
      PLAN_REL,
      '/ordered_items/2',
      'first listed at position 0',
    )
    expectReject(
      () => store.savePlan(['R-1']),
      'SCHEMA',
      PLAN_REL,
      '/ordered_items/0',
      'does not match pattern',
    )
    expectReject(
      () => store.savePlan(['T-99']),
      'DANGLING_REF',
      PLAN_REL,
      '/ordered_items/0',
      'has no definition file',
    )
    store.savePlan([])
    expect(fs.content(ABS_PLAN)).toBe('workstream: WS-1\nordered_items: []\n')
  })

  it('不一致 plan.yaml 上的 mutation: 首错拒绝, 零写入 (no guess-repair)', () => {
    const fs = baseFs()
    // 手工破坏: 重复 + 悬空
    fs.addFile(ABS_PLAN, 'workstream: WS-1\nordered_items: [G-1, T-1, T-1, T-99]\n')
    const store = makeStore(fs)
    const load = store.loadPlan()
    expect(load.present).toBe(true)
    expect(load.items).toEqual(['G-1', 'T-1', 'T-1', 'T-99']) // verbatim
    const codes = load.errors.map((e) => e.code)
    expect(codes).toEqual(['DUPLICATE_ID', 'DANGLING_REF'])
    expect(load.errors[0]!.path).toBe('/ordered_items/2')
    expect(load.errors[1]!.path).toBe('/ordered_items/3')
    // 高层 mutation (insert/move/remove/addItem) 经 currentItems() 继承「首错拒绝」
    const w0 = fs.writes.length
    expectReject(() => store.insertItemAt('M-1', 0), 'DUPLICATE_ID', PLAN_REL, '/ordered_items/2')
    expectReject(() => store.moveItem('G-1', 0), 'DUPLICATE_ID', PLAN_REL, '/ordered_items/2')
    expectReject(() => store.removeItem('G-1'), 'DUPLICATE_ID', PLAN_REL, '/ordered_items/2')
    expect(fs.writes.length).toBe(w0) // 零写入 (no guess-repair)
    // savePlan 是低层原语: 校验的是传入的新列表 (而非当前文件的一致性) —
    // 显式写入新的合法状态是合法的 (service 层负责传入一致列表)
    store.savePlan(['G-1'])
    expect(fs.writes.length).toBe(w0 + 1)
    expect(fs.content(ABS_PLAN)).toBe('workstream: WS-1\nordered_items: [G-1]\n')
  })
})
