/**
 * WP-3.4 — §6.3 修正版拼接公式（A-13 修订原文）：new_plan 计算（PURE，零 I/O）。
 *
 * Frozen contract（PLAN_FORK_SPEC §6.3 原文，逐句对照）：
 *
 *   > 3. **重写 plan.yaml**：
 *   >    `new_plan = canonical[..fork_anchor]（含 fork_anchor 的前缀）
 *   >              + materialized(proposed_items)
 *   >              + canonical[merge_anchor..]（含 merge_anchor 的后缀）`
 *   >    ——两 anchor 各保留一次；哨兵 `__START__`/`__END__` 按计划边界处理；
 *   > 特例 `fork_anchor == merge_anchor == X`（纯插入）：
 *   >    `new_plan = canonical[..X]（含） + materialized(proposed_items)
 *   >              + canonical[位于 X 之后的首个 item..]（含）`；
 *
 * 逐句映射（本模块实现）：
 *   - 「含 fork_anchor 的前缀」⇒ `prefix = canonical[0..forkIndex]`
 *     （0-based 闭区间 — `slice(0, forkIndex + 1)`）；
 *   - 「含 merge_anchor 的后缀」⇒ `suffix = canonical[mergeIndex..]`
 *     （`slice(mergeIndex)`，merge 在 suffix 首位）；
 *   - 「两 anchor 各保留一次」⇒ 通用式下 fork 在 prefix 末位、merge 在
 *     suffix 首位；开区间 `(fork, merge)` 内的 canonical items 被
 *     `materialized(proposed_items)` 整体替换（§2.2 替换区间语义）；
 *   - 「哨兵按计划边界处理」⇒ `__START__` 序号 -1（prefix 为空）/
 *     `__END__` 序号 n（suffix 为空）— 经 `anchorOrdinal`（WP-3.1）；
 *   - 「特例 fork_anchor == merge_anchor == X（纯插入）」⇒
 *     `prefix = canonical[0..X]`（含 X；X = -1 即双 `__START__` 时
 *     prefix 为空 — `min(X+1, n)`；X = n 即双 `__END__` 时 prefix 为
 *     全计划 — `min(n+1, n) = n`）、`suffix = canonical[X+1..]`
 *     （「位于 X 之后的首个 item..（含）」— `slice(X + 1)`；X = -1 时
 *     suffix = 全计划，X = n 时 suffix 为空）；
 *   - X 各保留**一次**（prefix 含 X、suffix 从 X 之后起 — 不重复）。
 *
 * 「materialized(proposed_items)」= 每个 proposed item 的物化 id：
 *   - `KEEP.ref` ⇒ 原 id（保持不变 — §2.1 原文「引用当前 canonical 中的
 *     item id，保持不变」；MOVE 形态 = KEEP 且物化位置 ≠ canonical 位置）；
 *   - `NEW`     ⇒ SELECT 时分配的正式 ID（§6.2 「T/G/M 各自的下一序号」
 *     — 本模块纯函数 `allocateNewIds`：per-kind 序号 = 该 WS 现有该 kind
 *     定义文件（**含未列入计划的保留文件** — INV-PLAN-9 长期保留 ⇒ 序号
 *     必须越过它们）的最大号 + 1，proposed 顺序消费）。
 *
 * 前置不变量（存储过的 OPEN PF 在 §4 八步下恒满足；本函数对 JS 调用者
 * 绕过类型的情况**大声失败**，不产出错误计划）：
 *   - proposed_items 非空（PF_ITEMS_EMPTY）；
 *   - anchor 存在 + fork 序号 ≤ merge 序号（resolveAnchors —
 *     PF_ANCHOR_MISSING/PF_ANCHOR_ORDER）；
 *   - KEEP.ref 存在（PF_KEEP_REF_MISSING）、kind ↔ ref 前缀一致
 *     （PF_ITEM_KIND_MISMATCH）、位于开区间 (fork, merge) 内
 *     （PF_KEEP_REF_OUTSIDE_SPAN — 区间外 KEEP ⇒ 物化后**重复列出**，
 *     §4.4 违例；纯插入时开区间为空 ⇒ KEEP 一律不合法）、无重复
 *     （PF_KEEP_REF_DUPLICATE）；
 *   - 结果序列无重复（防御性终检 — 上述规则已保证；违例 = 内部 bug，
 *     大声）。
 *
 * INV-PLAN-2（plan order ≠ dependency）：本公式是**纯位置拼接** — 不解释
 * 任何位置的科研含义，不校验 reason/necessity，不判断重排是否「合理」
 * （INV-SCI-2 同精神：插件只做机械操作）。
 *
 * 测试（tests/select/formula.test.ts）：§6.3 原文示例逐个 + §11 端到端
 * 示例必用（G-1,T-5,T-3,M-2,T-6,T-4,G-2）+ 与 WP-3.1
 * `derivePlanForkChanges` 的位置分类交叉验证（同一布局的两种视角）。
 */

import { parseId } from '../../../shared/ids/index.js'
import {
  PlanForkError,
  resolveAnchors,
  type AnchorResolution,
  type PlanForkItemKind,
  type ProposedItem,
} from '../../domain/planfork/index.js'
import type { NewPlanResult } from './types.js'

/* ------------------------------------------------------------------ *
 * §6.3 拼接（核心 — 已知 id 分配时的纯 slice 拼接）
 * ------------------------------------------------------------------ */

/**
 * 纯拼接（§6.3 修正版公式的字面实现）：
 *
 *   通用（fork 序号 < merge 序号）：
 *     `prefixLen   = forkIndex + 1`          「含 fork_anchor 的前缀」
 *     `suffixStart = mergeIndex`             「含 merge_anchor 的后缀」
 *   纯插入特例（fork 序号 == merge 序号 == X）：
 *     `prefixLen   = min(X + 1, n)`          「canonical[..X]（含）」
 *     `suffixStart = X + 1`                  「位于 X 之后的首个 item..（含）」
 *
 * `proposedIds` = 每个 proposed item 的物化 id（与 proposedItems 等长、
 * 同序 — KEEP.ref 或 NEW 的正式 ID）。返回 `prefix ++ proposedIds ++ suffix`。
 *
 * 哨兵边界（`forkIndex = -1` / `mergeIndex = n`）由上述下标公式自然吸收：
 * `slice(0, 0) = []`（`__START__` 前缀为空）、`slice(n) = []`
 * （`__END__` 后缀为空）、「双 `__START__` 纯插入」`slice(0, 0) + S +
 * slice(0)`、「双 `__END__` 纯插入」`slice(0, n) + S + slice(n+1)`。
 *
 * 前置：`resolution` 必须是对 `canonical` 的成功 `resolveAnchors` 结果
 * （否则切片下标无意义 — 调用方先解析；本函数不做重复解析，保持单一职责）。
 */
export function spliceNewPlan(
  canonical: readonly string[],
  resolution: AnchorResolution,
  proposedIds: readonly string[],
): string[] {
  const n = canonical.length
  const prefixLen = resolution.pureInsertion ? Math.min(resolution.mergeIndex + 1, n) : resolution.forkIndex + 1
  const suffixStart = resolution.pureInsertion ? resolution.mergeIndex + 1 : resolution.mergeIndex
  return [...canonical.slice(0, prefixLen), ...proposedIds, ...canonical.slice(suffixStart)]
}

/* ------------------------------------------------------------------ *
 * NEW item 正式 ID 分配（§6.2 「T/G/M 各自的下一序号」）
 * ------------------------------------------------------------------ */

/** 一个 T/G/M id 的序号部分（`T-12` → 12；非良构 ⇒ null）。 */
export function itemIdSequence(id: string): number | null {
  const parsed = parseId(id)
  if (parsed === null) return null
  if (parsed.kind !== 'TASK' && parsed.kind !== 'GATE' && parsed.kind !== 'MILESTONE') return null
  return parsed.sequence
}

/** `T`/`G`/`M` 前缀（PLAN_FORK 词汇 kind → id 前缀，shared/ids 注册表同源）。 */
const KIND_TO_PREFIX: Readonly<Record<PlanForkItemKind, string>> = {
  TASK: 'T',
  GATE: 'G',
  MILESTONE: 'M',
}

/**
 * §6.2 纯分配：per-kind 下一序号 = 现有 id 最大序号 + 1（无现有 ⇒ 1）。
 * `existingIdsByKind` 必须是该 WS **全部**该 kind 定义文件的 id 集合
 * （含未列入计划的保留文件 — INV-PLAN-9：离开计划的定义文件长期保留，
 * 其序号不可复用）。返回与 NEW items 同序的正式 ID 列表。
 *
 * 并发/烧号：分配是单用户操作面（INV-PERM-2）+ 单 host 进程；崩溃或
 * 补偿后的烧号留 gap 合法（§1.1 规则 2 — 序号单调，不复用）。
 */
export function allocateNewIds(
  existingIdsByKind: Readonly<Record<PlanForkItemKind, readonly string[]>>,
  newKinds: readonly PlanForkItemKind[],
): string[] {
  const next: Record<PlanForkItemKind, number> = {
    TASK: 1,
    GATE: 1,
    MILESTONE: 1,
  }
  for (const kind of ['TASK', 'GATE', 'MILESTONE'] as const) {
    let max = 0
    for (const id of existingIdsByKind[kind] ?? []) {
      const n = itemIdSequence(id)
      if (n !== null && n > max) max = n
    }
    next[kind] = max + 1
  }
  return newKinds.map((kind) => {
    const id = `${KIND_TO_PREFIX[kind]}-${next[kind]}`
    next[kind] += 1
    return id
  })
}

/* ------------------------------------------------------------------ *
 * 完整计算：anchor 解析 + 前置校验 + id 分配 + 拼接 + 变更派生
 * ------------------------------------------------------------------ */

/** `computeNewPlan` 输入（全部现读/现算 — 无调用方快照信任）。 */
export interface ComputeNewPlanInput {
  /** 当前 canonical `ordered_items`（INV-PLAN-1 逐字顺序）。 */
  readonly canonical: readonly string[]
  readonly forkAnchor: string
  readonly mergeAnchor: string
  readonly proposedItems: readonly ProposedItem[]
  /** 该 WS 每个 kind 的**全部**现有定义文件 id（含未列入 — INV-PLAN-9）。 */
  readonly existingIdsByKind: Readonly<Record<PlanForkItemKind, readonly string[]>>
}

/**
 * §6.3 完整计算（§6.2/§6.3 的纯核心）：
 *
 *   1. proposed_items 非空（§4 步骤 4 不变量 — 存储过的 OPEN PF 恒满足）；
 *   2. `resolveAnchors`（§2.2 存在性 + 顺序 — 纯插入标记）；
 *   3. 逐 proposed item（有序）：KEEP 五子检查（kind 一致 / 存在 /
 *      开区间内 / 无重复 — 与 §4 步骤 4 同一码系；纯插入时开区间为空 ⇒
 *      KEEP 一律拒绝）→ 记 ref；NEW → per-kind 下一序号分配正式 ID；
 *   4. `spliceNewPlan`（§6.3 修正版公式）；
 *   5. 防御性终检：结果无重复（§4.4 — 违例 = 内部 bug，大声）；
 *   6. 派生 `removedIds`（开区间内未被 KEEP 引用的 canonical items —
 *      DELETE 形态；定义文件保留，INV-PLAN-9）与 `keptIds`。
 *
 * 错误 = WP-3.1 `PlanForkError`（领域错误分类单一来源 — 码与 §4 链同系：
 * PF_ITEMS_EMPTY / PF_ANCHOR_* / PF_ITEM_KIND_MISMATCH /
 * PF_KEEP_REF_* / PF_INPUT）。
 */
export function computeNewPlan(input: ComputeNewPlanInput): NewPlanResult {
  const { canonical, forkAnchor, mergeAnchor, proposedItems, existingIdsByKind } = input

  if (proposedItems.length === 0) {
    throw new PlanForkError({
      code: 'PF_ITEMS_EMPTY',
      path: '/proposed_items',
      message: 'proposed_items is empty — a stored OPEN PlanFork always proposes a non-empty ordered replacement (PLAN_FORK_SPEC §4 步骤 4; frozen minItems 1)',
    })
  }

  // 2) §2.2 anchor 解析（存在性 + 顺序 + 纯插入标记）— 失败即抛。
  const resolution = resolveAnchors(forkAnchor, mergeAnchor, canonical)

  // 3) 逐 item：KEEP 子检查 + NEW 分配（proposed 顺序 = 物化顺序）。
  // 替换开区间 (fork, merge) — 纯插入时**空**（特例下 X 无开区间; 双
  // __START__ 时 forkIndex = mergeIndex = -1, slice(0, -1) 是「除末项」而非
  // 空 — 必须显式按 pureInsertion 分支, 不得依赖切片下标巧合）。
  const span = resolution.pureInsertion
    ? new Set<string>()
    : new Set(canonical.slice(resolution.forkIndex + 1, resolution.mergeIndex))
  const seenKeep = new Map<string, number>()
  const newKinds: PlanForkItemKind[] = []
  const proposedIds: string[] = new Array(proposedItems.length)
  const newItems: { proposedIndex: number; kind: PlanForkItemKind; id: string }[] = []
  const keptIds: string[] = []

  proposedItems.forEach((item, i) => {
    if (item.action === 'KEEP') {
      const ref = item.ref
      const parsed = parseId(ref)
      if (parsed === null || parsed.kind !== item.kind) {
        throw new PlanForkError({
          code: 'PF_ITEM_KIND_MISMATCH',
          path: `/proposed_items/${i}/ref`,
          message:
            `proposed_items[${i}].ref=${JSON.stringify(ref)} has id kind ${parsed === null ? '(unparseable)' : parsed.kind} ` +
            `but declared kind ${JSON.stringify(item.kind)} — 类型一致性 (DOMAIN_SCHEMA §4.4/§1.1)`,
        })
      }
      if (!canonical.includes(ref)) {
        throw new PlanForkError({
          code: 'PF_KEEP_REF_MISSING',
          path: `/proposed_items/${i}/ref`,
          message: `proposed_items[${i}].ref=${JSON.stringify(ref)} does not exist in the current canonical ordered_items (PLAN_FORK_SPEC §4 步骤 4)`,
        })
      }
      if (!span.has(ref)) {
        throw new PlanForkError({
          code: 'PF_KEEP_REF_OUTSIDE_SPAN',
          path: `/proposed_items/${i}/ref`,
          message:
            `proposed_items[${i}].ref=${JSON.stringify(ref)} is not inside the replacement span ` +
            `(${JSON.stringify(forkAnchor)}, ${JSON.stringify(mergeAnchor)}) — keeping an outside-span item would LIST IT TWICE ` +
            `in the materialized plan (DOMAIN_SCHEMA §4.4 无重复; 纯插入时 span 为空, proposed_items 只可含 NEW) (PLAN_FORK_SPEC §2.2/§4 步骤 4)`,
        })
      }
      const firstAt = seenKeep.get(ref)
      if (firstAt !== undefined) {
        throw new PlanForkError({
          code: 'PF_KEEP_REF_DUPLICATE',
          path: `/proposed_items/${i}/ref`,
          message: `proposed_items[${i}].ref=${JSON.stringify(ref)} is already KEEP-referenced at proposed_items[${firstAt}] — a duplicate would list the item twice (DOMAIN_SCHEMA §4.4 无重复)`,
        })
      }
      seenKeep.set(ref, i)
      proposedIds[i] = ref
      keptIds.push(ref)
      return
    }
    // NEW — §6.2 正式 ID 分配（T/G/M 各自下一序号, per-kind 消费）。
    newKinds.push(item.kind)
  })

  const allocated = allocateNewIds(existingIdsByKind, newKinds)
  let alloc = 0
  proposedItems.forEach((item, i) => {
    if (item.action === 'NEW') {
      const id = allocated[alloc]!
      alloc += 1
      proposedIds[i] = id
      newItems.push({ proposedIndex: i, kind: item.kind, id })
    }
  })

  // 4) §6.3 修正版公式拼接。
  const newOrder = spliceNewPlan(canonical, resolution, proposedIds)

  // 5) 防御性终检（§4.4 无重复 — KEEP 子检查已保证; 违例 = 内部 bug）。
  const firstAt = new Map<string, number>()
  newOrder.forEach((id, i) => {
    const first = firstAt.get(id)
    if (first !== undefined) {
      throw new PlanForkError({
        code: 'PF_INPUT',
        path: `/new_order/${i}`,
        message: `internal: §6.3 materialization would list ${JSON.stringify(id)} twice (first at ${first}) — the KEEP span invariants must have held (DOMAIN_SCHEMA §4.4)`,
      })
    }
    firstAt.set(id, i)
  })

  // 6) removedIds = 开区间内未被 KEEP 引用的 canonical items（§2.2 DELETE
  // 形态）— 纯插入无开区间 ⇒ 无删除（同上, 显式分支）。
  const kept = new Set(keptIds)
  const removedIds = resolution.pureInsertion
    ? []
    : canonical.slice(resolution.forkIndex + 1, resolution.mergeIndex).filter((id) => !kept.has(id))

  return { newOrder, newItems, removedIds, keptIds, resolution }
}
