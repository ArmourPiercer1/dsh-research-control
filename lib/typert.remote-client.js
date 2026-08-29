import { E as RESEARCH_CONTROL_PACKAGE, T as REGISTERED_RESEARCH_INVOCATIONS } from "./rpc-contracts-t7pqF7aM.js";
//#region src/client/dsh-adapter/remote/contribution.ts
/**
* The research contribution: the client half of the `./typert` manifest.
* `descriptors` is the SAME object set as `TYPERT.invocations` on the
* host face (the shared `REGISTERED_RESEARCH_INVOCATIONS` — ping + the
* 13 WP-4.1a descriptors + the 3 read-only plane descriptors, V2-T3.2a
* + the 6 change-family plane descriptors, V2-T3.2b — the 23-endpoint
* face), strict codecs included.
*/
const researchRemotes = {
	package: RESEARCH_CONTROL_PACKAGE,
	descriptors: REGISTERED_RESEARCH_INVOCATIONS
};
//#endregion
export { researchRemotes as default, researchRemotes };
