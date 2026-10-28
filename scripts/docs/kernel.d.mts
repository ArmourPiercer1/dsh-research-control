/**
 * Type surface for kernel.mjs — the gate scripts run on plain node (no build
 * step), so the implementation is JS and the types live here, single-sourced.
 */
export interface OwnershipRule {
  glob: string | null
  owner: string
  risk: 'blocking' | 'advisory' | string
  note?: string
}
export interface ProbeFinding {
  key?: string
  path?: string
  codes: string[]
  severity: 'blocking' | 'advisory'
  docs?: string[]
  tests?: string[]
  gate?: string
  actions?: string[]
  owners?: string[]
  paths?: string[]
  note?: string
}
export interface CheckProblem {
  code: string
  where: string
  detail: string
}
export function parseMiniYaml(text: string, where?: string): any;
export function globToRe(glob: string): RegExp;
export function loadOwnership(root: string): OwnershipRule[];
export function ownershipFor(rules: OwnershipRule[], path: string): OwnershipRule;
export function probeFindings(root: string, files: string[]): ProbeFinding[];
export const GATE_VERDICTS: string[];
export const ADR_STATUSES: string[];
export function isLinkChecked(p: string): boolean;
export function checkLinks(root: string, mdFiles: string[]): CheckProblem[];
/** 表格行列形状检查；范围由 TABLE_SHAPE_SCOPE 限定（范围与理由见 kernel.mjs）。 */
export const TABLE_SHAPE_SCOPE: string;
export function checkTableShapes(root: string, mdFiles: string[]): CheckProblem[];
export function checkAdrs(root: string, mdFiles: string[]): CheckProblem[];
export function checkRegistry(root: string): CheckProblem[];
export function checkSnapshot(root: string): CheckProblem[];
export const SYNC_WHITELIST: string[];
export function docTier(p: string): string;
export function generateDocsIndex(root: string, trackedMd: string[]): string;
export const INDEX_BEGIN: string;
export const INDEX_END: string;
export function spliceIndex(text: string, generated: string): string;
export function checkAll(root: string, trackedFiles: string[], opts?: { trackedMd?: string[] }): CheckProblem[];
