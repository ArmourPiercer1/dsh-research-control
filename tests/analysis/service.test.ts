/**
 * WP-7.3 — `AnalysisRecordService` 面审计（真实 research.sqlite + 真实冻结
 * 形状网 + 真实 IdAllocator; 同 WP-6.4 service 测试纪律）:
 *
 *  - 保存全流（用户显式 — INV-PERM-3 落地面）: ① actor 门 + 预校验 →
 *    ② AN 号 reserve → ③ 行落库（整行冻结网）→ ④ commit; 结果往返;
 *    created_at 单次采样（与注入时钟同源）;
 *  - **用户门（Agent 保存被拒 — 任务测试项）**: 非 USER actor（AGENT /
 *    PLUGIN / SYSTEM — 含 Investigator Agent 的任何化身; cast 伪造）⇒
 *    AN_ACTOR_FORBIDDEN, **零写入**（拒绝先于 id 预留 — allocator 未动 +
 *    表零行）; USER actor 放行;
 *  - 预校验精确分类（无写）: 空 content / 坏 sourceRef（非对象 / 未知
 *    kind / 坏 id）/ 坏 investigatorRunId / 空 dshSessionId;
 *  - id 纪律（§1.1 单调, gap 合法）: 失败保存烧号不回收（下一次 reserve
 *    取更大号）; 成功保存 commit 后号不重复;
 *  - 查询面: getAnalysisRecord（null 缺席）/ listAnalysisRecords（全量 +
 *    过滤透传 — 无隐藏过滤器）;
 *  - store 错误传播（AN_STORE 包 cause）+ 构造器边界。
 */

import { describe, expect, it } from 'vitest'

import {
  AnalysisError,
  AnalysisRecordService,
  AnalysisStore,
  isAnalysisError,
  USER_ACTOR,
  type UserActorRef,
} from '../../src/host/service/analysis/index.js'
import type { AnalysisServiceOptions } from '../../src/host/service/analysis/index.js'
import {
  makeAnalysisHarness,
  ref,
  throwsAnalysis,
  USER,
  USER_BARE,
} from './fixtures.js'

describe('保存全流（用户显式 — INV-PERM-3 落地面）', () => {
  it('USER 保存全流: reserve → insert → commit; 结果往返; created_at 单次采样', () => {
    const h = makeAnalysisHarness()
    const before = h.clock.value()
    const { record } = h.service.saveAsAnalysisRecord(
      {
        sourceRef: ref('INTERVENTION', 'IV-5'),
        content: '## 结论\n\ninvestigator 判断: results/ 未注册 CSV 属于 T-3 产物。',
        investigatorRunId: 'R-81',
        dshSessionId: 'investigator-abc-123',
      },
      USER,
    )
    // AN 号经真实 allocator 分配（PROJECT scope, 首个 = AN-1）。
    expect(record.id).toBe('AN-1')
    expect(record.created_at).toBe(before + 1)
    expect(record.source_ref).toEqual({ kind: 'INTERVENTION', id: 'IV-5' })
    expect(record.investigator_run_id).toBe('R-81')
    expect(record.dsh_session_id).toBe('investigator-abc-123')
    // 落库往返（经 store 查询面 — 与保存结果同形）。
    expect(h.service.getAnalysisRecord('AN-1')).toEqual(record)
    h.close()
  })

  it('可选字段缺席形态（investigatorRunId / dshSessionId 不携带）', () => {
    const h = makeAnalysisHarness()
    const { record } = h.service.saveAsAnalysisRecord(
      { sourceRef: ref('INBOX_ITEM', 'IN-11'), content: 'audit finding 分析' },
      USER_BARE,
    )
    expect(record).toEqual({
      id: 'AN-1',
      source_ref: { kind: 'INBOX_ITEM', id: 'IN-11' },
      content: 'audit finding 分析',
      created_at: expect.any(Number),
    })
    expect(h.service.getAnalysisRecord('AN-1')).toEqual(record)
    h.close()
  })

  it('USER_ACTOR 常量面（GUI 缺省 actor）可用', () => {
    const h = makeAnalysisHarness()
    const { record } = h.service.saveAsAnalysisRecord(
      { sourceRef: ref('TOPIC', 'TPC-3'), content: 'Topic Brief 分析' },
      USER_ACTOR,
    )
    expect(record.id).toBe('AN-1')
    h.close()
  })
})

describe('用户门（Agent 保存被拒 — INV-PERM-3 运行面; 零写入）', () => {
  const forgeries: readonly (unknown)[] = [
    { kind: 'AGENT', run_id: 'R-81' },
    { kind: 'AGENT', run_id: 'R-81', label: 'investigator' },
    { kind: 'PLUGIN', label: 'research-control' },
    { kind: 'SYSTEM' },
    { kind: 'INVESTIGATOR' },
    null,
    undefined,
    'USER',
  ]

  for (const actor of forgeries) {
    it(`伪造 actor ${JSON.stringify(actor)} ⇒ AN_ACTOR_FORBIDDEN + 零写入`, () => {
      const h = makeAnalysisHarness()
      const before = h.clock.value()
      throwsAnalysis(
        () =>
          h.service.saveAsAnalysisRecord(
            { sourceRef: ref('INTERVENTION', 'IV-5'), content: 'attempted agent save' },
            actor as UserActorRef,
          ),
        'AN_ACTOR_FORBIDDEN',
        /USER actor/,
      )
      // 零写入: 表零行 + 时钟未采样（拒绝先于任何 id 预留 / 行写）。
      expect(h.rawSql('SELECT count(*) AS n FROM analysis_record')[0]).toMatchObject({ n: 0 })
      expect(h.clock.value()).toBe(before)
      // allocator 未动 — 下一次 USER 保存仍从 AN-1 开始。
      const { record } = h.service.saveAsAnalysisRecord(
        { sourceRef: ref('INTERVENTION', 'IV-5'), content: 'user save after rejection' },
        USER,
      )
      expect(record.id).toBe('AN-1')
      h.close()
    })
  }

  it('actor 面畸形字段 ⇒ AN_INPUT（user_id 非字符串 / label 超长）', () => {
    const h = makeAnalysisHarness()
    throwsAnalysis(
      () =>
        h.service.saveAsAnalysisRecord(
          { sourceRef: ref('INTERVENTION', 'IV-5'), content: 'x' },
          { kind: 'USER', user_id: 42 } as unknown as UserActorRef,
        ),
      'AN_INPUT',
      /user_id/,
    )
    throwsAnalysis(
      () =>
        h.service.saveAsAnalysisRecord(
          { sourceRef: ref('INTERVENTION', 'IV-5'), content: 'x' },
          { kind: 'USER', label: 'x'.repeat(201) },
        ),
      'AN_INPUT',
      /label/,
    )
    h.close()
  })
})

describe('预校验精确分类（无写 — 拒绝先于 id 预留）', () => {
  const cases: readonly { readonly label: string; readonly sourceRef?: unknown; readonly content?: unknown; readonly investigatorRunId?: unknown; readonly dshSessionId?: unknown; readonly pattern: RegExp }[] = [
    { label: '空 content', content: '', pattern: /content/ },
    { label: 'content 非字符串', content: 42, pattern: /content/ },
    { label: 'sourceRef 非对象', sourceRef: 'IV-5', pattern: /sourceRef/ },
    { label: 'sourceRef 未知 kind', sourceRef: { kind: 'NOT_A_KIND', id: 'IV-5' }, pattern: /ObjectKind/ },
    { label: 'sourceRef 缺 id', sourceRef: { kind: 'INTERVENTION' }, pattern: /sourceRef\.id/ },
    { label: 'sourceRef 坏 id', sourceRef: { kind: 'INTERVENTION', id: 'iv-5' }, pattern: /sourceRef\.id/ },
    { label: '坏 investigatorRunId', investigatorRunId: 'RUN-1', pattern: /investigatorRunId/ },
    { label: 'investigatorRunId 小写', investigatorRunId: 'r-1', pattern: /investigatorRunId/ },
    { label: '空 dshSessionId', dshSessionId: '', pattern: /dshSessionId/ },
    { label: 'dshSessionId 非字符串', dshSessionId: 7, pattern: /dshSessionId/ },
  ]

  for (const c of cases) {
    it(`${c.label} ⇒ AN_INPUT + 零写入 + allocator 未动`, () => {
      const h = makeAnalysisHarness()
      // 有意注入畸形载荷（测试面 cast — 服务预校验必须接住）。
      const params = {
        sourceRef: (c.sourceRef ?? ref('INTERVENTION', 'IV-5')) as unknown as { kind: 'INTERVENTION'; id: string },
        content: (c.content ?? 'content') as unknown as string,
        ...(c.investigatorRunId !== undefined ? { investigatorRunId: c.investigatorRunId as string } : {}),
        ...(c.dshSessionId !== undefined ? { dshSessionId: c.dshSessionId as string } : {}),
      }
      throwsAnalysis(
        () => h.service.saveAsAnalysisRecord(params, USER),
        'AN_INPUT',
        c.pattern,
      )
      expect(h.rawSql('SELECT count(*) AS n FROM analysis_record')[0]).toMatchObject({ n: 0 })
      const { record } = h.service.saveAsAnalysisRecord(
        { sourceRef: ref('INTERVENTION', 'IV-5'), content: 'after rejection' },
        USER,
      )
      expect(record.id).toBe('AN-1')
      h.close()
    })
  }
})

describe('id 纪律（§1.1 单调, gap 合法 — 失败烧号不回收）', () => {
  it('成功 → 失败（store 注入故障）→ 成功: 烧号留 gap, 号严格递增', () => {
    const h = makeAnalysisHarness()
    const ok1 = h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-5'), content: 'one' }, USER)
    expect(ok1.record.id).toBe('AN-1')

    // 注入 store 故障（第 2 次 insert 抛错 — 模拟驱动失败）。
    const realInsert = h.store.insertRecord.bind(h.store)
    let calls = 0
    h.store.insertRecord = (rec) => {
      calls += 1
      if (calls === 1) throw new Error('injected driver failure')
      return realInsert(rec)
    }
    expect(() =>
      h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-5'), content: 'two' }, USER),
    ).toThrow(AnalysisError)
    // 烧号: AN-2 已烧（reserve 后失败 release — gap 合法, 不回收）。
    const ok3 = h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-5'), content: 'three' }, USER)
    expect(ok3.record.id).toBe('AN-3')
    expect(h.service.listAnalysisRecords().map((r) => r.id)).toEqual(['AN-1', 'AN-3'])
    h.close()
  })

  it('同一 AN 号永不重复分配（allocator 语义面 — 多次成功严格递增）', () => {
    const h = makeAnalysisHarness()
    const ids = [1, 2, 3, 4].map(() =>
      h.service.saveAsAnalysisRecord({ sourceRef: ref('CLAIM', 'C-17'), content: `n${h.clock.value()}` }, USER).record.id,
    )
    expect(ids).toEqual(['AN-1', 'AN-2', 'AN-3', 'AN-4'])
    h.close()
  })
})

describe('查询面（无隐藏过滤器 — INV-ATTN-1 同款纪律）', () => {
  it('getAnalysisRecord: 缺席 = null（非错误）', () => {
    const h = makeAnalysisHarness()
    expect(h.service.getAnalysisRecord('AN-1')).toBeNull()
    h.close()
  })

  it('listAnalysisRecords: 全量 + 过滤透传', () => {
    const h = makeAnalysisHarness()
    h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-5'), content: 'a' }, USER)
    h.service.saveAsAnalysisRecord({ sourceRef: ref('TOPIC', 'TPC-3'), content: 'b' }, USER)
    h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-9'), content: 'c' }, USER)
    expect(h.service.listAnalysisRecords().length).toBe(3)
    expect(h.service.listAnalysisRecords({ sourceKind: 'INTERVENTION' }).map((r) => r.id)).toEqual(['AN-1', 'AN-3'])
    expect(h.service.listAnalysisRecords({ sourceId: 'TPC-3' }).map((r) => r.id)).toEqual(['AN-2'])
    h.close()
  })
})

describe('错误传播与构造器边界', () => {
  it('store 层 AnalysisError 原样传播（不重复包）', () => {
    const h = makeAnalysisHarness()
    h.store.close()
    const e = throwsAnalysis(
      () => h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-5'), content: 'x' }, USER),
      'AN_STORE',
      /closed/,
    )
    expect(isAnalysisError(e)).toBe(true)
    h.close()
  })

  it('非 AnalysisError 包 AN_STORE（cause 保留）', () => {
    const h = makeAnalysisHarness()
    const realInsert = h.store.insertRecord.bind(h.store)
    h.store.insertRecord = () => {
      throw new TypeError('boom')
    }
    expect(() =>
      h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-5'), content: 'x' }, USER),
    ).toThrow(AnalysisError)
    void realInsert
    h.close()
  })

  it('构造器边界（store / allocator / projectId 缺失）', () => {
    const h = makeAnalysisHarness()
    const partial = {
      store: h.store,
      allocator: h.allocator,
      projectId: 'PRJ-1',
    } satisfies AnalysisServiceOptions
    throwsAnalysis(() => new AnalysisRecordService({ ...partial, store: {} as never }), 'AN_INPUT', /store/)
    throwsAnalysis(() => new AnalysisRecordService({ ...partial, allocator: {} as never }), 'AN_INPUT', /allocator/)
    throwsAnalysis(() => new AnalysisRecordService({ ...partial, projectId: '' }), 'AN_INPUT', /projectId/)
    h.close()
  })
})
