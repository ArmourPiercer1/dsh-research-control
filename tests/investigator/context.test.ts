/**
 * WP-7.1 — 一键启动缝测试（任务目标 3 — Gate P7 三条之三: 「能从
 * Intervention 一键启动并引用相关上下文」; 计划书 §26.1 启动来源）。
 *
 * 覆盖:
 *  - `buildInvestigationContext` 全形态: 完整记录（①-④ 引用全字段）/
 *    最小记录（无 detail / 无 WS / 无 refs — 可选键**不存在**而非空串）/
 *    question trim;
 *  - 缝校验: 空 question / 相对 cwd / 坏 id / 未知 origin / 坏 ref /
 *    空 WS id ⇒ IVL_INPUT（指名失败项）;
 *  - `investigationTask` 冻结格式（全形态 + 最小形态逐字钉 — 只读立场
 *    收尾 + 能力清单展开 `… and …`）。
 */

import { describe, expect, it } from 'vitest'

import type { InterventionRecord } from '../../src/host/service/flooding/index.js'
import {
  buildInvestigationContext,
  investigationTask,
  isInvestigatorLaunchError,
  InvestigatorLaunchError,
} from '../../src/host/service/investigator/index.js'

/** 一个完整 Intervention 记录（WP-3.5 冻结形状 1:1 — AUTO_FLOODING 面）。 */
function makeRecord(overrides?: Partial<InterventionRecord>): InterventionRecord {
  return {
    id: 'IV-7',
    title: 'Review accumulated agent plan forks [WS-2]',
    detail: 'window=300s forks=6 threshold=5',
    origin: 'AUTO_FLOODING',
    workstream_ids: ['WS-2'],
    source_refs: [{ kind: 'PLAN_FORK', id: 'PF-3' }],
    status: 'OPEN',
    created_by: { kind: 'PLUGIN', label: 'flooding-detector' },
    created_at: 1_700_000_000_000,
    ...overrides,
  }
}

/** 捕获 IVL_INPUT（同 tests/intervention 的 expectIllegal 风格）。 */
async function expectIvlInput(fn: () => unknown, needle: string): Promise<InvestigatorLaunchError> {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  if (caught === undefined || !isInvestigatorLaunchError(caught) || caught.code !== 'IVL_INPUT') {
    throw new Error(`expected IVL_INPUT matching ${JSON.stringify(needle)}, got ${caught === undefined ? 'no throw' : String(caught)}`)
  }
  if (!caught.message.includes(needle)) {
    throw new Error(`IVL_INPUT message must name ${JSON.stringify(needle)} — got: ${caught.message}`)
  }
  return caught
}

describe('buildInvestigationContext（Gate P7 三 — 引用相关上下文）', () => {
  it('完整记录 ⇒ ①-④ 引用全字段 + question trim + cwd 原样', () => {
    const context = buildInvestigationContext(makeRecord(), '  为什么 PF 在堆积?  ', '/ws/project')
    expect(context).toEqual({
      interventionId: 'IV-7',
      title: 'Review accumulated agent plan forks [WS-2]',
      detail: 'window=300s forks=6 threshold=5',
      origin: 'AUTO_FLOODING',
      workstreamIds: ['WS-2'],
      sourceRefs: [{ kind: 'PLAN_FORK', id: 'PF-3' }],
      question: '为什么 PF 在堆积?',
      cwd: '/ws/project',
    })
    // 深冻结（readonly 面 — 构造产物不可变）。
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.workstreamIds)).toBe(true)
    expect(Object.isFrozen(context.sourceRefs)).toBe(true)
  })

  it('最小记录 ⇒ 可选键不存在（detail 无键, WS/refs 空数组 — 非空串伪造）', () => {
    const context = buildInvestigationContext(
      makeRecord({ id: 'IV-1', title: 'user question', detail: undefined, workstream_ids: [], source_refs: [], origin: 'USER' }),
      '解释一下',
      '/ws',
    )
    expect('detail' in context).toBe(false)
    expect(context.workstreamIds).toEqual([])
    expect(context.sourceRefs).toEqual([])
    expect(context.origin).toBe('USER')
  })

  it('sourceRefs 逐字段拷贝（{kind,id} — 不引用原对象）', () => {
    const original = { kind: 'PLAN_FORK', id: 'PF-9', extra: 'dropped' } as const
    const context = buildInvestigationContext(makeRecord({ source_refs: [original] }), 'q', '/ws')
    expect(context.sourceRefs[0]).toEqual({ kind: 'PLAN_FORK', id: 'PF-9' })
    expect('extra' in (context.sourceRefs[0] as unknown as Record<string, unknown>)).toBe(false)
  })

  it('空 question ⇒ IVL_INPUT（指名 question）', () => {
    return expectIvlInput(() => buildInvestigationContext(makeRecord(), '   ', '/ws'), 'question')
  })

  it('相对 cwd ⇒ IVL_INPUT（指名 absolute）', () => {
    return expectIvlInput(() => buildInvestigationContext(makeRecord(), 'q', 'ws/project'), 'absolute')
  })

  it('Windows absolute cwd 被接受（跨平台 — 宿主传入的是原生路径）', () => {
    // 回归钉: 用户报障 `repoRoot must be an absolute path
    // (got "D:\Projects\AIUED")` 的同一类校验面。
    const context = buildInvestigationContext(makeRecord(), 'q', 'D:\\Projects\\AIUED')
    expect(context.cwd).toBe('D:\\Projects\\AIUED')
  })

  it('非字符串 cwd ⇒ IVL_INPUT', () => {
    return expectIvlInput(
      () => buildInvestigationContext(makeRecord(), 'q', 42 as unknown as string),
      'absolute',
    )
  })

  it.each([
    ['WS-1', 'intervention.id'],
    ['IV-x', 'intervention.id'],
    ['', 'intervention.id'],
  ])('坏 intervention id %j ⇒ IVL_INPUT', async (id, needle) => {
    await expectIvlInput(() => buildInvestigationContext(makeRecord({ id: id as string }), 'q', '/ws'), needle)
  })

  it('未知 origin ⇒ IVL_INPUT（指名 §1.4 闭集）', () => {
    return expectIvlInput(
      () => buildInvestigationContext(makeRecord({ origin: 'SCIENTIFIC_CONFLICT' as unknown as InterventionRecord['origin'] }), 'q', '/ws'),
      'origin',
    )
  })

  it('空 title ⇒ IVL_INPUT', () => {
    return expectIvlInput(() => buildInvestigationContext(makeRecord({ title: '  ' }), 'q', '/ws'), 'title')
  })

  it('空 WS id 条目 ⇒ IVL_INPUT', () => {
    return expectIvlInput(
      () => buildInvestigationContext(makeRecord({ workstream_ids: ['WS-2', ''] }), 'q', '/ws'),
      'workstream_ids',
    )
  })

  it.each([
    [{ kind: 'PLAN_FORK' }],
    [{ id: 'PF-3' }],
    ['nope'],
    [null],
  ])('坏 source ref %j ⇒ IVL_INPUT', async (ref) => {
    await expectIvlInput(
      () => buildInvestigationContext(makeRecord({ source_refs: [ref as never] }), 'q', '/ws'),
      'source_refs',
    )
  })
})

describe('investigationTask（冻结格式 — 逐字钉）', () => {
  it('全形态: 四引用行 + Evidence + 问题 + 只读立场收尾', () => {
    const context = buildInvestigationContext(
      makeRecord({ workstream_ids: ['WS-2', 'WS-9'], source_refs: [{ kind: 'PLAN_FORK', id: 'PF-3' }, { kind: 'WORKSTREAM', id: 'WS-2' }] }),
      '为什么 PF 在堆积?',
      '/ws/project',
    )
    expect(investigationTask(context)).toBe(
      'Read-only investigation of Intervention IV-7 "Review accumulated agent plan forks [WS-2]".'
      + '\nOrigin: AUTO_FLOODING'
      + '\nWorkstreams: WS-2, WS-9'
      + '\nSource refs: PLAN_FORK:PF-3, WORKSTREAM:WS-2'
      + '\nEvidence: window=300s forks=6 threshold=5'
      + '\n'
      + '\nQuestion: 为什么 PF 在堆积?'
      + '\n'
      + '\nYou are read-only. You may read-workspace-files, read-git-history and read-research-state — '
      + 'nothing else: you cannot modify the workspace, the plan, history, claims/facts, or any research state, '
      + 'and your answer is transient (only the user can save it). '
      + 'Ground every statement in the readable context (workspace files, git history/diff, plugin state, ResearchHistory).',
    )
  })

  it('最小形态: 无 Evidence 行, WS/refs = none（INV-PERM-3 收尾不变）', () => {
    const context = buildInvestigationContext(
      makeRecord({ id: 'IV-1', title: 'explain', detail: undefined, workstream_ids: [], source_refs: [], origin: 'USER' }),
      '解释一下',
      '/ws',
    )
    expect(investigationTask(context)).toBe(
      'Read-only investigation of Intervention IV-1 "explain".'
      + '\nOrigin: USER'
      + '\nWorkstreams: none'
      + '\nSource refs: none'
      + '\n'
      + '\nQuestion: 解释一下'
      + '\n'
      + '\nYou are read-only. You may read-workspace-files, read-git-history and read-research-state — '
      + 'nothing else: you cannot modify the workspace, the plan, history, claims/facts, or any research state, '
      + 'and your answer is transient (only the user can save it). '
      + 'Ground every statement in the readable context (workspace files, git history/diff, plugin state, ResearchHistory).',
    )
  })

  it('只读立场行钉死能力清单（INVESTIGATOR_CAPABILITIES 展开 — 写能力不在清单）', () => {
    const context = buildInvestigationContext(makeRecord(), 'q', '/ws')
    const task = investigationTask(context)
    expect(task).toContain('read-workspace-files, read-git-history and read-research-state')
    expect(task).toContain('you cannot modify the workspace, the plan, history, claims/facts, or any research state')
    expect(task).not.toContain('write')
  })
})
