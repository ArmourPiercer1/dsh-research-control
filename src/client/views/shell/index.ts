/**
 * V2-T4.1 — `src/client/views/shell` — public surface.
 *
 * The 研究 tab shell (design §5/§6): the ONE import point of the package.
 * `ResearchShell` is the registered tab body — a pure props/React view
 * (INV-PERM-5 clean: no @deepseek-ai imports anywhere under views/**);
 * the plane-state fetch arrives through the injected face prop
 * (`dsh-adapter/ui.ts` binds it to `researchRpc.getResearchPlaneState`
 * carrying the framework sessionId).
 */

export { ResearchShell, type ResearchShellProps } from './shell.js'
