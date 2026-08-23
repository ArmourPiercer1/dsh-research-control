/**
 * Graph view styles — vendored stylesheets (WP-4.5).
 *
 * WHY A .ts FILE INSTEAD OF .module.css IMPORTS: the client bundle
 * (`lib/client.js`) is a single-file CJS closure for the host
 * `__ModuleLoader__`, and the tsdown css-guard plugin rejects any .css
 * file resolved into the client module graph (`@tsdown/css` is not
 * installed and cannot be — it would emit separate .css artifacts the
 * host loader cannot consume). The view stylesheets are therefore
 * vendored here as plain class names (one stable, view-namespaced name
 * per former CSS-module local) + the combined stylesheet text, injected
 * once at runtime by `ensureGraphStyles` (the same pattern as
 * `xyflow-base.ts`). The CSS custom property scheme (`--rc-*` ≈ host
 * `--dsw-*` aliases, DSH_ADAPTER §6) is unchanged.
 */

import { ensureXyflowBaseStyles } from './xyflow-base.js'

export const PLAN_GRAPH_STYLES: Record<string, string> = {
  canonical: 'rc-pgv-canonical',
  canvas: 'rc-pgv-canvas',
  canvasWrap: 'rc-pgv-canvasWrap',
  dismissBtn: 'rc-pgv-dismissBtn',
  errorBanner: 'rc-pgv-errorBanner',
  footRow: 'rc-pgv-footRow',
  formIcon: 'rc-pgv-formIcon',
  ghost: 'rc-pgv-ghost',
  header: 'rc-pgv-header',
  headerMeta: 'rc-pgv-headerMeta',
  headerTitle: 'rc-pgv-headerTitle',
  kindTag: 'rc-pgv-kindTag',
  loading: 'rc-pgv-loading',
  node: 'rc-pgv-node',
  nodeGate: 'rc-pgv-nodeGate',
  nodeHead: 'rc-pgv-nodeHead',
  nodeLabel: 'rc-pgv-nodeLabel',
  nodeMilestone: 'rc-pgv-nodeMilestone',
  nodeProposed: 'rc-pgv-nodeProposed',
  nodeTask: 'rc-pgv-nodeTask',
  nodeTitle: 'rc-pgv-nodeTitle',
  pfActions: 'rc-pgv-pfActions',
  pfBadge: 'rc-pgv-pfBadge',
  pfForm: 'rc-pgv-pfForm',
  pfId: 'rc-pgv-pfId',
  pfReason: 'rc-pgv-pfReason',
  pfRow: 'rc-pgv-pfRow',
  pfRun: 'rc-pgv-pfRun',
  pfStatus: 'rc-pgv-pfStatus',
  pfStatusStale: 'rc-pgv-pfStatusStale',
  root: 'rc-pgv-root',
  selectBtn: 'rc-pgv-selectBtn',
  toolbar: 'rc-pgv-toolbar',
  tsx: 'rc-pgv-tsx',
}

export const TOPOLOGY_GRAPH_STYLES: Record<string, string> = {
  canvas: 'rc-tgv-canvas',
  canvasWrap: 'rc-tgv-canvasWrap',
  contractBadge: 'rc-tgv-contractBadge',
  errorBanner: 'rc-tgv-errorBanner',
  header: 'rc-tgv-header',
  headerMeta: 'rc-tgv-headerMeta',
  headerTitle: 'rc-tgv-headerTitle',
  loading: 'rc-tgv-loading',
  root: 'rc-tgv-root',
  toggleBtn: 'rc-tgv-toggleBtn',
  tsx: 'rc-tgv-tsx',
  wsHead: 'rc-tgv-wsHead',
  wsId: 'rc-tgv-wsId',
  wsLifecycle: 'rc-tgv-wsLifecycle',
  wsMeta: 'rc-tgv-wsMeta',
  wsNode: 'rc-tgv-wsNode',
  wsNode_DROPPED: 'rc-tgv-wsNode_DROPPED',
  wsNode_PLANNED: 'rc-tgv-wsNode_PLANNED',
  wsNode_REALIZED: 'rc-tgv-wsNode_REALIZED',
  wsTitle: 'rc-tgv-wsTitle',
}

export const CONFIRM_DIALOG_STYLES: Record<string, string> = {
  actions: 'rc-cd-actions',
  cancelBtn: 'rc-cd-cancelBtn',
  confirmBtn: 'rc-cd-confirmBtn',
  confirmBtnDanger: 'rc-cd-confirmBtnDanger',
  dialog: 'rc-cd-dialog',
  dialogDanger: 'rc-cd-dialogDanger',
  message: 'rc-cd-message',
  overlay: 'rc-cd-overlay',
  title: 'rc-cd-title',
}

export const GRAPH_BASE_CSS: string = [
  `
/* PlanGraphView stylesheet (vendored) */
.rc-pgv-root {
  --rc-label-primary: var(--dsw-alias-label-primary, #1f2329);
  --rc-label-secondary: var(--dsw-alias-label-secondary, #5c6470);
  --rc-label-caption: var(--dsw-alias-label-caption, #9aa1ab);
  --rc-bg-layer-1: var(--dsw-alias-bg-layer-1, #ffffff);
  --rc-bg-layer-2: var(--dsw-alias-bg-layer-2, #f5f6f8);
  --rc-border-l1: var(--dsw-alias-border-l1, #e5e6eb);
  --rc-error-primary: var(--dsw-alias-state-error-primary, #d54941);
  --rc-warn-primary: var(--dsw-alias-state-warn-primary, #b7791f);
  --rc-accent-primary: var(--dsw-alias-accent-primary, #2b5fd9);
  --rc-font-family: var(--dsw-font-family, system-ui, -apple-system, sans-serif);
  --rc-font-xs: var(--dsw-font-xs-13, 13px);
  --rc-font-xxs: var(--dsw-font-xxs-12, 12px);
  `,
  `
  /* edge palette — mirrored by the JS constants in PlanGraphView.rc-pgv-tsx */
  --rc-edge-canonical: #4b5563;
  --rc-edge-fork-open: #7c5cff;
  --rc-edge-fork-stale: #b3a8d9;
  `,
  `
  /* kind accents (canonical node borders) */
  --rc-kind-task: #3565d8;
  --rc-kind-gate: #b7791f;
  --rc-kind-milestone: #0c8a5f;
  `,
  `
  /* fork ghost accent */
  --rc-pf-accent: #7c5cff;
  --rc-pf-bg: rgba(124, 92, 255, 0.07);
  `,
  `
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-family: var(--rc-font-family);
  color: var(--rc-label-primary);
}
  `,
  `
/* ---------------------------------------------------------------- header */
  `,
  `
.rc-pgv-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
  `,
  `
.rc-pgv-headerTitle {
  font-size: calc(var(--rc-font-xs) + 2px);
  font-weight: 600;
}
  `,
  `
.rc-pgv-headerMeta {
  font-size: var(--rc-font-xxs);
  color: var(--rc-label-secondary);
}
  `,
  `
/* ---------------------------------------------------------------- toolbar */
  `,
  `
.rc-pgv-toolbar {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
  `,
  `
.rc-pgv-pfRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px dashed var(--rc-pf-accent);
  border-radius: 8px;
  background: var(--rc-pf-bg);
  font-size: var(--rc-font-xxs);
}
  `,
  `
.rc-pgv-pfRow[data-status='STALE'] {
  opacity: 0.65;
}
  `,
  `
.rc-pgv-pfForm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--rc-pf-accent);
  color: #fff;
  font-weight: 700;
  font-size: var(--rc-font-xxs);
}
  `,
  `
.rc-pgv-pfId {
  font-weight: 600;
}
  `,
  `
.rc-pgv-pfStatus {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--rc-bg-layer-2);
  color: var(--rc-label-secondary);
}
  `,
  `
.rc-pgv-pfStatusStale {
  background: rgba(183, 121, 31, 0.14);
  color: var(--rc-warn-primary);
}
  `,
  `
.rc-pgv-pfReason {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rc-label-secondary);
}
  `,
  `
.rc-pgv-pfRun {
  color: var(--rc-label-caption);
}
  `,
  `
.rc-pgv-pfActions {
  display: inline-flex;
  gap: 6px;
}
  `,
  `
.rc-pgv-selectBtn,
.rc-pgv-dismissBtn {
  appearance: none;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: var(--rc-font-xxs);
  font-family: inherit;
  cursor: pointer;
}
  `,
  `
.rc-pgv-selectBtn {
  border: 1px solid var(--rc-accent-primary);
  background: var(--rc-accent-primary);
  color: #fff;
}
  `,
  `
.rc-pgv-selectBtn:disabled {
  border-color: var(--rc-border-l1);
  background: var(--rc-bg-layer-2);
  color: var(--rc-label-caption);
  cursor: not-allowed;
}
  `,
  `
.rc-pgv-dismissBtn {
  border: 1px solid var(--rc-border-l1);
  background: var(--rc-bg-layer-1);
  color: var(--rc-label-primary);
}
  `,
  `
/* ---------------------------------------------------------------- canvas */
  `,
  `
.rc-pgv-canvasWrap {
  /* WP-4.7 (G4 S2): the explicit height lives on the WRAP — React Flow v12
   * sets an inline height:100% on the react-flow root, which overrides any
   * stylesheet height on the canvas class itself; a 0-height wrap made the
   * whole canvas (and its clipped nodes) invisible in the browser. */
  height: 440px;
  border: 1px solid var(--rc-border-l1);
  border-radius: 10px;
  overflow: hidden;
  background: var(--rc-bg-layer-1);
}
  `,
  `
.rc-pgv-canvas {
  width: 100%;
  height: 100%;
}
  `,
  `
/* ---------------------------------------------------------------- states */
  `,
  `
.rc-pgv-loading {
  padding: 24px 12px;
  color: var(--rc-label-secondary);
  font-size: var(--rc-font-xs);
}
  `,
  `
.rc-pgv-errorBanner {
  padding: 8px 12px;
  border: 1px solid var(--rc-error-primary);
  border-radius: 8px;
  background: rgba(213, 73, 65, 0.08);
  color: var(--rc-error-primary);
  font-size: var(--rc-font-xxs);
}
  `,
  `
/* ------------------------------------------------------------ node shapes */
  `,
  `
.rc-pgv-node {
  position: relative;
  width: 240px;
  min-height: 64px;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1.5px solid var(--rc-border-l1);
  background: var(--rc-bg-layer-1);
  font-size: var(--rc-font-xxs);
  cursor: default;
}
  `,
  `
.rc-pgv-nodeHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
  `,
  `
.rc-pgv-nodeLabel {
  font-weight: 700;
}
  `,
  `
.rc-pgv-kindTag {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--rc-bg-layer-2);
  color: var(--rc-label-secondary);
}
  `,
  `
.rc-pgv-nodeTitle {
  margin-top: 3px;
  color: var(--rc-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
  `,
  `
/* canonical: SOLID border, full opacity (the §27.6 canonical look) */
.rc-pgv-canonical {
  border-style: solid;
  opacity: 1;
}
  `,
  `
.rc-pgv-nodeTask {
  border-color: var(--rc-kind-task);
}
  `,
  `
.rc-pgv-nodeGate {
  border-color: var(--rc-kind-gate);
}
  `,
  `
.rc-pgv-nodeMilestone {
  border-color: var(--rc-kind-milestone);
}
  `,
  `
/* fork ghost: DASHED border + reduced opacity — visually a PROPOSAL, never
   mistaken for the canonical line (AC/Gate P4) */
.rc-pgv-ghost {
  border-style: dashed;
  border-color: var(--rc-pf-accent);
  background: var(--rc-pf-bg);
  opacity: 0.78;
}
  `,
  `
.rc-pgv-ghost[data-stale='true'] {
  opacity: 0.45;
}
  `,
  `
.rc-pgv-nodeProposed .rc-pgv-kindTag {
  background: var(--rc-pf-accent);
  color: #fff;
}
  `,
  `
.rc-pgv-footRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
  `,
  `
.rc-pgv-formIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--rc-pf-accent);
  color: #fff;
  font-weight: 700;
}
  `,
  `
.rc-pgv-pfBadge {
  font-weight: 600;
  color: var(--rc-pf-accent);
},
/* TopologyGraphView stylesheet (vendored) */
.rc-tgv-root {
  --rc-label-primary: var(--dsw-alias-label-primary, #1f2329);
  --rc-label-secondary: var(--dsw-alias-label-secondary, #5c6470);
  --rc-label-caption: var(--dsw-alias-label-caption, #9aa1ab);
  --rc-bg-layer-1: var(--dsw-alias-bg-layer-1, #ffffff);
  --rc-bg-layer-2: var(--dsw-alias-bg-layer-2, #f5f6f8);
  --rc-border-l1: var(--dsw-alias-border-l1, #e5e6eb);
  --rc-accent-primary: var(--dsw-alias-accent-primary, #2b5fd9);
  --rc-warn-primary: var(--dsw-alias-state-warn-primary, #b7791f);
  --rc-font-family: var(--dsw-font-family, system-ui, -apple-system, sans-serif);
  --rc-font-xs: var(--dsw-font-xs-13, 13px);
  --rc-font-xxs: var(--dsw-font-xxs-12, 12px);
  `,
  `
  /* edge palette — mirrored by the JS constants in TopologyGraphView.rc-tgv-tsx */
  --rc-edge-realized-fork: #3565d8;
  --rc-edge-realized-merge: #0c8a5f;
  --rc-edge-planned-fork: #7c9bd9;
  --rc-edge-planned-merge: #63b398;
  --rc-edge-dropped: #b8bdc7;
  `,
  `
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-family: var(--rc-font-family);
  color: var(--rc-label-primary);
}
  `,
  `
/* ---------------------------------------------------------------- header */
  `,
  `
.rc-tgv-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
  `,
  `
.rc-tgv-headerTitle {
  font-size: calc(var(--rc-font-xs) + 2px);
  font-weight: 600;
}
  `,
  `
.rc-tgv-headerMeta {
  font-size: var(--rc-font-xxs);
  color: var(--rc-label-secondary);
  flex: 1;
}
  `,
  `
.rc-tgv-toggleBtn {
  appearance: none;
  border: 1px solid var(--rc-border-l1);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: var(--rc-font-xxs);
  font-family: inherit;
  background: var(--rc-bg-layer-1);
  color: var(--rc-label-secondary);
  cursor: pointer;
}
  `,
  `
.rc-tgv-toggleBtn[aria-pressed='true'] {
  border-color: var(--rc-accent-primary);
  color: var(--rc-accent-primary);
}
  `,
  `
/* ---------------------------------------------------------------- canvas */
  `,
  `
.rc-tgv-canvasWrap {
  /* WP-4.7 (G4 S2): same wrap-height fix as the plan canvas — the React
   * Flow root's inline height:100% needs a sized ancestor or the canvas
   * renders at 0px. */
  height: 440px;
  border: 1px solid var(--rc-border-l1);
  border-radius: 10px;
  overflow: hidden;
  background: var(--rc-bg-layer-1);
}
  `,
  `
.rc-tgv-canvas {
  width: 100%;
  height: 100%;
}
  `,
  `
/* ---------------------------------------------------------------- states */
  `,
  `
.rc-tgv-loading {
  padding: 24px 12px;
  color: var(--rc-label-secondary);
  font-size: var(--rc-font-xs);
}
  `,
  `
.rc-tgv-errorBanner {
  padding: 8px 12px;
  border: 1px solid var(--rc-error-primary, #d54941);
  border-radius: 8px;
  background: rgba(213, 73, 65, 0.08);
  color: var(--rc-error-primary, #d54941);
  font-size: var(--rc-font-xxs);
}
  `,
  `
/* ------------------------------------------------------------- ws nodes */
  `,
  `
.rc-tgv-wsNode {
  position: relative;
  width: 220px;
  min-height: 72px;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1.5px solid var(--rc-border-l1);
  background: var(--rc-bg-layer-1);
  font-size: var(--rc-font-xxs);
  cursor: default;
}
  `,
  `
.rc-tgv-wsHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
  `,
  `
.rc-tgv-wsId {
  font-weight: 700;
}
  `,
  `
.rc-tgv-wsLifecycle {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--rc-bg-layer-2);
  color: var(--rc-label-secondary);
}
  `,
  `
.rc-tgv-wsTitle {
  margin-top: 3px;
  color: var(--rc-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
  `,
  `
.rc-tgv-wsMeta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  color: var(--rc-label-caption);
  font-size: 11px;
}
  `,
  `
.rc-tgv-wsMeta [data-open-pf] {
  color: var(--rc-warn-primary);
}
  `,
  `
.rc-tgv-wsMeta [data-running-run] {
  color: var(--rc-accent-primary);
}
  `,
  `
.rc-tgv-contractBadge {
  display: inline-block;
  margin-top: 4px;
  padding: 0 6px;
  border-radius: 4px;
  background: rgba(12, 138, 95, 0.12);
  color: #0c8a5f;
  font-size: 11px;
  font-weight: 600;
}
  `,
  `
/* §27.5: planned Workstream → dimmed; dropped → dimmed + dashed */
.rc-tgv-wsNode_PLANNED {
  opacity: 0.55;
  border-color: var(--rc-border-l1);
}
  `,
  `
.rc-tgv-wsNode_REALIZED {
  border-color: #0c8a5f;
  opacity: 1;
}
  `,
  `
.rc-tgv-wsNode_DROPPED {
  opacity: 0.45;
  border-style: dashed;
},
/* ConfirmDialog stylesheet (vendored) */
.rc-cd-overlay {
  --rc-label-primary: var(--dsw-alias-label-primary, #1f2329);
  --rc-label-secondary: var(--dsw-alias-label-secondary, #5c6470);
  --rc-bg-layer-1: var(--dsw-alias-bg-layer-1, #ffffff);
  --rc-border-l1: var(--dsw-alias-border-l1, #e5e6eb);
  --rc-error-primary: var(--dsw-alias-state-error-primary, #d54941);
  --rc-accent-primary: var(--dsw-alias-accent-primary, #2b5fd9);
  --rc-font-family: var(--dsw-font-family, system-ui, -apple-system, sans-serif);
  --rc-font-xs: var(--dsw-font-xs-13, 13px);
  `,
  `
  position: fixed;
  inset: 0;
  background: rgba(15, 18, 24, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  font-family: var(--rc-font-family);
}
  `,
  `
.rc-cd-dialog {
  background: var(--rc-bg-layer-1);
  border: 1px solid var(--rc-border-l1);
  border-radius: 10px;
  padding: 18px 20px;
  min-width: 340px;
  max-width: 460px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
  `,
  `
.rc-cd-dialogDanger {
  border-color: var(--rc-error-primary);
}
  `,
  `
.rc-cd-title {
  margin: 0 0 8px;
  font-size: calc(var(--rc-font-xs) + 2px);
  font-weight: 600;
  color: var(--rc-label-primary);
}
  `,
  `
.rc-cd-message {
  margin: 0 0 16px;
  font-size: var(--rc-font-xs);
  line-height: 1.6;
  color: var(--rc-label-secondary);
  white-space: pre-line;
}
  `,
  `
.rc-cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
  `,
  `
.rc-cd-cancelBtn,
.rc-cd-confirmBtn {
  appearance: none;
  border: 1px solid var(--rc-border-l1);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: var(--rc-font-xs);
  font-family: inherit;
  background: var(--rc-bg-layer-1);
  color: var(--rc-label-primary);
  cursor: pointer;
}
  `,
  `
.rc-cd-cancelBtn:hover,
.rc-cd-confirmBtn:hover {
  border-color: var(--rc-label-secondary);
}
  `,
  `
.rc-cd-confirmBtn {
  border-color: var(--rc-accent-primary);
  background: var(--rc-accent-primary);
  color: #fff;
}
  `,
  `
.rc-cd-confirmBtnDanger {
  border-color: var(--rc-error-primary);
  background: var(--rc-error-primary);
}
  `,
].join('\n')

const STYLE_ID = 'rc-graph-styles'

/**
 * Inject the graph stylesheets (and the @xyflow base CSS) once per
 * document. Idempotent; a no-op where no document exists.
 */
export function ensureGraphStyles(doc?: Document): void {
  const d = doc ?? (typeof document !== 'undefined' ? document : null)
  if (d === null) return
  ensureXyflowBaseStyles(d)
  if (d.getElementById(STYLE_ID) === null) {
    const el = d.createElement('style')
    el.id = STYLE_ID
    el.textContent = GRAPH_BASE_CSS
    d.head.appendChild(el)
  }
}
