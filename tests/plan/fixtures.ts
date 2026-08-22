/**
 * WP-1.3 test fixtures: in-memory `.research` trees (WP-1.1 base tree + the
 * REAL frozen schemas via the WP-1.1 fixture readers) and in-memory doc
 * builders (§1.2 carriers: epoch-ms times).
 */
import type { GateDoc, MilestoneDoc, TaskDoc } from '../../src/host/domain/loader/index.js'
import { PlanStore } from '../../src/host/domain/plan/index.js'
import {
  baseTreeFiles,
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  realSchemaFiles,
} from '../loader/fixtures.js'
import { MemoryFs } from './memory-fs.js'

export { MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR }

export const TOPIC = 'TPC-1'
export const WS = 'WS-1'
export const WS2 = 'WS-2'
export const WS_REL = `topics/${TOPIC}/workstreams/${WS}`
export const PLAN_REL = `${WS_REL}/plan.yaml`
export const itemRel = (dir: 'tasks' | 'gates' | 'milestones', id: string): string =>
  `${WS_REL}/items/${dir}/${id}.yaml`

/** Reader-absolute paths (MemoryFs keys = researchRoot + rel). */
export const ABS_PLAN = `${MEM_RESEARCH_ROOT}/${PLAN_REL}`
export const absItem = (dir: 'tasks' | 'gates' | 'milestones', id: string): string =>
  `${MEM_RESEARCH_ROOT}/${itemRel(dir, id)}`
export const absPlanFor = (wsId: string): string => `${MEM_RESEARCH_ROOT}/topics/${TOPIC}/workstreams/${wsId}/plan.yaml`

/** 2026-08-21T09:00:00Z in epoch ms (§1.2 memory carrier). */
export const T09 = Date.parse('2026-08-21T09:00:00Z')
/** 2026-08-21T09:00:00.500Z — non-whole-second, keeps the `.500Z` group. */
export const T09500 = Date.parse('2026-08-21T09:00:00.500Z')

/** In-memory Task carrier (§1.2: epoch ms; declaration-only fields). */
export function taskDoc(partial: Partial<TaskDoc> = {}): TaskDoc {
  return {
    id: 'T-9',
    workstream_id: WS,
    title: '新建任务',
    goal: '最小可独立执行并验收的研究工作单元',
    deliverables: [],
    acceptance_criteria: [],
    created_by: { kind: 'USER', label: 'researcher' },
    created_at: T09,
    ...partial,
  }
}

/** In-memory Gate carrier. */
export function gateDoc(partial: Partial<GateDoc> = {}): GateDoc {
  return {
    id: 'G-9',
    workstream_id: WS,
    title: '新建评审',
    criteria: '是否准备好进入下一步',
    references: [],
    created_by: { kind: 'USER', label: 'researcher' },
    created_at: T09,
    ...partial,
  }
}

/** In-memory Milestone carrier. */
export function milestoneDoc(partial: Partial<MilestoneDoc> = {}): MilestoneDoc {
  return {
    id: 'M-9',
    workstream_id: WS,
    title: '新状态',
    statement: '达成状态的明确陈述',
    created_by: { kind: 'USER', label: 'researcher' },
    created_at: T09,
    ...partial,
  }
}

/**
 * A MemoryFs holding the REAL frozen schemas + the complete WP-1.1 base tree
 * (WS-1: plan [G-1, T-1, T-2, T-3, M-1, T-4, G-2] + all definitions; WS-2/WS-3
 * exist as directories with workstream.yaml only).
 */
export function baseFs(): MemoryFs {
  const fs = new MemoryFs(realSchemaFiles())
  for (const [rel, content] of Object.entries(baseTreeFiles())) {
    fs.addFile(`${MEM_RESEARCH_ROOT}/${rel}`, content)
  }
  return fs
}

/** A MemoryFs with ONLY the frozen schemas (empty `.research`). */
export function emptyFs(): MemoryFs {
  return new MemoryFs(realSchemaFiles())
}

/** A PlanStore for TPC-1 / `wsId` over the given fs (fresh instance). */
export function makeStore(fs: MemoryFs, wsId: string = WS, topicId: string = TOPIC): PlanStore {
  return new PlanStore({
    reader: fs,
    writer: fs,
    researchRoot: MEM_RESEARCH_ROOT,
    schemaDir: MEM_SCHEMA_DIR,
    topicId,
    wsId,
  })
}
