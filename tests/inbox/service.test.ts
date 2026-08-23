/**
 * WP-6.4 — `InboxService` 面测试（真实 research.sqlite + 真实冻结
 * inbox.schema.json 形状网 + 真实 IdAllocator; 端口 stub 记录型 —
 * 同 WP-5.1/WP-5.2 service 测试纪律）:
 *
 *  - 捕获缝: captureHuman（USER 面, source 常量）/ captureMechanical
 *    （6 值机械闭集 — WP-6.1/6.2/6.3 缝的落库面; 含 WP-6.3
 *    InboxEntryDraft 形状的结构兼容直钉）— 号分配/commit/release
 *    纪律 + actor 双面门 + 冻结形状网;
 *  - §13 迁移: dismiss（仅用户; 终态无出口; 乐观并发门）;
 *  - §28 转换流: convert（显式确认类型面 + 运行面; 7 kind 分派;
 *    执行器失败/未接线/畸形 ref; 条件 UPDATE 并发门; INBOX_CONVERTED
 *    账本行 — 15 值冻结 action_kind; 账本失败大声 + 已提交残差指引）;
 *  - §22.3 高影响升级: escalateMechanical（机械判定三规则 + OR + 冻结
 *    理由序; 恒先捕获 + 升级标记落 raw; highImpact ⇒ Intervention
 *    联动 — source_refs 打头 INBOX_ITEM ref; 非高影响零联动;
 *    联动端口缺位写前大声; 联动失败条目保留）。
 */

import { describe, expect, it } from 'vitest'

import { counterKey } from '../../src/shared/ids/index.js'
import { USER, AGENT, PLUGIN, makeInboxHarness, ref, throwsInbox, USER_BARE } from './fixtures.js'

const T0 = 1_700_000_000_000

describe('captureHuman（用户快捷捕获 — §11 HUMAN_QUICK_CAPTURE）', () => {
  it('happy path: IN 号分配 + CAPTURED 初始态 + payload/raw/contextRefs 落库', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const { item } = service.captureHuman(
      { payload: '随手记: 周三组会讨论 results 目录', contextRefs: [ref('WORKSTREAM', 'WS-1')], raw: { note: 1 } },
      USER,
    )
    expect(item).toEqual({
      id: 'IN-1',
      source: 'HUMAN_QUICK_CAPTURE',
      payload: '随手记: 周三组会讨论 results 目录',
      raw: { note: 1 },
      context_refs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
      state: 'CAPTURED',
      created_at: expect.any(Number),
    })
    expect(item.created_at).toBeGreaterThan(T0)
    // 号 commit（真实 allocator 计数器面 — IN 族, PROJECT scope）
    expect(h.meta.getCounter(counterKey('INBOX_ITEM', 'PRJ-1'))).toBe(1)
    // 落库行 = 返回行（真表可读）
    expect(h.store.getItem('IN-1')).toEqual(item)
    h.close()
  })

  it('source 常量面: 构建面不接受 source 参数（HUMAN_QUICK_CAPTURE 固定）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const { item } = service.captureHuman({ payload: 'x' }, USER_BARE)
    expect(item.source).toBe('HUMAN_QUICK_CAPTURE')
    h.close()
  })

  it('非 USER actor ⇒ IN_ACTOR_FORBIDDEN（运行面; 零写入 + 零号烧）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    throwsInbox(() => service.captureHuman({ payload: 'x' }, AGENT as never), 'IN_ACTOR_FORBIDDEN', /USER actor/)
    expect(h.store.listItems().length).toBe(0)
    expect(h.meta.getCounter(counterKey('INBOX_ITEM', 'PRJ-1'))).toBe(0)
    h.close()
  })

  it('预校验失败 = 零号烧（空 payload — §1.1 单调 gap 语义: 失败不占号）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    throwsInbox(() => service.captureHuman({ payload: '' }, USER), 'IN_INPUT', /payload/)
    expect(h.meta.getCounter(counterKey('INBOX_ITEM', 'PRJ-1'))).toBe(0)
    h.close()
  })

  it('contextRefs 形状断言（{kind,id} 非空 — 精确指名失败项）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    throwsInbox(() => service.captureHuman({ payload: 'x', contextRefs: [{ id: 'A-1' }] as never }, USER), 'IN_INPUT', /contextRefs\[0\]/)
    h.close()
  })
})

describe('captureMechanical（机械入口缝 — audit/discovery/reconcile/flooding）', () => {
  const SOURCES = [
    'UNCLASSIFIED_AUDIT_FINDING',
    'IMPORTED_MEETING_NOTE',
    'UNREGISTERED_WORKSPACE_CHANGE',
    'AGENT_UNSTRUCTURED_REPORT',
    'EXTERNAL_NOTE',
    'DISCOVERED_SESSION',
  ] as const

  it('6 值机械闭集全部放行（类型面闭集的运行面印证）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    SOURCES.forEach((source, i) => {
      const { item } = service.captureMechanical({ source, payload: `p${i}` }, PLUGIN)
      expect(item.source).toBe(source)
      expect(item.id).toBe(`IN-${i + 1}`)
    })
    h.close()
  })

  it('HUMAN_QUICK_CAPTURE 不在机械闭集（运行面再断言 — 用户面唯一）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    throwsInbox(
      () => service.captureMechanical({ source: 'HUMAN_QUICK_CAPTURE' as never, payload: 'x' }, PLUGIN),
      'IN_INPUT',
      /mechanical source closed set/,
    )
    h.close()
  })

  it('USER actor 触机械面 ⇒ IN_ACTOR_FORBIDDEN（非 USER 闭集 — 双面）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    throwsInbox(() => service.captureMechanical({ source: 'EXTERNAL_NOTE', payload: 'x' }, USER as never), 'IN_ACTOR_FORBIDDEN', /mechanical actor/)
    h.close()
  })

  it('WP-6.3 InboxEntryDraft 结构兼容直钉（草稿 → captureMechanical 1:1 落库）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    // WP-6.3 草稿形状（InboxEntryDraft 子集 — 本仓 audit/reconcile 层构造,
    // 此处以同形字面量钉结构兼容: source/payload/raw/contextRefs/createdAt;
    // raw = 结构化 Discrepancy — 任意 JSON 面, 零类型依赖平行 WP）。
    const discrepancy = {
      id: 'D-1',
      category: 'UNREGISTERED_WORKSPACE_CHANGE',
      subkind: 'new',
      path: 'results/fig1.png',
      tierReason: 'UNREGISTERED',
    }
    const draft = {
      source: 'UNREGISTERED_WORKSPACE_CHANGE' as const,
      payload: 'finding=UNREGISTERED_WORKSPACE_CHANGE/new path=results/fig1.png tier=PROPOSE reason=UNREGISTERED',
      raw: discrepancy,
      contextRefs: [{ kind: 'ARTIFACT' as const, id: 'A-1' }, { kind: 'WORKSTREAM' as const, id: 'WS-1' }],
      state: 'CAPTURED' as const,
      createdAt: T0 + 7,
    }
    const { item } = service.captureMechanical(
      { source: draft.source, payload: draft.payload, raw: draft.raw, contextRefs: draft.contextRefs },
      { kind: 'PLUGIN' },
    )
    expect(item.source).toBe('UNREGISTERED_WORKSPACE_CHANGE')
    expect(item.payload).toBe(draft.payload)
    expect(item.raw).toEqual(discrepancy)
    expect(item.context_refs).toEqual(draft.contextRefs)
    expect(item.state).toBe('CAPTURED')
    // createdAt 归 service 时钟（draft.createdAt 是注入 now 的确定性面 —
    // 落库行以 service 单次采样为准, 接缝不双时钟）。
    expect(item.created_at).toBeGreaterThan(T0)
    h.close()
  })
})

describe('dismiss（§13 CAPTURED → DISMISSED — 仅用户）', () => {
  it('happy path: 状态迁移 + converted_to 不写', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'x' }, USER)
    const result = service.dismiss('IN-1', USER)
    expect(result).toEqual({ inboxItemId: 'IN-1', stateFrom: 'CAPTURED', stateTo: 'DISMISSED' })
    const got = h.store.getItem('IN-1')
    expect(got?.state).toBe('DISMISSED')
    expect(got?.converted_to).toBeUndefined()
    h.close()
  })

  it('终态无出口（CONVERTED/DISMISSED ⇒ IN_ILLEGAL_TRANSITION — 重开 = 新条目）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'x' }, USER)
    service.dismiss('IN-1', USER)
    throwsInbox(() => service.dismiss('IN-1', USER), 'IN_ILLEGAL_TRANSITION', /DISMISSED -> DISMISSED|self-loop/)
    h.close()
  })

  it('不存在 ⇒ IN_NOT_FOUND; 非 USER actor ⇒ IN_ACTOR_FORBIDDEN（零写入）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    throwsInbox(() => service.dismiss('IN-404', USER), 'IN_NOT_FOUND', /does not exist/)
    service.captureHuman({ payload: 'x' }, USER)
    throwsInbox(() => service.dismiss('IN-1', AGENT as never), 'IN_ACTOR_FORBIDDEN', /USER actor/)
    expect(h.store.getItem('IN-1')?.state).toBe('CAPTURED')
    h.close()
  })

  it('乐观并发门（迁移期间状态已变 ⇒ IN_CONCURRENT_STATE 大声）', () => {
    const h = makeInboxHarness()
    h.makeService().captureHuman({ payload: 'x' }, USER)
    // 真交错: 条目加载为 CAPTURED 后、条件 UPDATE 前, 状态被并发对手迁移
    // （delegating store 面 — updateState 调用内翻转, service 不感知）。
    const realStore = h.store
    const trickStore = {
      insertItem: realStore.insertItem.bind(realStore),
      getItem: realStore.getItem.bind(realStore),
      listItems: realStore.listItems.bind(realStore),
      updateState: (id: string, state: string, convertedTo: unknown, expected: string): number => {
        h.raw.prepare('UPDATE inbox_item SET state = ? WHERE id = ?').run('DISMISSED', id)
        return realStore.updateState(id, state as never, convertedTo as never, expected as never)
      },
      close: realStore.close.bind(realStore),
    }
    const service2 = h.makeService({ store: trickStore as never })
    throwsInbox(() => service2.dismiss('IN-1', USER), 'IN_CONCURRENT_STATE', /moved concurrently/)
    h.close()
  })
})

describe('convert（§28 转换流 — 显式确认 + 7 kind 动作集）', () => {
  it('happy path（INTERVENTION kind）: 正式对象 + 条目 CONVERTED + converted_to + MA 账本行', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureMechanical({ source: 'UNCLASSIFIED_AUDIT_FINDING', payload: 'audit finding' }, PLUGIN)
    const result = service.convert(
      { inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 'Review audit finding' } },
      USER,
    )
    expect(result.convertedTo).toEqual({ kind: 'INTERVENTION', id: 'INTERVENTION-1' })
    expect(result.item.state).toBe('CONVERTED')
    expect(result.item.converted_to).toEqual({ kind: 'INTERVENTION', id: 'INTERVENTION-1' })
    expect(result.managementActionId).toBe('MA-1')
    // 执行器收到配对字段 + 条目快照（occurredAt = service 时钟单次采样）。
    expect(h.stubs.executor.calls).toHaveLength(1)
    expect(h.stubs.executor.calls[0].kind).toBe('INTERVENTION')
    expect(h.stubs.executor.calls[0].fields).toEqual({ kind: 'INTERVENTION', title: 'Review audit finding' })
    expect(h.stubs.executor.calls[0].item.id).toBe('IN-1')
    // 账本行: 冻结 15 值 action_kind 的 INBOX_CONVERTED 成员 + 双 subject + USER actor。
    expect(h.stubs.ledger.rows).toHaveLength(1)
    expect(h.stubs.ledger.rows[0]).toMatchObject({
      id: 'MA-1',
      action_kind: 'INBOX_CONVERTED',
      actor: { kind: 'USER', user_id: 'u1' },
      subject_refs: [
        { kind: 'INBOX_ITEM', id: 'IN-1' },
        { kind: 'INTERVENTION', id: 'INTERVENTION-1' },
      ],
    })
    expect(h.stubs.ledger.rows[0].detail).toContain('IN-1')
    expect(h.stubs.ledger.rows[0].detail).toContain('INTERVENTION-1')
    // 双号 commit（IN + MA 族 — 真实 allocator 计数器面）。
    expect(h.meta.getCounter(counterKey('INBOX_ITEM', 'PRJ-1'))).toBe(1)
    expect(h.meta.getCounter(counterKey('MANAGEMENT_ACTION', 'PRJ-1'))).toBe(1)
    h.close()
  })

  it('7 kind 全分派（§28 转换动作集 — 执行器按 kind 收到配对字段）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'x' }, USER)
    const fields: Record<string, unknown> = {
      TASK: { kind: 'TASK', workstreamId: 'WS-1', title: 't' },
      NEXT_ACTION: { kind: 'NEXT_ACTION', statement: 's' },
      INTERVENTION: { kind: 'INTERVENTION', title: 't' },
      CLAIM: { kind: 'CLAIM', workstreamId: 'WS-1', statement: 'c' },
      FACT: { kind: 'FACT', workstreamId: 'WS-1', statement: 'f' },
      REPORTING_ITEM: { kind: 'REPORTING_ITEM', audience: 'supervisor', statement: 'r' },
      INTERACTION: { kind: 'INTERACTION', interactionKind: 'MEETING', occurredAt: T0, title: 'm' },
    }
    const kinds = ['TASK', 'NEXT_ACTION', 'INTERVENTION', 'CLAIM', 'FACT', 'REPORTING_ITEM', 'INTERACTION'] as const
    for (const kind of kinds) {
      const { item } = service.captureHuman({ payload: `c-${kind}` }, USER)
      const res = service.convert(
        { inboxItemId: item.id, targetKind: kind, fields: fields[kind] as never },
        USER,
      )
      expect(res.convertedTo.kind).toBe(kind)
    }
    expect(h.stubs.executor.calls.map((c) => c.kind)).toEqual([...kinds])
    h.close()
  })

  it('执行器未接线 ⇒ IN_TARGET_NOT_WIRED（指名 kind — V1 诚实边界）', () => {
    const h = makeInboxHarness()
    const service = h.makeService({ conversionTargets: undefined })
    service.captureHuman({ payload: 'x' }, USER)
    throwsInbox(
      () => service.convert({ inboxItemId: 'IN-1', targetKind: 'CLAIM', fields: { kind: 'CLAIM', workstreamId: 'WS-1', statement: 's' } }, USER),
      'IN_TARGET_NOT_WIRED',
      /CLAIM/,
    )
    expect(h.store.getItem('IN-1')?.state).toBe('CAPTURED')
    h.close()
  })

  it('执行器失败 ⇒ IN_CONVERT_TARGET（条目保持 CAPTURED — 零状态写）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'x' }, USER)
    const boom = new Error('target service exploded')
    const failing = { execute: (): never => { throw boom } }
    const service2 = h.makeService({ conversionTargets: failing as never })
    const err = throwsInbox(
      () => service2.convert({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }, USER),
      'IN_CONVERT_TARGET',
      /target service exploded/,
    )
    expect(err.cause).toBe(boom)
    expect(h.store.getItem('IN-1')?.state).toBe('CAPTURED')
    expect(h.stubs.ledger.rows).toHaveLength(0)
    h.close()
  })

  it('执行器返回畸形 ref（kind 不配对 / 空 id）⇒ IN_CONVERT_TARGET（内部契约大声）', () => {
    const h = makeInboxHarness()
    for (const badRef of [
      { kind: 'CLAIM', id: 'CLAIM-1' }, // kind 不配对
      { kind: 'INTERVENTION', id: '' }, // 空 id
    ]) {
      const service = h.makeService()
      service.captureHuman({ payload: 'x' }, USER)
      const badExecutor = { execute: () => badRef }
      const s2 = h.makeService({ conversionTargets: badExecutor as never })
      throwsInbox(
        () => s2.convert({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }, USER),
        'IN_CONVERT_TARGET',
        /malformed ref/,
      )
    }
    h.close()
  })

  it('fields.kind 与 targetKind 不配对 ⇒ IN_INPUT（类型面配对的运行面兜底）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'x' }, USER)
    throwsInbox(
      () =>
        service.convert(
          { inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'CLAIM', workstreamId: 'WS-1', statement: 's' } },
          USER,
        ),
      'IN_INPUT',
      /fields\.kind must pair/,
    )
    h.close()
  })

  it('targetKind 不在 §28 闭集（字符串面伪造）⇒ IN_INPUT', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'x' }, USER)
    throwsInbox(
      () => service.convert({ inboxItemId: 'IN-1', targetKind: 'ARTIFACT' as never, fields: { kind: 'ARTIFACT' } as never }, USER),
      'IN_INPUT',
      /conversion action set/,
    )
    h.close()
  })

  it('终态条目不可再转（CONVERTED ⇒ IN_ILLEGAL_TRANSITION — 重转 = 新条目）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'x' }, USER)
    service.convert({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }, USER)
    throwsInbox(
      () => service.convert({ inboxItemId: 'IN-1', targetKind: 'FACT', fields: { kind: 'FACT', workstreamId: 'WS-1', statement: 'f' } }, USER),
      'IN_ILLEGAL_TRANSITION',
      /CONVERTED -> CONVERTED|self-loop/,
    )
    h.close()
  })

  it('并发迁移 ⇒ IN_CONCURRENT_STATE（消息含已创建对象 — 手动 reconciliation 指引）', () => {
    const h = makeInboxHarness()
    h.makeService().captureHuman({ payload: 'x' }, USER)
    // 真交错: 条目加载为 CAPTURED 后、条件 UPDATE 前（执行器调用内）,
    // 状态被并发对手迁移 — 正式对象已建, 条目迁移失败。
    const flippingExecutor = {
      execute: () => {
        h.raw.prepare('UPDATE inbox_item SET state = ? WHERE id = ?').run('DISMISSED', 'IN-1')
        return { kind: 'INTERVENTION', id: 'INTERVENTION-1' }
      },
    }
    const service2 = h.makeService({ conversionTargets: flippingExecutor as never })
    const err = throwsInbox(
      () => service2.convert({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }, USER),
      'IN_CONCURRENT_STATE',
      /INTERVENTION-1/,
    )
    expect(err.message).toContain('WAS created')
    h.close()
  })

  it('账本行失败 ⇒ IN_LEDGER（转换已提交 — 残差大声指明）', () => {
    const h = makeInboxHarness()
    const ledger = makeBoomLedger()
    const service = h.makeService({ managementActionRecorder: ledger.recorder })
    service.captureHuman({ payload: 'x' }, USER)
    throwsInbox(
      () => service.convert({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }, USER),
      'IN_LEDGER',
      /ledger row failed/,
    )
    // 正式对象已建 + 条目已 CONVERTED（残差 — 消息指引手动 reconciliation）。
    expect(h.store.getItem('IN-1')?.state).toBe('CONVERTED')
    expect(h.stubs.executor.calls).toHaveLength(1)
    // MA 号 release（gap 合法 — 计数器不回头）。
    expect(h.meta.getCounter(counterKey('MANAGEMENT_ACTION', 'PRJ-1'))).toBe(1)
    h.close()
  })

  it('账本端口缺省 ⇒ managementActionId = null（不虚构 provenance）', () => {
    const h = makeInboxHarness()
    const service = h.makeService({ managementActionRecorder: undefined })
    service.captureHuman({ payload: 'x' }, USER)
    const result = service.convert({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }, USER)
    expect(result.managementActionId).toBeNull()
    expect(h.store.getItem('IN-1')?.state).toBe('CONVERTED')
    h.close()
  })

  it('非 USER actor ⇒ IN_ACTOR_FORBIDDEN（显式确认运行面 — 零写入）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureMechanical({ source: 'AGENT_UNSTRUCTURED_REPORT', payload: 'x' }, AGENT)
    throwsInbox(
      () => service.convert({ inboxItemId: 'IN-1', targetKind: 'NEXT_ACTION', fields: { kind: 'NEXT_ACTION', statement: 's' } }, AGENT as never),
      'IN_ACTOR_FORBIDDEN',
      /USER actor/,
    )
    expect(h.store.getItem('IN-1')?.state).toBe('CAPTURED')
    h.close()
  })
})

describe('escalateMechanical（§22.3 ESCALATE 档 — 机械判定 → Intervention 联动）', () => {
  const evidence = (overrides: Record<string, unknown> = {}) => ({
    summary: 'audit discrepancy: 2 paths',
    ...overrides,
  })

  it('非高影响（零机械信号）⇒ 条目捕获 + 零联动 + raw 升级标记 highImpact=false', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const result = service.escalateMechanical({ evidence: evidence() }, PLUGIN)
    expect(result.assessment).toEqual({ highImpact: false, reasons: [] })
    expect(result.intervention).toBeNull()
    expect(result.item.state).toBe('CAPTURED')
    expect(result.item.source).toBe('UNCLASSIFIED_AUDIT_FINDING') // 缺省 source
    expect((result.item.raw as { escalation: { highImpact: boolean; reasons: string[] } }).escalation).toEqual({
      highImpact: false,
      reasons: [],
    })
    expect(h.stubs.intervention.calls).toHaveLength(0)
    h.close()
  })

  it('关键路径（strict-tracked 第一层触及）⇒ 高影响 + Intervention 联动', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const result = service.escalateMechanical(
      { evidence: evidence({ strictTrackedPaths: ['src/core/train.py'], workstreamIds: ['WS-1'] }) },
      PLUGIN,
    )
    expect(result.assessment).toEqual({ highImpact: true, reasons: ['STRICT_TRACKED_CHANGE'] })
    expect(result.intervention).toEqual({ id: 'IV-1', title: 'High-impact research discrepancy [WS-1]' })
    // 联动参数逐位（source_refs 打头 INBOX_ITEM ref + 证据 contextRefs 跟随）。
    expect(h.stubs.intervention.calls).toHaveLength(1)
    expect(h.stubs.intervention.calls[0].title).toBe('High-impact research discrepancy [WS-1]')
    expect(h.stubs.intervention.calls[0].workstreamIds).toEqual(['WS-1'])
    expect(h.stubs.intervention.calls[0].sourceRefs).toEqual([{ kind: 'INBOX_ITEM', id: result.item.id }])
    expect(h.stubs.intervention.calls[0].detail).toContain('STRICT_TRACKED_CHANGE')
    expect(h.stubs.intervention.calls[0].detail).toContain('src/core/train.py')
    h.close()
  })

  it('损失（删除路径）⇒ 高影响（DELETION 规则）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const result = service.escalateMechanical({ evidence: evidence({ deletedPaths: ['results/final.csv'] }) }, PLUGIN)
    expect(result.assessment.reasons).toEqual(['DELETION'])
    expect(result.intervention?.id).toBe('IV-1')
    // 无 WS 关联 = 标题无 [WS-<n>] 后缀（机械派生）。
    expect(result.intervention?.title).toBe('High-impact research discrepancy')
    h.close()
  })

  it('批量影响（affectedPathCount ≥ threshold — 默认 5; 边界 4/5）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const below = service.escalateMechanical({ evidence: evidence({ affectedPathCount: 4 }) }, PLUGIN)
    expect(below.assessment.highImpact).toBe(false)
    const at = service.escalateMechanical({ evidence: evidence({ affectedPathCount: 5 }) }, PLUGIN)
    expect(at.assessment.highImpact).toBe(true)
    expect(at.assessment.reasons).toEqual(['BATCH_IMPACT'])
    expect(at.intervention?.id).toBe('IV-1')
    h.close()
  })

  it('threshold 注入面（service 构造选项 — 自定义批量阈值）', () => {
    const h = makeInboxHarness()
    const service = h.makeService({ escalation: { batchThreshold: 2 } })
    const result = service.escalateMechanical({ evidence: evidence({ affectedPathCount: 2 }) }, PLUGIN)
    expect(result.assessment.highImpact).toBe(true)
    expect(result.assessment.reasons).toEqual(['BATCH_IMPACT'])
    h.close()
  })

  it('多规则 OR + 理由冻结序（STRICT_TRACKED_CHANGE, DELETION, BATCH_IMPACT — 不短路, 证据面完整）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const result = service.escalateMechanical(
      { evidence: evidence({ strictTrackedPaths: ['a'], deletedPaths: ['b'], affectedPathCount: 9 }) },
      PLUGIN,
    )
    expect(result.assessment.reasons).toEqual(['STRICT_TRACKED_CHANGE', 'DELETION', 'BATCH_IMPACT'])
    h.close()
  })

  it('highImpact 但联动端口缺位 ⇒ IN_INPUT（**写前**大声 — 零部分状态）', () => {
    const h = makeInboxHarness()
    const service = h.makeService({ mechanicalInterventionCreator: undefined })
    throwsInbox(
      () => service.escalateMechanical({ evidence: evidence({ deletedPaths: ['a'] }) }, PLUGIN),
      'IN_INPUT',
      /mechanicalInterventionCreator/,
    )
    // 零写入: 条目未捕获, 联动未建。
    expect(h.store.listItems().length).toBe(0)
    expect(h.stubs.intervention.calls).toHaveLength(0)
    h.close()
  })

  it('联动创建失败 ⇒ IN_ESCALATION（条目已捕获保留 — 大声指明已捕获 id）', () => {
    const h = makeInboxHarness()
    const { creator, calls } = makeBoomIntervention()
    const service = h.makeService({ mechanicalInterventionCreator: creator })
    service.captureHuman({ payload: 'seed' }, USER) // IN-1 预占（断言已捕获 id = IN-2）
    throwsInbox(
      () => service.escalateMechanical({ evidence: evidence({ deletedPaths: ['a'] }) }, PLUGIN),
      'IN_ESCALATION',
      /IN-2/,
    )
    expect(h.store.getItem('IN-2')?.state).toBe('CAPTURED')
    expect(calls).toHaveLength(1)
    h.close()
  })

  it('source 显式指名（discovery 批量发现场景 — UNREGISTERED_WORKSPACE_CHANGE）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    const result = service.escalateMechanical(
      { source: 'UNREGISTERED_WORKSPACE_CHANGE', evidence: evidence({ affectedPathCount: 8 }) },
      { kind: 'PLUGIN' },
    )
    expect(result.item.source).toBe('UNREGISTERED_WORKSPACE_CHANGE')
    expect(result.assessment.highImpact).toBe(true)
    h.close()
  })

  it('非 USER 机械 actor 两面（PLUGIN 放行 / USER 拒绝 — 零写入）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    expect(() => service.escalateMechanical({ evidence: evidence() }, AGENT)).not.toThrow()
    throwsInbox(
      () => service.escalateMechanical({ evidence: evidence({ deletedPaths: ['a'] }) }, USER as never),
      'IN_ACTOR_FORBIDDEN',
      /mechanical actor/,
    )
    h.close()
  })

  it('证据预校验（summary 空 ⇒ IN_INPUT 零写入）', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    throwsInbox(() => service.escalateMechanical({ evidence: evidence({ summary: '' }) }, PLUGIN), 'IN_INPUT', /summary/)
    expect(h.store.listItems().length).toBe(0)
    h.close()
  })
})

describe('查询面（无隐藏过滤器）', () => {
  it('listCaptured = CAPTURED 全量; listItems 过滤; getItem null 缺席', () => {
    const h = makeInboxHarness()
    const service = h.makeService()
    service.captureHuman({ payload: 'a' }, USER)
    service.captureMechanical({ source: 'DISCOVERED_SESSION', payload: 'b' }, PLUGIN)
    service.dismiss('IN-1', USER)
    service.convert({ inboxItemId: 'IN-2', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }, USER)
    expect(service.listCaptured().length).toBe(0)
    expect(service.listItems({ state: 'DISMISSED' }).map((r) => r.id)).toEqual(['IN-1'])
    expect(service.listItems({ state: 'CONVERTED' }).map((r) => r.id)).toEqual(['IN-2'])
    expect(service.listItems().length).toBe(2)
    expect(service.getItem('IN-9')).toBeNull()
    h.close()
  })
})

/* ------------------------------------------------------------------ *
 * 本地 boom stubs
 * ------------------------------------------------------------------ */

function makeBoomLedger(): { readonly recorder: (record: unknown) => never; readonly rows: unknown[] } {
  const rows: unknown[] = []
  return {
    rows,
    recorder: (record: unknown) => {
      rows.push(record)
      throw new Error('ledger connection lost')
    },
  }
}

function makeBoomIntervention(): {
  readonly creator: (params: { title: string }) => never
  readonly calls: { title: string }[]
} {
  const calls: { title: string }[] = []
  return {
    calls,
    creator: (params: { title: string }) => {
      calls.push({ title: params.title })
      throw new Error('intervention registry down')
    },
  }
}
