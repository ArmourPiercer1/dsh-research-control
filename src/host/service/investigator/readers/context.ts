/**
 * WP-7.2 — 组装器（主线目标 2）: `investigationContext(topicOrWs)` →
 * 五类 readers 聚合（计划书 §26.1 只读 Investigator 的上下文数据面）。
 *
 * 聚合纪律:
 *  - **逐段隔离**: 每类 reader 独立 try/catch — 单类失败降级为**结构化
 *    失败段**（`ok: false` + 机器码 + 消息, cause 消息大声透出）, 其余
 *    四类照常产出; 失败绝不静默省略（段在, 错误在 — 同 WP-6.4
 *    fail-loud 纪律）;
 *  - **零缓存 / 零写**: 每次调用全部 fresh 读取（文件即真值, §8 低频
 *    unary 面口径）; 聚合本身不落盘 — 默认 transient（§26.2; AnalysisRecord
 *    显式保存归 WP-7.3）;
 *  - **范围透传**: scope 原样传给五类 reader（各自语义见各模块头 —
 *    git diff 为 workspace 级事实, 不按 scope 过滤, 见 git-diff 模块头）;
 *  - 同步段与异步段: pluginState / sessions / artifactRefs 是同步 face,
 *    gitDiff / gitLog 是异步 git 面 — 组装器整体 async（git 面先行
 *    并发, 同步段随后 — 全部完成后出聚合）。
 */

import type {
  ArtifactRefsSnapshot,
  GitDiffSnapshot,
  GitLogSnapshot,
  InvestigationContext,
  InvestigationScope,
  PluginStateSnapshot,
  ReaderSection,
  SessionQuerySnapshot,
} from './types.js'

/**
 * 五类 reader 的聚合输入面（结构端口 — 生产组装见 `from-wiring.ts`;
 * 测试注入 stub 读者）。
 */
export interface InvestigationReaders {
  readonly pluginState: { readonly read: (scope: InvestigationScope) => PluginStateSnapshot }
  readonly sessions: { readonly read: (scope: InvestigationScope) => SessionQuerySnapshot }
  readonly gitDiff: { readonly read: (scope: InvestigationScope) => Promise<GitDiffSnapshot> }
  readonly gitLog: { readonly read: (scope: InvestigationScope) => Promise<GitLogSnapshot> }
  readonly artifactRefs: { readonly read: (scope: InvestigationScope) => ArtifactRefsSnapshot }
}

/** 每段失败的兜底机器码（reader 自带码优先 — isReaderError 时原样透传）。 */
const FALLBACK_CODE: Readonly<Record<string, string>> = {
  pluginState: 'RD_STATE',
  sessions: 'RD_SESSION',
  gitDiff: 'RD_GIT_DIFF',
  gitLog: 'RD_GIT_LOG',
  artifactRefs: 'RD_ARTIFACT',
}

function failureOf(section: keyof typeof FALLBACK_CODE, cause: unknown): ReaderSection<never> {
  const code = isReaderErrorCode(cause) ?? FALLBACK_CODE[section]!
  const message = cause instanceof Error ? cause.message : String(cause)
  return { ok: false, error: { code, message } } as ReaderSection<never>
}

/** 从 cause 提取稳定机器码（reader 结构化错误 = 其 code; 其余 = undefined）。 */
function isReaderErrorCode(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== 'object') return undefined
  const code = (cause as { code?: unknown }).code
  return typeof code === 'string' && /^RD_[A-Z_]+$/.test(code) ? code : undefined
}

/**
 * 组装一个调查上下文（主线目标 2 的入口函数）。
 *
 * @param scope topic | workstream | 双缺（project-wide）— 见
 *   {@link InvestigationScope}。
 * @param readers 五类读者（结构端口 — 生产 = `createWiringReaders`）。
 * @param now 生成时钟（缺省 `Date.now` — A-3 epoch ms）。
 * @returns 五段聚合（每段 ok/data 或 ok:false/error — 类型面封闭）。
 */
export async function investigationContext(
  scope: InvestigationScope,
  readers: InvestigationReaders,
  now: () => number = () => Date.now(),
): Promise<InvestigationContext> {
  // git 两段先行并发（唯一异步面 — 同步段在聚合时读取, 互不阻塞）。
  const [gitDiff, gitLog] = await Promise.all([
    sectionPromise(readers.gitDiff, scope, 'gitDiff'),
    sectionPromise(readers.gitLog, scope, 'gitLog'),
  ])

  let pluginState: ReaderSection<PluginStateSnapshot>
  try {
    pluginState = { ok: true, data: readers.pluginState.read(scope) }
  } catch (cause) {
    pluginState = failureOf('pluginState', cause) as ReaderSection<PluginStateSnapshot>
  }

  let sessions: ReaderSection<SessionQuerySnapshot>
  try {
    sessions = { ok: true, data: readers.sessions.read(scope) }
  } catch (cause) {
    sessions = failureOf('sessions', cause) as ReaderSection<SessionQuerySnapshot>
  }

  let artifactRefs: ReaderSection<ArtifactRefsSnapshot>
  try {
    artifactRefs = { ok: true, data: readers.artifactRefs.read(scope) }
  } catch (cause) {
    artifactRefs = failureOf('artifactRefs', cause) as ReaderSection<ArtifactRefsSnapshot>
  }

  return {
    generatedAt: now(),
    scope: { ...scope },
    pluginState,
    sessions,
    gitDiff,
    gitLog,
    artifactRefs,
  }
}

async function sectionPromise<T>(
  reader: { readonly read: (scope: InvestigationScope) => Promise<T> },
  scope: InvestigationScope,
  section: 'gitDiff' | 'gitLog',
): Promise<ReaderSection<T>> {
  try {
    return { ok: true, data: await reader.read(scope) }
  } catch (cause) {
    return failureOf(section, cause) as ReaderSection<T>
  }
}
