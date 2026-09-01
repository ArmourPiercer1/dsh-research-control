import { Jt as TypertContributionMirror } from "./rpc-contracts-CAb1T63d.js";
import { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";
//#region src/host/dsh-adapter/host/typert.artifact.d.ts
/**
 * 0.1.2-alpha.3 typert train: merge the owner's domain failure codes into
 * the shared `RemoteErrorDetailsMap` (the gateway merges its infrastructure
 * codes the same way — `remote-error-codes.ts`). Every `PLANE_*` code the
 * host throws via `PlaneError` (the closed 13-code vocabulary, frozen list
 * in `src/shared/rpc-contracts.ts`) is declared here so the typed Remote
 * faces see the full union; the wire payload is the empty object (the
 * message stays the self-contained human carrier). Type-only: no runtime
 * import is added.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** `setHub`: the plane already carries a hub at another workspace. */
    'PLANE_HUB_EXISTS': {};
    /** `setHub`: the target workspace already carries the hub marker. */
    'PLANE_HUB_MARKER_EXISTS': {};
    /** `setHub` / `bindProject` / `unbindProject`: not a registered DSH workspace. */
    'PLANE_NOT_REGISTERED_WORKSPACE': {};
    /** `bindProject`: the workspace already carries an ACTIVE registry entry. */
    'PLANE_ALREADY_MANAGED': {};
    /** `bindProject`: the target workspace is the hub workspace itself. */
    'PLANE_HUB_WORKSPACE': {};
    /** `bindProject`: no tree was discovered and `scaffold` is not `true`. */
    'PLANE_TREE_MISSING': {};
    /** `bindProject`: `scaffold` is `true` but a tree already exists. */
    'PLANE_TREE_EXISTS': {};
    /** `unbindProject`: the workspace is not an active managed project. */
    'PLANE_NOT_MANAGED': {};
    /** `restoreProject`: no ARCHIVED registry entry carries that project id. */
    'PLANE_NOT_ARCHIVED': {};
    /** `restoreProject`: the archived tree directory cannot be found on disk. */
    'PLANE_ARCHIVED_DIR_MISSING': {};
    /** `restoreProject`: the restore target tree name is already occupied. */
    'PLANE_TARGET_NAME_TAKEN': {};
    /** `ackMissingReminder`: the project id is not in the MISSING set. */
    'PLANE_NOT_MISSING': {};
    /** `getResearchPlaneState`: the `sessionId` names no known session. */
    'PLANE_SESSION_UNKNOWN': {};
  }
}
/**
 * The host-face `TYPERT` manifest (mirror of the registry `TypertContribution`;
 * the loader's runtime validation is the authority).
 */
interface TypertHostManifest extends Omit<TypertContributionMirror, 'face' | 'invocations'> {
  readonly face: 'host';
  /** Real protocol type: cross-checks the shared mirror at the module boundary. */
  readonly invocations: readonly InvocationDescriptor[];
}
declare const TYPERT: TypertHostManifest;
//#endregion
export { TYPERT, TypertHostManifest };