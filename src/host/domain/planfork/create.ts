/**
 * WP-3.1 — PlanFork 创建校验: PLAN_FORK_SPEC §4 八步, 原文逐步实现的
 * 纯函数链 + 编排器。
 *
 * 输入 (§4 原文, 逐字): `workstream_id`, `fork_anchor`, `merge_anchor`,
 * `proposed_items[]`, `trigger_refs[]`, `reason`, `necessity` (+ 调用上下
 * 文中的 actor/run = `createdByRun`)。**无 base 参数** (INV-PLAN-6:
 * 「不接受客户端提交 base — INV-PLAN-6 的结构性保证」) — 类型面
 * (`CreatePlanForkParams` 无 base 键) + 运行时冻结输入面守卫
 * (`assertFrozenInputSurface`, 对 JS 调用者绕过类型也拒绝未知键, 点名
 * INV-PLAN-6) 双保险; tests/planfork/inv-plan-6.test.ts 双钉。
 *
 * 校验顺序 (§4 原文: 「任一失败即拒绝, 错误信息指明失败项」):
 *   1. policy `enabled = true`;
 *   2. `workstream_id` 存在且 canonical plan 已加载;
 *   3. **基准由服务端重算**: 当前 closure 的 blob OID 集合 (注入
 *      `ClosureBlobCapturer` — production = git 层 hash-object,
 *      GIT_INTEGRATION §7);
 *   4. `proposed_items` 非空有序; `KEEP.ref` 必须存在于当前 canonical
 *      (anchor 哨兵策略校验同 §2.2 — 见步骤 5); `NEW.spec` 通过对应
 *      item schema 校验 (冻结 $defs/NewItemSpec<kind>);
 *   5. anchor 合法 (§2.2: 哨兵或 canonical 存在的 id + fork 序号 ≤ merge
 *      序号, 相等 = 纯插入) 且满足 policy 的 anchor 约束
 *      (allow_boundary_sentinels / required_item_types);
 *   6. `trigger_refs` ≥1 (policy require_at_least_one) 且全部存在
 *      (注入 `TriggerRefResolver`), kind ∈ policy 允许集合 (默认
 *      CLAIM/FACT/ARTIFACT/MILESTONE/OBJECTIVE);
 *   7. `reason`, `necessity` 非空;
 *   8. `created_by_run` 存在且**属于该 workstream** (formal run,
 *      DOMAIN_SCHEMA §6.1 绑定 — 注入 `FormalRunLookup`)。
 *
 * **new_plan 不在本 WP 计算** (任务边界 + §4 原文核查): §4 八步中**没有**
 * new_plan 预演步骤 — new_plan 的拼接公式是 §6.3 SELECT 物化流程的公式
 * (属 WP-3.4: 正式 ID 分配 + 定义文件原子写入 + plan.yaml 重写)。本 WP
 * 提供的 `derivePlanForkChanges` (anchors.ts) 只做**变更形态分类**
 * (INSERT/MOVE/DELETE, §2.1 原文表达) 与位置推导, 不产出 new_plan。
 *
 * 八步全部通过后: 「分配 PF id, status=OPEN, append 写入 operational DB;
 * 记录 ManagementAction(PF_CREATED)」(§4 原文) — id 分配 + 双写事务由
 * store.ts `PlanForkStore.createPlanFork` 执行 (本文件只交付纯校验链 +
 * draft; id 未分配时记录不完整, 故 draft 类型 = Omit<PlanForkRecord,'id'>)。
 *
 * 插件只做上述**机械校验** (引用存在、字段存在、拓扑合法), 不判断科研
 * 理由是否正确 (INV-SCI-2) — `reason`/`necessity` 只查非空 (step 7)。
 *
 * 额外机械约束 (超出 §4 字面、由 §2.2/§4.4 必然推出, 决策记录见报告):
 *   - `KEEP.ref` 必须位于替换**开区间** (fork, merge) 内 — 区间外的
 *     canonical item 若被 KEEP, 物化后计划将**重复列出**该 item
 *     (§4.4 「无重复」违例, SELECT 必失败); 纯插入时开区间为空 ⇒
 *     proposed_items 只可含 NEW (否则同样重复)。码 PF_KEEP_REF_OUTSIDE_SPAN。
 *   - `KEEP.ref` 不得重复 (同样 ⇒ 物化后重复列出)。码 PF_KEEP_REF_DUPLICATE。
 *
 * Pure: zero I/O (全部上下文经 `PlanForkCreationContext` 注入)。
 */

import { parseId } from '../../../shared/ids/index.js'

import {
  assertPolicyEnabled,
  applyAnchorPolicy,
  applyTriggerPolicy,
  type AgentPlanForkPolicy,
} from './policy.js'
import {
  anchorItemKind,
  closureRelativePaths,
  isBoundarySentinel,
  resolveAnchors,
  type AnchorResolution,
} from './anchors.js'
import type {
  CanonicalPlanView,
  ClosureBlobBase,
  ClosureBlobCapturer,
  CreateStep,
  FormalRunLookup,
  FormalRunView,
  PlanForkRecord,
  PlanForkTriggerKind,
  ProposedItem,
  TriggerRef,
  TriggerRefResolver,
} from './types.js'
import { PlanForkError } from './types.js'
import type { PlanForkSchemas } from './schemas.js'

/* ------------------------------------------------------------------ *
 * Creation input (frozen surface — INV-PLAN-6)
 * ------------------------------------------------------------------ */

/**
 * The EXACT creation input (§4 原文 8 字段, camelCase 参数面 — 行记录是
 * snake_case, 参数面沿用 WP-2.4 服务的 camelCase 惯例)。
 *
 * **INV-PLAN-6 (类型面)**: 本接口**没有** base / basePlanObjects /
 * base_plan_objects / baseGitCommit 之类的键 — 基准永远由服务端在 step 3
 * 重算 (capturer 注入)。tests/planfork/inv-plan-6.test.ts 的编译期断言
 * 钉死这一点 (任何 base 键进入本接口 ⇒ tsc 红)。
 */
export interface CreatePlanForkParams {
  /** WS id (step 2: 存在且 canonical plan 已加载)。 */
  readonly workstreamId: string
  /** Anchor token: canonical item id (T/G/M) 或 `__START__`/`__END__` (§2.2). */
  readonly forkAnchor: string
  /** 同上; 序号 ≥ forkAnchor (相等 = 纯插入). */
  readonly mergeAnchor: string
  /** 有序替换内容 (step 4)。 */
  readonly proposedItems: readonly ProposedItem[]
  /** 触发引用 (step 6; kind ∈ 5 种, 须存在)。 */
  readonly triggerRefs: readonly TriggerRef[]
  /** 非空 (step 7)。 */
  readonly reason: string
  /** 非空 (step 7)。 */
  readonly necessity: string
  /** 调用上下文 run (step 8: 存在且属于该 workstream 的 formal run)。 */
  readonly createdByRun: string
}

/**
 * The FROZEN input key set — `CreatePlanForkParams` 的运行时镜像
 * (文档 + 运行时守卫的依据; 类型面才是权威, 本元组随类型演进)。
 */
export const CREATE_PARAM_KEYS = [
  'workstreamId',
  'forkAnchor',
  'mergeAnchor',
  'proposedItems',
  'triggerRefs',
  'reason',
  'necessity',
  'createdByRun',
] as const

/**
 * Runtime guard for the frozen input surface (INV-PLAN-6 的运行时半边):
 * a JS caller that bypasses the TS type and smuggles extra keys (in
 * particular any `base*` key) is refused with the first unknown key named
 * and the invariant cited. The frozen 8 keys above are the ONLY surface.
 */
export function assertFrozenInputSurface(params: unknown): asserts params is CreatePlanForkParams {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new PlanForkError({
      code: 'PF_INPUT',
      message: `createPlanFork params must be an object with exactly the frozen §4 input keys [${CREATE_PARAM_KEYS.join(', ')}]`,
    })
  }
  const keys = Object.keys(params as Record<string, unknown>).sort()
  const allowed = new Set<string>(CREATE_PARAM_KEYS)
  for (const key of keys) {
    if (!allowed.has(key)) {
      const baseNote = /base/i.test(key)
        ? ` — a base is NEVER an input: 基准由服务端重算 (PLAN_FORK_SPEC §4 步骤 3 / ARCHITECTURE §5.4 INV-PLAN-6)`
        : ''
      throw new PlanForkError({
        code: 'PF_INPUT',
        path: `/${key}`,
        message:
          `createPlanFork input has unknown key ${JSON.stringify(key)} — the frozen §4 input surface is exactly ` +
          `[${CREATE_PARAM_KEYS.join(', ')}]${baseNote}`,
      })
    }
  }
  if (keys.length !== CREATE_PARAM_KEYS.length) {
    throw new PlanForkError({
      code: 'PF_INPUT',
      message: `createPlanFork input is missing frozen §4 keys — expected exactly [${CREATE_PARAM_KEYS.join(', ')}], got [${keys.join(', ')}]`,
    })
  }
}

/* ------------------------------------------------------------------ *
 * Creation context (injected — the 8 steps' read side)
 * ------------------------------------------------------------------ */

/**
 * The read-side context the 8 steps consume (all server-side, fresh — no
 * caller-supplied plan/base/policy state):
 *   - `policy`  — 已装载的 AgentPlanForkPolicy (defaults 物化; §4 step 1/5/6);
 *   - `plan`    — 现读的 canonical plan 视图 (§4 step 2; INV-PLAN-1 逐字顺序);
 *   - `schemas` — 冻结 operational plan-fork schema 面 (step 4 NEW.spec);
 *   - `baseCapturer` — 服务端 closure blob 捕获 (step 3; INV-PLAN-6);
 *   - `triggerRefResolver` — trigger 存在性 (step 6; §16.3);
 *   - `formalRunLookup` — formal run 登记 (step 8; §6.1);
 *   - `now` — 时钟 (created_at epoch ms — A-3 修订; §1.2)。
 */
export interface PlanForkCreationContext {
  readonly policy: AgentPlanForkPolicy
  readonly plan: CanonicalPlanView
  readonly schemas: PlanForkSchemas
  readonly baseCapturer: ClosureBlobCapturer
  readonly triggerRefResolver: TriggerRefResolver
  readonly formalRunLookup: FormalRunLookup
  readonly now: () => number
}

/** The validated creation draft (八步通过; id 尚未分配 — §4 「通过后: 分配 PF id」). */
export type PlanForkDraft = Omit<PlanForkRecord, 'id'>

/* ------------------------------------------------------------------ *
 * The eight steps (原文逐步; 每个函数只做自己那一步, 失败即抛
 * PlanForkError — code + step + path 指明失败项)
 * ------------------------------------------------------------------ */

/** Step 1 — policy `enabled = true` (§4 原文). */
export function step1_policyEnabled(policy: AgentPlanForkPolicy): void {
  assertPolicyEnabled(policy)
}

/** Step 2 — `workstream_id` 存在且 canonical plan 已加载 (§4 原文). */
export function step2_workstreamAndPlan(
  params: CreatePlanForkParams,
  plan: CanonicalPlanView,
): void {
  if (plan.workstream_id !== params.workstreamId) {
    throw new PlanForkError({
      code: 'PF_INPUT',
      step: 2,
      path: '/workstream_id',
      message: `context canonical plan view is for ${JSON.stringify(plan.workstream_id)} but params request ${JSON.stringify(params.workstreamId)} — load the plan of the requested workstream`,
    })
  }
  if (!plan.workstream_exists) {
    throw new PlanForkError({
      code: 'PF_WORKSTREAM_MISSING',
      step: 2,
      path: '/workstream_id',
      message:
        `workstream_id=${JSON.stringify(params.workstreamId)} not found (no workstream directory) ` +
        `— creation refused (PLAN_FORK_SPEC §4 步骤 2)`,
    })
  }
  if (!plan.present) {
    throw new PlanForkError({
      code: 'PF_PLAN_NOT_LOADED',
      step: 2,
      path: '/workstream_id',
      message:
        `workstream ${JSON.stringify(params.workstreamId)} exists but its canonical plan is not loaded ` +
        `(no plan.yaml) — a plan fork needs a loaded canonical plan (PLAN_FORK_SPEC §4 步骤 2)`,
    })
  }
  if (!plan.consistent) {
    throw new PlanForkError({
      code: 'PF_PLAN_INCONSISTENT',
      step: 2,
      path: '/workstream_id',
      message:
        `canonical plan of ${JSON.stringify(params.workstreamId)} is loaded but inconsistent: ${plan.problem ?? 'unspecified'} ` +
        `— a plan fork may only be based on a consistent canonical plan (DOMAIN_SCHEMA §4.4; PLAN_FORK_SPEC §4 步骤 2)`,
    })
  }
}

/**
 * Step 3 — 基准由服务端重算 (§4 原文, INV-PLAN-6 的结构性保证): 计算
 * §3.1 closure 路径 (本模块 `closureRelativePaths`) 并经注入 capturer 捕获
 * working-copy blob OID 集合 + 信息性 HEAD。客户端提交的 base 不存在于
 * 输入面 (INV-PLAN-6) — 这里的基准**只能**来自 capturer。
 */
export function step3_captureBase(
  params: CreatePlanForkParams,
  plan: CanonicalPlanView,
  capturer: ClosureBlobCapturer,
): ClosureBlobBase {
  void params
  const closure = closureRelativePaths(plan.wsDir, plan.ordered_items)
  let base: ClosureBlobBase
  try {
    base = capturer.capture(plan.wsDir, closure)
  } catch (cause) {
    throw new PlanForkError({
      code: 'PF_BASE_CAPTURE',
      step: 3,
      message:
        `server-side closure base capture failed for ${JSON.stringify(plan.workstream_id)} ` +
        `(${closure.length} closure files): ${cause instanceof Error ? cause.message : String(cause)} ` +
        `(PLAN_FORK_SPEC §4 步骤 3/§3.2; 基准永远重算, 不接受客户端提交 base — INV-PLAN-6)`,
      cause,
    })
  }
  if (base === null || base === undefined || !Array.isArray(base.objects) || base.objects.length === 0) {
    throw new PlanForkError({
      code: 'PF_BASE_CAPTURE',
      step: 3,
      message: `capturer returned an empty base closure for ${JSON.stringify(plan.workstream_id)} — the closure always contains at least plan.yaml (PLAN_FORK_SPEC §3.1)`,
    })
  }
  return base
}

/**
 * Step 4 — proposed_items 校验 (§4 原文):
 *   - 非空 (空 ⇒ PF_ITEMS_EMPTY; schema minItems 1 同型);
 *   - 逐项 (有序 — 顺序即物化顺序): 外层形状过冻结 $defs/ProposedItem
 *     (shape 违例 ⇒ PF_SPEC_INVALID, 精确 path);
 *   - KEEP: kind ↔ ref 前缀一致 (类型一致性 ⇒ PF_ITEM_KIND_MISMATCH) →
 *     ref 存在于当前 canonical (⇒ PF_KEEP_REF_MISSING) → ref 位于替换
 *     开区间 (fork, merge) 内 (⇒ PF_KEEP_REF_OUTSIDE_SPAN; 纯插入时开区间
 *     为空 ⇒ KEEP 一律不合法) → 无重复 ref (⇒ PF_KEEP_REF_DUPLICATE);
 *   - NEW: spec 过**对应 kind** 的冻结 item spec schema (⇒ PF_SPEC_INVALID;
 *     kind↔spec 对应由「按声明 kind 校验」机械保证)。
 * 开区间端点需要 resolved anchors — 先做一次**存在性+顺序**解析
 * (与 step 5 同一解析; step 5 再做 policy 半边)。
 */
export function step4_proposedItems(
  params: CreatePlanForkParams,
  plan: CanonicalPlanView,
  schemas: PlanForkSchemas,
  resolution: AnchorResolution | null,
): void {
  const items = params.proposedItems
  if (items.length === 0) {
    throw new PlanForkError({
      code: 'PF_ITEMS_EMPTY',
      step: 4,
      path: '/proposed_items',
      message: 'proposed_items is empty — a plan fork must propose a non-empty ordered replacement (PLAN_FORK_SPEC §4 步骤 4; frozen minItems 1)',
    })
  }
  // 开区间成员集 — 仅在 anchors 可解析时可得 (resolution === null 时由
  // 编排器把 step 5 的存在性/顺序失败**延迟**到 step 4 之后抛出, 保持 §4
  // 原文的报错优先级; 此时只做不依赖 span 的 KEEP 子检查)。
  const spanItems =
    resolution === null ? null : new Set(plan.ordered_items.slice(resolution.forkIndex + 1, resolution.mergeIndex))
  const seenKeepRefs = new Map<string, number>()
  items.forEach((item, i) => {
    const pointer = `/proposed_items/${i}`
    // NEW 项先跑**对应 kind 的 spec 校验** (精确定位到 /spec 子字段),
    // 再跑外层 oneOf 形状校验 (item 级额外键/未知 action 等); 顺序保证
    // 「NEW.spec 通过对应 item schema 校验」(§4 原文) 的报错位置最精确
    // (oneOf 失败只会指到 item 级)。
    const isNew = typeof item === 'object' && item !== null && (item as { action?: unknown }).action === 'NEW'
    if (isNew) {
      const newIt = item as Extract<ProposedItem, { action: 'NEW' }>
      checkNewSpec(schemas, newIt.kind, newIt.spec, i, pointer)
    }
    if (schemas.isUsable) {
      const shape = schemas.checkProposedItem(item)
      if (!shape.ok) {
        throw new PlanForkError({
          code: 'PF_SPEC_INVALID',
          step: 4,
          path: pointer,
          message: `proposed_items[${i}] fails the frozen ProposedItem schema: ${shape.errors.map((e) => `${e.path || '/'}: ${e.message}`).join(' | ')}`,
        })
      }
    } else {
      throw new PlanForkError({
        code: 'PF_SCHEMA_UNAVAILABLE',
        step: 4,
        path: pointer,
        message: 'frozen plan-fork schema set unavailable — proposed_items cannot be validated (see PlanForkSchemas.loadErrors)',
      })
    }
    if (item.action === 'KEEP') {
      checkKeepRef(params, plan, item.ref, i, pointer, spanItems, resolution, seenKeepRefs)
    }
  })
}

function checkKeepRef(
  params: CreatePlanForkParams,
  plan: CanonicalPlanView,
  ref: string,
  i: number,
  pointer: string,
  spanItems: ReadonlySet<string> | null,
  resolution: AnchorResolution | null,
  seen: Map<string, number>,
): void {
  const item = params.proposedItems[i]!
  if (item.action !== 'KEEP') return
  // 类型一致性: ref 前缀 must match the declared kind (shared/ids parse).
  const parsed = parseId(ref)
  const expected = item.kind
  if (parsed === null || parsed.kind !== expected) {
    throw new PlanForkError({
      code: 'PF_ITEM_KIND_MISMATCH',
      step: 4,
      path: `${pointer}/ref`,
      message:
        `proposed_items[${i}].ref=${JSON.stringify(ref)} has id kind ${parsed === null ? '(unparseable)' : parsed.kind} ` +
        `but declared kind ${JSON.stringify(expected)} — 类型一致性 (DOMAIN_SCHEMA §4.4/§1.1)`,
    })
  }
  if (!plan.ordered_items.includes(ref)) {
    throw new PlanForkError({
      code: 'PF_KEEP_REF_MISSING',
      step: 4,
      path: `${pointer}/ref`,
      message:
        `proposed_items[${i}].ref=${JSON.stringify(ref)} does not exist in the current canonical ordered_items ` +
        `of ${JSON.stringify(plan.workstream_id)} (PLAN_FORK_SPEC §4 步骤 4: KEEP.ref 必须存在于当前 canonical)`,
    })
  }
  if (spanItems !== null && resolution !== null && !spanItems.has(ref)) {
    throw new PlanForkError({
      code: 'PF_KEEP_REF_OUTSIDE_SPAN',
      step: 4,
      path: `${pointer}/ref`,
      message:
        `proposed_items[${i}].ref=${JSON.stringify(ref)} is not inside the replacement span ` +
        `(${JSON.stringify(resolution.forkAnchor)}, ${JSON.stringify(resolution.mergeAnchor)}) — keeping an ` +
        `outside-span item would LIST IT TWICE in the materialized plan (DOMAIN_SCHEMA §4.4 无重复; ` +
        `纯插入时 span 为空, proposed_items 只可含 NEW) (PLAN_FORK_SPEC §2.2)`,
    })
  }
  const firstAt = seen.get(ref)
  if (firstAt !== undefined) {
    throw new PlanForkError({
      code: 'PF_KEEP_REF_DUPLICATE',
      step: 4,
      path: `${pointer}/ref`,
      message: `proposed_items[${i}].ref=${JSON.stringify(ref)} is already KEEP-referenced at proposed_items[${firstAt}] — a duplicate would list the item twice in the materialized plan (DOMAIN_SCHEMA §4.4 无重复)`,
    })
  }
  seen.set(ref, i)
}

function checkNewSpec(
  schemas: PlanForkSchemas,
  kind: string,
  spec: unknown,
  i: number,
  pointer: string,
): void {
  const kindOk = kind === 'TASK' || kind === 'GATE' || kind === 'MILESTONE'
  if (!kindOk) {
    throw new PlanForkError({
      code: 'PF_SPEC_INVALID',
      step: 4,
      path: `${pointer}/kind`,
      message: `proposed_items[${i}].kind=${JSON.stringify(String(kind))} is not a plan item kind (TASK|GATE|MILESTONE) (frozen schema enum)`,
    })
  }
  const shape = schemas.checkNewItemSpec(kind, spec)
  if (!shape.ok) {
    throw new PlanForkError({
      code: 'PF_SPEC_INVALID',
      step: 4,
      path: `${pointer}/spec`,
      message:
        `proposed_items[${i}] (NEW ${kind}) spec fails the frozen NewItemSpec${kind} schema: ` +
        `${shape.errors.map((e) => `${e.path || '/'}: ${e.message}`).join(' | ')} (PLAN_FORK_SPEC §4 步骤 4: NEW.spec 通过对应 item schema 校验)`,
    })
  }
}

/**
 * Step 5 — anchor 合法 (§2.2) 且满足 policy 的 anchor 约束 (§4 原文):
 *   - 解析 (存在性 + 顺序) 由 anchors.ts `resolveAnchors` 承担 (step 4 已
 *     解析一次, 这里复用 — 解析是纯函数且幂等);
 *   - policy 半边: 哨兵开关 + required_item_types (policy.ts
 *     `applyAnchorPolicy`), 逐 anchor 报告 (fork 先于 merge)。
 */
export function step5_anchors(
  params: CreatePlanForkParams,
  policy: AgentPlanForkPolicy,
  resolution: AnchorResolution,
): void {
  // 存在性 + 顺序 已由 anchors.ts `resolveAnchors` 钉死 (编排器在 step 4
  // 之后、本函数之前抛出延迟的解析失败); 本函数只做 policy 半边。
  for (const [name, anchor] of [
    ['fork_anchor', params.forkAnchor],
    ['merge_anchor', params.mergeAnchor],
  ] as const) {
    const sentinel = isBoundarySentinel(anchor)
    applyAnchorPolicy(policy, name, anchor, sentinel, sentinel ? null : anchorItemKind(anchor))
  }
  void resolution
}

/**
 * Step 6 — trigger_refs (§4 原文):
 *   - policy `require_at_least_one` 时 ≥1 (PF_TRIGGERS_EMPTY);
 *   - 逐项: kind ∈ policy `allowed_kinds` (PF_TRIGGER_KIND_FORBIDDEN) →
 *     kind ↔ id 前缀一致 (PF_TRIGGER_REF_INVALID) → 存在
 *     (PF_TRIGGER_MISSING, §16.3 写入时校验)。
 */
export function step6_triggerRefs(
  params: CreatePlanForkParams,
  policy: AgentPlanForkPolicy,
  resolver: TriggerRefResolver,
): void {
  const refs = params.triggerRefs
  applyTriggerPolicy(policy, refs)
  refs.forEach((ref, i) => {
    const pointer = `/trigger_refs/${i}`
    if (!isFrozenTriggerKind(ref.kind)) {
      throw new PlanForkError({
        code: 'PF_TRIGGER_KIND_FORBIDDEN',
        step: 6,
        path: `${pointer}/kind`,
        message: `trigger_refs[${i}].kind=${JSON.stringify(String(ref.kind))} is not one of the 5 frozen trigger kinds (CLAIM|FACT|ARTIFACT|MILESTONE|OBJECTIVE) (frozen schema)`,
      })
    }
    const parsed = parseId(ref.id)
    if (parsed === null || parsed.kind !== ref.kind) {
      throw new PlanForkError({
        code: 'PF_TRIGGER_REF_INVALID',
        step: 6,
        path: `${pointer}/id`,
        message:
          `trigger_refs[${i}].id=${JSON.stringify(ref.id)} has id kind ${parsed === null ? '(unparseable)' : parsed.kind} ` +
          `but declared kind ${JSON.stringify(ref.kind)} — 类型一致性 (DOMAIN_SCHEMA §1.1/§7)`,
      })
    }
    if (!resolver.exists(ref)) {
      throw new PlanForkError({
        code: 'PF_TRIGGER_MISSING',
        step: 6,
        path: pointer,
        message:
          `trigger_refs[${i}] {kind: ${JSON.stringify(ref.kind)}, id: ${JSON.stringify(ref.id)}} does not exist — ` +
          `trigger refs must all exist (PLAN_FORK_SPEC §4 步骤 6; DOMAIN_SCHEMA §16.3 写入时校验)`,
      })
    }
  })
}

function isFrozenTriggerKind(kind: string): kind is PlanForkTriggerKind {
  return kind === 'CLAIM' || kind === 'FACT' || kind === 'ARTIFACT' || kind === 'MILESTONE' || kind === 'OBJECTIVE'
}

/** Step 7 — `reason`, `necessity` 非空 (§4 原文). */
export function step7_texts(params: CreatePlanForkParams): void {
  if (typeof params.reason !== 'string' || params.reason.length === 0) {
    throw new PlanForkError({
      code: 'PF_REASON_EMPTY',
      step: 7,
      path: '/reason',
      message: 'reason is empty — a plan fork proposal requires a non-empty reason (PLAN_FORK_SPEC §4 步骤 7; DOMAIN_SCHEMA §5)',
    })
  }
  if (typeof params.necessity !== 'string' || params.necessity.length === 0) {
    throw new PlanForkError({
      code: 'PF_NECCESSITY_EMPTY',
      step: 7,
      path: '/necessity',
      message: 'necessity is empty — a plan fork proposal requires a non-empty necessity (PLAN_FORK_SPEC §4 步骤 7; DOMAIN_SCHEMA §5)',
    })
  }
}

/**
 * Step 8 — `created_by_run` 存在且属于该 workstream (§4 原文; formal run
 * 绑定 DOMAIN_SCHEMA §6.1). Returns the run view (the store records it in
 * the PF_CREATED ManagementAction actor).
 */
export function step8_createdByRun(params: CreatePlanForkParams, lookup: FormalRunLookup): FormalRunView {
  const run = lookup.get(params.createdByRun)
  if (run === null) {
    throw new PlanForkError({
      code: 'PF_RUN_NOT_FOUND',
      step: 8,
      path: '/created_by_run',
      message:
        `created_by_run=${JSON.stringify(params.createdByRun)} does not exist (no formal run row) — ` +
        `a plan fork proposal must be created BY a run (PLAN_FORK_SPEC §4 步骤 8; DOMAIN_SCHEMA §6.1)`,
    })
  }
  if (run.workstream_id !== params.workstreamId) {
    throw new PlanForkError({
      code: 'PF_RUN_WS_MISMATCH',
      step: 8,
      path: '/created_by_run',
      message:
        `created_by_run=${JSON.stringify(params.createdByRun)} belongs to ${JSON.stringify(run.workstream_id)} but the ` +
        `fork targets ${JSON.stringify(params.workstreamId)} — a formal run's workstream binding must match ` +
        `(PLAN_FORK_SPEC §4 步骤 8; DOMAIN_SCHEMA §6.1)`,
    })
  }
  return run
}

/* ------------------------------------------------------------------ *
 * Orchestrator — the 8 steps in frozen order, then the draft
 * ------------------------------------------------------------------ */

/**
 * Run the §4 八步 chain in order (任一失败即拒绝 — the FIRST violated
 * step throws PlanForkError with `step` + `path` 指明失败项). All eight
 * pass ⇒ the creation draft (record minus id — §4 「通过后: 分配 PF id」
 * is the store's job; status=OPEN, created_at = now() epoch ms, A-3)。
 *
 * The draft's `base_plan_objects` is the step-3 server-side capture
 * (INV-PLAN-5: 创建时刻 closure 的精确 (path, oid) 集合; 稳定顺序 =
 * closure 顺序 — capturer 必须按 `closureRelativePaths` 顺序回显)。
 */
export function validatePlanForkCreation(
  params: CreatePlanForkParams,
  ctx: PlanForkCreationContext,
): PlanForkDraft {
  assertFrozenInputSurface(params)

  // step 1 — policy enabled
  step1_policyEnabled(ctx.policy)

  // step 2 — workstream + canonical plan loaded (fresh server-side view)
  step2_workstreamAndPlan(params, ctx.plan)

  // step 3 — base recomputed server-side (INV-PLAN-6)
  const base = step3_captureBase(params, ctx.plan, ctx.baseCapturer)

  // Anchor resolution (step 5's existence+order half) is needed by step 4's
  // span check — BUT the §4 frozen error order puts step 4 BEFORE step 5:
  // a resolution failure is therefore DEFERRED (reported only when step 4
  // itself passes), so 「任一失败即拒绝」reports the earliest failed step.
  let resolution: AnchorResolution | null = null
  let deferredAnchorError: PlanForkError | null = null
  try {
    resolution = resolveAnchors(params.forkAnchor, params.mergeAnchor, ctx.plan.ordered_items)
  } catch (cause) {
    deferredAnchorError = cause instanceof PlanForkError ? cause : new PlanForkError({ code: 'PF_INPUT', message: String(cause), cause })
  }

  // step 4 — proposed_items (non-empty, KEEP refs, NEW specs; span sub-check
  // only when the anchors resolve — otherwise step 5's error leads)
  step4_proposedItems(params, ctx.plan, ctx.schemas, resolution)

  // step 5 — anchors: the deferred §2.2 existence/order failure (if any),
  // then the policy anchor constraints (both on the resolved pair)
  if (deferredAnchorError !== null) throw deferredAnchorError
  step5_anchors(params, ctx.policy, resolution!)

  // step 6 — trigger_refs (≥1 per policy, all exist, kind per policy)
  step6_triggerRefs(params, ctx.policy, ctx.triggerRefResolver)

  // step 7 — reason / necessity non-empty
  step7_texts(params)

  // step 8 — created_by_run exists and belongs to the workstream
  step8_createdByRun(params, ctx.formalRunLookup)

  // 八步通过 → draft (id 未分配; status=OPEN 初始态; created_at epoch ms)。
  return {
    workstream_id: params.workstreamId,
    base_plan_objects: base.objects,
    ...(base.gitCommit !== undefined ? { base_git_commit: base.gitCommit } : {}),
    fork_anchor: params.forkAnchor,
    merge_anchor: params.mergeAnchor,
    proposed_items: params.proposedItems,
    trigger_refs: params.triggerRefs,
    reason: params.reason,
    necessity: params.necessity,
    created_by_run: params.createdByRun,
    created_at: ctx.now(),
    status: 'OPEN',
  }
}

/** The step number of a PlanForkError (creation-path convenience). */
export function failedStep(error: PlanForkError): CreateStep | undefined {
  return error.step
}
