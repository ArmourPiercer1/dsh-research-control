/**
 * WP-6.1 — workspace policy 读取 (§14.1, loader 面).
 *
 * 决策 (目标 1): policy 字段经 **loader 面** 读取 — `.research/workspace.yaml`
 * 的解析 + 冻结 schema 校验 (additionalProperties: false, 枚举, default)
 * 全部归 WP-1.1 domain loader (`loadResearchTree` → `ResearchTree.workspace`
 * 的 `WorkspaceDoc`, §14.1 工程默认结构)。本模块**不重复**解析 YAML、不持有
 * 第二套 schema — 只把 loader 侧已校验的 `WorkspaceDoc` **归一化**为 audit
 * 消费的只读 `AuditPolicy`:
 *   - 缺省材料化 (audit 缺省 = 全空集; `workspace.root` 缺省 `.`;
 *     `git_required` 缺省 true — 与 §14.1 default 一致; loader 的 ajv
 *     useDefaults 已材料化大部分, 此处为**直接构造/partial 输入**兜底);
 *   - 防御性形状校验 (非空字符串/数组性) — fail loud `AuditPolicyError`;
 *     正常经 loader 的文档不应触达这些分支 (双保险, 同 checkpoint/errors 口径);
 *   - 不可变化: 输出全 readonly + 冻结副本, 输入不被改动。
 *
 * 层规则 (ARCHITECTURE §2.2): audit → domain (type-only import, 零运行时
 * 依赖) + 本模块零 I/O (纯函数)。
 */
import type {
  ArtifactType,
  WorkspaceAuditZone,
  WorkspaceDoc,
} from '../../domain/loader/index.js'
import { AuditPolicyError } from './errors.js'
import type { AuditDiscoveryZone, AuditPolicy } from './types.js'

/** §14.1 工程默认 (workspace.yaml 缺省时的 audit 面). */
export const DEFAULT_AUDIT_POLICY: AuditPolicy = Object.freeze({
  workspaceRoot: '.',
  gitRequired: true,
  strictTrackedPaths: Object.freeze([]),
  discoveryZones: Object.freeze([]),
  ignored: Object.freeze([]),
})

function assertPathList(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new AuditPolicyError(`${field} must be an array (DOMAIN_SCHEMA §14.1), got: ${typeName(value)}`)
  }
  return Object.freeze(
    value.map((entry, i) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        throw new AuditPolicyError(
          `${field}[${i}] must be a non-empty path string (DOMAIN_SCHEMA §14.1), got: ${typeName(entry)}`,
        )
      }
      return entry
    }),
  )
}

function assertZoneList(
  value: unknown,
): readonly AuditDiscoveryZone[] {
  if (!Array.isArray(value)) {
    throw new AuditPolicyError(`audit.discovery_zones must be an array (DOMAIN_SCHEMA §14.1), got: ${typeName(value)}`)
  }
  return Object.freeze(
    value.map((zone, i) => {
      if (typeof zone !== 'object' || zone === null) {
        throw new AuditPolicyError(
          `audit.discovery_zones[${i}] must be an object (DOMAIN_SCHEMA §14.1), got: ${typeName(zone)}`,
        )
      }
      const z = zone as Partial<WorkspaceAuditZone>
      if (typeof z.path !== 'string' || z.path.length === 0) {
        throw new AuditPolicyError(
          `audit.discovery_zones[${i}].path must be a non-empty path string (DOMAIN_SCHEMA §14.1), got: ${typeName(z.path)}`,
        )
      }
      let artifactTypes: readonly ArtifactType[] | undefined
      if (z.artifact_types !== undefined) {
        if (!Array.isArray(z.artifact_types) || z.artifact_types.some((t) => typeof t !== 'string')) {
          throw new AuditPolicyError(
            `audit.discovery_zones[${i}].artifact_types must be an ArtifactType string array (DOMAIN_SCHEMA §14.1), got: ${typeName(z.artifact_types)}`,
          )
        }
        artifactTypes = Object.freeze([...z.artifact_types] as ArtifactType[])
      }
      return Object.freeze({ path: z.path, ...(artifactTypes !== undefined ? { artifactTypes } : {}) })
    }),
  )
}

/**
 * 归一化 workspace policy (§14.1).
 *
 * @param doc loader 侧 `.research/workspace.yaml` 文档
 *   (`ResearchTree.workspace`; 文件缺失 = `null` → 全工程默认)。
 * @returns 冻结的只读 {@link AuditPolicy} (同输入同输出, 确定性)。
 * @throws AuditPolicyError 输入形状违反 §14.1 (loader 已校验时不可达).
 */
export function normalizeWorkspacePolicy(doc: WorkspaceDoc | null | undefined): AuditPolicy {
  if (doc === null || doc === undefined) {
    return {
      workspaceRoot: DEFAULT_AUDIT_POLICY.workspaceRoot,
      gitRequired: DEFAULT_AUDIT_POLICY.gitRequired,
      strictTrackedPaths: [...DEFAULT_AUDIT_POLICY.strictTrackedPaths],
      discoveryZones: [...DEFAULT_AUDIT_POLICY.discoveryZones],
      ignored: [...DEFAULT_AUDIT_POLICY.ignored],
    }
  }

  const workspace = doc.workspace
  if (typeof workspace !== 'object' || workspace === null) {
    throw new AuditPolicyError(
      `workspace.yaml: \`workspace\` mapping is required (DOMAIN_SCHEMA §14.1 / workspace.schema.json), got: ${typeName(workspace)}`,
    )
  }
  const workspaceRoot =
    typeof workspace.root === 'string' && workspace.root.length > 0 ? workspace.root : DEFAULT_AUDIT_POLICY.workspaceRoot
  const gitRequired = typeof workspace.git_required === 'boolean' ? workspace.git_required : DEFAULT_AUDIT_POLICY.gitRequired

  const audit = doc.audit
  if (audit !== undefined && (typeof audit !== 'object' || audit === null)) {
    throw new AuditPolicyError(`workspace.yaml: \`audit\` must be a mapping (DOMAIN_SCHEMA §14.1), got: ${typeName(audit)}`)
  }
  const strictTracked = audit?.strict_tracked
  if (strictTracked !== undefined && (typeof strictTracked !== 'object' || strictTracked === null)) {
    throw new AuditPolicyError(
      `workspace.yaml: \`audit.strict_tracked\` must be a mapping (DOMAIN_SCHEMA §14.1), got: ${typeName(strictTracked)}`,
    )
  }
  const strictTrackedPaths = assertPathList(strictTracked?.paths ?? [], 'audit.strict_tracked.paths')
  const discoveryZones = assertZoneList(audit?.discovery_zones ?? [])
  const ignored = assertPathList(audit?.ignored ?? [], 'audit.ignored')

  return Object.freeze({
    workspaceRoot,
    gitRequired,
    strictTrackedPaths,
    discoveryZones,
    ignored,
  })
}

function typeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}
