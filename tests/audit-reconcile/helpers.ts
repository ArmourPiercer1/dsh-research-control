/**
 * WP-6.3 — 测试基建: 合成输入构造器（全形态 AuditReport /
 * DiscoveryScanReport / UntrackedFeedResult / DeclaredState）。
 *
 * 口径: 与 WP-6.1/6.2 类型面逐字段对齐（类型来自实仓 import — 漂移即
 * tsc 红）; 全部工厂输出确定性（无时间戳自生成）; `makeScenarioA`
 * 是全形态合成场景（5 类别全触发 + 各类抑制/让位规则齐备）—
 * classify.test.ts 的主钉。
 */
import type { AuditPolicy, AuditReport, StrictTrackedChange } from '../../src/host/audit/strict/index.js'
import type {
  DiscoveryCandidate,
  DiscoveryPolicy,
  DiscoveryScanReport,
  UntrackedFeedResult,
} from '../../src/host/audit/discovery/index.js'
import type { ArtifactRow } from '../../src/host/domain/semantics/index.js'
import type { ArtifactType } from '../../src/host/domain/loader/index.js'
import type { Discrepancy, DeclaredState, ReconcileInput } from '../../src/host/audit/reconcile/index.js'

/** 类别窄化（判别联合 → 变体; 谓词已在运行面验证 — 此处补类型面）。 */
export function ofCategory<T extends Discrepancy['category']>(
  d: Discrepancy,
  cat: T,
): Extract<Discrepancy, { readonly category: T }> {
  if (d.category !== cat) throw new Error(`category mismatch: ${d.category} !== ${cat}`)
  return d as Extract<Discrepancy, { readonly category: T }>
}

/* ------------------------------------------------------------------ *
 * 基础行工厂
 * ------------------------------------------------------------------ */

export function tc(init: {
  path: string
  x?: string
  y?: string
  kind?: 'tracked' | 'renamed' | 'unmerged'
  origPath?: string
  diffStatus?: string
}): StrictTrackedChange {
  const x = init.x ?? '.'
  const y = init.y ?? '.'
  return {
    path: init.path,
    kind: init.kind ?? 'tracked',
    x,
    y,
    staged: x !== '.',
    worktreeModified: y !== '.',
    stagedForDeletion: x === 'D',
    deletedInWorktree: y === 'D',
    ...(init.origPath !== undefined ? { origPath: init.origPath } : {}),
    ...(init.diffStatus !== undefined ? { diffStatus: init.diffStatus } : {}),
  }
}

export function artifactRow(init: {
  id: string
  uri: string
  status?: 'REGISTERED' | 'MISSING'
  workstream_id?: string
  type?: ArtifactType
  title?: string
  recorded_at?: number
}): ArtifactRow {
  return {
    id: init.id,
    workstream_id: init.workstream_id ?? 'WS-1',
    type: init.type ?? 'OTHER',
    title: init.title ?? init.id,
    uri: init.uri,
    recorded_at: init.recorded_at ?? 1_000_000,
    status: init.status ?? 'REGISTERED',
  }
}

export function policy(init?: {
  workspaceRoot?: string
  strictTrackedPaths?: string[]
  zones?: { path: string; artifactTypes?: ArtifactType[] }[]
  ignored?: string[]
  gitRequired?: boolean
}): AuditPolicy {
  return {
    workspaceRoot: init?.workspaceRoot ?? '.',
    gitRequired: init?.gitRequired ?? true,
    strictTrackedPaths: init?.strictTrackedPaths ?? [],
    discoveryZones: (init?.zones ?? []).map((z) => ({
      path: z.path,
      ...(z.artifactTypes !== undefined ? { artifactTypes: z.artifactTypes } : {}),
    })),
    ignored: init?.ignored ?? [],
  }
}

/** 默认 §14.1 示例 policy（results/ 区 + src/ strict + cache/ 忽略）. */
export const DEFAULT_POLICY = policy({
  strictTrackedPaths: ['src/'],
  zones: [{ path: 'results/', artifactTypes: ['DATASET', 'FIGURE'] }],
  ignored: ['cache/'],
})

export function auditReport(
  init: Partial<
    Pick<AuditReport, 'trackedChanges' | 'diffSummary' | 'newFiles' | 'research' | 'strictTracked' | 'warnings'>
  > & { head?: AuditReport['head'] },
): AuditReport {
  return {
    head: init.head ?? { kind: 'branch', name: 'main' },
    trackedChanges: init.trackedChanges ?? [],
    diffSummary: init.diffSummary ?? [],
    newFiles: init.newFiles ?? { outsideResearch: [], insideResearch: [] },
    research:
      init.research ?? {
        trackedModified: [],
        untracked: [],
        missing: [],
        consistent: true,
      },
    strictTracked:
      init.strictTracked ?? { pathspecs: [], tracked: [], modified: [], deleted: [] },
    warnings: init.warnings ?? [],
  }
}

export function candidate(init: {
  path: string
  sizeBytes?: number | null
  zone?: string | null
  artifactTypes?: ArtifactType[]
  guessedType?: ArtifactType | null
  suggestedType?: ArtifactType
}): DiscoveryCandidate {
  return {
    path: init.path,
    sizeBytes: init.sizeBytes === undefined ? 0 : init.sizeBytes,
    zone: init.zone === undefined ? null : init.zone,
    zoneArtifactTypes: init.artifactTypes ?? [],
    guessedType: init.guessedType === undefined ? null : init.guessedType,
    suggestedType: init.suggestedType ?? 'OTHER',
  }
}

export function discoveryPolicy(init?: {
  zones?: { rawPath: string; dir: string; artifactTypes?: ArtifactType[] }[]
  ignored?: string[]
  strictTrackedGlobs?: string[]
}): DiscoveryPolicy {
  const zones = (
    init?.zones ?? [
      { rawPath: 'results/', dir: 'results', artifactTypes: ['DATASET', 'FIGURE'] },
    ]
  ).map((z) => ({ rawPath: z.rawPath, dir: z.dir, artifactTypes: z.artifactTypes ?? [] }))
  return {
    zones,
    ignored: init?.ignored ?? ['cache'],
    strictTrackedGlobs: init?.strictTrackedGlobs ?? ['src/'],
  }
}

export function discoveryReport(
  init: {
    candidates?: readonly DiscoveryCandidate[]
    firstScan?: boolean
    added?: string[]
    removed?: string[]
    unchanged?: string[]
    zoneDirMissing?: string[]
    policy?: DiscoveryPolicy
  } = {},
): DiscoveryScanReport {
  const candidates = [...(init.candidates ?? [])]
  const all = candidates.map((c) => c.path).sort()
  return {
    workspaceRoot: '/ws',
    scannedAt: 2_000_000,
    policy: init.policy ?? discoveryPolicy(),
    candidates,
    diff: {
      firstScan: init.firstScan ?? false,
      added: init.added ?? [],
      removed: init.removed ?? [],
      unchanged: init.unchanged ?? [],
    },
    zoneDirMissing: init.zoneDirMissing ?? [],
    snapshot: { v: 1, capturedAt: 2_000_000, paths: all },
  }
}

export function feed(
  candidates: DiscoveryCandidate[],
  skipped: { path: string; reason: UntrackedFeedResult['skipped'][number]['reason'] }[] = [],
): UntrackedFeedResult {
  return {
    candidates: [...candidates].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    skipped: [...skipped].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  }
}

export function declared(
  artifacts: ArtifactRow[],
  pol: AuditPolicy = DEFAULT_POLICY,
): DeclaredState {
  return {
    artifacts: new Map(artifacts.map((a) => [a.id, a])),
    policy: pol,
  }
}

export function reconcileInput(
  audit: AuditReport,
  declaredState: DeclaredState,
  opts: { discovery?: DiscoveryScanReport | null; untrackedFeed?: UntrackedFeedResult | null } = {},
): ReconcileInput {
  return {
    audit,
    discovery: opts.discovery === undefined ? null : opts.discovery,
    untrackedFeed: opts.untrackedFeed === undefined ? null : opts.untrackedFeed,
    declared: declaredState,
  }
}

/* ------------------------------------------------------------------ *
 * 全形态场景 A（5 类别全触发 + 抑制/让位规则齐备）
 * ------------------------------------------------------------------ */

/**
 * 场景 A 规格（repo root = workspace root, `.`）:
 *
 *  strict audit:
 *   - src/lib.ts       .M  tracked   → TRACKED_UNDECLARED/modified（strict 内）
 *   - src/gone.ts      D.  staged 删（∈ strictTracked.deleted）→ DECLARED_MISSING/strict-tracked
 *   - src/renamed.ts   R.  rename（orig src/old.ts）→ TRACKED_UNDECLARED/renamed（strict 内）
 *   - loose/other.md   .M            → TRACKED_UNDECLARED/modified（strict 外）
 *   - loose/del.txt    .D            → TRACKED_UNDECLARED/deleted（strict 外, 未声明）
 *   - conf/a.txt       U U unmerged  → TRACKED_UNDECLARED/unmerged
 *   - .research/plan.yaml .M         → 不发（research.trackedModified 承载）
 *   - .research/x.yaml   D. staged 删 → 不发（research.missing 承载）
 *   - newFiles.outsideResearch: results/data.csv（A-1 注册匹配 → 抑制）,
 *     results/plot.svg（未注册 zone 候选）, results/revived.csv（A-5 MISSING
 *     匹配 → 抑制, 由 RECOVERABLE 承载）, stray/note.txt（zone 外 feed）
 *   - research: trackedModified [.research/plan.yaml],
 *     untracked [.research/topics/NEW/topic.yaml],
 *     missing [.research/x.yaml]
 *
 *  discovery（fs 扫描, 非首扫）:
 *   - 候选: results/data.csv（A-1 REGISTERED 在场）, results/plot.svg
 *     （未注册）, results/revived.csv（A-5 MISSING 在场）
 *   - diff: added [results/plot.svg, results/revived.csv],
 *     removed [results/old.csv（A-2 在场缺席）], unchanged [results/data.csv]
 *
 *  feed（W4 untracked）:
 *   - 候选: stray/note.txt（zone 外 → OUT_OF_ZONE）
 *   - skipped: cache/junk.bin（IGNORED）, src/dir2/（DIRECTORY_MARKER）
 *
 *  artifacts:
 *   - A-1 results/data.csv  REGISTERED → 在场 + 已登记 → 无条目（且抑制候选）
 *   - A-2 results/old.csv   REGISTERED → diff.removed → DECLARED_MISSING/artifact（diff-removed）
 *   - A-3 results/gone.csv  REGISTERED → zone 完整扫描缺席 → DECLARED_MISSING/artifact（zone-scan-absent）
 *   - A-4 results/lost.csv  MISSING    → 缺席 + MISSING → 无条目（状态一致）
 *   - A-5 results/revived.csv MISSING  → 在场 → ARTIFACT_RECOVERABLE
 *   - A-6 http://x/y.csv    REGISTERED → 不可验证 → 无条目
 *   - A-7 /abs/z.csv        REGISTERED → 不可验证 → 无条目
 */
export function scenarioA(): ReconcileInput {
  const audit = auditReport({
    trackedChanges: [
      tc({ path: 'src/lib.ts', x: '.', y: 'M' }),
      tc({ path: 'src/gone.ts', x: 'D', y: '.' }),
      tc({ path: 'src/renamed.ts', x: 'R', y: '.', kind: 'renamed', origPath: 'src/old.ts' }),
      tc({ path: 'loose/other.md', x: '.', y: 'M' }),
      tc({ path: 'loose/del.txt', x: '.', y: 'D' }),
      tc({ path: 'conf/a.txt', x: 'U', y: 'U', kind: 'unmerged' }),
      tc({ path: '.research/plan.yaml', x: '.', y: 'M' }),
      tc({ path: '.research/x.yaml', x: 'D', y: '.' }),
    ],
    newFiles: {
      outsideResearch: ['results/data.csv', 'results/plot.svg', 'results/revived.csv', 'stray/note.txt', 'cache/junk.bin', 'src/dir2/'],
      insideResearch: ['.research/topics/NEW/topic.yaml'],
    },
    research: {
      trackedModified: ['.research/plan.yaml'],
      untracked: ['.research/topics/NEW/topic.yaml'],
      missing: ['.research/x.yaml'],
      consistent: false,
    },
    strictTracked: {
      pathspecs: ['src/'],
      tracked: ['src/lib.ts', 'src/renamed.ts', 'src/stable.ts'],
      modified: ['src/lib.ts', 'src/renamed.ts'],
      deleted: ['src/gone.ts'],
    },
  })
  const disc = discoveryReport({
    candidates: [
      candidate({ path: 'results/data.csv', sizeBytes: 10, zone: 'results', artifactTypes: ['DATASET', 'FIGURE'], guessedType: 'DATASET', suggestedType: 'DATASET' }),
      candidate({ path: 'results/plot.svg', sizeBytes: 20, zone: 'results', artifactTypes: ['DATASET', 'FIGURE'], guessedType: 'FIGURE', suggestedType: 'FIGURE' }),
      candidate({ path: 'results/revived.csv', sizeBytes: 30, zone: 'results', artifactTypes: ['DATASET', 'FIGURE'], guessedType: 'DATASET', suggestedType: 'DATASET' }),
    ],
    added: ['results/plot.svg', 'results/revived.csv'],
    removed: ['results/old.csv'],
    unchanged: ['results/data.csv'],
  })
  const fd = feed(
    [candidate({ path: 'stray/note.txt', sizeBytes: null, suggestedType: 'NOTE', guessedType: 'NOTE' })],
    [
      { path: 'cache/junk.bin', reason: 'IGNORED' },
      { path: 'src/dir2/', reason: 'DIRECTORY_MARKER' },
    ],
  )
  const dec = declared([
    artifactRow({ id: 'A-1', uri: 'results/data.csv' }),
    artifactRow({ id: 'A-2', uri: 'results/old.csv' }),
    artifactRow({ id: 'A-3', uri: 'results/gone.csv' }),
    artifactRow({ id: 'A-4', uri: 'results/lost.csv', status: 'MISSING' }),
    artifactRow({ id: 'A-5', uri: 'results/revived.csv', status: 'MISSING', workstream_id: 'WS-2' }),
    artifactRow({ id: 'A-6', uri: 'http://example.com/y.csv' }),
    artifactRow({ id: 'A-7', uri: '/abs/z.csv' }),
  ])
  return reconcileInput(audit, dec, { discovery: disc, untrackedFeed: fd })
}

/** 场景 A 的期望条目（category, subkind, path）全清单 — 排序后 13 条. */
export const SCENARIO_A_EXPECTED: readonly (readonly [string, string, string])[] = [
  ['ARTIFACT_RECOVERABLE', 'found', 'results/revived.csv'],
  ['DECLARED_MISSING', 'artifact', 'results/gone.csv'],
  ['DECLARED_MISSING', 'artifact', 'results/old.csv'],
  ['DECLARED_MISSING', 'research-tree', '.research/x.yaml'],
  ['DECLARED_MISSING', 'strict-tracked', 'src/gone.ts'],
  ['RESEARCH_UNCHECKPOINTED', 'tracked-modified', '.research/plan.yaml'],
  ['RESEARCH_UNCHECKPOINTED', 'untracked-new', '.research/topics/NEW/topic.yaml'],
  ['TRACKED_UNDECLARED', 'deleted', 'loose/del.txt'],
  ['TRACKED_UNDECLARED', 'modified', 'loose/other.md'],
  ['TRACKED_UNDECLARED', 'modified', 'src/lib.ts'],
  ['TRACKED_UNDECLARED', 'renamed', 'src/renamed.ts'],
  ['TRACKED_UNDECLARED', 'unmerged', 'conf/a.txt'],
  ['UNREGISTERED_WORKSPACE_CHANGE', 'feed', 'stray/note.txt'],
  ['UNREGISTERED_WORKSPACE_CHANGE', 'zone', 'results/plot.svg'],
]
