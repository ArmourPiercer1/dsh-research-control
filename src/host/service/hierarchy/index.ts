/**
 * V2-UI-0.4 (Task 3) + UI-2A — `src/host/service/hierarchy` — public surface。
 *
 * Declarative Hierarchy CRUD — the create pair (createTopic /
 * createWorkstream, D §8.1 UI-2A) + the update-and-drop set
 * (updateProjectMetadata / updateTopic / updateWorkstream /
 * dropWorkstream, D §8.2 UI-2A):
 *
 *   - 类型面: HIER_* 错误族（封闭 carrier 集, `[research-control] <CODE>:
 *     <message>` 前缀由 RPC mapper 装配）+ 注入 I/O 端口（fresh-tree
 *     loader / atomic writer / 预写存在探针 / RMW 原文读取 / 递归删目录
 *     / 历史探针 / 尽力而为焦点清除）+ 服务级 DTO;
 *   - YAML 文本构造: 纯函数（冻结 schema 属性序的受限子集,
 *     `lineWidth: 0` 确定性序列化, ISO-8601 UTC 秒级时间戳 — scaffold
 *     同款纪律）+ RMW 合并助手（只改调用方提供的字段, 其余逐字节保留,
 *     不 materialize 默认值）;
 *   - 业务面: `HierarchyService`（USER 语义 create / update / drop —
 *     语义门在本层, 机械 I/O 全注入; 最小文件集: 一个节点只写一个文件,
 *     可选项缺省 = 未设置, 由 loader 在读取时 materialize 冻结默认值;
 *     drop 保守门: 有历史事件的 workstream 不可删, 历史永不自动清除）;
 *   - **本任务不做**: move / merge / bulk / nested / clone（D §8.2 其余）、
 *     update 面不暴露 id / created_at / project_id / topic_id /
 *     lifecycle / objective_refs / current_objective_refs /
 *     origin_topology_edge_ref、git checkpoint（mutation 不自动提交,
 *     reorderPlan 先例）、DB ledger（树即真源, 无第二套 store）。
 *
 * 分层定位（ARCHITECTURE §2.2 rule 4）: host service 层 — 唯一允许写
 * `.research/` 的编排层; 本目录内核零 fs / 零 git / 零 DSH import
 * （INV-PERM-5）— node:fs 只在 wiring 的端口实现里出现。
 */

// Type surface (error family / I/O ports / service DTOs)。
export {
  HierarchyError,
  isHierarchyError,
  type CreateTopicInput,
  type CreateTopicOutput,
  type CreateWorkstreamInput,
  type CreateWorkstreamOutput,
  type DropWorkstreamInput,
  type DropWorkstreamOutput,
  type HierarchyClearCurrentFocus,
  type HierarchyErrorCode,
  type HierarchyFileExists,
  type HierarchyHasHistory,
  type HierarchyLoadSnapshot,
  type HierarchyReadFile,
  type HierarchyRemoveDir,
  type HierarchyTreeLoader,
  type HierarchyWriter,
  type UpdateProjectMetadataInput,
  type UpdateProjectMetadataOutput,
  type UpdateTopicInput,
  type UpdateTopicOutput,
  type UpdateWorkstreamInput,
  type UpdateWorkstreamOutput,
} from './types.js'

// Pure YAML text builders + RMW merge helpers (frozen key order,
// lineWidth 0)。
export {
  applyYamlFields,
  mergedYamlText,
  parseYamlMapping,
  topicYamlText,
  updateProjectYamlText,
  updateTopicYamlText,
  updateWorkstreamYamlText,
  workstreamYamlText,
  type MergedYamlResult,
  type TopicYamlInput,
  type WorkstreamYamlInput,
} from './yaml.js'

// USER business face (create / update / drop — semantic gates)。
export { HierarchyService, type HierarchyServiceOptions } from './service.js'
