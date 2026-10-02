# G2 — 四个只读工具闭环（BASELINE_PLAN §2d）

> 组：G2（read-only tools）· 分支 `feat/g2-readonly-tools` · base `899d49d33fc29fd44a5d3907b4bcd3204f9ba859`（origin/main = G1）
> 状态：四工具全部 stub → 实转发；stub 面剩 5 个写工具（G3/G4 组）
> 验收日志：`.g2-logs/`（组外目录，不入仓）——01 focused-red / 03 focused-green / 04 tsc 逐行比对 / 05 build / 06 wiring+discovery 全域

## 1. 交付物

| 工具 | 端口（`ResearchToolDeps`，G2 新增四只读口） | 组合服务 | 单一主体 · 全量返回 |
| --- | --- | --- | --- |
| `research_context_get` | `contextGet(sessionId)` | runbinding `getRunBySessionId`（单绑定）+ 新鲜 loader 树 join（workstream/task 标题、topic） | 一个会话 → 至多一个 formal Run（§6.2）；未绑定 = `bound:false` 诚实空结果 |
| `research_plan_get` | `planGet(workstreamId)` | WP-1.3 `PlanStore.loadPlan`（wiring 规范 provider，每次全新）+ 树 join 标题 | 一个 WS 的 `ordered_items` 逐字文件序（INV-PLAN-1，不排序/去重/截断）；缺 plan.yaml = 诚实空 subject（`present:false`）；**不一致 plan 走 fail-loud**（loader §16.1 拒绝 → `TOOL_SERVICE/DECLARATIVE_TREE_UNAVAILABLE`，与既有 RPC 面一致——无 `consistent:false` 成功面；`consistent/problem` 仅为 provider DTO 的无损透传字段） |
| `research_history_query` | `historyQuery(query)` | WP-2.3 `queryEvents`（seq 游标协议逐字）+ 真实 WS 存在性门 | 一页事件（冻结 envelope 逐字）；`next_after_seq/exhausted` 密度规则原样 |
| `research_contract_read` | `contractRead(edgeId)` | WP-1.4 `MergeContractStore.readContract`（字节级 Markdown）+ 树边快照门 | 一条边 → 完整 subject（边身份 + content + path） |

新增文件：`src/host/tools/read-ports.ts`（端口 DTO + `ToolReadServiceError` + 统一 TOOL_SERVICE 映射）、
`src/host/service/wiring/read-services.ts`（`makeToolReadServices` 组合，只读构造：`Pick` 表口 / `QueryStore`
无 append 面 / REJECTING_WRITER 之外的 PlanStore 读路径 / loader 只读）。
四个工具模块由 stub 工厂改为 `buildTool` 实定义（名称/描述/参数面逐字冻结不变）。

## 2. 裁决落地（父子双方已确认，勿再翻案）

- **分页边界（§5-Q2）**：`limit` 缺省 100，最大 1000；`>1000` 以 TOOL_INPUT **拒绝**（`/limit: must be
  <= 1000`），绝不静默截断；实际生效页大小在每页 `limit` 字段回显。常量
  `HISTORY_QUERY_DEFAULT_LIMIT/HISTORY_QUERY_MAX_LIMIT` 导出。冻结文档（`QueryHistoryArgsSchema` 无
  default/cap）与此不冲突——已核对。
- **缺对象 vs 空结果**：未知 WS → `TOOL_SERVICE` + `detail.serviceCode=WS_NOT_FOUND`；未知 TE →
  `EDGE_NOT_FOUND`；畸形 TE → 内核 `INVALID_ID`（先过内核 `assertWellFormedTeId`）。边存在而无
  contract.md（含**启动后删除**、合法 `merges/<TE>` 目录仍在的情形）→ `content:null`（ADJ-7 VALUE
  面：路径即身份，缺文件是数据）。为此 contract 读的 freshTree 对**选中边自己的**
  `merges/<TE>/contract.md` 的 `MISSING_REQUIRED` 单条错误作窄豁免（code+文件路径双精确匹配），
  其余任何 loader 错误、以及其他读口看到同一错误，一律仍 fail-loud——非 blanket 忽略。空 WS
  事件页 = 合法空结果。
- **context 主体门**：actor 无 `session_id` → `TOOL_ACTOR_FORBIDDEN`（主体即调用会话，身份永不自参数来）。
- **错误载体**：服务错误 → `ToolError('TOOL_SERVICE')`，`detail.serviceCode` 携带稳定码
  （`ToolReadServiceError` / `ReplayError` / `TopologyStoreError` / `RunBindingError` / `PlanStoreError`
  一律按 `code` 提取，run-checkpoint `RB_*` 先例）；无码错误消息逐字保留。
- **只读构造**：四端口签名 `(id) => 投影 DTO`，无写参数/写返回；INV-PLAN-3 类型面钉升级为六键
  （两写口 + 四读口），全部「无 plan 写口」断言保持；`tests/store/tc-db-004.test.ts` 写面清单加入
  `read-ports.ts`（纯 DTO，零 I/O）。

## 3. 输出 schema（严格 + 真实 host codec 可注册）

四个输出 schema 全部为闭根对象（`additionalProperties:false`，`status:{type:'string',const:'ok'}`），
直接通过宿主 `@deepseek-ai/dsh-tools` 的 `assertSupportedJsonSchema`（注册期同一道门）；成功值以
`validateJsonSchemaValue` 断言零违规（单元面 + 真实 host 注册投影面双层）。history 事件 envelope 闭包、
payload 开放对象（payload 合法性归 20 型注册表）；`next_after_seq` 用 `oneOf[integer,null]`（宿主子集无
nullable 关键字）。context/plan/contract 三个单 subject 面**无**任何分页/截断字段（definitions.test 有
反向钉）。schema 均带 `type` 伴生 `const/enum`，宿主投影克隆可直接过校验器。

## 4. 验收证据（日志在 `.g2-logs/`，含真实 exit code / node·pnpm·vitest 版本 / base SHA）

1. `01-focused-red.log` — `tests/tools/read-tools.test.ts` 实现前红：17 failed（全部
   `TOOL_NOT_IMPLEMENTED`）/ 4 passed（冻结 TOOL_INPUT 面，stub 即绿，属预期）。
2. `02-red-wiring-host.log` — 真服务 wiring 面 + host 面实现前红：8 failed / 1 passed。
3. `03-focused-green.log` — 实现后：新三套（单元 21 + 真服务 6 + host 3）+ 全 `tests/tools` +
   G1 reinit 回归 = **158/158**，exit 0。
4. `04-tsc-verification.log` — `tsc --noEmit` 与 `docs/BASELINE_TSC_BASELINE.md` 40 行快照**逐行 diff
   零差异**（无新增、无行号漂移；exit=1 为基线既有状态）。
5. `05-build.log` — `pnpm run build` exit 0。
6. `06-wiring-discovery.log` — 共享缝（`wiring/create.ts`/`tools/index.ts`）触达的全域回归：
   `tests/wiring` + `tests/discovery` **137/137**，exit 0。
7. `check-imports: OK`（INV-PERM-5；host codec 导入仅存在于 tests/，与 discovery 导入 cordis 同豁免类）。
8. e2e：**NOT_RUN**（本任务无 UI/服务改动；全套/e2e/11-tool 集成归 G5）。

覆盖矩阵：空结果（unbound session / 无 plan.yaml 的 WS-2 / 零事件 WS-2 页 / 有边无 contract 文件）、
缺对象（WS_NOT_FOUND / EDGE_NOT_FOUND / INVALID_ID）、分页边界（默认 100 回显、limit=1 全窗密度规则、
短窗收尾、1001 拒绝、非整数拒绝、游标透传逐字）、权限（Investigator 四读白名单不变、USER 拒绝先于
端口、读 lane 无需 run、伪造 `actor` 参数 TOOL_INPUT）、**无写副作用**（四读口全成功+失败路径扫一遍后，
`.research` 树与状态目录逐文件 sha256 前后全等 + run/event 计数不变）。

## 5. 共享缝实际触碰清单（单写者范围内）

- `src/host/tools/types.ts` — deps 四读端口 + 注释；无重命名/无语义改写。
- `src/host/tools/index.ts` — 新导出（read-ports 面、`parse*`、limit 常量）、`createResearchTools(deps)`
  传读口、`assertDeps` 六口钉。
- `src/host/service/wiring/create.ts` — 第 12 步前插入 `makeToolReadServices({reader, researchRoot,
  declarativeDir, tables, store, io: new FsTopologyFileIo(), planProvider})` 并 spread 进 `toolsDeps`
  （复用现有 planProvider/declarativeDir；G1 live-dispatch 面零改动，读工具自动继承 rescan 存活）。
- 测试：`tests/tools/{fixtures,stubs,definitions,inv-plan-3,permissions}.test.ts`、
  `tests/store/tc-db-004.test.ts`（六口 + 清单）。读侧新增：`tests/tools/read-tools.test.ts`、
  `tests/wiring/read-services.test.ts`、`tests/discovery/host-read-tools-g2.test.ts`、
  `tests/helpers/host-output-codec.ts`。
- 构建产物：`lib/index.js`、`e2e/factory-dist/factory.mjs` 功能性重建随提交；`SNAPSHOT.md`、
  `lib/client.js` 为机器路径/时间戳 churn，按 G1 先例回退不提交。

## 6. 未决项

- limit 100/1000 为 Q2 授权工程决定（仅本工具面）；若未来冻结文档另行规定，改一处常量。
- `DECLARATIVE_TREE_UNAVAILABLE` 的通用树损坏负例在单测端口层覆盖；真实文件面负例已由
  PR#6 review 回归补齐（缺 contract.md 的窄豁免边界 + 悬空 ordered_items 的 plan fail-loud）。
- PR#6 review 窄修记录（同 PR 提交）：① `contract.edge.lifecycle` 枚举修正为冻结
  `wsLifecycle = PLANNED|REALIZED|DROPPED`（原误写 VOID）；真实 DROPPED 边结果过真实 host
  output validator。② 选中边 contract.md 启动后被删不再被 freshTree 拒成
  `DECLARATIVE_TREE_UNAVAILABLE`（窄豁免见上），真实缺文件回归 + 其他错误仍 fail 在
  `tests/wiring/read-services.test.ts`。③ docs/tests 不再声称 `consistent:false` 成功面
  （inconsistent plan 实测 fail-loud，与既有 RPC 一致，行为零改动）。
- e2e 与 11-tool 全套集成按分工归 G5。
