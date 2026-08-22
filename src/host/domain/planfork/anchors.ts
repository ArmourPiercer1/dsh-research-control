/**
 * WP-3.1 — anchor semantics + plan closure (PLAN_FORK_SPEC §2.2/§3.1) and
 * the three change forms derived from the §2.1 original text.
 *
 * Frozen contracts (read-only):
 *  - PLAN_FORK_SPEC §2.2 (anchor 语义, 原文):
 *      · `fork_anchor` — canonical 中**保留**的最后一个分叉点;
 *      · `merge_anchor` — proposal **重新接入** canonical 的汇合点;
 *      · 替换区间为**开区间** `(fork_anchor, merge_anchor)`: 两个 anchor
 *        本身保留在 canonical 中, 区间内的 canonical items 被
 *        `proposed_items` 替换 (可增删改);
 *      · 边界哨兵 `__START__` (计划起点之前) / `__END__` (计划终点之后),
 *        是否允许由 policy 控制;
 *      · 校验: anchor 若非哨兵, 必须是当前 canonical `ordered_items` 中
 *        存在的 id, 且 fork 序号 ≤ merge 序号 (**相等 = 纯插入**);
 *  - PLAN_FORK_SPEC §3.1 (Plan closure: `plan.yaml` ∪ ordered_items 每个
 *    item 的定义文件 — 相对 workspace 根的路径集合; V1 默认保存整个当前
 *    closure 而非仅 anchor 区间, 消除区间裁剪歧义);
 *  - DOMAIN_SCHEMA §4.4 (plan 元素类型 = T/G/M id — 闭包路径推导的 kind 依据).
 *
 * ## 三种变更形态 (INSERT/MOVE/DELETE) 的原文表达 (types.ts 头注同文)
 *
 * §2.1 原文只给了两种 ProposedItem 形态 (KEEP / NEW); 三种变更形态从
 * 替换区间语义机械派生 (`derivePlanForkChanges`):
 *   - INSERT  = `NEW` 项 (物化于 SELECT 时获得正式 ID — 本 WP 不物化);
 *   - MOVE    = `KEEP` 项且物化后位置 ≠ canonical 位置 (区间重排);
 *   - DELETE  = 开区间 (fork, merge) 内未被 KEEP 引用的 canonical 项
 *     (omission = removal; 定义文件保留 — INV-PLAN-9).
 * 物化后的位置按 §6.3 的拼接形状计算: `prefix(含 fork) + proposed +
 * suffix(含 merge)`, 纯插入特例 `prefix(含 X) + proposed + suffix(X 之后)`
 * (§6.3 公式). 注意: 本函数只**分类变更形态并给出位置**, 不计算/返回
 * new_plan 本身 — new_plan 物化 (正式 ID 分配 + 文件写入 + plan.yaml 重写)
 * 是 §6.3 SELECT 流程, 属 WP-3.4 (本 WP 边界, create.ts 头注同文)。
 *
 * Pure: zero I/O, zero schema imports (canonical 顺序由调用方现读后经
 * `CanonicalPlanView.ordered_items` 传入 — INV-PLAN-1 逐字顺序)。
 */

import { parseId } from '../../../shared/ids/index.js'
import {
  PlanForkError,
  type PlanForkItemKind,
  type PlanForkRecord,
  type ProposedItem,
} from './types.js'

/* ------------------------------------------------------------------ *
 * Boundary sentinels (§2.2 原文)
 * ------------------------------------------------------------------ */

/** The two §2.2 boundary sentinels, verbatim. */
export const BOUNDARY_SENTINELS = ['__START__', '__END__'] as const
export type BoundarySentinel = (typeof BOUNDARY_SENTINELS)[number]

/** True iff `anchor` is one of the two §2.2 sentinels (exact string match). */
export function isBoundarySentinel(anchor: string): anchor is BoundarySentinel {
  return anchor === '__START__' || anchor === '__END__'
}

/* ------------------------------------------------------------------ *
 * Anchor resolution (§2.2 校验, 原文语义)
 * ------------------------------------------------------------------ */

/**
 * The ordinal of an anchor in the canonical sequence:
 *   - `__START__` → `-1` (计划起点之前);
 *   - `__END__`   → `orderedItems.length` (计划终点之后);
 *   - item id     → its 0-based index in `orderedItems`;
 *   - anything else (unknown id) → `null`.
 */
export function anchorOrdinal(anchor: string, orderedItems: readonly string[]): number | null {
  if (anchor === '__START__') return -1
  if (anchor === '__END__') return orderedItems.length
  const i = orderedItems.indexOf(anchor)
  return i === -1 ? null : i // indexOf 的 -1 与 __START__ 序号冲突 — 显式映射为 null
}

/**
 * Resolved anchor pair (the §2.2 invariants, existence + order, WITHOUT
 * the policy half — policy gate = `applyAnchorPolicy`, policy.ts):
 *   - both anchors resolve (sentinel or canonical id) else PF_ANCHOR_MISSING
 *     (错误信息指明失败项 — 哪个 anchor、哪个 id);
 *   - fork ordinal ≤ merge ordinal else PF_ANCHOR_ORDER (§2.2 顺序非法);
 *   - `pureInsertion` — ordinals EQUAL (§2.2 「相等 = 纯插入」).
 */
export interface AnchorResolution {
  readonly forkAnchor: string
  readonly mergeAnchor: string
  readonly forkIndex: number
  readonly mergeIndex: number
  readonly pureInsertion: boolean
}

/** A short, precise summary of the canonical order for error messages. */
function canonicalSummary(orderedItems: readonly string[]): string {
  if (orderedItems.length === 0) return '[]'
  return orderedItems.length > 8
    ? `[${orderedItems.slice(0, 4).join(', ')}, …, ${orderedItems.slice(-2).join(', ')}] (${orderedItems.length} items)`
    : `[${orderedItems.join(', ')}]`
}

export function resolveAnchors(
  forkAnchor: string,
  mergeAnchor: string,
  orderedItems: readonly string[],
): AnchorResolution {
  const forkIndex = anchorOrdinal(forkAnchor, orderedItems)
  if (forkIndex === null) {
    throw new PlanForkError({
      code: 'PF_ANCHOR_MISSING',
      step: 5,
      path: '/fork_anchor',
      message:
        `fork_anchor=${JSON.stringify(forkAnchor)} is neither a boundary sentinel (__START__/__END__) nor an id ` +
        `present in the current canonical ordered_items (${canonicalSummary(orderedItems)}) (PLAN_FORK_SPEC §2.2/§4 步骤 5)`,
    })
  }
  const mergeIndex = anchorOrdinal(mergeAnchor, orderedItems)
  if (mergeIndex === null) {
    throw new PlanForkError({
      code: 'PF_ANCHOR_MISSING',
      step: 5,
      path: '/merge_anchor',
      message:
        `merge_anchor=${JSON.stringify(mergeAnchor)} is neither a boundary sentinel (__START__/__END__) nor an id ` +
        `present in the current canonical ordered_items (${canonicalSummary(orderedItems)}) (PLAN_FORK_SPEC §2.2/§4 步骤 5)`,
    })
  }
  if (forkIndex > mergeIndex) {
    throw new PlanForkError({
      code: 'PF_ANCHOR_ORDER',
      step: 5,
      path: '/merge_anchor',
      message:
        `anchor order illegal: fork_anchor=${JSON.stringify(forkAnchor)} (ordinal ${forkIndex}) is after ` +
        `merge_anchor=${JSON.stringify(mergeAnchor)} (ordinal ${mergeIndex}) — §2.2 requires fork 序号 ≤ merge 序号 ` +
        `(相等 = 纯插入) (PLAN_FORK_SPEC §4 步骤 5)`,
    })
  }
  return { forkAnchor, mergeAnchor, forkIndex, mergeIndex, pureInsertion: forkIndex === mergeIndex }
}

/** The item kind of a non-sentinel anchor id (null when the id is not a well-formed T/G/M id). */
export function anchorItemKind(anchor: string): PlanForkItemKind | null {
  const parsed = parseId(anchor)
  if (parsed === null) return null
  return parsed.kind === 'TASK' || parsed.kind === 'GATE' || parsed.kind === 'MILESTONE' ? parsed.kind : null
}

/* ------------------------------------------------------------------ *
 * Plan closure (§3.1)
 * ------------------------------------------------------------------ */

/** The `items/<dir>` subdirectory per item kind (DOMAIN_SCHEMA §14 布局). */
const KIND_TO_DIR: Readonly<Record<PlanForkItemKind, string>> = {
  TASK: 'tasks',
  GATE: 'gates',
  MILESTONE: 'milestones',
}

/**
 * The §3.1 plan closure, `.research`-relative POSIX paths, in the STABLE
 * order this module produces bases with (PLAN_FORK_SPEC §3.1/§3.2):
 *
 *   1. `<wsDir>/plan.yaml`
 *   2. one definition file per `ordered_items` element, CANONICAL ORDER
 *      (`<wsDir>/items/<tasks|gates|milestones>/<id>.yaml`)
 *
 * V1 默认保存整个当前 closure (非仅 anchor 区间 — §3.1 末行). 调用方必须
 * 传入 step 2 校验通过的 canonical 顺序 (全部 T/G/M 且定义文件存在);
 * 一个非 T/G/M 的元素是上游校验失效 — fail loud (PF_INPUT)。
 *
 * `wsDir` = the `.research`-relative workstream directory
 * (`topics/<TPC>/workstreams/<WS>`, CanonicalPlanView.wsDir)。
 */
export function closureRelativePaths(wsDir: string, orderedItems: readonly string[]): string[] {
  const normalized = wsDir.endsWith('/') ? wsDir.slice(0, -1) : wsDir
  const paths: string[] = [`${normalized}/plan.yaml`]
  for (const id of orderedItems) {
    const parsed = parseId(id)
    if (parsed === null || (parsed.kind !== 'TASK' && parsed.kind !== 'GATE' && parsed.kind !== 'MILESTONE')) {
      throw new PlanForkError({
        code: 'PF_INPUT',
        message: `closure computation: canonical ordered_items element ${JSON.stringify(id)} is not a well-formed T/G/M id — the step-2 canonical consistency check must have passed first (DOMAIN_SCHEMA §4.4)`,
      })
    }
    paths.push(`${normalized}/items/${KIND_TO_DIR[parsed.kind as PlanForkItemKind]}/${id}.yaml`)
  }
  return paths
}

/* ------------------------------------------------------------------ *
 * Replacement span + the three change forms (§2.2 / §2.1 原文派生)
 * ------------------------------------------------------------------ */

/**
 * The canonical items strictly INSIDE the open replacement span
 * `(fork_anchor, merge_anchor)` (§2.2: 「区间内的 canonical items 被
 * proposed_items 替换」) — i.e. the items the proposal removes/replaces.
 * Pure insertion (equal ordinals) ⇒ empty span (nothing is replaced;
 * proposed_items is inserted at the single point).
 */
export function replacedSpan(orderedItems: readonly string[], resolution: AnchorResolution): string[] {
  return orderedItems.slice(resolution.forkIndex + 1, resolution.mergeIndex)
}

/**
 * One derived change of the proposal relative to canonical (the three
 * change forms + 「无变更」 for KEPT-in-place items — 模块头注的映射表):
 *   - `INSERT`    — a NEW proposed item (toIndex = its materialized position);
 *   - `MOVE`      — a KEEP item whose materialized position ≠ fromIndex;
 *   - `DELETE`    — a span item not referenced by any KEEP (fromIndex only);
 *   - `UNCHANGED` — a KEEP item at the same position / any outside-span item.
 */
export interface PlanItemChange {
  readonly kind: 'INSERT' | 'MOVE' | 'DELETE' | 'UNCHANGED'
  /** The canonical item (MOVE/DELETE/UNCHANGED). */
  readonly ref?: string
  /** The canonical index (MOVE/DELETE/UNCHANGED). */
  readonly fromIndex?: number
  /** The materialized-plan index (INSERT/MOVE/UNCHANGED). */
  readonly toIndex?: number
}

/**
 * Derive the change classification of `proposedItems` against `orderedItems`
 * with the resolved anchors. Positions follow the §6.3 materialization shape
 * (prefix 含 fork + proposed + suffix 含 merge; 纯插入特例 prefix 含 X +
 * proposed + suffix X 之后) — classification only, NO new_plan output
 * (WP-3.4 owns materialization).
 *
 * Requires the step-4 invariants to hold (every KEEP ref exists, lies in
 * the open span, no duplicates; NEW specs valid) — the creation chain
 * runs this AFTER step 4/5 for diagnostics; misuse (unknown KEEP ref)
 * fails loud (PF_INPUT) rather than mis-classify.
 */
export function derivePlanForkChanges(
  orderedItems: readonly string[],
  resolution: AnchorResolution,
  proposedItems: readonly ProposedItem[],
): PlanItemChange[] {
  const { forkIndex, mergeIndex, pureInsertion } = resolution
  const n = orderedItems.length

  // Resulting-plan layout (§6.3 shape): prefix + proposed + suffix, where
  //   - general (fork < merge):  prefix = canonical[0..fork] (fork 保留),
  //     suffix = canonical[merge..] (merge 保留);
  //   - pure insertion (fork == merge == X, §6.3 特例): X 各保留一次 —
  //     prefix = canonical[0..X], suffix = canonical[X+1..] (X == N 即双
  //     __END__ 时 prefix = 全计划, suffix 为空; X == -1 即双 __START__ 时
  //     prefix 为空, suffix = 全计划).
  const prefixLen = pureInsertion ? Math.min(mergeIndex + 1, n) : forkIndex + 1
  const suffixStart = pureInsertion ? mergeIndex + 1 : mergeIndex
  const suffixBase = prefixLen + proposedItems.length

  const changes: PlanItemChange[] = []
  const keepRefToProposedIndex = new Map<string, number>()
  proposedItems.forEach((item, i) => {
    if (item.action === 'KEEP') keepRefToProposedIndex.set(item.ref, i)
  })
  const classify = (kind: PlanItemChange['kind'], ref: string, from: number, to: number): PlanItemChange =>
    kind === 'INSERT' ? { kind, toIndex: to } : { kind: to === from ? 'UNCHANGED' : 'MOVE', ref, fromIndex: from, toIndex: to }

  for (let k = 0; k < n; k++) {
    const ref = orderedItems[k]!
    if (k < prefixLen) {
      // prefix part — position preserved exactly (含 pure 情形的 anchor X).
      changes.push({ kind: 'UNCHANGED', ref, fromIndex: k, toIndex: k })
    } else if (k > forkIndex && k < mergeIndex) {
      // open span: KEEP ⇒ repositioned by the proposal; omission ⇒ DELETE.
      const proposedIndex = keepRefToProposedIndex.get(ref)
      if (proposedIndex === undefined) {
        changes.push({ kind: 'DELETE', ref, fromIndex: k })
      } else {
        changes.push(classify('MOVE', ref, k, prefixLen + proposedIndex))
      }
    } else if (k >= suffixStart) {
      // suffix (merge anchor first in the general case; k > merge in both)
      changes.push(classify('MOVE', ref, k, suffixBase + (k - suffixStart)))
    }
    // else: the general-case merge anchor at k == mergeIndex == suffixStart
    // is handled by the suffix branch (k >= suffixStart).
  }
  proposedItems.forEach((item, i) => {
    if (item.action === 'NEW') {
      changes.push({ kind: 'INSERT', toIndex: prefixLen + i })
    }
  })

  // Ordering: materialized-plan order (stable, readable).
  return changes.sort((a, b) => (a.toIndex ?? a.fromIndex ?? 0) - (b.toIndex ?? b.fromIndex ?? 0))
}

/**
 * Convenience: run the derivation over a STORED record (its own
 * fork/merge anchors resolved against the CURRENT canonical) — the
 * diagnostics / WP-3.4 preview seam. Throws PF_ANCHOR_MISSING/ORDER when
 * the record's anchors no longer resolve against `orderedItems` (the
 * stale case — WP-3.2 marks the PF STALE before any preview runs).
 */
export function deriveRecordChanges(record: PlanForkRecord, orderedItems: readonly string[]): PlanItemChange[] {
  const resolution = resolveAnchors(record.fork_anchor, record.merge_anchor, orderedItems)
  return derivePlanForkChanges(orderedItems, resolution, record.proposed_items)
}
