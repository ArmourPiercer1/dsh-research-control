/**
 * V3 PoC · P0 —— 写入边界守卫测试（任务 D）。
 *
 * 断言：对 src/、schema/、.research/、仓根 lib/ 的相对与绝对形态路径全部
 * 拒绝（FATAL），`..` 归一化逃逸同样拒绝；拒绝时零文件创建。
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

import { ALLOWED_WRITE_ROOT, POC_ROOT, assertWritable } from './writeguard.ts'

const REPO_ROOT = path.resolve(POC_ROOT, '..', '..')

/** 既给出绝对形态，也给出按当前 cwd 折算的相对形态。 */
function bothForms(absPath: string): string[] {
  return [absPath, path.relative(process.cwd(), absPath)]
}

const FORBIDDEN_TARGETS: Array<[label: string, absPath: string]> = [
  ['仓根 src/', path.join(REPO_ROOT, 'src', 'poc-smuggled.ts')],
  ['仓根 schema/', path.join(REPO_ROOT, 'schema', 'poc-smuggled.json')],
  ['.research/', path.join(REPO_ROOT, '.research', 'research.sqlite')],
  ['仓根 lib/', path.join(REPO_ROOT, 'lib', 'poc-smuggled.js')],
  ['PoC src/', path.join(POC_ROOT, 'src', 'poc-smuggled.ts')],
  ['PoC SPEC.md', path.join(POC_ROOT, 'SPEC.md')],
]

/** 允许区内的目录清单快照（拒绝路径不得在其间或源树留下任何文件）。 */
function snapshotDirs(): Record<string, string[]> {
  const watched = [
    ALLOWED_WRITE_ROOT,
    path.join(POC_ROOT, 'src'),
    path.join(POC_ROOT, 'fixtures'),
    path.join(POC_ROOT, 'golden'),
    path.join(REPO_ROOT, 'src'),
    path.join(REPO_ROOT, 'schema'),
    path.join(REPO_ROOT, 'lib'),
  ]
  const snap: Record<string, string[]> = {}
  for (const dir of watched) {
    snap[dir] = existsSync(dir) ? readdirSync(dir).sort() : ['<absent>']
  }
  return snap
}

describe('assertWritable：允许区', () => {
  it('允许 .poc-data/v3 之下的绝对路径与相对路径（返回规范化绝对路径，不创建文件）', () => {
    const absTarget = path.join(ALLOWED_WRITE_ROOT, 'out', 'sub', 'export.jsonl')
    expect(assertWritable(absTarget)).toBe(absTarget)
    expect(assertWritable(path.relative(process.cwd(), absTarget))).toBe(absTarget)
    expect(assertWritable(ALLOWED_WRITE_ROOT)).toBe(ALLOWED_WRITE_ROOT)
    // 未因校验而创建任何路径
    expect(existsSync(path.join(ALLOWED_WRITE_ROOT, 'out'))).toBe(false)
  })
})

describe('assertWritable：越界路径全部 FATAL 拒绝', () => {
  for (const [label, absPath] of FORBIDDEN_TARGETS) {
    for (const form of bothForms(absPath)) {
      it(`拒绝 ${label}（${form === absPath ? '绝对' : '相对'}形态）`, () => {
        expect(() => assertWritable(form)).toThrow(/FATAL/)
      })
    }
  }

  it('拒绝用 .. 从允许区内部向外逃逸（含 ../ 混合形态）', () => {
    const escapes = [
      path.join(ALLOWED_WRITE_ROOT, '..', '..', '..', 'src', 'evil.ts'), // → PoC src/
      path.join(ALLOWED_WRITE_ROOT, 'a', 'b', '..', '..', '..', '..', 'lib', 'evil.js'), // → 仓根 lib/
      `${POC_ROOT}/.poc-data/v3/../../../schema/evil.json`, // → 仓根 schema/
      '.poc-data/v3/../../src/evil.ts', // 相对形态（cwd=仓根时落在 PoC 之外）
    ]
    for (const target of escapes) {
      expect(() => assertWritable(target)).toThrow(/FATAL/)
    }
  })

  it('拒绝与允许区前缀相似但不同的兄弟路径', () => {
    expect(() => assertWritable(`${ALLOWED_WRITE_ROOT}evil/file.jsonl`)).toThrow(/FATAL/)
    expect(() => assertWritable(path.join(ALLOWED_WRITE_ROOT, '..', 'v3-backup', 'x.jsonl'))).toThrow(/FATAL/)
    expect(() => assertWritable(path.join(ALLOWED_WRITE_ROOT, '..'))).toThrow(/FATAL/) // .poc-data 本身也不行
  })

  it('拒绝无效输入（空串 / 非字符串 / NUL）', () => {
    expect(() => assertWritable('')).toThrow(/FATAL/)
    expect(() => assertWritable('\0hidden')).toThrow(/FATAL/)
    expect(() => assertWritable(undefined as unknown as string)).toThrow(/FATAL/)
  })
})

describe('assertWritable：拒绝即 FATAL 且零文件创建', () => {
  it('对全部越界目标发起拒绝写入尝试后，受保护目录清单与 .research/ 存在性零变化', () => {
    const before = snapshotDirs()
    // 记录发起尝试前的存在性（SPEC.md 这类受保护文件本就存在——断言的是
    // "状态零变化"，不是"目标必不存在"）。
    const existedBefore = new Map(FORBIDDEN_TARGETS.map(([, p]) => [p, existsSync(p)]))
    const researchExistedBefore = existsSync(path.join(REPO_ROOT, '.research'))
    for (const [, absPath] of FORBIDDEN_TARGETS) {
      for (const form of bothForms(absPath)) {
        expect(() => assertWritable(form)).toThrow(/FATAL/)
      }
    }
    for (const [label, absPath] of FORBIDDEN_TARGETS) {
      expect(existsSync(absPath), `被拒目标意外出现：${label}`).toBe(existedBefore.get(absPath))
    }
    expect(snapshotDirs()).toEqual(before)
    expect(existsSync(path.join(REPO_ROOT, '.research'))).toBe(researchExistedBefore)
  })
})
