/**
 * WP-6.3 — 冻结常量面（本地镜像, 零层逆依赖）。
 *
 * `RESEARCH_TREE_PREFIX` = git 白名单 `RESEARCH_PATHSPEC` 的同值本地
 * 镜像（`.research/`）— 本层 git-free（层规则: audit 不得 import git,
 * §2.2; 同 WP-6.2 口径）, 声明树前缀判定是纯字符串面, 同值由
 * tests 钉（`RESEARCH_PATHSPEC === RESEARCH_TREE_PREFIX`）。
 */

/** `.research/` 声明式真源目录前缀（repo-root-relative, §14 布局）。 */
export const RESEARCH_TREE_PREFIX = '.research/'

/** 路径 ∈ `.research/` 域（恰为目录记法或其内 — WP-6.1 `inResearch` 同语义）。 */
export function isResearchTreePath(p: string): boolean {
  return p === RESEARCH_TREE_PREFIX || p.startsWith(RESEARCH_TREE_PREFIX)
}
