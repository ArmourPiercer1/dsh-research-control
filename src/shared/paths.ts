/**
 * Cross-platform absolute-path predicate — the single runtime source of
 * truth for 「this value must be an absolute path」 validation.
 *
 * `node:path.isAbsolute` answers 「absolute ON THE CURRENT PLATFORM」: a
 * Windows workspace path (`D:\Projects\…`) is rejected when the plugin
 * runs (or is tested) on POSIX, and vice versa. The plugin must accept
 * paths from EVERY platform it serves — the DSH host hands it native
 * workspace paths, and the registry stores them verbatim (the frozen
 * `ABSOLUTE_PATH_PATTERN` rule) — so the runtime predicate is
 * platform-agnostic by design:
 *
 *  - POSIX root:     `/…`
 *  - Windows drive:  `C:\…` (backslash) or `C:/…` (forward slash)
 *  - Windows UNC:    `\\server\share\…`
 *
 * The identical regex is pinned (by contract, kept verbatim) in
 * `host/domain/registry/schemas.ts` (`ABSOLUTE_PATH_PATTERN`) and
 * `shared/rpc-contracts.ts` (`absolutePath`) — registry entries and RPC
 * args validate with the same rule. This module exists so the HOST
 * runtime checks (wiring / hardening / investigator / scaffold) share one
 * implementation instead of hand-rolling `startsWith('/')`.
 *
 * Relative paths, bare names, empty strings, and non-strings are rejected.
 * Regex-based on purpose: no `node:` import, usable from any layer.
 */

/** Matches a POSIX root, a Windows drive root, or a UNC root. */
export const CROSS_PLATFORM_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\|\/)/

/**
 * `true` when `value` is a non-empty string that is an absolute path on
 * SOME platform (POSIX or Windows).
 */
export function isAbsolutePath(value: unknown): boolean {
  return typeof value === 'string' && CROSS_PLATFORM_ABSOLUTE_PATH_PATTERN.test(value)
}
