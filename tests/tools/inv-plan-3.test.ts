/**
 * WP-3.3 — INV-PLAN-3 类型面证明: **Agent 无任何 API 可直接修改 canonical
 * plan** (reorder/insert/delete; ARCHITECTURE §5.4 INV-PLAN-3 「R+T」,
 * 本 WP 交付工具面半边).
 *
 * 编译期 (类型面, tsc/typecheck 消费者生效):
 *  - `keyof ResearchToolDeps` 被钉死为恰好两个键 (planForkCreate /
 *    recordCheckpoint) — 任何 canonical plan 写口 (PlanStore 的
 *    savePlan/createItem/updateItem/insertItemAt/moveItem/removeItem/
 *    addItem 或 contract writer) 想进入工具层依赖面 ⇒ 编译失败;
 *  - 两个端口的签名被逐字钉死: planForkCreate 的参数是冻结 §4
 *    `CreatePlanForkParams` (其无 base 由 WP-3.1 的 absent-key 断言传递
 *    证明), 返回值是 PlanFork 记录 (不是 plan); recordCheckpoint 的参数
 *    是 (runId, note?, USER-or-AGENT actor) — 均无 plan 写语义;
 *  - 正例钉: 两个键都在类型面上 (演进同步).
 *
 * 运行期 (vitest 生效):
 *  - 工具模块导出面不含任何 plan 写/select/dismiss 词汇 (名称审计);
 *  - 11 个工具的参数面不含任何能命名 canonical plan 写操作的键 (参数
 *    键集审计) — 模型的调用语法层面就无法表达 plan 写;
 *  - 正例钉: PlanStore 确实持有这些写口 (领域层写口存在, 但工具层不可达
 *    — 证明审计的不是「词汇不存在于代码库」, 而是「不可达于 Agent 面」).
 */

import { describe, expect, it } from 'vitest'

import { PlanStore } from '../../src/host/domain/plan/index.js'
import { MergeContractStore } from '../../src/host/domain/topology/index.js'
import {
  type CreatePlanForkParams,
  type PlanForkRecord,
} from '../../src/host/domain/planfork/index.js'
import type { RunRecord, UserOrAgentActorRef } from '../../src/host/service/runbinding/index.js'
import * as toolsModule from '../../src/host/tools/index.js'
import {
  RESEARCH_TOOL_NAMES,
  createResearchTools,
  type ResearchToolDeps,
  type ToolParameters,
} from '../../src/host/tools/index.js'
import { makeRecordingDeps } from './fixtures.js'

/* ------------------------------------------------------------------ *
 * 编译期类型面断言 (任何违例 ⇒ tsc 编译失败)
 * ------------------------------------------------------------------ */

/** Standard type-level boolean machinery (fails the build on violation). */
type Expect<T extends true> = T
/** Structural equality (the strictest pin). */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
/** True iff K is NOT a key of T. */
type Absent<K extends string, T> = [K] extends [keyof T] ? false : true

/** INV-PLAN-3 核心钉: 工具层依赖面恰好两个键 — 无 plan 写口可注入. */
type T_DepsFaceExact = Expect<Equal<keyof ResearchToolDeps, 'planForkCreate' | 'recordCheckpoint'>>

/** 正例钉: 两个键都在. */
type T_HasPlanForkCreate = Expect<['planForkCreate'] extends [keyof ResearchToolDeps] ? true : false>
type T_HasRecordCheckpoint = Expect<['recordCheckpoint'] extends [keyof ResearchToolDeps] ? true : false>

/** Canonical plan 写口 (PlanStore 面) 无一可进入依赖面. */
type T_NoSavePlan = Expect<Absent<'savePlan', ResearchToolDeps>>
type T_NoCreateItem = Expect<Absent<'createItem', ResearchToolDeps>>
type T_NoUpdateItem = Expect<Absent<'updateItem', ResearchToolDeps>>
type T_NoInsertItemAt = Expect<Absent<'insertItemAt', ResearchToolDeps>>
type T_NoMoveItem = Expect<Absent<'moveItem', ResearchToolDeps>>
type T_NoRemoveItem = Expect<Absent<'removeItem', ResearchToolDeps>>
type T_NoAddItem = Expect<Absent<'addItem', ResearchToolDeps>>
type T_NoReorderPlan = Expect<Absent<'reorderPlan', ResearchToolDeps>>
type T_NoWriteContract = Expect<Absent<'writeContract', ResearchToolDeps>>

/** planForkCreate 端口逐字钉: 参数 = 冻结 §4 参数 (无 base — WP-3.1 传递), 返回 = PF 记录. */
type T_PfCreateParamsFrozen = Expect<Equal<Parameters<ResearchToolDeps['planForkCreate']>[0], CreatePlanForkParams>>
type T_PfCreateReturnsRecord = Expect<Equal<ReturnType<ResearchToolDeps['planForkCreate']>, PlanForkRecord>>
type T_PfCreateArityOne = Expect<Equal<Parameters<ResearchToolDeps['planForkCreate']>, [CreatePlanForkParams]>>

/** recordCheckpoint 端口逐字钉: 无 plan 写语义. */
type T_RcParamsFrozen = Expect<
  Equal<Parameters<ResearchToolDeps['recordCheckpoint']>, [string, { note?: string }, UserOrAgentActorRef]>
>
type T_RcReturnsRun = Expect<Equal<ReturnType<ResearchToolDeps['recordCheckpoint']>, RunRecord>>

/** PF 参数本身无 base 变体 (INV-PLAN-6 在工具面的类型传递). */
type T_PfParamsNoBase = Expect<Absent<'base', CreatePlanForkParams>>
type T_PfParamsNoBasePlanObjects = Expect<Absent<'base_plan_objects', CreatePlanForkParams>>
type T_PfParamsNoBasePlanObjects_Camel = Expect<Absent<'basePlanObjects', CreatePlanForkParams>>
type T_PfParamsNoBaseGitCommit = Expect<Absent<'base_git_commit', CreatePlanForkParams>>
type T_PfParamsNoBaseGitCommit_Camel = Expect<Absent<'baseGitCommit', CreatePlanForkParams>>

// 让编译器保留这些别名 (类型别名不参与值层, 此处显式钉住).
const _typeSurface: [
  T_DepsFaceExact,
  T_HasPlanForkCreate,
  T_HasRecordCheckpoint,
  T_NoSavePlan,
  T_NoCreateItem,
  T_NoUpdateItem,
  T_NoInsertItemAt,
  T_NoMoveItem,
  T_NoRemoveItem,
  T_NoAddItem,
  T_NoReorderPlan,
  T_NoWriteContract,
  T_PfCreateParamsFrozen,
  T_PfCreateReturnsRecord,
  T_PfCreateArityOne,
  T_RcParamsFrozen,
  T_RcReturnsRun,
  T_PfParamsNoBase,
  T_PfParamsNoBasePlanObjects,
  T_PfParamsNoBasePlanObjects_Camel,
  T_PfParamsNoBaseGitCommit,
  T_PfParamsNoBaseGitCommit_Camel,
] = [
  true, true, true,
  true, true, true, true, true, true, true, true, true,
  true, true, true,
  true, true,
  true, true, true, true, true,
]
void _typeSurface

/* ------------------------------------------------------------------ *
 * 运行期审计
 * ------------------------------------------------------------------ */

/** The canonical plan writer vocabulary (the PlanStore face — 写口名原文). */
const PLAN_WRITE_VOCAB = [
  'savePlan',
  'createItem',
  'updateItem',
  'insertItemAt',
  'moveItem',
  'removeItem',
  'addItem',
  'reorderPlan',
  'writeContract',
] as const

/** Parameter keys that could name a canonical plan mutation (model-call syntax level). */
const PLAN_WRITE_PARAM_KEYS = [
  'ordered_items',
  'plan',
  'plan_items',
  'items_order',
  'reorder',
  'insert_at',
  'move_to',
  'delete_item',
  'plan_yaml',
  'base',
  'base_plan_objects',
] as const

describe('INV-PLAN-3 — 工具面类型证明 (Agent 无 canonical plan 写路径)', () => {
  it('deps face is exactly two ports (compile-time pin; runtime mirror: the composition accepts only those)', () => {
    // 运行时镜像: 依赖对象的键集 = 两个端口 (JS 调用者绕过类型的护栏)
    const deps = makeRecordingDeps()
    const { planForkCreateCalls, recordCheckpointCalls, setPlanForkCreate, setRecordCheckpoint, ...ports } = deps
    void planForkCreateCalls
    void recordCheckpointCalls
    void setPlanForkCreate
    void setRecordCheckpoint
    expect(Object.keys(ports).sort()).toEqual(['planForkCreate', 'recordCheckpoint'])
  })

  it('no tool parameter key can name a canonical plan mutation (模型调用语法层)', () => {
    const tools = createResearchTools(makeRecordingDeps())
    for (const tool of tools) {
      const keys = Object.keys(tool.parameters as ToolParameters)
      for (const forbidden of PLAN_WRITE_PARAM_KEYS) {
        expect(keys, `${tool.name} must not expose a "${forbidden}" parameter`).not.toContain(forbidden)
      }
    }
  })

  it('the module export surface carries no plan-write / select / dismiss vocabulary', () => {
    const exportNames = Object.keys(toolsModule).map((n) => n.toLowerCase())
    for (const forbidden of [...PLAN_WRITE_VOCAB, 'select', 'dismiss', 'reorder', 'restore', 'promote']) {
      const offenders = exportNames.filter((n) => n.includes(forbidden))
      expect(offenders, `forbidden token "${forbidden}" in the tools module export surface`).toEqual([])
    }
  })

  it('the 11 composed tool names are the frozen §7.2 list (nothing plan-write exists to compose)', () => {
    const tools = createResearchTools(makeRecordingDeps())
    expect(tools.map((t) => t.name)).toEqual(RESEARCH_TOOL_NAMES)
  })

  it('positive pin: the domain layer DOES own the plan writers — the absence is reachability, not vocabulary', () => {
    // The reorder face on PlanStore is savePlan(orderedItems) — 「reorder」
    // is a semantic label, not a method name; the audit vocabulary maps to
    // the real method where the name differs.
    const PROTOTYPE_FACE: Record<string, object> = {
      savePlan: PlanStore.prototype,
      createItem: PlanStore.prototype,
      updateItem: PlanStore.prototype,
      insertItemAt: PlanStore.prototype,
      moveItem: PlanStore.prototype,
      removeItem: PlanStore.prototype,
      addItem: PlanStore.prototype,
      reorderPlan: PlanStore.prototype, // semantic = savePlan(orderedItems)
      writeContract: MergeContractStore.prototype,
    }
    for (const [writer, face] of Object.entries(PROTOTYPE_FACE)) {
      expect(
        writer === 'reorderPlan' ? 'savePlan' in face : writer in face,
        `the domain writer "${writer}" must exist (the user lane) for the audit to be meaningful`,
      ).toBe(true)
    }
  })
})
