/**
 * WP-6.3 — discrepancy 分类器测试（任务书「全类别合成场景」）.
 *
 * 覆盖:
 *  - 场景 A 全形态: 5 类别 × 全部 subkind 精确清单钉（14 条, 排序 +
 *    RD id 分配）+ byCategory 计数 + 输入回显;
 *  - 逐条目字段钉（inStrictTracked / matchedArtifactId 无 / signal 三源
 *    / isNew 双通道 / zone 归属 / sizeBytes 双通道 / suggestedType 透出）;
 *  - 抑制与让位规则（uri 匹配抑制 UNREGISTERED / MISSING 在场 →
 *    RECOVERABLE / 声明删除让位缺失类别 / .research/ 一致性清单承载 /
 *    不可验证 uri 不报 / MISSING 缺席状态一致不报 / feed skipped 不入）;
 *  - 保守缺失边界（无 fs 扫描时 zone/diff 缺席信号消失 — 未观测域不报）;
 *  - 首扫语义（firstScan → isNew=false 基线建立）;
 *  - 坐标换算（workspaceRoot='ws' 前缀, uri 匹配跨换算成立）;
 *  - 确定性（输入 shuffle → 逐字段同报告）;
 *  - 空输入（全空三源 → 0 条目, byCategory 全 0）.
 */
import { describe, expect, it } from 'vitest'

import { classifyDiscrepancies, isVerifiableUri } from '../../src/host/audit/reconcile/index.js'
import type { Discrepancy } from '../../src/host/audit/reconcile/index.js'
import {
  SCENARIO_A_EXPECTED,
  artifactRow,
  auditReport,
  candidate,
  declared,
  discoveryReport,
  feed,
  ofCategory,
  policy,
  reconcileInput,
  scenarioA,
  tc,
} from './helpers.js'

function triples(report: ReturnType<typeof classifyDiscrepancies>): [string, string, string][] {
  return report.discrepancies.map((d) => [d.category, d.subkind, d.path])
}

function find(
  report: ReturnType<typeof classifyDiscrepancies>,
  pred: (d: Discrepancy) => boolean,
): Discrepancy {
  const hit = report.discrepancies.filter(pred)
  if (hit.length !== 1) throw new Error(`expected exactly 1 match, got ${hit.length}`)
  return hit[0]!
}

describe('classifyDiscrepancies — 场景 A 全形态（5 类别 × 全 subkind）', () => {
  const report = classifyDiscrepancies(scenarioA())

  it('条目全清单 = 期望 14 条（category, subkind, path 排序精确）', () => {
    expect(triples(report)).toEqual([...SCENARIO_A_EXPECTED])
  })

  it('RD id 依排序序分配（RD-1..RD-14）', () => {
    expect(report.discrepancies.map((d) => d.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `RD-${i + 1}`),
    )
  })

  it('byCategory 计数 = {1,4,2,5,2}（全 5 键齐备）', () => {
    expect(report.byCategory).toEqual({
      ARTIFACT_RECOVERABLE: 1,
      DECLARED_MISSING: 4,
      RESEARCH_UNCHECKPOINTED: 2,
      TRACKED_UNDECLARED: 5,
      UNREGISTERED_WORKSPACE_CHANGE: 2,
    })
  })

  it('输入回显（wsRoot/registry 数/扫描标记/首扫）', () => {
    expect(report.input).toEqual({
      workspaceRoot: '.',
      artifactCount: 7,
      discoveryScanned: true,
      fedUntracked: true,
      firstScan: false,
    })
  })

  it('TRACKED_UNDECLARED/modified: inStrictTracked 双钉（src/ 内 true, loose/ 外 false）+ x/y 原样', () => {
    const inStrict = find(report, (d) => d.category === 'TRACKED_UNDECLARED' && d.path === 'src/lib.ts')
    expect(inStrict).toMatchObject({ category: 'TRACKED_UNDECLARED', subkind: 'modified', x: '.', y: 'M', inStrictTracked: true })
    expect(ofCategory(inStrict, 'TRACKED_UNDECLARED').matchedArtifactId).toBeUndefined()
    const outStrict = find(report, (d) => d.category === 'TRACKED_UNDECLARED' && d.path === 'loose/other.md')
    expect(outStrict).toMatchObject({ subkind: 'modified', inStrictTracked: false })
  })

  it('TRACKED_UNDECLARED/renamed: origPath 透出 + unmerged 子形态', () => {
    const ren = find(report, (d) => d.category === 'TRACKED_UNDECLARED' && d.subkind === 'renamed')
    expect(ren).toMatchObject({ path: 'src/renamed.ts', origPath: 'src/old.ts', x: 'R', y: '.', inStrictTracked: true })
    const un = find(report, (d) => d.category === 'TRACKED_UNDECLARED' && d.subkind === 'unmerged')
    expect(un).toMatchObject({ path: 'conf/a.txt', x: 'U', y: 'U', inStrictTracked: false })
  })

  it('TRACKED_UNDECLARED/deleted: 未声明删除（∉ strict 声明集）', () => {
    const d = find(report, (d) => d.category === 'TRACKED_UNDECLARED' && d.subkind === 'deleted')
    expect(d).toMatchObject({ path: 'loose/del.txt', x: '.', y: 'D', inStrictTracked: false })
  })

  it('DECLARED_MISSING/strict-tracked: W13 并集删除（signal git-deleted）', () => {
    const d = find(report, (d) => d.category === 'DECLARED_MISSING' && d.subkind === 'strict-tracked')
    expect(d).toMatchObject({ path: 'src/gone.ts', signal: 'git-deleted' })
    expect(ofCategory(d, 'DECLARED_MISSING').artifactId).toBeUndefined()
  })

  it('DECLARED_MISSING/research-tree: .research/ 声明树缺失（signal research-missing）', () => {
    const d = find(report, (d) => d.category === 'DECLARED_MISSING' && d.subkind === 'research-tree')
    expect(d).toMatchObject({ path: '.research/x.yaml', signal: 'research-missing' })
  })

  it('DECLARED_MISSING/artifact: 两权威信号分钉（diff-removed / zone-scan-absent）+ artifact/workstream 透出', () => {
    const diffSig = find(report, (d) => d.category === 'DECLARED_MISSING' && d.path === 'results/old.csv')
    expect(diffSig).toMatchObject({ subkind: 'artifact', artifactId: 'A-2', workstreamId: 'WS-1', signal: 'diff-removed' })
    const zoneSig = find(report, (d) => d.category === 'DECLARED_MISSING' && d.path === 'results/gone.csv')
    expect(zoneSig).toMatchObject({ subkind: 'artifact', artifactId: 'A-3', workstreamId: 'WS-1', signal: 'zone-scan-absent' })
  })

  it('RESEARCH_UNCHECKPOINTED: 双子形态（tracked-modified / untracked-new）', () => {
    const mod = find(report, (d) => d.category === 'RESEARCH_UNCHECKPOINTED' && d.subkind === 'tracked-modified')
    expect(mod.path).toBe('.research/plan.yaml')
    const neu = find(report, (d) => d.category === 'RESEARCH_UNCHECKPOINTED' && d.subkind === 'untracked-new')
    expect(neu.path).toBe('.research/topics/NEW/topic.yaml')
  })

  it('ARTIFACT_RECOVERABLE: MISSING 行在场（uri 相等即身份）', () => {
    const d = find(report, (d) => d.category === 'ARTIFACT_RECOVERABLE')
    expect(d).toMatchObject({ subkind: 'found', path: 'results/revived.csv', artifactId: 'A-5', workstreamId: 'WS-2' })
  })

  it('UNREGISTERED_WORKSPACE_CHANGE: 双通道字段钉（zone fs / feed）', () => {
    const zone = find(report, (d) => d.category === 'UNREGISTERED_WORKSPACE_CHANGE' && d.subkind === 'zone')
    expect(zone).toMatchObject({
      path: 'results/plot.svg',
      zone: 'results',
      zoneArtifactTypes: ['DATASET', 'FIGURE'],
      suggestedType: 'FIGURE',
      sizeBytes: 20,
      isNew: true,
      recommendedTier: 'AUTO_RECONCILE',
      tierReason: 'ZONE_DECLARED',
    })
    const fed = find(report, (d) => d.category === 'UNREGISTERED_WORKSPACE_CHANGE' && d.subkind === 'feed')
    expect(fed).toMatchObject({
      path: 'stray/note.txt',
      zone: null,
      zoneArtifactTypes: [],
      suggestedType: 'NOTE',
      sizeBytes: null,
      isNew: true,
      recommendedTier: 'PROPOSE_RECONCILIATION',
      tierReason: 'OUT_OF_ZONE',
    })
  })
})

describe('classifyDiscrepancies — 抑制与让位规则（零重复计数）', () => {
  const report = classifyDiscrepancies(scenarioA())
  const paths = (cat: string, sub?: string): string[] =>
    report.discrepancies.filter((d) => d.category === cat && (sub === undefined || d.subkind === sub)).map((d) => d.path)

  it('uri 匹配抑制 UNREGISTERED（A-1 REGISTERED 在场 / A-5 MISSING 在场 — 均非「未注册」）', () => {
    const unreg = paths('UNREGISTERED_WORKSPACE_CHANGE')
    expect(unreg).toEqual(['stray/note.txt', 'results/plot.svg'])
    expect(unreg).not.toContain('results/data.csv')
    expect(unreg).not.toContain('results/revived.csv')
  })

  it('声明删除让位缺失类别（src/gone.ts 不发 TRACKED_UNDECLARED）', () => {
    expect(paths('TRACKED_UNDECLARED', 'deleted')).not.toContain('src/gone.ts')
    expect(paths('DECLARED_MISSING', 'strict-tracked')).toEqual(['src/gone.ts'])
  })

  it('.research/ trackedChanges 恒不发 TRACKED_UNDECLARED（一致性清单承载）', () => {
    for (const p of paths('TRACKED_UNDECLARED')) expect(p.startsWith('.research/')).toBe(false)
    expect(paths('RESEARCH_UNCHECKPOINTED', 'tracked-modified')).toEqual(['.research/plan.yaml'])
    expect(paths('DECLARED_MISSING', 'research-tree')).toEqual(['.research/x.yaml'])
  })

  it('不可验证 uri 不报缺失/找回（scheme / 绝对路径 — A-6/A-7）', () => {
    const art = paths('DECLARED_MISSING', 'artifact')
    expect(art).toEqual(['results/gone.csv', 'results/old.csv'])
    expect(paths('ARTIFACT_RECOVERABLE')).toEqual(['results/revived.csv'])
  })

  it('MISSING 且缺席 = 状态一致不报（A-4 results/lost.csv）', () => {
    const all = report.discrepancies.map((d) => d.path)
    expect(all).not.toContain('results/lost.csv')
  })

  it('feed skipped 条目不入候选（IGNORED / DIRECTORY_MARKER — cache/junk.bin, src/dir2/）', () => {
    const all = report.discrepancies.map((d) => d.path)
    expect(all).not.toContain('cache/junk.bin')
    expect(all).not.toContain('src/dir2/')
  })
})

describe('classifyDiscrepancies — 保守缺失边界（未观测域不报）', () => {
  it('无 fs 扫描: diff/zone 缺席信号消失 — artifact 缺失仅剩 git 权威面', () => {
    const input = scenarioA()
    const noScan = reconcileInput(input.audit, input.declared, {
      discovery: null,
      untrackedFeed: input.untrackedFeed,
    })
    const report = classifyDiscrepancies(noScan)
    // A-2（diff.removed）与 A-3（zone-scan-absent）均失去权威信号 → 不报
    expect(report.discrepancies.filter((d) => d.category === 'DECLARED_MISSING' && d.subkind === 'artifact')).toEqual([])
    expect(report.input.discoveryScanned).toBe(false)
    expect(report.input.firstScan).toBe(false)
    // feed 通道不受影响
    expect(report.discrepancies.map((d) => d.path)).toContain('stray/note.txt')
  })

  it('zoneDirMissing: zone 目录不存在 → 该 zone 下 artifact 不报 zone-scan-absent（扫描未覆盖, 非缺席证据）', () => {
    const input = scenarioA()
    const rep = discoveryReport({
      candidates: [
        candidate({ path: 'results/data.csv', sizeBytes: 10, zone: 'results', suggestedType: 'DATASET' }),
        candidate({ path: 'results/plot.svg', sizeBytes: 20, zone: 'results', suggestedType: 'FIGURE' }),
        candidate({ path: 'results/revived.csv', sizeBytes: 30, zone: 'results', suggestedType: 'DATASET' }),
      ],
      zoneDirMissing: ['docs'],
      added: ['results/plot.svg'],
    })
    // A-3 移入缺失 zone（docs/）— zone 不存在 → 无缺席证据
    const dec = declared([
      artifactRow({ id: 'A-3', uri: 'docs/gone.csv' }),
      artifactRow({ id: 'A-9', uri: 'results/visible.csv' }), // 不在场, 在场 zone 缺席 → 报
    ])
    const report = classifyDiscrepancies(reconcileInput(input.audit, dec, { discovery: rep, untrackedFeed: null }))
    const art = report.discrepancies.filter((d) => d.category === 'DECLARED_MISSING' && d.subkind === 'artifact')
    expect(art.map((d) => d.path)).toEqual(['results/visible.csv'])
    expect(ofCategory(art[0]!, 'DECLARED_MISSING').signal).toBe('zone-scan-absent')
  })

  it('uri 在 zone 外且无扫描/strict 覆盖 → 未观测域, 不报缺失', () => {
    const audit = auditReport({})
    const dec = declared([artifactRow({ id: 'A-1', uri: 'elsewhere/f.csv' })])
    const report = classifyDiscrepancies(reconcileInput(audit, dec, { discovery: discoveryReport({ candidates: [] }), untrackedFeed: null }))
    expect(report.discrepancies).toEqual([])
  })
})

describe('classifyDiscrepancies — 首扫语义（基线建立, 非 N 条新事件）', () => {
  it('firstScan=true → zone 候选 isNew=false（全量 added 不视为新事件）', () => {
    const input = scenarioA()
    const first = discoveryReport({
      candidates: input.discovery!.candidates,
      firstScan: true,
      added: input.discovery!.candidates.map((c) => c.path),
    })
    const report = classifyDiscrepancies(reconcileInput(input.audit, input.declared, {
      discovery: first,
      untrackedFeed: null,
    }))
    const zone = report.discrepancies.filter((d) => d.category === 'UNREGISTERED_WORKSPACE_CHANGE' && d.subkind === 'zone')
    expect(zone.length).toBeGreaterThan(0)
    for (const d of zone) {
      if (d.subkind === 'zone') expect(d.isNew).toBe(false)
    }
    expect(report.input.firstScan).toBe(true)
    // feed 通道恒 isNew=true（无基线面）
  })

  it('非首扫: ∈ diff.added → isNew=true; ∉ added（unchanged）→ isNew=false', () => {
    const audit = auditReport({})
    const rep = discoveryReport({
      candidates: [
        candidate({ path: 'results/new.csv', sizeBytes: 1, zone: 'results', suggestedType: 'DATASET' }),
        candidate({ path: 'results/stable.csv', sizeBytes: 2, zone: 'results', suggestedType: 'DATASET' }),
      ],
      added: ['results/new.csv'],
      unchanged: ['results/stable.csv'],
    })
    const report = classifyDiscrepancies(reconcileInput(audit, declared([]), { discovery: rep, untrackedFeed: null }))
    const byPath = new Map(report.discrepancies.map((d) => [d.path, d]))
    expect(byPath.get('results/new.csv')).toMatchObject({ isNew: true })
    expect(byPath.get('results/stable.csv')).toMatchObject({ isNew: false })
  })
})

describe('classifyDiscrepancies — 坐标换算（workspace.root ≠ repo root）', () => {
  it('候选/uri 跨前缀换算后匹配成立（抑制 + 缺失判定均生效）', () => {
    const pol = policy({
      workspaceRoot: 'ws',
      zones: [{ path: 'results/', artifactTypes: ['DATASET'] }],
      strictTrackedPaths: ['ws/src/'],
    })
    const audit = auditReport({
      strictTracked: {
        pathspecs: ['ws/src/'],
        tracked: ['ws/src/lib.ts'],
        modified: ['ws/src/lib.ts'],
        deleted: ['ws/src/gone.ts'],
      },
      trackedChanges: [tc({ path: 'ws/src/lib.ts', x: '.', y: 'M' })],
    })
    const rep = discoveryReport({
      candidates: [candidate({ path: 'results/a.csv', sizeBytes: 1, zone: 'results', suggestedType: 'DATASET' })],
    })
    const dec = declared(
      [
        artifactRow({ id: 'A-1', uri: 'results/a.csv' }), // 换算后与候选匹配 → 抑制
        artifactRow({ id: 'A-2', uri: 'src/gone.ts' }), // 换算 = ws/src/gone.ts ∈ strict deleted → 缺失
      ],
      pol,
    )
    const report = classifyDiscrepancies(reconcileInput(audit, dec, { discovery: rep, untrackedFeed: null }))
    expect(report.input.workspaceRoot).toBe('ws')
    // 候选换算为 ws/results/a.csv, 被 A-1 抑制 → 无 UNREGISTERED
    expect(report.discrepancies.filter((d) => d.category === 'UNREGISTERED_WORKSPACE_CHANGE')).toEqual([])
    const missing = find(report, (d) => d.category === 'DECLARED_MISSING' && d.subkind === 'artifact')
    expect(missing).toMatchObject({ path: 'ws/src/gone.ts', artifactId: 'A-2', signal: 'git-deleted' })
    const tracked = find(report, (d) => d.category === 'TRACKED_UNDECLARED')
    expect(tracked).toMatchObject({ path: 'ws/src/lib.ts', inStrictTracked: true })
  })
})

describe('classifyDiscrepancies — 双通道去重与确定性', () => {
  it('同路径双通道（fs ∪ feed）→ 恰一条, fs 证据优先（sizeBytes/zone 取 fs 侧）', () => {
    const audit = auditReport({})
    const rep = discoveryReport({
      candidates: [candidate({ path: 'results/a.csv', sizeBytes: 111, zone: 'results', suggestedType: 'DATASET' })],
    })
    const fd = feed([candidate({ path: 'results/a.csv', sizeBytes: null, suggestedType: 'DATASET' })])
    const report = classifyDiscrepancies(reconcileInput(audit, declared([]), { discovery: rep, untrackedFeed: fd }))
    const unreg = report.discrepancies.filter((d) => d.category === 'UNREGISTERED_WORKSPACE_CHANGE')
    expect(unreg.length).toBe(1)
    expect(unreg[0]).toMatchObject({ subkind: 'zone', sizeBytes: 111, zone: 'results' })
  })

  it('确定性: 输入各清单 shuffle → 逐字段同报告（含 RD id）', () => {
    const input = scenarioA()
    const base = classifyDiscrepancies(input)
    const disc = input.discovery ?? null
    const fdIn = input.untrackedFeed ?? null
    const shuffled = reconcileInput(
      {
        ...input.audit,
        trackedChanges: [...input.audit.trackedChanges].reverse(),
        strictTracked: {
          ...input.audit.strictTracked,
          tracked: [...input.audit.strictTracked.tracked].reverse(),
          modified: [...input.audit.strictTracked.modified].reverse(),
          deleted: [...input.audit.strictTracked.deleted].reverse(),
        },
        research: {
          ...input.audit.research,
          trackedModified: [...input.audit.research.trackedModified].reverse(),
          untracked: [...input.audit.research.untracked].reverse(),
          missing: [...input.audit.research.missing].reverse(),
        },
        newFiles: {
          outsideResearch: [...input.audit.newFiles.outsideResearch].reverse(),
          insideResearch: [...input.audit.newFiles.insideResearch].reverse(),
        },
      },
      {
        policy: input.declared.policy,
        artifacts: new Map([...input.declared.artifacts.entries()].reverse()),
      },
      {
        discovery: disc === null ? null : { ...disc, candidates: [...disc.candidates].reverse() },
        untrackedFeed: fdIn === null ? null : { ...fdIn, candidates: [...fdIn.candidates].reverse() },
      },
    )
    expect(classifyDiscrepancies(shuffled)).toEqual(base)
  })
})

describe('classifyDiscrepancies — 空输入 / isVerifiableUri 面', () => {
  it('全空三源 → 0 条目, byCategory 全 0（5 键齐备）', () => {
    const report = classifyDiscrepancies(reconcileInput(auditReport({}), declared([])))
    expect(report.discrepancies).toEqual([])
    expect(report.byCategory).toEqual({
      ARTIFACT_RECOVERABLE: 0,
      DECLARED_MISSING: 0,
      RESEARCH_UNCHECKPOINTED: 0,
      TRACKED_UNDECLARED: 0,
      UNREGISTERED_WORKSPACE_CHANGE: 0,
    })
    expect(report.input).toEqual({
      workspaceRoot: '.',
      artifactCount: 0,
      discoveryScanned: false,
      fedUntracked: false,
      firstScan: false,
    })
  })

  it('isVerifiableUri 机械面（可验证/不可验证全形状）', () => {
    expect(isVerifiableUri('results/a.csv')).toBe(true)
    expect(isVerifiableUri('a/b/c.txt')).toBe(true)
    expect(isVerifiableUri('http://example.com/a.csv')).toBe(false)
    expect(isVerifiableUri('file:///x/a.csv')).toBe(false)
    expect(isVerifiableUri('/abs/a.csv')).toBe(false)
    expect(isVerifiableUri('a/../b.csv')).toBe(false)
    expect(isVerifiableUri('a//b.csv')).toBe(false)
    expect(isVerifiableUri('a/b.csv/')).toBe(false)
    expect(isVerifiableUri('.')).toBe(false)
    expect(isVerifiableUri('')).toBe(false)
    expect(isVerifiableUri('a\\b.csv')).toBe(false)
  })
})
