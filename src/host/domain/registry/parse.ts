/**
 * V2-T2.3 — `parseRegistry`: `registry.yaml` text → `RegistryFile`,
 * fail-loud (design §3.2 校验纪律 + §4 step 4 「畸形 → fail-loud」).
 *
 * Pipeline (precisely-located errors, the WP-1.1 loader discipline —
 * TC-DOM-027 style file + position + summary):
 *
 *  1. YAML parse (`yaml#parseAllDocuments`, strict single document —
 *     the loader's readYamlDoc precedent): syntax errors, duplicate
 *     mapping keys, and a second `---` document all land in the
 *     library's `doc.errors` with their 1-based line/column → `PARSE`;
 *  2. top-level shape: must be a mapping (empty/comment-only file, a
 *     sequence, a scalar → `NOT_MAPPING`, the document's line);
 *  3. strict zod validation (`RegistryFileSchema`, `.strict()`):
 *     unknown keys, missing keys, wrong types, the PRJ id pattern, the
 *     absolute-path rule, the status enum, the `version: 1` literal,
 *     the timestamp shapes → `SCHEMA`. Each zod issue is mapped BACK to
 *     a source line by walking the parsed document tree (the issue's
 *     JSON-pointer path → node source range → line/col);
 *  4. cross-entry uniqueness: duplicate project id → `DUPLICATE_ID`
 *     (lines of the FIRST and the duplicate occurrence);
 *  5. cross-field: the status↔archivedAt rule → `STATUS_TIMESTAMP` with
 *     the entry's line.
 *
 * Unlike the tree loader (which aggregates errors across many files so
 * one broken file never blocks the rest), the registry is a SINGLE file
 * that is the hub's source of truth — the first violation throws a
 * {@link RegistryFormatError} (no partial-parse semantics). Every
 * message is self-contained so it rides verbatim into the startup log;
 * the structured `line`/`col`/`pointer` fields carry the 行级信息.
 */

import { parseAllDocuments, YAMLMap, YAMLSeq, type Document, type Node } from 'yaml'

import {
  assertEntryTimestampConsistency,
  formatZodPointer,
  RegistryFileSchema,
} from './schemas.js'
import { freezeRegistryFile, RegistryFormatError, type RegistryFile } from './types.js'

/**
 * Parse the full `registry.yaml` text.
 *
 * @param text - the complete file content (the caller reads the file —
 *  this module performs no I/O, ARCHITECTURE §2.2 rule 1).
 * @returns the parsed, deep-frozen registry file.
 * @throws {RegistryFormatError} on the FIRST violation (codes PARSE /
 *  NOT_MAPPING / SCHEMA / DUPLICATE_ID / STATUS_TIMESTAMP; `line`/`col`
 *  /`pointer` set when resolvable).
 */
export function parseRegistry(text: string): RegistryFile {
  const newlineIdx = buildNewlineIndex(text)

  // ---- 1. YAML parse (strict single document) -------------------------
  const docs = parseAllDocuments(text)
  const substantive = docs.filter((d) => d.errors.length > 0 || (d.contents !== null && d.contents !== undefined))
  if (substantive.length === 0) {
    throw new RegistryFormatError(
      'NOT_MAPPING',
      'registry.yaml is empty or comment-only (expected a mapping with "version" and "projects")',
    )
  }
  if (substantive.length > 1) {
    throw new RegistryFormatError(
      'PARSE',
      `registry.yaml contains ${String(substantive.length)} YAML documents (expected exactly one)`,
    )
  }
  const doc = substantive[0]!
  if (doc.errors.length > 0) {
    const err = doc.errors[0]!
    // yaml 2.x error `linePos` is 1-based (verified: it matches the
    // 1-based "at line N, column M" text embedded in `err.message`).
    const first = err.linePos?.[0]
    const where = first ? ` at line ${String(first.line)}, column ${String(first.col)}` : ''
    throw new RegistryFormatError(
      'PARSE',
      `YAML parse failed${where}: ${String(err.message).split('\n')[0]}`,
      { line: first?.line, col: first?.col },
    )
  }

  // ---- 2. top-level shape ---------------------------------------------
  const root = doc.contents
  if (root === null || root === undefined || !(root instanceof YAMLMap)) {
    const what =
      root === null
        ? 'an empty document'
        : root instanceof YAMLSeq
          ? 'a sequence'
          : `a scalar (${describeScalar(root)})`
    const line =
      root !== null && root.range !== undefined && root.range !== null
        ? positionAt(text, newlineIdx, root.range[0]).line
        : undefined
    throw new RegistryFormatError(
      'NOT_MAPPING',
      `registry.yaml must be a top-level mapping with "version" and "projects" (got ${what})`,
      { line },
    )
  }

  let value: unknown
  try {
    value = doc.toJS()
  } catch (cause) {
    throw new RegistryFormatError(
      'PARSE',
      `YAML document could not be converted to JS: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  // ---- 3. strict schema validation (line-mapped) -----------------------
  const result = RegistryFileSchema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]!
    const pointer = formatZodPointer(issue.path)
    const loc = locationOf(doc, text, newlineIdx, issue.path)
    const where = loc !== undefined ? `line ${String(loc.line)}: ` : ''
    throw new RegistryFormatError(
      'SCHEMA',
      `${where}${issue.message} (at ${pointer})`,
      { line: loc?.line, col: loc?.col, pointer },
    )
  }

  const file = result.data

  // ---- 4. cross-entry id uniqueness -------------------------------------
  const firstLineById = new Map<string, number | undefined>()
  for (let i = 0; i < file.projects.length; i += 1) {
    const entry = file.projects[i]!
    const loc = locationOf(doc, text, newlineIdx, ['projects', i, 'id'])
    if (firstLineById.has(entry.id)) {
      const firstLine = firstLineById.get(entry.id)
      throw new RegistryFormatError(
        'DUPLICATE_ID',
        `duplicate project id ${JSON.stringify(entry.id)} at line ${String(loc?.line ?? '?')} ` +
          `(first declared at line ${String(firstLine ?? '?')})`,
        { line: loc?.line, pointer: `/projects/${i}/id` },
      )
    }
    firstLineById.set(entry.id, loc?.line)
  }

  // ---- 5. status↔archivedAt cross-field rule ----------------------------
  for (let i = 0; i < file.projects.length; i += 1) {
    const entry = file.projects[i]!
    const problem = assertEntryTimestampConsistency(entry)
    if (problem !== null) {
      const loc = locationOf(doc, text, newlineIdx, ['projects', i, 'archivedAt'])
      const where = loc !== undefined ? `line ${String(loc.line)}: ` : ''
      throw new RegistryFormatError(
        'STATUS_TIMESTAMP',
        `${where}entry ${JSON.stringify(entry.id)}: ${problem}`,
        { line: loc?.line, pointer: `/projects/${i}/archivedAt` },
      )
    }
  }

  return freezeRegistryFile(file)
}

/* ------------------------------------------------------------------ *
 * Source-location resolution (yaml node range → 1-based line/col)
 * ------------------------------------------------------------------ */

interface Position {
  line: number
  col: number
}

/** Offsets of every '\n' in the source (precomputed once per parse). */
function buildNewlineIndex(text: string): number[] {
  const idx: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) idx.push(i)
  }
  return idx
}

/** 1-based line/col of a source offset (binary search over newlines). */
function positionAt(text: string, newlineIdx: number[], offset: number): Position {
  let lo = 0
  let hi = newlineIdx.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (newlineIdx[mid]! < offset) lo = mid + 1
    else hi = mid
  }
  const line = lo // number of '\n' strictly before the offset
  const lastNl = line > 0 ? newlineIdx[line - 1]! : -1
  return { line: line + 1, col: offset - lastNl }
}

/**
 * The 1-based location of the node at `path` in the document. When the
 * FINAL segment does not resolve (the typical "missing required key"
 * issue — the node does not exist), the location of the CONTAINING node
 * is returned instead, so the error still points at the right object.
 */
function locationOf(
  doc: Document,
  text: string,
  newlineIdx: number[],
  path: readonly PropertyKey[],
): Position | undefined {
  const root = doc.contents
  if (root === null || root === undefined) return undefined
  const full = nodeAt(root, path)
  const target: Node | undefined =
    full !== undefined && full.range !== undefined && full.range !== null
      ? full
      : path.length > 0
        ? nodeAt(root, path.slice(0, -1))
        : root
  const range = target?.range
  return range !== undefined && range !== null ? positionAt(text, newlineIdx, range[0]) : undefined
}

/**
 * Walk the parsed node tree along a zod issue path (map keys by value,
 * sequence items by index). Returns `undefined` at the first segment
 * that does not resolve (the node is missing, or the container is not a
 * mapping/sequence).
 */
function nodeAt(root: Node, path: readonly PropertyKey[]): Node | undefined {
  let node: Node | undefined = root
  for (const seg of path) {
    if (node instanceof YAMLMap) {
      const key = String(seg)
      const pair = node.items.find((p) => {
        // yaml types Pair keys as `unknown` (parsed keys are Scalar nodes);
        // the `.value` of the key scalar is the parsed key value.
        const raw: unknown = (p.key as { value?: unknown }).value
        return raw === key || String(raw) === key
      })
      if (pair === undefined) return undefined
      node = pair.value as Node | undefined
    } else if (node instanceof YAMLSeq) {
      if (typeof seg !== 'number') return undefined
      node = node.items[seg] as Node | undefined
    } else {
      return undefined
    }
  }
  return node
}

/** Short human-readable description of a top-level scalar (diagnostics). */
function describeScalar(node: Node): string {
  const src = (node as { source?: unknown }).source
  const raw = typeof src === 'string' && src.length > 0 ? src : String((node as { value?: unknown }).value ?? '')
  return raw.length > 40 ? `${raw.slice(0, 37)}…` : raw
}
