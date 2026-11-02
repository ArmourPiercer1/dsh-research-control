# E0 — 宿主能力面实测（复用优先 PoC 一手证据）

- 实测日期：2026-11-01。执行：G1 子代理（E0 探针）。
- **真值树 T = `tests/deepseek-harness/`**（0.2.0-rc.2 @ `c1b47e41fc`，AGENTS §2；root package.json `"version": "0.2.0-rc.2"` 核验一致）。
- **参考树 R = `references/deepseek-harness/`**（0.1.5-rc.2 @ `fb2c4b9e69`，只读，AGENTS §1）。
- 全部路径相对各树根；命令均在对应树根执行、退出码为**真实观测值**（管道 `| wc -l` 的 rc 恒 0，凡单独 grep 处标注 rc）。本探针未入仓（无脚本必要，命令内联于本文）。
- 检索口径：`--include="*.ts"`，排除 `node_modules`、`/lib/`（构建产物）、`*.test.ts`、`/tests/`。

## 总判定表

| # | 主张 | 判定 |
|---|---|---|
| 1 | storageDomain = zod KV + json/sqlite | **成立（部分）**：zod KV + 双后端属实；**无事务、非 append-only、不跨键原子 → 不能当事件真源** |
| 2 | SessionEventMap 合并扩事件 + 插件可 append + session/event 订阅 | **成立（强）**：append-only 为**机制强制**；有 seq/因果/截点；按时间点读回可用但同步读已废弃 |
| 3 | inject / systemPrompt.section / defineTool+scope+pre-execute / slots / FTS5 | **成立**：五面俱全（slots 仅 client 面） |
| 4 | 宿主无知识存储/图谱/RDF/向量/引用管理 | **实质成立；「8 关键词零命中」方法不成立**（子串命中数百，全为自然语言噪声） |
| 5 | 存在 V3 前提编排者（blueprint / team-remote / 15 team_* / grant–revoke） | **两树均不成立**（源码零命中）；实存的是实验性 agent-team：**9 个模型工具**（roster+mailbox+任务 DAG） |
| 6a | 多 Space / 多租户隔离可直接复用 | **不存在**（最接近：profile+DSH_HOME、workspaceRegistry 分组、dsh-scope） |
| 6b | 版本化 Capability 端口 / 插件间调用面 | **无版本协商端口**；进程内 = Cordis DI 服务缝；跨进程 = SDK JSON-RPC |

## 1. `ctx.storageDomain` — 部分成立，不能当事件真源

定义点与签名（T）：

- 注入声明：`packages/storage/storage-domain/src/index.ts:36-37` —「`interface Context { storageDomain: DomainFacility`」。
- 打开签名：`index.ts:103` —「`async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>`」。
- zod 校验：`src/spec.ts:11` —「`import type { ZodType } from 'zod'`」；每记录 `valueSchema: ZodType<V>`（`spec.ts:29`）；`defineDomain`（`spec.ts:107`）在装载即校名/版本/null 哨兵。
- 双后端 kv facet：`packages/storage/storage-json/src/index.ts:48`「`readonly kv: KvFacet`」（single/per-record 两布局，`:69`）；`packages/storage/storage-sqlite/src/index.ts:57` 同形；`SCHEMA_VERSION` = `storage-sqlite/src/schema.ts:20`。后端按域路由：storage-domain `Config`「`routes?: Record<string, string>`」（`index.ts:55-64`）。
- 消费实证：schedule `src/index.ts:126`、workspace `src/index.ts:198`、session-projection-cache `:118` 均 `ctx.storageDomain.open(spec)`。

事务/append-only/跨键原子实测（domain.ts）：

- **无事务 API**。后端单元契约 `packages/storage/storage/src/backend.ts:85-131` 的 `KvUnit` 只有 `loadAll` / `putRecord` / `deleteRecord` / `backupRecord?` / `setGlobal`——无 `transaction` / `begin` / `commit` / `rollback`（grep 零命中）。
- 原子性只到**单键**：`KvTable.update`（`domain.ts:89` + 实现 `:332`）——「`Atomic read-modify-write on the domain's write chain`」；整域一条串行写链（`enqueue` `:263`）。多键写 = N 次独立入链、N 条 `domain/changed` 事件，观察者可读到中间态。
- **非 append-only**：`put`（`:72`，「Insert or overwrite」）与 `delete`（`:80`）是公开 API，无任何不可变约束。
- json `single` 布局的整文档原子替换（`storage-json/src/atomic.ts:5`「`rename() over the target`」）是**崩溃持久性**，不是跨键事务。

结论：**事件真源不能建在 storageDomain 上**（可覆写可删、无跨键原子提交点）。

## 2. Session 事件面 — 成立（强）

- 合并扩事件：`packages/core/session/src/types.ts:281`「`export interface SessionEventMap`」（JSDoc「`merge-extensible, append-only source of truth`」）；插件扩展示例（goal）：`packages/goal/goal/src/domain.ts:61-66` 以 `declare module '@deepseek-ai/dsh-session/types'` 并入 `'goal/change'`。plan/tool-todo/llm-retry/command-feedback 同款（`grep -rln "interface SessionEventMap"` 全命中 declare-module）。
- `Session.append`：`packages/core/session/src/index.ts:722-725` —「`append<T extends SessionEventType>(type: T, data: SessionEventMap[T], ...opts): SessionEvent<T>`」；**插件可写实证**：goal `src/index.ts:613`、tool-todo `src/index.ts:199`、command-feedback `src/index.ts:60`（`agent.session.append(...)`）。
- 订阅：`index.ts:77` Events 声明「`'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void`」，`@mode emit`，JSDoc「`Post-commit, fire-and-forget append feed`」。
- **append-only = 机制强制，不是惯例**：日志字段私有（`index.ts:447`「`private log: SessionEvent[] = []`」）；每条事件 `deepFreeze` + data 快照化（`:739-752`，读回「`never the caller's still-mutable input`」）；Session 无公开 truncate/delete/mutate（全文件无 `.pop(`/`truncate`）；持久面 jsonl 仅追加，「`a torn physical tail is never returned to a reader and is truncated by the write path before its first append`」（`packages/session/session-persistence/src/index.ts:119-121`）。
- **seq/因果/截点**：seq 连续契约（`get seq()` `:681`「`always the log length`」；`SessionEvent.seq` types.ts:495）；因果 = `sourceEventSeqs`（`SurfaceIntent`，types.ts:470-489，surface 事件必携）；截点 = fork 继承前缀（`inheritedEventCount`/`ownEvents` `:663-668`，`'session/end-seed'`）。
- **按时间点读回**：`snapshotEvents(fromSeq, toSeqExclusive)`（`:649`）可用但 **`@deprecated`**——Agent Note「`2026-09-09-deprecate-synchronous-session-event-reads`」禁新增同步历史读；新读法 = `SessionPersistence.read`（整份已验证日志，session-persistence `:85-88`）或异步分页（`SessionQueryEngine`，见 §3 FTS5）。

结论：**宿主 Session 事件日志可当事件真源**（对插件进程内消费者机制级足够）；约束：真源天然**绑定单会话日志**，跨会话/全局事件流需自建投影/索引层（宿主已示范该法：session-projection + projection-cache 建在 storageDomain 上）。

## 3. 五个 API 面 — 成立

| 面 | 定义点（T） | 签名短句 / 可用面 |
|---|---|---|
| `agent.inject()` | `packages/core/agent/src/runtime-types.ts:241`；实现 `core/agent-loop/src/agent.ts:171` | 「`inject(message: UserMessage): void`」= next-step 注入不唤醒（`send(input,'next-step',false)`；兄弟 `followup`/`steer` :222/:231） |
| `ctx.systemPrompt.section` | `packages/core/system-prompt/src/index.ts:454`（Context 声明 :15；`PromptSection` :53） | 「`section(section: PromptSection): () => void`」按调用 scope 注册、同名 shadow、返回 effect disposer |
| `defineTool` + per-agent scope | `packages/core/tools/src/schema.ts:554`；注册 `core/tools/src/index.ts:1063`、限制 `:1097` | 「`defineTool<const S extends ParameterSchemaSpec,...>(options): ToolDefinition`」；`register()` 「`Register globally or in the calling agent scope. Scoped tools shadow globals`」；`restrict(filter)` 要求 `agent.ctx` scoped context（`:1100` 报错文案），allow/deny 掩码交集 |
| `tools/pre-execute` | `packages/core/tools/src/index.ts:153`（waterfall）；决策类型 `:607-612` | 「`'tools/pre-execute'(this: Scoped<ToolRuntime>, exec, next): Promise<PreToolDecision>`」；`PreToolDecision = allow | deny{reason} | cancel | ask{reason?,displayReason?}`——ask 走 approval 服务 `allowed-once`，agent-scoped 派发（`core/scope/src/scoped-events.generated.ts:34`） |
| `ctx.slots.register` | **client 面**：`packages/client/ui-renderer/src/client/registry.ts:120`「`class SlotRegistry extends Service`」（Context 声明 `client/index.ts:45`） | 槽名实证：`'settings.section'`（ui-settings-account/src/client/index.ts:289-294）、`'shell.overlay'`（:253）、`'conversation.composer'`（ui-approval/src/client/index.ts:91）、`'conversation.input.permission'`（ui-permission-presets:167）。**注意：host 插件 ctx 无 slots**，注册发生在 GUI client context |
| FTS5 会话检索 | `packages/session-query/session-query-sqlite/src/schema.ts:127`/`:158` | 「`CREATE VIRTUAL TABLE IF NOT EXISTS persisted_docs USING fts5(text, session_id UNINDEXED, seq UNINDEXED, ...)`」+ `temp.live_docs`；API：`session-query/src/index.ts:153/:164` `searchSessions`/`searchEvents` 异步分页 |

## 4. 宿主没有知识存储/图谱/RDF/向量/引用管理 — 实质成立，「零命中」表述被推翻

朴素子串计数（口径如上；rc=0 均有命中）：`knowledge`=262、`graph`=372、`rdf`=72、`vector`=10、`embedding`=17、`citation`=30、`bibliograph`=0、`triple`=8。**全部为自然语言子串**：`acknowledge`ment、plugin/boot `graph`、reco**rdf**…（`recordFor`/`recordFeedback`）、argv `vector`、动名词 embe**dding**、web 结果 UI 的「`citation list`」（`core/tools/src/presentation.ts:352`）。

词边界 + 语义复核（`grep -rniwE`）：

- `rdf|sparql|neo4j|ontology`（-w 合并）：**rc=1（零命中）**。
- `knowledge graph` / `graph database` / `triples` / `resource description`：计数 0。
- 剩余 `-w` 命中均散文化：knowledge 12（模型描述文案「`knowledge, and difficult reasoning`」）、vector 1（`tool-fs-search/src/grep.ts:5` 的「argument vector」）、embedding 15（动词用法；唯一近义处 = Exa **外部**检索模式注释 `web-search-exa/src/types.ts:13`）、citation 10（session 引用「`citation order`」+ web 源展示 UI）。

命令（可复现）：

```sh
grep -rniwE "rdf|sparql|neo4j|ontology" packages --include="*.ts" | grep -v "node_modules\|/lib/"   # rc=1
grep -rniE "knowledge graph|graph database|neo4j|sparql" packages --include="*.ts" | grep -v "node_modules\|/lib/" | wc -l   # 0（rc=0）
```

判定：**无知识/图谱/RDF/向量/引用管理子系统**（无包、无服务、无 schema）；复审「8 关键词零命中」若按字面子串检索**不成立**（数百命中），须改口径为词边界+语义分类。

## 5. 编排者 — 两树均不存在；实存实验性 agent-team（9 工具）

两树扫描（`packages apps`，`--include="*.ts"`；含 docs 时仅 `apps/web/dist` 构建产物噪声命中 blueprint——MDX 高亮语法表，非源码）：

| 关键词 | T (0.2.0-rc.2) | R (0.1.5-rc.2) |
|---|---|---|
| `blueprint`（源码 .ts） | **0**（`grep -rni blueprint packages apps --include="*.ts"` rc=1） | **0** |
| `team-remote` / `team_remote` | **0**（rc=1） | **0**（rc=1） |
| `team_grant` / `team_revoke` / `team_delegate` / `team_list_pending` / `team_follow` | **0**（rc 管道 0，计数 0） | **0** |
| 权限 `grant`/`revoke` API 面 | 无权限规则 grant–revoke。命中仅为 OAuth/账号凭证（`packages/credentials/deepseek-account-platform/src/index.ts:474,501`）与 **plugin_manager 版本豁免**「`Grant or revoke one exact plugin/runtime exemption`」（`packages/boot/plugin-manager/src/index.ts:237-240`） | 同型 |

**实存物 = 出厂关闭的实验性 agent-team**（roster+mailbox+任务 DAG），两树同形：

- 内核：`packages/experimental/agent-team/src/`——`roster.ts`、`mailbox.ts`、`task-board.ts`、`task-graph.ts`（DAG）、`journal.ts`、`lifecycle.ts`、`projection.ts`。
- 模型工具 **9 个**（`name: '` 计 10 = 9 工具 + 1 个 `team:policy` prompt section）：T `packages/experimental/tool-agent-team/src/index.ts` — `spawn_teammate:176`、`send_message:216`、`list_agents:233`、`wait_agent:243`、`interrupt_agent:278`、`team_task_create:290`、`team_task_list:314`、`team_task_get:346`、`team_task_update:361`；R 同名单（`:174-350`，计 10 行）。模块头：「`Scoped model-facing tools for the opt-in Agent Teams runtime`」（T :1）。
- 出厂隔离：`packages/experimental/AGENTS.md`——release 包禁止依赖 experimental +「Default-product isolation」CI 规则；默认 profile 不含（仅测试 patch 挂载，如 `apps/cli/tests/profiles/headless/team-snapshot.patch.yml`）。

判定：所谓「blueprint / team-remote catalog / 15 个 team_* 工具 / 权限 grant–revoke」的**编排者在两棵树中不存在**——那是比本基线更新的宿主形态；**编排者需 V3 自建**（可借 agent-team 的 roster/mailbox/task-DAG 形状，但它在 experimental 且无受控装配承诺）。

## 6. 主动两问

### (a) 多 Space / 多租户隔离：**不存在可直接用的概念**

- `grep -rniw tenant packages --include="*.ts"`（src，非测试）命中 1 处 = OAuth 计费文案（`packages/llm/llm-pi-ai/src/index.ts:191`）；无 Space 实体。
- 最接近的三块料：① profile + `DSH_HOME`（进程级单租户，一切状态收于一根）；② `workspaceRegistry`（`packages/workspace/workspace/src/index.ts:3-4`「`durable workspace records ... header-validated session membership over the domain data form`」——目录↔会话分组，**非隔离**，本身也建在 storageDomain 上 :198）；③ dsh-scope agent 作用域（`packages/core/scope/src/index.ts:137`「`createScope(ctx, key, options)`」，事件/工具按 scope 链派发过滤）。storageDomain 的按域后端路由（§1 `Config.routes`）可作**手工**租户分区材料。

### (b) 版本化 Capability 端口 / 插件间调用：**无端口级版本协商**

- 进程内插件间协作 = Cordis DI 服务缝（Service Definition / Provider / Consumer 词汇，`docs/glossary.md:7`「capability-seam」）：`static inject` 注入 + `ctx.get(name)` 可选读（packages/AGENTS.md 规约）；**无 capability 版本注册/协商面**。
- 版本约束在装载层：npm semver + peerDependencies；豁免机制 = plugin_manager 版本豁免（`boot/plugin-manager/src/index.ts:237-240`）。API 整体 pre-stable（root AGENTS：「`Public APIs are pre-stable; update every consumer`」）——**复用宿主即接受全量跟进上游**。
- 跨进程仅 SDK JSON-RPC（`packages/sdk/protocol/src/types.ts`：`InitializeParams` 握手、`serverInfo: { name; version }`），面向外部客户端，不是插件间总线。

## 复核后推翻复审的点

1. **「8 关键词零命中」推翻**（字面子串命中数百；实质结论经词边界+语义分类后成立）。
2. **「存在 15 个 team_* 工具 / blueprint / team-remote / grant–revoke 编排者」推翻**：两树源码零命中；实验性 agent-team 实为 **9 工具**，出厂 opt-in。
3. 若复审认为「storageDomain 可当事件真源」——**推翻**（无事务、可删可盖写、不跨键原子）。
4. 若复审认为「Session append-only 仅惯例」——**推翻**（private log + deepFreeze + 无变异 API + jsonl 追加持久 = 机制强制）。
