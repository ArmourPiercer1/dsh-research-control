/**
 * UI copy registry (UI-3, plan D §9 / D §25 i18n discipline; brief #7).
 *
 * Every NEW string introduced from UI-3 onward must pass through `t()`;
 * pre-existing UI-2 and earlier strings are NOT retrofitted here (that
 * sweep is UI-9). Domain enum values are NEVER translated — they render
 * their canonical English form directly (D §25), so they have no keys
 * here.
 *
 * Values that the wireframe spec (B) pins verbatim are marked `B §x` in
 * the table below; the rest are implementer-chosen (disclosed in the
 * UI-3 report 偏离清单).
 *
 * The `t()` lookup is identity: `t(key)` returns `COPY[key]`. The point
 * of the module is the COMPILE-TIME key set (`CopyKey` = keyof of the
 * frozen COPY literal) — a typo'd key fails tsc, and the values live in
 * one auditable table. No i18n runtime dependency (no deps rule).
 */

const COPY = {
  // --- app chrome -------------------------------------------------------
  'app.title': 'Research Control', // B §2.1 IA root name (frozen)

  // --- first-level nav (D1) ---------------------------------------------
  // Frozen IA names (D §9.1 / B §2.1 verbatim). 'investigator' stays in
  // the HubEntryId union for the programmatic deep-link but has no nav
  // label here: it is hidden from the first level (B §2.1).
  'nav.portfolio': 'Portfolio',
  'nav.needsAttention': 'Needs Attention',
  'nav.settings': 'Settings',

  // --- Portfolio (D2, B §4) ----------------------------------------------
  'portfolio.createProject': 'Create Project', // B §4.3 header MUST
  'portfolio.bindExistingProject': 'Bind Existing Project', // B §4.3 header MUST
  'portfolio.subtitle': 'Research projects overview', // B §4.2 subtitle
  'portfolio.projects': 'Projects', // B §4.2 card-wall heading
  'portfolio.attentionTitle': 'Needs Attention', // B §4.4 section name
  'portfolio.viewAll': 'View all', // B §4.4
  'portfolio.emptyTitle': 'No research projects yet', // B §4.6 verbatim
  'portfolio.emptyBody': 'Start a new local research project or bind an existing project directory.', // B §4.6 verbatim
  'portfolio.emptyCreate': 'Create Research Project', // B §4.6 verbatim button
  'portfolio.emptyBind': 'Bind Existing Project', // B §4.6 verbatim button
  // B §4.6 必须解释 (verbatim):
  'portfolio.emptyExplainCreate': 'Create = 创建新的本地 Project + Git + research structure',
  'portfolio.emptyExplainBind': 'Bind = 接管已有目录 / Git repo',

  // --- Project Overview (D3, B §7 / §9) -----------------------------------
  'project.topicsHeading': 'Topics / Workstreams', // B §7.2 section
  'project.topicEdit': 'Edit', // B §9.1 [Edit]
  'project.topicAddWorkstream': '+ Workstream', // B §9.1 [+ Workstream]
  'project.topicWorkstreams': 'Workstreams', // B §9.1 'Workstreams:'
  'project.topicTopology': 'Topology', // B §9.1 'Topology:'
  'project.viewTopology': 'View topology', // #10: opens the existing topology view
  'project.attentionTitle': 'Project Attention', // B §7.2 section
  'project.attentionPlaceholder': 'Project attention is summarized here.', // placeholder body (implementer-chosen; UI-8 replaces)
  'project.historyTitle': 'Recent History', // D §9.4 frozen section name
  'project.historyNoteFirst20': 'showing first 20 workstreams', // #9 note for >20 WS
  'project.historyEmpty': 'No history recorded yet.', // implementer-chosen empty state
  'project.noWorkstreams': 'No workstreams', // B §9.1 WS list empty state
  // WS-card compact meta (WorkstreamCardDto fields that exist; B §9.2
  // suggested fields with no DTO backing are hidden, not faked):
  'ws.metaPlanItems': 'plan items',
  'ws.metaOpenForks': 'open forks',
  'ws.metaRunning': 'running',

  // --- structure tree (D4, B §8) -------------------------------------------
  'tree.rail': 'Project Tree', // B §7.2 rail label
  'tree.collapse': 'Collapse', // B §7.2 [collapse]
  'tree.reopen': 'Open tree', // collapsed-rail affordance (implementer-chosen)
  'tree.addTopic': '+ Topic', // B §8.4 tree-top `+` (label chosen)
  'tree.addWorkstream': 'Create workstream', // B §8.4 topic-level `+` (aria label)

  // --- dialogs (create/edit topic, create workstream) -----------------------
  // All implementer-chosen (B prescribes the flows, not the labels).
  'dialog.cancel': 'Cancel',
  'dialog.save': 'Save',
  'dialog.createTopic': 'Create Topic',
  'dialog.createWorkstream': 'Create Workstream',
  'dialog.editTopic': 'Edit Topic',
  'dialog.fieldTitle': 'Title',
  'dialog.fieldDescription': 'Description',
  'dialog.fieldSummary': 'Summary',
  'dialog.fieldImportance': 'Importance',
  'dialog.fieldAttention': 'Attention',
} as const

/** Compile-time key set — a misspelled key is a tsc error. */
export type CopyKey = keyof typeof COPY

export const COPY_TABLE = COPY

/** Identity lookup into the frozen copy table (brief #7). */
export function t(key: CopyKey): string {
  return COPY[key]
}
