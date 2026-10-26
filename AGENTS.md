# AGENTS.md — 工作区执行纪律（代理与会话必读）

> 状态：**Active**（2026-09-18 用户指令记入；2026-10-26 基线重置时同步改写；
> 同日 EB1 单正源迁移后更新 §5）。
> 性质：执行纪律（**非**冻结契约）。变更仅由用户指令驱动；变更时更新本文件。
> 适用：在本工作区（`dsh-research-control` 插件仓）执行任何读取 / 修改 / 构建 / 测试的会话，含一切子代理委派（委派前同时遵守 `SUBAGENT_ROUTING.md` 的三级模型路由与审查面板）。

## 0. 开发基线（2026-10-26 用户指令）

- **基线 = 上游 `origin/main`**（G5 工具闭环收口，train `0.1.2-alpha.3`）。
- **train 迁移（用户裁决「产品要跟进上游更新」）**：目标 train `0.2.0-rc.2`
  （release 提交 `c1b47e41fc`），在分支 `maint/train-0.2.0-rc.2` 落地（迁移记录
  `docs/MAINT_0_2_0_RC2_PLAN.md`）；依赖 pin、§2 测试实例、TC-DSH-008 CLI pin
  三者随 train 一并重锚（登记 `dev/engineering/registry.yaml` host_pins）。
- 本地的 **0.1.5-rc.2 适配已取消**（用户判定：该版本已少人使用）。工作未删除，
  完整保留在本地分支 `archive/dsh-0.1.5-rc.2-adaptation`（含 rebase 收编、
  agent.id 适配与全绿门禁记录；**不入上游、不推送**）；其中与版本无关的
  settings-card 迟到注册修复单独摘到本地分支
  `fix/settings-card-late-scope-registration`（已在新基线验证：tests/settings
  38/38、tsc ZERO DIFF；待评审入主干）。
- 本文件三条硬纪律与 `references/` 只读副本、`tests/deepseek-harness/` 测试
  实例、`tests/dsh-homes/` 状态隔离**不随基线重置失效**（它们约束的是沙箱
  工作形态，与宿主版本无关）。

本工作区被设计为可在 DSH **workspace-write** 沙箱权限下闭环运行：参考代码只读、
测试实例与全部测试状态都限制在工作区内。以下三条是硬纪律。

## 1. 参考代码 — `references/deepseek-harness/`（只读，勿动）

- DSH 宿主源码的**参考副本**（2026-09-18 实测版本：`0.1.5-rc.2`），是查证 DSH
  API 真实签名、行为与文档的一手验证落点（`DSH_ADAPTER.md` 的 [V] 标记在此续作）。
  **注意**：2026-10 train 迁移（0.2.0-rc.2）后，副本版本（0.1.5-rc.2）比当前基线
  train **更旧**——在其中查证到的 API 形状不可直接当作 train pin 下的真值引用，
  须先核对版本（新基线的一手验证落点是 `tests/deepseek-harness/` 的 train checkout）。
- **纪律：只读。** 禁止对该目录做任何写操作（edit / write / delete / 任何 git
  变更 / 安装依赖 / 构建产物写入）。在其中发现与文档不符之处：只记录（含文件
  路径 + 行号 + 证据），不修改。
- 自带 `.git`；已 gitignore——不入本仓版本树、不进发布包（dev-private）。

## 2. 测试用 DSH 实例 — `tests/deepseek-harness/`（测试一律用它）

- 测试专用 DSH checkout，是**一切需要真实 DSH 的测试的唯一实例来源**：e2e、
  live 冒烟、`dsh` CLI 操作，一律基于这份 checkout（其 CLI 与构建产物）——
  不从 npm 注册表另装 dsh，也不使用 `references/` 副本（那是只读参考，不是测试实例）。
- 与参考副本的边界：允许为测试需要在其**目录内部** `pnpm install` / 构建
  （写操作限于该目录内）；不做与本插件测试无关的功能改动。
- 自带 `.git`；已 gitignore（嵌套仓不入本仓版本树）。
- **配套**：`vitest.config.ts` 与 `tsconfig.json` 的 exclude 含
  `tests/deepseek-harness/**` / `tests/dsh-homes/**` / `references/**`——该
  checkout 自带大量 spec 与 TS 文件，绝不可被本仓的测试收集器 / 类型检查器收编；
  如改动收集面，保持这几条排除。
- **版本对齐（2026-10 train 迁移更新）**：checkout 已切到 train `0.2.0-rc.2` 的
  release 提交 `c1b47e41fc`（= `release(dsh): 0.2.0-rc.2`，root package.json 版本
  核验一致；上一对齐为 0.1.2-alpha.3 @ `dd6322d604`，2026-10-26）。**train 切换必做**：先 `pnpm run clean`
  再 `pnpm run build`——`lib/` 等产物是 gitignored 且 tsc 增量不删孤儿文件，实测
  0.1.5 残留（`DockSurface.js` → tsdown UNRESOLVED_IMPORT；残留 CLI → import 旧
  train 才有的 `dsh-http-proxy`）会同时毒化构建与运行面。live-boot 冒烟已通过
  （0.2.0-rc.2 证据：`tests/dsh-homes/live-maint-rc2/`，见
  `docs/MAINT_0_2_0_RC2_PLAN.md` 落地状态节；旧 train 证据 `tests/dsh-homes/live-probe-20261026/`；探针配方：`DSH_HOME`、`HOME`
  （pnpm 11 的 sqlite 状态落在 `$HOME` 下，沙箱必须一并收进工作区）、pnpm storeDir
  三者全落 `tests/dsh-homes/` 内；起服 / 探测 / 关停必须写在**同一个** bash 调用里
  ——会话会在调用边界回收后台进程）。

## 3. DSH_HOME 纪律 — 一律落在 `tests/dsh-homes/`

- **任何需要 DSH 的测试 / 冒烟 / CLI 运行，`DSH_HOME` 必须设置在
  `tests/dsh-homes/` 之内**，按用途分独立子目录：

  ```sh
  DSH_HOME="$PWD/tests/dsh-homes/<用途>" dsh ...
  # 例：tests/dsh-homes/smoke · tests/dsh-homes/live-2026-10-26 · tests/dsh-homes/investigator
  ```

- **目的**：全部测试状态（profiles、pnpm storeDir、sessions、`.agent-presets`、
  research.sqlite 种子、e2e 证据）限制在工作区内，使整个开发可在 DSH
  **workspace-write** 权限模式下进行——写工作区外会被沙箱拒绝，本纪律让正常
  测试流程永远不需要越界。
- `tests/dsh-homes/` 的内容均为**可弃状态**：已 gitignore（仅保留 `.gitkeep`）；
  重置 = 删除对应子目录重跑（e2e 的 `--reset` 语义不变）。旧 train（0.1.5-rc.2）
  的 homes 同样可弃，直接删子目录。
- 一份 DSH_HOME 只服务一个测试流（并发互斥）；e2e 的 flock 独占锁语义不变。
- 绝不允许 DSH 落 `$HOME/.dsh` 或任何工作区外路径。继承自会话的 `DSH_HOME`
  落在 `tests/dsh-homes/**` 内即视为隔离值（e2e-run.sh 归一化到强制 smoke
  home）；落在工作区外则 FATAL（exit 2）——该守卫继续有效。

## 4. 门禁脚本的形态（2026-10-26，随基线重置改写）

| 文件 | 本地增量（相对上游） | 上游语义（不变项） |
|---|---|---|
| `scripts/e2e-run.sh` | 默认 smoke root `<repo>/tests/dsh-homes/.smoke`（工作区内，§3）；继承的 `DSH_HOME` 落在 `tests/dsh-homes/**` 内按隔离值归一化 | `E2E_SCHEMA_ROOT` 走上游 G0（`scripts/resolve-e2e-schema-root.sh`：默认 = 仓内已提交快照 `<repo>/schema`，显式覆盖优先，一次性归一化绝对路径、不可用即 exit 1；测试侧同源谓词 `tests/helpers/workspace-root.ts`，`DSH_RESEARCH_WORKSPACE_ROOT` 覆盖，不做父目录自动发现）；强制 smoke home（`$SMOKE_ROOT/dsh-home`）、exit 2/3 语义、flock 独占锁、端口 3199、TC-DSH-008 CLI pin 随上游取值（当前 `0.2.0-rc.2`；2026-10 train 迁移已重锚至 §2 测试实例同一 train，B-EB3-1 的 rc.8 起服缺陷随之解除，TC-DSH-008 世界复跑待迁移评审合入后执行）、`DSH_SMOKE_ROOT` 覆盖（并行运行时仍建议指向 `tests/dsh-homes/` 内独立子目录） |
| `vitest.config.ts` | `exclude` 含 `references/**`、`tests/deepseek-harness/**`、`tests/dsh-homes/**` | 其余 include/exclude、decorator 插件 |
| `tsconfig.json` | `exclude` 含 `references`、`tests/deepseek-harness`、`tests/dsh-homes` | 其余 compilerOptions、include |
| `.gitignore` | 增加 `references/`、`tests/deepseek-harness/`、`tests/dsh-homes/*`（`!tests/dsh-homes/.gitkeep`）、`.scratch/`、`.npm-tmp/` | 其余条目 |

- 单元测试（`pnpm test`）本身不触碰 DSH_HOME（纯逻辑 + 临时文件），§3 不改变
  其行为；§2 只影响"需要真实 DSH"的测试（e2e / live 冒烟 / CLI 操作）。
- `pnpm run build` 的契约校验（EB1 起）：`scripts/snapshot-release.mjs` 只校验
  仓内正源 ↔ `SNAPSHOT.md`（双向逐文件 sha256，零写入；漂移即构建红），不再读取
  任何仓外路径；`DSH_SNAPSHOT_SOURCE_ROOT` 设置即 fail-loud（退役）。
- `pack:verify` 设计上会预跑 `build`（refresh lib/）：构建产物的
  `//#region \0rcm-css:<abs-path>` 注释内嵌**构建机绝对路径**，上游 lib/ 出自上游
  机器，故本机跑 build / pack:verify 后 `lib/` 出现的差异若仅为该路径注释，属
  **环境噪声非漂移**——验证通过后 `git checkout -- lib/` 恢复提交态，不提交。

## 5. 继续有效的既有纪律

- **冻结面（AD-EB-01，2026-10-26 起为仓内正源）**：8 份根文档 + `schema/**` 是
  Git 内唯一可编辑契约正源（批准基准哈希 `docs/engineering-baseline/gates/G0-inventory.yaml`）；
  `SNAPSHOT.md` 为生成清单，构建双向 sha256 校验。修订必须走冻结变更流程：改契约
  文件 → `pnpm run snapshot:update` → 契约与清单同一提交评审；未经该流程的改动会
  直接构建红（CONTRACT_DRIFT）。本文件**不在**冻结面（非 FROZEN_DOCS、不在
  `package.json` files、不入发布包），可随纪律更新。`DSH_SNAPSHOT_SOURCE_ROOT` 已退役
  （设置即 fail-loud）；运行时 `DSH_RESEARCH_SCHEMA_ROOT` 覆盖语义不变。
- **`SUBAGENT_ROUTING.md`**：子代理三级模型路由（默认 → 升级 → 暂停待裁决）与
  审查代理面板——一切委派通道拉起前必读。
- **README「开发」节**：标准四件套顺序（tsc → lint → build → test）与发布门禁
  （`pack:verify`、`test:e2e` 隔离面）。
- **文档纪律（EB2/ADR-0002）**：变更影响与静态一致性走 `pnpm run docs:probe /
  docs:check / docs:sync`（共享内核 `scripts/docs/kernel.mjs`，CI 同规则）；归属
  `dev/engineering/doc-ownership.yaml`，非推导事实 `dev/engineering/registry.yaml`
  （两者人工，sync 禁写）；文档分层导航 `docs/README.md`，纪律 `docs/development.md`，
  测试环境的坑 `docs/testing.md`，决策 `docs/decisions/`。状态词汇不互推：
  `verified/released` 无真实证据路径 = `docs:check` 红。
