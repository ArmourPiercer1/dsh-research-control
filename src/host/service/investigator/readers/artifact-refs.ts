/**
 * WP-7.2 — reader 5/5: artifact refs（计划书 §26.1 可读清单「Artifact
 * refs」— 经语义注册表）。
 *
 * 读什么（只读 — 类型面）: 注册 artifact 引用（DOMAIN_SCHEMA §7.3
 * 「Artifact = 外部资源 registry, 不是文件存储」; `uri`「path 或 URI,
 * 不复制内容」; status REGISTERED/MISSING「找回可恢复」）— 行来源 =
 * 冻结 derived_state 语义行的 `artifacts` 注册表（§5.4 事件族的 derived
 * 态, 同 WP-3.6 wiring `readSemanticState` 口径）— **全状态保留**
 * （含 MISSING — INV-HIST-7 无硬删的查询面透出）。
 *
 * 本 reader 只做范围过滤 + 投影: 不做文件存在性探测（那是 audit
 * 层的缺失判定职责 — 缺失判定只信权威信号, §22.2 机械边界; 本 reader
 * 透出注册表事实, 不猜文件态）。
 *
 * 范围语义: workstream scope = `workstream_id` 命中; topic scope =
 * 该 topic WS 集合命中; project scope = 全集。未知 scope id = RD_INPUT
 * （face 返回 `null` ⇒ 大声; face 返回 `undefined` = project-wide 不
 * 过滤 — 两种「无」语义在 face 类型面上区分, 不猜）。
 *
 * 只读边界: 本类只有 `read(scope)`; 零写方法; 零 DSH import。
 */

import type { ArtifactRow } from '../../../domain/semantics/index.js'
import {
  assertInvestigationScope,
  ReaderError,
  type ArtifactRefProjection,
  type ArtifactRefsSnapshot,
  type InvestigationScope,
} from './types.js'

/**
 * reader 5 输入面（窄 face — 生产组装见 `from-wiring.ts`; 测试注入 stub）。
 * 全部成员都是只读操作。
 */
export interface ArtifactRefsReaderInput {
  /** 语义注册表读取面（冻结 derived_state 语义行的 `artifacts` 表）。 */
  readonly readArtifacts: () => ReadonlyMap<string, ArtifactRow>
  /**
   * 范围 → 允许的 workstream 集合:
   *  - `undefined` = project-wide（不过滤）;
   *  - 数组 = 过滤集合（空数组 = 范围内无 WS — 空结果, 合法）;
   *  - `null` = 未知 scope id（⇒ 本 reader 抛 RD_INPUT）。
   */
  readonly workstreamsInScope: (scope: InvestigationScope) => string[] | null | undefined
}

export class ArtifactRefsReader {
  constructor(readonly input: ArtifactRefsReaderInput) {
    if (input === null || typeof input !== 'object' || typeof input.readArtifacts !== 'function') {
      throw new ReaderError('RD_INPUT', 'ArtifactRefsReader: input.readArtifacts (a semantic-registry face) is required')
    }
  }

  /** 读取注册 artifact 引用投影（范围过滤, 全状态保留）。失败 = `ReaderError`（RD_ARTIFACT/RD_INPUT）。 */
  read(scope: InvestigationScope): ArtifactRefsSnapshot {
    assertInvestigationScope(scope)

    let allowed: ReadonlySet<string> | null = null
    if (scope.workstreamId !== undefined) {
      allowed = new Set([scope.workstreamId])
    } else if (scope.topicId !== undefined) {
      const wsIds = safeFace(this.input.workstreamsInScope, scope)
      if (wsIds === null) {
        throw new ReaderError('RD_INPUT', `artifactRefs: topic ${scope.topicId} does not exist in the declarative tree`)
      }
      allowed = new Set(wsIds)
    }

    let rows: ReadonlyMap<string, ArtifactRow>
    try {
      rows = this.input.readArtifacts()
    } catch (cause) {
      throw new ReaderError('RD_ARTIFACT', `artifactRefs: the semantic registry face failed: ${causeMessage(cause)}`, { cause })
    }

    const artifacts: ArtifactRefProjection[] = []
    for (const row of rows.values()) {
      if (allowed !== null && !allowed.has(row.workstream_id)) continue
      artifacts.push(projectRow(row))
    }
    // 注册表顺序 = Map 插入序（事件序）; 投影稳定序 = id 升序（确定性）。
    artifacts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return { count: artifacts.length, artifacts }
  }
}

function projectRow(row: ArtifactRow): ArtifactRefProjection {
  return {
    id: row.id,
    workstreamId: row.workstream_id,
    type: row.type,
    title: row.title,
    uri: row.uri,
    status: row.status,
    relatedTask: row.related_task ?? null,
    recordedAt: row.recorded_at,
  }
}

function safeFace(face: (scope: InvestigationScope) => string[] | null | undefined, scope: InvestigationScope): string[] | null {
  try {
    const out = face(scope)
    if (out === undefined) return null
    return out
  } catch (cause) {
    throw new ReaderError('RD_ARTIFACT', `artifactRefs: the workstreamsInScope face failed: ${causeMessage(cause)}`, { cause })
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
