/**
 * WP-3.5 — 接线缝 + §8 动作端到端（真实 research.sqlite + 真实 registry
 * + 真实 WP-3.1 创建链 + 真实 policy 装载）。
 *
 * 覆盖（任务测试项）:
 *   - onPlanForkCreated 钩子: 5 次不触发, 第 6 次触发（默认阈值 5 — 严格
 *     大于）, 创建 OPEN AUTO_FLOODING Intervention + INTERVENTION_CREATED
 *     事件（owner=WS-1, actor=PLUGIN, payload 逐字段）;
 *   - 不阻止创建断言: 触发后第 7 个 PF 照常创建; 钩子失败路径（坏 registry /
 *     坏外部快照）不抛、不影响创建;
 *   - 重复抑制: 同 WS 已有 OPEN AUTO_FLOODING ⇒ 不重复建（含探针随用户
 *     关闭解除后重建 = 新 Intervention, §13「重开 = 新 Intervention」）;
 *   - 跨 WS 独立（A-15 per-WS 口径, 用户确认）: WS-1/WS-2 各自计数、各自
 *     触发、各自事件 owner;
 *   - policy 阈值（§9 flooding.threshold 读自 policy, 非默认; 文件缺失 =
 *     §8 默认 5）;
 *   - onPlanLoaded 触发点（§8 触发点 2 同核）;
 *   - §12.1 核查: 无 ManagementAction 新增（15 值枚举无 Intervention kind）;
 *   - id 纪律: 失败烧号留 gap（§1.1 单调）。
 */

import { afterAll, describe, expect, it } from 'vitest'

import type { PlanForkRecord } from '../../src/host/domain/planfork/index.js'
import { baseTreeFiles } from '../loader/fixtures.js'
import {
  FloodingService,
  loadInterventionSchemas,
  type FloodingCheckResult,
} from '../../src/host/service/flooding/index.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  realOperationalSchemaFiles,
} from '../planfork/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'
import { loadHistoryEventRegistry } from '../../src/host/history/registry/index.js'
import {
  FloodingHarness,
  FsReader,
  WR_HISTORY_SCHEMA_DIR,
  makeFloodingHarness,
  simulateUserClose,
} from './fixtures.js'
import { MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR } from '../planfork/fixtures.js'

const harnesses: FloodingHarness[] = []
function harness(options: Parameters<typeof makeFloodingHarness>[0] = {}): FloodingHarness {
  const h = makeFloodingHarness(options)
  harnesses.push(h)
  return h
}
afterAll(() => {
  for (const h of harnesses) h.close()
})

/** 模拟宿主接线: 每次 PF 创建后调钩子（§8 触发点 1）. */
function wireCreate(h: FloodingHarness, n: number, ws: 'WS-1' | 'WS-2' = 'WS-1') {
  const results: FloodingCheckResult[] = []
  const pfs: PlanForkRecord[] = []
  for (let i = 0; i < n; i++) {
    const pf = h.createPfs(1, ws)[0]!
    pfs.push(pf)
    results.push(h.service.onPlanForkCreated(pf))
  }
  return { results, pfs }
}

describe('onPlanForkCreated — §8 触发点 1 端到端（默认阈值 5）', () => {
  it('前 5 次不触发（5 == threshold 不严格大于）, 第 6 次触发并创建', () => {
    const h = harness()
    const { results, pfs } = wireCreate(h, 6)

    for (let i = 0; i < 5; i++) {
      const r = results[i]!
      expect(r.trigger).toBe('PLAN_FORK_CREATED')
      expect(r.blocked).toBe(false) // 不阻止创建 — 类型面 + 运行面
      expect(r.checked).toBe(true)
      expect(r.verdict!.triggered).toBe(false)
      expect(r.verdict!.reason).toBe('COUNT_AT_OR_BELOW_THRESHOLD')
      expect(r.verdict!.evidence.count).toBe(i + 1)
      expect(r.verdict!.evidence.threshold).toBe(5) // policy 装载（byte-exact §9 例）
      expect(r.intervention_id).toBeUndefined()
    }
    // 第 5 次的窗口证据已含 5 个 PF id（严格大于边界）。
    expect(results[4]!.verdict!.evidence.window.open_pf_ids).toHaveLength(5)

    const r6 = results[5]!
    expect(r6.blocked).toBe(false)
    expect(r6.checked).toBe(true)
    expect(r6.verdict!.triggered).toBe(true)
    expect(r6.verdict!.suppressed).toBe(false)
    expect(r6.verdict!.evidence).toMatchObject({
      workstream_id: 'WS-1',
      count: 6,
      threshold: 5,
      window: { kind: 'OPEN_STATE', open_pf_ids: pfs.map((pf) => pf.id) },
    })
    expect(r6.intervention_id).toBeDefined()
    expect(r6.event_id).toBeDefined()
  })

  it('Intervention 行逐字段（§8 原文 + §9.2）', () => {
    const h = harness()
    const { results, pfs } = wireCreate(h, 6)
    const r6 = results[5]!
    const iv = h.interventions.getIntervention(r6.intervention_id!)!
    expect(iv).toEqual({
      id: r6.intervention_id,
      title: 'Review accumulated agent plan forks [WS-1]',
      detail:
        `auto flooding (PLAN_FORK_SPEC §8): WS-1 count(OPEN)=6 > threshold=5; ` +
        `window=OPEN_STATE as_of=${r6.verdict!.evidence.window.as_of}; ` +
        `open_pf=[${pfs.map((pf) => pf.id).join(', ')}]`,
      origin: 'AUTO_FLOODING',
      workstream_ids: ['WS-1'],
      source_refs: pfs.map((pf) => ({ kind: 'PLAN_FORK', id: pf.id })),
      status: 'OPEN',
      created_by: { kind: 'PLUGIN', label: 'research-control' },
      created_at: r6.verdict!.evidence.window.as_of,
    })
  })

  it('INTERVENTION_CREATED 事件落库（owner=WS-1, actor=PLUGIN, payload 逐字段）', () => {
    const h = harness()
    const { results, pfs } = wireCreate(h, 6)
    const r6 = results[5]!
    const events = h.dbPair.store.listRange('WS-1', 1)
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.eventId).toBe(r6.event_id)
    expect(ev.eventType).toBe('INTERVENTION_CREATED')
    expect(ev.ownerWorkstreamId).toBe('WS-1') // 第一个关联 WS（§5.7）
    expect(ev.schemaVersion).toBe(1)
    expect(ev.actor).toEqual({ kind: 'PLUGIN', label: 'research-control' }) // AUTO_FLOODING ⇒ PLUGIN
    expect(ev.occurredAt).toBe(r6.verdict!.evidence.window.as_of)
    expect(ev.payload).toEqual({
      intervention_id: r6.intervention_id,
      title: 'Review accumulated agent plan forks [WS-1]',
      origin: 'AUTO_FLOODING',
      source_refs: [
        { kind: 'WORKSTREAM', id: 'WS-1' },
        ...pfs.map((pf) => ({ kind: 'PLAN_FORK', id: pf.id })),
      ],
    })
  })

  it('§12.1 核查: 无 ManagementAction 新增（15 值枚举无 Intervention kind）', () => {
    const h = harness()
    wireCreate(h, 6)
    const actions = h.planForks.listManagementActions()
    // 6 个 PF_CREATED（创建链自己记）— 钩子未落任何账本行。
    expect(actions).toHaveLength(6)
    for (const a of actions) {
      expect(a.action_kind).toBe('PF_CREATED')
    }
  })
})

describe('不阻止创建（§8 V1 — 双钉的运行面）', () => {
  it('触发后第 7 个 PF 照常创建; 钩子返回 suppressed（不重复建）', () => {
    const h = harness()
    const { results, pfs } = wireCreate(h, 6)
    const firstIv = results[5]!.intervention_id!

    // 第 7 个 PF: 创建流不受钩子结果影响。
    const pf7 = h.createPfs(1)[0]!
    expect(pf7.status).toBe('OPEN')
    const r7 = h.service.onPlanForkCreated(pf7)
    expect(r7.blocked).toBe(false)
    expect(r7.verdict!.triggered).toBe(true) // count 7 > 5
    expect(r7.verdict!.suppressed).toBe(true) // §8 规则后半句: 已有 OPEN AUTO_FLOODING
    expect(r7.verdict!.reason).toBe('OPEN_AUTO_FLOODING_EXISTS')
    expect(r7.verdict!.evidence.count).toBe(7)
    expect(r7.intervention_id).toBeUndefined() // 不重复建
    expect(h.interventions.listInterventions({ origin: 'AUTO_FLOODING', status: 'OPEN' })).toHaveLength(1)
    expect(h.interventions.findOpenAutoFlooding('WS-1')?.id).toBe(firstIv)

    // 继续创建第 8 个 — 仍然不阻止。
    const pf8 = h.createPfs(1)[0]!
    expect(h.service.onPlanForkCreated(pf8).blocked).toBe(false)
    expect(h.planForks.countOpen('WS-1')).toBe(8)
    void pfs
  })

  it('钩子内部失败不抛、不阻塞: 坏 registry（isUsable=false）', () => {
    const h = harness()
    wireCreate(h, 6)
    const firstIv = h.interventions.findOpenAutoFlooding('WS-1')!.id
    // 关闭既有 Intervention（模拟用户面）— 解除抑制, 令下一次检查真正走到
    // 事件 append 阶段（否则 §8 规则后半句会提前短路, 碰不到坏 registry）。
    simulateUserClose(h.rawPf, firstIv, h.now() + 1)

    // 换一个坏 registry 的 service（同 store/表 — 只验证钩子面行为）。
    const brokenRegistry = loadHistoryEventRegistry(new FsReader(), `${WR_HISTORY_SCHEMA_DIR}/does-not-exist`)
    const badService = new FloodingService({
      store: h.dbPair.store,
      registry: brokenRegistry,
      planForks: h.planForks,
      interventions: h.interventions,
      allocator: h.allocator,
      projectId: 'PRJ-1',
      researchFileReader: h.pf.reader,
      researchRoot: MEM_RESEARCH_ROOT,
      schemaDir: MEM_SCHEMA_DIR,
      externalState: () => ({ workstreams: h.external.workstreams }),
      now: h.now,
    })
    const pf7 = h.createPfs(1)[0]!
    let r: FloodingCheckResult | undefined
    expect(() => {
      r = badService.onPlanForkCreated(pf7) // 永不抛
    }).not.toThrow()
    expect(r!.blocked).toBe(false)
    expect(r!.checked).toBe(true)
    expect(r!.verdict!.triggered).toBe(true)
    expect(r!.error).toBeDefined()
    expect(r!.error!.code).toBe('FLOODING_EVENT')
    expect(r!.intervention_id).toBeUndefined()
    // 既有 Intervention 行未动（CLOSED 保持）; 创建流不受影响（再建一个照常）。
    expect(h.interventions.getIntervention(firstIv)!.status).toBe('CLOSED')
    expect(h.interventions.findOpenAutoFlooding('WS-1')).toBeNull()
    expect(h.createPfs(1)[0]!.status).toBe('OPEN')
  })

  it('钩子内部失败不抛: 外部快照缺 WS（事件校验拒 — registry 闭环真实生效）', () => {
    const h = harness()
    const { results } = wireCreate(h, 6)
    // 关闭既有 Intervention（解除抑制 — 令检查走到事件 append 阶段）。
    simulateUserClose(h.rawPf, results[5]!.intervention_id!, h.now() + 1)
    h.external.workstreams.delete('WS-1') // 模拟声明式侧快照缺失

    const pf7 = h.createPfs(1)[0]!
    let r: FloodingCheckResult | undefined
    expect(() => {
      r = h.service.onPlanForkCreated(pf7)
    }).not.toThrow()
    expect(r!.blocked).toBe(false)
    expect(r!.checked).toBe(true)
    expect(r!.verdict!.triggered).toBe(true)
    expect(r!.error!.code).toBe('FLOODING_EVENT')
    expect(r!.intervention_id).toBeUndefined()
    // 事件未落地（校验拒）— WS-1 事件仍只有第 6 次那个。
    expect(h.dbPair.store.listRange('WS-1', 1)).toHaveLength(1)
  })

  it('坏入参不抛: onPlanLoaded 空 id / onPlanForkCreated 坏记录', () => {
    const h = harness()
    let r: FloodingCheckResult | undefined
    expect(() => {
      r = h.service.onPlanLoaded('')
    }).not.toThrow()
    expect(r!.blocked).toBe(false)
    expect(r!.checked).toBe(false)
    expect(r!.error!.code).toBe('FLOODING_INPUT')

    expect(() => {
      r = h.service.onPlanForkCreated(null as never)
    }).not.toThrow()
    expect(r!.error!.code).toBe('FLOODING_INPUT')
    expect(r!.blocked).toBe(false)
  })

  it('失败烧号留 gap（§1.1 单调: release 不回收号）', () => {
    const h = harness()
    const { results } = wireCreate(h, 6) // IV-1 + H-1 已烧
    simulateUserClose(h.rawPf, results[5]!.intervention_id!, h.now() + 1) // 解除抑制
    h.external.workstreams.delete('WS-1') // 令下一次创建失败（事件校验拒）
    const pf7 = h.createPfs(1)[0]!
    expect(h.service.onPlanForkCreated(pf7).intervention_id).toBeUndefined()
    // IV-2/H-2 已烧（reserve 先行, append 失败 ⇒ 双 release, 号不回收）。
    h.external.workstreams.set('WS-1', { topicId: 'TPC-1', lifecycle: 'REALIZED' })
    const r = h.service.onPlanForkCreated(h.createPfs(1)[0]!)
    expect(r.intervention_id).toBe('IV-3') // gap: IV-2 永不再发
    expect(r.event_id).toBe('H-3')
    expect(h.interventions.findOpenAutoFlooding('WS-1')?.id).toBe('IV-3')
  })
})

describe('重复抑制 + 重开 = 新 Intervention（§13 语义）', () => {
  it('用户关闭既有 OPEN AUTO_FLOODING 后, 再超阈重建（新 IV, 非迁移重开）', () => {
    const h = harness()
    const { results } = wireCreate(h, 6)
    const firstIv = results[5]!.intervention_id!
    simulateUserClose(h.rawPf, firstIv, h.now() + 1)
    expect(h.interventions.findOpenAutoFlooding('WS-1')).toBeNull()

    const r = h.service.onPlanForkCreated(h.createPfs(1)[0]!)
    expect(r.verdict!.triggered).toBe(true)
    expect(r.verdict!.suppressed).toBe(false)
    expect(r.intervention_id).toBe('IV-2') // 新 Intervention（重开 = 新行）
    expect(r.event_id).toBe('H-2')
    // 旧行保持 CLOSED（append-only, 未篡改）; 新行 OPEN。
    expect(h.interventions.getIntervention(firstIv)!.status).toBe('CLOSED')
    expect(h.interventions.getIntervention('IV-2')!.status).toBe('OPEN')
    // 第二个事件 seq=2（同 owner WS-1）; 校验 ctx 含已关旧行但新 id 为 NEW。
    const events = h.dbPair.store.listRange('WS-1', 1)
    expect(events).toHaveLength(2)
    expect(events[1]!.payload.intervention_id).toBe('IV-2')
  })
})

describe('跨 WS 独立（A-15 per-WS 口径, 用户确认）', () => {
  it('WS-1 超阈不影响 WS-2; WS-2 独立超阈独立触发（各自 Intervention + 事件 owner）', () => {
    const h = harness() // 默认树含 WS-2 canonical plan
    // WS-1: 6 个 OPEN ⇒ 触发（IV-1, owner WS-1）。
    const ws1 = wireCreate(h, 6, 'WS-1')
    expect(ws1.results[5]!.intervention_id).toBe('IV-1')
    // WS-2: 5 个 OPEN ⇒ 不触发（WS-1 的 6 个不混入计数）。
    const ws2under = wireCreate(h, 5, 'WS-2')
    for (const r of ws2under.results) {
      expect(r.verdict!.evidence.workstream_id).toBe('WS-2')
      expect(r.verdict!.triggered).toBe(false)
      expect(r.verdict!.evidence.count).toBeLessThanOrEqual(5)
    }
    expect(h.interventions.listInterventions()).toHaveLength(1)

    // WS-2 第 6 个 ⇒ 独立触发（IV-2, owner WS-2, source_refs 全是 WS-2 的 PF）。
    const r6 = h.service.onPlanForkCreated(h.createPfs(1, 'WS-2')[0]!)
    expect(r6.verdict!.triggered).toBe(true)
    expect(r6.verdict!.evidence.count).toBe(6)
    expect(r6.intervention_id).toBe('IV-2')
    const iv2 = h.interventions.getIntervention('IV-2')!
    expect(iv2.title).toBe('Review accumulated agent plan forks [WS-2]')
    expect(iv2.workstream_ids).toEqual(['WS-2'])
    expect(iv2.source_refs.every((ref) => ref.kind === 'PLAN_FORK')).toBe(true)
    for (const ref of iv2.source_refs) {
      const pf = h.planForks.getPlanFork(ref.id)!
      expect(pf.workstream_id).toBe('WS-2')
    }
    // 事件 owner 各自 WS（WS-2 的首个事件 seq=1）。
    const evWs2 = h.dbPair.store.listRange('WS-2', 1)
    expect(evWs2).toHaveLength(1)
    expect(evWs2[0]!.eventType).toBe('INTERVENTION_CREATED')
    expect(evWs2[0]!.payload.intervention_id).toBe('IV-2')
    expect(evWs2[0]!.ownerWorkstreamId).toBe('WS-2')
    // WS-1 侧未受影响（其 OPEN 探针仍在, 无第二个 WS-1 Intervention）。
    expect(h.interventions.findOpenAutoFlooding('WS-1')?.id).toBe('IV-1')
    expect(h.interventions.listInterventions()).toHaveLength(2)
  })

  it('policy 阈值 2: 第 3 个 PF 即触发（阈值读自 policy, 非默认 5）', () => {
    const h = harness({ policyYaml: 'enabled: true\nflooding:\n  threshold: 2\n' })
    const { results } = wireCreate(h, 3)
    expect(results[0]!.verdict!.evidence.threshold).toBe(2) // policy 装载生效
    expect(results[1]!.verdict!.triggered).toBe(false) // 2 == 2 不严格大于
    expect(results[2]!.verdict!.triggered).toBe(true) // 3 > 2
    expect(results[2]!.intervention_id).toBeDefined()
  })

  it('policy 文件缺失 = §8 默认阈值 5（缺省按 §8 原文）', () => {
    const files = { ...baseTreeFiles() }
    delete files['policies/agent-plan-fork.yaml']
    const h = harness({ files })
    const { results } = wireCreate(h, 6)
    for (const r of results.slice(0, 5)) {
      expect(r.verdict!.evidence.threshold).toBe(5)
      expect(r.verdict!.triggered).toBe(false)
    }
    expect(results[5]!.verdict!.triggered).toBe(true)
  })

  it('policy 坏（冻结 schema 拒）⇒ 检查中止为 FLOODING_POLICY, 不建不抛', () => {
    const h = harness()
    h.createPfs(6)
    // 坏 policy 文件（threshold 0 — 冻结 schema minimum 1）; 服务每检查 fresh
    // 装载 policy ⇒ 换 reader 即生效（同坏 registry 测试的 badService 面）。
    const badReader = new MemoryReader({ ...h.files, 'policies/agent-plan-fork.yaml': 'enabled: true\nflooding:\n  threshold: 0\n' })
    const badService = new FloodingService({
      store: h.dbPair.store,
      registry: h.registry,
      planForks: h.planForks,
      interventions: h.interventions,
      allocator: h.allocator,
      projectId: 'PRJ-1',
      researchFileReader: badReader,
      researchRoot: MEM_RESEARCH_ROOT,
      schemaDir: MEM_SCHEMA_DIR,
      externalState: () => ({ workstreams: h.external.workstreams }),
      now: h.now,
    })
    let r: FloodingCheckResult | undefined
    expect(() => {
      r = badService.onPlanForkCreated(h.planForks.listPlanForks({ workstreamId: 'WS-1', status: 'OPEN' })[0]!)
    }).not.toThrow()
    expect(r!.checked).toBe(false)
    expect(r!.error!.code).toBe('FLOODING_POLICY')
    expect(r!.blocked).toBe(false)
    expect(h.interventions.listInterventions()).toHaveLength(0)
  })
})

describe('onPlanLoaded — §8 触发点 2（同核）', () => {
  it('plan 加载后触发同判定（6 OPEN ⇒ 触发, 与 PF 创建路径同核）', () => {
    const h = harness()
    h.createPfs(6) // 无钩子 — 仅建 PF
    const r = h.service.onPlanLoaded('WS-1')
    expect(r.trigger).toBe('PLAN_LOADED')
    expect(r.verdict!.triggered).toBe(true)
    expect(r.verdict!.evidence.count).toBe(6)
    expect(r.intervention_id).toBe('IV-1')
    // 触发点 1 再跑 ⇒ 抑制（同一 WS 的 OPEN 探针）。
    const r2 = h.service.onPlanForkCreated(h.planForks.listPlanForks({ workstreamId: 'WS-1', status: 'OPEN' })[0]!)
    expect(r2.trigger).toBe('PLAN_FORK_CREATED')
    expect(r2.verdict!.suppressed).toBe(true)
  })

  it('未超阈 WS 的 plan 加载不建（0 OPEN）', () => {
    const h = harness()
    const r = h.service.onPlanLoaded('WS-2')
    expect(r.verdict!.triggered).toBe(false)
    expect(r.verdict!.evidence.count).toBe(0)
    expect(r.intervention_id).toBeUndefined()
  })
})

describe('钩子面输入（接线 WP 的误用防护）', () => {
  it('onPlanLoaded 非字符串 id 不抛（收敛为 FLOODING_INPUT 结果）', () => {
    const h = harness()
    let r: FloodingCheckResult | undefined
    expect(() => {
      r = h.service.onPlanLoaded(123 as never)
    }).not.toThrow()
    expect(r!.checked).toBe(false)
    expect(r!.error!.code).toBe('FLOODING_INPUT')
    expect(r!.blocked).toBe(false)
  })
})

