/**
 * WP-1.1 — TC-DOM-027 全形态 (TEST_MATRIX §3.1):
 * "路径/id 不匹配、悬空引用、schema 违规 → 精确报错定位，其余文件正常加载".
 *
 * Every case asserts: (1) the precise error (code + file + in-doc path +
 * summary), (2) the failing file is ABSENT from the tree, (3) unrelated valid
 * files still load (aggregation — ARCHITECTURE §10, one broken file never
 * blocks the rest).
 */
import { describe, expect, it } from 'vitest'

import type { ResearchFileReader, ResearchLoadError } from '../../src/host/domain/loader/index.js'
import { loadResearchTree } from '../../src/host/domain/loader/index.js'
import {
  APPENDIX_A_PLAN_YAML,
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  OBJECTIVES_YAML,
  T2_YAML,
  T3_YAML,
  TOPOLOGY_YAML,
  TOPIC_YAML,
  baseTreeFiles,
  load,
  makeReader,
  mutate,
} from './fixtures.js'

/** Assert exactly one error total with the given code/file. */
function expectSingleError(result: { errors: ResearchLoadError[] }, code: string, file: string): ResearchLoadError {
  expect(result.errors, `errors: ${result.errors.map((e) => `[${e.code}] ${e.file} ${e.message}`).join(' | ')}`).toHaveLength(1)
  const e = result.errors[0]!
  expect(e.code).toBe(code)
  expect(e.file).toBe(file)
  return e
}

const WS1_ITEMS = 'topics/TPC-1/workstreams/WS-1/items'
const WS1_DIR = 'topics/TPC-1/workstreams/WS-1'

describe('TC-DOM-027 — 路径/id 不匹配 (path-id cross-checks)', () => {
  it('topic.yaml id != directory name → PATH_ID_MISMATCH; rest of tree loads', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/topic.yaml': TOPIC_YAML.replace('id: TPC-1', 'id: TPC-2'),
    }))
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', 'topics/TPC-1/topic.yaml')
    expect(e.message).toContain('"TPC-2"')
    expect(e.message).toContain('"TPC-1"')
    expect(result.tree.topics[0]!.doc).toBeNull()
    // 其余文件正常加载
    expect(result.tree.topics[0]!.workstreams[0]!.doc!.id).toBe('WS-1')
    expect(result.tree.topics[0].topology!.topology.edges.map((x) => x.id)).toEqual(['TE-1', 'TE-2'])
    expect(result.tree.project!.id).toBe('PRJ-1')
  })

  it('workstream.yaml id != directory name → PATH_ID_MISMATCH', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/workstreams/WS-2/workstream.yaml': 'id: WS-9\ntopic_id: TPC-1\ntitle: 独立标定管线\ncreated_at: 2026-08-21T09:12:00Z\n',
    }))
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', 'topics/TPC-1/workstreams/WS-2/workstream.yaml')
    expect(e.message).toContain('"WS-9"')
    expect(e.message).toContain('"WS-2"')
    expect(result.tree.topics[0]!.workstreams[1]!.doc).toBeNull()
    // TE-1 still resolves its outputs to the WS-2 DIRECTORY (structural membership)
    expect(result.tree.topics[0].topology!.topology.edges[0]!.outputs).toEqual(['WS-2'])
  })

  it('workstream.yaml topic_id != containing topic dir → PATH_ID_MISMATCH (INV-STRUCT-1)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/workstreams/WS-2/workstream.yaml': 'id: WS-2\ntopic_id: TPC-2\ntitle: 独立标定管线\ncreated_at: 2026-08-21T09:12:00Z\n',
    }))
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', 'topics/TPC-1/workstreams/WS-2/workstream.yaml')
    expect(e.path).toBe('/topic_id')
    expect(e.message).toContain('INV-STRUCT-1')
    expect(result.tree.topics[0]!.workstreams[1]!.doc).toBeNull()
  })

  it('plan.yaml workstream != containing workstream dir → PATH_ID_MISMATCH (§4.4)', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_DIR}/plan.yaml`]: APPENDIX_A_PLAN_YAML.replace('workstream: WS-1', 'workstream: WS-2'),
    }))
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', `${WS1_DIR}/plan.yaml`)
    expect(e.path).toBe('/workstream')
    expect(result.tree.topics[0]!.workstreams[0]!.plan).toBeNull()
  })

  it('task file id != file name → PATH_ID_MISMATCH (§4.1)', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-9.yaml`]: T2_YAML.replace('id: T-2', 'id: T-3'),
    }))
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', `${WS1_ITEMS}/tasks/T-9.yaml`)
    expect(e.message).toContain('"T-3"')
    expect(e.message).toContain('"T-9.yaml"')
    // T-9 not referenced by the plan → no cascade; existing items intact
    const ws1 = result.tree.topics[0]!.workstreams[0]!
    expect(ws1.tasks.map((n) => n.id)).toEqual(['T-1', 'T-2', 'T-3', 'T-4', 'T-9'])
    expect(ws1.tasks.find((n) => n.id === 'T-9')!.doc).toBeNull()
    expect(ws1.tasks.find((n) => n.id === 'T-2')!.doc).not.toBeNull()
  })

  it('task workstream_id != containing workstream dir → PATH_ID_MISMATCH (§4.1)', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-9.yaml`]: T2_YAML.replace('id: T-2', 'id: T-9').replace('workstream_id: WS-1', 'workstream_id: WS-2'),
    }))
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', `${WS1_ITEMS}/tasks/T-9.yaml`)
    expect(e.path).toBe('/workstream_id')
    expect(result.tree.topics[0]!.workstreams[0]!.tasks.find((n) => n.id === 'T-9')!.doc).toBeNull()
  })

  it('topology.topic_id != containing topic dir → PATH_ID_MISMATCH (§3.1)', () => {
    // decoupled: no origin refs / contract, so rejecting the topology cannot cascade
    const result = load(
      mutate(baseTreeFiles(), {
        'topics/TPC-1/topology.yaml': TOPOLOGY_YAML.replace('  topic_id: TPC-1', '  topic_id: TPC-9'),
        'topics/TPC-1/workstreams/WS-2/workstream.yaml': 'id: WS-2\ntopic_id: TPC-1\ntitle: 独立标定管线\ncreated_at: 2026-08-21T09:12:00Z\n',
        'topics/TPC-1/workstreams/WS-3/workstream.yaml': 'id: WS-3\ntopic_id: TPC-1\ntitle: 合并后管线\ncreated_at: 2026-08-21T09:14:00Z\n',
        'merges/TE-2/contract.md': null,
      }),
    )
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', 'topics/TPC-1/topology.yaml')
    expect(e.path).toBe('/topology/topic_id')
    expect(result.tree.topics[0]!.topology).toBeNull()
  })

  it('topology edge topic_id != containing topic dir → PATH_ID_MISMATCH with edge index', () => {
    const result = load(
      mutate(baseTreeFiles(), {
        'topics/TPC-1/topology.yaml': `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [WS-1]
      outputs: [WS-2]
    - id: TE-2
      topic_id: TPC-9
      operation: MERGE
      lifecycle: PLANNED
      inputs: [WS-1, WS-2]
      outputs: [WS-3]
`,
        'topics/TPC-1/workstreams/WS-2/workstream.yaml': 'id: WS-2\ntopic_id: TPC-1\ntitle: 独立标定管线\ncreated_at: 2026-08-21T09:12:00Z\n',
        'topics/TPC-1/workstreams/WS-3/workstream.yaml': 'id: WS-3\ntopic_id: TPC-1\ntitle: 合并后管线\ncreated_at: 2026-08-21T09:14:00Z\n',
        'merges/TE-2/contract.md': null,
      }),
    )
    const e = expectSingleError(result, 'PATH_ID_MISMATCH', 'topics/TPC-1/topology.yaml')
    expect(e.path).toBe('/topology/edges/1/topic_id')
    expect(result.tree.topics[0]!.topology).toBeNull()
  })
})

describe('TC-DOM-027 — 悬空引用 (dangling references, §16.1)', () => {
  it('plan.ordered_items → missing definition file → DANGLING_REF at array index', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_DIR}/plan.yaml`]: 'workstream: WS-1\nordered_items: [G-1, T-1, T-99]\n',
    }))
    const e = expectSingleError(result, 'DANGLING_REF', `${WS1_DIR}/plan.yaml`)
    expect(e.path).toBe('/ordered_items/2')
    expect(e.message).toContain('"T-99"')
    expect(result.tree.topics[0]!.workstreams[0]!.plan).toBeNull()
    // other items + files still load
    const ws1 = result.tree.topics[0]!.workstreams[0]!
    expect(ws1.tasks.find((n) => n.id === 'T-1')!.doc).not.toBeNull()
    expect(result.tree.project).not.toBeNull()
  })

  it('plan.ordered_items → item defined in ANOTHER workstream → DANGLING_REF (WS ownership)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/workstreams/WS-2/items/tasks/T-5.yaml': T2_YAML.replace('id: T-2', 'id: T-5').replace('workstream_id: WS-1', 'workstream_id: WS-2'),
      [`${WS1_DIR}/plan.yaml`]: 'workstream: WS-1\nordered_items: [G-1, T-1, T-5]\n',
    }))
    const e = expectSingleError(result, 'DANGLING_REF', `${WS1_DIR}/plan.yaml`)
    expect(e.path).toBe('/ordered_items/2')
    expect(e.message).toContain('"WS-2"')
    expect(result.tree.topics[0]!.workstreams[0]!.plan).toBeNull()
  })

  it('plan.ordered_items → duplicate → DUPLICATE_ID', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_DIR}/plan.yaml`]: 'workstream: WS-1\nordered_items: [G-1, G-1]\n',
    }))
    const e = expectSingleError(result, 'DUPLICATE_ID', `${WS1_DIR}/plan.yaml`)
    expect(e.path).toBe('/ordered_items/1')
    expect(e.message).toContain('"G-1"')
  })

  it('project.current_objective_refs → missing objective → DANGLING_REF', () => {
    const result = load(mutate(baseTreeFiles(), {
      'project.yaml': `id: PRJ-1
title: 机器人视觉定位系统
current_objective_refs: [OBJ-9]
created_at: 2026-08-21T09:00:00Z
`,
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'project.yaml')
    expect(e.path).toBe('/current_objective_refs/0')
    expect(e.message).toContain('"OBJ-9"')
    expect(result.tree.project).toBeNull()
    expect(result.tree.topics[0]!.doc).not.toBeNull()
  })

  it('topic.objective_refs → missing objective → DANGLING_REF', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/topic.yaml': TOPIC_YAML.replace('objective_refs: [OBJ-1]', 'objective_refs: [OBJ-1, OBJ-9]'),
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'topics/TPC-1/topic.yaml')
    expect(e.path).toBe('/objective_refs/1')
    expect(result.tree.topics[0]!.doc).toBeNull()
  })

  it('topic.project_id != loaded project id → DANGLING_REF (§2.2 须与 project.yaml 匹配)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/topic.yaml': TOPIC_YAML.replace('project_id: PRJ-1', 'project_id: PRJ-2'),
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'topics/TPC-1/topic.yaml')
    expect(e.path).toBe('/project_id')
    expect(e.message).toContain('"PRJ-2"')
    expect(e.message).toContain('"PRJ-1"')
  })

  it('topic.project_id with NO loaded project (project.yaml rejected) → DANGLING_REF cascade', () => {
    const files = mutate(baseTreeFiles(), {
      'project.yaml': 'id: PRJ-1\ncreated_at: 2026-08-21T09:00:00Z\n', // schema-invalid: missing title
    })
    const result = load(files)
    expect(result.errors.map((x) => x.code)).toEqual(['SCHEMA', 'DANGLING_REF'])
    const d = result.errors[1]!
    expect(d.file).toBe('topics/TPC-1/topic.yaml')
    expect(d.path).toBe('/project_id')
    expect(d.message).toContain('project.yaml missing or rejected')
    expect(result.tree.project).toBeNull()
    expect(result.tree.topics[0]!.doc).toBeNull()
  })

  it('objective scope=TOPIC with nonexistent topic_id → DANGLING_REF; whole objectives file rejected', () => {
    const result = load(mutate(baseTreeFiles(), {
      'objectives.yaml': `${OBJECTIVES_YAML}
  - id: OBJ-2
    scope: TOPIC
    topic_id: TPC-9
    statement: 悬空 topic 引用
    success_criteria: [c1]
    created_at: 2026-08-21T09:00:00Z
`,
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'objectives.yaml')
    expect(e.path).toBe('/objectives/1/topic_id')
    expect(result.tree.objectives).toEqual([])
    // no cascade to project (single pass over the phase-1 accepted set)
    expect(result.tree.project).not.toBeNull()
  })

  it('objective linked_refs → missing WORKSTREAM / GATE / MILESTONE → DANGLING_REF per index', () => {
    const result = load(mutate(baseTreeFiles(), {
      'objectives.yaml': `objectives:
  - id: OBJ-1
    scope: PROJECT
    statement: 悬空 linked_refs
    success_criteria: [c1]
    linked_refs:
      - { kind: WORKSTREAM, id: WS-99 }
      - { kind: GATE, id: G-99 }
      - { kind: MILESTONE, id: M-99 }
    created_at: 2026-08-21T09:00:00Z
`,
    }))
    expect(result.errors.map((x) => [x.code, x.path])).toEqual([
      ['DANGLING_REF', '/objectives/0/linked_refs/0'],
      ['DANGLING_REF', '/objectives/0/linked_refs/1'],
      ['DANGLING_REF', '/objectives/0/linked_refs/2'],
    ])
    expect(result.tree.objectives).toEqual([])
  })

  it('objective duplicate id → DUPLICATE_ID at the later element', () => {
    const result = load(mutate(baseTreeFiles(), {
      'objectives.yaml': `${OBJECTIVES_YAML}
  - id: OBJ-1
    scope: PROJECT
    statement: 重复
    success_criteria: [c1]
    created_at: 2026-08-21T09:00:00Z
`,
    }))
    const e = expectSingleError(result, 'DUPLICATE_ID', 'objectives.yaml')
    expect(e.path).toBe('/objectives/1/id')
    expect(e.message).toContain('objectives[0]')
    expect(result.tree.objectives).toEqual([])
  })

  it('topology edge input outside the topic → DANGLING_REF (INV-STRUCT-2)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-2/topic.yaml': 'id: TPC-2\nproject_id: PRJ-1\ntitle: 第二主题\ncreated_at: 2026-08-21T10:00:00Z\n',
      'topics/TPC-2/workstreams/WS-9/workstream.yaml': 'id: WS-9\ntopic_id: TPC-2\ntitle: 跨主题 WS\ncreated_at: 2026-08-21T10:01:00Z\n',
      'topics/TPC-1/topology.yaml': TOPOLOGY_YAML.replace('inputs: [WS-1]', 'inputs: [WS-1, WS-9]'),
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'topics/TPC-1/topology.yaml')
    expect(e.path).toBe('/topology/edges/0/inputs/1')
    expect(e.message).toContain('INV-STRUCT-2')
    expect(result.tree.topics[0]!.topology).toBeNull()
    // the other topic loaded fine
    expect(result.tree.topics[1]!.doc!.id).toBe('TPC-2')
  })

  it('topology edge output unknown everywhere → DANGLING_REF (outputs side)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/topology.yaml': TOPOLOGY_YAML.replace('outputs: [WS-3]', 'outputs: [WS-3, WS-99]'),
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'topics/TPC-1/topology.yaml')
    expect(e.path).toBe('/topology/edges/1/outputs/1')
  })

  it('topology edge duplicate id across topics → DUPLICATE_ID (Project scope)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-2/topic.yaml': 'id: TPC-2\nproject_id: PRJ-1\ntitle: 第二主题\ncreated_at: 2026-08-21T10:00:00Z\n',
      'topics/TPC-2/workstreams/WS-9/workstream.yaml': 'id: WS-9\ntopic_id: TPC-2\ntitle: 跨主题 WS\ncreated_at: 2026-08-21T10:01:00Z\n',
      'topics/TPC-2/topology.yaml': 'topology:\n  topic_id: TPC-2\n  edges:\n    - id: TE-1\n      topic_id: TPC-2\n      operation: FORK\n      lifecycle: PLANNED\n      inputs: [WS-9]\n      outputs: [WS-9]\n',
    }))
    const e = expectSingleError(result, 'DUPLICATE_ID', 'topics/TPC-2/topology.yaml')
    expect(e.path).toBe('/topology/edges/0/id')
    expect(e.message).toContain('topics/TPC-1/topology.yaml')
    // first definition (TPC-1) stays loaded
    expect(result.tree.topics[0].topology!.topology.edges[0]!.id).toBe('TE-1')
  })

  it('workstream.origin_topology_edge_ref → edge of another topic → DANGLING_REF (须为同 Topic 边)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-2/topic.yaml': 'id: TPC-2\nproject_id: PRJ-1\ntitle: 第二主题\ncreated_at: 2026-08-21T10:00:00Z\n',
      'topics/TPC-2/workstreams/WS-9/workstream.yaml': 'id: WS-9\ntopic_id: TPC-2\ntitle: 跨主题 WS\ncreated_at: 2026-08-21T10:01:00Z\n',
      'topics/TPC-2/topology.yaml': 'topology:\n  topic_id: TPC-2\n  edges:\n    - id: TE-50\n      topic_id: TPC-2\n      operation: FORK\n      lifecycle: PLANNED\n      inputs: [WS-9]\n      outputs: [WS-9]\n',
      'topics/TPC-1/workstreams/WS-2/workstream.yaml': 'id: WS-2\ntopic_id: TPC-1\ntitle: 独立标定管线\norigin_topology_edge_ref: TE-50\ncreated_at: 2026-08-21T09:12:00Z\n',
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'topics/TPC-1/workstreams/WS-2/workstream.yaml')
    expect(e.path).toBe('/origin_topology_edge_ref')
    expect(e.message).toContain('TE-50')
  })

  it('workstream.origin_topology_edge_ref → nonexistent edge → DANGLING_REF', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/workstreams/WS-2/workstream.yaml': 'id: WS-2\ntopic_id: TPC-1\ntitle: 独立标定管线\norigin_topology_edge_ref: TE-99\ncreated_at: 2026-08-21T09:12:00Z\n',
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'topics/TPC-1/workstreams/WS-2/workstream.yaml')
    expect(e.path).toBe('/origin_topology_edge_ref')
  })

  it('merges/<TE>/contract.md for a nonexistent edge → DANGLING_REF (§3.2 归属由路径决定)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'merges/TE-99/contract.md': '# contract for a ghost edge\n',
    }))
    const e = expectSingleError(result, 'DANGLING_REF', 'merges/TE-99/contract.md')
    expect(e.message).toContain('"TE-99"')
    // the valid TE-2 contract still loads
    expect(result.tree.mergeContracts.map((c) => c.edgeId)).toEqual(['TE-2'])
  })

  it('item id duplicate across workstreams → DUPLICATE_ID (Project scope)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/workstreams/WS-2/items/gates/G-1.yaml': T2_YAML.replace('id: T-2', 'id: G-1').replace('workstream_id: WS-1', 'workstream_id: WS-2').replace('title: 候选方案 A 实现', 'title: 重复 gate').replace('goal: ', 'criteria: '),
    }))
    const e = expectSingleError(result, 'DUPLICATE_ID', 'topics/TPC-1/workstreams/WS-2/items/gates/G-1.yaml')
    expect(e.message).toContain('topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml')
    // first definition stays loaded
    expect(result.tree.topics[0]!.workstreams[0]!.gates.find((n) => n.id === 'G-1')!.doc).not.toBeNull()
    expect(result.tree.topics[0]!.workstreams[1]!.gates.find((n) => n.id === 'G-1')!.doc).toBeNull()
  })
})

describe('TC-DOM-027 — schema 违规 (JSON Schema 2020-12, precise location)', () => {
  it('task title > 200 chars → SCHEMA at /title with value summary; plan cascades', () => {
    const longTitle = '长'.repeat(250)
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-1.yaml`]: T3_YAML.replace('id: T-3', 'id: T-1').replace('workstream_id: WS-1', 'workstream_id: WS-1').replace('title: 候选方案 B 实现', `title: ${longTitle}`),
    }))
    // T-1.yaml: SCHEMA; plan.yaml: DANGLING_REF cascade (T-1 rejected in phase 1)
    expect(result.errors.map((x) => [x.code, x.file, x.path])).toEqual([
      ['SCHEMA', `${WS1_ITEMS}/tasks/T-1.yaml`, '/title'],
      ['DANGLING_REF', `${WS1_DIR}/plan.yaml`, '/ordered_items/1'],
    ])
    expect(result.tree.topics[0]!.workstreams[0]!.plan).toBeNull()
    expect(result.tree.topics[0]!.workstreams[0]!.tasks.find((n) => n.id === 'T-1')!.doc).toBeNull()
    // unrelated items still load
    expect(result.tree.topics[0]!.workstreams[0]!.tasks.find((n) => n.id === 'T-2')!.doc).not.toBeNull()
  })

  it('project importance out of range → SCHEMA at /importance (frozen maximum 5)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'project.yaml': `id: PRJ-1
title: 机器人视觉定位系统
importance: 9
created_at: 2026-08-21T09:00:00Z
`,
    }))
    const schemaErr = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/importance')!
    expect(schemaErr.file).toBe('project.yaml')
    expect(schemaErr.message).toContain('5')
    expect(schemaErr.message).toContain('9')
    // cascade: topics now reference a missing Project
    const d = result.errors.find((x) => x.code === 'DANGLING_REF')!
    expect(d.file).toBe('topics/TPC-1/topic.yaml')
    expect(result.tree.project).toBeNull()
  })

  it('created_at not a date-time → SCHEMA format error (ajv-formats active on frozen $refs)', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-2.yaml`]: T2_YAML.replace('created_at: 2026-08-21T09:36:00Z', 'created_at: yesterday'),
    }))
    const schemaErr = result.errors.find((x) => x.code === 'SCHEMA' && x.file === `${WS1_ITEMS}/tasks/T-2.yaml`)!
    expect(schemaErr.path).toBe('/created_at')
    expect(schemaErr.message.toLowerCase()).toContain('date-time')
    expect(schemaErr.message).toContain('"yesterday"')
    // cascade: plan references T-2
    expect(result.errors.some((x) => x.code === 'DANGLING_REF' && x.path === '/ordered_items/2')).toBe(true)
  })

  it('id pattern violation (frozen common.schema.json $ref) → SCHEMA pattern error', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-2.yaml`]: T2_YAML.replace('workstream_id: WS-1', 'workstream_id: ws-1'),
    }))
    const schemaErr = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/workstream_id')!
    expect(schemaErr, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(schemaErr.file).toBe(`${WS1_ITEMS}/tasks/T-2.yaml`)
    expect(schemaErr.message).toContain('WS-')
    // the file is rejected at the schema stage (path-id checks only run on
    // schema-valid docs), and the plan cascade follows
    expect(result.tree.topics[0]!.workstreams[0]!.tasks.find((n) => n.id === 'T-2')!.doc).toBeNull()
    expect(result.errors.some((x) => x.code === 'DANGLING_REF' && x.path === '/ordered_items/2')).toBe(true)
  })

  it('additionalProperties: runtime state in a Task definition → SCHEMA unexpected property (INV-PLAN-9 surface)', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-3.yaml`]: `${T3_YAML}runtime_state: { execution: ACTIVE }
`,
    }))
    const schemaErr = result.errors.find((x) => x.code === 'SCHEMA' && x.file === `${WS1_ITEMS}/tasks/T-3.yaml`)!
    expect(schemaErr.message).toContain('runtime_state')
    expect(result.tree.topics[0]!.workstreams[0]!.tasks.find((n) => n.id === 'T-3')!.doc).toBeNull()
    // cascade: plan references T-3
    expect(result.errors.some((x) => x.code === 'DANGLING_REF' && x.file === `${WS1_DIR}/plan.yaml`)).toBe(true)
  })

  it('missing required field → SCHEMA required error naming the property', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-4.yaml`]: `id: T-4
workstream_id: WS-1
title: 缺 goal
created_by: { kind: USER }
created_at: 2026-08-21T09:38:00Z
`,
    }))
    const schemaErr = result.errors.find((x) => x.code === 'SCHEMA' && x.file === `${WS1_ITEMS}/tasks/T-4.yaml`)!
    expect(schemaErr.message).toContain('goal')
    expect(result.tree.topics[0]!.workstreams[0]!.tasks.find((n) => n.id === 'T-4')!.doc).toBeNull()
  })

  it('invalid enum (task attention not applicable; use objective priority) → SCHEMA enum with allowed values', () => {
    const result = load(mutate(baseTreeFiles(), {
      'objectives.yaml': OBJECTIVES_YAML.replace('priority: P1', 'priority: P9'),
    }))
    const schemaErr = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/objectives/0/priority')!
    expect(schemaErr.message).toContain('P0')
    expect(schemaErr.message).toContain('P3')
    expect(schemaErr.message).toContain('"P9"')
  })
})

describe('TC-DOM-027 — YAML parse failures', () => {
  it('bad YAML syntax → PARSE with line info; other files load', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/topic.yaml': 'id: TPC-1\n\tproject_id: PRJ-1\n',
    }))
    const e = expectSingleError(result, 'PARSE', 'topics/TPC-1/topic.yaml')
    expect(e.message).toMatch(/line 2, col 1/)
    expect(result.tree.topics[0]!.doc).toBeNull()
    expect(result.tree.project).not.toBeNull()
    expect(result.tree.topics[0]!.workstreams[0]!.doc).not.toBeNull()
  })

  it('empty file → PARSE (expected a mapping)', () => {
    // decoupled: no origin refs / contract, so rejecting the topology cannot cascade
    const result = load(
      mutate(baseTreeFiles(), {
        'topics/TPC-1/topology.yaml': '',
        'topics/TPC-1/workstreams/WS-2/workstream.yaml': 'id: WS-2\ntopic_id: TPC-1\ntitle: 独立标定管线\ncreated_at: 2026-08-21T09:12:00Z\n',
        'topics/TPC-1/workstreams/WS-3/workstream.yaml': 'id: WS-3\ntopic_id: TPC-1\ntitle: 合并后管线\ncreated_at: 2026-08-21T09:14:00Z\n',
        'merges/TE-2/contract.md': null,
      }),
    )
    const e = expectSingleError(result, 'PARSE', 'topics/TPC-1/topology.yaml')
    expect(e.message).toContain('empty')
    expect(result.tree.topics[0]!.topology).toBeNull()
  })

  it('multiple YAML documents → PARSE', () => {
    const result = load(mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: .\n---\naudit: {}\n',
    }))
    const e = expectSingleError(result, 'PARSE', 'workspace.yaml')
    expect(e.message).toContain('multiple YAML documents')
    expect(result.tree.workspace).toBeNull()
  })

  it('top-level sequence → SCHEMA (must be a mapping)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'workspace.yaml': '- just\n- a\n- list\n',
    }))
    const e = expectSingleError(result, 'SCHEMA', 'workspace.yaml')
    expect(e.message).toContain('mapping')
    expect(e.message).toContain('sequence')
  })

  it('duplicate YAML keys → PARSE', () => {
    const result = load(mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: .\n  root: elsewhere\n',
    }))
    const e = expectSingleError(result, 'PARSE', 'workspace.yaml')
    expect(e.message.toLowerCase()).toContain('unique')
  })
})

describe('TC-DOM-027 — layout structure (PATH_RULE / UNKNOWN_ENTRY / schema-version)', () => {
  it('topic dir with invalid name → PATH_RULE, contents not descended', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/Bad/topic.yaml': 'id: TPC-9\nproject_id: PRJ-1\ntitle: 坏目录\ncreated_at: 2026-08-21T10:00:00Z\n',
    }))
    const e = expectSingleError(result, 'PATH_RULE', 'topics/Bad')
    expect(e.message).toContain('TPC id')
    expect(result.tree.topics.map((t) => t.id)).toEqual(['TPC-1'])
  })

  it('workstream dir with invalid name → PATH_RULE', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/workstreams/Bad/workstream.yaml': 'id: WS-9\ntopic_id: TPC-1\ntitle: 坏目录\ncreated_at: 2026-08-21T10:00:00Z\n',
    }))
    const e = expectSingleError(result, 'PATH_RULE', 'topics/TPC-1/workstreams/Bad')
    expect(e.message).toContain('WS id')
  })

  it('task file named T-0.yaml → PATH_RULE (id must be a positive integer)', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/T-0.yaml`]: T2_YAML.replace('id: T-2', 'id: T-0').replace('workstream_id: WS-1', 'workstream_id: WS-1'),
    }))
    const e = expectSingleError(result, 'PATH_RULE', `${WS1_ITEMS}/tasks/T-0.yaml`)
    expect(e.message).toContain('"<T-id>.yaml"')
  })

  it('task file with wrong prefix for its dir (G-1.yaml in tasks/) → PATH_RULE', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/tasks/G-1.yaml`]: T2_YAML.replace('id: T-2', 'id: T-20'),
    }))
    const e = expectSingleError(result, 'PATH_RULE', `${WS1_ITEMS}/tasks/G-1.yaml`)
  })

  it('merge dir with invalid name → PATH_RULE', () => {
    const result = load(mutate(baseTreeFiles(), {
      'merges/Bad/contract.md': 'x\n',
    }))
    const e = expectSingleError(result, 'PATH_RULE', 'merges/Bad')
    expect(e.message).toContain('TE id')
  })

  it('unknown top-level entry → UNKNOWN_ENTRY; rest loads', () => {
    const result = load(mutate(baseTreeFiles(), {
      'notes.md': '# not part of the layout\n',
    }))
    const e = expectSingleError(result, 'UNKNOWN_ENTRY', 'notes.md')
    expect(result.tree.project).not.toBeNull()
    expect(result.tree.topics[0]!.doc).not.toBeNull()
  })

  it('V2 state/ area is a KNOWN non-declarative entry (design §3.3): recognized, not descended, zero errors', () => {
    // The STANDALONE database lives at .research/state/research.sqlite —
    // the layout walk must recognize `state/` (no UNKNOWN_ENTRY) and never
    // descend into it (the state area is outside the declarative 真源).
    const result = load(mutate(baseTreeFiles(), {
      'state/research.sqlite': 'SQLite format 3\0not-a-real-db-bytes',
    }))
    expect(result.errors).toEqual([])
    expect(result.tree.project).not.toBeNull()
    expect(result.tree.topics[0]!.doc).not.toBeNull()
  })

  it('a FILE named `state` at the top level is still a layout violation (UNKNOWN_ENTRY)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'state': 'not a directory\n',
    }))
    const e = expectSingleError(result, 'UNKNOWN_ENTRY', 'state')
    expect(e.message).toContain('expected a directory')
  })

  it('unknown topic-level file → UNKNOWN_ENTRY', () => {
    const result = load(mutate(baseTreeFiles(), {
      'topics/TPC-1/readme.md': 'x\n',
    }))
    const e = expectSingleError(result, 'UNKNOWN_ENTRY', 'topics/TPC-1/readme.md')
  })

  it('unknown file directly under items/ → UNKNOWN_ENTRY', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/stray.yaml`]: 'a: 1\n',
    }))
    const e = expectSingleError(result, 'UNKNOWN_ENTRY', `${WS1_ITEMS}/stray.yaml`)
  })

  it('unknown items subdirectory → UNKNOWN_ENTRY', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_ITEMS}/notes/n1.yaml`]: 'a: 1\n',
    }))
    const e = expectSingleError(result, 'UNKNOWN_ENTRY', `${WS1_ITEMS}/notes`)
  })

  it('unknown workstream-level file → UNKNOWN_ENTRY', () => {
    const result = load(mutate(baseTreeFiles(), {
      [`${WS1_DIR}/scratch.txt`]: 'x\n',
    }))
    const e = expectSingleError(result, 'UNKNOWN_ENTRY', `${WS1_DIR}/scratch.txt`)
  })

  it('unknown policy file → UNKNOWN_ENTRY', () => {
    const result = load(mutate(baseTreeFiles(), {
      'policies/other.yaml': 'a: 1\n',
    }))
    const e = expectSingleError(result, 'UNKNOWN_ENTRY', 'policies/other.yaml')
  })

  it('schema-version "2" → SCHEMA_VERSION unsupported; rest loads', () => {
    const result = load(mutate(baseTreeFiles(), { 'schema-version': '2\n' }))
    const e = expectSingleError(result, 'SCHEMA_VERSION', 'schema-version')
    expect(e.message).toContain('2')
    expect(result.tree.schemaVersion).toBe(2)
    expect(result.tree.project).not.toBeNull()
  })

  it('schema-version non-integer → SCHEMA_VERSION', () => {
    const result = load(mutate(baseTreeFiles(), { 'schema-version': 'one\n' }))
    const e = expectSingleError(result, 'SCHEMA_VERSION', 'schema-version')
    expect(e.message).toContain('integer')
    expect(result.tree.schemaVersion).toBeNull()
  })

  it('schema-version multi-line → SCHEMA_VERSION (single-line rule)', () => {
    const result = load(mutate(baseTreeFiles(), { 'schema-version': '1\n2\n' }))
    const e = expectSingleError(result, 'SCHEMA_VERSION', 'schema-version')
    expect(e.message).toContain('integer')
  })
})

describe('TC-DOM-027 — 错误聚合 (aggregation: broken files never block the rest)', () => {
  it('three broken files of different kinds → exactly their errors; all valid files load', () => {
    const longTitle = '长'.repeat(250)
    const result = load(mutate(baseTreeFiles(), {
      // (1) schema violation → cascade into the plan (T-1 referenced)
      [`${WS1_ITEMS}/tasks/T-1.yaml`]: T3_YAML.replace('id: T-3', 'id: T-1').replace('title: 候选方案 B 实现', `title: ${longTitle}`),
      // (2) path/id mismatch (WS-3, unreferenced by anything else)
      'topics/TPC-1/workstreams/WS-3/workstream.yaml': 'id: WS-7\ntopic_id: TPC-1\ntitle: 合并后管线\ncreated_at: 2026-08-21T09:14:00Z\n',
      // (3) dangling merge contract
      'merges/TE-77/contract.md': '# ghost contract\n',
    }))
    expect(result.errors.map((x) => [x.code, x.file, x.path])).toEqual([
      ['SCHEMA', `${WS1_ITEMS}/tasks/T-1.yaml`, '/title'],
      ['PATH_ID_MISMATCH', 'topics/TPC-1/workstreams/WS-3/workstream.yaml', undefined],
      ['DANGLING_REF', `${WS1_DIR}/plan.yaml`, '/ordered_items/1'],
      ['DANGLING_REF', 'merges/TE-77/contract.md', undefined],
    ])

    const ws1 = result.tree.topics[0]!.workstreams[0]!
    const ws3 = result.tree.topics[0]!.workstreams[2]!
    // broken files absent
    expect(ws1.tasks.find((n) => n.id === 'T-1')!.doc).toBeNull()
    expect(ws1.plan).toBeNull()
    expect(ws3.doc).toBeNull()
    expect(result.tree.mergeContracts.map((c) => c.edgeId)).toEqual(['TE-2'])
    // everything else loaded
    expect(ws1.tasks.find((n) => n.id === 'T-2')!.doc).not.toBeNull()
    expect(ws1.tasks.find((n) => n.id === 'T-3')!.doc).not.toBeNull()
    expect(ws1.tasks.find((n) => n.id === 'T-4')!.doc).not.toBeNull()
    expect(ws1.gates.find((n) => n.id === 'G-1')!.doc).not.toBeNull()
    expect(ws1.gates.find((n) => n.id === 'G-2')!.doc).not.toBeNull()
    expect(ws1.milestones.find((n) => n.id === 'M-1')!.doc).not.toBeNull()
    expect(result.tree.topics[0]!.doc).not.toBeNull()
    expect(result.tree.topics[0]!.topology).not.toBeNull()
    expect(result.tree.project).not.toBeNull()
    expect(result.tree.objectives).toHaveLength(1)
    expect(result.tree.workspace).not.toBeNull()
    expect(result.tree.policy).not.toBeNull()
  })

  it('reader I/O failure on one file → READ error + expected cascades; rest loads', () => {
    const inner = makeReader(baseTreeFiles())
    const reader: ResearchFileReader = {
      readDir: (p: string) => inner.readDir(p),
      readFile: (p: string) => {
        if (p.endsWith('/topology.yaml')) throw new Error('boom: simulated I/O failure')
        return inner.readFile(p)
      },
    }
    const result = loadResearchTree(reader, MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR)
    // READ for the topology file, then the §16.1 cascades that follow from its
    // rejection (edges unknown → origin refs + contract dangle). Everything else loads.
    expect(result.errors.map((x) => [x.code, x.file])).toEqual([
      ['READ', 'topics/TPC-1/topology.yaml'],
      ['DANGLING_REF', 'topics/TPC-1/workstreams/WS-2/workstream.yaml'],
      ['DANGLING_REF', 'topics/TPC-1/workstreams/WS-3/workstream.yaml'],
      ['DANGLING_REF', 'merges/TE-2/contract.md'],
    ])
    expect(result.errors[0]!.message).toContain('boom')
    expect(result.tree.topics[0]!.topology).toBeNull()
    expect(result.tree.topics[0]!.doc).not.toBeNull()
    expect(result.tree.project).not.toBeNull()
    expect(result.tree.topics[0]!.workstreams[0]!.plan).not.toBeNull()
  })

  it('missing .research root → single MISSING_REQUIRED at root, empty tree', () => {
    // Reader serves the (real) schema files, but the research root has no files.
    const reader = makeReader(baseTreeFiles())
    const result = loadResearchTree(reader, '/mem/elsewhere/.research', MEM_SCHEMA_DIR)
    expect(result.errors.map((x) => [x.code, x.file])).toEqual([['MISSING_REQUIRED', '']])
    expect(result.tree.topics).toEqual([])
    expect(result.tree.project).toBeNull()
    expect(result.tree.schemaVersion).toBeNull()
  })
})
