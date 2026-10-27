/**
 * 封存门红→绿矩阵（B+，审查/B+ 纪律：改规则内核必须同 PR 演示正反 PoC）。
 * 真树（仓内 docs/architecture/superseded）走 --verify；合成世界在 tmp 里
 * 复刻整棵树 + 手工跑脚本（cwd 注入 ROOT 不可行——脚本 ROOT 固定为仓根，
 * 故真树的破坏性用例用「先备份再还原」实现，绝不留下改动）。
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'seal-superseded.mjs')
const run = (arg?: string) => {
  try {
    return { rc: 0, out: execFileSync(process.execPath, [SCRIPT, ...(arg ? [arg] : [])], { encoding: 'utf8' }) }
  } catch (e) {
    return { rc: (e as { status?: number }).status ?? -1, out: `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}` }
  }
}

describe('seal-superseded 门（真树）', () => {
  it('仓内当前封存态 --verify 绿（空树或全登记均算在场）', () => {
    const r = run('--verify')
    expect(r.rc, r.out).toBe(0)
  })
})

describe('seal-superseded 门（真树破坏→还原）', () => {
  const TREE = join(REPO, 'docs', 'architecture', 'superseded')
  const probe = join(TREE, '__seal_probe__.md')
  const backup = new Map<string, string>()

  const snapshotTree = () => {
    backup.clear()
    try {
      for (const f of ['SEAL.yaml', '__seal_probe__.md']) {
        try { backup.set(f, readFileSync(join(TREE, f), 'utf8')) } catch { /* absent */ }
      }
    } catch { /* no tree yet */ }
  }
  const restoreTree = () => {
    mkdirSync(TREE, { recursive: true })
    for (const [f, v] of backup) writeFileSync(join(TREE, f), v)
    try { rmSync(probe, { force: true }) } catch { /* ok */ }
    if (!backup.has('SEAL.yaml')) { try { rmSync(join(TREE, 'SEAL.yaml'), { force: true }) } catch { /* ok */ } }
  }

  beforeAll(snapshotTree)
  afterAll(restoreTree)

  it('UNSEALED_FILE：树内塞未登记文件 → 红；删除后 → 绿', () => {
    mkdirSync(TREE, { recursive: true })
    writeFileSync(probe, '# probe\n')
    let r = run('--verify')
    expect(r.rc, r.out).toBe(1)
    expect(r.out).toContain('UNSEALED_FILE')
    rmSync(probe, { force: true })
    r = run('--verify')
    expect(r.rc, r.out).toBe(0)
  })

  it('--write 追加哈希登记后需人工 origin，UNKNOWN 不放行', () => {
    mkdirSync(TREE, { recursive: true })
    writeFileSync(probe, '# probe v1\n')
    let r = run('--write')
    expect(r.rc, r.out).toBe(0)
    r = run('--verify')
    expect(r.out).toContain('SEAL_ORIGIN_UNKNOWN') // origin 未补 → 仍红
    // 人工补 origin 后绿
    const man = join(TREE, 'SEAL.yaml')
    writeFileSync(man, readFileSync(man, 'utf8').replace(/origin=UNKNOWN[^\n]*/, 'origin=__seal_probe__ 测试件 · PR #0 · 用完即删'))
    r = run('--verify')
    expect(r.rc, r.out).toBe(0)
    // 篡改已封存原件 → 红（append-only 机验）
    appendFileSync(probe, 'tamper\n')
    r = run('--verify')
    expect(r.out).toContain('SEALED_TAMPERED')
    // 清单指树外 → 红
    writeFileSync(man, readFileSync(man, 'utf8').replace(`- docs/architecture/superseded/__seal_probe__.md`, '- package.json'))
    r = run('--verify')
    expect(r.out).toContain('SEALED_ESCAPE')
  })
})
