/**
 * V3 PoC · P4 —— 受控建议界面（stall 形态）：无授权 = 零副作用。
 *
 * 范围裁定（2026-10-26 用户裁定，写死）：PoC 素材 =「合成 + 真实 GPT 运行」
 * （strk-05/06 信封）。#10 P4 的「脱敏真实任务四组人工标注 A/B」与
 * 「**live task 侧车试运行**」= 素材不存在 → **N/A（范围裁定）≠ PASS**；
 * 本文件是 stall 形态的机械可测替代面：建议只以「可审阅材料」出场，
 * 不存在任何写入/执行渠道。
 *
 * 硬纪律（导出名白名单测试锁死）：
 *  1. 授权三要素 `granted_by` / `scope` / `expires_at` 缺任一 →
 *     `{delivered:false, reason:'NEEDS_AUTHORIZATION'}`；过期 → 'EXPIRED'；
 *     advice.scope 不在授权 scope 内 → 'OUT_OF_SCOPE'。
 *  2. **零副作用**：本模块不 import node:fs / node:child_process / 网络模块，
 *     不写文件、不改状态、不触碰 FactStanding/Task/配置/命令——函数面上
 *     **不存在任何**修改 FactStanding/Task/配置/命令的 API；时间由调用方以
 *     参数 `now`（RFC3339 字符串）注入，模块内无 Date.now / 随机（确定性）。
 *  3. 通过授权后也只返回渲染后的**可审阅文本**（含固定声明段：仅供人阅览、
 *     不注入主 Agent 指令、未经审查不得转正式 Fact/Task/Obligation——
 *     与 P3 renderReportMarkdown 同一隔离渠道语义）。
 */
import { stableId } from './semantics.ts'
import type { SourceRef } from './semantics.ts'

export const ADVISORY_SCHEMA = 'poc/advisory/v0'

/** 固定声明段（与 P3 报告面同一隔离渠道语义，恒在场）。 */
export const REVIEW_STATEMENT =
  '仅供人阅览；不注入主 Agent 指令；未经审查不得转正式 Fact/Task/Obligation。'

export interface AdvisoryAuthorization {
  granted_by?: string
  scope?: string
  expires_at?: string
  [extra: string]: unknown
}

/** stall 形态建议：卡点报告 + 候选下一步（全部只是「材料」，无执行语义）。 */
export interface StallAdvisory {
  advice_id?: string
  schema?: string
  /** 建议适用 scope（如 'task/RUN-AB-A/next-step'）；须在授权 scope 内。 */
  scope: string
  subject: string
  stall_report: {
    blocking_reason: string
    stalled_since: string | null
    evidence: SourceRef[]
    unknowns: string[]
  }
  candidate_next_steps: { action: string; rationale: string; cost_note: string | null }[]
}

export interface DeliverContext {
  authorization?: AdvisoryAuthorization
  /** 判定过期用时钟：调用方注入（RFC3339）；缺省 = 不判过期（无时钟可判，
   *  不等于放行过期件之外的任何副作用——本函数本来就没有副作用面）。 */
  now?: string
}

export type DeliveryResult =
  | { delivered: false; reason: 'NEEDS_AUTHORIZATION' | 'EXPIRED' | 'OUT_OF_SCOPE'; advisory_id: string }
  | {
      delivered: true
      advisory_id: string
      review_rendered: string
      review_statement: typeof REVIEW_STATEMENT
      side_effects: 'NONE'
    }

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/

function adviceIdOf(advice: StallAdvisory): string {
  return isNonEmpty(advice.advice_id) ? advice.advice_id : `ADV-${stableId({ scope: advice.scope, subject: advice.subject })}`
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** scope 包含判定：'x' 授权覆盖 'x' 与 'x/…'；'*' 覆盖一切（显式通配）。 */
function scopeCovers(granted: string, requested: string): boolean {
  if (granted === '*') return true
  return requested === granted || requested.startsWith(`${granted}/`)
}

/**
 * 纯渲染：候选材料 → 可审阅文本（无授权也**不可**调用出 delivered 面，
 * 但函数本身只产字符串，无副作用可言）。
 */
export function renderAdvisoryReview(advice: StallAdvisory): string {
  const id = adviceIdOf(advice)
  const lines: string[] = []
  lines.push(`# 受控建议（stall 形态） ${id}`)
  lines.push(`subject: ${advice.subject}`)
  lines.push(`scope: ${advice.scope}`)
  lines.push('')
  lines.push('## 卡点报告')
  lines.push(`- 阻塞原因：${advice.stall_report.blocking_reason}`)
  lines.push(`- 卡自：${advice.stall_report.stalled_since ?? 'UNKNOWN'}`)
  lines.push(`- 证据锚：${advice.stall_report.evidence.length === 0 ? '无（缺证据即缺证据）' : ''}`)
  for (const ev of [...advice.stall_report.evidence].sort((a, b) =>
    a.file === b.file ? (a.run_id === b.run_id ? a.seq - b.seq : a.run_id < b.run_id ? -1 : 1) : a.file < b.file ? -1 : 1)) {
    lines.push(`  - ${ev.file} :: ${ev.run_id}#${ev.seq}`)
  }
  lines.push(`- unknowns：${advice.stall_report.unknowns.length === 0 ? '（空）' : advice.stall_report.unknowns.join('；')}`)
  lines.push('')
  lines.push('## 候选下一步（全部待人工审查，无任何自动执行语义）')
  if (advice.candidate_next_steps.length === 0) lines.push('- （无候选——宁缺勿造）')
  for (const s of advice.candidate_next_steps) {
    lines.push(`- ${s.action}`)
    lines.push(`  - 理由：${s.rationale}`)
    lines.push(`  - 成本注记：${s.cost_note ?? 'UNKNOWN'}`)
  }
  lines.push('')
  lines.push(`> ${REVIEW_STATEMENT}`)
  return lines.join('\n')
}

/**
 * 受控投递：授权不全 / 过期 / 越权 → delivered:false + 稳定 reason，且
 * **零副作用**（本模块无 fs/进程/网络 import，目录 sha 前后必同——测试锁死）；
 * 授权齐备 → 仅回渲染文本。
 */
export function deliverAdvisory(advice: StallAdvisory, ctx: DeliverContext): DeliveryResult {
  const advisory_id = adviceIdOf(advice)
  const auth = ctx.authorization
  if (
    auth === undefined ||
    !isNonEmpty(auth.granted_by) ||
    !isNonEmpty(auth.scope) ||
    !isNonEmpty(auth.expires_at) ||
    !RFC3339_RE.test(auth.expires_at)
  ) {
    return { delivered: false, reason: 'NEEDS_AUTHORIZATION', advisory_id }
  }
  if (!scopeCovers(auth.scope, advice.scope)) {
    return { delivered: false, reason: 'OUT_OF_SCOPE', advisory_id }
  }
  if (isNonEmpty(ctx.now) && RFC3339_RE.test(ctx.now)) {
    const expiresMs = Date.parse(auth.expires_at)
    const nowMs = Date.parse(ctx.now)
    if (!Number.isNaN(expiresMs) && !Number.isNaN(nowMs) && expiresMs < nowMs) {
      return { delivered: false, reason: 'EXPIRED', advisory_id }
    }
  }
  return {
    delivered: true,
    advisory_id,
    review_rendered: renderAdvisoryReview(advice),
    review_statement: REVIEW_STATEMENT,
    side_effects: 'NONE',
  }
}
