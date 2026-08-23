/**
 * WP-6.4 — 冻结 inbox schema 装载面测试（schemas.ts loader 模式 +
 * 真实冻结 schema/operational/inbox.schema.json 形状网 — 同 WP-3.5
 * intervention schemas 测试纪律）。
 */

import { describe, expect, it } from 'vitest'

import { loadInboxSchemas } from '../../src/host/service/inbox/index.js'
import type { InboxItemRecord } from '../../src/host/service/inbox/index.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  realOperationalSchemaFiles,
} from '../planfork/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'

const T0 = 1_700_000_000_000

function baseRecord(overrides: Partial<InboxItemRecord> = {}): InboxItemRecord {
  return {
    id: 'IN-1',
    source: 'UNREGISTERED_WORKSPACE_CHANGE',
    payload: 'p',
    context_refs: [],
    state: 'CAPTURED',
    created_at: T0,
    ...overrides,
  }
}

describe('loadInboxSchemas（真实冻结文档）', () => {
  it('完整 operational 目录装载成功（isUsable + 零 loadErrors + 真实 $id）', () => {
    const reader = new MemoryReader(realOperationalSchemaFiles())
    const schemas = loadInboxSchemas(reader, MEM_OPERATIONAL_SCHEMA_DIR)
    expect(schemas.isUsable).toBe(true)
    expect(schemas.loadErrors).toEqual([])
    expect(schemas.schemaDir).toBe(MEM_OPERATIONAL_SCHEMA_DIR)
    // 合法行过网（真实冻结 $defs/InboxItem — additionalProperties:false）。
    expect(schemas.checkInboxShape(baseRecord()).ok).toBe(true)
    expect(schemas.checkInboxShape(baseRecord({ raw: { deep: [1, 2, 3] }, converted_to: { kind: 'INTERVENTION', id: 'IV-1' } })).ok).toBe(true)
  })

  it('缺 inbox.schema.json ⇒ isUsable=false + 精确 loadErrors + checkInboxShape 全拒', () => {
    const files = realOperationalSchemaFiles()
    const withoutInbox = Object.fromEntries(Object.entries(files).filter(([p]) => !p.endsWith('inbox.schema.json')))
    const reader = new MemoryReader(withoutInbox)
    const schemas = loadInboxSchemas(reader, MEM_OPERATIONAL_SCHEMA_DIR)
    expect(schemas.isUsable).toBe(false)
    expect(schemas.loadErrors.some((e) => e.path.endsWith('inbox.schema.json'))).toBe(true)
    const check = schemas.checkInboxShape(baseRecord())
    expect(check.ok).toBe(false)
    expect(check.errors[0]?.message).toContain('unavailable')
  })

  it('缺 common.schema.json（父 ref）⇒ isUsable=false', () => {
    const files = realOperationalSchemaFiles()
    const withoutCommon = Object.fromEntries(Object.entries(files).filter(([p]) => !p.endsWith('common.schema.json')))
    const reader = new MemoryReader(withoutCommon)
    const schemas = loadInboxSchemas(reader, MEM_OPERATIONAL_SCHEMA_DIR)
    expect(schemas.isUsable).toBe(false)
  })

  it('形状网违例精确报告（instancePath — 冻结网 allErrors+verbose）', () => {
    const reader = new MemoryReader(realOperationalSchemaFiles())
    const schemas = loadInboxSchemas(reader, MEM_OPERATIONAL_SCHEMA_DIR)
    // 空 payload（minLength 1 — 路径 /payload）。
    const emptyPayload = schemas.checkInboxShape(baseRecord({ payload: '' }))
    expect(emptyPayload.ok).toBe(false)
    expect(emptyPayload.errors.some((e) => e.path === '/payload')).toBe(true)
    // 未知 source（枚举 — 路径 /source）。
    const badSource = schemas.checkInboxShape(baseRecord({ source: 'BOGUS' as never }))
    expect(badSource.ok).toBe(false)
    expect(badSource.errors.some((e) => e.path === '/source')).toBe(true)
    // 缺必填（state 删去 — /state required）。
    const { state: _state, ...missingStateRest } = baseRecord()
    const missingState = schemas.checkInboxShape(missingStateRest as unknown as InboxItemRecord)
    expect(missingState.ok).toBe(false)
    expect(missingState.errors.some((e) => e.path === '' || e.path === '/state')).toBe(true)
    // 额外键（additionalProperties:false）。
    const extra = schemas.checkInboxShape({ ...baseRecord(), nope: true } as unknown as InboxItemRecord)
    expect(extra.ok).toBe(false)
  })
})
