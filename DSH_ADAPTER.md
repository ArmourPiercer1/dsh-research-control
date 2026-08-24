# DSH_ADAPTER.md - DSH 宿主 API 映射与适配层规范

> 文档状态：**Frozen V1**（2026-08-22 冻结；含独立审计修订 A-16/A-17 及 U1/U2/U4/U8 静态消解、新增 U9，追溯见计划书 §40 附录）
> 基线宿主版本：DeepSeek Harness **0.1.0-rc.8**（本仓库 `deepseek-harness/` checkout；2026-08-21 一手验证）
> 验证标记：**[V]** = 已在 checkout 中亲自核验（读文档/源码/grep 命中）；**[?]** = 未验证，附验证路径，实现期必须先消解。
> 素材来源：本文合并了 host 侧与 client 侧两份深度调研（`docs/engineering/_dsh_adapter_host.md`、`_dsh_adapter_client.md`，保留作附录材料）并对关键论断做了独立抽查复核。
> 目标读者：实现 `src/host/dsh-adapter/` 与 `src/client/dsh-adapter/` 的工程师。业务代码只依赖 ARCHITECTURE §2.3 的 8 个插件自有接口；本文是这些接口到真实 DSH API 的唯一映射真源。

---

## 1. 隔离原则（为什么需要这一层）

DSH 处于 developer preview，根 AGENTS.md 明确 pre-release 立场："rename or repackage freely… Backends reject old on-disk formats"，**无 API 兼容承诺**（计划书 R1）。因此：

1. 业务代码（domain/history/persistence/git/service/views/...）**禁止** import 任何 `@deepseek-ai/*` 包或 DSH 内部模块 —— lint 规则强制（INV-PERM-5，TC-DOM-030）；
2. 所有 DSH 依赖集中在两个 adapter 目录；每个 adapter 模块顶部注明对应的 DSH 文件路径（本文映射表）；
3. DSH 升级流程：pin 新版本 -> 跑 TC-DSH-008 compatibility smoke -> 只改 adapter 与本文档；
4. 插件自持 `minDshVersion` fail-loud 检查（§12），不依赖 DSH 提供机制（经 grep 验证 DSH 无 plugin API 版本检查 [V]）。

## 2. 扩展点清单总表

| 能力域 | DSH API / 类型 | 包 | 稳定性评估 | 验证 |
|---|---|---|---|---|
| 插件生命周期 | `Service` 子类 / `static inject` / `static Config` / `[Service.init]` / `ctx.effect` | vendored cordis | Cordis 语义稳定 | [V] cordis-tutorial 01-03、message-feedback 源码 |
| 插件安装 | `dsh plugin --profile <p> add <pkg>` + `dsh.bundle` 声明 | `apps/cli/src/plugin.ts` | 稳定 | [V] plugin.ts reconcilePlugins |
| Host service | `Service` + `declare module` Context 声明合并 | vendored cordis | 稳定 | [V] tutorial 03 |
| 事件订阅 | `ctx.on(...)` 五种 dispatch mode；waterfall 必调 `next()` | vendored cordis + core/session | 稳定 | [V] cordis-api/events.md |
| RPC | `TypertRemoteService` + `@Remote` + 构建期生成 `./typert`/`./remote` | typert-protocol/generator/loader | 生成管线较新，中风险 | [V] api-gateway.md、message-feedback |
| Client UI | `ctx.slots.register/inject` + SlotMap 声明合并 | client/ui-slots + runtime | 规则严格文档化，中风险 | [V] client/AGENTS.md、ui-trajectory 源码 |
| Session（host） | `ctx.sessions`（SessionStore：create/get/fork/flush…） | core/session | 稳定 | [V] session/src/index.ts |
| Session（client） | `ctx.sessions`（ISessions：`list` ObservableSnapshot/`open`/`search`/`fork`…） | client/runtime | 稳定 | [V] runtime contract |
| Session 查询 | `ctx.sessionQuery`（`filterSessions({kind:'cwd'})` 等） | session-query | 中（web 默认 `openAt:never` [V]） | [V] bundle web-app patch |
| Workspace | `ctx.workspaceRegistry`（host）/ `ctx.workspaces`（client） | workspace/ | 稳定 | [V] workspace/src/index.ts |
| Subagent | `ctx.subagents.start(...)`（host-only）；client 仅 list/history/prompt/interrupt | subagent/* | 接口稳定 | [V] 包清单 + apiproxy |
| 权限 preset | `/permission read-only` 命令 + `sandbox/mode`+`approval/policy` knob | interaction/permission-presets | 稳定 | [V] base patch L197 |
| 持久化 | storage hub（KV，不适合我们）；自开 `node:sqlite` | storage/* | 稳定 | [V] storage-sqlite README |
| 工具注册 | `defineTool` + `ctx.tools.register` | core/tools | 稳定 | [V] extension-cookbook、tool-bash |
| 实时通道 | `/api/events.mux` + `/api/events.host` 帧 + `session/projection` | client/connection + host/apiproxy | 稳定 | [V] apiproxy events.ts |
| 版本兼容 | **无宿主机制**；peer pin + 自持检查 | — | — | [V] grep 无 semver 判定 |

## 3. 插件打包与加载（packaging runbook）

**核心模型**（[V] `docs/architecture.md`、`packages/boot/app-boot/src/profile.ts:1-96`）：运行中的 `dsh` = boot 时按层组合的 Cordis 插件树：profile（`$DSH_HOME/profiles/<name>/`）-> 按 `dsh.profile.bundles` 顺序叠加各 bundle patch 层 -> profile `cordis.patch.yml` -> home 级 patch -> `--patch` overlay。

**package.json 约定**（`dsh` 字段，[V] profile.ts:41-70）：

```jsonc
{
  "name": "dsh-research-control",
  "type": "module",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },          // bundle 角色：导出一个 patch 层
    "client": { "platform": "web", "inject": [...] }       // 浏览器半边（须有 "./client" export）
  }
}
```

- 只有声明 `dsh.bundle` 的包才是"层"；`dsh plugin add` 后由 `reconcilePlugins` 按安装态自动追加进层列表（[V] `apps/cli/src/plugin.ts:59`）；
- **cordis.patch.yml 格式**（[V] patch 行语义权威出处 docs/architecture.md:27 + base/web-app 官方范例；`config`/`!!js` 细节见 tutorial 05）：顶层数组；`- id: <row>` 整体替换该行 `config`（不深合并）；`- insert: [...]` 新增行；`disabled: true` 卸载保留行；`config`/`disabled` 支持 `!!js`。

**Runbook（从零到可见）**（各步机制均已核验）：

1. 插件包构建：host 面 `lib/index.js`（default-export service 类）；client 面 `lib/client.js`（tsdown `clientBundle` 预设）；RPC 面需 `lib/typert.host.*` + `lib/typert.remote-client.*`（§5）；
2. 包内 `cordis.patch.yml` 最小内容：`- insert: [{ id: research-control, name: 'dsh-research-control' }]`；
3. 用户安装：`dsh plugin --profile web add dsh-research-control`（本质：profile 目录跑 pnpm + reconcile 层列表，[V] plugin.ts:120-158）；
4. 验证：`dsh --profile web --dump-config` 确认行与 config；
5. 卸载/热切换：profile patch 中该行 `disabled: true`（行按 id diff，只影响变化项）；
6. **注意**：web-app bundle 把 base 的 `hmr` 行 `disabled: true`（[V] web-app patch L21-23，注释 TODO）——web 组合下 patch 层热重载按**冷重启**设计；`dev:web` watcher 的 client bundle HMR 是独立通道（§6）。

## 4. Host 侧插件与 service

**插件形态**（[V] tutorial 01/03 + `packages/AGENTS.md` + postmortem 0001）：**service 包 default-export service 类，函数插件 named-export `name`/`inject`/`Config`/`apply` 且无 default export** —— 两种形态不混用（混用致 Loader 丢弃函数插件 namespace）。我们暴露 `ctx.researchControl`，用 service 形态（生产样板 [V] `packages/feedback/message-feedback/src/index.ts:150-196`）：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/cordis' {
  interface Context { researchControl: ResearchControlService }
}

export class ResearchControlService extends TypertRemoteService {
  static inject = ['sessions', 'tools', 'subagents', 'workspaceRegistry']  // 硬依赖：fiber PENDING 至就绪
  constructor(ctx: Context, config: Config) { super(ctx, 'researchControl') }
  protected async [Service.init](): Promise<void> { /* SQLite open、watcher 等 */ }
}
export default ResearchControlService
```

要点（[V] tutorial 02/03、cordis-api/service.md）：

- fiber 状态机 `PENDING -> LOADING -> ACTIVE -> UNLOADING -> DISPOSED`（可 FAILED）；`inject` 缺 service 时静默 PENDING（诊断：`ctx.registry.values()` + FiberState）；
- **注册即可逆 effect**：`ctx.on`/`ctx.tools.register`/`ctx.plugin` 等随 fiber 卸载自动回滚；Cordis 管不到的资源（SQLite 连接、文件 watcher）用 `ctx.effect(() => disposer)` 包裹；异步 disposer 并发执行、逆序开始——需按序 teardown 时放进同一个 disposer；
- `[Service.init]` 承载构造后异步初始化；`static Config`（schemastery）校验 config，默认值也经它声明（root AGENTS.md：no hardcoded tunables）；
- 事件：`ctx.on(name, listener, {prepend?, global?})`；waterfall listener **必须** `next()`；typed events 用 `declare module ... interface Events` 合并；可选服务用 `ctx.get('name')`（postmortem 0001 教训）。

**映射**：`DshHostAdapter.mountResearchControl(...)`、`DshHostAdapter.onSessionEvent(handler)`。

## 5. Host↔Client RPC（Typert）

**Host 侧定义**（[V] api-gateway.md + message-feedback:150,189-196 真实样例）：

1. service 继承 `TypertRemoteService`，`super(ctx, 'researchControl')` 定 wire namespace；
2. 公有实例方法标 `@Remote('name')`；scope 绑定用 `@RemoteScope(key)`（我们不用）；
3. **严格限制**：public 非 static、非泛型、参数具名简单标识符（无解构/默认值/rest/可选）；类型 JSON 可表示；**我们 13 个 RPC 全传纯 JSON DTO，完全避开 `TypertLookupMap`/lookup provider 机制**；
4. 协作取消：末参 `signal: AbortSignal`；
5. wire：`POST /api/researchControl/<method>`，payload `{args}`；**unary only**，流式/分页不得伪装成 Remote（与计划书 §24.4 一致）。

**契约生成**（[V] typert/generator/README + api-gateway.md）：构建期 `WorkspaceTypertGenerator` 从源码类型生成 `lib/typert.host.{js,d.ts}`（包须 `./typert` export）与 `lib/typert.remote-client.{js,d.ts}`（`./remote` export），package.json `files` 须含四个产物。仓库内由根 tsdown 的 `typertPlugin` 驱动。

- Host 注册：`dsh-typert-loader` 自动发现 Loader entry 包的 `./typert` 导出并注册（[V] typert/loader/README；该 loader 已在 base 层挂载）——**out-of-tree 包被 Loader 加载即生效**；
- Client 挂载：`ctx.remote.$mount(contribution)`，contribution = `./remote` 的 default export `{package, descriptors}`（[V] typert/protocol/types.ts:213-228）。官方 web 客户端的 `api-remotes` 是**写死的 7 个 import**（[V] remotes/src/client/index.ts:110-130）——**我们的 client 半边须自己 inject `remote` 后 `$mount` 我们的 contribution**。**[已静态消解]**（§13-U2）：`$mount` 接受任意 `TypertRemoteContribution`，无包名白名单，唯一实质校验是 descriptor 须带 strict codec（[V] `packages/api/gateway/src/client/index.ts:100-108`；gateway 测试大量挂载虚构 `@fixture/*` 包，tests/gateway.client.spec.ts:94-113）；保留 Phase 0 运行时 round-trip 尾巴；
- **独立生成工件 [已静态消解·保留运行时尾巴]**（§13-U4）：generator 不绑定 DSH 仓库身份——`WorkspaceTypertGenerator` 构造器接受任意 root 目录（"directory containing face aggregate tsconfigs"，[V] workspace.ts:23-25）；`typert-protocol`/`typert-generator`/`typert-loader` 三包均 `publishConfig.access: public`。tsconfig 覆写细节未单独核验，留运行时尾巴；fallback = 手写 `InvocationDescriptor` manifest（格式在 protocol/types.ts）；
- **SRC fallback**（[V] api-gateway.md）：`dsh` 从源码启动时网关用弱描述符分发（无 client codec），dev 模式 host 侧可先跑通；
- 契约变更流程：改装饰器/签名后按序重跑 `build:lib:host`（生成）再 client 相位；只改方法体不用。

**事件推送限制（重要设计输入）**（[V] remotes/src/remote-events.ts:17）：Host->Client 事件转发由 `API_REMOTE_FORWARDED_EVENTS` 白名单（约 11 个事件，改它需改 DSH 源码）控制。我们的自定义事件**不会被转发**——Cockpit 刷新只能用 unary 拉取 + mutation 后 invalidate/refetch（恰好与 ARCHITECTURE §8 的实时性策略完全一致；见 §11 projection 通道的例外）。

**映射**：`DshRpcAdapter.defineRemotes(serviceClass)`；client 侧 `$mount` 归 `DshUiAdapter` 初始化。

## 6. Client 侧集成（slot 系统）

**硬规则**（[V] `packages/client/AGENTS.md` 权威）：唯一组合 API `ctx.slots.register({name, children?, store?, inject?, id?, order?, label?}, Component)`；SlotMap 声明合并（`'<domain>.<entry>.<hole>'`，kind: single/keyed/list/chain，scope: root/session/session-maybe）；`children` = 声明+授权；组件 props = 四股 share（`PropsRuntime`/`PropsRenderSlots`/`PropsStore`/inject face）全部派生；组件不见 ctx/React context；hooks 仅框架常设席 + provide/inject 绑定；store 用导出的 `createXXXStore()` 工厂；跨包 import 他人符号禁止；样式 `--dsw-*` token + CSS Modules、产品文案中文。

**已验证可挂载 slot 清单**（我们的 Research UI 落点；[V] 各 contract/slots.ts）：

| slot | kind/scope | 用途 |
|---|---|---|
| `conversation.view` | list / session | **主落点**：per-session 整 tab（ui-trajectory 先例：`ctx.slots.inject('conversation.view', () => ...)` [V] ui-trajectory/src/client/index.ts:43） |
| `shell.overlay` | list / root | frame 级浮层（Cockpit 快捷面板候选） |
| `sidebar.workspaces` / `sidebar.settings` / `sidebar.footer.action` | — | 侧栏入口 |
| `conversation.session.header.actions` / `.utilities` | list / session | per-session 按钮位 |
| `tool.call.toolview` | keyed | 工具卡片渲染（`research_*` 工具 UI） |

无顶层多页面/路由 slot；`'root'`/`'sidebar'`/`'conversation'`/`'details'` 均 single 且被占用（注册即 shadow 内置实现，禁止）。**整页 Research 面板 = `conversation.view` tab + `shell.overlay` 组合**（与计划书 §27 GUI 信息架构的映射在 Phase 4 细化；若需独立一级页面须与宿主协商新 hole [?]）。

**包形态**（[V] client/AGENTS.md checklist）：`dsh.client` manifest（`platform:'web'`、须 `./client` export；`inject` 仅 informational）；tsdown `clientBundle(id, [...])` 产 `lib/client.js`；宿主 node 半扫描 `dsh.client` 行组装 `window.__DSH_BOOT__` 并在 `/plugins/<id>/client.js` 出 bundle（[V] client/modules/README）。**in-repo 包需三注册面**（tsconfig aggregate + web-app patch 行 + web-app dependency）；out-of-tree 包经 profile patch 加载 **[已静态消解]**（§13-U1）：client/modules 按 **Loader entry 的 `dsh.client` 声明**扫描（[V] `packages/client/modules/src/client/manifest.ts`），与 bundle 出身无关；保留 `dsh web` 运行时尾巴。

**开发流**：`pnpm run build`（host lib -> client lib -> web）后 `pnpm dsh web` + `pnpm run dev:web`（client watcher 重写 `lib/client.js`，node 半 stat-poll -> SSE `GET /plugins/events` 推 `rebuilt` -> 浏览器逐插件重载 fiber，[V] client/hmr/README）。live server 服务 bundle 非源码——探测前必须 `pnpm --filter <pkg> bundle`。**[?] U3**：web-app bundle 禁用了 base 的 `hmr` 行，dev:web 的 SSE 是否实际可达需运行时确认（本 GUI 会话上下文称 receiver active，与 patch 的 `disabled: true` 存在张力——以运行时观察为准）。

**映射**：`DshUiAdapter.registerResearchUI(ctx)` 集中封装三个 seat 的 `ctx.slots.inject` 与 slot 键名常量。

## 7. Session 集成（Run 发现与绑定的数据面）

**Host 面**（[V] core/session/src/index.ts + docs/subsystems/session.md）：`ctx.sessions`（SessionStore：`create(id?, opts?)`/`get(id)`/`fork(source, boundary?, childId?)`/`list`/`flush`…）；事件 `session/created`/`session/disposed`/`session/event`（post-commit fire-and-forget 广播，durable）；`SessionEventMap`（merge-extensible、required-on-read by default）含 `turn/start|end`、`step/*`、`user/message`、`assistant/*`、`tool/*`。Run 生命周期 -> RUN_STARTED/RUN_FINISHED 的映射从 `agent/*` live 事件 + turn 事件推导（TC-DSH-004）。

**Client 面**（[V] client/runtime/src/client/contract/sessions.ts）：`ctx.sessions.list: ObservableSnapshot<SessionListState>`——行结构 `SessionSummary {id, title, displayTitle, cwd, agentPreset, parentId, origin, running, blank, updatedAt, …}`；`open(id)`/`search(query, signal)`/`fork({sessionId, atSeq?})`/`refreshSubagents(parentSessionId)`。**`SessionSummary.cwd` + `origin`/`parentId` + `running` 是 DiscoveredSession/Run 发现的主数据源**。

**事件帧**（[V] host/apiproxy/src/api/events.ts；两条 downlink WebSocket `/api/events.mux` + `/api/events.host`）：

- Mux：`session/event`（原始 SessionEvent 透传）、`session/subscribed`（含 `lastSeq` 基线）、`approval/*`、`question/*`、`session/queue`、`session/jobs`、`session/projection`；
- Host：**`host/session-added`（含 `cwd`/`parentSessionId`/`origin`/`agentPreset`/`blank`——增量发现信号）**、`host/session-removed`、`host/session-status`（running 翻转）、`host/agent-error`、`host/workspace-*`。

**历史读取**：client 走 `session.history` RPC `{sessionId, beforeSeq?, maxMessages?}` -> `{events, hasMore, …}`（[V] apiproxy/api/sessions.ts:282；UI 对应 `ISession.loadOlder()`）。host 侧更强查询面 `ctx.sessionQuery`：`listSessions`/`filterSessions({kind:'cwd', values})`/`readSession`/`readSurface`/`searchSessions`——**[已静态消解]**（§13-U8）：web-app bundle 虽把 `session-query-sqlite` 配为 `path:':memory:', openAt:never`，但仅 `searchSessions`/`searchEvents` 抛 `SESSION_QUERY_SEARCH_DISABLED`；reads/filters/traces 继承可用，`filterSessions` 走 SessionCorpus（headers + live sessions 合并）与 SQLite 索引无关（[V] session-query-sqlite/src/index.ts openAt JSDoc）。DiscoveredSession 检索只用 `filterSessions`/`listSessions`，不依赖全文搜索。

**Subagent 面**：client `subagent.list`（按 parent 列直接子代理，不激活）/`subagent.history`/`subagent.prompt`（仅 continuable，需 `SubagentAddress {parentSessionId, childSessionId, mode:'continuable'}` 且 parent live）；host `ctx.subagents.start(name, req)`（host-only，无 client start RPC）——见 §10。

**映射**：`DshSessionAdapter.listSessions()`（host: `ctx.sessions`；client: `list` snapshot）、`.onSessionEvent()`、`.querySession(id, window)`（session.history/sessionQuery）、`.observeSessionLifecycle()`（host/session-* 帧）。

## 8. Workspace 集成（判定 session 归属）

**Host 实体**（[V] workspace/src/index.ts + docs/subsystems/workspace.md）：`ctx.workspaceRegistry`：`create(path, title?)`/`get(id)`/`list()`/`delete(id)`/`resolveByPath(path)`/`archiveSession(sessionId)`。`Workspace {id: WorkspaceId(branded uuid), path(canonical realpath, 创建后不改), title, sessionIds(手工顺序账本)}`。

**成员资格双重条件**（[V]）：session header 的 canonical `cwd` == workspace `path` **且** id 在 `sessionIds` 账本（一个 session 至多属一个 workspace）。

**Client 面**（[V] runtime/contract/workspaces.ts + apiproxy/api/workspace.ts）：`ctx.workspaces.list`（`WorkspaceView {workspaceId, path, title, sessionIds, …}`）+ `create({path})`/`archiveSession` 等；变更帧 `host/workspace-changed`/`-removed`/`-order-changed`/`host/archived-sessions-changed`。

**「session 是否在研究工作区内」判定**：`SessionSummary.cwd` 与 `WorkspaceView.path` 的 canonical 相等比较（两边都经 host realpath canon；symlink 需归一后比）；精确语义用 `sessionIds` 账本双确认。我们的 `.research/` workspace 注册表把 DSH `WorkspaceId`/canonical path 存为外部引用。

**映射**：`DshWorkspaceAdapter.listWorkspaces()`、`.resolveRoot(sessionId)`、`.onWorkspaceChanged()`。

## 9. 持久化（operational SQLite）

- DSH 统一用 `node:sqlite` `DatabaseSync`（[V] storage-sqlite README）：`openDatabase(path, journalMode)` 建 owner-only 文件（0o700/0o600）、`PRAGMA journal_mode=WAL`、`PRAGMA user_version` 单调 schema 版本、不匹配即拒绝（pre-release 不做迁移）——我们的 `research.sqlite` 完全照此模式；
- storage hub（`ctx.storage` -> `ctx.storageDomain` typed KV）**不采用**：KV 模型无二级索引/跨表事务/多段键（[V] storage-domain README Known Limitations），装不下 ResearchHistory 的关系查询；且 backend 行是静态 config，按 `<project-id>` 分库需每项目一行 config，不现实；
- 路径：`resolveDshHome()`（优先级 显式配置 > `$DSH_HOME` > `~/.dsh`，[V] util/home-paths/README + package.json `publishConfig.access: public` —— **是公开发布包，可直接依赖**）下 `research-control/<project-id>/research.sqlite`；
- 连接生命周期：`[Service.init]` open，`ctx.effect` disposer close（对齐 storage-sqlite register/close 模式）。

**映射**：`DshPersistenceAdapter.dataDir(projectId)` 返回纯路径（唯一允许 import `@deepseek-ai/dsh-home-paths` 的位置）。

## 10. Agent 工具与只读 Investigator

### 10.1 工具注册（[V] extension-cookbook + docs/cookbook/adding-a-tool.md + tool-bash 生产样例）

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'
ctx.tools.register(defineTool({
  name: 'research_fact_record',
  description: '...',
  parameters: { fact: { type: 'string', required: true, description: '...' } },
  output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
  async execute(args, exec) { return ctx.researchControl.recordFact(args, exec) },
}))
```

契约：`defineTool` 从 `parameters` 推 JSON Schema 并在 execute 前校验；execute 只返回 `output.schema` 声明的单一 canonical JSON 值（不返回 content blocks）；必须尊重 `exec.signal`；**UI render intent（generic/terminal/diff…）是工具设计的一部分，实现前定案**（root AGENTS.md）；schema 自动进 system-prompt 组装。注册即 effect（HMR 安全测试是 DSH 硬要求，我们的 TC-DSH-009/010 对齐）。每包须有 `./invariant` 子路径 + README Model Experience 三段（作为 out-of-tree 包遵循此约定以保持生态一致）。

**映射**：`DshToolAdapter.registerTool(def, handler)`；11 个 `research_*` 工具全部转发到 `ctx.researchControl`。

### 10.2 只读 Investigator

**Client 无 subagent-start RPC**（[V] apiproxy/api/subagents.ts：仅 list/history/prompt/interrupt）；host `ctx.subagents.start()` 需 live `parent: Agent`。两条路径：

**路径 A（client 组合，推荐先做）**（各组件已 [V]）：

1. `session.create` RPC 支持 `{workspaceId?, cwd?, sessionId?, agentPreset?}`（apiproxy/api/sessions.ts）；
2. 权限收敛：`/permission read-only` slash command（经 `session.prompt`/`ISession.command` 提交）-> host `permission-presets` 服务写 `sandbox/mode: read-only` + `approval/policy: ask` 两个 knob（[V] permission-presets/src/index.ts:56-99、base patch L197-198）；`SandboxMode='read-only'` 由后端拒绝所有写；
3. 更硬收敛：专用 agent preset（`agent.cordis.yml` 只挂只读工具；样例 `apps/cli/config/agent-presets/standard/`）+ `session.create({agentPreset:'research-investigator', cwd})`；
4. **[?] U5**：preset（agent-plane）能否钉死 sandbox mode——sandbox/approval 栈在 host composition，preset 大概率不能，需依赖 `/permission` 命令时序（blank session 首 prompt 前是否生效未验证；验证 permission-presets 命令 handler）；
5. 结果回读：`session.history` 或（若做成 continuable 子代理）`subagent.history`/`subagent.prompt`。

**路径 B（host 插件面）**：host 侧调 `ctx.subagents.start('spawn', {label, prompt, parent, signal, toolFilter, persona, outputSchema, maxDepth})`（`toolFilter: ToolRestriction` 显式禁写工具，in-process 后端同时从 prompt 与执行面移除，[V] docs/subsystems/subagent.md），经 `@Remote` 暴露给 client（注意：官方 `api-remotes` 组装包目前只挂 7 个 namespace——commands/goals/dynamic/fileReferences/pluginInventory/messageFeedback/sessionReferences——新增须改该组装包并重跑 `build:lib`，故优先走 U2 的自行 `$mount` 路线）。权限钉死的 host 侧等价物：`ctx.permissionPresets.set(session, 'read-only')`（permission-presets 服务面）。`ctx.sandbox.confine(argv, policy)` 是进程级原语（包 argv），不适用于"无写路径 agent"语义。

**只读约束三层保障**（INV-PERM-3）：preset 只注册只读工具 + `/permission read-only`（sandbox 后端拒绝写）+ TC-DSH-010 注册面断言。输出 transient，用户显式保存才写 `AnalysisRecord`。

**映射**：`DshAgentLauncherAdapter.launchInvestigator(workspaceId, task)` = ensure preset -> `session.create({agentPreset, cwd})` -> `command('/permission read-only')` -> `prompt(task)`。

## 11. 实时更新通道（不自建 streaming）

复用清单（[V]）：

1. `useSessions`/`useWorkspaces` 全局 hook——列表/当前选择/running/jobs/子代理目录已投影，Cockpit 数据层做纯派生（`useMemo`），**不建第二订阅**；
2. `host/session-added`/`host/session-status` 帧 -> DiscoveredSession 增量发现；
3. **`session/projection` 帧**：host 端 `SessionProjectionMap` 可声明合并自定义 key（higher-seq-wins 投影）——Run 进度可做成自定义 projection unit [?]（注册 API 细节：docs/subsystems/session-projection.md，Phase 2 细读）；
4. `connection/reset`（client cordis 事件）= 重连后低频全量 reconcile 的钩子（runtime 自身也用它重拉基线）；
5. 瞬时查询用一次性 RPC 不落 store（范式：`SessionRuntime.search` 是 stateless one-shot）；backoff 参数在 ConnectionConfig（base 500ms/factor 2/max 10s）。

例外提醒：`API_REMOTE_FORWARDED_EVENTS` 白名单不含我们的自定义事件（§5）——Run live 状态走 `session/event` 透传（Mux 帧，原生 SessionEvent 才透传）或 projection 帧，不走 Remote。

## 12. 版本兼容策略

- **DSH 无 plugin API 版本检查机制**（[V] grep apps/cli + app-boot 无 semver 判定；pre-release 立场无兼容承诺）；
- 做法：① 插件对消费的 `@deepseek-ai/*` 包 `peerDependencies` **精确 pin**（`0.1.0-rc.8`，非 `^`）；② 插件 `Config` 自持 `minDshVersion` 字段，`[Service.init]` 与宿主可观测版本比对 fail-loud [?]（宿主版本获取途径：plugin-inventory 快照内容，Phase 0 验证）；③ compatibility smoke（TC-DSH-008）：`--dump-config` 断言行在树 + keyless boot 真实 profile clean exit + 13 RPC roundtrip；
- 高风险面（变更概率排序）：Typert 生成管线 > slot 系统规则 > permission/sandbox preset > storage hub > session 事件集；Cordis 基础最稳。

## 13. 不确定点清单（Phase 0 必须消解，按影响排序）

| # | 不确定点 | 验证路径 | Fallback |
|---|---|---|---|
| U1 | **[已静态消解]** out-of-tree client 插件的 `/client` bundle 发现加载：client/modules 按 Loader entry 的 `dsh.client` 声明扫描组装 `__DSH_BOOT__`（`packages/client/modules/src/client/manifest.ts`），与 bundle 出身无关 | 运行时尾巴：最小两入口包 + `dsh plugin add` + `dsh web` 实测页面出现 | 与宿主协商合入 web-app bundle（fork 安装态） |
| U2 | **[已静态消解]** client 半边自行 `$mount` 第三方 contribution：`$mount` 无来源白名单，仅要求 strict codec（`gateway/src/client/index.ts:100-108`；gateway 测试挂载虚构 `@fixture/*` 包） | 运行时尾巴：spike 调一个 `@Remote` roundtrip | 走 `/api` proxy 自定义端点（host 侧普通 HTTP handler）过渡 |
| U3 | web-app bundle 禁用 `hmr` 行后，dev:web SSE（`/plugins/events`）是否实际可达 | 运行时观察 + 读 `packages/client/hmr/src/` | 开发期改用本地 web-app bundle fork（hmr 行 re-enable） |
| U4 | **[已静态消解]** 第三方包独立运行 typert generator：构造器接受任意 root（`workspace.ts:23-25`）；三包均 public。tsconfig 覆写细节未单独核验 | 运行时尾巴：最小包实测产物生成与加载 | 手写 `InvocationDescriptor` manifest（protocol/types.ts 格式） |
| U5 | Investigator 只读钉死方式（preset 不能含 host-plane sandbox 行；blank session `/permission` 时序） | 读 permission-presets 命令 handler + sandbox-policy per-session override 折叠 | host 侧 `ctx.permissionPresets.set(session,'read-only')` + 路径 B（`ctx.subagents.start` + toolFilter） |
| U6 | projection unit 注册 API（Run 进度通道） | 读 docs/subsystems/session-projection.md | 降级为 mutation 后 invalidate/refetch + 低频 polling |
| U7 | web 默认部署 session-query 全文搜索关闭的影响面 | 运行时调 `session.search` | DiscoveredSession 检索只走 `list` snapshot 过滤 |
| U8 | **[已静态消解]** `openAt:never` 下 `filterSessions` 可用性：JSDoc 明言 reads/filters/traces 保持可用，仅 searchSessions/searchEvents 抛错；filterSessions 走 SessionCorpus 与 SQLite 无关 | 运行时尾巴：真实 web profile 下调用一次 | host 侧直接扫 `ctx.sessions` store |
| U9 | session 的「显式 ResearchContext/workstream 绑定」载体机制（计划书 §12.3 规则 1 的自动注册 Run 依赖它；DSH session 无原生 research-context 字段） | 候选：`session.create` 的 meta/agentPreset 约定、用户对 DiscoveredSession 的 BIND 操作、Inbox 分诊；Phase 2 前读 `packages/core/session` header 结构定案 | 默认仅 DiscoveredSession + 手动 BIND（放弃自动注册） |

## 14. Phase 0 Spike 任务对照（Gate P0 验收映射）

| Gate P0 要求（计划书 §31） | 对应章节 | 消解的不确定点 |
|---|---|---|
| 插件可热加载/卸载 | §3（disabled diff）+ §4（effect 回滚） | U3 |
| 不修改 DSH core | §1 隔离原则 | — |
| Host/Client roundtrip 成功 | §5 RPC（`@Remote` + `$mount`） | U2、U4（均已静态消解，保留运行时尾巴） |
| 能列出当前 DSH Sessions | §7（`ctx.sessions`/`list` snapshot） | — |

（U1/U2/U4/U8 已静态消解、保留运行时尾巴；U3/U5/U6/U7 为纯运行时验证项；**U9 为 Phase 2 前置**——「显式 ResearchContext → 自动注册 Run」的载体机制。）

---

## 附录：素材与验证记录

- `docs/engineering/_dsh_adapter_host.md`（host 侧深调研，274 行）；
- `docs/engineering/_dsh_adapter_client.md`（client 侧深调研，192 行）；
- 独立复核命中（本文作者 grep/read）：`apps/cli/src/plugin.ts:59`（reconcilePlugins）、`packages/api/remotes/src/remote-events.ts:17`（转发白名单）、`packages/feedback/message-feedback/src/index.ts:150-205`（TypertRemoteService 样例）、`packages/util/home-paths/package.json`（public 发布）、`packages/client/ui-trajectory/src/client/index.ts:43`（conversation.view inject 先例）、`packages/bundle/base/cordis.patch.yml:197`（read-only preset）、`packages/bundle/web-app/cordis.patch.yml:21-23`（hmr disabled）、`packages/workspace/workspace/src/index.ts:277`（resolveByPath）、`packages/host/apiproxy/src/api/sessions.ts:282`（history RPC）、`packages/boot/app-boot/src/profile.ts:41-96`（dsh 字段/双锚解析）、`packages/api/gateway/src/client/index.ts:100-108`（$mount 无来源白名单）、`packages/api/gateway/tests/gateway.client.spec.ts:94-113`（@fixture 挂载先例）、`packages/typert/generator/src/workspace.ts:23-25`（generator root 参数）、`packages/session-query/session-query-sqlite/src/index.ts`（openAt never JSDoc）、`packages/client/modules/src/client/manifest.ts`（dsh.client 声明扫描）。
