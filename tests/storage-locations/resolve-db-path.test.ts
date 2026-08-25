/**
 * V2-T2.4 — `resolveDbPath` / `resolveDbDir` (design §3.3 数据库布局):
 * the MANAGED/STANDALONE placement matrix + the fail-loud points
 * (TC-DSH-008 style — the storage-locations layer never guesses a
 * location).
 */
import { describe, expect, it } from 'vitest'

import {
  resolveDbDir,
  resolveDbPath,
  StorageLocationsError,
  type DbPlacementInput,
} from '../../src/host/service/storage-locations/index.js'

const HUB = '/workspaces/hub'
const WS = '/workspaces/proj'

function input(over: Partial<DbPlacementInput> = {}): DbPlacementInput {
  return {
    kind: 'MANAGED',
    projectId: 'PRJ-1',
    hubPath: HUB,
    wsPath: WS,
    hubDir: '.research-control',
    treeDir: '.research',
    ...over,
  }
}

describe('resolveDbPath — the §3.3 layout (pure, parameterized dir names)', () => {
  it('MANAGED → <hub>/<hubDir>/projects/<projectId>/research.sqlite (per-project db under the hub)', () => {
    expect(resolveDbPath(input())).toBe(
      '/workspaces/hub/.research-control/projects/PRJ-1/research.sqlite',
    )
  })

  it('STANDALONE → <ws>/<treeDir>/state/research.sqlite (the db lives in the tree, no hub needed)', () => {
    expect(resolveDbPath(input({ kind: 'STANDALONE', hubPath: null }))).toBe(
      '/workspaces/proj/.research/state/research.sqlite',
    )
  })

  it('STANDALONE ignores the hub path (a hub may exist elsewhere — the tree is simply unregistered)', () => {
    expect(resolveDbPath(input({ kind: 'STANDALONE', hubPath: '/workspaces/hub' }))).toBe(
      '/workspaces/proj/.research/state/research.sqlite',
    )
  })

  it('honors the T2.1-renamed dir names (discovery only ever sees configured names)', () => {
    expect(resolveDbPath(input({ hubDir: 'my-hub' }))).toBe(
      '/workspaces/hub/my-hub/projects/PRJ-1/research.sqlite',
    )
    expect(resolveDbPath(input({ kind: 'STANDALONE', hubPath: null, treeDir: 'my-tree' }))).toBe(
      '/workspaces/proj/my-tree/state/research.sqlite',
    )
  })

  it('is the db FILE path (the wiring consumes the DIRECTORY via resolveDbDir)', () => {
    expect(resolveDbDir(input())).toBe('/workspaces/hub/.research-control/projects/PRJ-1')
    expect(resolveDbDir(input({ kind: 'STANDALONE', hubPath: null }))).toBe(
      '/workspaces/proj/.research/state',
    )
    expect(resolveDbPath(input())).toBe(`${resolveDbDir(input())}/research.sqlite`)
  })

  it('MANAGED without a hub path fails loud (a discovery invariant break — never guess)', () => {
    try {
      resolveDbPath(input({ hubPath: null }))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(StorageLocationsError)
      expect((e as StorageLocationsError).code).toBe('MANAGED_WITHOUT_HUB')
      expect((e as Error).message).toContain('hubPath')
    }
  })

  it('empty/unknown inputs fail loud with INVALID_INPUT (never a silent fallback)', () => {
    const bad: Array<Partial<DbPlacementInput>> = [
      { projectId: '' },
      { wsPath: '' },
      { hubDir: '' },
      { treeDir: '' },
      { kind: 'SOMETHING_ELSE' as never },
    ]
    for (const over of bad) {
      expect(() => resolveDbPath(input(over))).toThrow(StorageLocationsError)
      try {
        resolveDbPath(input(over))
      } catch (e) {
        expect((e as StorageLocationsError).code).toBe('INVALID_INPUT')
      }
    }
  })
})
