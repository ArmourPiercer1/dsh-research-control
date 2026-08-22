/**
 * src/shared/ids — public surface (WP-1.6).
 *
 * Pure types + pure functions, zero I/O, zero DSH imports:
 *   - types.ts     — ObjectKind (24, §1.3) / IdKind (25, §1.1) / UniquenessScope
 *   - registry.ts  — the 25 frozen §1.1 prefix rows + exact lookups
 *   - parse.ts     — longest-prefix-first parse (规则 4) + validation
 *   - construct.ts — canonical id construction (§1.1 format)
 *   - file-name.ts — 文件名 ↔ id 一致性 helpers (§1.1 规则 2/3, §14)
 *   - allocator.ts — per-project monotonic counter allocation +
 *                    reserve/commit/release (injected IdCounterPort)
 */

export * from './types.js'
export * from './registry.js'
export * from './parse.js'
export * from './construct.js'
export * from './file-name.js'
export * from './allocator.js'
