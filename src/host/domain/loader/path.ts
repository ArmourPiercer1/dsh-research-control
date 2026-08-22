/**
 * WP-1.1 — minimal POSIX path join for the pure domain kernel.
 *
 * The domain layer must not import Node builtins (ARCHITECTURE §2.2 rule 1:
 * pure logic, no I/O — `node:path` is avoided so this module stays
 * platform-free and the kernel has zero runtime deps outside the schema
 * tooling). All `.research/` layout paths are POSIX-style by contract (§14);
 * the injected reader is responsible for mapping onto the host FS.
 */

/**
 * Join path segments POSIX-style, resolving `.` and `..`.
 * A leading `/` on the FIRST segment (absolute reader paths) is preserved;
 * later absolute segments are joined like `path.join`.
 */
export function pjoin(...segments: string[]): string {
  const absolute = segments.length > 0 && segments[0]!.startsWith('/')
  const out: string[] = []
  for (const segment of segments) {
    for (const part of segment.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
        else if (!absolute) out.push('..')
        continue
      }
      out.push(part)
    }
  }
  return (absolute ? '/' : '') + out.join('/')
}

/** Split a POSIX path into its segments (no empty parts, no `.`/`..`). */
export function psegments(path: string): string[] {
  return path.split('/').filter((part) => part !== '' && part !== '.')
}
