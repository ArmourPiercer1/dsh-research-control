/**
 * WP-1.3 — G/T/M 定义文件 CRUD (create/read/update)：
 *  - create: 文件名=id（shared/ids 一致性助手）、原子写、字节确定、
 *    校验拒绝形态（TYPE_MISMATCH / PATH_ID_MISMATCH / FILE_EXISTS / SCHEMA）;
 *  - read: 内存载体（epoch ms）、加载期校验拒绝形态（NOT_FOUND / PARSE /
 *    SCHEMA / PATH_ID_MISMATCH — 含手工篡改的文件名↔id 失配, §1.1 规则 3）;
 *  - update: 仅定义字段变更、不改 id（IMMUTABLE_FIELD）、派生字段拒绝
 *    （INV-PLAN-9/INV-TASK-2）、字段增删、字节稳定;
 *  - 原子写: 注入 writer 失败 ⇒ 无部分状态（旧内容保留 / 新文件不落盘）。
 */
import { describe, expect, it } from 'vitest'

import { PlanStoreError } from '../../src/host/domain/plan/index.js'
import {
  ABS_PLAN,
  absItem,
  baseFs,
  gateDoc,
  itemRel,
  makeStore,
  milestoneDoc,
  taskDoc,
  T09500,
  WS2,
} from './fixtures.js'

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

describe('createItem — 定义文件 create (文件名=id, 原子写)', () => {
  it('写入的字节 = 字段表顺序 + ISO 时间 + 创建后读回逐字段一致', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    const doc = taskDoc({
      id: 'T-20',
      title: '标定',
      goal: 'goal-20',
      deliverables: ['d1'],
      acceptance_criteria: ['ac1'],
      created_at: T09500,
      note: undefined,
    })
    store.createItem('task', doc)
    const rel = itemRel('tasks', 'T-20')
    const bytes = fs.content(absItem('tasks', 'T-20'))!
    // 文件名 = id（§1.1 规则 2/3）
    expect(rel).toBe('topics/TPC-1/workstreams/WS-1/items/tasks/T-20.yaml')
    // 非整秒时间保留 .500Z（§1.2 载体）
    expect(bytes).toContain('created_at: 2026-08-21T09:00:00.500Z')
    expect(bytes).not.toContain('note:')
    // 读回：内存载体 epoch ms + 默认物化后的全字段
    const back = store.readItem('task', 'T-20')
    expect(back).toEqual({
      id: 'T-20',
      workstream_id: 'WS-1',
      title: '标定',
      goal: 'goal-20',
      deliverables: ['d1'],
      acceptance_criteria: ['ac1'],
      created_by: { kind: 'USER', label: 'researcher' },
      created_at: T09500,
    })
  })

  it('gate/milestone create + 各自字节形态', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.createItem('gate', gateDoc({ id: 'G-20', criteria: '准则' }))
    store.createItem('milestone', milestoneDoc({ id: 'M-20', statement: '陈述' }))
    expect(fs.content(absItem('gates', 'G-20'))).toBe(
      'id: G-20\n' +
        'workstream_id: WS-1\n' +
        'title: 新建评审\n' +
        'criteria: 准则\n' +
        'references: []\n' +
        'created_by:\n  kind: USER\n  label: researcher\n' +
        'created_at: 2026-08-21T09:00:00Z\n',
    )
    expect(fs.content(absItem('milestones', 'M-20'))).toBe(
      'id: M-20\n' +
        'workstream_id: WS-1\n' +
        'title: 新状态\n' +
        'statement: 陈述\n' +
        'created_by:\n  kind: USER\n  label: researcher\n' +
        'created_at: 2026-08-21T09:00:00Z\n',
    )
    expect(store.readItem('gate', 'G-20').criteria).toBe('准则')
    expect(store.readItem('milestone', 'M-20').statement).toBe('陈述')
  })

  it('拒绝: FILE_EXISTS (不覆盖, §1.1 规则 3) — 且零写入', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.createItem('task', taskDoc({ id: 'T-1', title: 'overwrite attempt' })),
      'FILE_EXISTS',
      itemRel('tasks', 'T-1'),
      undefined,
      'already exists',
    )
    expect(fs.writes).toEqual([])
    // 原文件逐字节未动
    expect(fs.content(absItem('tasks', 'T-1'))).toContain('title: 标定数据采集方案对比')
  })

  it('拒绝: TYPE_MISMATCH (id 前缀/kind 不符, 类型一致性)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.createItem('gate', gateDoc({ id: 'T-5' })),
      'TYPE_MISMATCH',
      itemRel('gates', 'T-5'),
      '/id',
      'not a GATE id',
    )
    expectReject(
      () => store.createItem('task', taskDoc({ id: 'M-5' })),
      'TYPE_MISMATCH',
      itemRel('tasks', 'M-5'),
      '/id',
      'not a TASK id',
    )
    expectReject(
      () => store.createItem('task', taskDoc({ id: 'garbage' })),
      'TYPE_MISMATCH',
      itemRel('tasks', 'garbage'),
      '/id',
      'not a well-formed research id',
    )
    expect(fs.writes).toEqual([])
  })

  it('拒绝: PATH_ID_MISMATCH (workstream_id 与所在目录不符)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.createItem('task', taskDoc({ id: 'T-21', workstream_id: WS2 })),
      'PATH_ID_MISMATCH',
      itemRel('tasks', 'T-21'),
      '/workstream_id',
      'does not match containing workstream directory',
    )
    expect(fs.writes).toEqual([])
  })

  it('拒绝: SCHEMA (冻结 schema 逐字段, 精确定位)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.createItem('task', taskDoc({ id: 'T-22', title: 'x'.repeat(201) })),
      'SCHEMA',
      itemRel('tasks', 'T-22'),
      '/title',
      'more than 200 characters',
    )
    expectReject(
      () => store.createItem('task', taskDoc({ id: 'T-22', goal: '' })),
      'SCHEMA',
      itemRel('tasks', 'T-22'),
      '/goal',
      'fewer than 1 characters',
    )
    expectReject(
      () => store.createItem('gate', gateDoc({ id: 'G-21', criteria: '' })),
      'SCHEMA',
      itemRel('gates', 'G-21'),
      '/criteria',
      'fewer than 1 characters',
    )
    expectReject(
      () =>
        store.createItem('task', taskDoc({ id: 'T-22', created_by: { kind: 'HACKER' } as never })),
      'SCHEMA',
      itemRel('tasks', 'T-22'),
      '/created_by/kind',
      'not an allowed value',
    )
    expectReject(
      () => store.createItem('task', taskDoc({ id: 'T-22', created_at: Number.NaN })),
      'SCHEMA',
      itemRel('tasks', 'T-22'),
      '/created_at',
      'date-time',
    )
    expect(fs.writes).toEqual([])
  })
})

describe('readItem — 定义文件 read (加载期校验, §1.1 规则 3)', () => {
  it('读回 base 树定义: 字节形态逐位 + epoch ms 转换 (§1.2)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    const t1 = store.readItem('task', 'T-1')
    expect(t1.id).toBe('T-1')
    expect(t1.workstream_id).toBe('WS-1')
    expect(t1.title).toBe('标定数据采集方案对比')
    expect(t1.deliverables).toEqual(['docs/calibration-plan.md'])
    expect(t1.acceptance_criteria).toEqual(['三种候选方案均有实测重投影误差数据'])
    expect(t1.created_by).toEqual({ kind: 'USER', label: 'researcher' })
    expect(t1.created_at).toBe(Date.parse('2026-08-21T09:30:00Z'))
    expect(store.readItem('gate', 'G-1').criteria).toBe('标定数据集完整、标注规范且可复现')
    expect(store.readItem('milestone', 'M-1').statement).toContain('重投影误差 <2px')
  })

  it('拒绝: NOT_FOUND (文件缺失)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.readItem('task', 'T-99'),
      'NOT_FOUND',
      itemRel('tasks', 'T-99'),
      undefined,
      'no task definition file',
    )
  })

  it('拒绝: 手工篡改文件 — 文件名↔id 失配 (PATH_ID_MISMATCH, §1.1 规则 3)', () => {
    const fs = baseFs()
    // T-5.yaml 的文件内 id 被篡改为 T-6（文件名与 id 不一致）
    fs.addFile(absItem('tasks', 'T-5'), 'id: T-6\nworkstream_id: WS-1\ntitle: x\ngoal: y\ncreated_by: { kind: USER }\ncreated_at: 2026-08-21T09:00:00Z\n')
    const store = makeStore(fs)
    expectReject(
      () => store.readItem('task', 'T-5'),
      'PATH_ID_MISMATCH',
      itemRel('tasks', 'T-5'),
      undefined,
      'does not match file name',
    )
  })

  it('拒绝: 手工篡改文件 — workstream_id 失配 / 派生字段 / 坏 YAML', () => {
    const good = 'workstream_id: WS-1\ntitle: x\ngoal: y\ncreated_by: { kind: USER }\ncreated_at: 2026-08-21T09:00:00Z\n'
    // workstream_id 指向别的 WS
    let fs = baseFs()
    fs.addFile(absItem('tasks', 'T-5'), `id: T-5\nworkstream_id: WS-2\ntitle: x\ngoal: y\ncreated_by: { kind: USER }\ncreated_at: 2026-08-21T09:00:00Z\n`)
    expectReject(
      () => makeStore(fs).readItem('task', 'T-5'),
      'PATH_ID_MISMATCH',
      itemRel('tasks', 'T-5'),
      '/workstream_id',
      'does not match containing workstream directory',
    )

    // 定义文件被塞入派生/运行时字段 (INV-PLAN-9: 声明式内容 only)
    fs = baseFs()
    fs.addFile(absItem('tasks', 'T-5'), `id: T-5\n${good}execution: ACTIVE\n`)
    expectReject(
      () => makeStore(fs).readItem('task', 'T-5'),
      'SCHEMA',
      itemRel('tasks', 'T-5'),
      undefined,
      'execution',
    )

    // 坏 YAML（tab 缩进 → 解析错, 带行号）
    fs = baseFs()
    fs.addFile(absItem('tasks', 'T-5'), 'id: T-5\n\tworkstream_id: WS-1\n')
    expectReject(
      () => makeStore(fs).readItem('task', 'T-5'),
      'PARSE',
      itemRel('tasks', 'T-5'),
      undefined,
      'YAML:',
    )

    // 空文件 / 多文档 / 顶层序列
    fs = baseFs()
    fs.addFile(absItem('tasks', 'T-5'), '# only a comment\n')
    expectReject(() => makeStore(fs).readItem('task', 'T-5'), 'PARSE', itemRel('tasks', 'T-5'), undefined, 'empty or comment-only')
    fs = baseFs()
    fs.addFile(absItem('tasks', 'T-5'), 'id: T-5\n---\nid: T-6\n')
    expectReject(() => makeStore(fs).readItem('task', 'T-5'), 'PARSE', itemRel('tasks', 'T-5'), undefined, 'multiple YAML documents')
    fs = baseFs()
    fs.addFile(absItem('tasks', 'T-5'), '- T-5\n- T-6\n')
    expectReject(() => makeStore(fs).readItem('task', 'T-5'), 'SCHEMA', itemRel('tasks', 'T-5'), undefined, 'must be a mapping')
  })

  it('拒绝: READ (reader 抛错 ⇒ 精确定位到该文件)', () => {
    const fs = baseFs()
    fs.failRead(absItem('tasks', 'T-1'))
    const store = makeStore(fs)
    expectReject(() => store.readItem('task', 'T-1'), 'READ', itemRel('tasks', 'T-1'), undefined, 'injected read failure')
  })
})

describe('updateItem — 仅定义字段变更, 不改 id', () => {
  it('合法 patch: 字段更新, id/文件名/created_* 不变, 字节确定', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    const before = fs.content(absItem('tasks', 'T-1'))!
    store.updateItem('task', 'T-1', { title: '新标题', goal: '新目标', note: '临时备注' })
    const after = fs.content(absItem('tasks', 'T-1'))!
    expect(after).not.toBe(before)
    expect(after).toContain('id: T-1') // 文件名=id 未动
    expect(after).toContain('title: 新标题')
    expect(after).toContain('note: 临时备注')
    expect(after).toContain('created_at: 2026-08-21T09:30:00Z') // 未 patch ⇒ 逐字节保留
    // 同一 patch 再放一次（对当前状态）⇒ 字节不变（幂等且确定）
    store.updateItem('task', 'T-1', {})
    expect(fs.content(absItem('tasks', 'T-1'))).toBe(after)
    const reloaded = store.readItem('task', 'T-1')
    expect(reloaded.id).toBe('T-1')
    expect(reloaded.title).toBe('新标题')
    expect(reloaded.note).toBe('临时备注')
  })

  it('显式 undefined 删除可选字段 (note)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    store.updateItem('task', 'T-1', { note: 'to-remove' })
    expect(fs.content(absItem('tasks', 'T-1'))).toContain('note: to-remove')
    store.updateItem('task', 'T-1', { note: undefined })
    const after = fs.content(absItem('tasks', 'T-1'))!
    expect(after).not.toContain('note:')
  })

  it('拒绝: IMMUTABLE_FIELD (id / workstream_id 不可经 update 变更)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.updateItem('task', 'T-1', { id: 'T-9' }),
      'IMMUTABLE_FIELD',
      itemRel('tasks', 'T-1'),
      '/id',
      'immutable',
    )
    expectReject(
      () => store.updateItem('task', 'T-1', { workstream_id: WS2 }),
      'IMMUTABLE_FIELD',
      itemRel('tasks', 'T-1'),
      '/workstream_id',
      'path-bound',
    )
    expect(fs.writes).toEqual([])
    // 文件逐字节未动
    expect(fs.content(absItem('tasks', 'T-1'))).toContain('id: T-1')
  })

  it('拒绝: 派生/未知字段 (INV-PLAN-9/INV-TASK-2, additionalProperties)', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.updateItem('task', 'T-1', { execution: 'ACTIVE' } as never),
      'SCHEMA',
      itemRel('tasks', 'T-1'),
      '/execution',
      'not a definition field',
    )
    expectReject(
      () => store.updateItem('task', 'T-1', { validation: 'PASSED' } as never),
      'SCHEMA',
      itemRel('tasks', 'T-1'),
      '/validation',
      'not a definition field',
    )
    expectReject(
      () => store.updateItem('task', 'T-1', { typo_field: 1 } as never),
      'SCHEMA',
      itemRel('tasks', 'T-1'),
      '/typo_field',
      'not a definition field',
    )
    // kind 专属字段互不通用: gate 没有 deliverables
    expectReject(
      () => store.updateItem('gate', 'G-1', { deliverables: ['x'] } as never),
      'SCHEMA',
      itemRel('gates', 'G-1'),
      '/deliverables',
      'not a definition field',
    )
    expect(fs.writes).toEqual([])
  })

  it('拒绝: patch 值违反冻结 schema / id 非本 kind / 文件缺失', () => {
    const fs = baseFs()
    const store = makeStore(fs)
    expectReject(
      () => store.updateItem('task', 'T-1', { title: '' }),
      'SCHEMA',
      itemRel('tasks', 'T-1'),
      '/title',
      'fewer than 1 characters',
    )
    expectReject(
      () => store.updateItem('gate', 'T-1', { title: 'x' }),
      'TYPE_MISMATCH',
      itemRel('gates', 'T-1'),
      '/id',
      'not a GATE id',
    )
    expectReject(
      () => store.updateItem('task', 'T-99', { title: 'x' }),
      'NOT_FOUND',
      itemRel('tasks', 'T-99'),
      undefined,
      'no task definition file',
    )
    expect(fs.writes).toEqual([])
  })

  it('拒绝: 当前文件已损坏时不写 (首错抛出)', () => {
    const fs = baseFs()
    fs.addFile(absItem('tasks', 'T-1'), 'not: [valid yaml {')
    const store = makeStore(fs)
    expectReject(() => store.updateItem('task', 'T-1', { title: 'x' }), 'PARSE', itemRel('tasks', 'T-1'), undefined, 'YAML:')
    expect(fs.writes).toEqual([])
  })

  it('原子写: 注入 writer 失败 ⇒ 旧内容逐字节保留', () => {
    const fs = baseFs()
    const before = fs.content(absItem('tasks', 'T-1'))!
    fs.failNextWrite(1)
    const store = makeStore(fs)
    expectReject(() => store.updateItem('task', 'T-1', { title: 'x' }), 'WRITE', itemRel('tasks', 'T-1'), undefined, 'injected write failure')
    expect(fs.content(absItem('tasks', 'T-1'))).toBe(before)
  })

  it('create 原子写: 注入 writer 失败 ⇒ 文件不落盘', () => {
    const fs = baseFs()
    fs.failNextWrite(1)
    const store = makeStore(fs)
    expectReject(() => store.createItem('task', taskDoc({ id: 'T-40' })), 'WRITE', itemRel('tasks', 'T-40'), undefined, 'injected write failure')
    expect(fs.hasFile(absItem('tasks', 'T-40'))).toBe(false)
  })
})

describe('plan save 的原子性', () => {
  it('注入 writer 失败 ⇒ plan.yaml 旧内容逐字节保留, 零部分状态', () => {
    const fs = baseFs()
    const before = fs.content(ABS_PLAN)!
    fs.failNextWrite(1)
    const store = makeStore(fs)
    expectReject(
      () => store.savePlan(['G-1', 'T-1']),
      'WRITE',
      'topics/TPC-1/workstreams/WS-1/plan.yaml',
      undefined,
      'injected write failure',
    )
    expect(fs.content(ABS_PLAN)).toBe(before)
  })
})
