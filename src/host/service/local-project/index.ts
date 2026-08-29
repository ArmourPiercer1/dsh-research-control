/**
 * UI-2B — `src/host/service/local-project` — public surface。
 *
 * Local project creation — the Create / Bind journeys of D §8.7:
 *
 *   - 类型面: LP_* 错误族（封闭 carrier 集 — `LocalProjectError` 的
 *     message 自带 `[research-control] <CODE>: <message>` 前缀,
 *     PlaneError 同款 — gateway 折叠后 message 前缀即机器匹配键, 无需
 *     RPC mapper）+ 注入 I/O 端口（workspace 清单 / hub 探针 / 目录探针 /
 *     git 探针 / tree 探针 / 已管理探针 / mkdir / git init / scaffold /
 *     元数据写 / registry 登记）+ 服务级 DTO（inspect 四态 + create
 *     三步契约 success / failure 判别联合）;
 *   - 业务面: `LocalProjectService`（inspectProjectDirectory — 只读
 *     四态分类, B 逐字态行, 冲突态只解释永不自动修复;
 *     createLocalResearchProject — 预检 THROW（PLANE_* 沿用 bindProject
 *     阶梯逐字 message）→ 步骤 mkdir / gitInit / scaffold /
 *     metadata（可选字段缺省则整步跳过）/ register, 步骤失败 RETURN
 *     failure DTO（failedStep + completedSteps + partial-change note,
 *     无回滚引擎 — 冻结裁决）→ registry COMMIT LAST + re-init +
 *     post-check）;
 *   - **本任务不做**: Topic / Workstream 创建入口（D §8.1 — 本切片后
 *     的项目内 UI）、move / merge / bulk（D §8.2 其余）、rollback /
 *     cleanup 引擎、自动修复（冲突态永远解释 + 人工处置）。
 *
 * 分层定位（ARCHITECTURE §2.2）: host service 层 — 本目录内核零 fs /
 * 零 git / 零 DSH import（INV-PERM-5）— node:fs / git 模块 / 平面状态
 * 只出现在 dsh-adapter 的 local-project-services.ts 生产端口里;
 * tree 目录名永远是注入的 `treeDir` 参数（绝不硬编码字面量）。
 */

// Type surface (error family / I/O ports / service DTOs)。
export {
  LocalProjectError,
  isLocalProjectError,
  type CreateLocalResearchProjectFailure,
  type CreateLocalResearchProjectInput,
  type CreateLocalResearchProjectResult,
  type CreateLocalResearchProjectStep,
  type CreateLocalResearchProjectSuccess,
  type InspectProjectDirectoryInput,
  type InspectProjectDirectoryResult,
  type LocalProjectErrorCode,
  type LocalProjectInspectState,
  type LocalProjectMetadataUpdate,
  type LocalProjectRegistration,
  type LocalProjectServicePorts,
  type LocalProjectTreeProbe,
} from './types.js'

// USER business face (inspect / create — semantic gates, pure kernel)。
export { LocalProjectService, type LocalProjectServiceOptions } from './service.js'
