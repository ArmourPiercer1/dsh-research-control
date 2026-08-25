/**
 * V2-T2.3 — `parseRegistry`: legal parses, round-trip, and the full
 * malformed-rejection matrix (design §3.2 校验纪律: 严格 schema，
 * 畸形即 fail-loud; 行级信息进启动日志).
 */

import { describe, expect, it } from 'vitest'

import {
  parseRegistry,
  RegistryFormatError,
  serializeRegistry,
  type RegistryFormatCode,
} from '../../src/host/domain/registry/index.js'
import { ACTIVE_ENTRY, ARCHIVED_ENTRY, DESIGN_EXAMPLE_YAML, HAND_WRITTEN_YAML, makeFile, THIRD_ENTRY } from './fixtures.js'

/** Capture a RegistryFormatError (fail the test if nothing was thrown). */
function expectFormatError(fn: () => unknown, code: RegistryFormatCode, line?: number): RegistryFormatError {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown, 'expected a RegistryFormatError').toBeInstanceOf(RegistryFormatError)
  const err = thrown as RegistryFormatError
  expect(err.code).toBe(code)
  if (line !== undefined) {
    expect(err.line, `line attribution for ${code}: ${err.message}`).toBe(line)
  }
  return err
}

/** One valid entry as a YAML block (line 3 = the entry's `- id:` line). */
function entryYaml(partial: Record<string, string>): string {
  const fields: Record<string, string> = {
    id: 'PRJ-1',
    path: '/a',
    displayName: 'd',
    status: 'active',
    boundAt: '1',
    archivedAt: 'null',
    ...partial,
  }
  const order = ['id', 'path', 'displayName', 'status', 'boundAt', 'archivedAt'] as const
  return `version: 1\nprojects:\n  - ${order.map((k) => `${k}: ${fields[k]}`).join('\n    ')}`
}

describe('parseRegistry — legal documents', () => {
  it('parses the design §3.2 example verbatim', () => {
    const file = parseRegistry(DESIGN_EXAMPLE_YAML)
    expect(file).toEqual({
      version: 1,
      projects: [
        {
          id: 'PRJ-1',
          path: '/abs/path/to/ws',
          displayName: '机器人视觉定位系统',
          status: 'active',
          boundAt: 1770000000000,
          archivedAt: null,
        },
      ],
    })
  })

  it('parses an empty registry (version: 1, projects: [])', () => {
    expect(parseRegistry('version: 1\nprojects: []\n')).toEqual({ version: 1, projects: [] })
  })

  it('parses archived entries, Windows drive + UNC paths, and big-but-safe timestamps', () => {
    const text = [
      'version: 1',
      'projects:',
      '  - id: PRJ-7',
      '    path: C:\\repos\\quant',
      '    displayName: Q',
      '    status: archived',
      '    boundAt: 1700000000000',
      '    archivedAt: 1700000000123',
      '  - id: PRJ-9007199254740991',
      '    path: \\\\server\\share\\ws',
      '    displayName: U',
      '    status: active',
      '    boundAt: 9007199254740991',
      '    archivedAt: null',
    ].join('\n')
    const file = parseRegistry(text)
    expect(file.projects).toHaveLength(2)
    expect(file.projects[0]).toMatchObject({ id: 'PRJ-7', status: 'archived', archivedAt: 1700000000123 })
    expect(file.projects[1]).toMatchObject({ id: 'PRJ-9007199254740991', boundAt: 9007199254740991, archivedAt: null })
  })

  it('returns a deep-frozen file (the immutability contract of parse output)', () => {
    const file = parseRegistry(DESIGN_EXAMPLE_YAML)
    expect(Object.isFrozen(file)).toBe(true)
    expect(Object.isFrozen(file.projects)).toBe(true)
    expect(Object.isFrozen(file.projects[0])).toBe(true)
    const entry = file.projects[0] as unknown as { id: string }
    expect(() => {
      entry.id = 'PRJ-9' // the frozen object rejects the write (strict mode)
    }).toThrow(TypeError)
  })
})

describe('parseRegistry — round-trip and determinism (with serializeRegistry)', () => {
  it('serialize → parse deep-equals the original file', () => {
    const file = makeFile([ACTIVE_ENTRY, ARCHIVED_ENTRY, THIRD_ENTRY])
    const parsed = parseRegistry(serializeRegistry(file))
    expect(parsed).toEqual(file)
  })

  it('serialization is byte-stable (repeated calls + re-serialization of the parsed form)', () => {
    const file = makeFile([ACTIVE_ENTRY, ARCHIVED_ENTRY])
    const once = serializeRegistry(file)
    expect(serializeRegistry(file)).toBe(once)
    expect(serializeRegistry(parseRegistry(once))).toBe(once)
  })

  it('canonicalizes a hand-formatted file (shuffled keys, extra comments) to the same bytes', () => {
    const parsed = parseRegistry(HAND_WRITTEN_YAML)
    expect(parsed).toEqual(makeFile())
    expect(serializeRegistry(parsed)).toBe(serializeRegistry(makeFile()))
  })

  it('quotes special characters in path/displayName exactly when YAML requires it (round-trip safe)', () => {
    const file = makeFile([
      {
        id: 'PRJ-1',
        path: '/x: y/z',
        displayName: 'a: b "c"',
        status: 'active',
        boundAt: 5,
        archivedAt: null,
      },
    ])
    const text = serializeRegistry(file)
    const parsed = parseRegistry(text)
    expect(parsed.projects[0]).toEqual(file.projects[0])
  })
})

describe('parseRegistry — malformed documents are rejected (fail-loud, ≥8 classes)', () => {
  it('rejects a YAML syntax error (PARSE, with line from the yaml library)', () => {
    const err = expectFormatError(
      () => parseRegistry('version: 1\nprojects:\n  - id: PRJ-1\n   path: /a\n'),
      'PARSE',
    )
    expect(typeof err.line).toBe('number')
    expect(err.message).toContain('YAML parse failed')
  })

  it('rejects duplicate mapping keys (PARSE, line of the duplicate)', () => {
    const err = expectFormatError(() => parseRegistry('version: 1\nversion: 2\nprojects: []\n'), 'PARSE', 2)
    expect(err.message).toMatch(/unique/i)
  })

  it('rejects a second YAML document (PARSE)', () => {
    const err = expectFormatError(
      () => parseRegistry('version: 1\nprojects: []\n---\nprojects: []\n'),
      'PARSE',
    )
    expect(err.message).toContain('2 YAML documents')
  })

  it('rejects an empty or comment-only file (NOT_MAPPING)', () => {
    expectFormatError(() => parseRegistry(''), 'NOT_MAPPING')
    expectFormatError(() => parseRegistry('# just a comment\n\n'), 'NOT_MAPPING')
  })

  it('rejects a top-level sequence (NOT_MAPPING, with line)', () => {
    const err = expectFormatError(() => parseRegistry('- PRJ-1\n- PRJ-2\n'), 'NOT_MAPPING', 1)
    expect(err.message).toContain('sequence')
  })

  it('rejects a top-level scalar (NOT_MAPPING, with line)', () => {
    const err = expectFormatError(() => parseRegistry('PRJ-1\n'), 'NOT_MAPPING', 1)
    expect(err.message).toContain('scalar')
  })

  it('rejects an unknown top-level key (SCHEMA, strict)', () => {
    const err = expectFormatError(() => parseRegistry('version: 1\nprojects: []\nextra: true\n'), 'SCHEMA', 1)
    expect(err.message).toContain('extra')
    expect(err.pointer).toBe('(document root)')
  })

  it('rejects an unknown entry key (SCHEMA, strict, line of the entry)', () => {
    const err = expectFormatError(() => parseRegistry(`${entryYaml({})}\n    extra: 1\n`), 'SCHEMA', 3)
    expect(err.message).toContain('extra')
    expect(err.pointer).toBe('/projects/0')
  })

  it('rejects a missing required entry field (SCHEMA, line of the entry)', () => {
    const text = ['version: 1', 'projects:', '  - id: PRJ-1', '    path: /a', '    displayName: d', '    status: active', '    boundAt: 1'].join('\n')
    const err = expectFormatError(() => parseRegistry(text), 'SCHEMA', 3)
    expect(err.message).toContain('archivedAt')
  })

  it('rejects a missing top-level key (SCHEMA, line of the document)', () => {
    const err = expectFormatError(() => parseRegistry('projects: []\n'), 'SCHEMA', 1)
    expect(err.message).toContain('version')
  })

  it('rejects version != 1 (SCHEMA literal — number and string both fail)', () => {
    expectFormatError(() => parseRegistry('version: 2\nprojects: []\n'), 'SCHEMA', 1)
    expectFormatError(() => parseRegistry("version: '1'\nprojects: []\n"), 'SCHEMA', 1)
  })

  it.each(["'PRJ-0'", "'PRJ-01'", "'prj-1'", "'PROJ-1'", "'PRJ-'", "''"] as const)(
    'rejects a malformed string id %j (SCHEMA pattern, line of the id)',
    (id) => {
      const err = expectFormatError(() => parseRegistry(entryYaml({ id })), 'SCHEMA', 3)
      expect(err.message).toContain('PRJ')
    },
  )

  it('rejects a non-string id (YAML-coerced number / null — SCHEMA type error)', () => {
    const num = expectFormatError(() => parseRegistry(entryYaml({ id: '-1' })), 'SCHEMA', 3)
    expect(num.message).toContain('string')
    const nil = expectFormatError(() => parseRegistry(entryYaml({ id: '' })), 'SCHEMA', 3)
    expect(nil.message).toContain('string')
  })

  it('rejects an unsafe-integer id sequence (SCHEMA, safe-integer strictness)', () => {
    const err = expectFormatError(
      () => parseRegistry(entryYaml({ id: 'PRJ-99999999999999999999' })),
      'SCHEMA',
      3,
    )
    expect(err.message).toContain('safe integer')
  })

  it.each(['relative/path', 'workspaces', '.', "''", 'a/../b'] as const)(
    'rejects a non-absolute path %j (SCHEMA)',
    (path) => {
      const err = expectFormatError(() => parseRegistry(entryYaml({ path })), 'SCHEMA', 4)
      expect(err.message).toContain('absolute path')
    },
  )

  it('rejects a null path (SCHEMA type error)', () => {
    const err = expectFormatError(() => parseRegistry(entryYaml({ path: '' })), 'SCHEMA', 4)
    expect(err.message).toContain('string')
  })

  it('rejects a non-enum status (SCHEMA)', () => {
    const err = expectFormatError(() => parseRegistry(entryYaml({ status: 'paused' })), 'SCHEMA', 6)
    expect(err.message).toMatch(/active|archived/)
  })

  it('rejects negative / non-integer timestamps (SCHEMA)', () => {
    const neg = expectFormatError(() => parseRegistry(entryYaml({ boundAt: '-5' })), 'SCHEMA', 7)
    expect(neg.message).toContain('boundAt')
    const float = expectFormatError(() => parseRegistry(entryYaml({ boundAt: '1.5' })), 'SCHEMA', 7)
    expect(float.message).toContain('int')
  })

  it('rejects duplicate project ids (DUPLICATE_ID, both occurrence lines named)', () => {
    const text = [
      'version: 1',
      'projects:',
      '  - id: PRJ-1',
      '    path: /a',
      '    displayName: A',
      '    status: active',
      '    boundAt: 1',
      '    archivedAt: null',
      '  - id: PRJ-1',
      '    path: /b',
      '    displayName: B',
      '    status: active',
      '    boundAt: 2',
      '    archivedAt: null',
    ].join('\n')
    const err = expectFormatError(() => parseRegistry(text), 'DUPLICATE_ID', 9)
    expect(err.message).toContain('"PRJ-1"')
    expect(err.message).toContain('line 3')
    expect(err.pointer).toBe('/projects/1/id')
  })

  it('rejects an archived entry without archivedAt (STATUS_TIMESTAMP, entry line)', () => {
    const err = expectFormatError(
      () => parseRegistry(entryYaml({ status: 'archived', archivedAt: 'null' })),
      'STATUS_TIMESTAMP',
      8,
    )
    expect(err.message).toContain('archivedAt')
    expect(err.pointer).toBe('/projects/0/archivedAt')
  })

  it('rejects an active entry with a non-null archivedAt (STATUS_TIMESTAMP)', () => {
    const err = expectFormatError(
      () => parseRegistry(entryYaml({ status: 'active', archivedAt: '123' })),
      'STATUS_TIMESTAMP',
      8,
    )
    expect(err.message).toContain('null')
  })
})
