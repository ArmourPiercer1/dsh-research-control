/**
 * WP-1.1 test double — in-memory `ResearchFileReader` fake (TC-DOM-027 brief:
 * "内存版 FileReader 假实现"). Directory listings are derived from registered
 * file paths; empty directories are unrepresentable and irrelevant (the
 * loader treats "no entries" identically to "directory absent").
 */
import type { DirEntry, ResearchFileReader } from '../../src/host/domain/loader/index.js'

/** POSIX normalize (mirrors the domain's `pjoin` semantics for test paths). */
export function norm(p: string): string {
  const absolute = p.startsWith('/')
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  return (absolute ? '/' : '') + parts.join('/')
}

export class MemoryReader implements ResearchFileReader {
  private files = new Map<string, string>()
  /** Explicitly existing (possibly empty) directories — real fs can have them. */
  private dirs = new Set<string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(norm(path), content)
  }

  addFile(path: string, content: string): this {
    this.files.set(norm(path), content)
    return this
  }

  /** Register an existing directory even when it has no files (e.g. `merges/TE-2/`
   *  with its `contract.md` deleted). Ancestors are registered implicitly, as in
   *  a real filesystem. */
  addDir(path: string): this {
    const p = norm(path)
    const parts = p.split('/')
    for (let i = 1; i <= parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join('/'))
    }
    return this
  }

  hasFile(path: string): boolean {
    return this.files.has(norm(path))
  }

  readFile(path: string): string | null {
    return this.files.get(norm(path)) ?? null
  }

  readDir(path: string): DirEntry[] | null {
    const dir = norm(path)
    const prefix = dir === '/' ? '/' : `${dir}/`
    const kinds = new Map<string, DirEntry['kind']>()
    for (const p of this.files.keys()) {
      if (p === dir || !p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash === -1 ? rest : rest.slice(0, slash)
      const kind: DirEntry['kind'] = slash === -1 ? 'file' : 'directory'
      const prev = kinds.get(name)
      if (prev === undefined || (prev === 'file' && kind === 'directory')) kinds.set(name, kind)
    }
    // Explicitly registered (possibly empty) subdirectories become entries too;
    // a file of the same name wins (inconsistent fixtures are not our concern).
    for (const d of this.dirs) {
      if (d === dir || !d.startsWith(prefix)) continue
      const rest = d.slice(prefix.length)
      if (rest.includes('/')) continue
      const prev = kinds.get(rest)
      if (prev === undefined) kinds.set(rest, 'directory')
    }
    if (kinds.size === 0 && !this.dirs.has(dir)) return null
    return [...kinds.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, kind]) => ({ name, kind }))
  }
}
