/**
 * P4 受控建议界面测试 —— 固定负例⑥（无授权零副作用 + 导出名白名单）。
 *
 * live task 侧车试运行 = N/A（2026-10-26 范围裁定，≠ PASS）：本测试面是
 * stall 形态机械可测替代面。
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as advisoryApi from './advisory.ts'
import { REVIEW_STATEMENT, deliverAdvisory, renderAdvisoryReview } from './advisory.ts'
import type { AdvisoryAuthorization, DeliveryResult, StallAdvisory } from './advisory.ts'

const advice: StallAdvisory = {
  scope: 'task/RUN-AB-A/next-step',
  subject: '标称组分析在“漂移归因”处停滞',
  stall_report: {
    blocking_reason: '候选证据不足以区分“热变形”与“机械振动”两解释',
    stalled_since: null,
    evidence: [
      { file: 'env-ab-a.jsonl', run_id: 'RUN-AB-A', seq: 3 },
      { file: 'env-ab-c.jsonl', run_id: 'RUN-AB-C', seq: 2 },
    ],
    unknowns: ['振动通道无任何同窗记录'],
  },
  candidate_next_steps: [
    { action: '补一轮振动同窗测量（deck 变量=无 vs 振动台开启）', rationale: '打破两解释的等价类', cost_note: '一次运行' },
    { action: '维持挂起并在 claim 上登记 contested 注记', rationale: '宁挂起不误升级', cost_note: null },
  ],
}

const auth = (over: Partial<AdvisoryAuthorization> = {}): AdvisoryAuthorization => ({
  granted_by: 'pi.wang', scope: 'task/RUN-AB-A', expires_at: '2026-12-31T00:00:00Z', ...over,
})

const reasonOf = (r: DeliveryResult): string => (r.delivered ? 'DELIVERED' : r.reason)

/** 目录树 sha256（相对路径 + 文件内容），零副作用判定的度量。 */
function treeSha(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d).sort()) {
      const abs = path.join(d, name)
      const rel = `${prefix}/${name}`
      if (statSync(abs).isDirectory()) walk(abs, rel)
      else h.update(`${rel}\u0000${readFileSync(abs).toString('hex')}`)
    }
  }
  walk(dir, '')
  return h.digest('hex')
}

describe('无授权 → 拒投递且零副作用（负例⑥）', () => {
  it('授权缺失/三要素任一缺/expires_at 非法 → NEEDS_AUTHORIZATION（稳定 reason 词汇）', () => {
    expect(reasonOf(deliverAdvisory(advice, {}))).toBe('NEEDS_AUTHORIZATION')
    expect(reasonOf(deliverAdvisory(advice, { authorization: undefined }))).toBe('NEEDS_AUTHORIZATION')
    const missing: AdvisoryAuthorization[] = [
      { scope: 'task/RUN-AB-A', expires_at: '2026-12-31T00:00:00Z' }, // 缺 granted_by
      { granted_by: 'pi.wang', expires_at: '2026-12-31T00:00:00Z' }, // 缺 scope
      { granted_by: 'pi.wang', scope: 'task/RUN-AB-A' }, // 缺 expires_at
      { granted_by: 'pi.wang', scope: 'task/RUN-AB-A', expires_at: '明天之前' }, // 非法格式
    ]
    for (const a of missing) expect(reasonOf(deliverAdvisory(advice, { authorization: a }))).toBe('NEEDS_AUTHORIZATION')
  })

  it('投递前后临时目录 sha256 不变（不写文件、不改状态）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'poc-p4-advisory-'))
    writeFileSync(path.join(dir, 'task.json'), '{"state":"stalled"}\n')
    writeFileSync(path.join(dir, 'fact-standing.json'), '{"status":"CANDIDATE"}\n')
    const before = treeSha(dir)
    // 无授权 ×N + 过期 + 越权：全部路径都必须零副作用。
    deliverAdvisory(advice, {})
    deliverAdvisory(advice, { authorization: { granted_by: 'x' } })
    deliverAdvisory(advice, { authorization: auth({ expires_at: '2026-01-01T00:00:00Z' }), now: '2026-11-01T00:00:00Z' })
    deliverAdvisory(advice, { authorization: auth({ scope: 'task/OTHER' }) })
    // 即便授权齐备，函数也只返回文本——同样零副作用。
    const delivered = deliverAdvisory(advice, { authorization: auth() })
    expect(delivered.delivered).toBe(true)
    expect(treeSha(dir)).toBe(before)
    expect(readFileSync(path.join(dir, 'fact-standing.json'), 'utf8')).toBe('{"status":"CANDIDATE"}\n')
  })

  it('过期 → EXPIRED；scope 不覆盖 → OUT_OF_SCOPE；scope 嵌套（task/RUN-AB-A/…）授权内放行', () => {
    expect(reasonOf(deliverAdvisory(advice, { authorization: auth({ expires_at: '2026-01-01T00:00:00Z' }), now: '2026-11-01T00:00:00Z' }))).toBe('EXPIRED')
    expect(reasonOf(deliverAdvisory(advice, { authorization: auth({ scope: 'task/OTHER-RUN' }) }))).toBe('OUT_OF_SCOPE')
    const ok = deliverAdvisory(advice, { authorization: auth(), now: '2026-11-01T00:00:00Z' })
    expect(ok.delivered).toBe(true)
  })
})

describe('有授权也只回“可审阅材料”', () => {
  it('渲染文本含固定声明段、证据锚、unknowns；side_effects=NONE；无候选时宁缺勿造', () => {
    const ok = deliverAdvisory(advice, { authorization: auth() })
    if (!ok.delivered) throw new Error('expected delivered')
    expect(ok.side_effects).toBe('NONE')
    expect(ok.review_statement).toBe(REVIEW_STATEMENT)
    expect(ok.review_rendered).toContain(REVIEW_STATEMENT)
    expect(ok.review_rendered).toContain('env-ab-a.jsonl :: RUN-AB-A#3')
    expect(ok.review_rendered).toContain('振动通道无任何同窗记录')
    const empty = deliverAdvisory({ ...advice, candidate_next_steps: [] }, { authorization: auth() })
    if (!empty.delivered) throw new Error('expected delivered')
    expect(empty.review_rendered).toContain('宁缺勿造')
    // 纯函数：renderAdvisoryReview 与 deliver 的渲染逐字节同
    expect(renderAdvisoryReview(advice)).toBe(ok.review_rendered)
  })
})

describe('导出名白名单（负例⑥后半）：面上不存在任何修改 FactStanding/Task/配置/命令的 API', () => {
  it('全部导出 = 4 个只读/纯渲染名（多一个都红）', () => {
    expect(Object.keys(advisoryApi).sort()).toEqual([
      'ADVISORY_SCHEMA',
      'REVIEW_STATEMENT',
      'deliverAdvisory',
      'renderAdvisoryReview',
    ])
  })
})
