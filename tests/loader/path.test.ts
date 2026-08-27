/**
 * WP-1.1 — `pjoin` / `psegments`: the kernel's platform-free path join.
 *
 * Two contracts are pinned here:
 *   1. POSIX behavior is UNCHANGED (the `.research/` layout is POSIX-style
 *      by contract, §14 — every existing consumer relies on it);
 *   2. Windows-NATIVE host roots (the DSH host hands native workspace
 *      paths through — on Windows a drive path like `D:\Projects\…`) are
 *      joined and `..`-resolved correctly instead of collapsing: the old
 *      POSIX-only join split on `/` only, so `C:\…\schema\declarative` +
 *      `..` lost the drive entirely and produced a bare relative filename
 *      (the frozen schema set "not found" on every Windows startup).
 *
 * The output is normalized to forward slashes — legal on both platforms
 * (the Windows file APIs accept `/`) — and the injected reader maps it
 * onto the host FS.
 */
import { describe, expect, it } from 'vitest'

import { pjoin, psegments } from '../../src/host/domain/loader/index.js'

describe('pjoin — POSIX behavior (unchanged contract)', () => {
  it.each([
    [['/a/b/c'], '/a/b/c'],
    [['/a/b', '..', 'c'], '/a/c'],
    [['/a/b', '..', '..', 'x'], '/x'],
    [['/a', 'b/c'], '/a/b/c'],
    [['/a/b', '.'], '/a/b'],
    [['/'], '/'],
    [['a/b', '..', 'c'], 'a/c'],
    [['a', '..', '..'], '..'],
    [['x', '..', '..', 'y'], '../y'],
    [['a', 'b'], 'a/b'],
    [[], ''],
  ])('pjoin(%j) → %j', (segments, expected) => {
    expect(pjoin(...segments)).toBe(expected)
  })
})

describe('pjoin — Windows-native host roots (drive / UNC / mixed separators)', () => {
  it.each([
    // drive root + in-tree relative (the researchRoot join)
    [['D:\\Projects\\AIUED', 'project.yaml'], 'D:/Projects/AIUED/project.yaml'],
    // the production failure shape: schemaDir + `..` → common.schema.json
    // (the user's real path: node_modules install under the profile home)
    [
      ['C:\\Users\\user\\.dsh\\profiles\\web\\node_modules\\dsh-research-control\\schema\\declarative', '..', 'common.schema.json'],
      'C:/Users/user/.dsh/profiles/web/node_modules/dsh-research-control/schema/common.schema.json',
    ],
    // forward-slash Windows spelling
    [['C:/a/b', '..', 'c'], 'C:/a/c'],
    // `..` clamps at the drive root (never climbs past it)
    [['C:\\a', '..', '..'], 'C:/'],
    [['C:\\a\\b', '..', '..', '..', 'c'], 'C:/c'],
    // UNC root (backslash + forward-slash spellings)
    [['\\\\server\\share\\x', '..', 'y'], '//server/share/y'],
    [['//server/share/x', '..', 'y'], '//server/share/y'],
    [['\\\\s\\sh', '..', '..'], '//'],
    // mixed separators in one path (legal on Win32)
    [['D:\\x\\y', 'z\\w'], 'D:/x/y/z/w'],
    [['D:\\x\\y/', 'z'], 'D:/x/y/z'],
    // bare drive root
    [['C:'], 'C:/'],
    [['C:', 'x'], 'C:/x'],
    // drive-RELATIVE is not a root — joined as ordinary parts (unchanged)
    [['D:foo', 'bar'], 'D:foo/bar'],
    // lowercase drive preserved as-is
    [['c:\\a\\b', 'c'], 'c:/a/b/c'],
  ])('pjoin(%j) → %j', (segments, expected) => {
    expect(pjoin(...segments)).toBe(expected)
  })
})

describe('psegments — both separators', () => {
  it.each([
    ['/a/b/c', ['a', 'b', 'c']],
    ['a/.//b', ['a', 'b']],
    ['D:\\x\\y', ['D:', 'x', 'y']],
    ['C:/x/y', ['C:', 'x', 'y']],
    ['\\\\s\\sh\\d', ['s', 'sh', 'd']],
  ])('psegments(%j) → %j', (path, expected) => {
    expect(psegments(path)).toEqual(expected)
  })
})
