/**
 * G2 — the REAL host output codec as a test helper.
 *
 * `@deepseek-ai/dsh-tools` ships the exact validator the pinned host
 * applies to tool outputs (`assertSupportedJsonSchema` at registration,
 * value validation with `validateJsonSchemaValue`) — importing it here
 * verifies the G2 read tools against the ACTUAL host codec, not a
 * re-implementation. Test-only: business code must never import
 * `@deepseek-ai/*` (INV-PERM-5 — tests/discovery already import
 * `@deepseek-ai/cordis`, same exemption class).
 */

import { assertSupportedJsonSchema, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'

/** Assert the schema itself is inside the pinned host's enforced subset
 *  (the exact registration-time acceptance the real host applies). */
export function assertSchemaIsHostSupported(schema: unknown): JsonSchemaNode {
  assertSupportedJsonSchema(schema)
  return schema as JsonSchemaNode
}

/** Assert the schema validates the value with ZERO violations. */
export function expectValueMatchesHostCodec(schema: unknown, value: unknown): void {
  const node = assertSchemaIsHostSupported(schema)
  const violations = validateJsonSchemaValue(node, structuredClone(value))
  if (violations.length > 0) {
    throw new Error(`host codec rejected the value:\n${violations.join('\n')}`)
  }
}

/** The negative twin: the schema must REJECT the value (violations exist). */
export function expectValueRejectedByHostCodec(schema: unknown, value: unknown): void {
  const node = assertSchemaIsHostSupported(schema)
  const violations = validateJsonSchemaValue(node, structuredClone(value))
  if (violations.length === 0) {
    throw new Error('host codec accepted a value the strict schema must reject')
  }
}
