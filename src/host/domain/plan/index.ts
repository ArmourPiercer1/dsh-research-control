/**
 * WP-1.3 — public surface of the canonical plan CRUD kernel (domain layer).
 *
 * Usage (service/workspace layer, later WP):
 * ```ts
 * const store = new PlanStore({ reader, writer, researchRoot, schemaDir, topicId: 'TPC-1', wsId: 'WS-1' })
 * const { items, errors } = store.loadPlan()
 * store.addItem('task', doc, 2)      // definition file + plan.yaml, both atomic
 * store.moveItem('T-1', 0)
 * store.removeItem('G-2')            // plan.yaml only; definition retained (INV-PLAN-9)
 * ```
 *
 * The kernel is pure (no I/O, no DSH, no git — ARCHITECTURE §2.2): all file
 * access goes through the injected `ResearchFileReader` (WP-1.1) and
 * `PlanFileWriter` (atomic tmp+rewrite obligation — see types.ts).
 */

export { PlanStore } from './plan-store.js'
export {
  DEFINITION_FIELDS,
  epochToIso,
  serializeDefinition,
  serializeGateDoc,
  serializeMilestoneDoc,
  serializePlan,
  serializeTaskDoc,
  toYamlCarrier,
  YAML_OPTIONS,
} from './serialize.js'
export {
  isPlanStoreError,
  KIND_TO_DIR,
  KIND_TO_ID_KIND,
  PLAN_ITEM_KINDS,
  PlanStoreError,
  type DefinitionDoc,
  type PlanFileWriter,
  type PlanItemKind,
  type PlanLoadResult,
  type PlanStoreErrorCode,
  type PlanStoreOptions,
} from './types.js'
