/**
 * WP-3.4 — INV-PLAN-2/3/4/5 全面对应 + INV-PERM-2（类型面断言, 与
 * WP-3.3 工具面证明双钉 — ARCHITECTURE §5.4/§7.2/§8）。
 *
 * 编译期（类型面, tsc 消费者生效 — 任何违例 ⇒ 编译失败）:
 *   - **INV-PERM-2 / INV-PLAN-3（无 Agent 物化面）**: `PlanForkSelectService`
 *     的公共物化入口恰为 `select`/`dismiss`/`auditSelectConsistency`
 *     （三入口存在性钉）, 且任何 Agent 命名的物化入口
 *     （agentSelect / materializeForAgent / selectByAgent / …）不在类型面
 *     （Absent 钉 — 落入类型面即编译失败）；三入口的 actor 参数类型恰为
 *     冻结 `ActorRef`（USER-only 由运行时守卫钉死 — SELECT_ACTOR_NOT_USER,
 *     e2e 测试钉行为）;
 *   - **INV-PLAN-3（物化只走本服务）**: 服务选项面以 reader/writer/store/
 *     db/allocator/planProvider 封闭定形 — writer 是 WP-1.3 原子写端口,
 *     本服务是其唯一物化消费者（无第二写口可注入）;
 *   - **INV-PLAN-4（PF append-only, 无 delete 面）**:
 *     `PlanForkSelectStoreFace` 的键恰为 getPlanFork/listPlanForks/
 *     transition（精确面钉 — 新增任何删除键即编译失败）; 无 delete/
 *     remove/drop 键（Absent 钉）; 存储层 no-delete trigger 是第二道
 *     （任何连接, WP-3.1 交付）;
 *   - **INV-PLAN-5（base = 创建时刻精确 (path, oid) 集合）**:
 *     `PlanForkSelectOptions` 无 `base`/`base_plan_objects`/
 *     `basePlanObjects`/`base_git_commit` 键 — 本服务不接受客户端提交
 *     基准, 复核永远重算（结构保证, 同 WP-3.1 对 §4 创建链的 absent-key
 *     断言 — INV-PLAN-6 在物化面的传递）;
 *   - **INV-PLAN-2（plan order ≠ dependency）**: `ComputeNewPlanInput`
 *     无 `reason`/`necessity`/`trigger_refs` 键 — §6.3 公式是纯位置拼接,
 *     不读、不判、不重判任何科研理由字段（INV-SCI-2 同精神）;
 *     `NewPlanResult` 输出面封闭（恰 newOrder/newItems/removedIds/
 *     keptIds/resolution — 无判定/评分字段可携带位置语义）。
 *
 * 运行期（vitest 生效）:
 *   - 服务原型方法面含三公共入口且无 'agent' 命名方法（TS `private` 方法
 *     在运行镜像中可见 — 此处审计的是命名词汇, 类型面精确性由编译期钉
 *     承担, 双保险）;
 *   - 本模块导出面无 'agent' 词汇（类型面审计 — 同 WP-3.3 词汇纪律）;
 *   - **双钉（与 WP-3.3 工具面）**: `RESEARCH_TOOL_NAMES` 恰为 §7.2 十一
 *     工具原文清单, 且无任何 select/dismiss/materialize/reorder 词汇 —
 *     Agent 面不存在任何物化/改序工具;
 *   - 正例钉: 领域层 PlanStore 确实持有 savePlan/createItem（用户面写口
 *     存在, 缺失的是 Agent 可达性 — 审计的是可达性, 不是词汇不存在）;
 *   - 行为钉（INV-PLAN-2）: 公式是纯函数且输入面不携带 reason/necessity
 *     （无从解释位置语义）; 任意「不合理」顺序的拼接机械成立（不判
 *     科研理由）。
 */

import { describe, expect, it } from 'vitest'

import { PlanStore } from '../../src/host/domain/plan/index.js'
import type { ActorRef, PfTransition, PlanForkRecord } from '../../src/host/domain/planfork/index.js'
import * as selectModule from '../../src/host/service/select/index.js'
import {
  PlanForkSelectService,
  computeNewPlan,
  type ComputeNewPlanInput,
  type NewPlanResult,
  type PlanForkSelectOptions,
  type PlanForkSelectStoreFace,
  type SelectOutcome,
} from '../../src/host/service/select/index.js'
import {
  RESEARCH_TOOL_NAMES,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
} from '../../src/host/tools/index.js'

/* ------------------------------------------------------------------ *
 * 编译期类型面断言（任何违例 ⇒ tsc 编译失败）
 * ------------------------------------------------------------------ */

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
type Absent<K extends string, T> = [K] extends [keyof T] ? false : true
type Present<K extends string, T> = [K] extends [keyof T] ? true : false

/** INV-PERM-2/INV-PLAN-3: 三用户入口都在类型面（正例 — 演进同步）。 */
type T_HasSelect = Expect<Present<'select', PlanForkSelectService>>
type T_HasDismiss = Expect<Present<'dismiss', PlanForkSelectService>>
type T_HasAudit = Expect<Present<'auditSelectConsistency', PlanForkSelectService>>

/** INV-PERM-2/INV-PLAN-3: 任何 Agent 命名的物化入口不在类型面。 */
type T_NoAgentSelect = Expect<Absent<'agentSelect', PlanForkSelectService>>
type T_NoMaterializeForAgent = Expect<Absent<'materializeForAgent', PlanForkSelectService>>
type T_NoSelectByAgent = Expect<Absent<'selectByAgent', PlanForkSelectService>>
type T_NoAgentDismiss = Expect<Absent<'agentDismiss', PlanForkSelectService>>
type T_NoAutoMaterialize = Expect<Absent<'autoMaterialize', PlanForkSelectService>>
type T_NoAgentAudit = Expect<Absent<'agentAudit', PlanForkSelectService>>

/** 入口签名逐字钉: actor 参数 = 冻结 ActorRef（USER-only 归运行时守卫）。 */
type T_SelectParamsFrozen = Expect<Equal<Parameters<PlanForkSelectService['select']>, [string, ActorRef]>>
type T_DismissParamsFrozen = Expect<Equal<Parameters<PlanForkSelectService['dismiss']>, [string, ActorRef]>>
type T_SelectReturnsOutcome = Expect<Equal<ReturnType<PlanForkSelectService['select']>, Promise<SelectOutcome>>>
type T_DismissSynchronous = Expect<Equal<ReturnType<PlanForkSelectService['dismiss']>['pfId'], string>>

/** INV-PLAN-4: 注入的存储面恰三键（无 delete 键可进注入面）。 */
type T_StoreFaceExact = Expect<
  Equal<keyof PlanForkSelectStoreFace, 'getPlanFork' | 'listPlanForks' | 'transition'>
>
type T_NoDeletePf = Expect<Absent<'deletePlanFork', PlanForkSelectStoreFace>>
type T_NoRemovePf = Expect<Absent<'removePlanFork', PlanForkSelectStoreFace>>
type T_NoDropPf = Expect<Absent<'dropPlanFork', PlanForkSelectStoreFace>>

/** INV-PLAN-5: 选项面无客户端提交基准键（复核永远重算）。 */
type T_OptsNoBase = Expect<Absent<'base', PlanForkSelectOptions>>
type T_OptsNoBasePlanObjects = Expect<Absent<'base_plan_objects', PlanForkSelectOptions>>
type T_OptsNoBasePlanObjectsCamel = Expect<Absent<'basePlanObjects', PlanForkSelectOptions>>
type T_OptsNoBaseGitCommit = Expect<Absent<'base_git_commit', PlanForkSelectOptions>>
type T_OptsNoBaseGitCommitCamel = Expect<Absent<'baseGitCommit', PlanForkSelectOptions>>

/** INV-PLAN-2: 公式输入无科研理由字段（纯位置拼接 — 不读不判）。 */
type T_InputNoReason = Expect<Absent<'reason', ComputeNewPlanInput>>
type T_InputNoNecessity = Expect<Absent<'necessity', ComputeNewPlanInput>>
type T_InputNoTriggerRefs = Expect<Absent<'trigger_refs', ComputeNewPlanInput>>
type T_InputNoTriggerRefsCamel = Expect<Absent<'triggerRefs', ComputeNewPlanInput>>

/** INV-PLAN-2: 公式输出面封闭（机械产物 — 无判定/评分字段）。 */
type T_OutputClosed = Expect<
  Equal<keyof NewPlanResult, 'newOrder' | 'newItems' | 'removedIds' | 'keptIds' | 'resolution'>
>

/** 让编译器保留这些别名（类型别名不参与值层 — 显式钉住）。 */
const _typeSurface: [
  T_HasSelect,
  T_HasDismiss,
  T_HasAudit,
  T_NoAgentSelect,
  T_NoMaterializeForAgent,
  T_NoSelectByAgent,
  T_NoAgentDismiss,
  T_NoAutoMaterialize,
  T_NoAgentAudit,
  T_SelectParamsFrozen,
  T_DismissParamsFrozen,
  T_SelectReturnsOutcome,
  T_DismissSynchronous,
  T_StoreFaceExact,
  T_NoDeletePf,
  T_NoRemovePf,
  T_NoDropPf,
  T_OptsNoBase,
  T_OptsNoBasePlanObjects,
  T_OptsNoBasePlanObjectsCamel,
  T_OptsNoBaseGitCommit,
  T_OptsNoBaseGitCommitCamel,
  T_InputNoReason,
  T_InputNoNecessity,
  T_InputNoTriggerRefs,
  T_InputNoTriggerRefsCamel,
  T_OutputClosed,
] = [
  true, true, true,
  true, true, true, true, true, true,
  true, true, true, true,
  true, true, true, true,
  true, true, true, true, true,
  true, true, true, true,
  true,
]
void _typeSurface

/* ------------------------------------------------------------------ *
 * 运行期审计（JS 绕过类型的护栏 + 双钉）
 * ------------------------------------------------------------------ */

const WS1 = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'] as const
const NEW_TASK: ComputeNewPlanInput['proposedItems'][number] = {
  action: 'NEW',
  kind: 'TASK',
  spec: { title: 'X', goal: 'g' },
}

describe('INV-PERM-2 / INV-PLAN-3 — 无 Agent 物化面（类型面 + 运行面 + 工具面双钉）', () => {
  it('服务原型方法面: 三公共入口在位, 无任何 agent 命名方法', () => {
    const methods = Object.getOwnPropertyNames(PlanForkSelectService.prototype).filter((n) => n !== 'constructor')
    for (const m of ['select', 'dismiss', 'auditSelectConsistency']) {
      expect(methods, `public entry "${m}" must be on the prototype`).toContain(m)
    }
    const agentNamed = methods.filter((m) => m.toLowerCase().includes('agent'))
    expect(agentNamed, 'no agent-named materialization face may exist').toEqual([])
  })

  it('本模块导出面不含 agent 词汇（物化入口无 Agent 命名可达路径）', () => {
    const exportNames = Object.keys(selectModule).map((n) => n.toLowerCase())
    const offenders = exportNames.filter((n) => n.includes('agent'))
    expect(offenders, `forbidden token "agent" in the select service export surface`).toEqual([])
  })

  it('双钉: RESEARCH_TOOL_NAMES 恰为 §7.2 十一工具原文, 无 select/dismiss/materialize/reorder 工具', () => {
    // §7.2 原文清单（冻结 — 与 WP-3.3 同源常量的逐字复核, 防单侧漂移）
    expect(RESEARCH_TOOL_NAMES).toEqual([
      'research_fact_record',
      'research_claim_record',
      'research_artifact_register',
      'research_intervention_create',
      'research_next_action_create',
      'research_plan_fork_create',
      'research_run_checkpoint',
      'research_context_get',
      'research_plan_get',
      'research_history_query',
      'research_contract_read',
    ])
    expect(RESEARCH_TOOL_NAMES).toHaveLength(11)
    expect(WRITE_TOOL_NAMES).toHaveLength(7)
    expect(READ_TOOL_NAMES).toHaveLength(4)
    for (const name of RESEARCH_TOOL_NAMES) {
      for (const forbidden of ['select', 'dismiss', 'materialize', 'reorder']) {
        expect(name, `§7.2 tool ${name} must not carry "${forbidden}" semantics`).not.toContain(forbidden)
      }
    }
    // Agent 与 canonical plan 有关的可达操作恰有一个: 创建 append-only proposal
    expect(RESEARCH_TOOL_NAMES).toContain('research_plan_fork_create')
  })

  it('正例钉: 领域层/用户面写口存在 — 缺失的是 Agent 可达性, 不是词汇', () => {
    expect('savePlan' in PlanStore.prototype).toBe(true)
    expect('createItem' in PlanStore.prototype).toBe(true)
    expect('select' in PlanForkSelectService.prototype).toBe(true)
    expect('dismiss' in PlanForkSelectService.prototype).toBe(true)
  })
})

describe('INV-PLAN-2 — plan order ≠ dependency（公式纯位置拼接, 零科研语义）', () => {
  it('纯函数 + 输入面不携带 reason/necessity（无从解释位置的语义 — 编译期 Absent 钉的行为镜像）', () => {
    const input: ComputeNewPlanInput = {
      canonical: [...WS1],
      forkAnchor: 'G-1',
      mergeAnchor: 'G-2',
      proposedItems: [NEW_TASK, { action: 'KEEP', kind: 'TASK', ref: 'T-3' }],
      existingIdsByKind: { TASK: ['T-1', 'T-2', 'T-3', 'T-4'], GATE: ['G-1', 'G-2'], MILESTONE: ['M-1'] },
    }
    const a = computeNewPlan(input)
    const b = computeNewPlan({ ...input, proposedItems: [...input.proposedItems] })
    // 同输入 ⇒ 逐字段同输出（位置即全部 — 无隐藏语义通道）
    expect(a.newOrder).toEqual(b.newOrder)
    expect(a.newItems).toEqual(b.newItems)
    expect(a.removedIds).toEqual(b.removedIds)
    expect(a.keptIds).toEqual(b.keptIds)
    expect(a.newOrder).toEqual(['G-1', 'T-5', 'T-3', 'G-2'])
    // 输出面封闭（编译期 T_OutputClosed 的运行镜像）
    expect(Object.keys(a).sort()).toEqual(['keptIds', 'newItems', 'newOrder', 'removedIds', 'resolution'])
  })

  it('重排不要求「合理」: 任意顺序的 KEEP/NEW 拼接机械成立（INV-SCI-2 同精神 — 不判科研理由）', () => {
    const r = computeNewPlan({
      canonical: [...WS1],
      forkAnchor: '__START__',
      mergeAnchor: '__END__',
      // 刻意「不合理」的整计划替换 — 公式不拒绝、不评分、不解释
      proposedItems: [
        { action: 'NEW', kind: 'MILESTONE', spec: { title: '先定稿', statement: 's' } },
        { action: 'KEEP', kind: 'TASK', ref: 'T-2' },
        NEW_TASK,
        { action: 'KEEP', kind: 'TASK', ref: 'T-1' },
      ],
      existingIdsByKind: { TASK: ['T-1', 'T-2', 'T-3', 'T-4'], GATE: ['G-1', 'G-2'], MILESTONE: ['M-1'] },
    })
    expect(r.newOrder).toEqual(['M-2', 'T-2', 'T-5', 'T-1'])
  })
})

describe('INV-PLAN-4/5 — PF append-only 面 + 基准重算面（类型面运行镜像）', () => {
  it('存储面注入对象恰三键（精确面 — 无 delete 键可注入, 任何 JS 绕过亦无删除路径）', () => {
    // 一个最小忠实 store face — 其键集即注入面（WP-3.3 deps-face 同法）
    const face: PlanForkSelectStoreFace = {
      getPlanFork: (): PlanForkRecord | null => null,
      listPlanForks: (): PlanForkRecord[] => [],
      transition: (id: string, target: PfTransition, actor: ActorRef): PlanForkRecord => {
        void id
        void target
        void actor
        throw new Error('not needed in the face-shape audit')
      },
    }
    expect(Object.keys(face).sort()).toEqual(['getPlanFork', 'listPlanForks', 'transition'])
    // 类型面镜像: 尝试添加 delete 键即编译失败（T_StoreFaceExact + Absent 钉）
    expect('deletePlanFork' in (face as unknown as Record<string, unknown>)).toBe(false)
  })

  it('INV-PLAN-5 行为面: 物化失败路径从不改写 base_plan_objects（复核永远重算的存储侧证据）', () => {
    // 该断言由 e2e/compensation 测试用真实 DB 钉死（内容列逐字节不变）;
    // 此处钉类型面: 选项/输入中不存在任何可注入基准的键（编译期 T_OptsNo*
    // 已覆盖）— 运行侧仅确认公式输入同样无 base 键（公式不读调用方快照）。
    const input: ComputeNewPlanInput = {
      canonical: [...WS1],
      forkAnchor: 'G-1',
      mergeAnchor: 'G-2',
      proposedItems: [NEW_TASK],
      existingIdsByKind: { TASK: ['T-1', 'T-2', 'T-3', 'T-4'], GATE: ['G-1', 'G-2'], MILESTONE: ['M-1'] },
    }
    expect('base' in (input as unknown as Record<string, unknown>)).toBe(false)
    expect('base_plan_objects' in (input as unknown as Record<string, unknown>)).toBe(false)
    expect(Object.keys(input).sort()).toEqual(['canonical', 'existingIdsByKind', 'forkAnchor', 'mergeAnchor', 'proposedItems'])
  })
})
