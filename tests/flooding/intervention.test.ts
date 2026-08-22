/**
 * WP-3.5 — AUTO_FLOODING Intervention 内容逐字段 + 冻结形状往返 +
 * INTERVENTION_CREATED 事件逐字段（真实冻结 attention schema + 真实
 * WP-2.2 registry 校验闭环）。
 */

import { describe, expect, it } from 'vitest'

import {
  AUTO_FLOODING_PLUGIN_ACTOR,
  INTERVENTION_EVENT_SCHEMA_VERSION,
  autoFloodingInterventionTitle,
  buildAutoFloodingDetail,
  buildAutoFloodingIntervention,
  buildInterventionCreatedEvent,
  FloodingError,
  isFloodingError,
  loadInterventionSchemas,
  type FloodingEvidence,
} from '../../src/host/service/flooding/index.js'
import { validateEvent, type HistoryObjectContext, type InterventionSnapshot } from '../../src/host/history/registry/index.js'
import type { HistoryEventRecord } from '../../src/host/persistence/store/index.js'
import { loadHistoryEventRegistry } from '../../src/host/history/registry/index.js'
import { T_CREATE } from '../planfork/fixtures.js'
import { MEM_OPERATIONAL_SCHEMA_DIR, realOperationalSchemaFiles } from '../planfork/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'
import { FsReader, WR_HISTORY_SCHEMA_DIR, throwsFlooding } from './fixtures.js'

const T = T_CREATE + 9000

/** 确定性证据: WS-1, 6 OPEN（threshold 5）, 窗口 6 个 PF. */
const EVIDENCE: FloodingEvidence = {
  workstream_id: 'WS-1',
  window: { kind: 'OPEN_STATE', as_of: T, open_pf_ids: ['PF-11', 'PF-12', 'PF-13', 'PF-14', 'PF-15', 'PF-16'] },
  count: 6,
  threshold: 5,
  rule: 'count(status == OPEN, per workstream) > threshold',
}

function build(id = 'IV-5', evidence: FloodingEvidence = EVIDENCE) {
  return buildAutoFloodingIntervention({ id, evidence, createdAt: T })
}

/* ------------------------------------------------------------------ *
 * 记录逐字段（§8 原文 + §9.2 冻结形状）
 * ------------------------------------------------------------------ */

describe('buildAutoFloodingIntervention — 逐字段（§8 原文）', () => {
  it('title 逐字 = `Review accumulated agent plan forks [WS-<n>]`（WS id 嵌入）', () => {
    expect(autoFloodingInterventionTitle('WS-1')).toBe('Review accumulated agent plan forks [WS-1]')
    expect(build().title).toBe('Review accumulated agent plan forks [WS-1]')
    expect(build('IV-9', { ...EVIDENCE, workstream_id: 'WS-2', window: { ...EVIDENCE.window, open_pf_ids: ['PF-1'] }, count: 6 }).title)
      .toBe('Review accumulated agent plan forks [WS-2]')
  })

  it('origin=AUTO_FLOODING / status=OPEN / created_by=PLUGIN（§8 动作 actor=PLUGIN）', () => {
    const r = build()
    expect(r.origin).toBe('AUTO_FLOODING')
    expect(r.status).toBe('OPEN')
    expect(r.created_by).toEqual(AUTO_FLOODING_PLUGIN_ACTOR)
    expect(r.created_by.kind).toBe('PLUGIN')
    expect(r.created_by).not.toHaveProperty('run_id')
    expect(r.created_by).not.toHaveProperty('session_id')
  })

  it('workstream_ids=[被检 WS]（事件 owner = 第一个）', () => {
    expect(build().workstream_ids).toEqual(['WS-1'])
  })

  it('source_refs = [相关 PF]（窗口顺序, PLAN_FORK ref, §8 原文）', () => {
    expect(build().source_refs).toEqual([
      { kind: 'PLAN_FORK', id: 'PF-11' },
      { kind: 'PLAN_FORK', id: 'PF-12' },
      { kind: 'PLAN_FORK', id: 'PF-13' },
      { kind: 'PLAN_FORK', id: 'PF-14' },
      { kind: 'PLAN_FORK', id: 'PF-15' },
      { kind: 'PLAN_FORK', id: 'PF-16' },
    ])
  })

  it('detail = 机械证据摘要（窗口/计数/阈值/open PF 全在, 确定性格式）', () => {
    const expected =
      `auto flooding (PLAN_FORK_SPEC §8): WS-1 ` +
      `count(OPEN)=6 > threshold=5; ` +
      `window=OPEN_STATE as_of=${T}; ` +
      `open_pf=[PF-11, PF-12, PF-13, PF-14, PF-15, PF-16]`
    expect(buildAutoFloodingDetail(EVIDENCE)).toBe(expected)
    expect(build().detail).toBe(expected)
    // 确定性: 两次构建逐字节一致。
    expect(JSON.stringify(build('IV-7'))).toBe(JSON.stringify(build('IV-7')))
  })

  it('id / created_at 透传; closed_at / resolution_note 缺席（OPEN 初始态）', () => {
    const r = build('IV-12')
    expect(r.id).toBe('IV-12')
    expect(r.created_at).toBe(T)
    expect(r).not.toHaveProperty('closed_at')
    expect(r).not.toHaveProperty('resolution_note')
  })

  it('构建面不接受 origin / 调用者身份参数（INV-ATTN-5 类型面 — 只产 AUTO_FLOODING）', () => {
    // 编译期断言见 inv-attn-5.test.ts; 运行面: 任意两次不同证据构建 origin 恒为 AUTO_FLOODING。
    expect(build('IV-1', EVIDENCE).origin).toBe('AUTO_FLOODING')
    expect(build('IV-2', { ...EVIDENCE, workstream_id: 'WS-2', window: { ...EVIDENCE.window, open_pf_ids: ['PF-1'] }, count: 6 }).origin).toBe(
      'AUTO_FLOODING',
    )
  })

  it('输入守卫: 坏 IV id / 负 created_at / 空窗口', () => {
    throwsFlooding(() => buildAutoFloodingIntervention({ id: 'IV-0', evidence: EVIDENCE, createdAt: T }), 'FLOODING_INPUT', /IV id/)
    throwsFlooding(() => buildAutoFloodingIntervention({ id: 'IV-5', evidence: EVIDENCE, createdAt: -1 }), 'FLOODING_INPUT', /createdAt/)
    throwsFlooding(
      () => buildAutoFloodingIntervention({ id: 'IV-5', evidence: { ...EVIDENCE, window: { ...EVIDENCE.window, open_pf_ids: [] } }, createdAt: T }),
      'FLOODING_INPUT',
      /window/,
    )
  })
})

/* ------------------------------------------------------------------ *
 * 真实冻结 attention.schema.json 往返（模型同构 + 负例）
 * ------------------------------------------------------------------ */

describe('冻结 attention schema 往返（$defs/Intervention, additionalProperties:false）', () => {
  const schemas = loadInterventionSchemas(new MemoryReader(realOperationalSchemaFiles()), MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) throw new Error('schemas unavailable in test setup')

  it('构建出的记录过真实冻结 $defs/Intervention', () => {
    const check = schemas.checkInterventionShape(build())
    expect(check.ok).toBe(true)
    expect(check.errors).toEqual([])
  })

  it('负例: 额外键（additionalProperties:false 网）', () => {
    const check = schemas.checkInterventionShape({ ...build(), bogus: 1 })
    expect(check.ok).toBe(false)
    expect(check.errors.some((e) => /bogus|additionalProperties|not allowed/i.test(e.message))).toBe(true)
  })

  it('负例: 缺必填 / 坏枚举 / 坏 id 模式 / 坏 epoch', () => {
    expect(schemas.checkInterventionShape({ ...build(), id: undefined }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), title: '' }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), origin: 'AUTO_BOOM' }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), status: 'RESOLVED' }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), id: 'IV-0' }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), created_at: T + 0.5 }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), created_at: -1 }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), workstream_ids: ['ws-1'] }).ok).toBe(false)
    // 注意: {kind:'AGENT'} 是合法冻结 actorRef（形状面不限制语义）— 用坏 kind 做负例。
    expect(schemas.checkInterventionShape({ ...build(), created_by: { kind: 'BOGUS' } }).ok).toBe(false)
    expect(schemas.checkInterventionShape({ ...build(), source_refs: [{ kind: 'PLAN_FORK' }] }).ok).toBe(false)
  })

  it('四 origin 枚举全收（冻结 4 值 — 其他 origin 的构建归各自面）', () => {
    for (const origin of ['USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT']) {
      expect(schemas.checkInterventionShape({ ...build(), origin }).ok).toBe(true)
    }
  })

  it('不可用面: 坏 schema 目录 ⇒ isUsable=false, 检查大声报告', () => {
    const empty = loadInterventionSchemas(new MemoryReader({}), '/nowhere')
    expect(empty.isUsable).toBe(false)
    expect(empty.loadErrors.length).toBeGreaterThan(0)
    expect(empty.checkInterventionShape(build()).ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * INTERVENTION_CREATED 事件逐字段（CATALOG §5.7 + 真实 registry 闭环）
 * ------------------------------------------------------------------ */

function makeRegistry() {
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
  if (!registry.isUsable) throw new Error('registry unusable in test setup')
  return registry
}

function makeCtx(newIvId: string, ws1 = true, extraIvs: string[] = []): HistoryObjectContext {
  const interventions = new Map<string, InterventionSnapshot>()
  for (const other of ['IV-1', 'IV-2', ...extraIvs]) {
    if (other !== newIvId) interventions.set(other, { workstreamIds: ['WS-1'] })
  }
  return {
    workstreams: ws1 ? new Map([['WS-1', { topicId: 'TPC-1', lifecycle: 'REALIZED' as const }]]) : new Map(),
    tasks: new Map(),
    runs: new Map(),
    claims: new Map(),
    facts: new Map(),
    artifacts: new Map(),
    relations: new Map(),
    gates: new Map(),
    milestones: new Map(),
    interventions,
    topologyEdges: new Map(),
  }
}

describe('buildInterventionCreatedEvent — 逐字段（CATALOG §5.7）', () => {
  it('信封 + payload 逐字段: owner=第一个关联 WS, actor=PLUGIN, schemaVersion=1', () => {
    const record = build()
    const ev = buildInterventionCreatedEvent({ eventId: 'H-7', record, occurredAt: T })
    expect(ev).toEqual({
      eventId: 'H-7',
      ownerWorkstreamId: 'WS-1',
      eventType: 'INTERVENTION_CREATED',
      schemaVersion: INTERVENTION_EVENT_SCHEMA_VERSION,
      occurredAt: T,
      actor: { kind: 'PLUGIN', label: 'research-control' },
      payload: {
        intervention_id: 'IV-5',
        title: 'Review accumulated agent plan forks [WS-1]',
        origin: 'AUTO_FLOODING',
        source_refs: [
          { kind: 'WORKSTREAM', id: 'WS-1' }, // V1 适配: owner 推导（与 workstream_ids[0] 一致）
          { kind: 'PLAN_FORK', id: 'PF-11' },
          { kind: 'PLAN_FORK', id: 'PF-12' },
          { kind: 'PLAN_FORK', id: 'PF-13' },
          { kind: 'PLAN_FORK', id: 'PF-14' },
          { kind: 'PLAN_FORK', id: 'PF-15' },
          { kind: 'PLAN_FORK', id: 'PF-16' },
        ],
      },
    })
    expect(INTERVENTION_EVENT_SCHEMA_VERSION).toBe(1)
  })

  it('真实 registry 校验通过（冻结分支形状 + 存在性 + owner 规则 + 发射者矩阵）', () => {
    const registry = makeRegistry()
    const ev = buildInterventionCreatedEvent({ eventId: 'H-7', record: build(), occurredAt: T })
    const rec: HistoryEventRecord = { ...ev, eventSeq: 1, recordedAt: T }
    const result = validateEvent(registry, rec, makeCtx('IV-5'))
    expect(result.ok).toBe(true)
  })

  it('负例: intervention_id 已存在（新建语义 — OBJECT_ALREADY_EXISTS）', () => {
    const registry = makeRegistry()
    const ev = buildInterventionCreatedEvent({ eventId: 'H-8', record: build(), occurredAt: T })
    // ctx 含 IV-5（已存在）⇒ 拒绝。
    const ctx = makeCtx('IV-9', true, ['IV-5'])
    const rec: HistoryEventRecord = { ...ev, eventSeq: 2, recordedAt: T }
    const result = validateEvent(registry, rec, ctx)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.errors.some((e) => e.code === 'OBJECT_ALREADY_EXISTS')).toBe(true)
  })

  it('负例: AUTO_FLOODING 事件 actor 非 PLUGIN（CROSS_FIELD — catalog §5.7）', () => {
    const registry = makeRegistry()
    const ev = buildInterventionCreatedEvent({ eventId: 'H-9', record: build(), occurredAt: T })
    const forged: HistoryEventRecord = { ...ev, actor: { kind: 'USER', user_id: 'u-1' }, eventSeq: 1, recordedAt: T }
    const result = validateEvent(registry, forged, makeCtx('IV-5'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.errors.some((e) => e.code === 'CROSS_FIELD' && /PLUGIN/.test(e.message))).toBe(true)
  })

  it('负例: WS 不在外部快照（owner 推导失败 — OWNER_MISMATCH / 存在性）', () => {
    const registry = makeRegistry()
    const ev = buildInterventionCreatedEvent({ eventId: 'H-10', record: build(), occurredAt: T })
    const rec: HistoryEventRecord = { ...ev, eventSeq: 1, recordedAt: T }
    const result = validateEvent(registry, rec, makeCtx('IV-5', false))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.errors.some((e) => e.code === 'OWNER_MISMATCH' || e.code === 'OBJECT_NOT_FOUND')).toBe(true)
  })

  it('输入守卫: 坏 H id / 负 occurredAt / 无 WS 关联记录不发事件', () => {
    const record = build()
    throwsFlooding(() => buildInterventionCreatedEvent({ eventId: 'H-0', record, occurredAt: T }), 'FLOODING_INPUT', /H id/)
    throwsFlooding(() => buildInterventionCreatedEvent({ eventId: 'H-7', record, occurredAt: -1 }), 'FLOODING_INPUT', /occurredAt/)
    const noWs = { ...record, workstream_ids: [] as readonly string[] }
    throwsFlooding(() => buildInterventionCreatedEvent({ eventId: 'H-7', record: noWs, occurredAt: T }), 'FLOODING_INPUT', /no associated workstream/)
  })
})

describe('FloodingError 分类面', () => {
  it('isFloodingError 守卫 + code 透传', () => {
    const err = new FloodingError({ code: 'FLOODING_INPUT', message: 'x' })
    expect(isFloodingError(err)).toBe(true)
    expect(err.code).toBe('FLOODING_INPUT')
    expect(err.name).toBe('FloodingError')
    expect(isFloodingError(new Error('x'))).toBe(false)
    expect(isFloodingError(null)).toBe(false)
  })
})
