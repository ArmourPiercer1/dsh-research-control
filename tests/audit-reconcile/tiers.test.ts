/**
 * WP-6.3 — reconciliation 三档测试（任务书「三档动作 + 用户门」）.
 *
 * 覆盖:
 *  - 推荐档位冻结映射（6 规则全钉, 类别 × zone 条件）;
 *  - 每档动作产物形状（AUTO → INBOX_CAPTURE / PROPOSE →
 *    PROPOSE_DECLARATION + 3 提案形态 + null 面 / ESCALATE →
 *    ESCALATE_INTERVENTION / IGNORE → IGNORED 标记）;
 *  - 用户门双面: 类型面（@ts-expect-error 编译错误钉）+ 运行面
 *    （伪造 AGENT/null actor ⇒ RECON_ACTOR_FORBIDDEN 零部分输出）;
 *  - 前置校验（未知 refId / 重复决策 / 未知 choice / 畸形决策 —
 *    指名 + 零部分输出）;
 *  - 输出排序 + byRef 1:1 + now 注入 + 确定性（决策 shuffle）.
 */
import { describe, expect, it } from 'vitest'

import {
  DISCREPANCY_CATEGORIES,
  IGNORE_CHOICE,
  RECONCILIATION_TIERS,
  RECONCILE_USER_ACTOR,
  TIER_ACTION,
  classifyDiscrepancies,
  reconcileDiscrepancies,
  recommendTier,
  isReconcileError,
  type ReconcileUserActorRef,
} from '../../src/host/audit/reconcile/index.js'
import {
  SCENARIO_A_EXPECTED,
  artifactRow,
  auditReport,
  declared,
  ofCategory,
  reconcileInput,
  scenarioA,
} from './helpers.js'

const NOW = 123_456_789

/** ReconcileError 断言辅助（vitest `toThrow` 不支持谓词形态 — 显式捕获）。 */
function expectReconcileThrow(
  fn: () => unknown,
  code: 'RECON_INPUT' | 'RECON_ACTOR_FORBIDDEN' | 'RECON_TIER_UNKNOWN',
  msgRe?: RegExp,
): void {
  let thrown: unknown = null
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown, 'expected ReconcileError to be thrown').not.toBeNull()
  expect(isReconcileError(thrown)).toBe(true)
  if (thrown !== null && isReconcileError(thrown)) {
    expect(thrown.code).toBe(code)
    if (msgRe !== undefined) expect(thrown.message).toMatch(msgRe)
  }
}

const report = classifyDiscrepancies(scenarioA())
const idOf = (i: number): string => report.discrepancies[i]!.id
/** RD-13 = UNREGISTERED/feed（zone=null → PROPOSE）; RD-14 = UNREGISTERED/zone（AUTO）. */
const D_FEED = idOf(12)
const D_ZONE = idOf(13)
/** RD-10 = TRACKED modified src/lib.ts（无 artifact 匹配 → PROPOSE）. */
const D_TRACKED = idOf(9)
/** RD-3 = DECLARED_MISSING/artifact A-2（ESCALATE）. */
const D_MISSING = idOf(2)
/** RD-6 = RESEARCH_UNCHECKPOINTED tracked-modified（AUTO）. */
const D_RESEARCH = idOf(5)

describe('推荐档位 — 冻结映射（§22.3 原文锚点）', () => {
  it('UNREGISTERED_WORKSPACE_CHANGE: zone 声明 → AUTO/ZONE_DECLARED; zone 外 → PROPOSE/OUT_OF_ZONE', () => {
    expect(recommendTier({ category: 'UNREGISTERED_WORKSPACE_CHANGE', zone: 'results' })).toEqual({
      tier: 'AUTO_RECONCILE',
      reason: 'ZONE_DECLARED',
    })
    expect(recommendTier({ category: 'UNREGISTERED_WORKSPACE_CHANGE', zone: null })).toEqual({
      tier: 'PROPOSE_RECONCILIATION',
      reason: 'OUT_OF_ZONE',
    })
  })

  it('TRACKED_UNDECLARED → PROPOSE/TRACKED_CHANGE_CONFIRM（可能匹配但需确认）', () => {
    expect(recommendTier({ category: 'TRACKED_UNDECLARED' })).toEqual({
      tier: 'PROPOSE_RECONCILIATION',
      reason: 'TRACKED_CHANGE_CONFIRM',
    })
  })

  it('DECLARED_MISSING → ESCALATE/DECLARED_LOSS（高影响/损失 → Intervention）', () => {
    expect(recommendTier({ category: 'DECLARED_MISSING' })).toEqual({ tier: 'ESCALATE', reason: 'DECLARED_LOSS' })
  })

  it('RESEARCH_UNCHECKPOINTED → AUTO/CHECKPOINT_GAP; ARTIFACT_RECOVERABLE → AUTO/URI_MATCH', () => {
    expect(recommendTier({ category: 'RESEARCH_UNCHECKPOINTED' })).toEqual({ tier: 'AUTO_RECONCILE', reason: 'CHECKPOINT_GAP' })
    expect(recommendTier({ category: 'ARTIFACT_RECOVERABLE' })).toEqual({ tier: 'AUTO_RECONCILE', reason: 'URI_MATCH' })
  })

  it('classify 内联推荐与 tiers 单一真源逐位一致（漂移 guard）', () => {
    for (const d of report.discrepancies) {
      const t = recommendTier({ category: d.category, zone: d.category === 'UNREGISTERED_WORKSPACE_CHANGE' ? d.zone : null })
      expect(d.recommendedTier).toBe(t.tier)
      expect(d.tierReason).toBe(t.reason)
    }
  })

  it('冻结面常量（三档/类别/TIER_ACTION — 漂移 guard）', () => {
    expect([...RECONCILIATION_TIERS].sort()).toEqual(['AUTO_RECONCILE', 'ESCALATE', 'PROPOSE_RECONCILIATION'])
    expect([...DISCREPANCY_CATEGORIES].sort()).toEqual([
      'ARTIFACT_RECOVERABLE',
      'DECLARED_MISSING',
      'RESEARCH_UNCHECKPOINTED',
      'TRACKED_UNDECLARED',
      'UNREGISTERED_WORKSPACE_CHANGE',
    ])
    expect(TIER_ACTION).toEqual({
      AUTO_RECONCILE: 'INBOX_CAPTURE',
      PROPOSE_RECONCILIATION: 'PROPOSE_DECLARATION',
      ESCALATE: 'ESCALATE_INTERVENTION',
    })
    expect(IGNORE_CHOICE).toBe('IGNORE')
  })
})

describe('三档动作 — 产物形状', () => {
  it('AUTO_RECONCILE → INBOX_CAPTURE: 1 Inbox 草稿, 无提案/无 Intervention', () => {
    const out = reconcileDiscrepancies(report, [{ refId: D_ZONE, choice: 'AUTO_RECONCILE' }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.inboxDrafts.length).toBe(1)
    expect(out.inboxDrafts[0]).toMatchObject({ raw: report.discrepancies[13], state: 'CAPTURED', createdAt: NOW })
    expect(out.proposals).toEqual([])
    expect(out.interventionRequests).toEqual([])
    expect(out.ignored).toEqual([])
    expect(out.byRef.get(D_ZONE)).toMatchObject({ kind: 'INBOX_CAPTURE' })
    expect(out.at).toBe(NOW)
  })

  it('PROPOSE（zone 外未注册）→ PROPOSE_DECLARATION + ARTIFACT_REGISTER 提案（材料全机械）', () => {
    const out = reconcileDiscrepancies(report, [{ refId: D_FEED, choice: 'PROPOSE_RECONCILIATION' }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.inboxDrafts.length).toBe(1)
    expect(out.interventionRequests).toEqual([])
    expect(out.proposals).toEqual([
      {
        kind: 'ARTIFACT_REGISTER',
        path: 'stray/note.txt',
        suggestedType: 'NOTE',
        zone: null,
        zoneArtifactTypes: [],
        matchedArtifactId: null,
      },
    ])
    expect(out.byRef.get(D_FEED)).toMatchObject({ kind: 'PROPOSE_DECLARATION', proposal: expect.any(Object) })
  })

  it('PROPOSE（tracked 无匹配）→ ARTIFACT_REGISTER（suggestedType = 冻结表机械信号）', () => {
    // src/lib.ts → 扩展名 .ts → CODE（WP-6.2 冻结表）
    const out = reconcileDiscrepancies(report, [{ refId: D_TRACKED, choice: 'PROPOSE_RECONCILIATION' }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.proposals).toEqual([
      {
        kind: 'ARTIFACT_REGISTER',
        path: 'src/lib.ts',
        suggestedType: 'CODE',
        zone: null,
        zoneArtifactTypes: [],
        matchedArtifactId: null,
      },
    ])
  })

  it('PROPOSE（tracked 有 uri 匹配）→ ARTIFACT_CHANGE_CONFIRM（可能匹配但需确认 — 确认面）', () => {
    const input = reconcileInput(
      auditReport({ trackedChanges: [{ path: 'results/data.csv', kind: 'tracked', x: '.', y: 'M', staged: false, worktreeModified: true, stagedForDeletion: false, deletedInWorktree: false }] }),
      declared([artifactRow({ id: 'A-1', uri: 'results/data.csv' })]),
      { discovery: null, untrackedFeed: null },
    )
    const rep = classifyDiscrepancies(input)
    const d = rep.discrepancies[0]!
    expect(d.category).toBe('TRACKED_UNDECLARED')
    expect(ofCategory(d, 'TRACKED_UNDECLARED').matchedArtifactId).toBe('A-1')
    const out = reconcileDiscrepancies(rep, [{ refId: d.id, choice: 'PROPOSE_RECONCILIATION' }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.proposals).toEqual([{ kind: 'ARTIFACT_CHANGE_CONFIRM', path: 'results/data.csv', artifactId: 'A-1', subkind: 'modified' }])
  })

  it('PROPOSE（RESEARCH_UNCHECKPOINTED）→ CHECKPOINT 提案（引导 checkpoint — 用户面）', () => {
    const out = reconcileDiscrepancies(report, [{ refId: D_RESEARCH, choice: 'PROPOSE_RECONCILIATION' }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.proposals).toEqual([{ kind: 'CHECKPOINT', paths: ['.research/plan.yaml'] }])
    expect(out.inboxDrafts.length).toBe(1)
  })

  it('PROPOSE（DECLARED_MISSING）→ 仅 Inbox 留痕, 提案 null（无机械可提声明）', () => {
    const out = reconcileDiscrepancies(report, [{ refId: D_MISSING, choice: 'PROPOSE_RECONCILIATION' }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.proposals).toEqual([])
    expect(out.inboxDrafts.length).toBe(1)
    const act = out.byRef.get(D_MISSING)
    expect(act).toBeDefined()
    if (act !== undefined && act.kind === 'PROPOSE_DECLARATION') expect(act.proposal).toBeNull()
  })

  it('ESCALATE → ESCALATE_INTERVENTION: 1 Intervention 请求（AUTO_AUDIT/PLUGIN 冻结推导）', () => {
    const out = reconcileDiscrepancies(report, [{ refId: D_MISSING, choice: 'ESCALATE' }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.inboxDrafts).toEqual([])
    expect(out.proposals).toEqual([])
    expect(out.interventionRequests.length).toBe(1)
    const req = out.interventionRequests[0]!
    expect(req).toMatchObject({
      title: '[audit] DECLARED_MISSING: results/old.csv',
      trigger: 'AUDIT_HIGH_IMPACT_DISCREPANCY',
      origin: 'AUTO_AUDIT',
      actor: { kind: 'PLUGIN' },
      workstreamIds: ['WS-1'],
    })
    expect(req.sourceRefs).toEqual([{ kind: 'ARTIFACT', id: 'A-2' }, { kind: 'WORKSTREAM', id: 'WS-1' }])
    expect(req.detail).toContain('signal=diff-removed')
    expect(out.byRef.get(D_MISSING)).toMatchObject({ kind: 'ESCALATE_INTERVENTION' })
  })

  it('IGNORE → IGNORED 纯标记（无 Inbox/提案/Intervention 产物）', () => {
    const out = reconcileDiscrepancies(report, [{ refId: D_ZONE, choice: IGNORE_CHOICE }], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out.ignored).toEqual([D_ZONE])
    expect(out.inboxDrafts).toEqual([])
    expect(out.proposals).toEqual([])
    expect(out.interventionRequests).toEqual([])
    expect(out.byRef.get(D_ZONE)).toEqual({ kind: 'IGNORED', refId: D_ZONE })
  })

  it('混合批次: 四形态并存, 全列表按 refId 排序, byRef 1:1', () => {
    const out = reconcileDiscrepancies(
      report,
      [
        { refId: D_RESEARCH, choice: 'AUTO_RECONCILE' },
        { refId: D_MISSING, choice: 'ESCALATE' },
        { refId: D_ZONE, choice: IGNORE_CHOICE },
        { refId: D_FEED, choice: 'PROPOSE_RECONCILIATION' },
      ],
      RECONCILE_USER_ACTOR,
      { now: () => NOW },
    )
    expect(out.inboxDrafts.map((e) => e.raw.id)).toEqual([D_FEED, D_RESEARCH]) // refId 字典序: 'RD-13' < 'RD-6'
    expect(out.proposals.length).toBe(1)
    expect(out.interventionRequests.length).toBe(1)
    expect(out.ignored).toEqual([D_ZONE])
    expect([...out.byRef.keys()].sort()).toEqual([D_FEED, D_ZONE, D_MISSING, D_RESEARCH]) // refId 字典序
  })

  it('空决策 = 合法 no-op（空产物 + 空 byRef）', () => {
    const out = reconcileDiscrepancies(report, [], RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(out).toEqual({
      actor: RECONCILE_USER_ACTOR,
      at: NOW,
      inboxDrafts: [],
      proposals: [],
      interventionRequests: [],
      ignored: [],
      byRef: new Map(),
    })
  })

  it('确定性: 同输入双跑同报告; 决策 shuffle → 同产物（排序按 refId）', () => {
    const decisions = [
      { refId: D_RESEARCH, choice: 'AUTO_RECONCILE' as const },
      { refId: D_MISSING, choice: 'ESCALATE' as const },
      { refId: D_FEED, choice: 'PROPOSE_RECONCILIATION' as const },
    ]
    const a = reconcileDiscrepancies(report, decisions, RECONCILE_USER_ACTOR, { now: () => NOW })
    const b = reconcileDiscrepancies(report, decisions, RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(b).toEqual(a)
    const c = reconcileDiscrepancies(report, [...decisions].reverse(), RECONCILE_USER_ACTOR, { now: () => NOW })
    expect(c.inboxDrafts).toEqual(a.inboxDrafts)
    expect(c.interventionRequests).toEqual(a.interventionRequests)
    expect(c.byRef.size).toBe(3)
  })
})

describe('用户门 — 档位选择仅用户（INV-PERM-4 双面）', () => {
  it('类型面: 非 USER actor 是编译错误（AGENT/SYSTEM/裸对象 — @ts-expect-error 钉）', () => {
    // @ts-expect-error — kind 'AGENT' 不是 ReconcileUserActorRef（INV-PERM-4 类型面）
    const agent: ReconcileUserActorRef = { kind: 'AGENT', label: 'agent' }
    // @ts-expect-error — kind 'SYSTEM' 不是 ReconcileUserActorRef
    const sys: ReconcileUserActorRef = { kind: 'SYSTEM' }
    // @ts-expect-error — 缺 kind
    const bare: ReconcileUserActorRef = {}
    expect(agent.kind).toBe('AGENT')
    expect(sys.kind).toBe('SYSTEM')
    expect(Object.keys(bare)).toEqual([])
  })

  it('运行面: 伪造 AGENT actor（as unknown 强转）⇒ RECON_ACTOR_FORBIDDEN 零部分输出', () => {
    const forged = { kind: 'AGENT', label: 'agent' } as unknown as ReconcileUserActorRef
    expectReconcileThrow(
      () => reconcileDiscrepancies(report, [{ refId: D_ZONE, choice: 'AUTO_RECONCILE' }], forged, { now: () => NOW }),
      'RECON_ACTOR_FORBIDDEN',
    )
  })

  it('运行面: null / 非对象 / 空 kind ⇒ RECON_ACTOR_FORBIDDEN', () => {
    for (const bad of [null, undefined, 42, 'user', { kind: null }, { user_id: 'u1' }] as unknown as ReconcileUserActorRef[]) {
      expectReconcileThrow(
        () => reconcileDiscrepancies(report, [], bad, { now: () => NOW }),
        'RECON_ACTOR_FORBIDDEN',
      )
    }
  })

  it('默认用户 actor（RECONCILE_USER_ACTOR）+ 带 user_id/label 的 USER actor 合法', () => {
    const out = reconcileDiscrepancies(report, [{ refId: D_ZONE, choice: 'AUTO_RECONCILE' }], { kind: 'USER', user_id: 'u1', label: 'gtx' }, { now: () => NOW })
    expect(out.actor).toEqual({ kind: 'USER', user_id: 'u1', label: 'gtx' })
    expect(out.inboxDrafts.length).toBe(1)
  })
})

describe('前置校验 — fail-loud + 零部分输出', () => {
  it('未知 refId ⇒ RECON_INPUT（指名）', () => {
    expectReconcileThrow(
      () => reconcileDiscrepancies(report, [{ refId: 'RD-999', choice: 'AUTO_RECONCILE' }], RECONCILE_USER_ACTOR, { now: () => NOW }),
      'RECON_INPUT',
      /RD-999/,
    )
  })

  it('重复决策 ⇒ RECON_INPUT（一个 discrepancy 一个决策）', () => {
    expectReconcileThrow(
      () =>
        reconcileDiscrepancies(report, [{ refId: D_ZONE, choice: 'AUTO_RECONCILE' }, { refId: D_ZONE, choice: 'ESCALATE' }], RECONCILE_USER_ACTOR, {
          now: () => NOW,
        }),
      'RECON_INPUT',
    )
  })

  it('未知 choice ⇒ RECON_TIER_UNKNOWN（指名封闭集）', () => {
    expectReconcileThrow(
      () => reconcileDiscrepancies(report, [{ refId: D_ZONE, choice: 'RECONCILE' as never }], RECONCILE_USER_ACTOR, { now: () => NOW }),
      'RECON_TIER_UNKNOWN',
      /AUTO_RECONCILE\|PROPOSE_RECONCILIATION\|ESCALATE\|IGNORE/,
    )
  })

  it('畸形决策（缺 refId / 空 refId / 非对象）⇒ RECON_INPUT', () => {
    const bads = [
      { choice: 'AUTO_RECONCILE' },
      { refId: '', choice: 'AUTO_RECONCILE' },
      null,
      'AUTO_RECONCILE',
    ] as never[]
    for (const bad of bads) {
      expectReconcileThrow(() => reconcileDiscrepancies(report, [bad], RECONCILE_USER_ACTOR, { now: () => NOW }), 'RECON_INPUT')
    }
  })
})

describe('分类器 → 档位全流程（全类别 × 全档位合成遍历）', () => {
  it('场景 A 全 14 条 × 用户采纳推荐档位: 动作产物按类别封闭分布', () => {
    const decisions = report.discrepancies.map((d) => ({ refId: d.id, choice: d.recommendedTier }))
    const out = reconcileDiscrepancies(report, decisions, RECONCILE_USER_ACTOR, { now: () => NOW })
    // AUTO: RECOVERABLE(1) + RESEARCH(2) + UNREGISTERED/zone(1) = 4 Inbox
    // PROPOSE: UNREGISTERED/feed(1) + TRACKED(5) = 6 Inbox + 6 提案
    // ESCALATE: MISSING(4) = 4 Intervention
    expect(out.inboxDrafts.length).toBe(10)
    expect(out.proposals.length).toBe(6)
    expect(out.interventionRequests.length).toBe(4)
    expect(out.ignored).toEqual([])
    // 提案形态分布: ARTIFACT_REGISTER(6 — 1 feed + 5 tracked 无匹配), 无其他形态
    for (const p of out.proposals) {
      if (p.kind === 'ARTIFACT_REGISTER') expect(p.matchedArtifactId).toBeNull()
    }
    // Intervention 全为 ESCALATE 类别（DECLARED_MISSING ×4）
    for (const r of out.interventionRequests) {
      expect(r.origin).toBe('AUTO_AUDIT')
      expect(r.actor).toEqual({ kind: 'PLUGIN' })
    }
    // 期望清单回指（id 稳定性 — 与场景 A 规格一致）
    expect(triples(report)).toEqual([...SCENARIO_A_EXPECTED])
  })
})

function triples(rep: ReturnType<typeof classifyDiscrepancies>): [string, string, string][] {
  return rep.discrepancies.map((d): [string, string, string] => [d.category, d.subkind, d.path])
}
