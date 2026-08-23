/**
 * WP-5.4 — `AttentionService`: Awareness（用户注意力状态）+ Attention
 * Manager baseline 评分服务面。
 *
 * 服务面:
 *   - Awareness（INV-ATTN-4: 只对高价值对象/事件; INV-PERM-2/矩阵行
 *     「Awareness 状态 ✅/❌/❌/❌」: 仅用户可改）:
 *     `setAwareness(ref, state, actor)` / `getAwareness(ref)` /
 *     `listAwareness()`;
 *   - Attention Manager baseline（计划书 §20 算法第 2 步; INV-ATTN-1
 *     只排序不隐藏 / INV-ATTN-2 耗时零权重 — 评分器 scorer.ts 纯函数,
 *     host 与 client store 切片共用同一真源）:
 *     `getAttentionRanking()` — 组装四数据源端口 + awareness 状态
 *     （INTERVENTION 在白名单内 ⇒ 从 awareness 表取 state 喂评分器）
 *     → `rankAttention`。
 *
 * host/client 一致性论证（baseline 为什么可以两侧各自算）:
 *   冻结 13-RPC 面（ARCHITECTURE §7.1）无 attention 方法, 本 WP 不造
 *   第 14/15 个 RPC（WP-4.1b RR-015① 同口径）; GUI 侧由
 *   `src/client/stores/attention-slices.ts` 从既有 `getDashboard` 切片
 *   派生排序, 用**同一个** `rankAttention`。baseline 中 context 的
 *   project 特征全部零权重（scorer.ts 权重表）⇒ host 与 client 的
 *   context 取值不同也不产生排序分歧; 数据面上 client 目前只有
 *   Intervention 候选（NextAction/Blocker/ScheduledEvent 的 RPC 数据面
 *   随 WP-5.2/5.3 到, dashboard 对应字段为冻结 `null` 占位）——
 *   届时本服务面与 client 切片各自把新数据源喂入同一评分器, 形状不变。
 *
 * 权限门（矩阵行「Awareness 状态」, 逐字）: 只有 `actor.kind === 'USER'`
 *  可改状态; AGENT/INVESTIGATOR/PLUGIN 一律 ATTN_PERM 拒绝（INV-PERM-2:
 *  Agent 不可动 awareness 状态）。读面无门（host 内部数据面）。
 *
 * 错误纪律（同 WP-2.4/WP-3.1/WP-3.5）: AttentionError 结构化 code,
 * caller-owned; 驱动/SQL 失败包 ATTN_STORE（cause 保留）。
 * 无 DSH import（INV-PERM-5）。
 */

import { DatabaseSync } from 'node:sqlite'

import { openDatabase, type OpenDatabaseOptions, type ResearchStore } from '../../persistence/store/index.js'
import {
  rankAttention,
  type AttentionContext,
  type AttentionItem,
  type AttentionInterventionItem,
  type AttentionRanking,
} from './scorer.js'
import { AwarenessStore } from './store.js'
import {
  AttentionError,
  type ActiveInterventionRecord,
  type AttentionActor,
  type AttentionDb,
  type AttentionSourcePorts,
  type AwarenessObjectRef,
  type AwarenessRecord,
  type AwarenessState,
} from './types.js'

/* ------------------------------------------------------------------ *
 * Intervention 记录 → 评分输入（纯映射; flooding InterventionRecord
 * 结构可赋值的 ActiveInterventionRecord 进, scorer 输入出）
 * ------------------------------------------------------------------ */

/**
 * 一条活跃 Intervention → 评分输入项。workstreamId = 第一个关联 WS
 * （无关联 ⇒ null — INV-ATTN-1 不因无 WS 关联而隐藏, 评分器照排）。
 * CLOSED 防御性过滤在 service（端口契约已限 OPEN/PENDING, 双保险）。
 */
export function interventionToAttentionItem(record: ActiveInterventionRecord): AttentionInterventionItem {
  if (record.status === 'CLOSED') {
    throw new AttentionError({
      code: 'ATTN_INPUT',
      message: `interventionToAttentionItem: CLOSED intervention ${record.id} must not enter the scorer (input contract: OPEN/PENDING only — INV-ATTN-1 scopes the attention queue)`,
    })
  }
  return {
    kind: 'INTERVENTION',
    id: record.id,
    title: record.title,
    createdAt: record.created_at,
    workstreamId: record.workstream_ids[0] ?? null,
    status: record.status,
    origin: record.origin,
  }
}

/* ------------------------------------------------------------------ *
 * Service
 * ------------------------------------------------------------------ */

export interface AttentionServiceOptions extends AttentionSourcePorts {
  /** The injected operational-DB surface（awareness 第二连接）。 */
  readonly db: AttentionDb
  /** Injectable clock（默认 `Date.now` — 测试注入确定性时钟）。 */
  readonly now?: () => number
}

export class AttentionService {
  private readonly awareness: AwarenessStore
  private readonly ports: AttentionSourcePorts
  private readonly now: () => number

  constructor(options: AttentionServiceOptions) {
    if (options.db === undefined) {
      throw new AttentionError({ code: 'ATTN_INPUT', message: 'db: the injected operational-DB face is required' })
    }
    this.awareness = new AwarenessStore({ db: options.db })
    this.ports = {
      getActiveInterventions: options.getActiveInterventions,
      getProposedNextActions: options.getProposedNextActions,
      getActiveBlockers: options.getActiveBlockers,
      getScheduledEvents: options.getScheduledEvents,
    }
    this.now = options.now ?? Date.now
  }

  /* ---------------------------------------------------------------- *
   * Awareness face（INV-PERM-2: 状态仅用户可改）
   * ---------------------------------------------------------------- */

  /**
   * 用户标记/迁移 awareness 状态（矩阵行「Awareness 状态」✅ 列唯一落地）。
   * actor 门: `kind !== 'USER'` ⇒ ATTN_PERM（INV-PERM-2）。
   * kind 白名单: 冻结 schema（INV-ATTN-4: 只对高价值对象 — TASK 等
   * 白名单外 kind 拒绝, 不建「逐事件确认」通道）。
   */
  setAwareness(objectRef: AwarenessObjectRef, state: AwarenessState, actor: AttentionActor): AwarenessRecord {
    assertUserActor(actor, 'setAwareness')
    return this.awareness.upsert(objectRef, state, this.now())
  }

  /** 读一条 awareness（无记录 = null — 消费方按 §9.5 默认 UNSEEN 解释）。 */
  getAwareness(objectRef: AwarenessObjectRef): AwarenessRecord | null {
    return this.awareness.get(objectRef)
  }

  /** 读全部 awareness（稳定顺序 kind ASC, id ASC）。 */
  listAwareness(): AwarenessRecord[] {
    return this.awareness.list()
  }

  /* ---------------------------------------------------------------- *
   * Attention Manager baseline face（供 GUI 切片与 Living Brief —
   * WP-5.5 消费）
   * ---------------------------------------------------------------- */

  /**
   * baseline 排序（计划书 §20 第 2 步; 纯确定性 — 同数据源状态同输出）。
   * 输入组装: 四端口（缺省 = 空, 不伪造数据）+ INTERVENTION 项注入
   * awareness state（kind 在白名单内 ⇒ 有记录才带, 无记录 = undefined
   * 按默认 UNSEEN 语义计 gap — scorer.ts 口径）。
   * INV-ATTN-1: 返回**全集**排序（评分器无隐藏路径）。
   */
  getAttentionRanking(): AttentionRanking {
    const now = this.now()
    const items: AttentionItem[] = []

    for (const record of this.ports.getActiveInterventions?.() ?? []) {
      if (record.status === 'CLOSED') continue // 防御: 端口契约外终态不评分
      const item = interventionToAttentionItem(record)
      // INTERVENTION ∈ awareness kind 白名单（INV-ATTN-4）⇒ 有记录即注入。
      const awareness = this.awareness.get({ kind: 'INTERVENTION', id: item.id })
      items.push({ ...item, awarenessState: awareness?.state ?? null })
    }
    for (const item of this.ports.getProposedNextActions?.() ?? []) {
      items.push(item)
    }
    for (const item of this.ports.getActiveBlockers?.() ?? []) {
      items.push(item)
    }
    for (const item of this.ports.getScheduledEvents?.() ?? []) {
      items.push(item)
    }

    // context 项目特征: baseline 零权重（scorer 权重表）⇒ 取默认值即可,
    // 与 client 侧从 dashboard 快照取真实值不产生排序分歧（一致性论证见头注）。
    const context: AttentionContext = {
      now,
      projectImportance: 0,
      attentionMode: 'NORMAL',
    }
    return rankAttention(items, context)
  }

  /* ---------------------------------------------------------------- */

  /** Test/inspection seam: 关底层 store（之后所有面 ATTN_STORE 拒绝）。 */
  close(): void {
    this.awareness.close()
  }
}

/** actor 门（矩阵行「Awareness 状态」: 仅 USER 列 ✅ — INV-PERM-2）。 */
function assertUserActor(actor: AttentionActor, operation: string): void {
  if (actor === null || typeof actor !== 'object' || typeof actor.kind !== 'string') {
    throw new AttentionError({ code: 'ATTN_INPUT', message: `${operation}: actor must be an actorRef object ({kind, …})` })
  }
  if (actor.kind !== 'USER') {
    throw new AttentionError({
      code: 'ATTN_PERM',
      message: `${operation}: awareness state is user-only (ARCHITECTURE §6 矩阵行「Awareness 状态」; INV-PERM-2) — got actor.kind=${JSON.stringify(actor.kind)}`,
    })
  }
}

/* ------------------------------------------------------------------ *
 * DB 打开面（宿主接线用 — 同 WP-2.4 openRunBindingDatabase /
 * WP-3.5 openFloodingDatabase 模式）
 * ------------------------------------------------------------------ */

/** `openAttentionDatabase` 返回对（第二连接 + WP-2.1 store）。 */
export interface AttentionDatabase {
  /** WP-2.1 store handle（event append + meta）— 同文件。 */
  readonly store: ResearchStore
  /** 本 WP 第二连接（node:sqlite DatabaseSync 适配为 `AttentionDb` 结构端口;
   *  awareness DDL 由 `AwarenessStore` 构造时幂等应用）。 */
  readonly db: AttentionDb
  /** 关闭本对（第二连接 + store 连接）— idempotent。 */
  close(): void
}

/**
 * 经 WP-2.1 `openDatabase` 封装打开（或初始化）research.sqlite, 并在同文件
 * 开第二 `node:sqlite` 连接适配为 `AttentionDb`（双连接模式: 文件 init/
 * WAL/user_version 门归封装; busy_timeout 同 store 默认 — 同 WP-3.5 先例）。
 */
export function openAttentionDatabase(path: string, options: OpenDatabaseOptions = {}): AttentionDatabase {
  let store: ResearchStore
  try {
    store = openDatabase(path, options)
  } catch (cause) {
    throw new AttentionError({
      code: 'ATTN_STORE',
      message: `openAttentionDatabase: cannot open ${path}: ${describe(cause)}`,
      cause,
    })
  }

  // 第二连接（node:sqlite 是 store 已在用的 Node builtin — INV-PERM-5 合规）。
  let db: InstanceType<typeof DatabaseSync> | null = null
  try {
    const conn = new DatabaseSync(path)
    conn.exec(`PRAGMA busy_timeout = 5000`)
    db = conn
  } catch (cause) {
    if (db !== null) {
      try {
        db.close()
      } catch {
        /* best effort */
      }
    }
    store.close()
    throw new AttentionError({ code: 'ATTN_STORE', message: `openAttentionDatabase: second connection failed at ${path}: ${describe(cause)}`, cause })
  }

  const adapted: AttentionDb = {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => Number(db.prepare(sql).run(...params).changes),
    get: (sql, ...params) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
    all: (sql, ...params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
    transaction: <T>(work: () => T): T => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (cause) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction may already have rolled back */
        }
        throw cause
      }
    },
  }

  let closed = false
  return {
    store,
    db: adapted,
    close(): void {
      if (closed) return
      closed = true
      try {
        db.close()
      } catch {
        /* best effort */
      }
      store.close()
    },
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
