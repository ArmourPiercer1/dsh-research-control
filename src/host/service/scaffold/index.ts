/**
 * V2-T3.2b — public surface of the research-tree scaffold module
 * (design §8 接入「脚手架最小树」; §13 fs 操作面).
 *
 * Usage (the dsh-adapter's `bindProject` 接入 flow):
 * ```ts
 * const result = scaffoldResearchTree({
 *   wsPath,                    // the registered workspace root (absolute)
 *   treeDir: dirNames.treeDir, // T2.1's configured name (never a literal)
 *   displayName,               // the 接入 dialog's collected display name
 *   knownProjectIds,           // registry ids ∪ live tree ids (no-reuse seed)
 * })
 * // result.projectId → the registry entry's id + the tree's project.yaml id
 * ```
 */

export {
  PROJECT_YAML_FILE,
  SCAFFOLD_FILES,
  SCHEMA_VERSION_FILE,
  SCHEMA_VERSION_VALUE,
  ScaffoldError,
  allocateProjectId,
  isoTimestampUtc,
  projectYamlText,
  scaffoldResearchTree,
  type ScaffoldErrorCode,
  type ScaffoldTreeInput,
  type ScaffoldTreeResult,
} from './tree.js'
