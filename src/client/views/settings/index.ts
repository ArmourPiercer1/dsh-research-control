/**
 * V2-T6.1 — `src/client/views/settings` — public surface.
 *
 * The DSH 设置 plugin card (design §7.5 / Q4): the ONE import point of
 * the directory. `ResearchSettingsCard` is the keyed-slot component — a
 * pure props/React view (INV-PERM-5 clean: no @deepseek-ai imports
 * anywhere under views/**); the settings-scope binding and the §7.5
 * two-phase save transaction live in the adapter half
 * (`dsh-adapter/settings-card.tsx`) and arrive through the inject face
 * below (client/AGENTS.md rule 7 — plain data and callbacks only).
 */

export {
  ResearchSettingsCard,
  type ResearchSettingsCardFace,
  type ResearchSettingsCardProps,
  type ResearchSettingsCardSnapshot,
} from './research-settings-card.js'
