/**
 * V3 PoC · P0 —— poc-run.mjs 端到端测试（任务 E/F）。
 *
 * 只用 child_process.execFileSync（argv-only，不经 shell）；--export 输出
 * 一律落 .poc-data/v3/，断言同输入两次导出字节一致；越界 export 必须 FATAL
 * 且零文件创建。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ALLOWED_WRITE_ROOT } from './src/writeguard.ts'

const POC_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(POC_DIR, 'poc-run.mjs')

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function runPoc(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      cwd: POC_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

let tmpRoot = ''
beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'poc-run-neg-'))
})
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('poc-run.mjs（argv-only 入口）', () => {
  it('--fixture 成功文件：打印事件数与 unknowns 数，退出 0', () => {
    const r = runPoc(['--fixture', 'fixtures/success-run.jsonl'])
    expect(r.stderr).toBe('')
    expect(r.stdout).toMatch(/events=5/)
    expect(r.stdout).toMatch(/problems=0/)
    expect(r.stdout).toMatch(/unknowns=\d+/)
    expect(r.stdout).toContain('结果=OK')
  })

  it('--export 写 .poc-data/v3/ 且同输入两次导出逐字节一致（硬规则 3 幂等）', () => {
    const rel = path.join('.poc-data', 'v3', 'poc-run-export-test.jsonl')
    const outAbs = path.join(POC_DIR, rel)
    rmSync(outAbs, { force: true })
    const first = runPoc(['--fixture', 'fixtures/two-analyses.jsonl', '--export', rel])
    expect(first.stderr).toBe('')
    expect(first.stdout).toContain('exported=')
    const bytes1 = readFileSync(outAbs)
    const second = runPoc(['--fixture', 'fixtures/two-analyses.jsonl', '--export', rel])
    const bytes2 = readFileSync(outAbs)
    expect(bytes2.equals(bytes1)).toBe(true)
    expect(first.stdout.match(/bytes=(\d+)/)![1]).toBe(String(bytes1.length))
    rmSync(outAbs, { force: true })
  })

  it('坏 fixture（断号）：退出 1、stderr 指明 kind，不落任何导出', () => {
    const bad = path.join(tmpRoot, 'gap.jsonl')
    const line = {
      schema: 'poc/prov-envelope/v0',
      source_project: 'neg(P0-synthetic)',
      run_id: 'RUN-NEG-2',
      event_seq: 0,
      occurred_at: '2026-03-01T00:00:00Z',
      recorded_at: '2026-03-01T00:00:30Z',
      snapshot_ref: { kind: 'deck', id: 'decks/neg.in', content_sha256: null },
      access_boundary: 'synthetic',
      channel: 'SOURCE_RECORD',
      kind: 'run.started',
      payload: {},
      unknowns: ['合成断号样本'],
    }
    const bad2 = { ...line, event_seq: 2, kind: 'run.finished' }
    writeFileSync(bad, `${JSON.stringify(line)}\n${JSON.stringify(bad2)}\n`, 'utf8')
    const r = runPoc(['--fixture', bad, '--export', path.join('.poc-data', 'v3', 'should-not-exist.jsonl')])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('event_seq_gap')
    expect(existsSync(path.join(POC_DIR, '.poc-data', 'v3', 'should-not-exist.jsonl'))).toBe(false)
  })

  it('--export 越出 .poc-data/v3/：FATAL 拒绝且零文件创建（writeguard 接线）', () => {
    const outside = path.join(tmpRoot, 'smuggled-export.jsonl')
    const r = runPoc(['--fixture', 'fixtures/success-run.jsonl', '--export', outside])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('FATAL')
    expect(existsSync(outside)).toBe(false)
    expect(existsSync(path.join(POC_DIR, '..', '..', 'src', 'poc-run-smuggled.ts'))).toBe(false)
  })

  it('用法错误缺参数：退出 2', () => {
    expect(runPoc([]).status).toBe(2)
    expect(runPoc(['--bogus-flag']).status).toBe(2)
  })

  it('导出文件确实位于允许写入区内', () => {
    const rel = path.join('.poc-data', 'v3', 'poc-run-placement-test.jsonl')
    const r = runPoc(['--fixture', 'fixtures/weak-association.jsonl', '--export', rel])
    const exported = r.stdout.match(/exported=(\S+)/)![1]!
    expect(exported.startsWith(ALLOWED_WRITE_ROOT + path.sep)).toBe(true)
    rmSync(path.join(POC_DIR, rel), { force: true })
  })
})
