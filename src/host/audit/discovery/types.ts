/**
 * WP-6.2 — discovery zone scanner: type face (mechanical classification
 * only, 不推断科研含义).
 *
 * Frozen contract basis (原文为准):
 *  - DOMAIN_SCHEMA §14.1 `.research/workspace.yaml` 工程默认结构 —
 *    `audit.discovery_zones`（「第二层：发现未注册 Artifact / workspace
 *    change」；`artifact_types` = 「可选：该 zone 期望的 ArtifactType
 *    （发现分类提示）」）/ `audit.ignored`（「第三层」）/
 *    `audit.strict_tracked.paths`（「关键代码 / Task deliverables /
 *    merge 相关文件 glob」，第一层）/ `workspace.root`（「相对 Git repo
 *    root」）。
 *  - 计划书 §22.1「Discovery zones — results/ docs/ figures/ selected
 *    output dirs/ … 用于发现未注册 Artifact / workspace change」；
 *    §22.2「只回答：工作区发生了哪些插件尚未登记的变化？不自动推断这些
 *    变化的科研意义」。
 *  - GIT_INTEGRATION §8（Discovery zones 行）：「文件系统扫描 +
 *    `git status` 的 untracked 标记辅助；发现未注册产物 -> Inbox
 *    （UNREGISTERED_WORKSPACE_CHANGE）」— 本层是 §11 Research Inbox
 *    `UNREGISTERED_WORKSPACE_CHANGE` 条目的上游（分类/reconciliation 归
 *    WP-6.3，Inbox 落库归 WP-6.4）。
 *
 * 三层 partition（本层 = 第二层）:
 *    第一层 strict_tracked（glob）→ WP-6.1 strict git audit（W4/W5/W13）
 *    第二层 discovery_zones（目录白名单）→ 本扫描器（文件系统只读扫描）
 *    第三层 ignored（目录前缀）→ 不扫描（GIT_INTEGRATION §8「不扫描」）
 *    本扫描器对三层做机械 partition：IGNORED 优先于 STRICT_TRACKED 优先
 *    于 ZONE（见 policy.ts `classifyPath`）；`.research/`（声明式真源，
 *    §14 布局）与 `.git/`（VCS 元数据）恒不在扫描范围。
 *
 * 类型面边界（任务书目标 4）：本模块全部 API 只做机械分类 —
 * 扩展名表 / 命名模式子串匹配 / glob 与目录前缀匹配 / 集合差分。
 * 类型面**不存在**任何接受自由文本、语义提示或推断输入的 API；
 * `suggestedType` 只可能由文件名机械信号得出（zone `artifact_types`
 * 提示永不覆盖它 — 提示以 `zoneArtifactTypes` 字段原样透出供 WP-6.3）。
 */

import type { ArtifactType } from '../../domain/loader/index.js'

/** One normalized `audit.discovery_zones` entry (§14.1). */
export interface NormalizedZone {
  /** The zone path exactly as written in `workspace.yaml` (diagnostics). */
  readonly rawPath: string
  /**
   * Normalized zone directory: workspace-root-relative POSIX, no leading
   * `/` or `./`, no trailing `/`. `''` = the workspace root itself
   * (a zone covering everything that is not `.research/`/ignored).
   * Glob characters are NOT interpreted — zones are directory
   * whitelists (§22.1「目录」白名单原文), `*`/`?` match literally.
   */
  readonly dir: string
  /**
   * The zone's expected ArtifactTypes (§14.1「发现分类提示」), `[]` = no
   * hint. Informational ONLY — never fed into `suggestedType`.
   */
  readonly artifactTypes: readonly ArtifactType[]
}

/**
 * The normalized audit policy (schema defaults materialized, mirroring
 * the loader's ajv `useDefaults` face): a missing `audit` block means
 * `{ zones: [], ignored: [], strictTrackedGlobs: [] }` — an empty
 * policy scans nothing (zones is the whitelist).
 */
export interface DiscoveryPolicy {
  readonly zones: readonly NormalizedZone[]
  /** Normalized `audit.ignored` directory prefixes (third layer, 不扫描). */
  readonly ignored: readonly string[]
  /**
   * `audit.strict_tracked.paths` globs verbatim (first layer — WP-6.1's
   * jurisdiction; the discovery layer EXCLUDES their matches so the two
   * layers never double-report a path to WP-6.3).
   */
  readonly strictTrackedGlobs: readonly string[]
}

/** Where one path lands in the three-layer partition (policy.ts). */
export type PathLayer = 'IGNORED' | 'STRICT_TRACKED' | 'ZONE' | 'OUT_OF_SCOPE'

/**
 * One artifact candidate: a file under a discovery zone that is neither
 * ignored nor strict-tracked. `path` = workspace-root-relative POSIX.
 * All type fields are mechanical (extension table / naming pattern);
 * nothing here interprets research meaning (§22.2 边界).
 */
export interface DiscoveryCandidate {
  /** Workspace-root-relative POSIX path (e.g. `results/run_7/plot.svg`). */
  readonly path: string
  /**
   * `lstat` size in bytes for filesystem-scan candidates; `null` for
   * audit-feed candidates (the feed is mechanical and never stats —
   * WP-6.3 may measure if it needs to).
   */
  readonly sizeBytes: number | null
  /** The matching normalized zone dir, or `null` (audit feed only: an
   *  untracked path outside every zone is still classified — 6.3
   *  partitions on this field; filesystem scans never emit `null`). */
  readonly zone: string | null
  /**
   * The matched zone's `artifact_types` hint (§14.1) — `[]` when the
   * zone has no hint or the path is outside zones. Informational only
   * (see module doc: the hint never overrides the mechanical guess).
   */
  readonly zoneArtifactTypes: readonly ArtifactType[]
  /**
   * Extension-table guess only (`classify.ts` frozen table); `null` =
   * the table has no entry for this extension (or the file has none).
   */
  readonly guessedType: ArtifactType | null
  /**
   * The mechanical classification result: extension table first, then
   * frozen naming-pattern substring signals, else `OTHER`. Never null,
   * never semantic — the only type a consumer may display as a guess.
   */
  readonly suggestedType: ArtifactType
}

/**
 * Incremental diff vs the previous scan snapshot (operational KV):
 * `added` / `removed` / `unchanged` over candidate PATHS (set
 * difference, path-level only — content is out of scope, Git owns file
 * versioning per 计划书 §22.3「插件不实现自己的文件历史系统」).
 */
export interface DiscoveryDiff {
  /** `true` when no previous snapshot existed (first scan: every current
   *  candidate is `added`, `removed` is empty — 6.3 may treat a first
   *  scan as baseline establishment rather than N fresh events). */
  readonly firstScan: boolean
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly unchanged: readonly string[]
}

/**
 * The scan snapshot persisted to operational KV (the `meta` table,
 * §15 — the plugin's operational KV face). Path set only (the diff is
 * path-level); `capturedAt` = epoch ms of the scan that produced it.
 */
export interface DiscoverySnapshot {
  /** Snapshot format version (1 = V1). Decoders reject other versions. */
  readonly v: 1
  readonly capturedAt: number
  /** Sorted, de-duplicated candidate paths of the scan that made it. */
  readonly paths: readonly string[]
}

/** The full report of one filesystem scan (service.ts composes + persists). */
export interface DiscoveryScanReport {
  /** The absolute workspace root that was scanned (echo, diagnostics). */
  readonly workspaceRoot: string
  /** Epoch ms (injected `now` — deterministic under test). */
  readonly scannedAt: number
  /** The normalized policy in effect (echo — auditability). */
  readonly policy: DiscoveryPolicy
  /** All candidates, sorted by path (byte-wise). */
  readonly candidates: readonly DiscoveryCandidate[]
  /** Diff vs the previous snapshot (operational KV). */
  readonly diff: DiscoveryDiff
  /**
   * Normalized zone dirs that exist neither as a directory at the
   * workspace root (missing, or occupied by a file) — mechanical
   * diagnostics for 6.3/UI, never an error (an empty zone is just
   * empty).
   */
  readonly zoneDirMissing: readonly string[]
  /** The snapshot this scan produces (persisted by the service on success). */
  readonly snapshot: DiscoverySnapshot
}

/**
 * WP-6.1 seam (任务书目标 3「接口对齐，6.3 消费」): one entry of the
 * strict audit's untracked list — mechanically the W4
 * `git status --porcelain=v2` `??` lines (GIT_INTEGRATION §3/§8
 * 「untracked 标记辅助」).
 *
 * In-tree alignment (WP-6.1, `src/host/audit/strict` — landed in the
 * same tree): the producer list is
 * `AuditReport.newFiles.outsideResearch: string[]` — workspace change
 * candidates OUTSIDE `.research/` (their types.ts: 「外层是 WP-6.2
 * discovery 的输入」), REPO-root-relative (GIT_INTEGRATION §3 前缀换算:
 * when `workspace.root` ≠ repo root, the CONSUMER strips the prefix
 * before feeding — the plugin is responsible for that conversion), and
 * in git's untracked notation where a wholly-new directory appears as
 * one `dir/` entry, UNEXPANDED (「展开归 WP-6.2 fs 扫描」).
 *
 * Feed INPUT contract (normalized — 6.3 aligns field-for-field against
 * THIS shape):
 *   - `path` = workspace-root-relative POSIX, git quote/percent-encoding
 *     already decoded by the producer; a `dir/` entry keeps its marker
 *     (see `UntrackedSkipReason.DIRECTORY_MARKER` — expansion is the
 *     filesystem scan's job, the feed stays fs-free);
 *   - `status` = the raw porcelain status verbatim (diagnostic only —
 *     the feed NEVER branches on it); producers that only carry paths
 *     (WP-6.1's `string[]`) use the `untrackedRefsFromPaths` adapter.
 */
export interface UntrackedFileRef {
  readonly path: string
  readonly status?: string
}

/** Why a fed untracked entry did NOT become a candidate (auditable skip). */
export type UntrackedSkipReason =
  | 'RESEARCH_TREE' // under `.research/` — declarative source (§14), never discovery material
  | 'VCS_METADATA' // under `.git/`
  | 'DIRECTORY_MARKER' // git untracked `dir/` notation — unexpanded; its contents are the fs scan's job (WP-6.1: 「展开归 WP-6.2 fs 扫描」)
  | 'IGNORED' // third layer (不扫描)
  | 'STRICT_TRACKED' // first layer — WP-6.1 already reports it
  | 'BAD_PATH' // empty / absolute / `..` segment / empty after `./` strip

/**
 * Result of feeding an AuditReport untracked list (pure — no fs, no KV):
 * every input entry lands in exactly one of `candidates` (classified,
 * zone attribution recorded — `zone: null` for out-of-zone paths) and
 * `skipped` (reasoned), both sorted by path. Deterministic.
 */
export interface UntrackedFeedResult {
  readonly candidates: readonly DiscoveryCandidate[]
  readonly skipped: readonly { readonly path: string; readonly reason: UntrackedSkipReason }[]
}
