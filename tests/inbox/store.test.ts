/**
 * WP-6.4 — `InboxStore` 面审计（真实 research.sqlite + 真实冻结
 * inbox.schema.json 形状网; 同 WP-3.5/WP-5.1 store 测试纪律）:
 *
 *  - DDL 幂等（同连接二次构造 + 二次 exec 全过; EXPECTED 表集在位）;
 *  - insert 整行过**真实冻结** $defs/InboxItem（合法行往返 / 畸形行
 *    精确分类: 缺 payload / 空 payload / 坏 IN id / 未知 source /
 *    未知 state / context_refs 非 typedRef / converted_to 非 typedRef /
 *    额外键 — additionalProperties:false 网）;
 *  - 形状网不可用 ⇒ IN_STORE 大声失败（绝不在无 schema 时放行）;
 *  - 查询面: getItem（含 raw/converted_to 往返）/ listItems 稳定顺序
 *    created_at ASC, id ASC + state/source 过滤（无隐藏过滤器）;
 *  - updateState 乐观并发门（expected 匹配 = 1 行 / 不匹配 = 0 行 /
 *    converted_to 落值往返）+ 边界断言（坏 IN id / 未知 state / 坏
 *    convertedTo）;
 *  - 触发器兜底（raw 连接面, 任何连接生效）: DELETE 全拒（INV-HIST-7）/
 *    内容列 UPDATE 全拒（5 内容列各一）/ 状态缓存两列 UPDATE 放行;
 *  - closed store / 构造器边界。
 */

import { describe, expect, it } from 'vitest'

import {
  inboxItemDdl,
  INBOX_ITEM_TABLE,
  INBOX_TABLES,
  type InboxItemRecord,
} from '../../src/host/service/inbox/index.js'
import { InboxStore } from '../../src/host/service/inbox/index.js'
import { makeInboxHarness, ref, throwsInbox } from './fixtures.js'
import type { InboxSchemas } from '../../src/host/service/inbox/index.js'

const T0 = 1_700_000_000_000

function record(overrides: Partial<InboxItemRecord> & { readonly id: string }): InboxItemRecord {
  return {
    source: 'HUMAN_QUICK_CAPTURE',
    payload: 'p',
    context_refs: [],
    state: 'CAPTURED',
    created_at: T0,
    ...overrides,
  }
}

describe('DDL（第二连接幂等应用）', () => {
  it('构造即应用; 二次构造同连接不炸（IF NOT EXISTS 幂等）', () => {
    const h = makeInboxHarness()
    expect(() => new InboxStore({ db: h.dbPair.db, schemas: h.schemas })).not.toThrow()
    h.dbPair.db.exec(inboxItemDdl())
    const tables = h.dbPair.db.all(`SELECT name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    const names = tables.map((t) => String(t.name)).sort()
    expect(names).toContain('inbox_item')
    expect(names).toContain('idx_inbox_item_state_created')
    expect(names).toContain('inbox_item_no_delete')
    expect(names).toContain('inbox_item_no_content_update')
    expect([...INBOX_TABLES]).toEqual([INBOX_ITEM_TABLE])
    h.close()
  })
})

describe('insertItem（整行真实冻结形状网）', () => {
  it('合法行往返（raw 对象 + context_refs + 缺省 raw/converted_to）', () => {
    const h = makeInboxHarness()
    const rec = record({
      id: 'IN-1',
      payload: 'audit: 3 untracked in results/',
      raw: { category: 'UNREGISTERED_WORKSPACE_CHANGE', paths: ['results/a.csv'], nested: { ok: true } },
      context_refs: [ref('ARTIFACT', 'A-1'), ref('WORKSTREAM', 'WS-1')],
    })
    expect(h.store.insertItem(rec)).toBe(rec)
    const got = h.store.getItem('IN-1')
    expect(got).toEqual({
      id: 'IN-1',
      source: 'HUMAN_QUICK_CAPTURE',
      payload: 'audit: 3 untracked in results/',
      raw: { category: 'UNREGISTERED_WORKSPACE_CHANGE', paths: ['results/a.csv'], nested: { ok: true } },
      context_refs: [
        { kind: 'ARTIFACT', id: 'A-1' },
        { kind: 'WORKSTREAM', id: 'WS-1' },
      ],
      state: 'CAPTURED',
      created_at: T0,
    })
    h.close()
  })

  it('raw = 任意 JSON 面（string/number/array 均放行 — §11「raw: any」）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1', raw: 'plain text raw' }))
    h.store.insertItem(record({ id: 'IN-2', raw: 42 }))
    h.store.insertItem(record({ id: 'IN-3', raw: ['a', 'b'] }))
    expect(h.store.getItem('IN-1')?.raw).toBe('plain text raw')
    expect(h.store.getItem('IN-2')?.raw).toBe(42)
    expect(h.store.getItem('IN-3')?.raw).toEqual(['a', 'b'])
    h.close()
  })

  it('converted_to 往返（CONVERTED 行）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1', state: 'CONVERTED', converted_to: ref('INTERVENTION', 'IV-9') }))
    expect(h.store.getItem('IN-1')?.converted_to).toEqual({ kind: 'INTERVENTION', id: 'IV-9' })
    h.close()
  })

  it('形状网逐字拦截（真实冻结 schema — additionalProperties:false + 枚举 + id 模式）', () => {
    const h = makeInboxHarness()
    // 缺必填 payload
    throwsInbox(
      () => h.store.insertItem({ id: 'IN-1', source: 'HUMAN_QUICK_CAPTURE', state: 'CAPTURED', created_at: T0, context_refs: [] } as unknown as InboxItemRecord),
      'IN_INPUT',
      /payload/,
    )
    // 空 payload（minLength 1）
    throwsInbox(() => h.store.insertItem(record({ id: 'IN-1', payload: '' })), 'IN_INPUT', /payload/)
    // 坏 IN id（模式 ^IN-[1-9][0-9]*$ — 冻结 idInboxItem）
    throwsInbox(() => h.store.insertItem(record({ id: 'IN-0' })), 'IN_INPUT', /id/)
    throwsInbox(() => h.store.insertItem(record({ id: 'in-1' })), 'IN_INPUT', /id/)
    // 未知 source（7 值冻结枚举外）
    throwsInbox(() => h.store.insertItem(record({ id: 'IN-1', source: 'BOGUS' as never })), 'IN_INPUT', /source/)
    // 未知 state（3 值冻结枚举外）
    throwsInbox(() => h.store.insertItem(record({ id: 'IN-1', state: 'OPEN' as never })), 'IN_INPUT', /state/)
    // context_refs 元素非 typedRef
    throwsInbox(
      () => h.store.insertItem(record({ id: 'IN-1', context_refs: [{ kind: 'ARTIFACT' }] as never })),
      'IN_INPUT',
      /context_refs/,
    )
    // context_refs 元素 kind 不在冻结 objectKind 枚举（typedRef → objectKind 冻结 ref 网）
    throwsInbox(
      () => h.store.insertItem(record({ id: 'IN-1', context_refs: [{ kind: 'NOT_A_KIND', id: 'A-1' }] as never })),
      'IN_INPUT',
      /context_refs/,
    )
    // converted_to 非 typedRef
    throwsInbox(
      () => h.store.insertItem(record({ id: 'IN-1', state: 'CONVERTED', converted_to: { kind: 'INTERVENTION' } as never })),
      'IN_INPUT',
      /converted_to/,
    )
    // 额外键（additionalProperties:false）
    throwsInbox(
      () => h.store.insertItem({ ...record({ id: 'IN-1' }), bogus: 1 } as unknown as InboxItemRecord),
      'IN_INPUT',
      /bogus|additional/,
    )
    // 非对象记录
    throwsInbox(() => h.store.insertItem(null as never), 'IN_INPUT', /InboxItemRecord object/)
    // 零落库（上面全部拒绝 — 表仍空）
    expect(h.store.listItems().length).toBe(0)
    h.close()
  })

  it('形状网不可用 ⇒ IN_STORE 大声失败（绝不在无 schema 时放行）', () => {
    const h = makeInboxHarness()
    const badSchemas: InboxSchemas = {
      schemaDir: 'mem',
      isUsable: false,
      loadErrors: [{ path: 'x', message: 'simulated' }],
      checkInboxShape: () => ({ ok: false, errors: [] }),
    }
    const store = new InboxStore({ db: h.dbPair.db, schemas: badSchemas })
    throwsInbox(() => store.insertItem(record({ id: 'IN-1' })), 'IN_STORE', /schema set unavailable/)
    h.close()
  })
})

describe('查询面（无隐藏过滤器）', () => {
  it('getItem 缺席 = null; 坏 id 大声', () => {
    const h = makeInboxHarness()
    expect(h.store.getItem('IN-404')).toBeNull()
    throwsInbox(() => h.store.getItem(''), 'IN_INPUT', /non-empty string/)
    h.close()
  })

  it('listItems 稳定顺序 created_at ASC, id ASC（跨 created_at 相同 = id 全序兜底）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-3', created_at: T0 + 2 }))
    h.store.insertItem(record({ id: 'IN-1', created_at: T0 }))
    h.store.insertItem(record({ id: 'IN-2', created_at: T0 + 1 }))
    h.store.insertItem(record({ id: 'IN-10', created_at: T0 + 1 })) // 同刻: id 字符串序 IN-10 < IN-2
    h.store.insertItem(record({ id: 'IN-4', created_at: T0 + 3 }))
    expect(h.store.listItems().map((r) => r.id)).toEqual(['IN-1', 'IN-10', 'IN-2', 'IN-3', 'IN-4'])
    h.close()
  })

  it('state / source 过滤（显式指名; 单值过滤 — 全缺省 = 全量）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1' }))
    h.store.insertItem(record({ id: 'IN-2', source: 'UNREGISTERED_WORKSPACE_CHANGE' }))
    h.store.insertItem(record({ id: 'IN-3', state: 'DISMISSED' }))
    expect(h.store.listItems({ state: 'CAPTURED' }).map((r) => r.id)).toEqual(['IN-1', 'IN-2'])
    expect(h.store.listItems({ source: 'UNREGISTERED_WORKSPACE_CHANGE' }).map((r) => r.id)).toEqual(['IN-2'])
    expect(h.store.listItems({ state: 'DISMISSED' }).map((r) => r.id)).toEqual(['IN-3'])
    expect(h.store.listItems().length).toBe(3)
    throwsInbox(() => h.store.listItems({ state: 'OPEN' as never }), 'IN_INPUT', /state/)
    throwsInbox(() => h.store.listItems({ source: 'BOGUS' as never }), 'IN_INPUT', /source/)
    h.close()
  })
})

describe('updateState（§13 迁移行侧写 — 乐观并发门）', () => {
  it('expected 匹配 = 1 行; CONVERTED 迁移 converted_to 落值往返', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1' }))
    expect(h.store.updateState('IN-1', 'CONVERTED', ref('INTERVENTION', 'IV-7'), 'CAPTURED')).toBe(1)
    const got = h.store.getItem('IN-1')
    expect(got?.state).toBe('CONVERTED')
    expect(got?.converted_to).toEqual({ kind: 'INTERVENTION', id: 'IV-7' })
    h.close()
  })

  it('expected 不匹配 = 0 行（并发门 — service 大声面）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1', state: 'DISMISSED' }))
    expect(h.store.updateState('IN-1', 'CONVERTED', ref('CLAIM', 'C-1'), 'CAPTURED')).toBe(0)
    expect(h.store.getItem('IN-1')?.state).toBe('DISMISSED')
    expect(h.store.getItem('IN-1')?.converted_to).toBeUndefined()
    h.close()
  })

  it('DISMISSED 迁移 converted_to = null（唯一写点语义 — service 保证）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1' }))
    expect(h.store.updateState('IN-1', 'DISMISSED', null, 'CAPTURED')).toBe(1)
    expect(h.store.getItem('IN-1')?.converted_to).toBeUndefined()
    h.close()
  })

  it('边界断言（坏 IN id / 未知 state / 坏 convertedTo）', () => {
    const h = makeInboxHarness()
    throwsInbox(() => h.store.updateState('IV-1', 'DISMISSED', null, 'CAPTURED'), 'IN_INPUT', /well-formed IN id/)
    throwsInbox(() => h.store.updateState('IN-1', 'OPEN' as never, null, 'CAPTURED'), 'IN_INPUT', /state/)
    throwsInbox(() => h.store.updateState('IN-1', 'DISMISSED', null, 'OPEN' as never), 'IN_INPUT', /expectedState/)
    throwsInbox(() => h.store.updateState('IN-1', 'CONVERTED', { kind: 'CLAIM' } as never, 'CAPTURED'), 'IN_INPUT', /convertedTo/)
    h.close()
  })
})

describe('触发器兜底（raw 连接面 — 任何连接生效）', () => {
  it('DELETE 全拒（§15 通则 / INV-HIST-7）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1' }))
    expect(() => h.raw.prepare('DELETE FROM inbox_item WHERE id = ?').run('IN-1')).toThrow(/never deleted/)
    expect(h.store.getItem('IN-1')).not.toBeNull()
    h.close()
  })

  it('内容列 UPDATE 全拒（5 内容列各一 — 创建后不变）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1', raw: 'x' }))
    expect(() => h.raw.prepare('UPDATE inbox_item SET source = ? WHERE id = ?').run('EXTERNAL_NOTE', 'IN-1')).toThrow(/immutable/)
    expect(() => h.raw.prepare('UPDATE inbox_item SET payload = ? WHERE id = ?').run('hacked', 'IN-1')).toThrow(/immutable/)
    expect(() => h.raw.prepare('UPDATE inbox_item SET raw = ? WHERE id = ?').run('y', 'IN-1')).toThrow(/immutable/)
    expect(() => h.raw.prepare('UPDATE inbox_item SET context_refs = ? WHERE id = ?').run('[{"kind":"ARTIFACT","id":"A-9"}]', 'IN-1')).toThrow(/immutable/)
    expect(() => h.raw.prepare('UPDATE inbox_item SET created_at = ? WHERE id = ?').run(T0 + 999, 'IN-1')).toThrow(/immutable/)
    expect(() => h.raw.prepare('UPDATE inbox_item SET id = ? WHERE id = ?').run('IN-9', 'IN-1')).toThrow(/immutable/)
    h.close()
  })

  it('状态缓存两列 UPDATE 放行（trigger 唯一合法行侧面 — §13 迁移面）', () => {
    const h = makeInboxHarness()
    h.store.insertItem(record({ id: 'IN-1' }))
    h.raw.prepare('UPDATE inbox_item SET state = ?, converted_to = ? WHERE id = ?').run('CONVERTED', JSON.stringify({ kind: 'FACT', id: 'F-1' }), 'IN-1')
    expect(h.store.getItem('IN-1')?.state).toBe('CONVERTED')
    expect(h.store.getItem('IN-1')?.converted_to).toEqual({ kind: 'FACT', id: 'F-1' })
    h.close()
  })
})

describe('面边界', () => {
  it('closed store 全面拒绝', () => {
    const h = makeInboxHarness()
    h.store.close()
    throwsInbox(() => h.store.insertItem(record({ id: 'IN-1' })), 'IN_STORE', /closed/)
    throwsInbox(() => h.store.getItem('IN-1'), 'IN_STORE', /closed/)
    throwsInbox(() => h.store.listItems(), 'IN_STORE', /closed/)
    throwsInbox(() => h.store.updateState('IN-1', 'DISMISSED', null, 'CAPTURED'), 'IN_STORE', /closed/)
    h.close()
  })

  it('构造器边界（db / schemas 端口缺失）', () => {
    const h = makeInboxHarness()
    throwsInbox(() => new InboxStore({ db: {} as never, schemas: h.schemas }), 'IN_INPUT', /db/)
    throwsInbox(() => new InboxStore({ db: h.dbPair.db, schemas: {} as never }), 'IN_INPUT', /schemas/)
    h.close()
  })
})
