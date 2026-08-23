/**
 * WP-7.3 — `loadAnalysisSchemas` 面审计（真实冻结
 * provenance.schema.json — 同 WP-3.1/WP-6.4 schema 装载测试纪律）:
 *
 *  - 真实冻结装载成功（isUsable + 零 loadErrors）;
 *  - 整行形状网: 合法行过网（可选字段两种缺省形态 — 键缺席 vs 提供）;
 *  - 精确分类拒绝: 缺 source_ref / 缺 content / 空 content（minLength 1）/
 *    坏 AN id / 坏 R id / 未知 source_ref.kind / source_ref 缺 id /
 *    额外键（additionalProperties:false 网）/ 坏 created_at;
 *  - 缺文件 ⇒ isUsable=false（fail loud — 绝不放行）。
 */

import { describe, expect, it } from 'vitest'

import { loadAnalysisSchemas } from '../../src/host/service/analysis/index.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  realOperationalSchemaFiles,
} from '../planfork/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'
import type { AnalysisRecordRecord } from '../../src/host/service/analysis/index.js'

const T0 = 1_700_000_000_000

function record(overrides: Record<string, unknown>): AnalysisRecordRecord {
  return {
    id: 'AN-1',
    source_ref: { kind: 'INTERVENTION', id: 'IV-5' },
    content: '分析内容（Markdown）',
    created_at: T0,
    ...overrides,
  } as unknown as AnalysisRecordRecord
}

function loader(files: Record<string, string> = realOperationalSchemaFiles()) {
  return loadAnalysisSchemas(new MemoryReader(files), MEM_OPERATIONAL_SCHEMA_DIR)
}

describe('冻结 provenance.schema.json 装载', () => {
  it('真实冻结文件装载成功（isUsable + 零 loadErrors）', () => {
    const s = loader()
    expect(s.isUsable).toBe(true)
    expect(s.loadErrors).toEqual([])
    expect(s.schemaDir).toBe(MEM_OPERATIONAL_SCHEMA_DIR)
  })

  it('合法行过整行网（可选字段缺席形态 — 键不存在）', () => {
    const s = loader()
    expect(s.checkAnalysisShape(record({})).ok).toBe(true)
  })

  it('合法行过整行网（可选字段提供形态 — investigator_run_id + dsh_session_id）', () => {
    const s = loader()
    expect(
      s.checkAnalysisShape(
        record({
          investigator_run_id: 'R-81',
          dsh_session_id: 'investigator-abc-123',
          source_ref: { kind: 'INBOX_ITEM', id: 'IN-11' },
        }),
      ).ok,
    ).toBe(true)
  })

  it('缺 source_ref ⇒ 拒绝（required — AJV 在实例根报告 missingProperty）', () => {
    const s = loader()
    const r = record({})
    delete (r as unknown as Record<string, unknown>).source_ref
    const check = s.checkAnalysisShape(r)
    expect(check.ok).toBe(false)
    expect(check.errors.some((e) => e.message.includes('source_ref'))).toBe(true)
  })

  it('空 content ⇒ 拒绝（minLength 1）', () => {
    const s = loader()
    const check = s.checkAnalysisShape(record({ content: '' }))
    expect(check.ok).toBe(false)
    expect(check.errors.map((e) => e.path).join('|')).toContain('/content')
  })

  it('坏 AN id ⇒ 拒绝（idAnalysisRecord 模式）', () => {
    const s = loader()
    for (const bad of ['AN-0', 'an-1', 'ANX-1', 'AN-', 'AN-1-2']) {
      expect(s.checkAnalysisShape(record({ id: bad })).ok).toBe(false)
    }
  })

  it('坏 investigator_run_id ⇒ 拒绝（idRun 模式 ^R-...$）', () => {
    const s = loader()
    for (const bad of ['R-0', 'r-1', 'RUN-1', 'R-']) {
      expect(s.checkAnalysisShape(record({ investigator_run_id: bad })).ok).toBe(false)
    }
  })

  it('未知 source_ref.kind ⇒ 拒绝（objectKind 24 值闭集）', () => {
    const s = loader()
    expect(s.checkAnalysisShape(record({ source_ref: { kind: 'NOT_A_KIND', id: 'IV-5' } })).ok).toBe(false)
    // 全 24 值逐一放行（含 §12.2 三类来源: INTERVENTION / INBOX_ITEM /
    // TOPIC(Brief) — 形状面不限制 kind 集合, 冻结网即边界）。
    const allKinds = [
      'PROJECT', 'TOPIC', 'WORKSTREAM', 'TASK', 'GATE', 'MILESTONE', 'RUN',
      'CLAIM', 'FACT', 'ARTIFACT', 'RELATION', 'OBJECTIVE', 'INTERVENTION',
      'NEXT_ACTION', 'BLOCKER', 'INTERACTION', 'REPORTING_ITEM',
      'SCHEDULED_EVENT', 'INBOX_ITEM', 'PLAN_FORK', 'TOPOLOGY_EDGE',
      'DISCOVERED_SESSION', 'HISTORY_EVENT', 'ANALYSIS_RECORD',
    ]
    for (const kind of allKinds) {
      expect(s.checkAnalysisShape(record({ source_ref: { kind, id: 'IV-5' } })).ok).toBe(true)
    }
  })

  it('source_ref 缺 id / 坏 id 模式 ⇒ 拒绝', () => {
    const s = loader()
    expect(s.checkAnalysisShape(record({ source_ref: { kind: 'INTERVENTION' } })).ok).toBe(false)
    expect(s.checkAnalysisShape(record({ source_ref: { kind: 'INTERVENTION', id: 'iv-5' } })).ok).toBe(false)
  })

  it('额外键 ⇒ 拒绝（additionalProperties:false 网）', () => {
    const s = loader()
    expect(s.checkAnalysisShape(record({ extra: true })).ok).toBe(false)
  })

  it('坏 created_at（负数 / 非整数 / 字符串）⇒ 拒绝（epochMs）', () => {
    const s = loader()
    expect(s.checkAnalysisShape(record({ created_at: -1 })).ok).toBe(false)
    expect(s.checkAnalysisShape(record({ created_at: 1.5 })).ok).toBe(false)
    expect(s.checkAnalysisShape(record({ created_at: 'nope' })).ok).toBe(false)
  })
})

describe('失败聚合（loader 模式 — 绝不在无 schema 时放行）', () => {
  it('provenance.schema.json 缺失 ⇒ isUsable=false + loadErrors 指名', () => {
    const files = { ...realOperationalSchemaFiles() }
    delete files[`${MEM_OPERATIONAL_SCHEMA_DIR}/provenance.schema.json`]
    const s = loader(files)
    expect(s.isUsable).toBe(false)
    expect(s.loadErrors.length).toBeGreaterThan(0)
    const check = s.checkAnalysisShape(record({}))
    expect(check.ok).toBe(false)
  })

  it('common.schema.json 缺失 ⇒ isUsable=false（父 ref 不可解析）', () => {
    const files = { ...realOperationalSchemaFiles() }
    delete files[`${MEM_OPERATIONAL_SCHEMA_DIR}/../common.schema.json`]
    const s = loader(files)
    expect(s.isUsable).toBe(false)
  })
})
