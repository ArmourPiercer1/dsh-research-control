/**
 * src/host/audit/discovery — WP-6.2 discovery zone scanner: public face.
 *
 *   - types.ts    — the mechanical type face (candidates / policy /
 *     snapshot / diff / WP-6.1 untracked-feed seam types)
 *   - policy.ts   — §14.1 `audit` normalization + three-layer path
 *     partition (zone whitelist / ignored / strict globs)
 *   - classify.ts — mechanical type classification (frozen extension
 *     table + naming-pattern signals; NO semantic inference)
 *   - snapshot.ts — operational-KV snapshot codec + incremental diff
 *   - scan.ts     — read-only workspace walk + scan composition +
 *     untracked feed
 *   - service.ts  — `DiscoveryScanner` (operational KV persistence +
 *     error face)
 *
 * Boundary (任务书目标 4 / 计划书 §22.2 / GIT_INTEGRATION §8):
 * 只读扫描 + 机械分类 — the type face exposes NO semantic-inference
 * API; zone `artifact_types` hints are carried informationally only
 * (never fed into `suggestedType`). This layer is git-free (the
 * strict layer, WP-6.1, owns W4/W5/W13) and the only write it ever
 * performs is the snapshot persist into the operational KV.
 *
 * Consumers: WP-6.3 (discrepancy classification + reconciliation
 * consumes `DiscoveryScanReport` / `UntrackedFeedResult` and merges
 * them with the strict `AuditReport`; the `UntrackedFileRef` shape is
 * the alignment contract), and the Research Inbox
 * (`UNREGISTERED_WORKSPACE_CHANGE`, DOMAIN_SCHEMA §11 — the
 * discovery output is that entry source, 落库归 WP-6.4).
 */

export {
  DiscoveryPolicyError,
  classifyPath,
  compileGlob,
  isIgnored,
  isStrictTracked,
  matchZone,
  normalizeFeedPath,
  normalizePolicy,
  normalizePolicyPath,
} from './policy.js'
export {
  combineTypeSignal,
  EXTENSION_TYPE_TABLE,
  extractExtension,
  guessFromExtension,
  guessFromNamingPattern,
  NAMING_PATTERN_SIGNALS,
  stemOf,
  type TypeSignal,
} from './classify.js'
export {
  buildSnapshot,
  decodeSnapshot,
  DiscoverySnapshotError,
  diffSnapshots,
  encodeSnapshot,
  SNAPSHOT_KEY,
  SNAPSHOT_VERSION,
} from './snapshot.js'
export { feedUntracked, scanWorkspace, untrackedRefsFromPaths, walkWorkspaceFiles, type WalkedFile, type WalkResult } from './scan.js'
export {
  DiscoveryScanner,
  DiscoveryScannerError,
  policyFromWorkspaceDoc,
} from './service.js'
export type {
  DiscoveryCandidate,
  DiscoveryDiff,
  DiscoveryPolicy,
  DiscoveryScanReport,
  DiscoverySnapshot,
  NormalizedZone,
  PathLayer,
  UntrackedFeedResult,
  UntrackedFileRef,
  UntrackedSkipReason,
} from './types.js'
