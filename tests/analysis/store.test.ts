/**
 * WP-7.3 — `AnalysisStore` 面审计（真实 research.sqlite + 真实冻结
 * provenance.schema.json 形状网; 同 WP-3.5/WP-6.4 store 测试纪律）:
 *
 *  - DDL 幂等（同连接二次构造 + 二次 exec 全过; EXPECTED 表集在位 —
 *    §15 逐字: 表 + 两 trigger, **无索引** — 不虚构）;
 *  - insert 整行过**真实冻结** $defs/AnalysisRecord（合法行往返 /
 *    畸形行精确分类: 缺 source_ref / 空 content / 坏 AN id / 坏 R id /
 *    未知 source_ref.kind / 额外键 — additionalProperties:false 网）;
 *  - 形状网不可用 ⇒ AN_STORE 大声失败（绝不在无 schema 时放行）;
 *  - 查询面: getRecord（含可选字段两种缺省形态往返 / 缺席 = null）/
 *    listRecords 稳定顺序 created_at ASC, id ASC + sourceKind/sourceId
 *    过滤（无隐藏过滤器）;
 *  - 触发器兜底（raw 连接面, 任何连接生效）: DELETE 全拒（INV-HIST-7）/
 *    任何列 UPDATE 全拒（快照不可变 — 6 列逐一点名）;
 *  - closed store / 构造器边界。
 */

import { describe, expect, it } from 'vitest'

import {
  analysisRecordDdl,
  ANALYSIS_RECORD_TABLE,
  ANALYSIS_TABLES,
  AnalysisStore,
  type AnalysisRecordRecord,
} from '../../src/host/service/analysis/index.js'
import { makeAnalysisHarness, makeRecord, ref, throwsAnalysis, frozenAnalysisSchemas } from './fixtures.js'
import type { AnalysisSchemas } from '../../src/host/service/analysis/index.js'

const T0 = 1_700_000_000_000

describe('DDL（第二连接幂等应用 — §15 逐字: 表 + trigger, 无索引）', () => {
  it('构造即应用; 二次构造同连接不炸（IF NOT EXISTS 幂等）', () => {
    const h = makeAnalysisHarness()
    expect(() => new AnalysisStore({ db: h.db, schemas: h.schemas })).not.toThrow()
    h.db.exec(analysisRecordDdl())
    const rows = h.rawSql(`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name, type`)
    const names = rows.map((r) => String(r.name)).sort()
    expect(names).toContain(ANALYSIS_RECORD_TABLE)
    expect(names).toContain('analysis_record_no_delete')
    expect(names).toContain('analysis_record_no_update')
    // §15 表行无关键索引 — DDL 不得虚构索引（analysis 表专属索引集为空;
    // 同文件的 WP-2.1 history_event / WP-2.4 run 表索引不属本 WP DDL）。
    const analysisIndexes = rows.filter((r) => r.type === 'index' && String(r.name).includes('analysis'))
    expect(analysisIndexes).toEqual([])
    expect([...ANALYSIS_TABLES]).toEqual([ANALYSIS_RECORD_TABLE])
    h.close()
  })
})

describe('insertRecord（整行真实冻结形状网）', () => {
  it('合法行往返（可选字段提供形态 — investigator_run_id + dsh_session_id）', () => {
    const h = makeAnalysisHarness()
    const rec = makeRecord({
      id: 'AN-1',
      content: '## 分析\n\ninvestigator 发现 results/ 下 3 个未注册 CSV。',
      investigator_run_id: 'R-81',
      dsh_session_id: 'investigator-abc-123',
      source_ref: ref('INTERVENTION', 'IV-5'),
      created_at: T0,
    })
    expect(h.store.insertRecord(rec)).toBe(rec)
    expect(h.store.getRecord('AN-1')).toEqual({
      id: 'AN-1',
      source_ref: { kind: 'INTERVENTION', id: 'IV-5' },
      investigator_run_id: 'R-81',
      dsh_session_id: 'investigator-abc-123',
      content: '## 分析\n\ninvestigator 发现 results/ 下 3 个未注册 CSV。',
      created_at: T0,
    })
    h.close()
  })

  it('可选字段缺席形态往返（键不存在 — NULL 列）', () => {
    const h = makeAnalysisHarness()
    const rec = makeRecord({ id: 'AN-1', source_ref: ref('INBOX_ITEM', 'IN-11'), created_at: T0 })
    h.store.insertRecord(rec)
    expect(h.store.getRecord('AN-1')).toEqual({
      id: 'AN-1',
      source_ref: { kind: 'INBOX_ITEM', id: 'IN-11' },
      content: 'investigator 分析（Markdown）',
      created_at: T0,
    })
    h.close()
  })

  it('整行违例 ⇒ AN_INPUT（冻结网精确分类）', () => {
    const h = makeAnalysisHarness()
    const missingSource = makeRecord({ id: 'AN-1' })
    delete (missingSource as unknown as Record<string, unknown>).source_ref
    throwsAnalysis(() => h.store.insertRecord(missingSource), 'AN_INPUT', /source_ref/)
    throwsAnalysis(() => h.store.insertRecord(makeRecord({ id: 'AN-1', content: '' })), 'AN_INPUT', /content/)
    throwsAnalysis(() => h.store.insertRecord(makeRecord({ id: 'AN-0' })), 'AN_INPUT', /id/)
    throwsAnalysis(() => h.store.insertRecord(makeRecord({ id: 'AN-1', investigator_run_id: 'r-1' })), 'AN_INPUT', /investigator_run_id/)
    throwsAnalysis(() => h.store.insertRecord(makeRecord({ id: 'AN-1', source_ref: ref('NOT_A_KIND', 'IV-5') })), 'AN_INPUT', /source_ref/)
    const extra = { ...makeRecord({ id: 'AN-1' }), extra: true }
    throwsAnalysis(() => h.store.insertRecord(extra as unknown as AnalysisRecordRecord), 'AN_INPUT')
    h.close()
  })

  it('形状网不可用 ⇒ AN_STORE 大声失败（绝不在无 schema 时放行）', () => {
    const h = makeAnalysisHarness()
    const unusable: AnalysisSchemas = {
      schemaDir: '/nowhere',
      isUsable: false,
      loadErrors: [{ path: '', message: 'unavailable' }],
      checkAnalysisShape: () => ({ ok: false, errors: [{ path: '', message: 'unavailable' }] }),
    }
    const s = new AnalysisStore({ db: h.db, schemas: unusable })
    throwsAnalysis(() => s.insertRecord(makeRecord({ id: 'AN-1' })), 'AN_STORE', /unavailable/)
    h.close()
  })

  it('非对象 record ⇒ AN_INPUT', () => {
    const h = makeAnalysisHarness()
    throwsAnalysis(() => h.store.insertRecord(null as never), 'AN_INPUT', /record/)
    h.close()
  })
})

describe('查询面（无 delete / 无 update — INV-HIST-7 + 快照不可变）', () => {
  it('getRecord: 缺席 = null; 坏 id = AN_INPUT', () => {
    const h = makeAnalysisHarness()
    expect(h.store.getRecord('AN-99')).toBeNull()
    throwsAnalysis(() => h.store.getRecord('AN-0'), 'AN_INPUT', /AN id/)
    throwsAnalysis(() => h.store.getRecord('nope'), 'AN_INPUT', /AN id/)
    h.close()
  })

  it('listRecords 稳定顺序 created_at ASC, id ASC（无隐藏过滤器 — 全量）', () => {
    const h = makeAnalysisHarness()
    // 乱序插入（created_at 递减）— 稳定顺序必须按 created_at ASC。
    h.store.insertRecord(makeRecord({ id: 'AN-3', created_at: T0 + 30, source_ref: ref('INTERVENTION', 'IV-7') }))
    h.store.insertRecord(makeRecord({ id: 'AN-1', created_at: T0 + 10, source_ref: ref('TOPIC', 'TPC-3') }))
    h.store.insertRecord(makeRecord({ id: 'AN-2', created_at: T0 + 20, source_ref: ref('INBOX_ITEM', 'IN-11') }))
    // 同 created_at — id ASC 兜底。
    h.store.insertRecord(makeRecord({ id: 'AN-4', created_at: T0 + 20, source_ref: ref('TOPIC', 'TPC-3') }))
    const ids = h.store.listRecords().map((r) => r.id)
    expect(ids).toEqual(['AN-1', 'AN-2', 'AN-4', 'AN-3'])
    h.close()
  })

  it('listRecords 过滤（sourceKind / sourceId 显式指名; 组合过滤; 空结果）', () => {
    const h = makeAnalysisHarness()
    h.store.insertRecord(makeRecord({ id: 'AN-1', created_at: T0 + 1, source_ref: ref('INTERVENTION', 'IV-5') }))
    h.store.insertRecord(makeRecord({ id: 'AN-2', created_at: T0 + 2, source_ref: ref('TOPIC', 'TPC-3') }))
    h.store.insertRecord(makeRecord({ id: 'AN-3', created_at: T0 + 3, source_ref: ref('INTERVENTION', 'IV-9') }))
    expect(h.store.listRecords({ sourceKind: 'INTERVENTION' }).map((r) => r.id)).toEqual(['AN-1', 'AN-3'])
    expect(h.store.listRecords({ sourceId: 'TPC-3' }).map((r) => r.id)).toEqual(['AN-2'])
    expect(h.store.listRecords({ sourceKind: 'INTERVENTION', sourceId: 'IV-5' }).map((r) => r.id)).toEqual(['AN-1'])
    expect(h.store.listRecords({ sourceKind: 'CLAIM' })).toEqual([])
    throwsAnalysis(() => h.store.listRecords({ sourceKind: '' }), 'AN_INPUT', /sourceKind/)
    throwsAnalysis(() => h.store.listRecords({ sourceId: '' }), 'AN_INPUT', /sourceId/)
    h.close()
  })

  it('触发器兜底（raw 连接, 任何连接生效）: DELETE 全拒（INV-HIST-7）', () => {
    const h = makeAnalysisHarness()
    h.store.insertRecord(makeRecord({ id: 'AN-1' }))
    expect(() => h.db.run(`DELETE FROM ${ANALYSIS_RECORD_TABLE} WHERE id = 'AN-1'`)).toThrow(/never deleted/)
    // 行仍在。
    expect(h.store.getRecord('AN-1')?.id).toBe('AN-1')
    h.close()
  })

  it('触发器兜底（raw 连接）: 任何列 UPDATE 全拒（快照不可变 — 6 列逐一点名）', () => {
    const h = makeAnalysisHarness()
    h.store.insertRecord(
      makeRecord({
        id: 'AN-1',
        investigator_run_id: 'R-81',
        dsh_session_id: 'investigator-abc',
        created_at: T0,
      }),
    )
    const updates = [
      `UPDATE ${ANALYSIS_RECORD_TABLE} SET id = 'AN-2' WHERE id = 'AN-1'`,
      `UPDATE ${ANALYSIS_RECORD_TABLE} SET source_ref = '{"kind":"CLAIM","id":"C-1"}' WHERE id = 'AN-1'`,
      `UPDATE ${ANALYSIS_RECORD_TABLE} SET investigator_run_id = 'R-82' WHERE id = 'AN-1'`,
      `UPDATE ${ANALYSIS_RECORD_TABLE} SET dsh_session_id = 'other-session' WHERE id = 'AN-1'`,
      `UPDATE ${ANALYSIS_RECORD_TABLE} SET content = 'edited' WHERE id = 'AN-1'`,
      `UPDATE ${ANALYSIS_RECORD_TABLE} SET created_at = 0 WHERE id = 'AN-1'`,
    ]
    for (const sql of updates) {
      expect(() => h.db.run(sql)).toThrow(/immutable after save/)
    }
    // 行未变（trigger ABORT — 任何列都没动）。
    expect(h.store.getRecord('AN-1')).toEqual({
      id: 'AN-1',
      source_ref: { kind: 'INTERVENTION', id: 'IV-5' },
      investigator_run_id: 'R-81',
      dsh_session_id: 'investigator-abc',
      content: 'investigator 分析（Markdown）',
      created_at: T0,
    })
    h.close()
  })
})

describe('面边界', () => {
  it('closed store 全面拒绝', () => {
    const h = makeAnalysisHarness()
    h.store.close()
    throwsAnalysis(() => h.store.insertRecord(makeRecord({ id: 'AN-1' })), 'AN_STORE', /closed/)
    throwsAnalysis(() => h.store.getRecord('AN-1'), 'AN_STORE', /closed/)
    throwsAnalysis(() => h.store.listRecords(), 'AN_STORE', /closed/)
    h.close()
  })

  it('构造器边界（db / schemas 端口缺失）', () => {
    const h = makeAnalysisHarness()
    throwsAnalysis(() => new AnalysisStore({ db: {} as never, schemas: h.schemas }), 'AN_INPUT', /db/)
    throwsAnalysis(() => new AnalysisStore({ db: h.db, schemas: {} as never }), 'AN_INPUT', /schemas/)
    h.close()
  })
})

// 损坏行面（单独 harness — 触发器拒 UPDATE 后, 损坏行只能经 raw INSERT
// 造出; 解码失败必须大声, 不得静默降级）。
describe('损坏行解码（大声失败 — 不静默降级）', () => {
  it('source_ref 非法 JSON ⇒ getRecord / listRecords 抛 decode 错误', () => {
    const h = makeAnalysisHarness()
    h.db.run(
      `INSERT INTO ${ANALYSIS_RECORD_TABLE} (id, source_ref, investigator_run_id, dsh_session_id, content, created_at)
       VALUES ('AN-1', 'not-json', NULL, NULL, 'c', 1)`,
    )
    expect(() => h.store.getRecord('AN-1')).toThrow(/corruption at analysis_record.source_ref/)
    expect(() => h.store.listRecords()).toThrow(/corruption at analysis_record.source_ref/)
    h.close()
  })

  it('source_ref 非 {kind,id} 形状 ⇒ getRecord 抛 decode 错误', () => {
    const h = makeAnalysisHarness()
    h.db.run(
      `INSERT INTO ${ANALYSIS_RECORD_TABLE} (id, source_ref, investigator_run_id, dsh_session_id, content, created_at)
       VALUES ('AN-1', '{"kind":"INTERVENTION"}', NULL, NULL, 'c', 1)`,
    )
    expect(() => h.store.getRecord('AN-1')).toThrow(/must be a {kind, id} typedRef/)
    h.close()
  })
})

// frozenAnalysisSchemas 直用面（形状网与 store 解耦断言 — 防 harness 缓存
// 掩盖装载回归）。
describe('形状网直用', () => {
  it('frozenAnalysisSchemas() 可用且与 loadAnalysisSchemas 同源', () => {
    const s = frozenAnalysisSchemas()
    expect(s.isUsable).toBe(true)
    expect(s.checkAnalysisShape(makeRecord({ id: 'AN-1' })).ok).toBe(true)
  })
})
