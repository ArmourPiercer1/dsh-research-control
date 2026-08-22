/**
 * WP-1.3 — loadPlan 聚合错误形态 + 构造期失败（WORKSTREAM_MISSING / PATH_RULE /
 * SCHEMA_LOAD / READ）：
 *  - loadPlan: 缺失 = 非错误 (present:false)；聚合多错 (DUPLICATE_ID +
 *    DANGLING_REF + PATH_ID_MISMATCH) 且 items 逐位 verbatim；坏 YAML 各形态；
 *    reader 抛错 ⇒ READ；
 *  - 构造期: WS 目录缺失、topicId/wsId 非良构、冻结 schema 不可用、
 *    reader 对 WS 目录抛错。
 */
import { describe, expect, it } from 'vitest'

import { PlanStore, PlanStoreError } from '../../src/host/domain/plan/index.js'
import { realSchemaFiles } from '../loader/fixtures.js'
import {
  absItem,
  baseFs,
  itemRel,
  makeStore,
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
} from './fixtures.js'
import { MemoryFs } from './memory-fs.js'

const PLAN_REL = 'topics/TPC-1/workstreams/WS-1/plan.yaml'
const WS2_PLAN_REL = 'topics/TPC-1/workstreams/WS-2/plan.yaml'

function expectConstructionReject(fn: () => void, code: string, msgPart?: string): void {
  let threw: unknown = null
  try {
    fn()
  } catch (e) {
    threw = e
  }
  expect(threw, `expected PlanStoreError(${code})`).toBeInstanceOf(PlanStoreError)
  const err = threw as PlanStoreError
  expect(err.code, `code (message: ${err.message})`).toBe(code)
  if (msgPart !== undefined) expect(err.message).toContain(msgPart)
}

describe('loadPlan — plan.yaml 读取 (聚合错误, items 逐位 verbatim)', () => {
  it('base 树: 零错, 7 项逐位', () => {
    const fs = baseFs()
    const result = makeStore(fs).loadPlan()
    expect(result.present).toBe(true)
    expect(result.items).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
    expect(result.errors).toEqual([])
  })

  it('plan.yaml 缺失 = 非错误 (present:false, items:[])', () => {
    const fs = baseFs()
    const result = makeStore(fs, 'WS-2').loadPlan()
    expect(result).toEqual({ present: false, items: [], errors: [] })
  })

  it('聚合: 重复 + 悬空 + workstream 失配 — 精确定位, items 仍 verbatim', () => {
    const fs = baseFs()
    fs.addFile(`${MEM_RESEARCH_ROOT}/${PLAN_REL}`, 'workstream: WS-2\nordered_items: [G-1, T-1, T-1, T-99]\n')
    const result = makeStore(fs).loadPlan()
    expect(result.present).toBe(true)
    expect(result.items).toEqual(['G-1', 'T-1', 'T-1', 'T-99'])
    expect(result.errors.map((e) => [e.code, e.path])).toEqual([
      ['PATH_ID_MISMATCH', '/workstream'],
      ['DUPLICATE_ID', '/ordered_items/2'],
      ['DANGLING_REF', '/ordered_items/3'],
    ])
    expect(result.errors[0]!.message).toContain('"WS-2"')
    expect(result.errors[0]!.message).toContain('does not match containing workstream directory')
    expect(result.errors[1]!.message).toContain('first listed at position 1')
    expect(result.errors[2]!.message).toContain('has no definition file')
    expect(result.errors.every((e) => e.file === PLAN_REL)).toBe(true)
  })

  it('悬空定位: 跨 WS 的定义 → 指向本 WS 的应有路径', () => {
    const fs = baseFs()
    // T-50 只存在于 WS-2
    fs.addFile(
      absItem('tasks', 'T-50').replace('WS-1', 'WS-2'),
      'id: T-50\nworkstream_id: WS-2\ntitle: x\ngoal: y\ncreated_by: { kind: USER }\ncreated_at: 2026-08-21T09:00:00Z\n',
    )
    fs.addFile(`${MEM_RESEARCH_ROOT}/${PLAN_REL}`, 'workstream: WS-1\nordered_items: [T-50]\n')
    const result = makeStore(fs).loadPlan()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.code).toBe('DANGLING_REF')
    expect(result.errors[0]!.path).toBe('/ordered_items/0')
    expect(result.errors[0]!.message).toContain('has no definition file at')
    expect(result.errors[0]!.message).toContain('workstreams/WS-1/items/tasks/T-50.yaml')
  })

  it('悬空定位: 本 WS 定义文件损坏 → failed validation + 首因', () => {
    const fs = baseFs()
    fs.addFile(absItem('tasks', 'T-50'), 'id: T-50\nworkstream_id: WS-1\ntitle: x\ncreated_by: { kind: USER }\ncreated_at: 2026-08-21T09:00:00Z\n')
    fs.addFile(`${MEM_RESEARCH_ROOT}/${PLAN_REL}`, 'workstream: WS-1\nordered_items: [T-50]\n')
    const result = makeStore(fs).loadPlan()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.code).toBe('DANGLING_REF')
    expect(result.errors[0]!.message).toContain('failed validation')
    expect(result.errors[0]!.message).toContain('goal')
  })

  it('类型一致性 (冻结 schema, §4.4): 非 T/G/M 元素 → SCHEMA + pointer', () => {
    const fs = baseFs()
    fs.addFile(`${MEM_RESEARCH_ROOT}/${PLAN_REL}`, 'workstream: WS-1\nordered_items: [G-1, R-3]\n')
    const result = makeStore(fs).loadPlan()
    expect(result.items).toEqual([]) // schema 失败 ⇒ 不进入语义检查
    // anyOf 分支逐一报 pattern 错 + anyOf 汇总 (allErrors 聚合, WP-1.1 风格)
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors.every((e) => e.code === 'SCHEMA' && e.path === '/ordered_items/1')).toBe(true)
    expect(result.errors[0]!.message).toContain('does not match pattern')
  })

  it('坏 YAML 形态: 多文档 / 空文件 / tab / 顶层序列', () => {
    const broken: Record<string, string> = {
      'multi-doc': 'workstream: WS-1\n---\nworkstream: WS-1\n',
      'empty': '# nothing\n',
      'tab': 'workstream: WS-1\n\tordered_items: [G-1]\n',
      'sequence': '- G-1\n- T-1\n',
    }
    for (const [name, text] of Object.entries(broken)) {
      const fs = baseFs()
      fs.addFile(`${MEM_RESEARCH_ROOT}/${PLAN_REL}`, text)
      const result = makeStore(fs).loadPlan()
      expect(result.present, name).toBe(true)
      expect(result.items, name).toEqual([])
      expect(result.errors.length, name).toBeGreaterThanOrEqual(1)
      const code = result.errors[0]!.code
      if (name === 'sequence') expect(code).toBe('SCHEMA')
      else expect(code, name).toBe('PARSE')
      expect(result.errors[0]!.file, name).toBe(PLAN_REL)
    }
  })

  it('reader 抛错 ⇒ READ (loadPlan 聚合 / 构造期 throw)', () => {
    const fs = baseFs()
    fs.failRead(`${MEM_RESEARCH_ROOT}/${PLAN_REL}`)
    const result = makeStore(fs).loadPlan()
    expect(result).toEqual({ present: false, items: [], errors: [expect.anything()] })
    expect(result.errors[0]!.code).toBe('READ')
    expect(result.errors[0]!.file).toBe(PLAN_REL)
    expect(result.errors[0]!.message).toContain('injected read failure')
  })
})

describe('构造期失败 (fail loud)', () => {
  it('WORKSTREAM_MISSING: WS 目录不存在 (schema 齐备时)', () => {
    const fs = baseFs()
    expectConstructionReject(
      () => new PlanStore({
        reader: fs, writer: fs, researchRoot: MEM_RESEARCH_ROOT, schemaDir: MEM_SCHEMA_DIR,
        topicId: 'TPC-1', wsId: 'WS-9',
      }),
      'WORKSTREAM_MISSING',
      'does not exist',
    )
    // 只有 schema、没有任何 .research 文件
    expectConstructionReject(
      () => makeStore(new MemoryFs(realSchemaFiles()), 'WS-1'),
      'WORKSTREAM_MISSING',
    )
  })

  it('PATH_RULE: topicId/wsId 非良构 id (§14 布局)', () => {
    const fs = baseFs()
    expectConstructionReject(
      () => makeStore(fs, 'ws-1'),
      'PATH_RULE',
      'not a well-formed WS id',
    )
    expectConstructionReject(
      () => makeStore(fs, 'T-1'),
      'PATH_RULE',
      'not a well-formed WS id',
    )
    expectConstructionReject(
      () => makeStore(fs, 'WS-1', 'tpc-1'),
      'PATH_RULE',
      'not a well-formed TPC id',
    )
  })

  it('SCHEMA_LOAD: 冻结 schema 不可用 (缺文件 / 缺 common)', () => {
    // 空 fs: 一个 schema 文件都没有
    expectConstructionReject(
      () => new PlanStore({
        reader: baseFs(), writer: baseFs(), researchRoot: MEM_RESEARCH_ROOT,
        schemaDir: '/nowhere/schema/declarative',
        topicId: 'TPC-1', wsId: 'WS-1',
      }),
      'SCHEMA_LOAD',
      'frozen schema set unavailable',
    )

    // 只有 common, 没有 declarative 文件
    const fs = new MemoryFs({ [`${MEM_SCHEMA_DIR}/../common.schema.json`]: '{}' })
    // 需要 WS 目录存在以走到 schema 检查之后? 不 — schema 检查在目录检查之前
    expectConstructionReject(
      () => new PlanStore({
        reader: fs, writer: fs, researchRoot: MEM_RESEARCH_ROOT, schemaDir: MEM_SCHEMA_DIR,
        topicId: 'TPC-1', wsId: 'WS-1',
      }),
      'SCHEMA_LOAD',
      'missing validators',
    )
  })

  it('READ: reader 对 WS 目录抛错', () => {
    const fs = baseFs()
    fs.failReadDir(`${MEM_RESEARCH_ROOT}/topics/TPC-1/workstreams/WS-1`)
    expectConstructionReject(
      () => makeStore(fs),
      'READ',
      'injected read failure',
    )
  })
})

describe('store 路径 API (service 层接线用)', () => {
  it('wsPath/planPath/itemPath 返回 .research/ 相对 POSIX 路径', () => {
    const store = makeStore(baseFs())
    expect(store.wsPath()).toBe('topics/TPC-1/workstreams/WS-1')
    expect(store.planPath()).toBe(PLAN_REL)
    expect(store.itemPath('task', 'T-1')).toBe(itemRel('tasks', 'T-1'))
    expect(store.itemPath('gate', 'G-1')).toBe('topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml')
    expect(store.itemPath('milestone', 'M-1')).toBe('topics/TPC-1/workstreams/WS-1/items/milestones/M-1.yaml')
    const store2 = makeStore(baseFs(), 'WS-2')
    expect(store2.planPath()).toBe(WS2_PLAN_REL)
  })
})
