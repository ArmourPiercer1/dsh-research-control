# 打包与发布（packaging runbook）

本文件是插件仓的打包真源：`package.json` 的 `files`/`scripts`/`dsh` 面、SI-001 发布期快照机制、安装流的构建脚本许可（pnpm `allowBuilds`）、发布门禁冒烟（`pack:verify`）的操作与判定细节。面向维护者；用户安装流程见 [../README.md](../README.md)。

> 冻结契约依据：ARCHITECTURE §2.1（目录结构·冻结目标——包根 8 文档 + `schema/` 的交付形态）；SI-001（`docs/execution/spec-issues/SI-001.md`，工作区根——`resolved-compatibly`：开发期正本唯一 / 发布期快照）；DSH_ADAPTER §3（packaging runbook：`dsh` 字段、安装流、`files` 面、prepare/allowBuilds 注意）；宿主发布教程 `deepseek-harness/docs/user/develop/basic/publish.md`（「Installing from GitHub: the build-script catch」）。

## 1. 包面终态（`package.json`）

| 字段 | 终态 | 依据 |
|---|---|---|
| `main` / `types` | `lib/index.js` / `lib/index.d.ts` | DSH_ADAPTER §3 步 1（host 面 default-export service 类） |
| `exports` | `.`、`./typert`、`./remote`、`./client`、`./src/*`、`./package.json` | DSH_ADAPTER §5（`./typert` 四个产物须齐——loader 自动发现）、§3（client 面须有 `./client` export）；`./src/*` 保留源码消费面（tarball 随附 `src/`） |
| `files` | `lib`（全部构建产物，含 `rpc-contracts-*` 哈希双件与 `client.js.map`）、`src`、`schema`、`SNAPSHOT.md`、`cordis.patch.yml`、8 份根文档 | DSH_ADAPTER §3/§5（files 面完整）+ ARCHITECTURE §2.1（8 文档 + `schema/` 在包根）；`package.json`/`README.md` 由 pack 自动包含 |
| `dsh.bundle.patch` | `./cordis.patch.yml`（`- insert: [{id: research-control, name: dsh-research-control}]`） | DSH_ADAPTER §3（只有声明 `dsh.bundle` 的包才是「层」） |
| `dsh.client` | `{platform: web, inject: []}` | DSH_ADAPTER §6（manifest 扫描按 Loader entry 的 `dsh.client` 声明，out-of-tree 生效） |
| `peerDependencies` | 5 个 `@deepseek-ai/*` 精确 pin（无 `^`） | DSH_ADAPTER §12（宿主无版本检查机制 → 精确 pin + 自持 `minDshVersion` fail-loud） |
| `engines` | `node ^22.19.0 \|\| >=24` | 宿主 AGENTS.md 引擎面（node ^22.19 \|\| >=24） |

`exports` 终检由 `pack:verify` 承担：解包后以裸说明符经 `exports` 映射实 import `.`/`./typert`/`./remote`（`./client` 是浏览器 CJS bundle——banner 在 require 时执行 `window.__ModuleLoader__.load`，node 下不可 import——只按名在清单中核验）。

## 2. SI-001 发布期快照（`scripts/snapshot-release.mjs`）

**政策**（SI-001 裁定）：开发期（Phase 0–7）冻结正本唯一、留在工作区根，插件仓库**不复制**（复制即双源，违反冻结纪律）；打包期按 §2.1 目标布局以**内容一致的只读快照**复制进发布包。

**执行**（挂接在 `build` 与 `prepare` 的 `tsdown` 之后，幂等）：

1. 源根 = 插件仓库父目录（可用 `DSH_SNAPSHOT_SOURCE_ROOT` 覆盖，测试用）；
2. 复制 8 份工作区根 .md（§40 冻结记录表 7 份 Frozen V1 文档 + `SUBAGENT_ROUTING.md`——工作区根恰 8 份 .md，「8 份」按全量快照）→ 包根；`schema/**`（23 文件）→ 包根 `schema/`（同构镜像）；
3. **内容一致断言**：逐文件 sha256 源==目标，漂移即构建失败；
4. **只读声明**：文件 0444 / 目录 0555；重跑先恢复写权限再清除（幂等前提）；
5. **来源清单** `SNAPSHOT.md`：源根、生成时间、逐文件 sha256/字节、只读声明（「快照不是正本」）；内容（哈希表）不变则不重写——构建不产生时间戳抖动；
6. **缺席语义**：源根完全不在（git install 只拿到插件仓库树）→ **大声跳过**（退出 0 + 日志行）——冻结面已提交进版本树（见下「git 纪律」），跳过仅表示「不刷新」，包内快照原样随附，运行时照常自 `<pkg>/schema` 解析（`DSH_RESEARCH_SCHEMA_ROOT` 覆盖仍优先）；源根**部分在场**（schema 与文档只来其一）= 冻结面撕裂 → 构建失败。

**运行时契约**：`src/host/dsh-adapter/host/index.ts #resolveSchemaRoot` 自包内模块向上一级查找 `<pkg>/schema`（`common.schema.json` + `history/` + `declarative/` + `operational/` 可用性判定）——§2.1 的包根布局即解析契约；`DSH_RESEARCH_SCHEMA_ROOT` 覆盖优先（e2e 用工作区根正本指向，见 `scripts/e2e-run.sh` 的 `E2E_SCHEMA_ROOT`）。

**git 纪律（发布修订）**：发布期快照（8 文档 + `schema/` + `SNAPSHOT.md`）**提交进版本树**——git 安装（宿主 publish.md「build-script catch」）只取仓库树，冻结面必须随树交付，否则包启动即 `#resolveSchemaRoot` fail-loud（正本只存在于开发机工作区根）。工作区根仍是开发期唯一正本；`pnpm run build` 的逐文件 sha256 断言（本节第 3 条）保证入仓快照与正本恒内容一致（漂移即构建失败）。`lib/` 维持构建产物地位、不入版本树（git 安装由 `prepare` 构建）。

## 3. 安装流与构建脚本许可（pnpm `allowBuilds`）

三条发行通道，构建许可要求不同（宿主 publish.md「the build-script catch」）：

| 通道 | 命令 | 构建许可 |
|---|---|---|
| 本地 tarball | `dsh plugin --profile <p> add ./dsh-research-control-<v>.tgz` | **无**（预构建字节，不触发 prepare） |
| 本地/远程 git | `dsh plugin --profile <p> add <path>\|github:you/repo[#sha]` | **需要**：pnpm ≥10 拒绝执行 git 依赖的 `prepare`，首次 add 失败并打印包键；用户须把 `allowBuilds: {dsh-research-control: true}` 写进 **profile 的 `pnpm-workspace.yaml`** 并重跑 add（冻结面已随树入仓，`prepare` 只需构建 `lib/`） |
| npm 注册表 | `dsh plugin add dsh-research-control`（未来） | 无（`publish` 时 `prepare` 已构建；当前未公开发布） |

`prepare` = `tsdown && node scripts/snapshot-release.mjs`（与 `build` 同构），**自包含**：只依赖本树 `src/`/`e2e/` 与已安装的 devDependencies（pnpm 对 git 依赖默认装 dev 依赖），不假设兄弟 monorepo——对齐宿主 turtle-ui 先例；冻结面已提交进版本树，`prepare` 只需构建 `lib/` 入口，工作区根缺席时快照钩子跳过（§2 缺席语义）。安全语义必须如实告知用户：`allowBuilds` 是**在沙箱之外执行该包代码的安装期许可**，只放行信任的包并 pin commit。

## 4. 发布门禁冒烟（`pnpm run pack:verify`）

`scripts/pack-verify.mjs` 三步，任一违例即非零退出：

1. **pack**：插件根跑 `pnpm pack`（`prepare` 先构建 + 快照，tarball 恒为当前面）；
2. **清单核查**：`tar tzf` 全量条目——
   - 必须在（发布面完整）：`package.json`、`README.md`、`cordis.patch.yml`、`SNAPSHOT.md`、`lib/` 六个命名产物 + `client.js.map` + `rpc-contracts-*.js/.d.ts` 哈希双件、`schema/` ≥23 条目（含 common + 三个加载子目录锚点）、8 份根文档、`src/host/index.ts` + `src/client/index.tsx`（`./src/*` 面）；
   - 必须不在（开发私有零泄漏）：`node_modules/`、`tests/`、`e2e/`、`scripts/`、`test-results/`、`playwright-report/`、`.pnpm-store/`、`.npm-cache-tmp/`、`.git`、`*.tgz`、`*.tsbuildinfo`、`tsconfig.json`、`tsdown.config.ts`、`vitest.config.ts`、`pnpm-workspace.yaml`、`.gitignore`；
3. **解包冒烟**：解到临时目录，symlink 仓库 `node_modules` + 自链 `node_modules/dsh-research-control`（让裸说明符走 `exports` 映射），node 实 import：`.` default-export 必须是 service 类（`ResearchControlService`）、`./typert` 的 `TYPERT.invocations` 必须 23 条（22 RPC = 13 冻结 V1 + 9 plane 增量 + ping）、`./remote` contribution 必须 `{package, descriptors}`。失败时保留临时树路径供检查。

## 5. 标准发布顺序

```sh
pnpm install
npx tsc --noEmit          # 四件套 1：类型面
pnpm run lint             # 四件套 2：import 面（INV-PERM-5 等）
pnpm run build            # 四件套 3：lib/ + 发布期快照
pnpm test                 # 四件套 4：全单元/属性/集成（断言 lib 产物面）
pnpm run test:perf        # 性能门禁（TC-PERF-001..006）
pnpm run pack:verify      # 发布门禁：pack 清单 + 解包 import 冒烟
pnpm run test:e2e --reset # 真机循环（隔离 smoke home；--reset 显式重置种子面）
```

`test:e2e` 永远在隔离面运行（强制 smoke DSH_HOME、端口 3199、继承的 `DSH_HOME` 越界即 FATAL）；它自带 `build` + `pack` + 强制重链（`scripts/e2e-run.sh` 的 `build_and_install_plugin`），故对快照面变更自洽。
