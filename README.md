# dsh-research-control

> DSH Research Control Plane V1 — DeepSeek Harness 的科研工作流 Cockpit 插件。

Git-backed、event-sourced 的科研工作流控制面：用 **Project / Topic / Workstream** 组织研究，用 **History / Current / Future** 分离过去、现在与未来；用 immutable **Agent PlanFork** 保护用户对计划的最终控制权；用 **Intervention** 平面管理稀缺的人类注意力；并把科学判断留给人和科研 Agent。插件面向 DSH **0.1.0-rc.8** 构建（peer 精确 pin + 自持 `minDshVersion` fail-loud 版本门，无宿主兼容承诺）。

运行时面：

- **Host service `ctx.researchControl`** — 13 个一元 RPC（`researchControl.*`，纯 JSON DTO）+ 启动完整性检查（DB/树/Git/一致性四检查，损坏即 fail-loud 或降级只读）；
- **11 个 `research_*` agent 工具**（ARCHITECTURE §7.2：7 可写 + 4 只读；权限矩阵内置）；
- **Web UI** — `conversation.view` 整 tab（Cockpit 三区 + Plan/Topology 图 + History 时间线 + Drill-down）+ `shell.overlay`；
- **只读 Investigator** — 从 Intervention 一键启动独立只读会话（专用 preset + `/permission read-only`，INV-PERM-3 三层保障）；
- **持久化** — `node:sqlite` operational store（`$DSH_HOME/research-control/<project-id>/research.sqlite`，WAL + 单调 `user_version`）+ 对 `.research/` 声明式树与 Git 的谨慎消费（checkpoint 仅提交 `.research/**`）。

---

## 安装

前置：`dsh` CLI（DeepSeek Harness `0.1.0-rc.8`）与 Node `^22.19.0 || >=24`。

### 方式一：tarball（推荐 — 不需要任何构建许可）

```sh
cd dsh-research-control
pnpm install && pnpm run build     # 产出 lib/ + 发布期快照（SI-001）
pnpm pack                          # → dsh-research-control-<version>.tgz
dsh plugin --profile web add ./dsh-research-control-<version>.tgz
```

`dsh plugin add` 本质是在 profile 目录跑 pnpm 安装 + 把本包声明的 `dsh.bundle` 层追加进 `dsh.profile.bundles`（`dsh.bundle.patch` 指向包内 `cordis.patch.yml`，插入 `research-control` 行）。预构建 tarball 不触发任何包内构建脚本，**无需 allowBuilds**。

### 方式二：git checkout / git host（需要 pnpm allowBuilds）

```sh
dsh plugin --profile web add ./path/to/dsh-research-control        # 本地 checkout
dsh plugin --profile web add github:you/dsh-research-control       # git host
```

git 安装取的是**源码**：pnpm 在安装后运行本包的 `prepare` 脚本（`tsdown` 构建 `lib/` 入口 + 快照钩子；自包含，不假设兄弟 monorepo）。**pnpm ≥ 10 默认拒绝执行 git 依赖的构建脚本**，首次 `add` 会失败并提示修法——把 pnpm 打印的包键写进 **profile 的 `pnpm-workspace.yaml`**：

```yaml
allowBuilds:
  dsh-research-control: true
```

然后重跑 `add`。把 `allowBuilds` 当成它实际是的东西：**允许该包在你的机器上、在沙箱之外执行代码**。只对你信任源码的包放行，并尽量 pin commit（`github:you/repo#<sha>`）以免后续推送静默改变被执行的代码。tarball / 注册表发行不需要此许可（见方式一）。

### 验证、卸载与热切换

```sh
dsh --profile web --dump-config    # 组合树中出现 id: research-control 行
```

卸载/热切换走文档化的 profile patch 机制：在 profile 的 `cordis.patch.yml` 中把 `research-control` 行置 `disabled: true`（行按 id diff，行保留、层不加载），冷重启生效（web 组合按冷重启设计——web-app bundle 禁用了 base 的 `hmr` 行）。`dsh plugin --profile web remove dsh-research-control` 移除依赖与层。

### 数据与冻结契约快照

- 运行数据：`$DSH_HOME/research-control/<project-id>/research.sqlite`（插件自有数据区；启动完整性检查在打开前做 `quick_check` + `user_version` 门）。
- 冻结契约：发布包含**内容一致的只读快照**（SI-001 发布期半边）——包根 `schema/`（JSON Schema 2020-12，23 文件）+ 8 份工程文档 + 逐文件 sha256 的 `SNAPSHOT.md` 清单（文件权限 0444/0555）。正本唯一留在研究工作区根；快照不是正源。Host service 自包内 `lib/` 向上一级解析 `<pkg>/schema`；特殊部署可用 `DSH_RESEARCH_SCHEMA_ROOT` 覆盖（不合法即 fail-loud）。

---

## 架构概览

```
client (React, lib/client.js)
   │  13 RPC（researchControl.*，Typert 一元）
host service ctx.researchControl（lib/index.js，service 形态 default-export）
   ├── service/   用例编排（RPC/工具实现层；唯一写 operational DB 与 .research/ 的层）
   ├── domain/    纯领域逻辑（状态机/派生/invariant，无 I/O、无 DSH import）
   ├── history/   20 事件信封 + append/replay/projection（HISTORY_EVENT_CATALOG）
   ├── persistence/  node:sqlite store + hardening（启动完整性四检查）
   ├── git/       唯一 spawn git 的层（INV-GIT-6；白名单 W1–W13）
   └── dsh-adapter/   DSH API → 插件自有接口的唯一映射面（INV-PERM-5：业务代码零 DSH import）
```

冻结契约（Frozen V1；发布期以只读快照随包，见上节）：

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 58 条 INV-* 不变量、权限矩阵、双真源、目录结构（冻结目标） |
| [DOMAIN_SCHEMA.md](DOMAIN_SCHEMA.md) | 25 类对象正式字段、ID 注册表、16 张状态机表、SQLite 映射 |
| [HISTORY_EVENT_CATALOG.md](HISTORY_EVENT_CATALOG.md) | 事件信封 + 20 事件 payload、双时序回放、emitter 矩阵 |
| [PLAN_FORK_SPEC.md](PLAN_FORK_SPEC.md) | PlanFork closure/blob 基准、SELECT 物化、stale、flooding |
| [GIT_INTEGRATION.md](GIT_INTEGRATION.md) | W1–W13 Git 白名单、checkpoint 流程、实测行为 |
| [DSH_ADAPTER.md](DSH_ADAPTER.md) | DSH 0.1.0-rc.8 API 逐项映射、打包 runbook、U1–U9 消解 |
| [TEST_MATRIX.md](TEST_MATRIX.md) | 7 套件 ~111 用例、INV→TC→AC 三层追溯 |
| [schema/](schema/README.md) | 机器可读契约（JSON Schema 2020-12；23 文件） |

隔离原则：业务代码（domain/history/persistence/git/service/views）禁止 import 任何 `@deepseek-ai/*` 包或 DSH 内部模块（lint 强制）；所有 DSH 依赖集中在 `src/host/dsh-adapter/` 与 `src/client/dsh-adapter/`。DSH 升级 = pin 新版本 → 跑 compatibility smoke → 只改 adapter 与映射文档。

---

## 开发

标准四件套顺序：**tsc → lint → build → test**（`tests/rpc-face/artifacts.test.ts` 断言构建产物面，需先 build）。

| script | 作用 |
|---|---|
| `pnpm run build` | `tsdown` 三相位（host `lib/` → client `lib/client.js` → e2e factory dist）+ SI-001 发布期快照（`scripts/snapshot-release.mjs`：工作区根 8 文档 + `schema/**` → 包根，只读 + sha256 清单） |
| `pnpm test` | vitest 单元/属性/集成全套（含真实工件 fixture：temp git 仓 + 真实 `.research` 树 + 真实冻结 schema） |
| `pnpm run lint` | import 面审计（`scripts/check-imports.mjs`：INV-PERM-5 等业务代码零 DSH import 规则） |
| `pnpm run test:perf` | 性能门禁（TC-PERF-001..006：10k 全谱系数据集；`DSH_RUN_PERF=1` 语义内置于 config） |
| `pnpm run test:e2e` | Playwright 真机循环：隔离 smoke home（**绝不**触碰 `~/.dsh` 与 3080），TC-DSH-005/007/008/009/010 + TC-E2E 双相位 + N 轮 load/unload；`--reset` 显式重置种子面 |
| `pnpm run pack:verify` | 发布门禁冒烟：`pnpm pack` 产物清单核查（files 面完整性 + 开发私有路径零泄漏）+ 解包后 node 实 import 主入口/`./typert`/`./remote` |
| `pnpm run prepare` | 安装期钩子（git install / `pnpm pack` 自动触发）：同 `build`，自包含（不假设兄弟 monorepo）；无工作区根时快照钩子大声跳过 |

源码布局见 [ARCHITECTURE.md §2.1](ARCHITECTURE.md)；测试策略与机器环境指纹见 TEST_MATRIX.md 与 `tests/` 各套件头注。

---

## Model Experience

### research_* 工具面（11 个工具）

#### 模型看到的内容

插件加载后，11 个 `research_*` 工具注册进会话全局工具层：7 个可写（`research_fact_record` / `research_claim_record` / `research_artifact_register` / `research_intervention_create` / `research_next_action_create` / `research_plan_fork_create` / `research_run_checkpoint`）+ 4 个只读（`research_context_get` / `research_plan_get` / `research_history_query` / `research_contract_read`）。模型看到每个工具的名称、描述与参数 JSON Schema（宿主 system-prompt 组装进工具块）；每次调用得到一个单一 canonical JSON 值（`output.schema` 声明）或结构化错误（含 `code`）。插件的 History 行、DB、文件树不直接可见——模型只能通过这 11 个工具（以及用户的 GUI/RPC 面）触达研究数据。当前构建中 9/11 个工具的 handler 是**桩**：参数校验后返回结构化 `TOOL_NOT_IMPLEMENTED` 错误（错误 `detail` 指明计划中的服务）；`research_plan_fork_create` 与 `research_run_checkpoint` 是活转发（见「已知局限与延后工作」）。

#### Token 影响

11 份工具 Schema 构成每会话一个**固定**前缀块（大小由定义决定，会话内不变）。每次工具调用向会话历史追加一条 tool-call 记录 + 一条 canonical JSON 结果（或结构化错误），并参与此后所有模型请求；结果大小随请求范围变化（`research_history_query` 等分页工具按页返回，页内行数有界）。桩工具的结果是小型恒定错误对象。

#### KV Cache 影响

工具 Schema 块位于稳定前缀：同一会话、同一工具组合下内容不变 → **prefix-stable**，可复用已建立的提供方缓存；工具结果按 **append-only** 追加，不使既有前缀失效。插件 fiber 卸载/重载（profile patch `disabled` 热切换或重启）会改变工具集合 → 前缀被**替换** → 此前可复用的缓存条目失效。

### Investigator 会话（只读闭集）

#### 模型看到的内容

一键启动的 Investigator 是一个**独立会话**（`research-investigator` preset + `/permission read-only`）：该会话的模型只看到 4 个只读 `research_*` 工具（7 个可写工具被 per-agent restriction 拒绝，INV-PERM-3）+ preset 挂载的 `bash`/`fs-search` 只读宿主工具；其输出默认 transient，仅用户显式保存才落 `AnalysisRecord`。发起方会话的模型**不**看到 Investigator 的对话内容（独立会话；GUI 展示走用户面通道），只看到用户在发起侧的后续操作。

#### Token 影响

机制与主工具面相同，但可见 Schema 只有 4 份研究工具 + 2 份宿主工具；Investigator 是新建会话 = 独立请求流，不占用发起会话的 token 预算。

#### KV Cache 影响

**Independent**：独立会话、独立请求流，不触碰发起会话的前缀；其会话内部同样 Schema 前缀稳定 + 结果 append-only。

---

## 已知局限与延后工作

- **9/11 工具 handler 为桩** — 注册面（name/description/parameters/output 契约）完整且被测试冻结，但 `research_fact_record` / `research_claim_record` / `research_artifact_register` / `research_intervention_create` / `research_next_action_create` / `research_context_get` / `research_plan_get` / `research_history_query` / `research_contract_read` 的调用返回 `TOOL_NOT_IMPLEMENTED`（`detail.plannedService` 指明目标服务）；对应 service 层多数已存在（WP-1.3/2.3/2.4/5.1/5.2），缺的是工具 handler → service 的接线 WP。模型体验上 = 「工具可见、调用即得结构化未实现错误」。
- **未公开发布** — `0.0.0` + `private: true`，未上 npm 公共注册表，license 未定；当前分发面 = 本地 tarball（`pnpm pack`）或 git checkout（需 allowBuilds）。
- **宿主无兼容承诺** — DSH 为 pre-release（「rename or repackage freely」）；本包以 peer 精确 pin `0.1.0-rc.8` + 自持 `minDshVersion` fail-loud 门 + TC-DSH-008 compatibility smoke 承接升级风险，不提供跨宿主版本兼容。
- **e2e 证据面** — 全绿证据基于隔离 smoke home（独立 DSH_HOME + 独立端口 + `--reset` 种子重置），非真实用户 profile 的长期运行；宿主侧长时行为（WAL checkpoint、profile 多 bundle 组合漂移）未覆盖。
- **快照无自动新鲜度门** — `SNAPSHOT.md` 记录构建时 sha256，但没有机制在「工作区根冻结面变更」后自动重打包；发布流程须重跑 `pnpm run build && pnpm run pack:verify`（重跑即重算快照并逐文件断言内容一致）。
