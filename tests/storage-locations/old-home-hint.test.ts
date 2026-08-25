/**
 * V2-T2.4 — `hintOldDbHome` / `findOldDbHomeProjectDirs` (design §3.3:
 * the retired V1 `$DSH_HOME/research-control/<id>/` layout): the probe
 * returns the one-time startup migration SUGGESTION line — and ONLY
 * that (no automatic migration by design, §14).
 */
import { describe, expect, it } from 'vitest'

import {
  findOldDbHomeProjectDirs,
  hintOldDbHome,
  OLD_DB_HOME_SEGMENT,
} from '../../src/host/service/storage-locations/index.js'
import { FakeFs } from './fake-fs.js'

const HOME = '/home/op/.dsh'
const OLD_ROOT = `${HOME}/${OLD_DB_HOME_SEGMENT}`

function fsWith(entries: Record<string, 'file' | 'dir'> = {}) {
  const files: Record<string, string> = {}
  const dirs: string[] = []
  for (const [name, kind] of Object.entries(entries)) {
    const p = `${OLD_ROOT}/${name}`
    if (kind === 'file') files[p] = 'legacy bytes'
    else dirs.push(p)
  }
  return new FakeFs({ files, dirs })
}

describe('findOldDbHomeProjectDirs — the V1 legacy layout probe', () => {
  it('no legacy root → [] (nothing to say)', () => {
    expect(findOldDbHomeProjectDirs(HOME, new FakeFs({}))).toEqual([])
  })

  it('an empty-string home → [] (defensive — never throw at the startup log)', () => {
    expect(findOldDbHomeProjectDirs('', new FakeFs({}))).toEqual([])
  })

  it('an EMPTY legacy root → [] (a bare directory is not a project db)', () => {
    const fs = fsWith({})
    expect(findOldDbHomeProjectDirs(HOME, fs)).toEqual([])
  })

  it('lists only DIRECTORIES (a stray file next to the project dirs is not a project id)', () => {
    const fs = fsWith({
      'PRJ-2': 'dir',
      'PRJ-1': 'dir',
      'stale-lock': 'file',
    })
    expect(findOldDbHomeProjectDirs(HOME, fs)).toEqual(['PRJ-1', 'PRJ-2']) // sorted
  })
})

describe('hintOldDbHome — the one-time startup suggestion (design §3.3 日志提示，不自动搬)', () => {
  it('no legacy layout → null (the startup log stays quiet)', () => {
    expect(hintOldDbHome(HOME, fsWith({}))).toBeNull()
  })

  it('legacy dirs present → one self-contained line naming every dir, with the manual-move guidance', () => {
    const fs = fsWith({ 'PRJ-2': 'dir', 'PRJ-1': 'dir', 'stray': 'file' })
    const hint = hintOldDbHome(HOME, fs)
    expect(hint).not.toBeNull()
    // every legacy project dir is named (full paths — the operator copies
    // them), in sorted order
    expect(hint).toContain(`${OLD_ROOT}/PRJ-1`)
    expect(hint).toContain(`${OLD_ROOT}/PRJ-2`)
    expect(hint!.indexOf('PRJ-1')).toBeLessThan(hint!.indexOf('PRJ-2'))
    // the stray file is NOT reported as a project
    expect(hint).not.toContain(`${OLD_ROOT}/stray`)
    // the guidance: manual move, the V2 locations, NO automatic migration
    expect(hint).toContain('manually')
    expect(hint).toContain('does not migrate them automatically')
    expect(hint).toContain('§3.3')
  })
})
