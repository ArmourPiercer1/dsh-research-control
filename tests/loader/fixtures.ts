/**
 * WP-1.1 test fixtures.
 *
 * - The frozen-document examples are included VERBATIM (DOMAIN_SCHEMA 附录 A,
 *   DOMAIN_SCHEMA §14.1, PLAN_FORK_SPEC §9) — the "附录 A 示例可加载" assertion
 *   in the brief relies on these byte-exact strings.
 * - `baseTreeFiles()` is a complete, fully cross-referenced valid `.research/`
 *   tree (all 11 declarative file types + contract + schema-version) used as
 *   the mutation base for the TC-DOM-027 negative cases.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { LoadResult } from '../../src/host/domain/loader/index.js'
import { loadResearchTree } from '../../src/host/domain/loader/index.js'
import { MemoryReader } from './memory-reader.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/loader → tests → plugin repo → WR). */
export const WR_ROOT = join(HERE, '..', '..', '..')
/** The real frozen declarative schema dir (read-only contract). */
export const WR_SCHEMA_DIR = join(WR_ROOT, 'schema', 'declarative')

/* ------------------------------------------------------------------ *
 * Verbatim frozen-document examples
 * ------------------------------------------------------------------ */

/** DOMAIN_SCHEMA 附录 A — `.research/project.yaml` (byte-exact). */
export const APPENDIX_A_PROJECT_YAML = `id: PRJ-1
title: 机器人视觉定位系统
description: 多传感器融合的亚像素级视觉定位
importance: 4
attention_mode: FOCUS
current_objective_refs: [OBJ-1]
created_at: 2026-08-21T09:00:00Z
`

/** DOMAIN_SCHEMA 附录 A — `.research/topics/TPC-1/workstreams/WS-1/plan.yaml` (byte-exact). */
export const APPENDIX_A_PLAN_YAML = `workstream: WS-1
ordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
`

/** DOMAIN_SCHEMA 附录 A — `.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml` (byte-exact). */
export const APPENDIX_A_TASK_YAML = `id: T-1
workstream_id: WS-1
title: 标定数据采集方案对比
goal: 确定 EURA 相机阵列的标定数据采集方案，误差目标 <2px 重投影误差
deliverables:
  - docs/calibration-plan.md
acceptance_criteria:
  - 三种候选方案均有实测重投影误差数据
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:30:00Z
`

/** DOMAIN_SCHEMA §14.1 — `.research/workspace.yaml` 工程默认结构 (byte-exact). */
export const WORKSPACE_YAML_EXAMPLE = `workspace:
  root: .                # 相对 Git repo root
  git_required: true     # INV-GIT-1
audit:
  strict_tracked:        # 计划书 §22.1 第一层
    paths: []            # 关键代码 / Task deliverables / merge 相关文件 glob
  discovery_zones:       # 第二层：发现未注册 Artifact / workspace change
    - path: results/
      artifact_types: [DATASET, FIGURE]   # 可选：该 zone 期望的 ArtifactType（发现分类提示）
    - path: docs/
  ignored:               # 第三层
    - cache/
    - build/
    - tmp/
`

/** PLAN_FORK_SPEC §9 — `.research/policies/agent-plan-fork.yaml` (byte-exact). */
export const POLICY_YAML_EXAMPLE = `enabled: true
anchors:
  allow_boundary_sentinels: true   # 允许 __START__ / __END__
  required_item_types: []          # 空 = 任意 item 可作 anchor；可设 [GATE]
flooding:
  threshold: 5                     # 每 workstream unresolved OPEN PF 数上限
triggers:
  require_at_least_one: true
  allowed_kinds: [CLAIM, FACT, ARTIFACT, MILESTONE, OBJECTIVE]
`

/* ------------------------------------------------------------------ *
 * Complete valid base tree (all §14 file types, all refs resolve)
 * ------------------------------------------------------------------ */

export const TOPIC_YAML = `id: TPC-1
project_id: PRJ-1
title: 标定与配准
objective_refs: [OBJ-1]
created_at: 2026-08-21T09:05:00Z
`

export const TOPOLOGY_YAML = `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [WS-1]
      outputs: [WS-2]
      note: 分支出独立标定管线
    - id: TE-2
      topic_id: TPC-1
      operation: MERGE
      lifecycle: PLANNED
      inputs: [WS-1, WS-2]
      outputs: [WS-3]
`

export const WS1_YAML = `id: WS-1
topic_id: TPC-1
title: 主标定管线
created_at: 2026-08-21T09:10:00Z
`

export const WS2_YAML = `id: WS-2
topic_id: TPC-1
title: 独立标定管线
origin_topology_edge_ref: TE-1
created_at: 2026-08-21T09:12:00Z
`

export const WS3_YAML = `id: WS-3
topic_id: TPC-1
title: 合并后管线
origin_topology_edge_ref: TE-2
created_at: 2026-08-21T09:14:00Z
`

export const G1_YAML = `id: G-1
workstream_id: WS-1
title: 数据就绪评审
criteria: 标定数据集完整、标注规范且可复现
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:35:00Z
`

export const T2_YAML = `id: T-2
workstream_id: WS-1
title: 候选方案 A 实现
goal: 实现基于棋盘格的标定采集与求解
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:36:00Z
`

export const T3_YAML = `id: T-3
workstream_id: WS-1
title: 候选方案 B 实现
goal: 实现基于 ARUKO 标记的标定采集与求解
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:37:00Z
`

export const T4_YAML = `id: T-4
workstream_id: WS-1
title: 三方案误差对比
goal: 在统一测试集上对比三方案重投影误差
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:38:00Z
`

export const M1_YAML = `id: M-1
workstream_id: WS-1
title: 标定管线 v1 冻结
statement: 重投影误差 <2px 的标定管线代码冻结并进入合并评审
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:39:00Z
`

export const G2_YAML = `id: G-2
workstream_id: WS-1
title: 合并评审
criteria: 三方案对比数据完整且 M-1 已达成
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:40:00Z
`

export const OBJECTIVES_YAML = `objectives:
  - id: OBJ-1
    scope: TOPIC
    topic_id: TPC-1
    statement: 完成亚像素级视觉定位原型
    success_criteria:
      - 重投影误差 <2px
    status: ACTIVE
    priority: P1
    linked_refs:
      - { kind: WORKSTREAM, id: WS-1 }
      - { kind: GATE, id: G-1 }
    created_at: 2026-08-21T09:00:00Z
`

export const CONTRACT_MD = `# Merge Contract TE-2

- 接口: 标定结果统一输出 CalibrationResult (JSON schema v1)
- 坐标系: 相机系，右手系
- benchmark protocol: 统一 5 组标定板位姿
- 期望产物: docs/merge-contract-verification.md
`

/**
 * The complete valid `.research/` tree, keyed by root-relative POSIX path.
 * Contains the three Appendix A files and the §14.1 / PLAN_FORK_SPEC §9
 * examples verbatim.
 */
export function baseTreeFiles(): Record<string, string> {
  return {
    'schema-version': '1\n',
    'project.yaml': APPENDIX_A_PROJECT_YAML,
    'workspace.yaml': WORKSPACE_YAML_EXAMPLE,
    'objectives.yaml': OBJECTIVES_YAML,
    'topics/TPC-1/topic.yaml': TOPIC_YAML,
    'topics/TPC-1/topology.yaml': TOPOLOGY_YAML,
    'topics/TPC-1/workstreams/WS-1/workstream.yaml': WS1_YAML,
    'topics/TPC-1/workstreams/WS-1/plan.yaml': APPENDIX_A_PLAN_YAML,
    'topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml': G1_YAML,
    'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml': APPENDIX_A_TASK_YAML,
    'topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml': T2_YAML,
    'topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml': T3_YAML,
    'topics/TPC-1/workstreams/WS-1/items/tasks/T-4.yaml': T4_YAML,
    'topics/TPC-1/workstreams/WS-1/items/milestones/M-1.yaml': M1_YAML,
    'topics/TPC-1/workstreams/WS-1/items/gates/G-2.yaml': G2_YAML,
    'topics/TPC-1/workstreams/WS-2/workstream.yaml': WS2_YAML,
    'topics/TPC-1/workstreams/WS-3/workstream.yaml': WS3_YAML,
    'merges/TE-2/contract.md': CONTRACT_MD,
    'policies/agent-plan-fork.yaml': POLICY_YAML_EXAMPLE,
  }
}

/* ------------------------------------------------------------------ *
 * Reader factories (schema files = the REAL frozen JSON, read once)
 * ------------------------------------------------------------------ */

export const MEM_RESEARCH_ROOT = '/mem/ws/.research'
export const MEM_SCHEMA_DIR = '/mem/wr/schema/declarative'

let schemaFilesCache: Record<string, string> | null = null

/** The 11 declarative schemas + parent common.schema.json, real file contents. */
export function realSchemaFiles(): Record<string, string> {
  if (schemaFilesCache !== null) return schemaFilesCache
  const out: Record<string, string> = {}
  for (const f of readdirSync(WR_SCHEMA_DIR).sort()) {
    out[`${MEM_SCHEMA_DIR}/${f}`] = readFileSync(join(WR_SCHEMA_DIR, f), 'utf8')
  }
  // common.schema.json lives in the parent dir; register under the literal
  // '..' path — the reader normalizes it (mirrors the loader's pjoin usage).
  out[`${MEM_SCHEMA_DIR}/../common.schema.json`] = readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8')
  schemaFilesCache = out
  return out
}

/** MemoryReader with the real frozen schemas + the given `.research` files.
 *  `extraDirs` registers existing-but-empty directories (root-relative). */
export function makeReader(
  files: Record<string, string> = baseTreeFiles(),
  extraDirs: string[] = [],
): MemoryReader {
  const reader = new MemoryReader(realSchemaFiles())
  for (const [rel, content] of Object.entries(files)) reader.addFile(`${MEM_RESEARCH_ROOT}/${rel}`, content)
  for (const rel of extraDirs) reader.addDir(`${MEM_RESEARCH_ROOT}/${rel}`)
  return reader
}

/** Load `.research` from an in-memory tree (real frozen schemas). */
export function load(files: Record<string, string> = baseTreeFiles(), extraDirs: string[] = []): LoadResult {
  return loadResearchTree(makeReader(files, extraDirs), MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR)
}

/** Patch helper: replace files, or delete them (value `null`). */
export function mutate(base: Record<string, string>, patch: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = { ...base }
  for (const [path, content] of Object.entries(patch)) {
    if (content === null) delete out[path]
    else out[path] = content
  }
  return out
}
