/**
 * WP-7.4 / G7 S1b — 一键调查命令（host 半）测试。
 *
 * 覆盖:
 *  - 共享语法单源: buildInvestigationCommandLine / parseInvestigationInput
 *    往返 + 全失败形态（坏 id / 空问题 / 空白折叠）;
 *  - 成功文本单源: INVESTIGATION_SUCCESS_TEXT 构造 + parseInvestigation-
 *    SessionId 回解（被启动会话 id — GUI 调查员页绑定面）;
 *  - handler 全链（结构假 wiring — 真 HostWiring 类型面, 零 DSH）:
 *    成功（launch 恰好 1 次, 入参 = record + question + repoRoot 逐字）/
 *    语法错（error 结果带语法提示）/ intervention 不存在 / IVL_ 结构化
 *    错误映射（code 逐字透出）/ 意外错误兜底映射;
 *  - 注册面: 命令名/描述/hint 逐字钉 + disposer 回传; 无命令注册表
 *    部署（非 web profile）⇒ null（调用方大声点名, 不静默降级）。
 */

import { describe, expect, it } from 'vitest'

import {
  INVESTIGATION_COMMAND_NAME,
  INVESTIGATION_SUCCESS_TEXT,
  buildInvestigationCommandLine,
  investigationCommandGrammar,
  parseInvestigationInput,
  parseInvestigationSessionId,
} from '../src/shared/investigation-command.js'
import {
  makeInvestigationCommandHandler,
  registerInvestigationCommand,
  type CommandRegistrarLike,
} from '../src/host/dsh-adapter/host/investigate-command.js'
import { InvestigatorLaunchError } from '../src/host/service/investigator/index.js'
import type { HostWiring } from '../src/host/service/wiring/index.js'
import type { InterventionRecord } from '../src/host/service/flooding/index.js'

function makeRecord(id: string): InterventionRecord {
  return {
    id,
    title: `matter ${id}`,
    detail: 'd',
    origin: 'AUTO_FLOODING',
    workstream_ids: ['WS-1'],
    source_refs: [],
    status: 'OPEN',
    created_by: { kind: 'PLUGIN', label: 'x' },
    created_at: 1_700_000_000_000,
  }
}

/** 结构假 wiring（真 HostWiring 类型面 — 只切 handler 消费的三面）。 */
interface FakeWiring {
  readonly records: Map<string, InterventionRecord>
  readonly launchCalls: Array<{ record: InterventionRecord; question: string; cwd: string }>
  launchResult?: { sessionId: string }
  launchError?: Error
}

function makeWiringFake(overrides: Partial<FakeWiring> = {}): { wiring: HostWiring; fake: FakeWiring } {
  const fake: FakeWiring = {
    records: new Map([[ 'IV-1', makeRecord('IV-1') ], [ 'IV-7', makeRecord('IV-7') ]]),
    launchCalls: [],
    ...overrides,
  }
  const wiring = {
    repoRoot: '/ws/project',
    interventions: {
      getIntervention: (id: string) => fake.records.get(id) ?? null,
    },
    investigator: {
      launchFromIntervention: async (record: InterventionRecord, question: string, cwd: string) => {
        fake.launchCalls.push({ record, question, cwd })
        if (fake.launchError !== undefined) throw fake.launchError
        return {
          sessionId: fake.launchResult?.sessionId ?? 'investigator-live-1',
          permissionPreset: 'read-only' as const,
          task: 'task',
        }
      },
    },
  } as unknown as HostWiring
  return { wiring, fake }
}

describe('共享一键调查语法（单源 — 宿主解析 / 客户端构建）', () => {
  it('build: 合法行逐字 + 命令名/hint 单源', () => {
    expect(buildInvestigationCommandLine('IV-1', '为什么 PF 在堆积?')).toBe(
      `/${INVESTIGATION_COMMAND_NAME} IV-1 为什么 PF 在堆积?`,
    )
    expect(investigationCommandGrammar).toBe(`${INVESTIGATION_COMMAND_NAME} IV-<n> <调查问题>`)
  })

  it('build: 内部空白折叠为单空格（单行载包归一化）', () => {
    expect(buildInvestigationCommandLine('IV-2', '  为什么   PF\n在堆积? ')).toBe(
      `/${INVESTIGATION_COMMAND_NAME} IV-2 为什么 PF 在堆积?`,
    )
  })

  it('build: 坏 id / 空问题 ⇒ fail loud（通道永不提交不可解析行）', () => {
    expect(() => buildInvestigationCommandLine('IV-0', 'q')).toThrow(/IV-/)
    expect(() => buildInvestigationCommandLine('BOGUS-1', 'q')).toThrow(/intervention id/)
    expect(() => buildInvestigationCommandLine('IV-1', '   ')).toThrow(/non-blank/)
  })

  it('parse: 合法 rawInput 往返（与 build 同一真源）', () => {
    const line = buildInvestigationCommandLine('IV-7', '检查 contract 漂移')
    const parsed = parseInvestigationInput(line.slice(`/${INVESTIGATION_COMMAND_NAME} `.length))
    expect(parsed).toEqual({ interventionId: 'IV-7', question: '检查 contract 漂移' })
  })

  it('parse: 全失败形态（空 / 坏 id / 缺问题 / 多空格折叠）', () => {
    expect(parseInvestigationInput('')).toBeNull()
    expect(parseInvestigationInput('   ')).toBeNull()
    expect(parseInvestigationInput('BOGUS-1 问题')).toBeNull()
    expect(parseInvestigationInput('IV-0 问题')).toBeNull()
    expect(parseInvestigationInput('IV-1')).toBeNull() // 缺问题
    expect(parseInvestigationInput('IV-1   ')).toBeNull() // 只有空白问题
    expect(parseInvestigationInput('IV-1  为什么   PF 在堆积?  ')).toEqual({
      interventionId: 'IV-1',
      question: '为什么 PF 在堆积?',
    })
  })

  it('成功文本单源: 构造 + 被启动会话 id 回解', () => {
    const text = INVESTIGATION_SUCCESS_TEXT('investigator-abc-123')
    expect(text).toContain('investigator-abc-123')
    expect(parseInvestigationSessionId(text)).toBe('investigator-abc-123')
    expect(parseInvestigationSessionId('无关文本')).toBeNull()
    expect(parseInvestigationSessionId('会话 （空 id 不成立）')).toBeNull()
  })
})

describe('一键调查命令 handler（真链 — 结构假 wiring）', () => {
  it('成功: launch 恰好 1 次, 入参 = record + question + repoRoot 逐字', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeInvestigationCommandHandler(wiring)
    const result = await handler({ rawInput: 'IV-1 为什么 PF 在堆积?' })
    expect(result).toEqual({ kind: 'success', text: INVESTIGATION_SUCCESS_TEXT('investigator-live-1') })
    expect(fake.launchCalls).toHaveLength(1)
    expect(fake.launchCalls[0]?.record.id).toBe('IV-1')
    expect(fake.launchCalls[0]?.question).toBe('为什么 PF 在堆积?')
    expect(fake.launchCalls[0]?.cwd).toBe('/ws/project')
  })

  it('语法错: error 结果带语法提示（不触达 launch 端口）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeInvestigationCommandHandler(wiring)
    const result = await handler({ rawInput: '这不是一个 IV id' })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain(investigationCommandGrammar)
      expect(result.text).toContain(`/${INVESTIGATION_COMMAND_NAME} IV-1`)
    }
    expect(fake.launchCalls).toHaveLength(0)
  })

  it('intervention 不存在: error 结果点名 id（查 store 真源, 无 client echo）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeInvestigationCommandHandler(wiring)
    const result = await handler({ rawInput: 'IV-99 问题' })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.text).toContain('IV-99')
    expect(fake.launchCalls).toHaveLength(0)
  })

  it('IVL_ 结构化错误映射: code 逐字透出（[code] message）', async () => {
    const { wiring } = makeWiringFake({
      launchError: new InvestigatorLaunchError({
        code: 'IVL_PERMISSION',
        message: '/permission read-only 未注册 — 无只读化不降级启动',
      }),
    })
    const handler = makeInvestigationCommandHandler(wiring)
    const result = await handler({ rawInput: 'IV-1 q' })
    expect(result).toEqual({
      kind: 'error',
      text: '[IVL_PERMISSION] /permission read-only 未注册 — 无只读化不降级启动',
    })
  })

  it('意外错误兜底映射: [IVL_LAUNCH] + 消息（无裸错泄露）', async () => {
    const { wiring } = makeWiringFake({ launchError: new Error('socket exploded') })
    const handler = makeInvestigationCommandHandler(wiring)
    const result = await handler({ rawInput: 'IV-1 q' })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain('[IVL_LAUNCH]')
      expect(result.text).toContain('socket exploded')
    }
  })
})

describe('一键调查命令注册面', () => {
  it('注册: 命令名/描述/hint 逐字钉 + disposer 回传', () => {
    const registrations: Array<{ name: string; description: string; input?: { hint: string } }> = []
    let disposed = 0
    const registrar: CommandRegistrarLike = {
      register: (def) => {
        registrations.push({ name: def.name, description: def.description, input: def.input })
        return () => {
          disposed += 1
        }
      },
    }
    const ctx = { get: (name: string) => (name === 'commands' ? registrar : undefined) } as never
    const { wiring } = makeWiringFake()
    const dispose = registerInvestigationCommand(ctx, wiring)
    expect(dispose).not.toBeNull()
    expect(registrations).toEqual([
      {
        name: 'research-investigate',
        description: '对一个 Intervention 启动只读 Investigator 调查（transient 输出; 参数: IV-<n> <调查问题>）',
        input: { hint: 'IV-<n> <调查问题>' },
      },
    ])
    dispose!()
    expect(disposed).toBe(1)
  })

  it('无命令注册表（非 web profile）⇒ null（调用方大声点名, 不静默降级）', () => {
    const ctx = { get: () => undefined } as never
    const { wiring } = makeWiringFake()
    expect(registerInvestigationCommand(ctx, wiring)).toBeNull()
  })
})
