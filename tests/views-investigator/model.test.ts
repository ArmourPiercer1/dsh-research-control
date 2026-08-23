/**
 * WP-7.3 — investigator 视图纯投影层审计（零 I/O — 同 inbox-model 测试
 * 纪律）:
 *
 *  - selectTransientRows 缺席态矩阵（null 数据 / 三行齐 / 会话缺席 /
 *    指针缺席 / run 缺席 — 诚实透出, headline 三态）;
 *  - run 状态词表（§1.4 4 值 + 未知值原样透出）;
 *  - sourceRef kind 标签（§12.2 三类来源 + 未知原样）;
 *  - 时间格式化（null = '—'）;
 *  - initialSaveFieldValues 预填矩阵（sourceRef 在场/缺席; run 在场/缺席;
 *    dshSessionId = launcher 会话指针）;
 *  - canConfirmSave 确认门（content 必填 / sourceRef.id 形态 / run id
 *    可选形态门 — 边界值逐一）;
 *  - buildSavePayload 载荷组装（trim / 空选值不携带 — 不虚构 / 可选字段
 *    在场携带）;
 *  - selectSavedRecordRows（badge 投影 + 预览截断 120 字符 + 稳定顺序）。
 */

import { describe, expect, it } from 'vitest'

import {
  OBJECT_KINDS,
  RUN_STATUS_LABEL,
  SOURCE_REF_KIND_LABEL,
  TYPED_REF_ID_PATTERN,
  RUN_ID_PATTERN,
  buildSavePayload,
  canConfirmSave,
  formatAnalysisTime,
  initialSaveFieldValues,
  selectSavedRecordRows,
  selectTransientRows,
  type SaveDialogFieldValues,
} from '../../src/client/views/investigator/investigator-model.js'
import type { AnalysisRecordDto, TransientPointerDto, TransientRunDto, TransientSessionDto } from '../../src/client/stores/analysis-slice.js'

const T0 = 1_700_000_000_000

function session(overrides: Partial<TransientSessionDto> = {}): TransientSessionDto {
  return { id: 'investigator-x', cwd: '/w', title: 't', running: false, createdAt: T0, ...overrides }
}

function pointer(overrides: Partial<TransientPointerDto> = {}): TransientPointerDto {
  return { workstreamId: 'WS-1', taskId: null, intent: null, lastSeq: 3, runId: null, runStartedAt: null, ...overrides }
}

function run(overrides: Partial<TransientRunDto> = {}): TransientRunDto {
  return { id: 'R-81', workstreamId: 'WS-1', status: 'RUNNING', startedAt: T0, endedAt: null, ...overrides }
}

describe('selectTransientRows（缺席态矩阵 — 诚实透出）', () => {
  it('null 数据 ⇒ 全 null 行 + 「无数据」headline', () => {
    const rows = selectTransientRows(null)
    expect(rows).toEqual({ session: null, pointer: null, run: null, runStatusLabel: null, headline: '无数据' })
  })

  it('三行齐 + 会话运行中 ⇒ 「运行中」headline + run 状态标签', () => {
    const rows = selectTransientRows({ session: session({ running: true }), pointer: pointer(), run: run({ status: 'FINISHED', endedAt: T0 + 1 }) })
    expect(rows.headline).toBe('investigator 会话运行中')
    expect(rows.runStatusLabel).toBe('已完成')
    expect(rows.session?.running).toBe(true)
  })

  it('会话缺席（已 dispose）⇒ 「不在 live 列表」headline — 指针/run 独立在场', () => {
    const rows = selectTransientRows({ session: null, pointer: pointer(), run: run() })
    expect(rows.headline).toBe('会话已不在 live 列表（可能已 dispose）')
    expect(rows.pointer?.workstreamId).toBe('WS-1')
    expect(rows.run?.id).toBe('R-81')
  })

  it('会话空闲 ⇒ 「空闲」headline', () => {
    const rows = selectTransientRows({ session: session({ running: false }), pointer: null, run: null })
    expect(rows.headline).toBe('investigator 会话空闲')
    expect(rows.pointer).toBeNull()
    expect(rows.run).toBeNull()
  })

  it('未知 run 状态原样透出（不虚构标签）', () => {
    const rows = selectTransientRows({ session: session(), pointer: null, run: run({ status: 'WEIRD_STATE' }) })
    expect(rows.runStatusLabel).toBe('WEIRD_STATE')
  })
})

describe('词表', () => {
  it('RUN_STATUS_LABEL 4 值（§1.4 RunStatus 逐字）', () => {
    expect(RUN_STATUS_LABEL).toEqual({ RUNNING: '运行中', FINISHED: '已完成', FAILED: '失败', CANCELLED: '已取消' })
  })

  it('SOURCE_REF_KIND_LABEL 含 §12.2 三类来源（Intervention / Audit finding / Brief）', () => {
    expect(SOURCE_REF_KIND_LABEL.INTERVENTION).toBeDefined()
    expect(SOURCE_REF_KIND_LABEL.INBOX_ITEM).toMatch(/Audit finding/)
    expect(SOURCE_REF_KIND_LABEL.TOPIC).toMatch(/Brief/)
    expect(SOURCE_REF_KIND_LABEL.WORKSTREAM).toMatch(/Brief/)
  })

  it('OBJECT_KINDS = 冻结 24 值（common.schema.json objectKind — 对话框选择面）', () => {
    expect(OBJECT_KINDS).toHaveLength(24)
    for (const k of ['PROJECT', 'INTERVENTION', 'INBOX_ITEM', 'ANALYSIS_RECORD']) {
      expect(OBJECT_KINDS).toContain(k)
    }
    expect(OBJECT_KINDS).not.toContain('MANAGEMENT_ACTION')
  })
})

describe('formatAnalysisTime', () => {
  it('null/undefined ⇒ 「—」', () => {
    expect(formatAnalysisTime(null)).toBe('—')
    expect(formatAnalysisTime(undefined)).toBe('—')
  })
  it('epoch ms ⇒ 本地时区文本（含年月日时分秒）', () => {
    const text = formatAnalysisTime(T0)
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('initialSaveFieldValues（预填矩阵）', () => {
  it('sourceRef 在场 + run 在场 ⇒ 预填（dshSessionId = launcher 会话指针）', () => {
    const v = initialSaveFieldValues({
      sessionId: 'investigator-x',
      sourceRef: { kind: 'INTERVENTION', id: 'IV-5' },
      run: run(),
    })
    expect(v).toEqual({
      sourceRefKind: 'INTERVENTION',
      sourceRefId: 'IV-5',
      content: '',
      investigatorRunId: 'R-81',
      dshSessionId: 'investigator-x',
    })
  })

  it('sourceRef 缺席 + run 缺席 ⇒ INTERVENTION 空 id + run 空串（用户必填）', () => {
    const v = initialSaveFieldValues({ sessionId: 'investigator-y', run: null })
    expect(v.sourceRefKind).toBe('INTERVENTION')
    expect(v.sourceRefId).toBe('')
    expect(v.investigatorRunId).toBe('')
    expect(v.dshSessionId).toBe('investigator-y')
  })
})

describe('canConfirmSave（确认门 — 按钮面即禁用, 不等到提交）', () => {
  const base: SaveDialogFieldValues = {
    sourceRefKind: 'INTERVENTION',
    sourceRefId: 'IV-5',
    content: '分析内容',
    investigatorRunId: '',
    dshSessionId: 'investigator-x',
  }

  it('合法 ⇒ true', () => {
    expect(canConfirmSave(base)).toBe(true)
  })
  it('空 content ⇒ false', () => {
    expect(canConfirmSave({ ...base, content: '' })).toBe(false)
    expect(canConfirmSave({ ...base, content: '   ' })).toBe(false)
  })
  it('空 sourceRefId ⇒ false', () => {
    expect(canConfirmSave({ ...base, sourceRefId: '' })).toBe(false)
  })
  it('坏 sourceRefId 形态（小写 / AN-0 / 前缀缺失）⇒ false', () => {
    expect(canConfirmSave({ ...base, sourceRefId: 'iv-5' })).toBe(false)
    expect(canConfirmSave({ ...base, sourceRefId: 'AN-0' })).toBe(false)
    expect(canConfirmSave({ ...base, sourceRefId: 'IV5' })).toBe(false)
  })
  it('坏 run id 形态 ⇒ false; 合法 run id ⇒ true; 空 run id ⇒ true（可选）', () => {
    expect(canConfirmSave({ ...base, investigatorRunId: 'r-1' })).toBe(false)
    expect(canConfirmSave({ ...base, investigatorRunId: 'RUN-1' })).toBe(false)
    expect(canConfirmSave({ ...base, investigatorRunId: 'R-81' })).toBe(true)
    expect(canConfirmSave({ ...base, investigatorRunId: '' })).toBe(true)
  })
  it('pattern 常量面（与宿主预校验同口径）', () => {
    expect(TYPED_REF_ID_PATTERN.test('IV-5')).toBe(true)
    expect(TYPED_REF_ID_PATTERN.test('IV-05')).toBe(false)
    expect(RUN_ID_PATTERN.test('R-81')).toBe(true)
    expect(RUN_ID_PATTERN.test('R-0')).toBe(false)
  })
})

describe('buildSavePayload（空选值不携带 — 不虚构）', () => {
  it('全字段：trim + 可选字段在场携带', () => {
    const payload = buildSavePayload({
      sourceRefKind: 'INBOX_ITEM',
      sourceRefId: ' IN-11 ',
      content: '  内容  ',
      investigatorRunId: ' R-81 ',
      dshSessionId: ' investigator-x ',
    })
    expect(payload).toEqual({
      sourceRef: { kind: 'INBOX_ITEM', id: 'IN-11' },
      content: '内容',
      investigatorRunId: 'R-81',
      dshSessionId: 'investigator-x',
    })
  })

  it('空选值 = 键缺席（不携带空串）', () => {
    const payload = buildSavePayload({
      sourceRefKind: 'INTERVENTION',
      sourceRefId: 'IV-5',
      content: '内容',
      investigatorRunId: '',
      dshSessionId: '',
    })
    expect(payload).toEqual({ sourceRef: { kind: 'INTERVENTION', id: 'IV-5' }, content: '内容' })
    expect('investigatorRunId' in payload).toBe(false)
    expect('dshSessionId' in payload).toBe(false)
  })
})

describe('selectSavedRecordRows', () => {
  function rec(overrides: Partial<AnalysisRecordDto> = {}): AnalysisRecordDto {
    return {
      id: 'AN-1',
      sourceRef: { kind: 'INTERVENTION', id: 'IV-5' },
      investigatorRunId: 'R-81',
      dshSessionId: 'investigator-x',
      content: '内容',
      createdAt: T0,
      ...overrides,
    }
  }

  it('badge 投影 + 时间 + 预览（短内容原样）', () => {
    const rows = selectSavedRecordRows([rec()])
    expect(rows[0]).toMatchObject({
      record: rows[0]!.record,
      sourceRefLabel: '干预',
      sourceRefText: 'INTERVENTION:IV-5',
      runLabel: 'R-81',
      sessionText: 'investigator-x',
    })
    expect(rows[0]!.preview).toBe('内容')
    expect(rows[0]!.timeText).toMatch(/^\d{4}-/)
  })

  it('预览截断 120 字符 + 省略号', () => {
    const long = 'x'.repeat(150)
    const rows = selectSavedRecordRows([rec({ content: long, id: 'AN-2' })])
    expect(rows[0]!.preview).toBe(`${'x'.repeat(120)}…`)
    expect(rows[0]!.preview).toHaveLength(121)
  })

  it('可选字段 null 形态（run 缺席）+ 未知 kind 原样透出 + 稳定顺序保持', () => {
    const rows = selectSavedRecordRows([
      rec({ id: 'AN-1' }),
      rec({ id: 'AN-2', investigatorRunId: null, sourceRef: { kind: 'SOMETHING_ELSE', id: 'X-1' }, createdAt: T0 + 5 }),
    ])
    expect(rows.map((r) => r.record.id)).toEqual(['AN-1', 'AN-2'])
    expect(rows[1]!.runLabel).toBeNull()
    expect(rows[1]!.sourceRefLabel).toBe('SOMETHING_ELSE')
  })
})
