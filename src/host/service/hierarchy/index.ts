/**
 * V2-UI-0.4 (Task 3) — `src/host/service/hierarchy` — public surface。
 *
 * Declarative Hierarchy CRUD — the create pair (createTopic /
 * createWorkstream, D §8.1 UI-2A):
 *
 *   - 类型面: HIER_* 错误族（封闭 carrier 集, `[research-control] <CODE>:
 *     <message>` 前缀由 RPC mapper 装配）+ 注入 I/O 端口（fresh-tree
 *     loader / atomic writer / 预写存在探针）+ 服务级 DTO;
 *   - YAML 文本构造: 纯函数（冻结 schema 属性序的受限子集,
 *     `lineWidth: 0` 确定性序列化, ISO-8601 UTC 秒级时间戳 — scaffold
 *     同款纪律）;
 *   - 业务面: `HierarchyService`（USER 语义 create — 语义门在本层,
 *     机械 I/O 全注入; 最小文件集: 一个节点只写一个文件, 可选项缺省 =
 *     未设置, 由 loader 在读取时 materialize 冻结默认值）;
 *   - **本任务不做**: update / drop / move / merge / bulk / nested /
 *     clone（D §8.2）、importance / attention_mode / lifecycle 等创建
 *     面字段、git checkpoint（mutation 不自动提交, reorderPlan 先例）、
 *     DB ledger（树即真源, 无第二套 store）。
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
  type HierarchyErrorCode,
  type HierarchyFileExists,
  type HierarchyLoadSnapshot,
  type HierarchyTreeLoader,
  type HierarchyWriter,
} from './types.js'

// Pure YAML text builders (frozen key order, lineWidth 0)。
export {
  topicYamlText,
  workstreamYamlText,
  type TopicYamlInput,
  type WorkstreamYamlInput,
} from './yaml.js'

// USER business face (createTopic / createWorkstream — semantic gates)。
export { HierarchyService, type HierarchyServiceOptions } from './service.js'
