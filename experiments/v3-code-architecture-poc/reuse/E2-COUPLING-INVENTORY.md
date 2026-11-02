# E2 — DSH 耦合清单 + 宿主能力映射 + 拓扑

- 实测日期：2026-11-01。执行：G1 子代理（E2 席位，分支 `g1/contracts-20261031`）。
- **文件纪律**：本探针只新建本文件；零修改既有文件、零 git 写操作；不触碰 `references/**`、`tests/deepseek-harness/**`、`tests/dsh-homes/**`、`src/**`、`schema/**`、8 份根文档。
- 用途：服务于「科研体系脱离 DSH 也能适用（经 Adapter 接入 DSH / Codex CLI / Claude Code）」目标的复用判定。
- 上游文档：`E0-HOST-CAPABILITIES.md`（宿主能力面实测，下称 **E0**）、`E0-OVERLAP-MAP.md`（下称 **E0-OM**）——DSH 列只引 E0 锚点，不重测。

## 0. 范围与方法

**扫描范围**：`src/**` + `tests/**`。排除：`node_modules`、`tests/deepseek-harness/`、`tests/dsh-homes/`、`references/`。`*.test.*` 保留但单独计数（§1.6）。

**分层定义**：

| 层 | 定义 | 判定标准 |
|---|---|---|
| **H（硬）** | 无 DSH 则插件整体不可装载/不可构建 | 耦合在打包、入口形态、构建形态、依赖声明层，DI 参数化不可达 |
| **S（软）** | 业务代码含 DSH 专有常量/语法，但机制通用 | 改常量名/换输出语法即可移植，不改机制 |
| **I（隔离）** | DSH 耦合完全收在 `*/dsh-adapter/` 缝内或 `src/shared/` 端口定义之后 | 核心（INV-PERM-5 区）对 DSH 零 import；替换宿主 = 只换 adapter 实现 |

**Grep 纪律**（本仓两条已知坑的前科修正）：

1. 词边界/锚定计数与子串计数**分开报**：例 `grep -c "@Remote" src/host/dsh-adapter/host/index.ts`（子串，71 行，含 import 与注释）vs `grep -c "^  @Remote(" 同文件`（装饰器行锚定，**59**）。`@deepseek-ai` 子串（36 文件）vs `from '@deepseek-ai` import 语句（**12** 文件）。
2. `| wc -l` 的 rc 恒 0——凡单独 grep 处标注**真实 rc**；管道计数只报数值。
3. 全部命令在仓根 `/home/user/dsh-plugins/dsh-research-control` 执行，路径相对仓根。

## 1. 任务一 — DSH 耦合清单

### 1.1 三个精确数字

**① 核心区（`src/host/{audit,domain,git,history,persistence,service,tools,workspace}` + `src/shared` + `src/client` 全部非 dsh-adapter 文件）import `@deepseek-ai/*` 的文件数 = 0，列表 = ∅。**

实测（§1.7 命令 A）：`grep -rn "from '@deepseek-ai" <核心区全量> | grep -v dsh-adapter` → **rc=1，零命中**。
`src/host/{audit,domain,git,workspace}` 四目录连子串提及都没有（rc=1）。
全仓 src 有 DSH import 的文件共 **12** 个，**全部**位于 `src/host/dsh-adapter/`（8）与 `src/client/dsh-adapter/`（4）——与 §1.7 命令 B 列表一致。
核心区非 import 的 DSH 关联提及（代码级 5 文件 + 纯注释 17 文件）逐件归类见 §1.3/§1.4/§1.5——它们是 S/I 项或负证据，**不构成** ① 的计数。

**② `research.sqlite` 路径解析落点 = `src/host/service/storage-locations/resolve-db-path.ts:59`（`resolveDbPath`）。**

- MANAGED 布局拼接：`resolve-db-path.ts:89` → `join(hubPath, hubDir, MANAGED_PROJECTS_DIR, projectId, DB_FILE_NAME)` = `<hub>/<hubDir>/projects/<projectId>/research.sqlite`。
- STANDALONE 布局拼接：`resolve-db-path.ts:91` → `join(wsPath, treeDir, STANDALONE_STATE_DIR, DB_FILE_NAME)` = `<ws>/<treeDir>/state/research.sqlite`。
- `resolveDbDir`（:104-106，= `dirname(resolveDbPath)`）。
- 常量：`storage-locations/types.ts:33` `DB_FILE_NAME='research.sqlite'`、:36 `STANDALONE_STATE_DIR='state'`、:39 `MANAGED_PROJECTS_DIR='projects'`、:48 `OLD_DB_HOME_SEGMENT='research-control'`（V1 退役段名）。
- **实际开库**在 `src/host/service/wiring/create.ts:398`：`new DatabaseSync(join(dataDir, DB_FILE))`（`node:sqlite`，import :45；`DB_FILE='research.sqlite'` :189；`dbPath` :439；`openDatabase` :453；runbinding 表 :521）。
- adapter 侧调用者：`src/host/dsh-adapter/host/index.ts:1901`（`const dataDir = resolveDbDir({...})`，import :365）；`src/host/dsh-adapter/host/plane-mutation-services.ts:761`（`resolveDbPath`）+ :792-793（`mkdirSync(resolveDbDir(managedPlacement), {recursive:true, mode:0o700})` + `migrateDb(source, resolveDbPath(managedPlacement), ...)`，imports :174-175）。
- **`$DSH_HOME` 的残留参与仅限 V1 提示探针**：`dsh-adapter/host/index.ts:155`（`resolveDshHome` import）+ :1817-1826（`hintOldDbHome(resolveDshHome(), nodeFsStorageIo())`；:1817 注释自述「resolveDshHome is the ONE remaining dsh-home-paths read in this file」）+ `service/storage-locations/old-home.ts:65-67`（探针本体：`join(dshHome, OLD_DB_HOME_SEGMENT)`，入参化，纯函数）。V2 落点**不**在 `$DSH_HOME` 之下——实证 `tests/discovery/host-startup.test.ts:283-289`（managed db 在 hub 下为 true、`$DSH_HOME/research-control/PRJ-1/` 下为 false）与 :310-314（standalone 在 `<ws>/.research/state/` 下为 true、V1 位为 false）。

**③ H/S/I 计数 = 5 / 3 / 42**（生产面，共 50 项，逐项见 §1.2-§1.4；测试面 31 个文件单列于 §1.6，不计入）。

### 1.2 H 项（5）— 无 DSH 不可装载/构建

| # | 锚点 | 内容 | 为何是硬耦合 |
|---|---|---|---|
| H1 | `cordis.patch.yml:1` | `- insert: [{ id: research-control, name: 'dsh-research-control' }]` | 插件的存在形态 = cordis bundle patch；无 cordis 装载器则无宿主可挂载 |
| H2 | `package.json:33,43-45` | `files` 含 `cordis.patch.yml`（:33）；`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`（:43-45） | 打包声明即 DSH bundle；发布物按 DSH 消费 |
| H3 | `package.json:77-83,84-94,109-114` | 三个 pin 块共 19 个 `@deepseek-ai/*` 依赖：peerDependencies（:77-83，5 个：`cordis@4.0.4` + `dsh-home-paths`/`dsh-llm`/`dsh-tools`/`dsh-typert-protocol` @`0.2.0-rc.2`）、devDependencies（:84-94，10 个：cordis 系 4 + dsh-* 6）、dependencies（:109-114，4 个：`dsh-home-paths`/`dsh-llm`/`dsh-tools`/`schemastery`） | 运行时硬依赖 DSH 宿主进程内提供的包；版本锁步 `0.2.0-rc.2`（minDshVersion 默认同值，`dsh-adapter/host/index.ts:510-529`） |
| H4 | `tsdown.config.ts:170-179,205` | client bundle `CLIENT_EXTERNALS` = shell 模块表（:171-174 `react` 系；:175-178 `@deepseek-ai/cordis`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-runtime/client`）+ `window.__ModuleLoader__.load({ id, factory: (require) => {` banner（:205） | 构建形态绑定 DSH web shell 的模块装载器；产物只能在 DSH shell 内 require 解析 |
| H5 | `src/client/index.tsx:41,54-56` | `export const inject = ['slots', 'remote']`（:41）+ `export async function apply(ctx)`（:54，`mountResearchRemotes(ctx)` :55 + `registerResearchUI(ctx)` :56）；无 default export | cordis client 插件入口契约（`inject` 数组 + `apply(ctx)`），由 DSH shell 发现并调用；形态本身即 DSH |

### 1.3 S 项（3）— 核心区内、参数化可达

| # | 锚点 | 内容 | 参数化路径 |
|---|---|---|---|
| S1 | `src/host/service/sessionlink/version-guard.ts:157`（消息 :222；重导出 `sessionlink/index.ts:53`；`createRequire` :175） | `export const DSH_VERSION_PACKAGE = '@deepseek-ai/dsh-typert-protocol'`——版本守卫读**已装载** DSH 包的 package.json 做 semver 校验 | 机制通用（任意 npm 包名 + createRequire）；包名常量是 DSH 参数。脱离 DSH 时守卫可退化为 no-op 或换包名 |
| S2 | `src/host/service/investigator/types.ts:105-106`（刻意排除注 :97） | `INVESTIGATOR_PRESET_TOOL_NAMES = ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-fs-search']`——investigator 只读工具白名单（`dsh-tool-fs` 刻意排除，write/edit 不入 catalog） | 闭集**名称**常量；换宿主的等价物 = 换成该宿主的只读工具名（CC/Codex 下 = MCP 工具名或内置只读工具名） |
| S3 | `src/host/service/investigator/preset.ts:58,100`（JSDoc :135-136） | `FS_SEARCH_TOOL_NAME` 常量 + `renderInvestigatorPresetComposition` 渲染 DSH `agent.cordis.yml` 预设 YAML 闭集（:100 `name.replace(/^@deepseek-ai\/dsh-/, '')` 生成 id 行） | 输出语法 = DSH 预设文件方言；机制（组合 → 文本）通用，换语法层即可 |

### 1.4 I 项（42）— 缝内/端口后

**host-adapter（`src/host/dsh-adapter/**`，34 项）**

| # | 锚点 | 内容 |
|---|---|---|
| I1 | `host/index.ts:147` | `import { Service, type Context } from '@deepseek-ai/cordis'` |
| I2 | `host/index.ts:148` | `import s from '@deepseek-ai/schemastery'`（`static Config` schema DSL） |
| I3 | `host/index.ts:149` | `import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'`（跨进程 RPC 先例，§3） |
| I4 | `host/index.ts:150-154` | dsh-tools：`parameterSchemaSpecToJsonSchema` / `ToolDefinition` / `ToolRunContext` |
| I5 | `host/index.ts:155` | `import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'`（仅 V1 探针用，见 I17） |
| I6 | `host/index.ts:156` | `import { HarnessError, type ContentBlock } from '@deepseek-ai/dsh-llm'` |
| I7 | `host/index.ts:483` | `export class ResearchControlService extends TypertRemoteService` |
| I8 | `host/index.ts:499` | `static inject = ['sessions', 'tools', 'subagents', 'workspaceRegistry']`（硬 DI；`subagents` 声明后 src 内无读取点） |
| I9 | `host/index.ts:510-529` | `static Config = s.object({...})`（`minDshVersion` 默认 `'0.2.0-rc.2'`；volatile `projectTreeDir` `'.research'` / `hubDir` `'.research-control'`） |
| I10 | `host/index.ts:700,709` | 构造器 `super(ctx, 'researchControl')` + `ctx.effect(() => () => {...})` 占位 |
| I11 | `host/index.ts:750,764` | `protected async [Service.init]()` + `assertMinDshVersion(minDshVersion, createPackageVersionSource(DSH_VERSION_PACKAGE, import.meta.url))` |
| I12 | `host/index.ts:767-774` | `HostSessionAdapter` 实例化（端口 `DshSessionAdapter` 的 DSH 实现注入点） |
| I13 | `host/index.ts:790` | `registerResearchSettings(this.ctx)`（settings 面注册） |
| I14 | `host/index.ts:796-804` | 启动清扫 `ctx.workspaceRegistry.list()` |
| I15 | `host/index.ts:913,967-968` | `ctx.effect` 拆除面（storage disposer :913；命令 disposer `disposeCommand`/`disposeAnalysisCommands` :967-968） |
| I16 | `host/index.ts:1003-~1700` | **59 个 `@Remote` RPC 方法**（实测 `grep -c "^  @Remote("` = 59；子串总计 71 行含 import :149 与 11 行注释）。端点如 `ping`、`getDashboard`、`setHub`、`bindProject`、`rescan`、`createTopic` 等 |
| I17 | `host/index.ts:1817-1826` | V1 遗留 `$DSH_HOME` 数据库布局**提示**探针（`hintOldDbHome(resolveDshHome(), ...)`；fail-loud 日志 :1826）——全文件唯一 dsh-home-paths 读取（:1817 注释自述） |
| I18 | `host/index.ts:1901` | `const dataDir = resolveDbDir({...})`——② 落点的 adapter 侧消费（import :365） |
| I19 | `host/index.ts:1965-1985` | `DSH_RESEARCH_SCHEMA_ROOT` env 覆盖 + schema 根向上走查 |
| I20 | `host/index.ts:2002,2037`（调用点 :934） | `#registerResearchTools`：遍历 `wiring.tools`，逐一定义 `ToolDefinition` 后 `tools.register(toolDefinition)`——**11 个科研工具**（`src/host/tools/index.ts:243-255` `createResearchTools` 返回 11 项：fact-record / claim-record / artifact-register / intervention-create / next-action-create / plan-fork-create / run-checkpoint / context-get / plan-get / history-query / contract-read；wiring 侧 `wiring/create.ts:1258`） |
| I21 | `host/index.ts:2221` | `export default ResearchControlService` |
| I22 | `session.ts:53,99,144,159` | cordis `Context` 类型 import（:53）+ `SessionStoreLike`（:99）/ `SessionHostContext = Context & { sessions: SessionStoreLike }`（:144）/ `class HostSessionAdapter implements DshSessionAdapter`（:159） |
| I23 | `session.ts:206-210` | `ctx.get('agents')`（:206）/ `ctx.get('sessionProjections')`（:207）/ `ctx.sessions.list()`（:210） |
| I24 | `session.ts:235,249,256` | `ctx.events.on('session/event')`（:235）/ `'session/created'`（:249）/ `'session/disposed'`（:256）——宿主事件 → 科研 intake 的 DSH 通道（E0 §2：`session/event` = post-commit emit mode） |
| I25 | `session.ts:275-277` | `querySession` **TODO 桩**（抛 not-implemented，WP-2.x，预留 `session.history` / `ctx.sessionQuery`）——即插件**当前未用** DSH FTS5 会话检索（E0 §3 第五面） |
| I26 | `launcher/adapter.ts:94` | `import { createUserMessage } from '@deepseek-ai/dsh-llm'` |
| I27 | `launcher/adapter.ts:143-144` | `permissionCommandLine()` = `'/permission read-only'`（investigator 权限门） |
| I28 | `launcher/adapter.ts:164,179,188` | `ctx.get('agentPresets')`（:164，缺失即拒启 :172）/ `ctx.get('agents')`（:179，缺失即不可用 :183）/ `agents.create({meta: {cwd, agentPreset}, setup})`（:188） |
| I29 | `launcher/adapter.ts:207` | `agent.followup(createUserMessage({content: [{type: 'text', text: task}], ...}))`——investigator 任务提示注入点 |
| I30 | `launcher/adapter.ts:237,259,268` | `roster.mount(agentCtx, presetId)`（:237）/ `ctx.get('commands')`（:259）/ `commands.execute(agent, this.permissionCommandLine(), [], signal)`（:268） |
| I31 | `host/settings.ts:84,138,407,449` | `Context` import（:84）/ `RESEARCH_SETTINGS_SCHEMA`（:138）/ `registerResearchSettings`（:407，走可选面 `ctx.get('settings')`）/ `getResearchDirNames`（:449，目录名唯一定源） |
| I32 | `host/analysis-commands.ts:285-296` + `host/investigate-command.ts:185` | `ctx.get('commands')` registrar：`registrar.register(...)` ×4（transient / list / save :285/:291/:296；investigate :185） |
| I33 | `host/typert.artifact.ts`（全文件 1057 行） | 手写 TYPERT 宿主 manifest（U4 回退形态；按 checkout 的 `packages/typert/loader` 规则校验，23 成员 V2 面） |
| I34 | `host/plane-mutation-services.ts:174-175,761,792-793` | `resolveDbPath`/`resolveDbDir` imports（:174-175）+ standalone→managed 收编：`source = resolveDbPath({...})`（:761）、`mkdirSync(resolveDbDir(managedPlacement), {recursive:true, mode:0o700})` + `migrateDb(source, resolveDbPath(managedPlacement), ...)`（:792-793，move+verify+delete-source 口径） |

**client-adapter（`src/client/dsh-adapter/**`，4 项）**

| # | 锚点 | 内容 |
|---|---|---|
| I35 | `ui.ts:70,186-187` | `CONVERSATION_VIEW_SLOT = 'conversation.view'`（:70）+ `ctx.slots.inject(CONVERSATION_VIEW_SLOT, ...)` / `ctx.slots.register(...)`（:186-187，tab `research`）——DSH slots 面（client only，E0 §3） |
| I36 | `settings-card.tsx:134,145,563` | `ROW_CONFIG_SLOT = 'plugins.row.config'`（:134）/ `ROW_CONFIG_KEY`（:145）/ `registerResearchSettingsCard`（:563，`ctx.effect` + slots） |
| I37 | `remote/mount.ts:26,32,162,204-205,212` | cordis `Context` import（:26）+ dsh-typert-protocol imports（:27-32：`RemoteResult`/`TypertClientRemote`/`TypertDisposer`/`TypertRemoteNamespaceMap`）+ `RemoteContext = Context & { remote: TypertClientRemote }`（:162）+ `mountResearchRemotes`（:204）：`ctx.remote.$mount(researchRemotes)`（:205）+ `reflect.get('remote.researchControl', false)`（:212） |
| I38 | `remote/contribution.ts:38-41,163` | dsh-typert-protocol **多行** import（:38-41，`RemoteResult` / `TypertRemoteContribution`）+ `declare module '@deepseek-ai/dsh-typert-protocol'`（:163，`TypertRemoteMap` 扩 `'researchControl/*'` 端点） |

**核心区（缝内/端口后的 I 级耦合，4 项）**

| # | 锚点 | 内容 |
|---|---|---|
| I39 | `src/host/persistence/hardening/consistency.ts:157` | 修复指引字符串含 V1 路径 `"$DSH_HOME/research-control/<project-id>/"`——文案级（doc-level），逻辑纯 |
| I40 | `src/host/service/storage-locations/old-home.ts:65-67` | V1 探针：`join(dshHome, OLD_DB_HOME_SEGMENT)`（:65）+ 日志 `"...legacy database layout found under $DSH_HOME..."`（:67）——探针纯函数、`dshHome` 入参化；DSH 读取在 adapter 侧（I17） |
| I41 | `src/shared/host-adapter-ports.ts` | 插件自有端口定义：`DshSessionAdapter`（含 `querySession` 端口 :166，I25 是其 DSH 侧桩）、`DshAgentLauncherAdapter`、`SessionQueryWindow`（:125）——核心只依赖这些 TS 类型，零 DSH import |
| I42 | `src/host/service/wiring/create.ts`（:189,370,398,439,453,521,587-611） | 宿主无关的 plane 装配：`DB_FILE='research.sqlite'`（:189）→ `requireAbs(options.dataDir)`（:370）→ `new DatabaseSync(join(dataDir, DB_FILE))`（:398，`node:sqlite`）→ `dbPath`（:439）/`openDatabase`（:453）/runbinding 表（:521）；事件 intake 经端口：`new RunBindingService`（:587）/`new SessionLinkService`（:599）/`startDiscovery(options.adapter)`（:611）；`SessionLinkService`（`service/sessionlink/service.ts:107`）`start()` 订阅 `adapter.onSessionEvent` + `adapter.observeSessionLifecycle`（:282-287 → RUN_STARTED/RUN_FINISHED 消费）；`RunBindingService.startDiscovery`（`service/runbinding/service.ts:180-187`，`reconcileSessions` + `created` 边） |

### 1.5 非耦合锚点（负证据）

- `src/host/service/storage-locations/resolve-db-path.ts` **零 DSH import**（纯解析器，INV-PERM-5 干净）——它是 ② 的答案本身，不是耦合点。
- `grep -rn "systemPrompt" src/` → **rc=1，零命中**：插件完全未用 DSH `systemPrompt.section` 面（E0 §3 第二面）；动态提示注入只在 launcher（I29）。
- 纯注释提及（INV-PERM-5 自述，非耦合）：核心区 5 文件——`service/sessionlink/types.ts:20`、`tools/types.ts:6,9`、`tools/index.ts:11`、`shared/rpc-contracts.ts:12,17`、`shared/research-settings.ts:23`；client 非 adapter 12 文件——`components/error-state-block.tsx:26`、`views/settings/research-settings-card.tsx:6`、`views/settings/index.ts:6`、`views/shell/shell.tsx:86`、`onboarding-card.tsx:6`、`hub-overview.tsx:16`、`missing-modal.tsx:47`、`intervention-stream.tsx:21`、`shell/index.ts:6`、`investigator-page.tsx:39`、`project-journeys.tsx:17`、`stores/model.ts:207`。
- 门机验：`node scripts/check-imports.mjs` → `check-imports: OK — no INV-PERM-5 violations in src`，**rc=0**（TS 编译器级 lint；豁免前缀仅 `src/host/dsh-adapter`、`src/client/dsh-adapter`）。

### 1.6 测试面（单列，不计入 ③）

`tests/**`（排除 `tests/deepseek-harness/`、`tests/dsh-homes/`、`node_modules`）中 `from '@deepseek-ai` import 的文件 = **31**（实测命令 C，`| wc -l` = 31；管道 rc 恒 0，单独 grep rc=0）：

```
tests/discovery/host-attention-write.test.ts        tests/rpc-face/arity.test.ts
tests/discovery/host-commands-reinit.test.ts        tests/rpc-face/manifest.test.ts
tests/discovery/host-init-unwind.test.ts            tests/rpc-face/plane-contracts.test.ts
tests/discovery/host-read-tools-g2.test.ts          tests/rpc-face/real-loader.test.ts
tests/discovery/host-startup.test.ts                tests/rpc-face/rpc-face.test.ts
tests/discovery/host-tools-reinit.test.ts           tests/rpc-plane/helpers.ts
tests/discovery/host-tools-semantic-write.test.ts   tests/rpc-plane/mutations-rpc-face.test.ts
tests/fixtures/attack/src/a-multiline.ts            tests/rpc-spike.test.ts
tests/g5-real-registry/continuity-authenticity.test.ts   tests/settings/settings.test.ts
tests/g5-real-registry/investigator-preset-registry.test.ts  tests/stores/facade-forwarding.test.ts
tests/g5-real-registry/investigator-restricted.test.ts      tests/stores/facade-plane-forwarding.test.ts
tests/helpers/host-output-codec.ts                  tests/stores/research-store.test.ts
tests/helpers/real-registry-host.ts                 tests/stores/stub-rpc.ts
tests/host-mount.test.ts                            tests/views-history/fixtures.ts
tests/investigator/fixtures.ts
tests/lifecycle/client-entry-ring.test.ts
tests/lifecycle/helpers/ring-harness.ts
```

构成：**真 DSH 装载器依赖 3**（`g5-real-registry/investigator-preset-registry.test.ts`、`rpc-face/real-loader.test.ts`、`helpers/real-registry-host.ts`）+ **有意攻击夹具 1**（`fixtures/attack/src/a-multiline.ts`，check-imports 的输入样本）+ 其余 27 = 假 ctx / 类型级 / codec。
per-test `DSH_HOME` 环境变量设置（AGENTS §3 纪律的测试侧落点）：`lifecycle/helpers/ring-harness.ts:169`、`rpc-plane/helpers.ts:60`、`helpers/real-registry-host.ts:87`、`discovery/host-startup.test.ts:98-100`。

### 1.7 Grep 证据（命令 + 真实 rc）

```sh
# A — ① 核心区 import 扫描（含 audit/domain/git/workspace/history/persistence/service/tools + shared + client 非 adapter）
grep -rn "from '@deepseek-ai" src/host/audit src/host/domain src/host/git src/host/workspace \
  src/host/history src/host/persistence src/host/service src/host/tools src/shared src/client \
  2>/dev/null | grep -v "src/client/dsh-adapter" | grep -v "src/host/dsh-adapter"
# → 零命中；单独 grep rc=1（过滤管道末段 rc=1）

# A2 — audit/domain/git/workspace 连子串提及都没有
grep -rn "@deepseek-ai" src/host/audit src/host/domain src/host/git src/host/workspace
# → 零命中；rc=1

# B — 全仓 src import 语句文件（词边界：from + 引号）
grep -rln "from '@deepseek-ai/" src/
# → 12 文件（全部 dsh-adapter/）；rc=0

# B2 — 全仓 src 子串提及文件
grep -rln "@deepseek-ai" src/
# → 36 文件 = B 的 12 + 代码级 5（investigator/types、investigator/preset、sessionlink/version-guard、storage-locations/old-home、persistence/hardening/consistency*）
#      + 纯注释 19（核心区 5 + client 12 + host-adapter 注释 2：discovery.ts、launcher/index.ts + launcher/types.ts 共 3 处提及中 2 处纯注释）
#   （*consistency.ts 的提及是 $DSH_HOME 字符串，不含 @deepseek-ai——它是子串扫描外、由 $DSH_HOME 扫描捕获的 I39）

# C — 测试面 import 文件计数
grep -rln --exclude-dir=deepseek-harness --exclude-dir=dsh-homes --exclude-dir=node_modules \
  "from '@deepseek-ai" tests/ --include="*.ts" | wc -l
# → 31（wc -l 管道 rc 恒 0；单独 grep rc=0）

# D — @Remote 计数（子串 vs 锚定，双口径）
grep -c "@Remote" src/host/dsh-adapter/host/index.ts        # → 71（子串：59 装饰器 + import :149 + 11 注释行）
grep -c "^  @Remote(" src/host/dsh-adapter/host/index.ts    # → 59（方法装饰器行锚定）

# E — 插件未用 systemPrompt 面
grep -rn "systemPrompt" src/                                # → 零命中；rc=1

# F — INV-PERM-5 机验门
node scripts/check-imports.mjs                              # → "check-imports: OK — no INV-PERM-5 violations in src"；rc=0

# G — 科研工具数
sed -n '243,256p' src/host/tools/index.ts                   # createResearchTools 返回 11 个 make*Definition（逐项列名，§1.4 I20）

# H — 落点断言（测试实证）
sed -n '283,289p' tests/discovery/host-startup.test.ts      # managed: <hub>/.research-control/projects/PRJ-1/research.sqlite = true；$DSH_HOME 下 = false
sed -n '310,314p' tests/discovery/host-startup.test.ts      # standalone: <ws>/.research/state/research.sqlite = true；V1 位 = false
```

> 前科修正注：背景简报曾记「11 个 dsh-adapter 文件有 DSH import」；**实测为 12**（`client/dsh-adapter/remote/contribution.ts` 的 import 跨 :38-41 多行，单行正则漏捕；`-l` 文件级计数 + 多行复核后定 12）。

## 2. 任务二 — 宿主能力映射（8 行 × 3 列 + GAP）

**GAP 判据**（显式定义）：某能力行若插件**当前的 DSH 专属面**在非 DSH 宿主上没有一阶等价物、必须新建桥接才能工作，记 **GAP=是**。DSH 列 = E0 锚点（不重测）+ 仓内实测锚点 + 「进程内常驻 bundle」形态注；CC/Codex 列**全部**来自公开 Web 文档，逐格标「外部信息，未在仓内验证」（未找到/无法直捕的一律标 **未证实**，不猜测）。

### 行 1 — 工具注册/调用

| DSH（进程内常驻 bundle） | Claude Code | Codex CLI |
|---|---|---|
| 面：`defineTool` + per-agent scope + `tools/pre-execute` 瀑布（allow/deny/cancel/ask）——E0:57-58。插件实测：11 科研工具经 `ctx.tools.register` 注册（I20：`host/index.ts:2002,2037`；定义 `src/host/tools/index.ts:243-255`，宿主无关 TS，`createResearchTools` 纯组装）。工具是**进程内 TS 对象**，宿主投影 JSON Schema。 | MCP server 供给工具；配置：项目 `.mcp.json`（VCS 可共享）+ local/user 作用域（`~/.claude.json` 系）；`claude mcp add` 管理；MCP server 还可作 channel 向会话推消息；headersHelper 工作目录按声明层解析（`mcp__<server>__<tool>` 命名见权限规则面）。【外部信息，未在仓内验证：code.claude.com/docs/en/mcp、/en/permissions】 | `config.toml` `[mcp_servers.<name>]`（远端 `url =` 形式见官方示例；local/stdio 形式的字段表**未直接捕获**——mcp 文档页中段截断，标 **未证实**）；CLI `codex mcp`「Add local or remote MCP servers, authenticate when needed, and inspect the tools available to the current session」；`required = true` 的 server 初始化失败时 `codex exec` 硬退出；`codex exec --json` 的 item 类型含 MCP tool calls。【外部信息，未在仓内验证：learn.chatgpt.com/docs/extend/mcp、/docs/codex/cli、/docs/non-interactive-mode】 |
| **GAP = 是**：11 个进程内 TS 工具定义非 DSH 宿主无法直接装载；须新建「科研平面 → MCP server」桥（把 `wiring.tools` 的 name/description/parameters/output/execute 映射为 MCP 工具）。（注：工具定义本体已宿主无关——I20 的 `createResearchTools` 纯组装是桥的现成输入。） | | |

### 行 2 — 提示注入

| DSH | Claude Code | Codex CLI |
|---|---|---|
| 面存在：`ctx.systemPrompt.section`（E0:56）——但插件**未用**（实测 rc=1，§1.5）。插件实际的动态注入 = investigator 任务消息 `agent.followup(createUserMessage(...))`（I29：`launcher/adapter.ts:207`）+ 权限命令 `/permission read-only`（I27/I30）。 | 持久：`CLAUDE.md` / `AGENTS.md`（项目根、`.claude/`、任意目录可被识别；Claude Code 可代读仓库 `AGENTS.md`）+ auto memory（Claude 自写）+ `.claude/rules/` 路径规则；每会话起始载入，「context, not enforced configuration」。动态：`UserPromptSubmit` hook。【外部信息，未在仓内验证：code.claude.com/docs/en/memory、/en/hooks】 | 持久：`AGENTS.md` 指令链——全局层 `$CODEX_HOME`（默认 `~/.codex`）`AGENTS.override.md`→`AGENTS.md`（取首个非空），项目层自 git 根向下走到 cwd 每目录至多 1 文件，根→下拼接、就近覆盖，`project_doc_max_bytes` 默认 32 KiB。动态：`UserPromptSubmit` hook。【外部信息，未在仓内验证：learn.chatgpt.com/docs/agent-configuration/agents-md、/docs/hooks】 |
| **GAP = 否**：三宿主均有持久指令面（DSH 面存在未用；CC `CLAUDE.md`/`AGENTS.md`；Codex `AGENTS.md`）；动态逐任务提示可经无头入口参数化（`claude -p` / `codex exec "<task>"`——后者 stdout=最终消息、stderr=进度，可脚本化【外部信息，未在仓内验证：learn.chatgpt.com/docs/non-interactive-mode】）。 | | |

### 行 3 — UI 表面

| DSH | Claude Code | Codex CLI |
|---|---|---|
| 面：`ctx.slots.register/inject`（**client only**；E0:59 实证槽名 `settings.section`/`shell.overlay`/`conversation.composer` 等）。插件实测用两槽：`conversation.view`（I35：`ui.ts:70,186-187`）+ `plugins.row.config`（I36：`settings-card.tsx:134,563`）。形态 = DSH web shell 内的 React 组件（client bundle，H4）。 | 表面 = 终端 TUI + IDE 扩展（VS Code/JetBrains）+ Desktop + 浏览器（overview 页自述）。可插 UI：plugin「mod」可注册 JS 函数 hook 且「can draw in the interface as well as act on events」（hooks 页 mod 段）——**非**声明式槽 API。【外部信息，未在仓内验证：code.claude.com/docs/en/overview、/en/hooks】 | 表面 = 终端 TUI + IDE 扩展 + Desktop（`codex app`）；深集成 = **app-server**（「the interface Codex uses to power rich clients (for example, the Codex VS Code extension)」，含 auth/历史/审批/流式事件；开源 `codex-rs/app-server`）——非插件 UI 槽 API。【外部信息，未在仓内验证：learn.chatgpt.com/docs/codex/cli、/docs/app-server】 |
| **GAP = 是**：槽式 Web UI 面（shell 视图、settings 卡）在两非 DSH 宿主上无声明式等价物；科研 UI 当前只能在 DSH shell 内渲染（非 DSH 宿主的展示面需另建，如 app-server 消费方 / mod）。 | | |

### 行 4 — 权限门（allow/deny/ask）

| DSH | Claude Code | Codex CLI |
|---|---|---|
| 面：`tools/pre-execute` 瀑布，`PreToolDecision = allow \| deny{reason} \| cancel \| ask{...}`（E0:58，ask 走 approval 服务）。插件实测门 = 只读 investigator：工具白名单（S2：`investigator/types.ts:105-106`，`dsh-tool-fs` 刻意排除）+ 运行时 `/permission read-only` 命令（I27/I30：`launcher/adapter.ts:143-144,268`）。 | 分层权限：settings `permissions.allow/ask/deny` 规则 `Tool(specifier)`（例 `Bash(npm run *)`、`WebFetch(domain:...)`、`mcp__<server>__*` 通配、参数规则 `Agent(model:opus)`）；求值序 deny→ask→allow；「enforced by Claude Code, not by the model」；权限模式 default/acceptEdits/plan/auto/dontAsk/bypassPermissions；「Yes, don't ask again」落 `.claude/settings.local.json`（git 根）；hook 可扩评估（PreToolUse 决策 allow/deny/ask）；OS 级 sandboxing（文件系统+网络隔离）。【外部信息，未在仓内验证：code.claude.com/docs/en/permissions】 | 规则：`.rules`（Starlark）`prefix_rule(pattern, decision="allow"\|"prompt"\|"forbidden", justification?)`，放各配置层旁 `rules/`（用户层 `~/.codex/rules/`；项目层 `<repo>/.codex/rules/` 仅受信项目加载）；多规则匹配取**最严**（forbidden > prompt > allow）；shell 复合命令安全拆分（tree-sitter，线性安全链才拆）；`codex execpolicy check` 可离线试算；**experimental**。沙箱/审批双控制：sandbox 定文件/网络边界（`codex exec` 默认 read-only；`--sandbox workspace-write`/`danger-full-access`），审批定何时暂停（Ask for approval / Approve for me 自动审查 / Full access；CLI `/permissions` 可查 active sandbox 与 writable roots）。【外部信息，未在仓内验证：learn.chatgpt.com/docs/agent-configuration/rules、/docs/permission-modes、/docs/non-interactive-mode、/docs/codex/cli】 |
| **GAP = 否**：两非 DSH 宿主都有一阶 allow/ask/deny 规则面 + 沙箱模式；「只读 investigator」直接映射为只读工具约束 / read-only sandbox + 无外沙箱命令规则。 | | |

### 行 5 — 事件通道（宿主事件 → 科研 intake）

| DSH | Claude Code | Codex CLI |
|---|---|---|
| 面：进程内 `ctx.events.on('session/event')`（I24：`session.ts:235`，E0:44「Post-commit, fire-and-forget append feed」、`@mode emit`）+ `'session/created'`（:249）+ `'session/disposed'`（:256）→ `HostSessionAdapter` → 端口 → `SessionLinkService`（I42：`sessionlink/service.ts:107,282-287`）/`RunBindingService`（`runbinding/service.ts:180-187`）。事件真源面：`SessionEventMap` 机制强制 append-only（E0 §2）。 | hook 事件（lifecycle 表全量）：`SessionStart`/`Setup`/`UserPromptSubmit`/`UserPromptExpansion`/`PreToolUse`/`PermissionRequest`/`PostToolUse`/`PostToolUseFailure`/`PostToolBatch`/`SubagentStart`/`SubagentStop`/`TaskCreated`/`TaskCompleted`/`TeammateIdle`/`Stop`/`StopFailure`/`PreCompact`/`PostCompact`/`SessionEnd`/`Elicitation(Result)`/`PermissionDenied`/`WorktreeCreate(Remove)`/`Notification`/`ConfigChange`/`InstructionsLoaded`/`CwdChanged`/`FileChanged`/`DirectoryAdded`/`PreModelSwitch`/`PostModelSwitch`/`MessageDisplay`；handler 五型：shell command（stdin JSON）/ HTTP endpoint / MCP tool / LLM prompt / subagent；`SessionStart` matcher：startup/resume/clear/compact/fork；**所有运行面同事件**（终端/IDE/Desktop/cloud）。【外部信息，未在仓内验证：code.claude.com/docs/en/hooks】 | hook 事件：`PreToolUse`/`PermissionRequest`/`PostToolUse`/`PreCompact`/`PostCompact`/`UserPromptSubmit`/`SubagentStop`/`Stop`（turn 内）+ `PreModelRequest`/`PostModelRequest`（每次模型请求）+ `Interrupt` + `SessionStart`/`SubagentStart` + `SessionEnd`；handler 两型：**脚本或 MCP tool**；发现位置 `~/.codex/hooks.json`、`~/.codex/config.toml`（inline `[hooks]`）、`<repo>/.codex/` 同两形式、插件可 bundle（manifest 或 `hooks/hooks.json`）；非托管 hook 须 hash 级 trust review（`/hooks` 命令）；managed 层 = system/MDM/cloud/`requirements.toml`（`allow_managed_hooks_only`）。【外部信息，未在仓内验证：learn.chatgpt.com/docs/hooks】 |
| **GAP = 是**：科研 plane 的 intake 当前 = **进程内** `session/*` 事件流（I24/I42）；非 DSH 宿主只给**进程外** hook 回调（command/HTTP/MCP tool），且 hook 是宿主侧用户/项目配置、非插件代码注册。桥 = hook handler（MCP tool 或 HTTP）→ 科研平面 intake 端点（报告 RUN_STARTED/RUN_FINISHED 等价边）——**今日不存在**，须新建。 | | |

### 行 6 — 会话/工作区上下文

| DSH | Claude Code | Codex CLI |
|---|---|---|
| 进程内 ctx：`ctx.sessions.list()`（I23：`session.ts:210`）+ `ctx.workspaceRegistry.list()`（I14：`host/index.ts:796-804`）。宿主侧：无多 Space/租户实体；workspaceRegistry = 目录↔会话分组、本身建在 storageDomain 上（E0:105）。 | session = 绑定项目目录的持久对话；transcript JSONL 默认 `~/.claude/projects/<project>/<session-id>.jsonl`（`<project>` = 工作目录路径非字母数字→`-`，>200 字符截断+hash）；`--continue`/`--resume [name\|transcript-path]`/`--from-pr`/`/resume`/`/branch`；worktree 感知；`CLAUDE_CONFIG_DIR` 换根；`CLAUDE_CODE_PROJECT_DIR_NAME` 宿主嵌入命名（tenant 例）；`claude -p` 无头 + `--output-format json|stream-json`。【外部信息，未在仓内验证：code.claude.com/docs/en/sessions、/en/claude-directory】 | `codex resume`（当前仓库近期聊天；跨仓搜索本地聊天）；`codex queue --thread <SESSION_ID> --message`（给既有会话排队消息，`--resume` 可联动）；session rollout 文件落盘（`--ephemeral` 不持久化）；项目根 = git 根（无则仅当前目录）；`CODEX_HOME`（默认 `~/.codex`）切配置/状态根；`codex --cd`。【外部信息，未在仓内验证：learn.chatgpt.com/docs/codex/cli、/docs/developer-commands、/docs/non-interactive-mode、/docs/agent-configuration/agents-md】 |
| **GAP = 否**：三宿主都有「会话身份 + 项目根 + 状态根」三要素；科研 plane 的 run 身份由**自己的**事件源状态（research.sqlite，②）定义，宿主会话/工作区上下文只是 intake 的输入字段，不依赖宿主内部结构。 | | |

### 行 7 — 持久化根路径

| DSH | Claude Code | Codex CLI |
|---|---|---|
| 科研状态**不用** `ctx.storageDomain`（E0:13/38：无事务、非 append-only、不跨键原子 → 不能当事件真源）；用自有 `research.sqlite`（②：落点解析纯函数、MANAGED 随 hub、STANDALONE 随 workspace、V1 `$DSH_HOME/research-control/` 退役为 hint-only 探针 I17/I40）。DSH 自身状态根 = profile + `DSH_HOME`（进程级单租户，E0:105）——与科研落点**分离**。 | 状态根 `~/.claude`（transcripts、prompt history、file snapshots、caches、logs；`~/.claude/plugins` 插件数据；`~/.claude.json` 账户/本地作用域配置）+ `CLAUDE_CONFIG_DIR` 整体换根；30 天保留清扫（`cleanupPeriodDays`）；`claude purge` 清项目数据。【外部信息，未在仓内验证：code.claude.com/docs/en/claude-directory、/en/sessions】 | 状态根 `~/.codex`（`config.toml`、`hooks.json`、`rules/`、`agents/`、`AGENTS.md`）+ 项目层 `.codex/`（**仅受信项目**加载；untrusted 跳过项目层 config/hooks/rules）+ 系统层 `/etc/codex/config.toml`（Unix）；precedence：CLI flags > 项目（近者优先）> profile > 用户 > cloud-managed > 系统 > 内置；`CODEX_HOME` 换根。【外部信息，未在仓内验证：learn.chatgpt.com/docs/config-file/config-basic、/docs/agent-configuration/agents-md】 |
| **GAP = 否**：科研持久化**已宿主无关**（相对 hub/workspace 的纯解析器，零 DSH import，§1.5）；宿主状态目录（`~/.claude` / `~/.codex` / `$DSH_HOME`）与 `research.sqlite` 互不相交。V1 退役段（`OLD_DB_HOME_SEGMENT`）是唯一的 DSH_HOME 痕迹且已是参数化探针（I40）。 | | |

### 行 8 — agent 编排

| DSH | Claude Code | Codex CLI |
|---|---|---|
| 进程内**程序化**：`agents.create({meta:{cwd, agentPreset}, setup})` → `roster.mount` → `agent.followup`（I28-I30：`launcher/adapter.ts:188,237,207`）；investigator = 插件代码按序拉起的受控只读 agent。宿主侧：无 V3 编排者；实存实验性 agent-team（9 个模型工具 roster+mailbox+任务 DAG，出厂 opt-in、默认隔离，E0:92-98）。 | 自定义 subagent = markdown+frontmatter（独立 context window、自定义 system prompt、受限工具、独立权限），项目 `.claude/agents/` / 用户级跨项目复用；内置 subagent（Explore/Plan 等）；`--agent` 显式指定；subagent transcript 保留 + `cleanupPeriodDays` 清扫；更大编排面：background agents（agent view）、cross-session messaging、agent teams。【外部信息，未在仓内验证：code.claude.com/docs/en/sub-agents】 | subagent workflow **默认开**（app/cli/ide 面）；自定义 agent = TOML（`name`/`description`/`developer_instructions` + `model`/`model_reasoning_effort`），项目层 `.codex/agents/*.toml`（官方示例实证；用户层在 `$CODEX_HOME` 下、目录名**未直接捕获**）；`[[skills.config]]` 可 per-agent 启停技能；CLI `/subagents` 检查/切换线程；subagent 继承父线程沙箱/审批/provider/MCP server。【外部信息，未在仓内验证：learn.chatgpt.com/docs/agent-configuration/subagents】 |
| **GAP = 是**：DSH launcher 是**程序化**（插件代码 create/followup/mount 一条龙）；非 DSH 宿主的 subagent 是**声明式配置**（宿主自己按 description 派发，插件代码无法从自身进程拉起一个）。程序化等价物 = 无头子进程（`claude -p` / `codex exec`）——形态不同（进程边界 + 文件/stdio 交接），须新建 launcher 适配。 | | |

**GAP 行计数 = 4**（行 1 工具注册/调用、行 3 UI 表面、行 5 事件通道、行 8 agent 编排；行 2/4/6/7 非 GAP）。

### MCP 公约数结论

1. **MCP 是 Claude Code ↔ Codex CLI 之间的一阶公约数**：两宿主都把 MCP server 当作外部工具接入的一阶形式（配置面：`.mcp.json`+local/user 作用域 vs `config.toml [mcp_servers]`+`codex mcp`；两者都把 MCP tool 同时收进 hook handler 型——CC 五型之一、Codex 两型之一【外部信息，未在仓内验证】）。
2. **DSH 侧无 MCP 面**：进程内 = Cordis DI 服务缝（`static inject` + `ctx.get`，E0:109）；跨进程 = SDK JSON-RPC only（E0:111：`packages/sdk/protocol/src/types.ts`，面向外部客户端、非插件间总线）；E0 五面（inject/systemPrompt.section/defineTool/slots/FTS5）无一为 MCP。
3. **仓内跨进程 RPC 先例 = `@deepseek-ai/dsh-typert-protocol` Remote**（I3/I7/I16/I37/I38：import `host/index.ts:149`，`extends TypertRemoteService` :483，59 个 `@Remote` 方法，client 侧 `ctx.remote.$mount` :204-205）——它是 DSH 自家 gateway 的 JSON-RPC，传输形态最接近 sidecar RPC，但**不是** MCP（私有协议、随宿主版本锁步）。
4. ⇒ **三宿主公约数不是 MCP，而是科研平面自身**：自有事件源持久化（`research.sqlite`，宿主无关解析器 ②）+ 宿主无关工具定义（`createResearchTools` 纯组装）+ 端口化 intake（I41/I42）。MCP 是**非 DSH 侧的对外形态**（行 1 桥）；DSH 侧维持进程内 DI。适配矩阵 = 每宿主一个 adapter：DSH = 现有 dsh-adapter/；CC/Codex = sidecar 进程（MCP server 暴露 11 工具 + hook→intake 桥 + 无头子进程 launcher）。

## 3. 任务三 — 拓扑

### DSH = 进程内常驻 bundle

- **形态锚点**：`cordis.patch.yml:1`（`insert: [{ id: research-control, name: 'dsh-research-control' }]`）+ `package.json:43-45`（`dsh.bundle.patch → ./cordis.patch.yml`）+ `package.json:77-83`（peer 5 pin = 宿主进程内提供）+ `tsdown.config.ts:170-179,205`（client bundle 外挂 shell 模块表 + `window.__ModuleLoader__` 工厂 banner）。
- **缝**：进程内 DI——`static inject` 硬依赖（`host/index.ts:499`）+ `ctx.get` 可选面（`session.ts:206-207`、`launcher/adapter.ts:164,179,259`、`settings.ts:407`）；生命周期 = `[Service.init]` + `ctx.effect` fiber 拆除（`host/index.ts:750,913,967-968`）。E0:109：「进程内插件间协作 = Cordis DI 服务缝…无 capability 版本注册/协商面」。
- **仓内跨进程先例**：`@deepseek-ai/dsh-typert-protocol` `Remote`——`src/host/dsh-adapter/host/index.ts:149`（import）、:483（`extends TypertRemoteService`）、59 个 `@Remote` 方法（:1003-~1700）；client 侧 `remote/mount.ts:204-205`（`ctx.remote.$mount`）+ `contribution.ts:163`（`declare module` 端点映射）。这是仓内唯一的「宿主外进程可调用科研 plane」的既有形态：JSON-RPC 端点经 DSH typert gateway 暴露。**注意**：该传输绑定 DSH 网关（私有协议、`0.2.0-rc.2` 锁步），不可直接当作 MCP 侧车用。

### 非 DSH = sidecar 进程 + stdio JSON-RPC（MCP 形态）

- **Claude Code**：`claude mcp add` 挂本地（stdio 起进程）/远端 server；server 由宿主 spawn、生命周期随会话（SIGINT/SIGTERM/SIGKILL）；`type: "sdk"` 进程内 server 仅 SDK 宿主可用（该句位于文档页中段、**未直接捕获**，标 **未证实**）。【外部信息，未在仓内验证：code.claude.com/docs/en/mcp】
- **Codex CLI**：`[mcp_servers]`（config.toml）+ `codex mcp`；独立于 MCP 的深集成面 = **app-server**：「Like MCP, `codex app-server` supports bidirectional communication using JSON-RPC 2.0」，传输 = **stdio（默认，JSONL）/ websocket（experimental）/ unix socket / off**（`codex app-server --listen ...` + `codex --remote ...`）；CI/自动化官方指向 Codex SDK。【外部信息，未在仓内验证：learn.chatgpt.com/docs/app-server、/docs/extend/mcp】

### 对照与推论

| 轴 | DSH（现状） | 非 DSH（目标形态） |
|---|---|---|
| 进程关系 | 同进程（bundle 驻宿主） | sidecar 独立进程 |
| 传输 | DI（进程内）+ typert gateway JSON-RPC（仓内先例，:149） | stdio JSON-RPC（MCP）/ unix socket |
| 工具面 | 进程内 `ToolDefinition` 注册（I20） | MCP tools（行 1 桥） |
| 事件 intake | 进程内 `session/*` 事件流（I24） | hook 回调（MCP tool / command / HTTP，行 5 桥） |
| 持久化 | 平面自有 research.sqlite（②） | **不变**（平面自有，宿主无关——行 7 非 GAP 的根据） |
| 版本协商 | `minDshVersion` 对 DSH 包 semver（S1/I11） | MCP 协议版本协商（open protocol，非锁定步） |

**推论**：科研平面（events + sqlite + 工具定义 + 端口）已按「宿主可替换」内聚（INV-PERM-5 + I 项 42 全在缝内）；脱离 DSH 的工程量集中在 **4 条 GAP 桥**（MCP 工具暴露、hook→intake、launcher 无头化、UI 替代面）——全部是「平面已有面 → 新宿主面」的映射工作，不需要动平面内部。
