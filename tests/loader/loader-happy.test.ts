/**
 * WP-1.1 — happy path: full valid tree (with the DOMAIN_SCHEMA 附录 A examples
 * verbatim) loads with zero errors; §1.2 time conversion; §14.1 defaults;
 * optional-file absence semantics.
 */
import { describe, expect, it } from 'vitest'

import type { LoadResult } from '../../src/host/domain/loader/index.js'
import {
  APPENDIX_A_PLAN_YAML,
  APPENDIX_A_PROJECT_YAML,
  APPENDIX_A_TASK_YAML,
  CONTRACT_MD,
  OBJECTIVES_YAML,
  POLICY_YAML_EXAMPLE,
  TOPIC_YAML,
  baseTreeFiles,
  load,
  mutate,
  WORKSPACE_YAML_EXAMPLE,
} from './fixtures.js'

function expectNoErrors(result: LoadResult): void {
  if (result.errors.length > 0) {
    throw new Error(`expected zero load errors, got ${result.errors.length}:\n${result.errors.map((e) => `  [${e.code}] ${e.file} ${e.path ?? ''} ${e.message}`).join('\n')}`)
  }
}

describe('WP-1.1 loader — happy path', () => {
  it('loads the complete valid tree with zero errors (TC-DOM-027 positive half)', () => {
    const result = load()
    expectNoErrors(result)

    const t = result.tree
    expect(t.schemaVersion).toBe(1)
    expect(t.topics).toHaveLength(1)
    expect(t.topics[0]!.id).toBe('TPC-1')
    expect(t.topics[0]!.path).toBe('topics/TPC-1')
    expect(t.topics[0]!.workstreams.map((w) => w.id)).toEqual(['WS-1', 'WS-2', 'WS-3'])
    expect(t.mergeContracts.map((c) => c.edgeId)).toEqual(['TE-2'])
    expect(t.mergeContracts[0]!.content).toBe(CONTRACT_MD)
    expect(t.policy).not.toBeNull()
    expect(t.workspace).not.toBeNull()
  })

  it('loads the 附录 A examples verbatim (project/plan/task byte-exact)', () => {
    const files = baseTreeFiles()
    // byte-exact provenance: the fixture tree carries the frozen examples verbatim
    expect(files['project.yaml']).toBe(APPENDIX_A_PROJECT_YAML)
    expect(files['topics/TPC-1/workstreams/WS-1/plan.yaml']).toBe(APPENDIX_A_PLAN_YAML)
    expect(files['topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml']).toBe(APPENDIX_A_TASK_YAML)

    const result = load(files)
    expectNoErrors(result)

    const p = result.tree.project!
    expect(p.id).toBe('PRJ-1')
    expect(p.title).toBe('机器人视觉定位系统')
    expect(p.importance).toBe(4)
    expect(p.attention_mode).toBe('FOCUS')
    expect(p.current_objective_refs).toEqual(['OBJ-1'])

    const ws1 = result.tree.topics[0]!.workstreams[0]!
    const t1 = ws1.tasks.find((n) => n.id === 'T-1')!
    expect(t1.doc!.goal).toBe('确定 EURA 相机阵列的标定数据采集方案，误差目标 <2px 重投影误差')
    expect(t1.doc!.created_by).toEqual({ kind: 'USER', label: 'researcher' })
    expect(t1.doc!.deliverables).toEqual(['docs/calibration-plan.md'])
    expect(t1.doc!.acceptance_criteria).toEqual(['三种候选方案均有实测重投影误差数据'])
  })

  it('preserves canonical plan order exactly (INV-PLAN-1 load stability)', () => {
    const result = load()
    expectNoErrors(result)
    const ws1 = result.tree.topics[0]!.workstreams[0]!
    expect(ws1.plan!.workstream).toBe('WS-1')
    expect(ws1.plan!.ordered_items).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
    // plan order is the array order — item nodes themselves are name-sorted
    expect(ws1.tasks.map((n) => n.id)).toEqual(['T-1', 'T-2', 'T-3', 'T-4'])
    expect(ws1.gates.map((n) => n.id)).toEqual(['G-1', 'G-2'])
    expect(ws1.milestones.map((n) => n.id)).toEqual(['M-1'])
    // every referenced item resolved to a loaded doc
    for (const node of [...ws1.tasks, ...ws1.gates, ...ws1.milestones]) {
      expect(node.doc, `item ${node.id} doc should be loaded`).not.toBeNull()
    }
  })

  it('loads topology edges + merge contract with structure intact', () => {
    const result = load()
    expectNoErrors(result)
    const topo = result.tree.topics[0]!.topology!
    expect(topo.topology.topic_id).toBe('TPC-1')
    expect(topo.topology.edges.map((e) => e.id)).toEqual(['TE-1', 'TE-2'])
    expect(topo.topology.edges[0]!.operation).toBe('FORK')
    expect(topo.topology.edges[0]!.inputs).toEqual(['WS-1'])
    expect(topo.topology.edges[1]!.operation).toBe('MERGE')
    expect(topo.topology.edges[1]!.outputs).toEqual(['WS-3'])
    const ws2 = result.tree.topics[0]!.workstreams[1]!
    expect(ws2.doc!.origin_topology_edge_ref).toBe('TE-1')
  })

  it('converts time fields to epoch ms at the loader boundary (DOMAIN_SCHEMA §1.2)', () => {
    const result = load()
    expectNoErrors(result)
    const t = result.tree
    expect(t.project!.created_at).toBe(Date.parse('2026-08-21T09:00:00Z'))
    const ws1 = t.topics[0]!.workstreams[0]!
    expect(ws1.tasks.find((n) => n.id === 'T-1')!.doc!.created_at).toBe(Date.parse('2026-08-21T09:30:00Z'))
    expect(t.topics[0]!.doc!.created_at).toBe(Date.parse('2026-08-21T09:05:00Z'))
    expect(t.objectives[0]!.created_at).toBe(Date.parse('2026-08-21T09:00:00Z'))
    // ISO strings must NOT survive into the memory carrier
    expect(t.project!.created_at).toBeTypeOf('number')
  })

  it('converts ISO dates to epoch ms (UTC midnight) for target_date', () => {
    const files = mutate(baseTreeFiles(), {
      'project.yaml': `${APPENDIX_A_PROJECT_YAML}target_date: 2026-12-31\n`,
    })
    const result = load(files)
    expectNoErrors(result)
    expect(result.tree.project!.target_date).toBe(Date.parse('2026-12-31'))
    // objectives target_date as well
    const files2 = mutate(baseTreeFiles(), {
      'objectives.yaml': OBJECTIVES_YAML.replace('status: ACTIVE', 'status: ACTIVE\n    target_date: 2026-10-01'),
    })
    const result2 = load(files2)
    expectNoErrors(result2)
    expect(result2.tree.objectives[0]!.target_date).toBe(Date.parse('2026-10-01'))
  })

  it('materializes schema 工程默认 defaults at the loader boundary (§14.1)', () => {
    // minimal project: only schema-required fields → defaults materialized
    const files = mutate(baseTreeFiles(), {
      'schema-version': '1\n',
      'project.yaml': 'id: PRJ-1\ntitle: 最小项目\ncreated_at: 2026-08-21T09:00:00Z\n',
      'objectives.yaml': null,
      'workspace.yaml': null,
      'policies/agent-plan-fork.yaml': null,
      'topics/TPC-1/topic.yaml': null,
      'topics/TPC-1/topology.yaml': null,
      'topics/TPC-1/workstreams/WS-1/workstream.yaml': null,
      'topics/TPC-1/workstreams/WS-1/plan.yaml': null,
      'topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml': null,
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml': null,
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml': null,
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml': null,
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-4.yaml': null,
      'topics/TPC-1/workstreams/WS-1/items/milestones/M-1.yaml': null,
      'topics/TPC-1/workstreams/WS-1/items/gates/G-2.yaml': null,
      'topics/TPC-1/workstreams/WS-2/workstream.yaml': null,
      'topics/TPC-1/workstreams/WS-3/workstream.yaml': null,
      'merges/TE-2/contract.md': null,
    })
    const result = load(files)
    expectNoErrors(result)
    const p = result.tree.project!
    expect(p.importance).toBe(3) // schema default
    expect(p.attention_mode).toBe('NORMAL') // schema default
    expect(p.current_objective_refs).toEqual([]) // schema default
    expect(p.target_date).toBeUndefined()
    expect(result.tree.topics).toEqual([])
    expect(result.tree.mergeContracts).toEqual([])
  })

  it('applies workspace.yaml §14.1 defaults (git_required true; zone without artifact_types stays sparse)', () => {
    const files = mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: sub/\n  audit: {}\n'.replace('  audit: {}\n', ''),
    })
    const result = load(files)
    expectNoErrors(result)
    const w = result.tree.workspace!
    expect(w.workspace.root).toBe('sub/')
    expect(w.workspace.git_required).toBe(true) // schema default
    expect(w.audit).toBeUndefined() // optional object not materialized

    const files2 = mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: .\naudit:\n  discovery_zones:\n    - path: docs/\n',
    })
    const result2 = load(files2)
    expectNoErrors(result2)
    const zones = result2.tree.workspace!.audit!.discovery_zones!
    expect(zones).toEqual([{ path: 'docs/' }]) // no artifact_types ⇒ absent (no default)
  })

  it('loads §14.1 workspace example and PLAN_FORK_SPEC §9 policy examples verbatim', () => {
    const result = load()
    expectNoErrors(result)
    const w = result.tree.workspace!
    expect(w.workspace.root).toBe('.')
    expect(w.workspace.git_required).toBe(true)
    expect(w.audit!.strict_tracked!.paths).toEqual([])
    expect(w.audit!.discovery_zones).toEqual([
      { path: 'results/', artifact_types: ['DATASET', 'FIGURE'] },
      { path: 'docs/' },
    ])
    expect(w.audit!.ignored).toEqual(['cache/', 'build/', 'tmp/'])

    const policy = result.tree.policy!
    expect(policy.enabled).toBe(true)
    expect(policy.anchors!.allow_boundary_sentinels).toBe(true)
    expect(policy.anchors!.required_item_types).toEqual([])
    expect(policy.flooding!.threshold).toBe(5)
    expect(policy.triggers!.require_at_least_one).toBe(true)
    expect(policy.triggers!.allowed_kinds).toEqual(['CLAIM', 'FACT', 'ARTIFACT', 'MILESTONE', 'OBJECTIVE'])
    // provenance: the fixture files are byte-exact frozen examples
    expect(baseTreeFiles()['workspace.yaml']).toBe(WORKSPACE_YAML_EXAMPLE)
    expect(baseTreeFiles()['policies/agent-plan-fork.yaml']).toBe(POLICY_YAML_EXAMPLE)
  })

  it('missing optional files load as empty sections with no errors', () => {
    const files: Record<string, string> = {
      'schema-version': '1\n',
      'project.yaml': 'id: PRJ-1\ntitle: 只有项目\ncreated_at: 2026-08-21T09:00:00Z\n',
    }
    const result = load(files)
    expectNoErrors(result)
    expect(result.tree.project!.id).toBe('PRJ-1')
    expect(result.tree.objectives).toEqual([])
    expect(result.tree.workspace).toBeNull()
    expect(result.tree.policy).toBeNull()
    expect(result.tree.topics).toEqual([])
    expect(result.tree.mergeContracts).toEqual([])
  })

  it('missing required project.yaml ⇒ MISSING_REQUIRED (nothing else to cascade to)', () => {
    const files: Record<string, string> = { 'schema-version': '1\n' }
    const result = load(files)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.code).toBe('MISSING_REQUIRED')
    expect(result.errors[0]!.file).toBe('project.yaml')
    expect(result.tree.project).toBeNull()
  })

  it('missing required schema-version ⇒ SCHEMA_VERSION/MISSING_REQUIRED reported at the right code', () => {
    const files = mutate(baseTreeFiles(), { 'schema-version': null })
    const result = load(files)
    const sv = result.errors.filter((e) => e.file === 'schema-version')
    expect(sv).toHaveLength(1)
    expect(sv[0]!.code).toBe('MISSING_REQUIRED')
    // the rest of the tree still loads (aggregation)
    expect(result.tree.project).not.toBeNull()
  })

  it('missing topic.yaml inside a topic dir ⇒ MISSING_REQUIRED; skeleton kept', () => {
    const files = mutate(baseTreeFiles(), { 'topics/TPC-1/topic.yaml': null })
    const result = load(files)
    expect(result.errors.map((e) => [e.code, e.file])).toEqual([
      ['MISSING_REQUIRED', 'topics/TPC-1/topic.yaml'],
    ])
    expect(result.tree.topics[0]!.doc).toBeNull()
    // workstreams under the topic still load (their checks are path-based)
    expect(result.tree.topics[0]!.workstreams[0]!.doc!.id).toBe('WS-1')
  })

  it('missing workstream.yaml inside a workstream dir ⇒ MISSING_REQUIRED (empty dir kept alive)', () => {
    const files = mutate(baseTreeFiles(), { 'topics/TPC-1/workstreams/WS-3/workstream.yaml': null })
    const result = load(files, ['topics/TPC-1/workstreams/WS-3'])
    const errs = result.errors.filter((e) => e.code === 'MISSING_REQUIRED')
    expect(errs).toHaveLength(1)
    expect(errs[0]!.file).toBe('topics/TPC-1/workstreams/WS-3/workstream.yaml')
    const ws3 = result.tree.topics[0]!.workstreams[2]!
    expect(ws3.doc).toBeNull()
    // TE-2 contract still resolves (edge exists) — no cascade
    expect(result.tree.mergeContracts[0]!.edgeId).toBe('TE-2')
  })

  it('missing contract.md inside a merges dir ⇒ MISSING_REQUIRED (empty dir kept alive)', () => {
    const files = mutate(baseTreeFiles(), { 'merges/TE-2/contract.md': null })
    const result = load(files, ['merges/TE-2'])
    const errs = result.errors.filter((e) => e.code === 'MISSING_REQUIRED')
    expect(errs).toHaveLength(1)
    expect(errs[0]!.file).toBe('merges/TE-2/contract.md')
    expect(result.tree.mergeContracts).toEqual([])
  })

  it('loads a second topic + workstream cleanly (multi-node skeleton)', () => {
    const files = mutate(baseTreeFiles(), {
      'topics/TPC-2/topic.yaml': `id: TPC-2
project_id: PRJ-1
title: 第二个主题
created_at: 2026-08-21T10:00:00Z
`,
      'topics/TPC-2/workstreams/WS-10/workstream.yaml': `id: WS-10
topic_id: TPC-2
title: 第二个主题的 WS
created_at: 2026-08-21T10:01:00Z
`,
    })
    const result = load(files)
    expectNoErrors(result)
    expect(result.tree.topics.map((t) => t.id)).toEqual(['TPC-1', 'TPC-2'])
    expect(result.tree.topics[1]!.workstreams[0]!.id).toBe('WS-10')
    expect(result.tree.topics[1]!.doc!.title).toBe('第二个主题')
  })

  it('loads without workspace.yaml/objectives.yaml/policy/merges (minimal-but-valid tree)', () => {
    const files = mutate(baseTreeFiles(), {
      'workspace.yaml': null,
      'objectives.yaml': null,
      'policies/agent-plan-fork.yaml': null,
      'merges/TE-2/contract.md': null,
      'project.yaml': `id: PRJ-1
title: 机器人视觉定位系统
created_at: 2026-08-21T09:00:00Z
`,
      'topics/TPC-1/topic.yaml': TOPIC_YAML.replace('objective_refs: [OBJ-1]\n', ''),
      'topics/TPC-1/workstreams/WS-2/workstream.yaml': `id: WS-2
topic_id: TPC-1
title: 独立标定管线
created_at: 2026-08-21T09:12:00Z
`,
    })
    const result = load(files)
    expectNoErrors(result)
    expect(result.tree.workspace).toBeNull()
    expect(result.tree.objectives).toEqual([])
    expect(result.tree.policy).toBeNull()
    expect(result.tree.mergeContracts).toEqual([])
    expect(result.tree.topics[0]!.doc!.objective_refs).toEqual([]) // schema default
    expect(result.tree.topics[0]!.workstreams[1]!.doc!.lifecycle).toBe('PLANNED') // workstream schema default
  })
})
