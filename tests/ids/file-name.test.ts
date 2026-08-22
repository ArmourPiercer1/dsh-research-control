/**
 * WP-1.6 — TC-DOM-026 (TEST_MATRIX L130): 文件名与 id 一致性校验
 * (DOMAIN_SCHEMA §1.1 规则 2/3, L49-50; §14 规则, L606).
 *
 * 「声明式对象的 ID 同步持久化于文件名与文件内 `id` 字段，二者必须一致
 * （加载期校验）」；「加载期发现文件名与 `id` 不一致即报错」.
 */
import { describe, expect, it } from 'vitest'
import { checkFileNameId, idFromFileName } from '../../src/shared/ids/index.js'

describe('TC-DOM-026: filename ↔ id consistency', () => {
  it('matches when the filename id equals the declared id', () => {
    expect(checkFileNameId('T-1.yaml', 'T-1')).toEqual({
      status: 'match',
      fileNameId: 'T-1',
      declaredId: 'T-1',
    })
    expect(
      checkFileNameId('.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml', 'T-1'),
    ).toMatchObject({ status: 'match', fileNameId: 'T-1' })
    expect(checkFileNameId('TE-17.yaml', 'TE-17')).toMatchObject({ status: 'match' })
    expect(checkFileNameId('INT-7.yaml', 'INT-7')).toMatchObject({ status: 'match' })
    expect(checkFileNameId('IN-11.yaml', 'IN-11')).toMatchObject({ status: 'match' })
    // extension-less name (directory-style or raw)
    expect(checkFileNameId('T-1', 'T-1')).toMatchObject({ status: 'match' })
  })

  it('mismatches when the filename carries a different well-formed id', () => {
    expect(checkFileNameId('items/tasks/T-1.yaml', 'T-2')).toEqual({
      status: 'mismatch',
      fileNameId: 'T-1',
      declaredId: 'T-2',
    })
    expect(checkFileNameId('items/gates/G-1.yaml', 'T-1')).toMatchObject({
      status: 'mismatch',
      fileNameId: 'G-1',
    })
  })

  it('mismatches on the exact TE/T and INT/IN confusions the spec guards against', () => {
    // filename says TopologyEdge, declared id says Task (and vice versa)
    expect(checkFileNameId('TE-17.yaml', 'T-17')).toMatchObject({
      status: 'mismatch',
      fileNameId: 'TE-17',
      declaredId: 'T-17',
    })
    expect(checkFileNameId('T-17.yaml', 'TE-17')).toMatchObject({
      status: 'mismatch',
      fileNameId: 'T-17',
      declaredId: 'TE-17',
    })
    expect(checkFileNameId('INT-7.yaml', 'IN-7')).toMatchObject({
      status: 'mismatch',
      fileNameId: 'INT-7',
      declaredId: 'IN-7',
    })
    expect(checkFileNameId('IN-11.yaml', 'INT-11')).toMatchObject({
      status: 'mismatch',
      fileNameId: 'IN-11',
      declaredId: 'INT-11',
    })
  })

  it('reports no-id-in-name for files whose names carry no id (no constraint)', () => {
    expect(checkFileNameId('plan.yaml', 'WS-1')).toEqual({
      status: 'no-id-in-name',
      declaredId: 'WS-1',
    })
    expect(checkFileNameId('topology.yaml', 'TE-1')).toMatchObject({ status: 'no-id-in-name' })
    expect(checkFileNameId('project.yaml', 'PRJ-1')).toMatchObject({ status: 'no-id-in-name' })
    expect(checkFileNameId('contract.md', 'TE-3')).toMatchObject({ status: 'no-id-in-name' })
  })

  it('handles path separators (POSIX and Windows) and odd names', () => {
    expect(checkFileNameId('a\\b\\T-1.yaml', 'T-1')).toMatchObject({ status: 'match' })
    expect(checkFileNameId('/abs/path/REL-40.yaml', 'REL-40')).toMatchObject({ status: 'match' })
    expect(checkFileNameId('.gitkeep', 'T-1')).toMatchObject({ status: 'no-id-in-name' })
    expect(checkFileNameId('task-1.yaml', 'T-1')).toMatchObject({ status: 'no-id-in-name' }) // lowercase ≠ id
    expect(checkFileNameId('T-01.yaml', 'T-1')).toMatchObject({ status: 'no-id-in-name' }) // leading zero ≠ well-formed id
  })
})

describe('idFromFileName: extraction', () => {
  it('extracts the id or null', () => {
    expect(idFromFileName('T-1.yaml')).toBe('T-1')
    expect(idFromFileName('items/tasks/T-1.yaml')).toBe('T-1')
    expect(idFromFileName('TE-17.yaml')).toBe('TE-17')
    expect(idFromFileName('plan.yaml')).toBeNull()
    expect(idFromFileName('T-1')).toBe('T-1')
    expect(idFromFileName('')).toBeNull()
  })
})
