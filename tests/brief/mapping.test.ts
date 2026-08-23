/**
 * WP-5.5 — 纯映射层测试（mapping.ts — 生产记录/wire DTO → 引擎入参 +
 * WP-5.4 注意力端口生产映射）。
 *
 * 覆盖（字段逐字 + 状态契约违规大声抛错 + WP-5.4 未决 3 映射口径）:
 *  - 生产记录 → Brief*: 字段逐字核对（含可选字段归一: target_date? →
 *    targetDate null, workstream_id? → workstreamId null, RECURRING →
 *    at null + recurring 标注）;
 *  - 状态契约违规（CLOSED IV / 非 PROPOSED NA / 非 ACTIVE BLK）⇒
 *    BriefMappingError（映射面不静默丢行 — 队列过滤是 buildBrief 职责）;
 *  - wire DTO 面: `briefInterventionsFromDashboard` 组内防御过滤
 *    （open 组只收 OPEN / pending 组只收 PENDING — WP-5.4 同口径,
 *    wire schema 不强制组内一致性）;
 *  - WP-5.4 未决 3 生产映射: NA/BLK/SEV record → 评分输入项
 *    （statement→title, affects[0]→workstreamId, ONCE at / RECURRING now）。
 */

import { describe, expect, it } from 'vitest'

import { DashboardSnapshotSchema, ProjectSnapshotSchema, type DashboardSnapshot } from '../../src/shared/rpc-contracts.js'
import {
  BriefMappingError,
  blockerRecordToAttentionItem,
  blockerToBrief,
  briefInterventionsFromDashboard,
  historyEventToBrief,
  interactionToBrief,
  interventionDtoToBrief,
  interventionRecordToAttentionItem,
  interventionToBrief,
  nextActionRecordToAttentionItem,
  nextActionToBrief,
  objectiveDocToBrief,
  objectiveDtoToBrief,
  reportingItemToBrief,
  scheduledEventRecordToAttentionItem,
  scheduledEventToBrief,
} from '../../src/host/service/brief/mapping.js'
import {
  makeBlockerRecord,
  makeHistoryEventRecord,
  makeInteractionRecord,
  makeInterventionRecord,
  makeNextActionRecord,
  makeObjectiveDoc,
  makeReportingItemRecord,
  makeScheduledEventRecord,
  T_NOW,
} from './fixtures.js'

const HOUR = 60 * 60 * 1000

describe('生产记录 → Brief 引擎入参（字段逐字）', () => {
  it('Intervention: 字段逐字（workstream_ids 拷贝）', () => {
    const record = makeInterventionRecord({ id: 'IV-9', workstream_ids: ['WS-3', 'WS-4'] })
    expect(interventionToBrief(record)).toEqual({
      id: 'IV-9',
      title: '审阅累积的 Agent PlanFork [WS-1]',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-3', 'WS-4'],
      createdAt: record.created_at,
    })
  })

  it('Intervention: CLOSED ⇒ BriefMappingError（队列面只收 OPEN/PENDING）', () => {
    expect(() => interventionToBrief(makeInterventionRecord({ status: 'CLOSED' }))).toThrowError(BriefMappingError)
  })

  it('NextAction: 字段逐字（workstream_id 缺省 → null）', () => {
    const record = makeNextActionRecord({ id: 'NA-7', workstream_id: undefined })
    expect(nextActionToBrief(record)).toEqual({
      id: 'NA-7',
      statement: '考虑把数据清洗脚本化',
      status: 'PROPOSED',
      workstreamId: null,
      createdAt: record.created_at,
    })
  })

  it('NextAction: PROMOTED/DISMISSED ⇒ 抛错（终态离队, §9.3）', () => {
    expect(() => nextActionToBrief(makeNextActionRecord({ status: 'PROMOTED', promoted_to_task_id: 'T-1' }))).toThrowError(BriefMappingError)
    expect(() => nextActionToBrief(makeNextActionRecord({ status: 'DISMISSED' }))).toThrowError(BriefMappingError)
  })

  it('Blocker: 字段逐字（affects 拷贝）; CLEARED ⇒ 抛错（§9.4）', () => {
    const record = makeBlockerRecord({ affects: [{ kind: 'TASK', id: 'T-2' }, { kind: 'RUN', id: 'R-1' }] })
    expect(blockerToBrief(record)).toEqual({
      id: 'BLK-1',
      statement: 'GPU 集群排队, 实验无法启动',
      status: 'ACTIVE',
      affects: [
        { kind: 'TASK', id: 'T-2' },
        { kind: 'RUN', id: 'R-1' },
      ],
      createdAt: record.created_at,
    })
    expect(() => blockerToBrief(makeBlockerRecord({ status: 'CLEARED', cleared_at: T_NOW }))).toThrowError(BriefMappingError)
  })

  it('ScheduledEvent: ONCE → at + recurring=false; RECURRING → at=null + recurring=true', () => {
    expect(scheduledEventToBrief(makeScheduledEventRecord())).toEqual({
      id: 'SEV-1',
      title: '组会汇报',
      at: T_NOW + 2 * HOUR,
      recurring: false,
    })
    expect(
      scheduledEventToBrief(
        makeScheduledEventRecord({ id: 'SEV-9', schedule: { kind: 'RECURRING', freq: 'WEEKLY', until: T_NOW + 30 * 24 * HOUR } }),
      ),
    ).toEqual({ id: 'SEV-9', title: '组会汇报', at: null, recurring: true })
  })

  it('ReportingItem / Interaction / ObjectiveDoc / HistoryEvent: 字段逐字', () => {
    expect(reportingItemToBrief(makeReportingItemRecord({ status: 'READY_TO_REPORT' }))).toEqual({
      id: 'RPT-1',
      audience: '导师',
      statement: '汇报本周实验进展',
      status: 'READY_TO_REPORT',
      createdAt: T_NOW - 24 * HOUR,
    })
    expect(interactionToBrief(makeInteractionRecord({ kind: 'SUPERVISOR_UPDATE' }))).toEqual({
      id: 'INT-1',
      kind: 'SUPERVISOR_UPDATE',
      title: '组会',
      occurredAt: T_NOW - 24 * HOUR,
    })
    expect(
      objectiveDocToBrief(makeObjectiveDoc({ id: 'OBJ-9', priority: 'P0', target_date: T_NOW + 10 * 24 * HOUR, scope: 'TOPIC', topic_id: 'TPC-1' })),
    ).toEqual({
      id: 'OBJ-9',
      scope: 'TOPIC',
      statement: '理解目标系统的失效模式',
      status: 'ACTIVE',
      priority: 'P0',
      targetDate: T_NOW + 10 * 24 * HOUR,
    })
    expect(objectiveDocToBrief(makeObjectiveDoc({ target_date: undefined }))).toMatchObject({ targetDate: null })
    expect(historyEventToBrief(makeHistoryEventRecord({ eventSeq: 42, eventId: 'H-42' }))).toEqual({
      eventId: 'H-42',
      eventSeq: 42,
      ownerWorkstreamId: 'WS-1',
      eventType: 'INTERVENTION_CREATED',
      occurredAt: T_NOW - 2 * HOUR,
    })
  })
})

/* -------------------------------------------------------------------- *
 * Wire DTO 面（client 侧数据面 — 冻结 wire 形状）
 * -------------------------------------------------------------------- */

describe('wire DTO → Brief', () => {
  it('InterventionDto: 字段逐字; CLOSED ⇒ 抛错', () => {
    expect(
      interventionDtoToBrief({
        id: 'IV-3',
        title: '用户登记的干预',
        origin: 'USER',
        status: 'OPEN',
        workstreamIds: ['WS-1'],
        createdAt: T_NOW,
      }),
    ).toEqual({
      id: 'IV-3',
      title: '用户登记的干预',
      origin: 'USER',
      status: 'OPEN',
      workstreamIds: ['WS-1'],
      createdAt: T_NOW,
    })
    expect(() =>
      interventionDtoToBrief({
        id: 'IV-4',
        title: '已关闭',
        origin: 'USER',
        status: 'CLOSED',
        workstreamIds: [],
        createdAt: T_NOW,
      }),
    ).toThrowError(BriefMappingError)
  })

  it('briefInterventionsFromDashboard: 组内防御过滤（open 组只收 OPEN, pending 组只收 PENDING, CLOSED 两组皆不收）', () => {
    const snapshot: DashboardSnapshot = {
      project: { id: 'PRJ-1', title: 'P', description: null, importance: 1, attentionMode: 'NORMAL', targetDate: null },
      topics: [],
      // 组内「错位」行（wire schema 不强制组内状态一致性 — 防御面）:
      openInterventions: [
        { id: 'IV-1', title: '真 OPEN', origin: 'USER', status: 'OPEN', workstreamIds: [], createdAt: T_NOW },
        { id: 'IV-2', title: '错位: 组内 PENDING', origin: 'USER', status: 'PENDING', workstreamIds: [], createdAt: T_NOW },
        { id: 'IV-3', title: '错位: 组内 CLOSED', origin: 'USER', status: 'CLOSED', workstreamIds: [], createdAt: T_NOW },
      ],
      pendingInterventions: [
        { id: 'IV-4', title: '真 PENDING', origin: 'USER', status: 'PENDING', workstreamIds: [], createdAt: T_NOW },
        { id: 'IV-5', title: '错位: 组内 OPEN', origin: 'USER', status: 'OPEN', workstreamIds: [], createdAt: T_NOW },
      ],
      scheduledEvents: null,
      reportingItems: null,
      inboxCount: null,
      attention: null,
    }
    // 该快照本身不合法（错位行不在组契约内）— 只验映射面过滤, 不经 schema 重解析。
    const out = briefInterventionsFromDashboard(snapshot)
    expect(out.map((v) => v.id)).toEqual(['IV-1', 'IV-4'])
  })

  it('ObjectiveDto: 字段逐字（targetDate null 透传）', () => {
    expect(
      objectiveDtoToBrief({ id: 'OBJ-5', scope: 'TOPIC', statement: '主题目标', status: 'ACHIEVED', priority: 'P2', targetDate: null }),
    ).toEqual({ id: 'OBJ-5', scope: 'TOPIC', statement: '主题目标', status: 'ACHIEVED', priority: 'P2', targetDate: null })
  })
})

/* -------------------------------------------------------------------- *
 * WP-5.4 未决 3 — 注意力端口的生产映射（record → 评分输入项）
 * -------------------------------------------------------------------- */

describe('WP-5.4 未决 3: record → 评分输入项（shape 不变）', () => {
  it('NextAction: statement→title; workstream_id→workstreamId; 非 PROPOSED 抛错', () => {
    expect(nextActionRecordToAttentionItem(makeNextActionRecord())).toEqual({
      kind: 'NEXT_ACTION',
      id: 'NA-1',
      title: '考虑把数据清洗脚本化',
      createdAt: T_NOW - HOUR,
      workstreamId: 'WS-1',
      status: 'PROPOSED',
    })
    expect(() => nextActionRecordToAttentionItem(makeNextActionRecord({ status: 'DISMISSED' }))).toThrowError(BriefMappingError)
  })

  it('Blocker: affects[0] 且 kind=WORKSTREAM → workstreamId; 否则 null（INV-ATTN-1 不因无 WS 隐藏）', () => {
    expect(blockerRecordToAttentionItem(makeBlockerRecord())).toMatchObject({
      kind: 'BLOCKER',
      id: 'BLK-1',
      title: 'GPU 集群排队, 实验无法启动',
      workstreamId: 'WS-2',
      status: 'ACTIVE',
    })
    expect(blockerRecordToAttentionItem(makeBlockerRecord({ affects: [{ kind: 'TASK', id: 'T-9' }] })).workstreamId).toBeNull()
    expect(blockerRecordToAttentionItem(makeBlockerRecord({ affects: [] })).workstreamId).toBeNull()
    expect(() => blockerRecordToAttentionItem(makeBlockerRecord({ status: 'CLEARED' }))).toThrowError(BriefMappingError)
  })

  it('ScheduledEvent: ONCE → at=时刻; RECURRING → at=now（注入, 确定性）; createdAt 与 at 同值', () => {
    const once = scheduledEventRecordToAttentionItem(makeScheduledEventRecord(), T_NOW)
    expect(once).toEqual({
      kind: 'SCHEDULED_EVENT',
      id: 'SEV-1',
      title: '组会汇报',
      createdAt: T_NOW + 2 * HOUR,
      workstreamId: null,
      at: T_NOW + 2 * HOUR,
    })
    const recurring = scheduledEventRecordToAttentionItem(
      makeScheduledEventRecord({ id: 'SEV-8', schedule: { kind: 'RECURRING', freq: 'DAILY' } }),
      T_NOW,
    )
    expect(recurring.at).toBe(T_NOW)
    expect(recurring.createdAt).toBe(T_NOW)
  })

  it('Intervention: 第一个关联 WS → workstreamId; 无关联 → null; CLOSED 抛错', () => {
    expect(interventionRecordToAttentionItem(makeInterventionRecord({ workstream_ids: ['WS-5', 'WS-6'] }))).toMatchObject({
      kind: 'INTERVENTION',
      id: 'IV-1',
      workstreamId: 'WS-5',
      status: 'OPEN',
      origin: 'AUTO_FLOODING',
    })
    expect(interventionRecordToAttentionItem(makeInterventionRecord({ workstream_ids: [] })).workstreamId).toBeNull()
    expect(() => interventionRecordToAttentionItem(makeInterventionRecord({ status: 'CLOSED' }))).toThrowError(BriefMappingError)
  })
})

/* -------------------------------------------------------------------- *
 * wire 契约钉（fixture 可被 strict schema 重解析 — 漂移 ⇒ 红）
 * -------------------------------------------------------------------- */

describe('wire 契约钉', () => {
  it('dashboard 测试快照可被 strict DashboardSnapshotSchema 重解析', () => {
    const snapshot = {
      project: { id: 'PRJ-1', title: 'P', description: null, importance: 1, attentionMode: 'NORMAL', targetDate: null },
      topics: [{ id: 'TPC-1', title: 'T', workstreamCount: 1 }],
      openInterventions: [{ id: 'IV-1', title: 't', origin: 'USER', status: 'OPEN', workstreamIds: ['WS-1'], createdAt: T_NOW }],
      pendingInterventions: [],
      scheduledEvents: null,
      reportingItems: null,
      inboxCount: null,
      attention: null,
    }
    expect(DashboardSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })

  it('project 测试快照可被 strict ProjectSnapshotSchema 重解析', () => {
    const snapshot = {
      project: {
        id: 'PRJ-1',
        title: 'P',
        description: null,
        importance: 1,
        attentionMode: 'NORMAL',
        targetDate: null,
        currentObjectiveRefs: ['OBJ-1'],
        createdAt: T_NOW,
      },
      objectives: [{ id: 'OBJ-1', scope: 'PROJECT', statement: 's', status: 'ACTIVE', priority: 'P1', targetDate: null }],
      topics: [],
      upcomingInteractions: null,
      upcomingReporting: null,
    }
    expect(ProjectSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })
})
