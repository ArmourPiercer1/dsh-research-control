/**
 * View fixtures (WP-4.3) — workstream snapshots for the view suites.
 *
 * Built on the WIRE-VALID WP-4.1a baseline fixture
 * (`tests/rpc-face/fixtures.ts` `WORKSTREAM_FIXTURE`) so every value the
 * zones render is the same shape the frozen gateway strict decode
 * accepts; overrides replace whole sub-structures (zone-level), never
 * individual wire fields, so a drifted fixture fails the schema guard in
 * `container.test.tsx`, not silently.
 */

import type {
  CurrentTaskDto,
  PlanForkDto,
  PlanItemDto,
  RunDto,
  WorkstreamSnapshot,
} from '../../src/shared/rpc-contracts.js'
import { WORKSTREAM_FIXTURE } from '../rpc-face/fixtures.js'

export interface SnapshotOverrides {
  /** The workstream `title` (header). */
  readonly title?: string
  /** The `history.eventCount` (History zone). */
  readonly eventCount?: number
  /** The `current.tasks` (Current zone; all tasks, folded states). */
  readonly currentTasks?: readonly CurrentTaskDto[]
  /** The `current.runs` (Current zone). */
  readonly runs?: readonly RunDto[]
  /** The `future.plan.orderedItems` (Future zone canonical plan). */
  readonly planItems?: readonly PlanItemDto[]
  /** The `future.planForks` (Future zone overlay data seam). */
  readonly planForks?: readonly PlanForkDto[]
  /** The `future.unresolvedPlanForkCount`. */
  readonly unresolvedPlanForkCount?: number
}

/**
 * Clone the baseline fixture and apply whole-structure overrides.
 * @param overrides - zone-level overrides (all optional).
 * @returns a fresh snapshot object (no shared mutable state).
 */
export function makeSnapshot(overrides: SnapshotOverrides = {}): WorkstreamSnapshot {
  // JSON round-trip: the fixture is plain wire data; the clone is a
  // deep, mutation-free copy.
  const base = JSON.parse(JSON.stringify(WORKSTREAM_FIXTURE)) as WorkstreamSnapshot
  return {
    ...base,
    workstream: {
      ...base.workstream,
      ...(overrides.title !== undefined ? { title: overrides.title } : {}),
    },
    history: {
      eventCount: overrides.eventCount ?? base.history.eventCount,
    },
    current: {
      tasks: overrides.currentTasks !== undefined ? [...overrides.currentTasks] : base.current.tasks,
      runs: overrides.runs !== undefined ? [...overrides.runs] : base.current.runs,
    },
    future: {
      plan: {
        orderedItems:
          overrides.planItems !== undefined ? [...overrides.planItems] : base.future.plan.orderedItems,
      },
      planForks: overrides.planForks !== undefined ? [...overrides.planForks] : base.future.planForks,
      unresolvedPlanForkCount:
        overrides.unresolvedPlanForkCount !== undefined
          ? overrides.unresolvedPlanForkCount
          : base.future.unresolvedPlanForkCount,
    },
  }
}
