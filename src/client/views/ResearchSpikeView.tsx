/**
 * Research spike view (WP-0.5): the minimal presentation component for the
 * `conversation.view` tab that the U1 client bundle registers.
 *
 * Pure props, zero DSH imports (INV-PERM-5, lint-guarded): the component
 * never sees the client context — the slot wiring lives in
 * src/client/dsh-adapter/ui.ts (the exempt set), and the only fact this
 * view receives is the placeholder ping status. No real data call: the
 * live `researchRpc` ping + cockpit zones are Phase 4 work
 * (ARCHITECTURE §2.1 `views/` zones).
 */
import type { ReactElement } from 'react'

/** Spike view props: local minimal face (pure interface, no DSH types). */
export interface ResearchSpikeViewProps {
  /** Ping status placeholder; Phase 4 replaces it with the live ping result. */
  readonly pingStatus: string
}

/**
 * Render the Research tab placeholder: title, spike marker line, ping status.
 * @param props - view props.
 * @returns the tab body element.
 */
export function ResearchSpikeView({ pingStatus }: ResearchSpikeViewProps): ReactElement {
  return (
    <div>
      <h1>研究控制台</h1>
      <p>Research Cockpit spike（U1 验证用）</p>
      <p>ping 状态：{pingStatus}</p>
    </div>
  )
}
