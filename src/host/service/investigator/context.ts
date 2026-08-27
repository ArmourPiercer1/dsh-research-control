/**
 * WP-7.1 — 一键启动缝（Gate P7 三条之三: 「能从 Intervention 一键启动并
 * 引用相关上下文」, 计划书 Phase 7 / DSH_ADAPTER §10.2）。
 *
 * `buildInvestigationContext`: Intervention 行（WP-3.5 冻结形状, 经
 * WP-5.1 `InterventionService` 查询面取得）+ 用户问题 + workspace 根
 * → `InvestigationContext`（纯函数, 无 I/O — 调用方（未来 GUI/RPC
 * 接线 WP）负责取行与根, 本函数只做引用装配 + 前置校验）。
 *
 * `investigationTask`: 上下文 → 任务 prompt（纯渲染, 冻结格式 — tests
 * 逐字钉; prompt 只引用**可读**上下文（计划书 §26.1）, 并以只读立场
 * 收尾（INV-PERM-3: 输出 transient, 写路径不存在 — 告诉模型「你不能
 * 写」与类型面/沙箱层同一口径）。
 */

import type { TypedRef } from '../../history/registry/index.js'
import type { InterventionOrigin, InterventionRecord } from '../flooding/index.js'
import { INVESTIGATOR_CAPABILITIES, type InvestigationContext } from './types.js'
import { InvestigatorLaunchError } from './types.js'
import { isAbsolutePath } from '../../../shared/paths.js'

/**
 * 前置校验错误码归一: 缝入口的输入畸形统一 `IVL_INPUT`（模块边界参数
 * 畸形 — 同 IV_INPUT 口径）; 指名失败项进 message（fail loud, 不猜）。
 */
function badInput(what: string, value: unknown): InvestigatorLaunchError {
  return new InvestigatorLaunchError({
    code: 'IVL_INPUT',
    message: `buildInvestigationContext: ${what} is invalid: ${JSON.stringify(value)}`,
  })
}

/** `IV-<n>` 形状（DOMAIN_SCHEMA §1.1 — 与 IdAllocator 产物同形, 不跨包
 *  import 解析器: 缝只验形状, id 注册表归 shared/ids 单一来源）。 */
const IV_ID = /^IV-\d+$/u

/**
 * 从 Intervention 行构建一键启动上下文（任务目标 3）。
 *
 * @param intervention - Intervention 记录（WP-3.5 `InterventionRecord`
 *   1:1 类型 — 不复制字段面; 本函数只**读**）。
 * @param question - 用户的调查问题（trim 后非空 — 「进一步解释」的
 *   解释目标; 空问题无调查, IVL_INPUT）。
 * @param cwd - 研究工作区根（absolute — 只读沙箱的 workspace 边界;
 *   相对路径 IVL_INPUT: 沙箱边界必须是 canonical 绝对路径）。
 * @returns 冻结的 `InvestigationContext`（引用相关上下文 ①-④: id/title/
 *   detail/origin/workstreams/sourceRefs + question + cwd）。
 * @throws {@link InvestigatorLaunchError} `IVL_INPUT` — 空 question /
 *   非 absolute cwd / 坏 intervention id / 未知 origin。
 */
export function buildInvestigationContext(
  intervention: InterventionRecord,
  question: string,
  cwd: string,
): InvestigationContext {
  if (typeof question !== 'string' || question.trim() === '') {
    throw badInput('question', question)
  }
  if (!isAbsolutePath(cwd)) {
    throw badInput('cwd (must be an absolute path)', cwd)
  }
  if (typeof intervention.id !== 'string' || !IV_ID.test(intervention.id)) {
    throw badInput('intervention.id', intervention.id)
  }
  if (typeof intervention.title !== 'string' || intervention.title.trim() === '') {
    throw badInput('intervention.title', intervention.title)
  }
  if (!isInterventionOrigin(intervention.origin)) {
    throw badInput('intervention.origin (§1.4 4 值闭集)', intervention.origin)
  }
  const workstreamIds: string[] = []
  for (const ws of intervention.workstream_ids) {
    if (typeof ws !== 'string' || ws.trim() === '') {
      throw badInput('intervention.workstream_ids entry', ws)
    }
    workstreamIds.push(ws)
  }
  const sourceRefs: TypedRef[] = []
  for (const ref of intervention.source_refs) {
    if (typeof ref !== 'object' || ref === null
      || typeof (ref as { kind?: unknown }).kind !== 'string'
      || typeof (ref as { id?: unknown }).id !== 'string'
      || (ref as { kind?: unknown }).kind === ''
      || (ref as { id?: unknown }).id === '') {
      throw badInput('intervention.source_refs entry (TypedRef {kind,id})', ref)
    }
    sourceRefs.push({ kind: ref.kind, id: ref.id })
  }
  return Object.freeze({
    interventionId: intervention.id,
    title: intervention.title,
    ...intervention.detail === undefined ? {} : { detail: intervention.detail },
    origin: intervention.origin,
    workstreamIds: Object.freeze(workstreamIds),
    sourceRefs: Object.freeze(sourceRefs),
    question: question.trim(),
    cwd,
  })
}

/** §1.4 origin 4 值闭集守卫（运行面 — 类型面是 InterventionOrigin）。 */
function isInterventionOrigin(value: unknown): value is InterventionOrigin {
  return value === 'USER' || value === 'AGENT_REPORT'
    || value === 'AUTO_FLOODING' || value === 'AUTO_AUDIT'
}

/**
 * 上下文 → 任务 prompt（纯渲染 — 冻结格式, tests 逐字钉）。
 *
 * 结构: 调查对象（Intervention id/title/origin）→ 范围（workstreams /
 * source refs / detail）→ 问题 → 只读立场（INV-PERM-3 口径: 可读面 =
 * 闭集能力清单 `INVESTIGATOR_CAPABILITIES` 的展开; 写路径声明不存在 —
 * 与 preset 闭集 / restriction 黑名单 / sandbox read-only 同一事实的
 * prompt 面表述）。
 */
/**
 * 英文列举收尾（`a, b and c` — 无 Oxford comma, tests 逐字钉）.
 *
 * 不用正则替换尾逗号（V8 对 lookahead 内 `$` 锚的求值位置与 `[^,]*$`
 * 组合的行为不可依赖 — WP-7.1 第二次尝试的实证缺陷）: 显式 slice 拼接,
 * 确定性 + 无引擎差异。
 */
function andList(items: readonly string[]): string {
  if (items.length === 0) return 'nothing'
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function investigationTask(context: InvestigationContext): string {
  const workstreams = context.workstreamIds.length === 0
    ? 'none'
    : context.workstreamIds.join(', ')
  const refs = context.sourceRefs.length === 0
    ? 'none'
    : context.sourceRefs.map(ref => `${ref.kind}:${ref.id}`).join(', ')
  const lines: string[] = [
    `Read-only investigation of Intervention ${context.interventionId} "${context.title}".`,
    `Origin: ${context.origin}`,
    `Workstreams: ${workstreams}`,
    `Source refs: ${refs}`,
  ]
  if (context.detail !== undefined) {
    lines.push(`Evidence: ${context.detail}`)
  }
  lines.push(
    '',
    `Question: ${context.question}`,
    '',
    `You are read-only. You may ${andList(INVESTIGATOR_CAPABILITIES)} — `
    + 'nothing else: you cannot modify the workspace, the plan, history, claims/facts, or any research state, '
    + 'and your answer is transient (only the user can save it). '
    + 'Ground every statement in the readable context (workspace files, git history/diff, plugin state, ResearchHistory).',
  )
  return lines.join('\n')
}
