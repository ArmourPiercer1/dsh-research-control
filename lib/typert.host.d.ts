import { Jt as TypertContributionMirror } from "./rpc-contracts-0udiSh_9.js";
import { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";
//#region src/host/dsh-adapter/host/typert.artifact.d.ts
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