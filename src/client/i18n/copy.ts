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

  // --- Needs Attention (UI-8, B §27-§31 / D §14) --------------------------
  // ADJ-19: the unified Needs-Attention page is a first-level hub page —
  // its namespace `attention.*` sits alongside `portfolio.*`. The B §31
  // three lines are FROZEN VERBATIM (English); the group headings are the
  // B §27 wireframe words. The kind/priority keys carry the B §27.2
  // display labels (canonical English, never a translation); the 8 status
  // wire words render directly (copy rule: domain enums have no keys).
  'attention.pageTitle': 'Needs Attention', // B §27.1 page h1
  'attention.filter.project': 'Project', // B §27.1 filter row
  'attention.filter.all': 'All', // the unfiltered option
  'attention.filter.workstream': 'Workstream',
  'attention.filter.type': 'Type',
  'attention.filter.status': 'Status',
  'attention.filter.priority': 'Priority',
  'attention.group.openActive': 'OPEN / ACTIVE', // B §27.1 group heading
  'attention.group.pending': 'PENDING',
  'attention.group.closed': 'CLOSED / CLEARED / DISMISSED',
  'attention.kind.intervention': 'Intervention', // B §27.2 Type badge
  'attention.kind.blocker': 'Blocker',
  'attention.kind.derivedBlocker': 'Derived Blocker',
  'attention.kind.nextAction': 'Next Action',
  'attention.kind.missingNextAction': 'Missing Next Action',
  'attention.priority.high': 'High', // B §4.4 紧迫性 / priority
  'attention.priority.medium': 'Medium',
  'attention.priority.low': 'Low',
  'attention.action.markPending': 'Mark Pending', // B §28
  'attention.action.closeIntervention': 'Close', // B §28
  'attention.action.reopenIntervention': 'Reopen', // B §28
  'attention.action.clearBlocker': 'Clear', // B §29
  'attention.action.promoteNextAction': 'Promote', // B §30
  'attention.action.dismissNextAction': 'Dismiss', // B §30
  'attention.action.createNextAction': 'Create Next Action', // B §30/§31
  'attention.action.openWorkstream': 'Open Workstream', // B §28/§29/§30
  'attention.action.openCause': 'Open Cause', // B §29 derived primary action
  'attention.action.openTask': 'Open Task', // B §30 post-PROMOTE
  'attention.whyShown': 'Why shown here', // B §27.2 card field label
  'attention.detectedAt': 'Created / detected', // B §27.2 card field label
  'attention.empty': 'Nothing needs attention right now.', // empty state (implementer-chosen)
  'attention.loadError': 'Failed to load the attention list.', // error face
  'attention.closeNotePrompt': 'Record the human-handling decision that closes this item (not a claim that the research question itself is resolved).', // B §28 关闭人工责任 wording
  'attention.create.statement': 'Statement', // the missing-NA create form
  'attention.create.submit': 'Create', // the missing-NA create form
  'attention.missing.title': 'Missing Next Action', // B §31 FROZEN VERBATIM
  'attention.missing.body': 'This Workstream has an active objective but no promoted Next Action.', // B §31 FROZEN VERBATIM
  'attention.missing.cta': 'Create Next Action', // B §31 FROZEN VERBATIM

  // --- Project Overview (D3, B §7 / §9) -----------------------------------
  'project.topicsHeading': 'Topics / Workstreams', // B §7.2 section
  'project.topicEdit': 'Edit', // B §9.1 [Edit]
  'project.topicAddWorkstream': '+ Workstream', // B §9.1 [+ Workstream]
  'project.topicWorkstreams': 'Workstreams', // B §9.1 'Workstreams:'
  'project.topicTopology': 'Topology', // B §9.1 'Topology:'
  'project.viewTopology': 'View topology', // #10: opens the existing topology view
  'project.attentionTitle': 'Project Attention', // B §7.2 section
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

  // --- Workstream Current Execution zone (UI-4 D4, B §15 / ADJ-10) -------
  // The eight groups in ADJ-10 order (Runs LAST). Domain enum VALUES
  // (execution/validation/run status, blocker/NA/intervention status,
  // origin, scope, priority) render their canonical English form directly
  // (D §25) and have no keys here.
  'ws.current.title': 'Current Execution', // zone title (B §27.4)
  'ws.current.objectives': 'Current Objective', // ADJ-10 group 1
  'ws.current.focus': 'Current Focus', // ADJ-10 group 2
  'ws.current.activeTasks': 'Active Tasks', // ADJ-10 group 3
  'ws.current.pendingValidation': 'Pending Validation', // ADJ-10 group 4
  'ws.current.blockers': 'Blockers', // ADJ-10 group 5
  'ws.current.nextActions': 'Next Actions', // ADJ-10 group 6
  'ws.current.interventions': 'Interventions', // ADJ-10 group 7
  'ws.current.runs': 'Runs', // ADJ-10 group 8 (LAST)
  // low-noise empty states (one quiet line per empty group):
  'ws.current.emptyObjectives': 'No active objectives',
  'ws.current.emptyFocus': 'No current focus',
  'ws.current.emptyActiveTasks': 'No active tasks',
  'ws.current.emptyPendingValidation': 'No pending validations',
  'ws.current.emptyBlockers': 'No blockers',
  'ws.current.emptyNextActions': 'No proposed next actions',
  'ws.current.emptyInterventions': 'No interventions',
  'ws.current.emptyRuns': 'No runs',
  // row facet labels:
  'ws.current.validation': 'Validation',
  'ws.current.liveRuns': 'Live runs',
  'ws.current.task': 'Task',
  'ws.current.intent': 'Intent',
  'ws.current.lastCheckpoint': 'Last checkpoint',
  'ws.current.noCheckpoint': 'none',
  // blockers (B §15.5 source tags — verbatim):
  'ws.current.blockerExplicit': '[Explicit]',
  'ws.current.blockerDerived': '[Derived]',
  'ws.current.blockerSource': 'Source',
  'ws.current.clearBlocker': 'Clear',
  // next actions (B §15.6):
  'ws.current.promoteToTask': 'Promote to Task', // B §15.6
  'ws.current.dismiss': 'Dismiss', // B §15.6
  'ws.current.rationale': 'Rationale',
  'ws.current.promotedReceipt': 'Promoted to task', // receipt: + the new Task id
  // interventions (B §15.7):
  'ws.current.ivSource': 'Source',
  'ws.current.ivWorkstreams': 'Workstreams',
  // current-focus linkage (B §20):
  'ws.current.focusMarker': 'Focus',
  'ws.current.setFocus': 'Set as Current Focus', // B §20 verbatim button
  // container mutation-fault note:
  'ws.current.actionFault': 'Action failed',

  // --- Workstream header rows (UI-4 D4, B §12) ---------------------------
  'ws.header.objective': 'Current objective',
  'ws.header.focus': 'Current focus',

  // --- Future Plan zone (UI-5 D4, B §16/§18/§19) -------------------------
  // Ordered strip (B §16 — strip top + graph bottom). The move-button
  // values are aria prefixes (the id is appended by the caller); the
  // pending/fault notes carry the legacy FutureZone copy verbatim.
  'ws.future.strip.title': 'Future Plan',
  'ws.future.strip.empty': 'No planned items',
  'ws.future.strip.addHead': 'Add at start',
  'ws.future.strip.addRow': 'Add after',
  'ws.future.strip.moveLeft': '左移',
  'ws.future.strip.moveRight': '右移',
  'ws.future.strip.reorderPending': '排序保存中…',
  'ws.future.strip.reorderFault': '排序失败：',
  // Graph face (B §18.3 — FROZEN verbatim legend keys):
  'ws.future.graph.legendCanonical': '──── Canonical order',
  'ws.future.graph.legendDependency': '- - - Dependency',
  // PlanFork badge (ADJ-9 — collapsed-by-default count badge; the value
  // is a prefix, the caller appends the count):
  'ws.future.pfBadge': '未决 PlanFork：',
  // Create form (B §19 fields; Title/Save/Cancel reuse the dialog.* keys):
  'ws.future.create.title': 'Add to Future Plan',
  'ws.future.create.kind': 'Kind',
  'ws.future.create.pending': 'Creating…',
  'ws.future.create.fault': 'Create failed',
  // Edit form (RMW — B §19; blank optional field = unknown = omitted on
  // save, never an accidental clear):
  'ws.future.edit.title': 'Edit planned item',
  'ws.future.edit.pending': 'Saving…',
  'ws.future.edit.fault': 'Save failed',
  'ws.future.edit.fieldGoal': 'Goal',
  'ws.future.edit.fieldAcceptanceCriteria': 'Acceptance criteria (one per line)',
  'ws.future.edit.fieldDeliverables': 'Deliverables (one per line)',
  'ws.future.edit.fieldNote': 'Note',
  'ws.future.edit.fieldCriteria': 'Gate criteria',
  'ws.future.edit.fieldReferences': 'References (one per line)',
  'ws.future.edit.fieldStatement': 'Milestone statement',
  // Three-state Remove (B §19.4 — FROZEN verbatim keys). A single
  // removePlanItem RPC underlies all three; the label branches on the
  // classifier in plan-item-utils (the unused-definition state is
  // reserved and unreachable in v1 — no definition-deletion RPC yet).
  'ws.future.remove.fromPlan': 'Remove from Future Plan',
  'ws.future.remove.drop': 'Drop planned item',
  'ws.future.remove.deleteUnused': 'Delete unused item',
  'ws.future.remove.pending': 'Removing…',
  'ws.future.remove.fault': 'Remove failed',
  // Dependency face (B §17 — reorder never touches dependencies, B §17.3):
  'ws.future.dep.title': 'Dependencies',
  'ws.future.dep.dependsOn': 'Depends on',
  'ws.future.dep.dependedBy': 'Depended by',
  'ws.future.dep.add': 'Add dependency',
  'ws.future.dep.addTarget': 'Target item',
  'ws.future.dep.remove': 'Remove dependency',
  'ws.future.dep.empty': 'No dependencies',
  'ws.future.dep.fault': 'Dependency change failed',

  // --- Topic topology (UI-6 D4, B §10.3/§10.4/§21/§22/§23, ADJ-9) -----------
  // Legend (B §10.3: the mandatory legend — three-state line forms +
  // FORK/MERGE arrow forms + the merge-contract badge).
  'topic.topology.legend.realized': 'Realized — solid line',
  'topic.topology.legend.planned': 'Planned — dashed line',
  'topic.topology.legend.dropped': 'Dropped — hidden by default (show-dropped toggle)',
  'topic.topology.legend.fork': 'Fork (FORK) — open arrow, route fans out',
  'topic.topology.legend.merge': 'Merge (MERGE) — filled arrow, route converges',
  'topic.topology.legend.contract': 'Merge contract badge',
  // The chip glyph — the badge text as it appears on the node/edge
  // (R-09: every UI-6 string, legend included, rides the table).
  'topic.topology.legend.contractChip': '合并契约',
  // Action bar (B §10.4 basic actions; ADJ-6: the Topic-page topology
  // zone is the single first-version entry).
  'topic.topology.action.createFork': 'Create Fork',
  'topic.topology.action.createMerge': 'Create Planned Merge',
  'topic.topology.action.drop': 'Drop',
  // Fork form (B §21.2 minimal flow).
  'topic.topology.fork.title': 'Create Workstream Fork',
  'topic.topology.fork.from': 'Fork from:',
  'topic.topology.fork.newWorkstreams': 'New Workstreams:',
  'topic.topology.fork.add': 'Add workstream',
  'topic.topology.fork.remove': 'Remove this workstream',
  'topic.topology.fork.titlePlaceholder': 'Title',
  'topic.topology.fork.noteLabel': 'Optional note',
  'topic.topology.fork.notePlaceholder': 'Note (optional)',
  'topic.topology.fork.errParent': 'Select the parent workstream to fork from',
  'topic.topology.fork.errAtLeastOne': 'At least one new workstream is required',
  'topic.topology.fork.errTitleLength': 'Each title must be 1–200 characters',
  'topic.topology.fork.errNoteLength': 'The note must be at most 200 characters',
  // Merge form (B §22 minimal fields; existing-output-first).
  'topic.topology.merge.title': 'Create Planned Merge',
  'topic.topology.merge.inputs': 'Inputs:',
  'topic.topology.merge.output': 'Output:',
  'topic.topology.merge.outputPlaceholder': 'Select the output workstream',
  'topic.topology.merge.noteLabel': 'Note (optional)',
  'topic.topology.merge.notePlaceholder': 'Note (optional)',
  // B §22 wireframe verbatim: the contract is created/edited LATER, on
  // the new merge edge (ADJ-7: createPlannedMerge carries no contract).
  'topic.topology.merge.contractLater': 'Merge Contract: [Create / Edit later]',
  'topic.topology.merge.errInputs': 'Select at least 2 input workstreams',
  'topic.topology.merge.errOutput': 'Select the output workstream',
  'topic.topology.merge.errOutputInInputs': 'The output cannot be one of the inputs',
  // Merge-contract editor (B §23 / ADJ-7: raw textarea, full replacement,
  // no front-matter parsing, no "Last updated" — the DTO has no timestamp).
  'topic.topology.contract.title': 'Merge Contract',
  'topic.topology.contract.loading': 'Loading…',
  'topic.topology.contract.none': 'No merge contract',
  'topic.topology.contract.create': 'Create',
  'topic.topology.contract.hint': 'Raw Markdown — Save replaces the whole contract',
  'topic.topology.contract.save': 'Save',
  'topic.topology.contract.errEmpty': 'The contract content cannot be empty',
  // Drop confirmation (B §10.4 "Drop planned topology operation"; ADJ-5:
  // the first-version entry offers PLANNED edges only — the state line in
  // the dialog carries the edge's current lifecycle, so the wording
  // distinguishes the three states).
  'topic.topology.drop.title': 'Drop Topology Edge',
  'topic.topology.drop.edgeLabel': 'Edge:',
  'topic.topology.drop.selectPlaceholder': 'Select the planned edge to drop',
  'topic.topology.drop.message':
    'Dropping moves this edge to the DROPPED state: DROPPED is terminal (it cannot be restored). The edge row is retained and can be shown in history mode (the "show-dropped" toggle). Confirm the drop?',
  'topic.topology.drop.confirm': 'Confirm drop',
  // Shared dialog chrome (the four topology dialogs).
  'topic.topology.cancel': 'Cancel',
  'topic.topology.saving': 'Working…',
  // Records face (V2-UI-0.4 UI-7, D §13.5 / B §24-26). ADJ-5: the
  // artifact reference notice is D §13.6 verbatim (B §25.3 divergence
  // disclosed); the tab labels and the related-count template are B
  // frozen copy.
  'ws.records.title': 'Records',
  'ws.records.tab.workspace': '[Workspace]',
  'ws.records.tab.records': '[Records]',
  'ws.records.add': 'Add Record',
  'ws.records.add.title': 'Add Record',
  'ws.records.add.kind': 'Record type',
  'ws.records.add.kind.fact': 'Fact',
  'ws.records.add.kind.claim': 'Claim',
  'ws.records.add.kind.artifact': 'Artifact',
  'ws.records.add.statement': 'Statement',
  'ws.records.add.statementRequired': 'The statement cannot be empty',
  'ws.records.add.references': 'References (one per line)',
  'ws.records.add.artifactType': 'Artifact type',
  'ws.records.add.titleField': 'Title',
  'ws.records.add.titleRequired': 'The title cannot be empty',
  'ws.records.add.uri': 'URI',
  'ws.records.add.uriRequired': 'The URI cannot be empty',
  'ws.records.add.contentHash': 'Content hash (optional)',
  'ws.records.add.relatedTask': 'Related task (optional)',
  'ws.records.add.supersedes': 'Supersedes (optional)',
  'ws.records.artifact.referenceNotice':
    'Artifact is registered by reference; Research Control does not copy/store the file.',
  'ws.records.add.save': 'Save',
  'ws.records.add.cancel': 'Cancel',
  'ws.records.add.fault': 'Record failed',
  'ws.records.filter.search': 'Search',
  'ws.records.filter.type': 'Type',
  'ws.records.filter.status': 'Status',
  'ws.records.filter.timeFrom': 'From',
  'ws.records.filter.timeTo': 'To',
  'ws.records.filter.related': 'Related to',
  'ws.records.filter.all': 'All',
  'ws.records.list.loading': 'Loading…',
  'ws.records.list.error': 'Records failed to load',
  'ws.records.list.empty': 'No records match the current filters',
  'ws.records.detail.createdBy': 'Recorded by',
  'ws.records.detail.byReference': 'registered by reference',
  'ws.records.detail.select': 'Select a record to inspect it.',
  'ws.records.detail.references': 'References',
  'ws.records.detail.relations': 'Relations',
  'ws.records.detail.back': 'Back to list',
  'ws.records.conflict': 'Conflict: pending review',
  'ws.records.action.retract': 'Retract claim',
  'ws.records.action.retract.reason': 'Reason (optional)',
  'ws.records.action.markMissing': 'Mark artifact missing',
  'ws.records.action.markMissing.reason': 'Reason (optional)',
  'ws.records.action.addRelation': 'Add relation',
  'ws.records.action.removeRelation': 'Remove relation',
  'ws.records.action.removeRelation.reason': 'Reason (optional)',
  'ws.records.action.fault': 'Action failed',
  'ws.records.relation.source': 'Source',
  'ws.records.relation.type': 'Relation type',
  'ws.records.relation.targetKind': 'Target type',
  'ws.records.relation.targetId': 'Target ID',
  'ws.records.relation.targetIdRequired': 'The target ID cannot be empty',
  'ws.records.relation.fault': 'Relation change failed',
  'ws.records.related.count': 'Related Records (n)',
} as const

/** Compile-time key set — a misspelled key is a tsc error. */
export type CopyKey = keyof typeof COPY

export const COPY_TABLE = COPY

/** Identity lookup into the frozen copy table (brief #7). */
export function t(key: CopyKey): string {
  return COPY[key]
}
