/**
 * WP-1.1 — minimal path join for the pure domain kernel.
 *
 * The domain layer must not import Node builtins (ARCHITECTURE §2.2 rule 1:
 * pure logic, no I/O — `node:path` is avoided so this module stays
 * platform-free and the kernel has zero runtime deps outside the schema
 * tooling). All `.research/` layout paths are POSIX-style by contract (§14);
 * the injected reader is responsible for mapping onto the host FS.
 *
 * Host ROOTS (`schemaDir`, `researchRoot`) arrive in platform-native shape
 * — the DSH host hands the plugin native workspace paths, and on Windows
 * that is a drive path like `D:\Projects\…` — so `pjoin` treats BOTH `/`
 * and `\` as separators and preserves the absolute prefix of the FIRST
 * segment:
 *
 *   - POSIX root:   `/…`
 *   - Drive root:   `C:\…` or `C:/…`
 *   - UNC root:     `\\server\share\…` or `//server/share/…`
 *
 * (Same recognition as the frozen `ABSOLUTE_PATH_PATTERN` twins in
 * `host/domain/registry/schemas.ts` / `shared/rpc-contracts.ts`.) The
 * OUTPUT is always normalized to forward slashes — legal on BOTH platforms
 * (the Windows file APIs accept `/`), byte-identical to the old behavior
 * for pure POSIX input — and the injected reader maps it onto the host FS.
 * `..` resolution that would climb past an absolute root is clamped (POSIX
 * root, drive root, or UNC root alike).
 */

/**
 * The absolute prefix the FIRST segment may carry (see the module doc):
 * POSIX `/`, a Windows drive (`C:` + separator, or a bare `C:`), or UNC
 * (`\\…` / `//…`). Drive-relative paths (`C:foo`) are NOT roots and pass
 * through as ordinary parts. Returns `[prefix, body]`.
 */
function splitRoot(segment: string): [string, string] {
  // UNC first: `//…` also starts with `/`, and on Windows the
  // forward-slash form is the valid UNC spelling.
  if (segment.startsWith('\\\\') || segment.startsWith('//')) return ['//', segment.slice(2)]
  if (segment.startsWith('/')) return ['/', segment.slice(1)]
  const drive = /^([A-Za-z]:)([\\/])(.*)$/.exec(segment)
  if (drive) return [drive[1]!, drive[3]!]
  if (/^[A-Za-z]:$/.test(segment)) return [segment, '']
  return ['', segment]
}

/**
 * Join path segments, resolving `.` and `..`. Both `/` and `\` act as
 * separators (host roots arrive in platform-native shape); the absolute
 * prefix of the FIRST segment (POSIX `/`, drive `C:`, UNC `//`) is
 * preserved; later absolute segments are joined like `path.join`.
 * Output is normalized to forward slashes.
 */
export function pjoin(...segments: string[]): string {
  if (segments.length === 0) return ''
  const [prefix, firstBody] = splitRoot(segments[0]!)
  const absolute = prefix !== ''
  const out: string[] = []
  const pushParts = (raw: string): void => {
    for (const part of raw.split(/[\\/]/)) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
        else if (!absolute) out.push('..')
        continue
      }
      out.push(part)
    }
  }
  pushParts(firstBody)
  for (let i = 1; i < segments.length; i++) pushParts(segments[i]!)
  if (out.length === 0) return prefix.endsWith(':') ? `${prefix}/` : prefix
  // a drive prefix needs the separator re-joined; `/` and `//` carry it.
  return prefix.endsWith(':') ? `${prefix}/${out.join('/')}` : `${prefix}${out.join('/')}`
}

/** Split a path into its segments (no empty parts, no `.`); both separators. */
export function psegments(path: string): string[] {
  return path.split(/[\\/]/).filter((part) => part !== '' && part !== '.')
}
