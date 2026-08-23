/**
 * WP-7.4 / G7 S1 — analysis 数据面命令（host 半）测试。
 *
 * 覆盖:
 *  - 共享线形单源（`shared/analysis-command.ts` — host 解析 / client
 *    构建共用）: 三条命令行构建 + 全失败形态（空白 sessionId / 坏保存
 *    载荷 — 未知键 / 坏 sourceRef / 空 content / 空串可选字段）+ 解析
 *    往返（单行 JSON 载荷 — 与 build 同一形状源）;
 *  - transient-read handler（结构假 wiring — 真 HostWiring 类型面,
 *    零 DSH）: 成功（read 恰 1 次 + camelCase 投影逐字 — 三 null 面
 *    诚实透出 / cwd-title-taskId-intent null 合并）/ 空白 rawInput ⇒
 *    语法 error 零读取 / `AN_*` 结构化映射 / 意外错误 `[AN_CHANNEL]`
 *    兜底;
 *  - analysis-list handler: 行 → DTO 数组逐字（snake→camel + 可选字段
 *    null 合并）/ 空列表 `[]` / `AN_*` 映射;
 *  - analysis-save handler: 成功（保存恰 1 次, 入参 = 线形 DTO → 宿主
 *    参数投影逐字, **actor = USER_ACTOR** 〔kind 'USER' 钉 — INV-
 *    PERM-3 用户门的通道层〕, 产物 = 保存记录 DTO JSON）/ 全零写入面
 *    （空白 / 非 JSON / 形状偏离 ⇒ error 结果 + 零保存调用）/ `AN_*`
 *    映射（AN_INPUT 冻结网拒 / AN_ACTOR_FORBIDDEN 用户门拒 — 逐字）;
 *  - 注册面: 三命令名/描述/hint 逐字钉（保存命令 `recordInput: false`
 *    — 载荷含用户分析全文, 会话日志不重复携带 — 持久面是插件 DB 不可
 *    变记录）+ 单一 disposer 回滚三条; 无命令注册表部署 ⇒ null。
 */

import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_LIST_COMMAND_NAME,
  ANALYSIS_SAVE_COMMAND_NAME,
  ANALYSIS_TRANSIENT_READ_COMMAND_NAME,
  analysisCommandGrammar,
  buildAnalysisListLine,
  buildAnalysisSaveLine,
  buildTransientReadLine,
  isSavePayloadShapeError,
  parseAnalysisSaveInput,
  parseTransientReadInput,
  type SaveAnalysisRecordArgs,
} from '../src/shared/analysis-command.js'
import {
  makeAnalysisListHandler,
  makeAnalysisSaveHandler,
  makeTransientReadHandler,
  registerAnalysisCommands,
} from '../src/host/dsh-adapter/host/analysis-commands.js'
// The registrar face lives in the investigation command module（the
// shared registration seam both command modules use — the type's home）.
import type { CommandRegistrarLike } from '../src/host/dsh-adapter/host/investigate-command.js'
import { AnalysisError, USER_ACTOR } from '../src/host/service/analysis/index.js'
import type {
  AnalysisRecordRecord,
  AnalysisTransientSnapshot,
  SaveAnalysisRecordParams,
} from '../src/host/service/analysis/index.js'
import type { HostWiring } from '../src/host/service/wiring/index.js'

/* ------------------------------------------------------------------ *
 * 结构假 wiring（真 HostWiring 类型面 — 只切三个 handler 消费的面）
 * ------------------------------------------------------------------ */

interface FakeWiring {
  readonly readCalls: string[]
  readonly saveCalls: Array<{ params: SaveAnalysisRecordParams; actor: { readonly kind: string } }>
  snapshot?: AnalysisTransientSnapshot
  readError?: Error
  rows?: AnalysisRecordRecord[]
  listError?: Error
  savedRecord?: AnalysisRecordRecord
  saveError?: Error
}

function makeRecord(overrides: Partial<AnalysisRecordRecord> = {}): AnalysisRecordRecord {
  return {
    id: 'AN-1',
    source_ref: { kind: 'INTERVENTION', id: 'IV-1' },
    content: '分析内容 A',
    created_at: 1_700_000_001_000,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<AnalysisTransientSnapshot> = {}): AnalysisTransientSnapshot {
  return {
    sessionId: 'investigator-live-1',
    session: null,
    pointer: null,
    run: null,
    ...overrides,
  }
}

function makeWiringFake(overrides: Partial<FakeWiring> = {}): { wiring: HostWiring; fake: FakeWiring } {
  const fake: FakeWiring = {
    readCalls: [],
    saveCalls: [],
    ...overrides,
  }
  const wiring = {
    analysisTransient: {
      read: (sessionId: string): AnalysisTransientSnapshot => {
        fake.readCalls.push(sessionId)
        if (fake.readError !== undefined) throw fake.readError
        return fake.snapshot ?? makeSnapshot()
      },
    },
    analysisService: {
      listAnalysisRecords: (): readonly AnalysisRecordRecord[] => {
        if (fake.listError !== undefined) throw fake.listError
        return fake.rows ?? []
      },
      saveAsAnalysisRecord: (params: SaveAnalysisRecordParams, actor: { readonly kind: string }):
        { readonly record: AnalysisRecordRecord } => {
        fake.saveCalls.push({ params, actor })
        if (fake.saveError !== undefined) throw fake.saveError
        return { record: fake.savedRecord ?? makeRecord() }
      },
    },
  } as unknown as HostWiring
  return { wiring, fake }
}

describe('共享 analysis 线形单源（宿主解析 / 客户端构建）', () => {
  it('build: 三条命令行逐字（命令名单源 — 语法表含三者）', () => {
    expect(buildTransientReadLine('investigator-abc-123')).toBe(
      `/${ANALYSIS_TRANSIENT_READ_COMMAND_NAME} investigator-abc-123`,
    )
    expect(buildAnalysisListLine()).toBe(`/${ANALYSIS_LIST_COMMAND_NAME}`)
    const line = buildAnalysisSaveLine({ sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: '内容' })
    expect(line).toBe(`/${ANALYSIS_SAVE_COMMAND_NAME} ${JSON.stringify({ sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: '内容' })}`)
    for (const name of [
      ANALYSIS_TRANSIENT_READ_COMMAND_NAME,
      ANALYSIS_LIST_COMMAND_NAME,
      ANALYSIS_SAVE_COMMAND_NAME,
    ]) {
      expect(analysisCommandGrammar).toContain(name)
    }
  })

  it('build: 空白 sessionId ⇒ throw（通道永不提交无目标读取）', () => {
    expect(() => buildTransientReadLine('')).toThrow(/non-blank/)
    expect(() => buildTransientReadLine('   ')).toThrow(/non-blank/)
  })

  it('build/parse: 保存载荷往返（单行 JSON — 与构建同一形状源）', () => {
    const args: SaveAnalysisRecordArgs = {
      sourceRef: { kind: 'INBOX_ITEM', id: 'IN-7' },
      content: '多行\nMarkdown 内容',
      investigatorRunId: 'R-81',
      dshSessionId: 'investigator-live-1',
    }
    const line = buildAnalysisSaveLine(args)
    // 单行性: 载荷内换行被 JSON 转义, 命令行无裸换行。
    expect(line.split('\n')).toHaveLength(1)
    const parsed = parseAnalysisSaveInput(line.slice(`/${ANALYSIS_SAVE_COMMAND_NAME} `.length))
    expect(parsed).toEqual(args)
  })

  it('parse: 全失败形态（非 JSON / 数组 ⇒ null; 形状偏离 ⇒ 逐字原因 throw — 两级失败面）', () => {
    expect(parseAnalysisSaveInput('')).toBeNull()
    expect(parseAnalysisSaveInput('not-json')).toBeNull()
    expect(parseAnalysisSaveInput('[1,2]')).toBeNull()
    const shapeError = (raw: unknown, needle: string): void => {
      let caught: unknown
      try {
        parseAnalysisSaveInput(JSON.stringify(raw))
      } catch (e) {
        caught = e
      }
      expect(isSavePayloadShapeError(caught)).toBe(true)
      if (isSavePayloadShapeError(caught)) {
        expect(caught.message).toContain(needle)
      }
    }
    shapeError({ sourceRef: { kind: 'X', id: 'IV-1' }, content: 'c', extra: 1 }, 'unknown key "extra"')
    shapeError({ sourceRef: { kind: 'X' }, content: 'c' }, 'exactly {id, kind}')
    shapeError({ sourceRef: { kind: 'X', id: 'IV-1', extra: 1 }, content: 'c' }, 'exactly {id, kind}')
    shapeError({ sourceRef: 'IV-1', content: 'c' }, 'plain {kind, id} object')
    shapeError({ sourceRef: { kind: '', id: 'IV-1' }, content: 'c' }, 'sourceRef.kind')
    shapeError({ sourceRef: { kind: 'X', id: '' }, content: 'c' }, 'sourceRef.id')
    shapeError({ sourceRef: { kind: 'X', id: 'IV-1' }, content: '   ' }, 'content')
    shapeError({ sourceRef: { kind: 'X', id: 'IV-1' }, content: 'c', investigatorRunId: '  ' }, 'investigatorRunId')
    shapeError({ sourceRef: { kind: 'X', id: 'IV-1' }, content: 'c', dshSessionId: '  ' }, 'dshSessionId')
  })

  it('parse: 可选字段缺省不携带（不虚构 — undefined 而非空串）', () => {
    const parsed = parseAnalysisSaveInput(JSON.stringify({ sourceRef: { kind: 'X', id: 'IV-1' }, content: 'c' }))
    expect(parsed).toEqual({ sourceRef: { kind: 'X', id: 'IV-1' }, content: 'c' })
    expect(Object.keys(parsed as object)).toEqual(['sourceRef', 'content'])
  })

  it('形状门错误面: build 面 throw（GUI 第二道防线）+ 判别器可收窄', () => {
    let caught: unknown
    try {
      buildAnalysisSaveLine({ sourceRef: { kind: '', id: 'IV-1' }, content: 'c' } as SaveAnalysisRecordArgs)
    } catch (e) {
      caught = e
    }
    expect(isSavePayloadShapeError(caught)).toBe(true)
    if (isSavePayloadShapeError(caught)) {
      expect(caught.message).toContain('sourceRef.kind')
    }
    expect(isSavePayloadShapeError(new Error('x'))).toBe(false)
  })

  it('parseTransientReadInput: 合法 / 空白全形态', () => {
    expect(parseTransientReadInput('investigator-a  ')).toBe('investigator-a')
    expect(parseTransientReadInput('')).toBeNull()
    expect(parseTransientReadInput('   ')).toBeNull()
  })
})

describe('transient-read 命令 handler（真链 — 结构假 wiring）', () => {
  it('成功: read 恰 1 次 + 全 null 快照逐字（缺席诚实透出, 不虚构）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeTransientReadHandler(wiring)
    const result = await handler({ rawInput: 'investigator-live-1' })
    expect(fake.readCalls).toEqual(['investigator-live-1'])
    expect(result).toEqual({
      kind: 'success',
      text: JSON.stringify({
        sessionId: 'investigator-live-1',
        session: null,
        pointer: null,
        run: null,
      }),
    })
  })

  it('成功: 全字段快照 → camelCase 投影逐字（null 合并 + 字段名 snake→camel）', async () => {
    const { wiring } = makeWiringFake({
      snapshot: makeSnapshot({
        session: { id: 'investigator-live-1', blank: false, running: false, createdAt: 1_700_000_000_000 },
        pointer: { workstreamId: 'WS-1', lastSeq: 9, runId: null, runStartedAt: null },
        run: { id: 'R-5', workstreamId: 'WS-1', status: 'FINISHED', startedAt: 1_700_000_000_000, endedAt: 1_700_000_001_000 },
      }),
    })
    const handler = makeTransientReadHandler(wiring)
    const result = await handler({ rawInput: 'investigator-live-1' })
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      // String() = the file-wide parse idiom（a success WITHOUT text would
      // fail loud here — 'undefined' is not valid JSON）.
      const parsed = JSON.parse(String(result.text)) as Record<string, unknown>
      expect(parsed.session).toEqual({
        id: 'investigator-live-1',
        cwd: null,
        title: null,
        running: false,
        createdAt: 1_700_000_000_000,
      })
      expect(parsed.pointer).toEqual({
        workstreamId: 'WS-1',
        taskId: null,
        intent: null,
        lastSeq: 9,
        runId: null,
        runStartedAt: null,
      })
      expect(parsed.run).toEqual({
        id: 'R-5',
        workstreamId: 'WS-1',
        status: 'FINISHED',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_001_000,
      })
    }
  })

  it('成功: 可选字段在位时透传（cwd/title/taskId/intent 非空 = 原值）', async () => {
    const { wiring } = makeWiringFake({
      snapshot: makeSnapshot({
        session: {
          id: 's-1',
          blank: false,
          cwd: '/ws/project',
          title: '调查会话',
          running: true,
          createdAt: 1,
        },
        pointer: {
          workstreamId: 'WS-2',
          taskId: 'T-3',
          intent: 'RESEARCH',
          lastSeq: 4,
          runId: 'R-9',
          runStartedAt: 5,
        },
      }),
    })
    const handler = makeTransientReadHandler(wiring)
    const result = await handler({ rawInput: 's-1' })
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      const parsed = JSON.parse(String(result.text)) as Record<string, unknown>
      expect(parsed.session).toEqual({ id: 's-1', cwd: '/ws/project', title: '调查会话', running: true, createdAt: 1 })
      expect(parsed.pointer).toEqual({ workstreamId: 'WS-2', taskId: 'T-3', intent: 'RESEARCH', lastSeq: 4, runId: 'R-9', runStartedAt: 5 })
    }
  })

  it('空白 rawInput ⇒ 语法 error 结果 + 零读取（不触端口）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeTransientReadHandler(wiring)
    const result = await handler({ rawInput: '   ' })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain(ANALYSIS_TRANSIENT_READ_COMMAND_NAME)
      expect(result.text).toContain(analysisCommandGrammar)
    }
    expect(fake.readCalls).toHaveLength(0)
  })

  it('AN_ 结构化错误映射: [code] message 逐字', async () => {
    const { wiring } = makeWiringFake({
      readError: new AnalysisError({ code: 'AN_STORE', message: 'pointerOf failed: db locked' }),
    })
    const handler = makeTransientReadHandler(wiring)
    const result = await handler({ rawInput: 's-1' })
    expect(result).toEqual({ kind: 'error', text: '[AN_STORE] pointerOf failed: db locked' })
  })

  it('意外错误兜底映射: [AN_CHANNEL] + 消息（不裸抛）', async () => {
    const { wiring } = makeWiringFake({ readError: new Error('socket exploded') })
    const handler = makeTransientReadHandler(wiring)
    const result = await handler({ rawInput: 's-1' })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain('[AN_CHANNEL]')
      expect(result.text).toContain('socket exploded')
    }
  })
})

describe('analysis-list 命令 handler（真链 — 结构假 wiring）', () => {
  it('成功: 行 → DTO 数组逐字（snake→camel + 可选字段 null 合并）', async () => {
    const { wiring } = makeWiringFake({
      rows: [
        makeRecord(),
        makeRecord({
          id: 'AN-2',
          source_ref: { kind: 'INBOX_ITEM', id: 'IN-3' },
          investigator_run_id: 'R-7',
          dsh_session_id: 'investigator-live-9',
          content: '内容 B',
          created_at: 1_700_000_002_000,
        }),
      ],
    })
    const handler = makeAnalysisListHandler(wiring)
    const result = await handler({ rawInput: '' })
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(JSON.parse(String(result.text))).toEqual([
        {
          id: 'AN-1',
          sourceRef: { kind: 'INTERVENTION', id: 'IV-1' },
          investigatorRunId: null,
          dshSessionId: null,
          content: '分析内容 A',
          createdAt: 1_700_000_001_000,
        },
        {
          id: 'AN-2',
          sourceRef: { kind: 'INBOX_ITEM', id: 'IN-3' },
          investigatorRunId: 'R-7',
          dshSessionId: 'investigator-live-9',
          content: '内容 B',
          createdAt: 1_700_000_002_000,
        },
      ])
    }
  })

  it('空列表 ⇒ `[]`（诚实空态, 非 null/缺省）', async () => {
    const { wiring } = makeWiringFake({ rows: [] })
    const handler = makeAnalysisListHandler(wiring)
    const result = await handler({ rawInput: '' })
    expect(result).toEqual({ kind: 'success', text: '[]' })
  })

  it('AN_ 结构化错误映射: [code] message 逐字', async () => {
    const { wiring } = makeWiringFake({
      listError: new AnalysisError({ code: 'AN_STORE', message: 'list failed: no such table' }),
    })
    const handler = makeAnalysisListHandler(wiring)
    const result = await handler({ rawInput: '' })
    expect(result).toEqual({ kind: 'error', text: '[AN_STORE] list failed: no such table' })
  })
})

describe('analysis-save 命令 handler（真链 — 结构假 wiring, INV-PERM-3 用户门通道层）', () => {
  it('成功: 保存恰 1 次 + 入参投影逐字 + actor = USER_ACTOR + 产物 DTO JSON', async () => {
    const { wiring, fake } = makeWiringFake({
      savedRecord: makeRecord({ investigator_run_id: 'R-81', dsh_session_id: 'investigator-live-1' }),
    })
    const handler = makeAnalysisSaveHandler(wiring)
    const payload = JSON.stringify({
      sourceRef: { kind: 'INTERVENTION', id: 'IV-2' },
      content: '保存的分析',
      investigatorRunId: 'R-81',
      dshSessionId: 'investigator-live-1',
    })
    const result = await handler({ rawInput: payload })
    expect(fake.saveCalls).toHaveLength(1)
    expect(fake.saveCalls[0]?.params).toEqual({
      sourceRef: { kind: 'INTERVENTION', id: 'IV-2' },
      content: '保存的分析',
      investigatorRunId: 'R-81',
      dshSessionId: 'investigator-live-1',
    })
    // INV-PERM-3 用户门通道层: 宿主收到的 actor 必须是 USER（通道只经
    // 用户显式提交 — 插件不自调, 模型无命令面; 宿主 assertUserActor 是
    // 第二道保险, 本处钉第一道的入参）。
    expect(fake.saveCalls[0]?.actor).toEqual({ kind: 'USER', label: 'user' })
    expect(result).toEqual({
      kind: 'success',
      text: JSON.stringify({
        id: 'AN-1',
        sourceRef: { kind: 'INTERVENTION', id: 'IV-1' },
        investigatorRunId: 'R-81',
        dshSessionId: 'investigator-live-1',
        content: '分析内容 A',
        createdAt: 1_700_000_001_000,
      }),
    })
  })

  it('成功: 可选字段缺省 ⇒ 参数不携带（undefined — 不虚构空串）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeAnalysisSaveHandler(wiring)
    const result = await handler({ rawInput: JSON.stringify({ sourceRef: { kind: 'BRIEF', id: 'TOPIC-1' }, content: 'c' }) })
    expect(result.kind).toBe('success')
    expect(fake.saveCalls).toHaveLength(1)
    const params = fake.saveCalls[0]?.params
    expect(params).toEqual({ sourceRef: { kind: 'BRIEF', id: 'TOPIC-1' }, content: 'c' })
    expect('investigatorRunId' in (params ?? {})).toBe(false)
    expect('dshSessionId' in (params ?? {})).toBe(false)
  })

  it('空白 rawInput ⇒ 语法 error + 零保存（零写入）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeAnalysisSaveHandler(wiring)
    const result = await handler({ rawInput: '   ' })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain(ANALYSIS_SAVE_COMMAND_NAME)
      expect(result.text).toContain(analysisCommandGrammar)
    }
    expect(fake.saveCalls).toHaveLength(0)
  })

  it('非 JSON ⇒ 语法 error + 零保存（零写入）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeAnalysisSaveHandler(wiring)
    const result = await handler({ rawInput: '这不是 JSON' })
    expect(result.kind).toBe('error')
    expect(fake.saveCalls).toHaveLength(0)
  })

  it('形状偏离（未知键）⇒ 逐字原因 error + 零保存（线形门先于宿主）', async () => {
    const { wiring, fake } = makeWiringFake()
    const handler = makeAnalysisSaveHandler(wiring)
    const result = await handler({ rawInput: JSON.stringify({ sourceRef: { kind: 'X', id: 'IV-1' }, content: 'c', evil: true }) })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain('unknown key "evil"')
    }
    expect(fake.saveCalls).toHaveLength(0)
  })

  it('AN_INPUT 映射（冻结网拒 — kind 不在 24 值闭集）: [code] message 逐字', async () => {
    const { wiring, fake } = makeWiringFake({
      saveError: new AnalysisError({
        code: 'AN_INPUT',
        message: 'saveAsAnalysisRecord.sourceRef.kind "BOGUS" is not a member of the frozen 24-kind ObjectKind registry',
      }),
    })
    const handler = makeAnalysisSaveHandler(wiring)
    const result = await handler({ rawInput: JSON.stringify({ sourceRef: { kind: 'BOGUS', id: 'IV-1' }, content: 'c' }) })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain('[AN_INPUT]')
      expect(result.text).toContain('24-kind ObjectKind registry')
    }
    expect(fake.saveCalls).toHaveLength(1) // 参数已交宿主 — 拒绝发生在宿主门内（零写入由宿主钉）
  })

  it('AN_ACTOR_FORBIDDEN 映射（用户门拒 — 伪造 actor 面）: [code] message 逐字', async () => {
    const { wiring } = makeWiringFake({
      saveError: new AnalysisError({
        code: 'AN_ACTOR_FORBIDDEN',
        message: 'saveAsAnalysisRecord: only USER actors may save an AnalysisRecord (INV-PERM-3)',
      }),
    })
    const handler = makeAnalysisSaveHandler(wiring)
    const result = await handler({ rawInput: JSON.stringify({ sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: 'c' }) })
    expect(result).toEqual({
      kind: 'error',
      text: '[AN_ACTOR_FORBIDDEN] saveAsAnalysisRecord: only USER actors may save an AnalysisRecord (INV-PERM-3)',
    })
  })
})

describe('analysis 命令注册面', () => {
  it('注册: 三命令名/描述/hint 逐字钉（保存命令 recordInput:false）+ 单一 disposer 回滚三条', () => {
    const registrations: Array<{ name: string; description: string; input?: { hint: string }; recordInput?: boolean }> = []
    let disposed = 0
    const registrar: CommandRegistrarLike = {
      register: (def) => {
        registrations.push({ name: def.name, description: def.description, input: def.input, recordInput: def.recordInput })
        return () => {
          disposed += 1
        }
      },
    }
    const ctx = { get: (name: string) => (name === 'commands' ? registrar : undefined) } as never
    const { wiring } = makeWiringFake()
    const dispose = registerAnalysisCommands(ctx, wiring)
    expect(dispose).not.toBeNull()
    expect(registrations).toEqual([
      {
        name: 'research-transient-read',
        description: '读取一个 investigator 会话的 transient 分析快照（只读 — 零 operational 表写入; 参数: 会话 id）',
        input: { hint: '<会话id>' },
        recordInput: undefined,
      },
      {
        name: 'research-analysis-list',
        description: '列出本项目已保存的 AnalysisRecord（用户显式保存的不可变记录 — createdAt 升序）',
        input: undefined,
        recordInput: undefined,
      },
      {
        name: 'research-analysis-save',
        description: '将一次 investigator 分析显式保存为 AnalysisRecord（仅用户操作落盘 — INV-PERM-3; 参数: 单行 JSON 载荷）',
        input: { hint: '<单行JSON载荷>' },
        recordInput: false,
      },
    ])
    dispose!()
    expect(disposed).toBe(3)
  })

  it('无命令注册表（非 web profile）⇒ null（调用方大声点名, 不静默降级）', () => {
    const ctx = { get: () => undefined } as never
    const { wiring } = makeWiringFake()
    expect(registerAnalysisCommands(ctx, wiring)).toBeNull()
  })

  it('USER_ACTOR 单源: 通道面与宿主面同一常量（kind USER + label user）', () => {
    expect(USER_ACTOR).toEqual({ kind: 'USER', label: 'user' })
  })
})
