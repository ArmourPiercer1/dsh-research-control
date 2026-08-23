/**
 * WP-6.3 — discrepancy 分类器（任务书目标 1: 纯函数, 全机械规则,
 * 无科研语义推断, §22.2 边界）。
 *
 * 输入三源（`ReconcileInput`）→ 输出 `DiscrepancyReport`。
 *
 * ## 机械判定规则（逐条, 全部冻结 — 本注释即规则规格, tests 逐条钉）
 *
 * 坐标换算（WP-6.2 缝注记: 前缀换算责任在消费方 — 本层即消费方）:
 *   - audit 全部路径 = repo-root-relative（WP-6.1 权威坐标）;
 *   - discovery/feed 候选路径 = workspace-root-relative（WP-6.2 口径）;
 *   - artifact `uri` = workspace-root-relative 路径（§7.3「path 或 URI」—
 *     可验证子集见 {@link isVerifiableUri}）;
 *   - 统一: 所有输出路径 = repo-root-relative, 换算 =
 *     `wsRoot ∈ {'.',''} ? p : wsRoot + '/' + p`（`wsRoot` = policy
 *     `workspace.root`, 归一化后）。
 *
 * 观察宇宙（repo 坐标; 「文件存在」的机械证据, 全部来自 git 权威或
 * 本轮扫描, 零自持 I/O）:
 *   - `observedCandidates` = discovery 候选 ∪ feed 候选（磁盘直证）;
 *   - `worktreePresentY`   = trackedChanges 中文件**确定**在工作树的
 *     路径（Y=M/T; 或 Y='.' 且 X∈{M,R} — 暂存修改/暂存重命名;
 *     rename 行新路径恒在; X=D/A（intent-to-add）/U 冲突态等**不确定**
 *     态不计 — 保守, 不产生假「找回」）;
 *   - `indexPresent`       = `strictTracked.tracked` ∖ worktree 删除集
 *     （Y='D' 路径 — 在 index 但已离工作树, 不算在场）;
 *   - `present(p)` = p ∈ 以上三集之并。
 *
 * 权威缺席（「文件缺失」的机械证据, 零推断）:
 *   - `strictTracked.deleted`（W13 并集, WP-6.1 两词并集权威）
 *     → signal `git-deleted`;
 *   - `research.missing`（W13 `.research/` 并集）→ signal `research-missing`;
 *   - discovery `diff.removed`（上一轮扫描见过、本轮不见 — 同扫描
 *     管线同盲区, 差分即权威）→ signal `diff-removed`;
 *   - zone-scan-absent（声明 zone 完整扫描缺席: uri ∈ 某声明 zone 子树
 *     ∧ 本轮 fs 扫描已执行 ∧ 该 zone 不在 `zoneDirMissing` ∧
 *     uri ∉ 候选集 — zone walk 对其子树穷举, WP-6.2 口径）→
 *     signal `zone-scan-absent`;
 *   - 其余 = **未观测域** → 不报缺失（false-positive 机械上不可排除时
 *     一律不报 — 保守边界, tests 钉）。
 *
 * ## 条目分配（每个输入事实恰好落一条 Discrepancy — 零重复计数）
 *
 *  - `trackedChanges`（`.research/` 外）:
 *      删除 (X=D ∨ Y=D) ∧ ∈ `strictTracked.deleted` → 不发（由 3b 发
 *      DECLARED_MISSING/strict-tracked — 同一删除事实取更具体的声明
 *      类别）; 删除 ∧ ∉ → TRACKED_UNDECLARED/deleted（inStrictTracked
 *      = false — 声明集成员已由 3b 承载）; 非删除 →
 *      TRACKED_UNDECLARED/{modified,renamed,unmerged}（`inStrictTracked`
 *      = ∈ `strictTracked.tracked ∪ deleted`; `matchedArtifactId` =
 *      注册 `uri` 精确匹配, 多匹配取最小 A id）。
 *  - `trackedChanges`（`.research/` 内）: 恒不发 — 完全由
 *    `research.{untracked,trackedModified,missing}` 一致性清单承载
 *    （WP-6.1 同 W4 权威: trackedModified = inResearch ∧ (staged ∨
 *    worktreeModified), missing = W13 两词并集）; 去重: missing 优先
 *    （同路径两清单并存时取缺失类别 — tests 钉）。
 *  - `strictTracked.deleted` 每路径 → DECLARED_MISSING/strict-tracked。
 *  - `research.missing` 每路径 → DECLARED_MISSING/research-tree。
 *  - `research.untracked` 每路径 → RESEARCH_UNCHECKPOINTED/untracked-new。
 *  - `research.trackedModified ∖ research.missing` 每路径 →
 *    RESEARCH_UNCHECKPOINTED/tracked-modified。
 *  - 候选宇宙（discovery ∪ feed, 按 repo 路径去重 — 同路径双通道时取
 *    fs 证据: subkind/sizeBytes/zone/isNew 全用 fs 侧）:
 *      ∈ 注册 `uri` 匹配（任一状态）→ 不发（REGISTERED = 已登记;
 *      MISSING = 由 ARTIFACT_RECOVERABLE 承载 — 文件在, 状态滞后, 非
 *      「未注册」）;
 *      否则 → UNREGISTERED_WORKSPACE_CHANGE（subkind zone/feed;
 *      `isNew`: fs = `!firstScan ∧ ∈ diff.added`（首扫 = 基线建立,
 *      WP-6.2 注记）, feed = 恒 true（W4 当前未跟踪态, 无基线面））。
 *  - 每个**可验证 uri** 的 artifact 行（§7.3 全状态保留, 含 MISSING）
 *    恰做一次存在性判定（存在优先于缺席信号 — 删除后重建的文件在
 *    磁盘即存在）:
 *      present ∧ MISSING → ARTIFACT_RECOVERABLE（§7.3「找回可恢复」）;
 *      present ∧ REGISTERED → 不发;
 *      absent（权威）∧ REGISTERED → DECLARED_MISSING/artifact
 *        （signal: git-deleted 优先于 diff-removed — 两信号并存取
 *        更权威源）;
 *      absent（zone-scan）∧ REGISTERED → DECLARED_MISSING/artifact
 *        （signal zone-scan-absent）;
 *      其余组合 → 不发（MISSING 且缺席 = 状态一致; 未观测 = 不报）。
 *
 * 推荐档位: 单一真源 = tiers.ts `recommendTier`（冻结映射, 见彼处
 * 注释）— 本文件只调用, 不内联第二份表。
 *
 * 确定性: 全部清单排序 + `id` 依 (category, subkind, path) 排序序
 * 分配 `RD-<n>` — 同输入逐字段同报告（无自生成时间戳; tests 钉）。
 *
 * 层规则: 只 import 类型面（type-only）+ WP-6.2 冻结机械分类表
 * （`combineTypeSignal` — 类型猜测单一真源, 本层零第二套表; 实际上
 * 候选已携带 `suggestedType`, 分类器不重算 — 该 import 仅类型面
 * `ArtifactType` 经 types 传递, 本文件无值依赖）; 零 I/O。
 */

import type { ArtifactType } from '../../domain/loader/index.js'
import type { ArtifactRow } from '../../domain/semantics/index.js'
import type { AuditReport } from '../strict/index.js'
import type { DiscoveryCandidate } from '../discovery/index.js'
import type {
  DeclaredState,
  Discrepancy,
  DiscrepancyCategory,
  DiscrepancyReport,
  ReconcileInput,
} from './types.js'
import { DISCREPANCY_CATEGORIES } from './types.js'
import { isResearchTreePath } from './constants.js'
import { recommendTier } from './tiers.js'

/* ------------------------------------------------------------------ *
 * 机械路径工具（纯函数, 冻结语义）
 * ------------------------------------------------------------------ */

/** 归一化目录记法（zone/policy 前缀匹配用）: 去 `./`/尾 `/`/空 = root。 */
function normalizeDir(p: string): string {
  let out = p
  if (out.startsWith('./')) out = out.slice(2)
  if (out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/** workspace-root-relative → repo-root-relative（`wsRoot` 归一化后）。 */
function toRepoRel(p: string, wsRoot: string): string {
  return wsRoot === '' || wsRoot === '.' ? p : `${wsRoot}/${p}`
}

/**
 * artifact `uri` 的**可验证子集**（机械判定, 零推断）: workspace-
 * relative 文件路径 — 非空、非 `.`、非绝对、无 scheme、无 `..` 段、
 * 无空段、无 `\`、非目录记法（尾 `/`）。scheme/绝对路径 = 外部资源
 * （§7.3「path 或 URI」— URI 形态存在性不可机械验证 → 不报缺失/找回）。
 */
export function isVerifiableUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri === '.') return false
  if (uri.startsWith('/') || uri.endsWith('/') || uri.includes('\\')) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) return false
  for (const seg of uri.split('/')) {
    if (seg === '' || seg === '..') return false
  }
  return true
}

/**
 * 声明 zone 的目录前缀匹配（WP-6.2 `matchZone` 同语义: 「严格位于其下」
 * — 等 zone 名的散文件不匹配; root zone（归一化 `''`）覆盖一切;
 * 声明序先胜 — 与 WP-6.2「重叠先胜」口径一致）。
 */
function zoneOfWsPath(
  pWs: string,
  zones: readonly { readonly path: string; readonly artifactTypes?: readonly ArtifactType[] }[],
): { readonly dir: string; readonly artifactTypes: readonly ArtifactType[] } | null {
  for (const zn of zones) {
    const d = normalizeDir(zn.path)
    if (d === '' || (pWs !== d && pWs.startsWith(`${d}/`))) {
      return { dir: d, artifactTypes: zn.artifactTypes ?? [] }
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 观察宇宙证据
 * ------------------------------------------------------------------ */

interface CandidateEvidence {
  readonly pathRepo: string
  readonly zone: string | null
  readonly zoneArtifactTypes: readonly ArtifactType[]
  readonly suggestedType: ArtifactType
  readonly sizeBytes: number | null
  /** fs 侧证据（同路径去重时的优先源）。 */
  readonly fromFs: boolean
  /** fs 侧 isNew（`!firstScan ∧ ∈ diff.added`）; feed 恒 true。 */
  readonly isNew: boolean
}

/** trackedChanges 条目中工作树文件**确定在场**的机械判定（保守）:
 *  Y=M/T（工作树修改/类型变更）; 或 Y='.' 且 X∈{M,R}（暂存修改/
 *  暂存重命名 — 工作树与 index 一致且 index 有内容）; rename 行
 *  新路径恒在场。X=D/A（intent-to-add 不可区分）/U 冲突态等不确定态
 *  不计（不产生假「找回」/假「在场」）。 */
function worktreeFilePresent(x: string, y: string, kind: 'tracked' | 'renamed' | 'unmerged'): boolean {
  if (kind === 'renamed') return true
  if (y === 'M' || y === 'T') return true
  if (y === '.' && (x === 'M' || x === 'R')) return true
  return false
}

/** 分发型 Omit（判别联合逐变体去 `id` — 草稿面）。 */
type Draft = Discrepancy extends infer V ? (V extends Discrepancy ? Omit<V, 'id'> : never) : never

/* ------------------------------------------------------------------ *
 * 分类器
 * ------------------------------------------------------------------ */

/**
 * discrepancy 分类（任务书目标 1）— 纯函数:
 * strict audit + discovery 差分 + `.research/` 声明态 → 结构化
 * Discrepancy 清单。全机械（module doc 逐条规则）; 确定性排序;
 * 同输入同报告; 输入零改动（readonly 契约）。
 */
export function classifyDiscrepancies(input: ReconcileInput): DiscrepancyReport {
  const { audit, declared } = input
  const discovery = input.discovery ?? null
  const feed = input.untrackedFeed ?? null
  const wsRoot = normalizeDir(declared.policy.workspaceRoot)
  const artifacts = declared.artifacts

  /* ── 1. 注册 artifact 面: 可验证 uri → repo 路径索引（多行按 A id 排序） ── */
  const rowsSorted = [...artifacts.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const uriToArtifacts = new Map<string, ArtifactRow[]>()
  for (const row of rowsSorted) {
    if (!isVerifiableUri(row.uri)) continue
    const p = toRepoRel(row.uri, wsRoot)
    const list = uriToArtifacts.get(p)
    if (list) list.push(row)
    else uriToArtifacts.set(p, [row])
  }
  const matchedArtifactIdAt = (pRepo: string): string | undefined => {
    const list = uriToArtifacts.get(pRepo)
    return list === undefined ? undefined : list[0]!.id
  }

  /* ── 2. 观察宇宙（repo 坐标; module doc「观察宇宙」） ── */
  const candidateMap = new Map<string, CandidateEvidence>()
  const putCandidate = (c: DiscoveryCandidate, fromFs: boolean, isNewFs: boolean): void => {
    const pRepo = toRepoRel(c.path, wsRoot)
    if (candidateMap.has(pRepo) && candidateMap.get(pRepo)!.fromFs) return // fs 证据优先
    candidateMap.set(pRepo, {
      pathRepo: pRepo,
      zone: c.zone,
      zoneArtifactTypes: c.zoneArtifactTypes,
      suggestedType: c.suggestedType,
      sizeBytes: c.sizeBytes,
      fromFs,
      isNew: fromFs ? isNewFs : true, // feed 无基线面 — W4 当前未跟踪态恒「新」
    })
  }
  const diffAdded = new Set(discovery === null ? [] : discovery.diff.added)
  if (discovery !== null) {
    for (const c of discovery.candidates) {
      putCandidate(c, true, !discovery.diff.firstScan && diffAdded.has(c.path))
    }
  }
  if (feed !== null) {
    for (const c of feed.candidates) putCandidate(c, false, true)
  }

  const worktreeDeletedY = new Set<string>()
  const worktreePresentY = new Set<string>()
  for (const tc of audit.trackedChanges) {
    if (tc.y === 'D') worktreeDeletedY.add(tc.path)
    if (worktreeFilePresent(tc.x, tc.y, tc.kind)) worktreePresentY.add(tc.path)
  }
  const strictTrackedSet = new Set(audit.strictTracked.tracked)
  const strictDeletedSet = new Set(audit.strictTracked.deleted)
  const researchMissingSet = new Set(audit.research.missing)
  const indexPresent = new Set([...strictTrackedSet].filter((p) => !worktreeDeletedY.has(p)))
  const diffRemoved = new Set(discovery === null ? [] : discovery.diff.removed)
  const zoneDirMissing = new Set(
    (discovery === null ? [] : discovery.zoneDirMissing).map((z) => normalizeDir(z)),
  )

  const isPresent = (pRepo: string): boolean =>
    candidateMap.has(pRepo) || worktreePresentY.has(pRepo) || indexPresent.has(pRepo)

  /* ── 3. 逐源分配条目（module doc「条目分配」逐条） ── */
  const out: Draft[] = []
  const push = (d: Draft): void => {
    out.push(d)
  }

  // 3a. trackedChanges（`.research/` 外）→ TRACKED_UNDECLARED / 让位缺失类别
  for (const tc of audit.trackedChanges) {
    if (isResearchTreePath(tc.path)) continue // `.research/` 内 = 一致性清单承载（3c/3d/3e）
    const deleted = tc.x === 'D' || tc.y === 'D'
    if (deleted) {
      if (strictDeletedSet.has(tc.path)) continue // 3b 发 DECLARED_MISSING/strict-tracked
      const t = recommendTier({ category: 'TRACKED_UNDECLARED' })
      push({
        category: 'TRACKED_UNDECLARED',
        subkind: 'deleted',
        path: tc.path,
        x: tc.x,
        y: tc.y,
        ...(tc.origPath !== undefined ? { origPath: tc.origPath } : {}),
        inStrictTracked: false,
        ...(matchedArtifactIdAt(tc.path) !== undefined
          ? { matchedArtifactId: matchedArtifactIdAt(tc.path) }
          : {}),
        recommendedTier: t.tier,
        tierReason: t.reason,
      })
      continue
    }
    const subkind = tc.kind === 'renamed' ? 'renamed' : tc.kind === 'unmerged' ? 'unmerged' : 'modified'
    const t = recommendTier({ category: 'TRACKED_UNDECLARED' })
    push({
      category: 'TRACKED_UNDECLARED',
      subkind,
      path: tc.path,
      x: tc.x,
      y: tc.y,
      ...(tc.origPath !== undefined ? { origPath: tc.origPath } : {}),
      inStrictTracked: strictTrackedSet.has(tc.path) || strictDeletedSet.has(tc.path),
      ...(matchedArtifactIdAt(tc.path) !== undefined
        ? { matchedArtifactId: matchedArtifactIdAt(tc.path) }
        : {}),
      recommendedTier: t.tier,
      tierReason: t.reason,
    })
  }

  // 3b. strictTracked.deleted → DECLARED_MISSING/strict-tracked
  for (const p of audit.strictTracked.deleted) {
    const t = recommendTier({ category: 'DECLARED_MISSING' })
    push({
      category: 'DECLARED_MISSING',
      subkind: 'strict-tracked',
      path: p,
      signal: 'git-deleted',
      recommendedTier: t.tier,
      tierReason: t.reason,
    })
  }

  // 3c. research.missing → DECLARED_MISSING/research-tree
  for (const p of audit.research.missing) {
    const t = recommendTier({ category: 'DECLARED_MISSING' })
    push({
      category: 'DECLARED_MISSING',
      subkind: 'research-tree',
      path: p,
      signal: 'research-missing',
      recommendedTier: t.tier,
      tierReason: t.reason,
    })
  }

  // 3d. research.untracked → RESEARCH_UNCHECKPOINTED/untracked-new
  for (const p of audit.research.untracked) {
    const t = recommendTier({ category: 'RESEARCH_UNCHECKPOINTED' })
    push({
      category: 'RESEARCH_UNCHECKPOINTED',
      subkind: 'untracked-new',
      path: p,
      recommendedTier: t.tier,
      tierReason: t.reason,
    })
  }

  // 3e. research.trackedModified ∖ missing → RESEARCH_UNCHECKPOINTED/tracked-modified
  for (const p of audit.research.trackedModified) {
    if (researchMissingSet.has(p)) continue // 缺失优先（module doc 去重规则）
    const t = recommendTier({ category: 'RESEARCH_UNCHECKPOINTED' })
    push({
      category: 'RESEARCH_UNCHECKPOINTED',
      subkind: 'tracked-modified',
      path: p,
      recommendedTier: t.tier,
      tierReason: t.reason,
    })
  }

  // 3f. 候选宇宙（去重后, 排序）→ UNREGISTERED_WORKSPACE_CHANGE
  const candidatesSorted = [...candidateMap.values()].sort((a, b) =>
    a.pathRepo < b.pathRepo ? -1 : a.pathRepo > b.pathRepo ? 1 : 0,
  )
  for (const c of candidatesSorted) {
    if (uriToArtifacts.has(c.pathRepo)) continue // 已声明（REGISTERED/MISSING 均非「未注册」）
    const t = recommendTier({ category: 'UNREGISTERED_WORKSPACE_CHANGE', zone: c.zone })
    push({
      category: 'UNREGISTERED_WORKSPACE_CHANGE',
      subkind: c.fromFs ? 'zone' : 'feed',
      path: c.pathRepo,
      zone: c.zone,
      zoneArtifactTypes: c.zoneArtifactTypes,
      suggestedType: c.suggestedType,
      sizeBytes: c.sizeBytes,
      isNew: c.isNew,
      recommendedTier: t.tier,
      tierReason: t.reason,
    })
  }

  // 3g. 注册 artifact 行存在性判定（module doc 3g; 每行恰一次）
  const zones = declared.policy.discoveryZones
  for (const row of rowsSorted) {
    if (!isVerifiableUri(row.uri)) continue
    const pRepo = toRepoRel(row.uri, wsRoot)
    if (isPresent(pRepo)) {
      if (row.status === 'MISSING') {
        const t = recommendTier({ category: 'ARTIFACT_RECOVERABLE' })
        push({
          category: 'ARTIFACT_RECOVERABLE',
          subkind: 'found',
          path: pRepo,
          artifactId: row.id,
          workstreamId: row.workstream_id,
          recommendedTier: t.tier,
          tierReason: t.reason,
        })
      }
      continue
    }
    if (row.status !== 'REGISTERED') continue // MISSING 且缺席 = 状态一致 — 不报
    const gitDeleted = strictDeletedSet.has(pRepo) || researchMissingSet.has(pRepo)
    if (gitDeleted || diffRemoved.has(pRepo)) {
      const t = recommendTier({ category: 'DECLARED_MISSING' })
      push({
        category: 'DECLARED_MISSING',
        subkind: 'artifact',
        path: pRepo,
        artifactId: row.id,
        workstreamId: row.workstream_id,
        signal: gitDeleted ? 'git-deleted' : 'diff-removed',
        recommendedTier: t.tier,
        tierReason: t.reason,
      })
      continue
    }
    // zone-scan-absent: 仅当本轮 fs 扫描已执行且 uri ∈ 某声明 zone 子树
    // 且该 zone 本轮存在（zoneDirMissing 不含）
    if (discovery !== null) {
      const zn = zoneOfWsPath(row.uri, zones)
      if (zn !== null && !zoneDirMissing.has(zn.dir)) {
        const t = recommendTier({ category: 'DECLARED_MISSING' })
        push({
          category: 'DECLARED_MISSING',
          subkind: 'artifact',
          path: pRepo,
          artifactId: row.id,
          workstreamId: row.workstream_id,
          signal: 'zone-scan-absent',
          recommendedTier: t.tier,
          tierReason: t.reason,
        })
      }
    }
    // 未观测域 → 不报（保守边界）
  }

  /* ── 4. 确定性排序 + id 分配 + 汇总 ── */
  const sorted: Discrepancy[] = []
  {
    const tmp = out.map((d) => ({ d, key: [d.category, d.subkind, d.path].join('\u0000') }))
    tmp.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    for (let i = 0; i < tmp.length; i++) {
      sorted.push({ ...(tmp[i]!.d as object), id: `RD-${i + 1}` } as Discrepancy)
    }
  }

  const byCategory = {} as Record<DiscrepancyCategory, number>
  for (const cat of DISCREPANCY_CATEGORIES) byCategory[cat] = 0
  for (const d of sorted) byCategory[d.category]++

  return {
    input: {
      workspaceRoot: wsRoot,
      artifactCount: artifacts.size,
      discoveryScanned: discovery !== null,
      fedUntracked: feed !== null,
      firstScan: discovery === null ? false : discovery.diff.firstScan,
    },
    discrepancies: sorted,
    byCategory,
  }
}
