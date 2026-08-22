/**
 * WP-3.4 — 崩溃签名检测（goal 4：重启后 plan.yaml 与 PF 状态不符的判定，
 * PURE，零 I/O）。
 *
 * 背景（两系统物化的崩溃窗）：SELECT 物化 = ① 新定义文件原子写入 +
 * ② plan.yaml 原子重写 + ③ DB 事务（PF→SELECTED + 连锁 STALE + 账本）。
 * 进程死在 ② 之后、③ 之前（或 ③ 提交失败且补偿也失败）⇒ 重启后状态：
 * **plan.yaml 已是物化形态（含新 item 正式 ID），而 PF 仍为 OPEN**。
 * 本模块判定该状态（「崩溃签名」）— 判定成立时服务**大声报错**
 * （SELECT_CRASH_INCOMPLETE / SELECT_CONSISTENCY），**不静默修复**
 * （不自动恢复旧 plan、不自动补 SELECTED 迁移 — 人工核实：保留新计划
 * （PF 已被 §6.1 自动置 STALE，Agent 可重新提议）或 git restore 旧计划
 * （INV-GIT-8））。
 *
 * 签名（机械、精确、可证伪）— 当前 plan `C`（必须是一致的视图）恰为
 * 记录 `P` 的 §6.3 物化形态，当且仅当：
 *
 *   (a) **文件证据**：`P.proposed_items` 的每个 `NEW` item 恰有一个
 *       对应的新定义文件 — 新 = 该文件路径**不在** `P.base_plan_objects`
 *       （创建时刻闭包之外 ⇒ 创建后落盘）；文件的 `created_by` 恰为
 *       `{ kind: AGENT, run_id: P.created_by_run }`（§6.2 原文：内容作者
 *       = 提议 run）；文件声明字段（title/goal/… 按 kind）与 `NEW.spec`
 *       逐字段相等（含 absent/present 区分 — 物化文件按 spec 原样写）。
 *       匹配为单射（一个文件至多消费一次；多余的同 run 新文件合法存在
 *       — 如先前崩溃的遗留 — 不破坏签名）；
 *   (b) **位置分解**：`C = 前缀 ++ S ++ 后缀`，`S` = proposed 顺序的物化
 *       序列（KEEP→ref / NEW→匹配 id），且按 §6.3 修正版公式（formula.ts
 *       同一布局规则）：
 *         - 通用（fork≠merge）：前缀以 fork_anchor 收尾（`C[f-1] == fork`
 *           或 `__START__` 空前缀），S 块紧随其后，merge_anchor 紧随 S 块
 *           （或 `__END__` 时 S 块抵尾）；
 *         - 纯插入（fork==merge==X）：`C[x] == X`（或 `__START__`/`__END__`
 *           边界），S 块紧随 X 之后（`__END__` 时抵尾）；
 *         - 前缀与后缀的**每个**元素 ∈ 旧闭包 item id 集（base_plan_objects
 *           的非 plan.yaml 路径派生）— 新 id 只许出现在 S 块内（一致的 C
 *           无重复 ⇒ 自动成立，此检查排除「前缀/后缀混入新文件 id」）；
 *   (c) anchor 对当前 `C` 可解析（物化保留两 anchor ⇒ 崩溃形态下恒可
 *       解析；解析失败 = 计划已偏离物化形态 ⇒ 签名不成立）。
 *
 * 不满足 (a)/(b)/(c) ⇒ `matched: false`（`BASIS_STALE` 路径 — 可能是用户
 * 编辑；§5 复核照常处理）。false positive 的唯一残余 = 用户手工把计划
 * 编辑成与物化形态逐字节等价且 created_by 恰同 run — 消息文案已声明该
 * 歧义（「或计划被手工编辑成此形态」），人工核实即可。
 *
 * 纯函数纪律：文件读取/解析由调用方完成（`newFiles` 入参已解析为
 * 声明字段 + created_by）— 本模块零 I/O，与 formula.ts 同层。
 */

import {
  isBoundarySentinel,
  resolveAnchors,
  type ActorRef,
  type AnchorResolution,
  type NewItemSpec,
  type PlanForkItemKind,
  type PlanForkRecord,
  type ProposedItem,
} from '../../domain/planfork/index.js'

/** 一个「创建后落盘」的定义文件（解析后的声明面 — 调用方经 PlanStore.readItem）。 */
export interface CrashedNewFile {
  readonly id: string
  /** PF 词汇 kind（TASK/GATE/MILESTONE — 按所在 items/<dir> 目录）。 */
  readonly kind: PlanForkItemKind
  /** 声明字段（frozen spec 形状；spec 未给的可选数组经内核边界归一为 `[]` — 比较经 `specKey` 同一归一）。 */
  readonly spec: NewItemSpec
  /** 文件的 `created_by`（冻结 actorRef 形状）。 */
  readonly createdBy: ActorRef
}

export interface CrashSignatureInput {
  readonly record: PlanForkRecord
  /** 当前 canonical ordered_items（**必须**是一致的视图 — 调用方保证）。 */
  readonly canonical: readonly string[]
  /** 该 WS 磁盘上不在 base 闭包内的全部定义文件（已解析; id 稳定顺序）。 */
  readonly newFiles: readonly CrashedNewFile[]
}

export interface CrashSignatureResult {
  readonly matched: boolean
  /** 命中时：每个 NEW proposed item 的匹配正式 id（proposed 顺序）。 */
  readonly matchedIds?: readonly string[]
  /** 机械说明（命中/未命中的原因 — 用于错误文案/审计 note）。 */
  readonly detail: string
}

/* ------------------------------------------------------------------ *
 * spec 规范化（absent/present 可区分；键序固定 ⇒ 字符串可比较）
 * ------------------------------------------------------------------ */

const ABSENT = '\u0000ABSENT\u0000'

/**
 * 字段规范化（absent/present 可区分）+ **内核往返归一**：WP-1.1/1.3 冻结
 * schema 对可选数组字段（deliverables/acceptance_criteria/references）带
 * 默认值 `[]` — 文件缺该字段时读回的 doc 携带 `[]`（readItem 经 schema
 * 默认值归一），而 proposed NEW spec 可携带 absent 的同一字段。物化按
 * spec 原样写字节（absent ⇒ 文件无该字段行），但读回后 absent 与 `[]`
 * 不可区分 ⇒ 签名比较必须做同一归一：`[]` ≡ absent。保守方向：唯一残余
 * 歧义 = 用户手工编辑出字节等价的 spec 字段集（模块头已声明, 人工核实）。
 */
function field(value: unknown): string {
  if (value === undefined) return ABSENT
  if (Array.isArray(value) && value.length === 0) return ABSENT
  return JSON.stringify(value)
}

/** 按 kind 的固定键序规范化一个声明字段集（spec 或文件字段 — 同一函数）。 */
export function specKey(kind: PlanForkItemKind, spec: NewItemSpec): string {
  const s = spec as unknown as Record<string, unknown>
  switch (kind) {
    case 'TASK':
      return ['title', 'goal', 'deliverables', 'acceptance_criteria'].map((k) => field(s[k])).join('\u0001')
    case 'GATE':
      return ['title', 'criteria', 'references'].map((k) => field(s[k])).join('\u0001')
    case 'MILESTONE':
      return ['title', 'statement'].map((k) => field(s[k])).join('\u0001')
  }
}

/* ------------------------------------------------------------------ *
 * 旧闭包 id 集（base_plan_objects 派生）
 * ------------------------------------------------------------------ */

/**
 * `P.base_plan_objects` 的 item id 集（旧 canonical 的全部定义文件）：
 * 路径含 `/items/` 的条目取 basename（去 `.yaml`）；plan.yaml 条目
 * （`/plan.yaml` 结尾）排除；其余（不应存在）忽略。
 */
export function baseItemIds(record: PlanForkRecord): Set<string> {
  const out = new Set<string>()
  for (const obj of record.base_plan_objects) {
    if (obj.path.endsWith('/plan.yaml')) continue
    if (!obj.path.includes('/items/')) continue
    const base = obj.path.slice(obj.path.lastIndexOf('/') + 1)
    if (base.endsWith('.yaml')) out.add(base.slice(0, -5))
  }
  return out
}

/* ------------------------------------------------------------------ *
 * (a) 文件证据 — 单射匹配
 * ------------------------------------------------------------------ */

function matchNewFiles(
  record: PlanForkRecord,
  newFiles: readonly CrashedNewFile[],
): { ids: string[] | null; detail: string } {
  const newSpecs: { kind: PlanForkItemKind; spec: NewItemSpec }[] = []
  for (const item of record.proposed_items) {
    if (item.action === 'NEW') newSpecs.push({ kind: item.kind, spec: item.spec })
  }
  if (newSpecs.length === 0) return { ids: [], detail: 'no NEW items (reorder-only proposal)' }

  // 候选：created_by 恰为 { kind: AGENT, run_id: P.created_by_run }（§6.2）。
  const run = record.created_by_run
  const candidates = newFiles.filter(
    (f) => f.createdBy.kind === 'AGENT' && f.createdBy.run_id === run &&
           f.createdBy.user_id === undefined && f.createdBy.session_id === undefined &&
           f.createdBy.label === undefined,
  )

  const used = new Set<string>()
  const ids: string[] = []
  for (const ns of newSpecs) {
    const key = specKey(ns.kind, ns.spec)
    const pick = candidates.find((f) => f.kind === ns.kind && specKey(f.kind, f.spec) === key && !used.has(f.id))
    if (pick === undefined) {
      return {
        ids: null,
        detail: `no new definition file matches NEW ${ns.kind} spec (title=${JSON.stringify((ns.spec as { title: string }).title)}; created_by=AGENT/${run}) — signature (a) file evidence fails`,
      }
    }
    used.add(pick.id)
    ids.push(pick.id)
  }
  return { ids, detail: `NEW items match on-disk files created_by=AGENT/${run}: ${ids.join(', ')}` }
}

/* ------------------------------------------------------------------ *
 * (b) 位置分解（§6.3 布局规则 — formula.ts 的逆命题）
 * ------------------------------------------------------------------ */

function decompose(
  canonical: readonly string[],
  resolution: AnchorResolution,
  record: PlanForkRecord,
  matchedIds: readonly string[],
  oldIds: ReadonlySet<string>,
): { ok: boolean; detail: string } {
  const C = canonical
  const n = C.length
  // S = proposed 顺序物化序列（KEEP→ref / NEW→匹配 id, 按 NEW 出现顺序消费 matchedIds）。
  const S: string[] = []
  let ni = 0
  record.proposed_items.forEach((item) => {
    if (item.action === 'KEEP') S.push(item.ref)
    else S.push(matchedIds[ni++]!)
  })
  const sLen = S.length

  const allOld = (from: number, to: number): boolean => {
    for (let k = from; k < to; k++) {
      const id = C[k]!
      if (!oldIds.has(id)) return false
    }
    return true
  }

  let f: number // S 块起点
  let prefixTo: number // 前缀区间 [0, prefixTo)
  let boundaryOk: boolean // S 块后的边界（merge anchor 紧随 / __END__ 抵尾）

  if (resolution.pureInsertion) {
    const X = record.fork_anchor
    if (X === '__START__') {
      f = 0
      prefixTo = 0
      boundaryOk = true
    } else if (X === '__END__') {
      f = n - sLen
      if (f < 0) return { ok: false, detail: 'plan shorter than the materialized sequence (pure __END__ insertion impossible)' }
      prefixTo = f
      boundaryOk = true
    } else {
      const x = C.indexOf(X)
      if (x === -1) return { ok: false, detail: `pure-insertion anchor ${JSON.stringify(X)} not present in the current plan (materialization would have kept it)` }
      f = x + 1
      prefixTo = f
      boundaryOk = true
    }
  } else {
    const fork = record.fork_anchor
    const merge = record.merge_anchor
    if (fork === '__START__') {
      f = 0
      prefixTo = 0
    } else {
      const fi = C.indexOf(fork)
      if (fi === -1) return { ok: false, detail: `fork anchor ${JSON.stringify(fork)} not present in the current plan (materialization would have kept it)` }
      f = fi + 1
      prefixTo = f
    }
    if (merge === '__END__') {
      boundaryOk = f + sLen === n
    } else {
      boundaryOk = C[f + sLen] === merge
    }
  }

  // S 块逐位相等 + 边界。
  if (f < 0 || f + sLen > n) return { ok: false, detail: 'materialized block out of plan bounds' }
  for (let k = 0; k < sLen; k++) {
    if (C[f + k] !== S[k]!) return { ok: false, detail: `position ${f + k}: expected ${JSON.stringify(S[k])} of the materialized sequence, found ${JSON.stringify(C[f + k])}` }
  }
  if (!boundaryOk) {
    return {
      ok: false,
      detail:
        record.merge_anchor === '__END__'
          ? 'materialized block does not reach the end of the plan (__END__ boundary)'
          : `merge anchor ${JSON.stringify(record.merge_anchor)} does not immediately follow the materialized block (position ${f + sLen})`,
    }
  }

  // 前缀/后缀元素 ∈ 旧闭包 id 集（新 id 只许出现在 S 块内；一致的 C 无
  // 重复 ⇒ 匹配 id 在 S 块外出现时此检查必失败）。保守方向：崩溃后又被
  // 手工编辑（旧 item 缺失）仍会命中 — 宁可多报（大声），不可漏报。
  if (prefixTo > 0 && !allOld(0, prefixTo)) {
    return { ok: false, detail: 'prefix contains an id outside the PF base closure (not the creation-time plan)' }
  }
  if (f + sLen < n && !allOld(f + sLen, n)) {
    return { ok: false, detail: 'suffix contains an id outside the PF base closure (not the creation-time plan)' }
  }

  return {
    ok: true,
    detail: `plan decomposes as prefix(含 ${record.fork_anchor}) + [${S.join(', ')}] + suffix(含 ${record.merge_anchor})`,
  }
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

/**
 * 判定当前 plan 是否为 `record` 的 §6.3 物化形态（崩溃签名 — 模块头注
 * (a)(b)(c) 三连）。`canonical` 必须是一致的视图（调用方保证：加载 +
 * §4.4 全过 — 不一致时无法建立分解，属 `UNVERIFIABLE` 而非本函数输入）。
 */
export function detectCrashSignature(input: CrashSignatureInput): CrashSignatureResult {
  const { record, canonical, newFiles } = input

  // (c) anchor 可解析性（物化保留 anchor ⇒ 崩溃形态恒可解析）。
  let resolution: AnchorResolution
  try {
    resolution = resolveAnchors(record.fork_anchor, record.merge_anchor, canonical)
  } catch (cause) {
    return {
      matched: false,
      detail: `anchors no longer resolve against the current plan (${cause instanceof Error ? cause.message.split(' (')[0] : String(cause)}) — the plan is not the materialized form`,
    }
  }

  // (a) 文件证据。
  const fileMatch = matchNewFiles(record, newFiles)
  if (fileMatch.ids === null) return { matched: false, detail: fileMatch.detail }

  // (b) 位置分解。
  const oldIds = baseItemIds(record)
  const decomp = decompose(canonical, resolution, record, fileMatch.ids, oldIds)
  if (!decomp.ok) return { matched: false, detail: decomp.detail }

  return {
    matched: true,
    matchedIds: fileMatch.ids,
    detail: `${fileMatch.detail}; ${decomp.detail}; PF ${record.id} still OPEN — file half of SELECT applied, DB half missing (crash window)`,
  }
}

/** 仅取 proposed NEW items 的 (kind, spec) 序列（服务层构造 spec 提取用）。 */
export function proposedNewItems(record: PlanForkRecord): readonly (ProposedItem & { action: 'NEW' })[] {
  return record.proposed_items.filter((i): i is ProposedItem & { action: 'NEW' } => i.action === 'NEW')
}
