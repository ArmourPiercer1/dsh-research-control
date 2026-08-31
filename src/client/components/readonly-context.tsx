/**
 * UI-9 D4 (ADJ-11) — the project-scoped read-only state + the pure
 * composer.
 *
 * The host projects each MANAGED project's startup integrity gate into
 * `PlaneProjectDto.integrity` (machine codes ONLY — ADJ-11: 只传机器码,
 * the gate's Chinese `guidance` free-text never crosses the wire). This
 * module turns that snapshot into the client's single source of truth
 * for the read-only surface:
 *
 *   - the B §33.4 banner copy (title / reason / browse — the {reason}
 *     phrase is composed ONCE here, never per control);
 *   - the `readonly` flag every mutation control consults (browse stays
 *     available: filters / segments / expansion / navigation are NOT
 *     gated by this context);
 *   - the wiring-reinit notice flag (the WIRING_REINITIALIZED code —
 *     the same DTO field doubles as the D3 error state 2, see
 *     readonly-banner.tsx).
 *
 * Session-scoped (boot-time) state per ADJ-11 v1: the snapshot moves
 * with the plane state — every shell re-fetch (the refresh loop, the
 * rescan / bind / unbind re-init) carries the fresh projection.
 */
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react'

import type { PlaneIntegrityDto } from '../../shared/rpc-contracts.js'
import { t } from '../i18n/copy.js'

/** The LOCKED machine-code vocabulary (the host's plane projection
 *  emits exactly these — see `INTEGRITY_CODE_*` in
 *  src/host/dsh-adapter/host/plane-read-services.ts; the D3
 *  error-state map keys on the same literals). */
export const INTEGRITY_CODE_WIRING_REINITIALIZED = 'WIRING_REINITIALIZED'
export const INTEGRITY_CODE_TREE_PARTIAL = 'TREE_PARTIAL'
export const INTEGRITY_CODE_CONSISTENCY_MISMATCH = 'CONSISTENCY_MISMATCH'
export const INTEGRITY_CODE_GIT_REPO_ERROR = 'GIT_REPO_ERROR'

/** The complete set of `error.*` catalog keys consumed by the
 *  readonly surface (the composer's per-code phrases — this module —
 *  + the banner's three lines + the re-init retry hint — those in
 *  readonly-banner.tsx). Exported so the i18n orphan-key sweep
 *  (tests/i18n/error-mapping.test.ts) counts them as referenced: they
 *  are rendered by the banner, not by the D3 error-state map. */
export const READONLY_SURFACE_KEYS = [
  'error.readonly.title',
  'error.readonly.reasonLine',
  'error.readonly.browse',
  'error.readonly.treePartial',
  'error.readonly.consistencyMismatch',
  'error.readonly.gitRepoError',
  'error.wiringReinitialized.retryHint',
] as const

/** The composed read-only state (the context value + the pure
 *  composer's result). */
export interface ProjectReadonlyInfo {
  /** `true` ⇔ the gate classified the read surface readonly — the B
   *  §33.4 banner renders and the mutation controls disable. */
  readonly readonly: boolean
  /** The raw machine codes (the host's locked vocabulary). */
  readonly checkCodes: readonly string[]
  /** `true` ⇔ the codes carry WIRING_REINITIALIZED — the D3 error
   *  state 2 notice renders (readonly-banner.tsx). */
  readonly reinitialized: boolean
  /** The composed banner reason (the {reason} slot of
   *  `error.readonly.reasonLine`) — `null` when not readonly. */
  readonly reasonText: string | null
}

/** The absent-integrity default (no MANAGED wiring snapshot — every
 *  role view outside a readonly MANAGED project renders with this). */
export const NO_PROJECT_READONLY: ProjectReadonlyInfo = {
  readonly: false,
  checkCodes: [],
  reinitialized: false,
  reasonText: null,
}

/**
 * ADJ-11 (UI-9): the PURE integrity → client-info composer
 * (unit-tested): `readonly` passes through the gate's read-surface
 * verdict; the reason phrase is the code → catalog-phrase map
 * (TREE_PARTIAL / CONSISTENCY_MISMATCH / GIT_REPO_ERROR — the client's
 * OWN wording, joined with `, `).
 */
export function composeProjectReadonly(
  integrity: PlaneIntegrityDto | null | undefined,
): ProjectReadonlyInfo {
  if (integrity === null || integrity === undefined) return NO_PROJECT_READONLY
  const codes = integrity.checkCodes
  const readonly = integrity.readOnly
  let reasonText: string | null = null
  if (readonly) {
    const phrases: string[] = []
    if (codes.includes(INTEGRITY_CODE_TREE_PARTIAL)) phrases.push(t('error.readonly.treePartial'))
    if (codes.includes(INTEGRITY_CODE_CONSISTENCY_MISMATCH)) {
      phrases.push(t('error.readonly.consistencyMismatch'))
    }
    if (codes.includes(INTEGRITY_CODE_GIT_REPO_ERROR)) phrases.push(t('error.readonly.gitRepoError'))
    // The gate defines readonly ⇔ the tree is partially broken, so
    // TREE_PARTIAL is always present here; the fallback keeps the
    // sentence grammatical if the host vocabulary ever drifts.
    if (phrases.length === 0) phrases.push(t('error.readonly.treePartial'))
    reasonText = phrases.join(', ')
  }
  return {
    readonly,
    checkCodes: codes,
    reinitialized: codes.includes(INTEGRITY_CODE_WIRING_REINITIALIZED),
    reasonText,
  }
}

const ProjectReadonlyContext = createContext<ProjectReadonlyInfo>(NO_PROJECT_READONLY)

/**
 * Wraps the console bodies (the shell installs it around the
 * ConsoleFrame for the MANAGED/STANDALONE roles and around the drilled
 * project console for the HUB drill).
 * @param props - the plane-state integrity snapshot (`undefined` = no
 *   MANAGED wiring snapshot for the scoped project).
 */
export function ProjectReadonlyProvider({
  integrity,
  children,
}: {
  readonly integrity: PlaneIntegrityDto | null | undefined
  readonly children: ReactNode
}): ReactElement {
  const info = useMemo(() => composeProjectReadonly(integrity), [integrity])
  return <ProjectReadonlyContext.Provider value={info}>{children}</ProjectReadonlyContext.Provider>
}

/** The LEAF mutation control's read-only consult (browse paths never
 *  call it — filters / segments / expansion / navigation stay enabled). */
export function useProjectReadonly(): ProjectReadonlyInfo {
  return useContext(ProjectReadonlyContext)
}
