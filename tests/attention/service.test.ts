/**
 * WP-5.4 — `AttentionService` 服务面测试。
 *
 * 覆盖（任务测试项: awareness 权限 + 评分器组装面）:
 *  - awareness 权限（矩阵行「Awareness 状态 ✅/❌/❌/❌」, INV-PERM-2）:
 *    USER 放行; AGENT/PLUGIN/其他 kind 一律 ATTN_PERM 拒绝（行不落地）;
 *  - INV-ATTN-4（awareness 仅高价值对象）: kind 白名单外（TASK 等）
 *    ATTN_INPUT 拒绝 — 不建「逐事件确认」通道; state 枚举同拒;
 *  - `getAttentionRanking()` 组装: 四数据源端口（缺省 = 空, 不伪造数据）;
 *    CLOSED Intervention 防御性排除; INTERVENTION 项注入 awareness
 *    state（有记录才带 — 无记录 = 默认 UNSEEN 语义）; 确定性（同数据源
 *    同 now ⇒ 同输出）;
 *  - `interventionToAttentionItem` 映射（第一个关联 WS / 无关联 null /
 *    CLOSED 拒绝）。
 */
import { describe, expect, it, afterAll } from 'vitest'

import {
  AttentionService,
  isAttentionError,
  interventionToAttentionItem,
  type ActiveInterventionRecord,
} from '../../src/host/service/attention/index.js'
import { ATTENTION_WEIGHTS, rankAttention } from '../../src/host/service/attention/scorer.js'
import { makeTempDir } from '../flooding/fixtures.js'
import type { FloodingDb } from '../../src/host/service/flooding/index.js'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  makeBlocker,
  makeContext,
  makeEvent,
  makeIntervention,
  makeNextAction,
  T_NOW,
} from './fixtures.js'

/** 真实 research.sqlite 第二连接（同 persist 套件的打开面）。 */
function makeDb(): { db: FloodingDb; close: () => void } {
  const dir = makeTempDir('wp54-attn-svc-')
  const raw = new DatabaseSync(join(dir, 'research.sqlite'))
  raw.exec('PRAGMA busy_timeout = 5000')
  const db: FloodingDb = {
    exec: (sql) => raw.exec(sql),
    run: (sql, ...params) => Number(raw.prepare(sql).run(...params).changes),
    get: (sql, ...params) => raw.prepare(sql).get(...params) as Record<string, unknown> | undefined,
    all: (sql, ...params) => raw.prepare(sql).all(...params) as Record<string, unknown>[],
    transaction: <T>(work: () => T): T => {
      raw.exec('BEGIN IMMEDIATE')
      try {
        const r = work()
        raw.exec('COMMIT')
        return r
      } catch (cause) {
        raw.exec('ROLLBACK')
        throw cause
      }
    },
  }
  return { db, close: () => raw.close() }
}

const USER = { kind: 'USER', user_id: 'u-1' }
const AGENT = { kind: 'AGENT', run_id: 'R-1' }
const PLUGIN = { kind: 'PLUGIN' }
const INVESTIGATOR = { kind: 'INVESTIGATOR', label: 'inv' }

/** 结构化错误断言助手（同 tests/flooding throwsFlooding 纪律）。 */
function throwsAttention(fn: () => unknown, code: string, msgPattern?: RegExp): void {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  expect(caught, `expected AttentionError(${code}) to be thrown`).toBeDefined()
  expect(isAttentionError(caught)).toBe(true)
  expect(caught).toHaveProperty('code', code)
  if (msgPattern !== undefined) expect((caught as Error).message).toMatch(msgPattern)
}

function ivRecord(over: Partial<ActiveInterventionRecord> = {}): ActiveInterventionRecord {
  return {
    id: 'IV-1',
    title: '审阅累积的 Agent PlanFork',
    origin: 'AUTO_FLOODING',
    status: 'OPEN',
    workstream_ids: ['WS-1', 'WS-2'],
    created_at: T_NOW - 2 * 60 * 60 * 1000,
    ...over,
  }
}

describe('awareness 权限门（矩阵行「Awareness 状态」, INV-PERM-2）', () => {
  it('USER 放行（矩阵 ✅ 列唯一落地）', () => {
    const { db, close } = makeDb()
    try {
      const svc = new AttentionService({ db, now: () => 1_700_000_000_000 })
      const rec = svc.setAwareness({ kind: 'INTERVENTION', id: 'IV-1' }, 'SEEN', USER)
      expect(rec.state).toBe('SEEN')
      expect(svc.getAwareness({ kind: 'INTERVENTION', id: 'IV-1' })?.state).toBe('SEEN')
    } finally {
      close()
    }
  })

  for (const [label, actor] of [
    ['AGENT', AGENT],
    ['PLUGIN', PLUGIN],
    ['INVESTIGATOR', INVESTIGATOR],
  ] as const) {
    it(`${label} 拒绝（矩阵 ❌ 列 — ATTN_PERM, 行不落地）`, () => {
      const { db, close } = makeDb()
      try {
        const svc = new AttentionService({ db, now: () => 1_700_000_000_000 })
        throwsAttention(() => svc.setAwareness({ kind: 'INTERVENTION', id: 'IV-1' }, 'SEEN', actor), 'ATTN_PERM', /user-only/)
        // 拒绝 ⇒ 无行:
        expect(svc.getAwareness({ kind: 'INTERVENTION', id: 'IV-1' })).toBeNull()
      } finally {
        close()
      }
    })
  }

  it('actor 缺 kind ⇒ ATTN_INPUT（入参契约, 不是权限码）', () => {
    const { db, close } = makeDb()
    try {
      const svc = new AttentionService({ db })
      throwsAttention(() => svc.setAwareness({ kind: 'CLAIM', id: 'CLM-1' }, 'SEEN', {} as never), 'ATTN_INPUT')
    } finally {
      close()
    }
  })
})

describe('INV-ATTN-4: awareness 仅高价值对象（kind 白名单 = 冻结 schema）', () => {
  const pair = makeDb()
  const db = pair.db
  afterAll(() => pair.close())

  it('白名单外 kind（TASK 不在白名单）拒绝, 不建逐事件确认通道', () => {
    const svc = new AttentionService({ db })
    throwsAttention(() => svc.setAwareness({ kind: 'TASK' as never, id: 'T-1' }, 'SEEN', USER), 'ATTN_INPUT', /whitelist/)
    // 白名单内 kind 放行（对照面）:
    expect(svc.setAwareness({ kind: 'PLAN_FORK', id: 'PF-1' }, 'UNSEEN', USER).state).toBe('UNSEEN')
  })

  it('白名单外 state 拒绝', () => {
    const svc = new AttentionService({ db })
    throwsAttention(() => svc.setAwareness({ kind: 'CLAIM', id: 'CLM-1' }, 'RECALLED' as never, USER), 'ATTN_INPUT')
  })
})

describe('getAttentionRanking 组装面', () => {
  it('空端口 ⇒ 空排序（不伪造数据）; generatedAt = 注入 now', () => {
    const { db, close } = makeDb()
    try {
      const svc = new AttentionService({ db, now: () => T_NOW })
      expect(svc.getAttentionRanking().items).toEqual([])
    } finally {
      close()
    }
  })

  it('四数据源混排 + CLOSED 防御性排除 + awareness state 注入（INTERVENTION）', () => {
    const { db, close } = makeDb()
    try {
      const svc = new AttentionService({
        db,
        now: () => T_NOW,
        getActiveInterventions: () => [
          ivRecord({ id: 'IV-1', status: 'OPEN' }),
          ivRecord({ id: 'IV-2', status: 'PENDING', workstream_ids: [] }),
          ivRecord({ id: 'IV-3', status: 'CLOSED' }), // 防御性排除
        ],
        getProposedNextActions: () => [makeNextAction({ id: 'NA-1' })],
        getActiveBlockers: () => [makeBlocker({ id: 'BLK-1' })],
        getScheduledEvents: () => [
          makeEvent({ id: 'SEV-1' }),
          makeEvent({ id: 'SEV-2', at: T_NOW + 30 * 24 * 60 * 60 * 1000 }),
        ],
      })
      // 用户先把 IV-1 标记为 ASSESSED（消掉它的 gap 加成）:
      svc.setAwareness({ kind: 'INTERVENTION', id: 'IV-1' }, 'ASSESSED', USER)

      const ranking = svc.getAttentionRanking()
      // 全集: 6 项（CLOSED 排除）:
      expect(ranking.items.map((i) => i.id).sort()).toEqual(['BLK-1', 'IV-1', 'IV-2', 'NA-1', 'SEV-1', 'SEV-2'])
      // awareness 注入: IV-1 = ASSESSED（无 gap）; IV-2/其余 = 无记录（默认 UNSEEN 语义, 有 gap）:
      const iv1 = ranking.items.find((i) => i.id === 'IV-1')!
      expect(iv1.awarenessState).toBe('ASSESSED')
      expect(iv1.score).toBe(ATTENTION_WEIGHTS.interventionOpen)
      const iv2 = ranking.items.find((i) => i.id === 'IV-2')!
      expect(iv2.awarenessState).toBeNull()
      expect(iv2.score).toBe(ATTENTION_WEIGHTS.interventionPending + ATTENTION_WEIGHTS.awarenessGap)
      // 无 WS 关联的 IV-2 恒在（INV-ATTN-1: 不隐藏）, workstreamId = null:
      expect(iv2.workstreamId).toBeNull()
      // 与独立评分器同数据源同 context 的输出逐位一致（组装无副作用）:
      const direct = rankAttention(
        [
          { ...interventionToAttentionItem(ivRecord({ id: 'IV-1', status: 'OPEN' })), awarenessState: 'ASSESSED' },
          { ...interventionToAttentionItem(ivRecord({ id: 'IV-2', status: 'PENDING', workstream_ids: [] })), awarenessState: null },
          makeNextAction({ id: 'NA-1' }),
          makeBlocker({ id: 'BLK-1' }),
          makeEvent({ id: 'SEV-1' }),
          makeEvent({ id: 'SEV-2', at: T_NOW + 30 * 24 * 60 * 60 * 1000 }),
        ],
        makeContext(),
      )
      expect(ranking.items.map((i) => `${i.id}:${i.score}`)).toEqual(direct.items.map((i) => `${i.id}:${i.score}`))
    } finally {
      close()
    }
  })

  it('确定性: 同数据源同 now ⇒ 同输出（连调两次全等）', () => {
    const { db, close } = makeDb()
    try {
      const svc = new AttentionService({
        db,
        now: () => T_NOW,
        getActiveInterventions: () => [ivRecord()],
        getActiveBlockers: () => [makeBlocker()],
        getScheduledEvents: () => [makeEvent()],
      })
      expect(svc.getAttentionRanking()).toEqual(svc.getAttentionRanking())
    } finally {
      close()
    }
  })

  it('UNSEEN Intervention 的 gap 加成使 OPEN UNSEEN（110）压过 BLOCKER UNSEEN（100）— 类型主导 + gap 语义', () => {
    const { db, close } = makeDb()
    try {
      const svc = new AttentionService({
        db,
        now: () => T_NOW,
        getActiveInterventions: () => [ivRecord({ id: 'IV-1', status: 'OPEN' })],
        getActiveBlockers: () => [makeBlocker({ id: 'BLK-1' })],
      })
      const ranking = svc.getAttentionRanking()
      expect(ranking.items.map((i) => i.id)).toEqual(['IV-1', 'BLK-1'])
      // 用户审阅 IV-1 后（ASSESSED ⇒ 无 gap）: OPEN(100) vs BLOCKER UNSEEN(100)
      // 同分 ⇒ 类型档 IV 先（tie-break, 不隐藏）:
      svc.setAwareness({ kind: 'INTERVENTION', id: 'IV-1' }, 'ASSESSED', USER)
      const after = svc.getAttentionRanking()
      expect(after.items.map((i) => i.id)).toEqual(['IV-1', 'BLK-1'])
      expect(after.items[0]!.score).toBe(100)
      expect(after.items[1]!.score).toBe(100)
    } finally {
      close()
    }
  })
})

describe('interventionToAttentionItem 映射', () => {
  it('第一个关联 WS → workstreamId; 无关联 → null', () => {
    expect(interventionToAttentionItem(ivRecord()).workstreamId).toBe('WS-1')
    expect(interventionToAttentionItem(ivRecord({ workstream_ids: [] })).workstreamId).toBeNull()
  })

  it('CLOSED 拒绝（输入契约: 终态不进评分器 — ATTN_INPUT）', () => {
    throwsAttention(() => interventionToAttentionItem(ivRecord({ status: 'CLOSED' })), 'ATTN_INPUT')
  })

  it('字段逐字映射（id/title/origin/status/created_at）', () => {
    const item = interventionToAttentionItem(ivRecord({ id: 'IV-7', title: 't', origin: 'USER' }))
    expect(item).toMatchObject({
      kind: 'INTERVENTION',
      id: 'IV-7',
      title: 't',
      origin: 'USER',
      status: 'OPEN',
      createdAt: T_NOW - 2 * 60 * 60 * 1000,
    })
  })
})
