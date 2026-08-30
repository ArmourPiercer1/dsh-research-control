/**
 * UI-5 D1 — ADJ-2 id allocation unit tests.
 *
 * Pins: per-kind plan-local max-seq+1, orphan-definition skipping, and the
 * Task-case EQUIVALENCE with the pre-existing PROMOTE rule
 * (`allocateTaskId`/`nextTaskSequence` — same input ⇒ same output), which
 * ADJ-2 forbids modifying (this helper is a NEW parallel, not a rewrite).
 */
import { describe, expect, it } from 'vitest'
import {
  allocateTaskId,
  nextTaskSequence,
} from '../../src/host/service/actions/index.js'
import {
  allocatePlanItemId,
  kindOfPlanItemId,
  PLAN_ITEM_ID_PATTERNS,
  WIRE_KIND_TO_PLAN_KIND,
} from '../../src/host/service/plan-writer/index.js'

const neverExists = (): boolean => false

describe('allocatePlanItemId — plan-local max seq + 1', () => {
  it('allocates the first id of a kind for an empty plan', () => {
    expect(allocatePlanItemId('task', [], neverExists)).toBe('T-1')
    expect(allocatePlanItemId('gate', [], neverExists)).toBe('G-1')
    expect(allocatePlanItemId('milestone', [], neverExists)).toBe('M-1')
  })

  it('allocates max seq + 1 PER KIND (other kinds do not advance the counter)', () => {
    const items = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']
    expect(allocatePlanItemId('task', items, neverExists)).toBe('T-5')
    expect(allocatePlanItemId('gate', items, neverExists)).toBe('G-3')
    expect(allocatePlanItemId('milestone', items, neverExists)).toBe('M-2')
  })

  it('ignores ids that are not well-formed for the kind (no crash, no advance)', () => {
    const items = ['G-1', 'T-1', 'R-9', 'WS-3', 'T-0', 'X-4', 'T-10']
    expect(allocatePlanItemId('task', items, neverExists)).toBe('T-11')
  })
})

describe('allocatePlanItemId — orphan definition skipping', () => {
  it('skips a candidate whose definition file already exists (orphan)', () => {
    const exists = (id: string) => id === 'T-5'
    expect(allocatePlanItemId('task', ['T-1', 'T-2', 'T-3', 'T-4'], exists)).toBe('T-6')
  })

  it('skips CONSECUTIVE orphans until the first free slot', () => {
    const orphans = new Set(['G-3', 'G-4'])
    expect(allocatePlanItemId('gate', ['G-1', 'G-2'], (id) => orphans.has(id))).toBe('G-5')
  })

  it('skips orphans below the plan max as well (the scan starts at plan max + 1)', () => {
    // Plan max T = 7 ⇒ allocation starts at T-8; the orphan T-2 is irrelevant
    // to the starting point but the probe must still be consulted.
    const exists = (id: string) => id === 'T-2' || id === 'T-8'
    expect(allocatePlanItemId('task', ['T-1', 'T-7'], exists)).toBe('T-9')
  })

  it('an orphan ABOVE the plan max still only shifts the allocation', () => {
    // No T in the plan at all, but an orphan T-1 exists on disk.
    const exists = (id: string) => id === 'T-1'
    expect(allocatePlanItemId('task', ['G-1'], exists)).toBe('T-2')
  })
})

describe('allocatePlanItemId — Task-case equivalence with the PROMOTE rule (ADJ-2)', () => {
  // The frozen matrix: (plan items, orphan set) pairs covering empty /
  // dense / gapped / orphan-below-max / orphan-at-next plans.
  const cases: Array<[readonly string[], readonly string[]]> = [
    [[], []],
    [['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'], []],
    [['T-1', 'T-2', 'T-3', 'T-4'], ['T-5']],
    [['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7']],
    [['T-3', 'T-1'], ['T-2']],
    [['T-10', 'T-2'], ['T-11', 'T-13']],
    [['G-1', 'M-1'], ['T-1', 'T-2']],
    [['T-1'], []],
  ]

  it.each(cases.map(([items]) => [items] as [readonly string[]]))(
    'nextTaskSequence parity: %j',
    (items) => {
      const pattern = PLAN_ITEM_ID_PATTERNS.task
      let max = 0
      for (const id of items) {
        if (!pattern.test(id)) continue
        const n = Number(id.slice(2))
        if (n > max) max = n
      }
      expect(nextTaskSequence(items)).toBe(max + 1)
    },
  )

  it.each(cases.map(([items, orphans]) => [items, orphans] as const))(
    'allocatePlanItemId(task) ≡ allocateTaskId on plan %j, orphans %j',
    (items, orphans) => {
      const exists = (id: string) => (orphans as readonly string[]).includes(id)
      expect(allocatePlanItemId('task', items, exists)).toBe(allocateTaskId(items, exists))
    },
  )
})

describe('kindOfPlanItemId', () => {
  it('recognizes the three plan-item prefixes', () => {
    expect(kindOfPlanItemId('T-1')).toBe('task')
    expect(kindOfPlanItemId('G-42')).toBe('gate')
    expect(kindOfPlanItemId('M-7')).toBe('milestone')
  })

  it('rejects non-plan-item or malformed ids', () => {
    expect(kindOfPlanItemId('X-1')).toBeNull()
    expect(kindOfPlanItemId('T-0')).toBeNull()
    expect(kindOfPlanItemId('T-')).toBeNull()
    expect(kindOfPlanItemId('t-1')).toBeNull()
    expect(kindOfPlanItemId('WS-1')).toBeNull()
    expect(kindOfPlanItemId('')).toBeNull()
  })
})

describe('WIRE_KIND_TO_PLAN_KIND', () => {
  it('maps the frozen wire casing to kernel kinds', () => {
    expect(WIRE_KIND_TO_PLAN_KIND.TASK).toBe('task')
    expect(WIRE_KIND_TO_PLAN_KIND.GATE).toBe('gate')
    expect(WIRE_KIND_TO_PLAN_KIND.MILESTONE).toBe('milestone')
  })
})
