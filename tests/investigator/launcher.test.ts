/**
 * WP-7.1 — InvestigatorLauncher 测试（任务测试项「参数构造全形态」+
 * 一键缝的编排面）。
 *
 * 覆盖:
 *  - `buildRequest` 全形态: 完整上下文 / 最小上下文 — 闭集 4 字段逐字
 *    钉（presetId / permissionPreset = 字面量常量; cwd 透传; task =
 *    investigationTask(context) 同一真源; 产物深冻结）;
 *  - `launch` 编排: 断言 → 构造 → 断言 → 端口（假端口计数 + 入参逐字
 *    钉 — 端口恰好 1 次调用, 收到的请求 = buildRequest 产物）;
 *  - 拒因零端口调用（坏上下文 / 能力键注入 ⇒ 端口 0 次）;
 *  - 端口透传（结果原样回 / 端口错误同实例上抛 — cause 保留）;
 *  - 构造器 fail-loud（缺端口 / 端口非函数 ⇒ TypeError）;
 *  - `presetComposition` = 冻结渲染文本同一真源;
 *  - `launchFromIntervention` 组合缝（record + question + cwd 一步到底,
 *    端口入参 = buildInvestigationContext + buildRequest 全链产物）。
 */

import { describe, expect, it } from 'vitest'

import type { InterventionRecord } from '../../src/host/service/flooding/index.js'
import {
  buildInvestigationContext,
  INVESTIGATOR_PRESET_ID,
  investigationTask,
  InvestigatorLauncher,
  isInvestigatorLaunchError,
  INVESTIGATOR_PRESET_TOOL_NAMES,
  renderInvestigatorPresetComposition,
  READ_ONLY_PERMISSION_PRESET,
  type InvestigationContext,
  type InvestigatorLaunchResult,
} from '../../src/host/service/investigator/index.js'
import { captureAsync, makePort, type FakePort } from './fixtures.js'

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

function makeContext(overrides?: Partial<InvestigationContext>): InvestigationContext {
  return buildInvestigationContext(makeRecord(), '为什么 PF 在堆积?', '/ws/project')
}

describe('InvestigatorLauncher 构造器（fail-loud 组合面）', () => {
  it('缺端口 ⇒ TypeError（指名端口）', () => {
    expect(() => new InvestigatorLauncher({} as never)).toThrow(TypeError)
    expect(() => new InvestigatorLauncher({} as never)).toThrow('launchInvestigator')
  })

  it('端口非函数 ⇒ TypeError', () => {
    expect(() => new InvestigatorLauncher({ launcher: {} as never })).toThrow(TypeError)
  })

  it('合法端口 ⇒ 构造成功', () => {
    const { port } = makePort()
    expect(() => new InvestigatorLauncher({ launcher: port })).not.toThrow()
  })
})

describe('buildRequest（参数构造全形态 — 闭集 4 字段逐字钉）', () => {
  function makeLauncher(port: FakePort): InvestigatorLauncher {
    return new InvestigatorLauncher({ launcher: port.port })
  }

  it('完整上下文 ⇒ 字面量常量 + cwd 透传 + task = investigationTask 同一真源', () => {
    const fake = makePort()
    const launcher = makeLauncher(fake)
    const context = makeContext()
    const request = launcher.buildRequest(context)
    expect(request).toEqual({
      presetId: INVESTIGATOR_PRESET_ID,
      permissionPreset: READ_ONLY_PERMISSION_PRESET,
      cwd: '/ws/project',
      task: investigationTask(context),
    })
    expect(Object.keys(request).sort()).toEqual(['cwd', 'permissionPreset', 'presetId', 'task'])
    expect(Object.isFrozen(request)).toBe(true)
    // 构造面零自由度: 请求里不存在任何能力键。
    expect(request).not.toHaveProperty('sandbox')
    expect(request).not.toHaveProperty('approval')
    expect(request).not.toHaveProperty('tools')
  })

  it('最小上下文 ⇒ task 最小形态（无 Evidence 行 / none 引用）', () => {
    const port = makePort().port
    const launcher = new InvestigatorLauncher({ launcher: port })
    const context = buildInvestigationContext(
      makeRecord({ id: 'IV-1', title: 'explain', detail: undefined, workstream_ids: [], source_refs: [], origin: 'USER' }),
      '解释一下',
      '/ws',
    )
    const request = launcher.buildRequest(context)
    expect(request.cwd).toBe('/ws')
    expect(request.task).toBe(investigationTask(context))
    expect(request.task).toContain('Workstreams: none')
    expect(request.task).toContain('Source refs: none')
    expect(request.task).not.toContain('Evidence:')
  })

  it('同一上下文两次构造 ⇒ 同值（确定性 — 无时间戳/随机量混入）', () => {
    const port = makePort().port
    const launcher = new InvestigatorLauncher({ launcher: port })
    const context = makeContext()
    expect(launcher.buildRequest(context)).toEqual(launcher.buildRequest(context))
  })
})

describe('launch（编排: 断言 → 构造 → 断言 → 端口）', () => {
  it('合法上下文 ⇒ 端口恰好 1 次, 入参 = buildRequest 产物, 结果原样回', async () => {
    const fake = makePort()
    const launcher = new InvestigatorLauncher({ launcher: fake.port })
    const context = makeContext()
    const settled: InvestigatorLaunchResult = {
      sessionId: 'investigator-abc',
      presetId: INVESTIGATOR_PRESET_ID,
      permissionPreset: READ_ONLY_PERMISSION_PRESET,
      task: investigationTask(context),
    }
    fake.pushResult(settled)
    const result = await launcher.launch(context)
    expect(result).toBe(settled)
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toEqual(launcher.buildRequest(context))
  })

  it('无 roster 降级结果（presetId 键不存在）也原样回', async () => {
    const fake = makePort()
    const launcher = new InvestigatorLauncher({ launcher: fake.port })
    const settled: InvestigatorLaunchResult = {
      sessionId: 'investigator-xyz',
      permissionPreset: READ_ONLY_PERMISSION_PRESET,
      task: 't',
    }
    fake.pushResult(settled)
    const result = await launcher.launch(makeContext())
    expect(result).toBe(settled)
    expect('presetId' in result).toBe(false)
  })

  it('端口错误同实例上抛（cause 链保留 — 不重包不吞）', async () => {
    const fake = makePort()
    const launcher = new InvestigatorLauncher({ launcher: fake.port })
    const hostError = Object.assign(new Error('host exploded'), { code: 'HOST_X' })
    fake.pushError(hostError)
    const caught = await captureAsync(() => launcher.launch(makeContext()))
    expect(caught).toBe(hostError)
    expect(fake.calls).toHaveLength(1)
  })

  it('坏上下文（未知 origin）⇒ IVL_INPUT, 端口 0 次调用', async () => {
    const fake = makePort()
    const launcher = new InvestigatorLauncher({ launcher: fake.port })
    const context = makeContext()
    const bad = { ...context, origin: 'SCIENTIFIC_CONFLICT' } as unknown as InvestigationContext
    const caught = await captureAsync(() => launcher.launch(bad))
    expect(isInvestigatorLaunchError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('IVL_INPUT')
    expect(fake.calls).toHaveLength(0)
  })

  it('上下文注入能力键（tools）⇒ IVL_WRITE_CAPABILITY, 端口 0 次调用', async () => {
    const fake = makePort()
    const launcher = new InvestigatorLauncher({ launcher: fake.port })
    const bad = { ...makeContext(), tools: ['research_fact_record'] } as unknown as InvestigationContext
    const caught = await captureAsync(() => launcher.launch(bad))
    expect(isInvestigatorLaunchError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('IVL_WRITE_CAPABILITY')
    expect(fake.calls).toHaveLength(0)
  })
})

describe('presetComposition（ensure 输入 — 冻结渲染同一真源）', () => {
  it('= renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID)', () => {
    const port = makePort().port
    const launcher = new InvestigatorLauncher({ launcher: port })
    expect(launcher.presetComposition()).toBe(renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID))
  })

  it('组合行 = 闭集只读工具集（INVESTIGATOR_PRESET_TOOL_NAMES 同源）', () => {
    const port = makePort().port
    const launcher = new InvestigatorLauncher({ launcher: port })
    const text = launcher.presetComposition()
    for (const name of INVESTIGATOR_PRESET_TOOL_NAMES) {
      expect(text).toContain(`name: '${name}'`)
    }
    expect(text).not.toContain('dsh-tool-fs\'')
    expect(text).not.toContain('dsh-tool-str-replace-editor')
  })
})

describe('launchFromIntervention（组合缝 — 一步到底）', () => {
  it('record + question + cwd ⇒ 端口入参 = 全链产物（context 装配 + request 构造）', async () => {
    const fake = makePort()
    const launcher = new InvestigatorLauncher({ launcher: fake.port })
    const record = makeRecord()
    const result = await launcher.launchFromIntervention(record, '为什么 PF 在堆积?', '/ws/project')
    expect(fake.calls).toHaveLength(1)
    const expectedContext = buildInvestigationContext(record, '为什么 PF 在堆积?', '/ws/project')
    expect(fake.calls[0]).toEqual({
      presetId: INVESTIGATOR_PRESET_ID,
      permissionPreset: READ_ONLY_PERMISSION_PRESET,
      cwd: '/ws/project',
      task: investigationTask(expectedContext),
    })
    expect(result.task).toBe(investigationTask(expectedContext))
  })

  it('缝校验失败（空 question）⇒ IVL_INPUT, 端口 0 次调用', async () => {
    const fake = makePort()
    const launcher = new InvestigatorLauncher({ launcher: fake.port })
    const caught = await captureAsync(() => launcher.launchFromIntervention(makeRecord(), '  ', '/ws'))
    expect(isInvestigatorLaunchError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('IVL_INPUT')
    expect(fake.calls).toHaveLength(0)
  })
})
