import { dt as REGISTERED_RESEARCH_INVOCATIONS, ft as RESEARCH_CONTROL_PACKAGE } from "./rpc-contracts-B5WidJrn.js";
//#region src/client/dsh-adapter/remote/contribution.ts
/**
* The research contribution: the client half of the `./typert` manifest.
* `descriptors` is the SAME object set as `TYPERT.invocations` on the
* host face (the shared `REGISTERED_RESEARCH_INVOCATIONS` — ping + the
* 13 WP-4.1a descriptors + the 3 read-only plane descriptors, V2-T3.2a
* + the 6 change-family plane descriptors, V2-T3.2b + the 4 GUI
* management descriptors, UI-0.4: the current-focus pair (R-01) and the
* hierarchy create pair (Task 3) + the 7 attention descriptors, UI-4 (D
* §10): the CurrentExecution projection read + the
* objective/next-action/blocker mutation faces + the 5 plan-editor
* descriptors, UI-5 (brief §3): the plan item CRUD trio + the DEPENDS_ON
* relation pair — the hand-written map
* above mirrors the SAME face by category), strict codecs included.
*/
const researchRemotes = {
	package: RESEARCH_CONTROL_PACKAGE,
	descriptors: REGISTERED_RESEARCH_INVOCATIONS
};
//#endregion
export { researchRemotes as default, researchRemotes };
