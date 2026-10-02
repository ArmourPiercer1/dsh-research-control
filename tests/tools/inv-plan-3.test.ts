/**
 * WP-3.3 — INV-PLAN-3 类型面证明: **Agent 无任何 API 可直接修改 canonical
 * plan** (reorder/insert/delete; ARCHITECTURE §5.4 INV-PLAN-3 「R+T」,
 * 本 WP 交付工具面半边).
 *
 * 编译期 (类型面, tsc/typecheck 消费者生效):
 *  - 依赖面的**写面**被钉死为恰好三个键 (planForkCreate /
 *    recordCheckpoint / semanticAgentCreate) — 任何 canonical plan 写口
 *    (PlanStore 的 savePlan/createItem/updateItem/insertItemAt/moveItem/
 *    removeItem/addItem 或 contract writer) 想进入工具层依赖面 ⇒ 编译
 *    失败; (G3 的 semanticAgentCreate 是语义创建窄端口 — 只建
 *    fact/claim/artifact, 无任何 plan 语义, 签名逐字钉死; G2 §2d 起
 *    依赖面共七个键: 上述三写面键 + 四个只读端口
 *    contextGet/planGet/historyQuery/contractRead — 每个只读端口的
 *    返回类型被逐字钉为投影 DTO, 签名里没有任何写参数/写返回;)
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
import type { ActorRef, CreateNextActionParams, NextActionRecord } from '../../src/host/service/actions/index.js'
import type {
  CreateInterventionResult,
  InterventionCreateParams,
  MechanicalActorRef,
} from '../../src/host/service/intervention/index.js'
import type { RunRecord, UserOrAgentActorRef } from '../../src/host/service/runbinding/index.js'
import type {
  RecordClaimArgs,
  RecordFactArgs,
  RegisterArtifactArgs,
  SemanticAgentActor,
} from '../../src/host/service/semantics/index.js'
import type {
  ToolHistoryPage,
  ToolHistoryQuery,
  ToolMergeContractView,
  ToolSessionContext,
  ToolWorkstreamPlanView,
} from '../../src/host/tools/read-ports.js'
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

/** INV-PLAN-3 核心钉 (G3+G2+G4 后): 工具层依赖面恰九个键 — 无 canonical
 *  plan 写口可注入 (写面 = planForkCreate / recordCheckpoint /
 *  semanticAgentCreate: G3 语义创建窄端口只建 fact/claim/artifact, 参数
 *  被冻结语义 args + 必传 trusted caller 逐字钉死, 无任何 plan 语义;
 *  G4 注意力写两端口 interventionCreate / nextActionCreate — 均无 plan
 *  写/promote/dismiss 语义; 读面 = G2 四个只读端口, 签名逐一钉为投影
 *  DTO). */
type T_DepsFaceExact = Expect<
  Equal<
    keyof ResearchToolDeps,
    | 'planForkCreate'
    | 'recordCheckpoint'
    | 'semanticAgentCreate'
    | 'contextGet'
    | 'planGet'
    | 'historyQuery'
    | 'contractRead'
    | 'interventionCreate'
    | 'nextActionCreate'
  >
>

/** 正例钉: 九个键都在 (演进同步). */
type T_HasPlanForkCreate = Expect<['planForkCreate'] extends [keyof ResearchToolDeps] ? true : false>
type T_HasRecordCheckpoint = Expect<['recordCheckpoint'] extends [keyof ResearchToolDeps] ? true : false>
type T_HasInterventionCreate = Expect<['interventionCreate'] extends [keyof ResearchToolDeps] ? true : false>
type T_HasNextActionCreate = Expect<['nextActionCreate'] extends [keyof ResearchToolDeps] ? true : false>
type T_HasSemanticAgentCreate = Expect<['semanticAgentCreate'] extends [keyof ResearchToolDeps] ? true : false>

/** G3 语义创建端口逐字钉: 每个方法 = (冻结语义 args, 必传 trusted caller),
 *  返回 = 服务结果; caller 类型 AGENT 硬约束 (USER 在类型面不可传入). */
type T_SemanticFactParams = Expect<
  Equal<Parameters<ResearchToolDeps['semanticAgentCreate']['recordFact']>, [RecordFactArgs, SemanticAgentActor]>
>
type T_SemanticClaimParams = Expect<
  Equal<Parameters<ResearchToolDeps['semanticAgentCreate']['recordClaim']>, [RecordClaimArgs, SemanticAgentActor]>
>
type T_SemanticArtifactParams = Expect<
  Equal<Parameters<ResearchToolDeps['semanticAgentCreate']['registerArtifact']>, [RegisterArtifactArgs, SemanticAgentActor]>
>

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

/** G4 注意力写端口逐字钉: 参数 = 冻结服务面, 返回 = 服务结果/记录 — 无 plan 写语义. */
type T_IvCreateParamsFrozen = Expect<
  Equal<Parameters<ResearchToolDeps['interventionCreate']>, [InterventionCreateParams, MechanicalActorRef]>
>
type T_IvCreateReturnsResult = Expect<Equal<ReturnType<ResearchToolDeps['interventionCreate']>, CreateInterventionResult>>
type T_NaCreateParamsFrozen = Expect<Equal<Parameters<ResearchToolDeps['nextActionCreate']>, [CreateNextActionParams, ActorRef]>>
type T_NaCreateReturnsRecord = Expect<Equal<ReturnType<ResearchToolDeps['nextActionCreate']>, NextActionRecord>>
/** G2 §2d 只读端口逐字钉: 参数只有 id 字符串, 返回只有投影 DTO —— 四个
 *  签名都不携带任何 plan/contract/history 写语义 (INV-PLAN-3 读面半边). */
type T_ContextGetFrozen = Expect<Equal<ResearchToolDeps['contextGet'], (sessionId: string) => ToolSessionContext>>
type T_PlanGetFrozen = Expect<Equal<ResearchToolDeps['planGet'], (workstreamId: string) => ToolWorkstreamPlanView>>
type T_HistoryQueryFrozen = Expect<Equal<ResearchToolDeps['historyQuery'], (query: ToolHistoryQuery) => ToolHistoryPage>>
type T_ContractReadFrozen = Expect<Equal<ResearchToolDeps['contractRead'], (edgeId: string) => ToolMergeContractView>>
/** planGet 的返回是 READ VIEW (ToolWorkstreamPlanView), 不是 PlanStore/PlanDoc:
 *  写方法在返回类型上不可达 (投影 DTO 无任何方法成员). */
type T_PlanGetReturnsView = Expect<Equal<ReturnType<ResearchToolDeps['planGet']>['ordered_items'], readonly string[]>>

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
  T_HasInterventionCreate,
  T_HasNextActionCreate,
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
  T_IvCreateParamsFrozen,
  T_IvCreateReturnsResult,
  T_NaCreateParamsFrozen,
  T_NaCreateReturnsRecord,
  T_ContextGetFrozen,
  T_PlanGetFrozen,
  T_HistoryQueryFrozen,
  T_ContractReadFrozen,
  T_PlanGetReturnsView,
  T_PfParamsNoBase,
  T_PfParamsNoBasePlanObjects,
  T_PfParamsNoBasePlanObjects_Camel,
  T_PfParamsNoBaseGitCommit,
  T_PfParamsNoBaseGitCommit_Camel,
] = [
  true, true, true, true, true,
  true, true, true, true, true, true, true, true, true,
  true, true, true,
  true, true,
  true, true, true, true,
  true, true, true, true, true,
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
  it('deps face is the frozen nine-port set (compile-time pin; runtime mirror: the composition accepts only those)', () => {
    // 运行时镜像: 依赖对象的键集 = 三个写面键 + G4 注意力写两端口 + 四个 G2
    // 只读端口 (JS 调用者绕过类型的护栏时, plan 写词汇依然不可达 — 只有这
    // 九个端口键).
    const deps = makeRecordingDeps()
    const {
      planForkCreateCalls,
      recordCheckpointCalls,
      interventionCreateCalls,
      nextActionCreateCalls,
      contextGetCalls,
      planGetCalls,
      historyQueryCalls,
      contractReadCalls,
      setPlanForkCreate,
      setRecordCheckpoint,
      setInterventionCreate,
      setNextActionCreate,
      setSemanticAgentCreate,
      setContextGet,
      setPlanGet,
      setHistoryQuery,
      setContractRead,
      ...ports
    } = deps
    void planForkCreateCalls
    void recordCheckpointCalls
    void interventionCreateCalls
    void nextActionCreateCalls
    void contextGetCalls
    void planGetCalls
    void historyQueryCalls
    void contractReadCalls
    void setPlanForkCreate
    void setRecordCheckpoint
    void setInterventionCreate
    void setNextActionCreate
    void setSemanticAgentCreate
    void setContextGet
    void setPlanGet
    void setHistoryQuery
    void setContractRead
    expect(Object.keys(ports).sort()).toEqual([
      'contextGet',
      'contractRead',
      'historyQuery',
      'interventionCreate',
      'nextActionCreate',
      'planForkCreate',
      'planGet',
      'recordCheckpoint',
      'semanticAgentCreate',
    ])
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
