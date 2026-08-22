/**
 * 文件名 ↔ id 一致性校验助手 — DOMAIN_SCHEMA.md §1.1 规则 2/3 (L49-50) and
 * §14 规则 (L606):
 *
 *   「文件名/目录名中的 `<id>` 即对象 ID（加载期与文件内 `id` 字段核对）」；
 *   「声明式对象的 ID 同步持久化于文件名与文件内 `id` 字段，二者必须一致
 *   （加载期校验）」；「加载期发现文件名与 `id` 不一致即报错」。
 *
 * Scope of this helper (WP-1.6): it checks the FILENAME face — the id
 * carried by a file's own name vs the declared `id` field. DIRECTORY-segment
 * ids (`.research/topics/<topic-id>/`, `workstreams/<ws-id>/`, §14) and the
 * schema-level kind expectation (a `tasks/` file must carry a `T` id) are
 * the WP-1.1 loader's validation; this helper stays kind-agnostic so both
 * consumers compose it.
 *
 * Pure function surface (zero I/O, WP-1.6 boundary): paths are plain
 * strings, POSIX or Windows separators.
 */

import { parseId } from './parse.js'

/**
 * Outcome of the §1.1 rule-2/3 load-time check:
 *   - `match`         — filename carries a well-formed id equal to `declaredId`;
 *   - `mismatch`      — filename carries a well-formed id DIFFERENT from
 *                        `declaredId` (加载期报错 per §1.1 rule 3);
 *   - `no-id-in-name` — the filename carries no well-formed id (e.g.
 *                        `plan.yaml`, `topology.yaml`): the rule imposes no
 *                        constraint, the caller decides applicability.
 */
export interface FileNameIdCheck {
  readonly status: 'match' | 'mismatch' | 'no-id-in-name'
  /** The well-formed id carried by the filename (absent for `no-id-in-name`). */
  readonly fileNameId?: string
  /** The declared `id` field under check. */
  readonly declaredId: string
}

/**
 * Extract the id carried by a filename or path: the basename with its last
 * extension removed must itself be a well-formed research id (§1.1) —
 * `items/tasks/T-1.yaml` → `T-1`, `TE-17.yaml` → `TE-17`, `workstream.yaml`
 * → `null` (no id in the name).
 *
 * @returns the well-formed id, or `null` when the name carries none.
 */
export function idFromFileName(fileNameOrPath: string): string | null {
  const basename = fileNameOrPath.split(/[\\/]/).pop() ?? ''
  const dot = basename.lastIndexOf('.')
  // `dot > 0` keeps extension-less names intact and ignores dotfiles like
  // `.gitkeep` (a leading dot is not an extension separator here).
  const stem = dot > 0 ? basename.slice(0, dot) : basename
  return parseId(stem) !== null ? stem : null
}

/**
 * §1.1 rule-2/3 load-time check: does the id in the filename equal the
 * declared `id` field? See {@link FileNameIdCheck} for the three outcomes.
 * String equality suffices: both sides are canonical `<PREFIX>-<positive
 * integer>` strings (the declared side is validated against the same
 * frozen regex upstream).
 */
export function checkFileNameId(fileNameOrPath: string, declaredId: string): FileNameIdCheck {
  const fileNameId = idFromFileName(fileNameOrPath)
  if (fileNameId === null) {
    return { status: 'no-id-in-name', declaredId }
  }
  if (fileNameId === declaredId) {
    return { status: 'match', fileNameId, declaredId }
  }
  return { status: 'mismatch', fileNameId, declaredId }
}
