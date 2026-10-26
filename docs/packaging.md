# 打包与发布（packaging runbook）

本文件是插件仓的打包真源：`package.json` 的 `files`/`scripts`/`dsh` 面、仓内契约正源与发布清单（AD-EB-01）、安装流的零构建脚本设计（预构建 `lib/` 随树提交，pnpm `allowBuilds` 不需要）、发布门禁冒烟（`pack:verify`）的操作与判定细节。面向维护者；用户安装流程见 [../README.md](../README.md)。

> 冻结契约依据：ARCHITECTURE §2.1（目录结构·冻结目标——包根 8 文档 + `schema/` 的交付形态）；SI-001（裁决书原件不可访问 = UNKNOWN 缺口；其发布期复制半边已被 **AD-EB-01** 取代——`docs/engineering-baseline/`）；DSH_ADAPTER §3（packaging runbook：`dsh` 字段、安装流、`files` 面、安装流零构建脚本注意）；宿主发布教程 `deepseek-harness/docs/user/develop/basic/publish.md`（「Installing from GitHub: the build-script catch」——本包以预构建 `lib/` 随树提交 + 无安装期构建脚本的设计使其不适用）。

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

## 2. 仓内契约正源与发布清单（`scripts/snapshot-release.mjs`；AD-EB-01）

**政策**（AD-EB-01，用户 2026-10-26 批准；Gate 记录 `docs/engineering-baseline/gates/`，批准基准哈希清单 `G0-inventory.yaml`）：**本仓库**根目录的 8 份契约文档 + `schema/**` 是唯一可编辑的契约正源，随 Git 版本化；构建对仓外路径**零读零写**。这是对 SI-001 发布期复制机制的有控制替换——首次迁移**原字节**切换权威（31 文件逐文件哈希与批准基准一致，回归测试 `tests/engineering/eb1-canonical.test.ts` V7 锁死），契约域语义零修改。

**执行**（`build` 的 `tsdown` 之后挂钩 = VERIFY，零写入）：

1. 冻结面在位检查：`schema/common.schema.json` 锚点 + 全部 `schema/**` + 8 份根文档，缺席 = `CONTRACT_SURFACE_MISSING`；
2. `SNAPSHOT.md` ↔ 文件树**双向**逐文件 sha256：哈希漂移、清单有树无、树有清单无，任一 = `CONTRACT_DRIFT` 构建失败；
3. `SNAPSHOT.md` = **确定性发布清单**（生成物，非第二正源；无时间戳、无机器绝对路径，两次 `--update` 逐字节相同）。合法冻结修订 = 改契约文件 + `pnpm run snapshot:update` + 契约与清单同一提交评审；
4. `DSH_SNAPSHOT_SOURCE_ROOT` 退役：设置为任何值 = `EXTERNAL_SOURCE_RETIRED` 直接失败（旧调用方不能悄悄复活仓外写入源）；
5. **产物新鲜度**：`scripts/check-build-freshness.mjs`（`check:freshness`，`pack:verify` 已接入）比较已提交 `lib/` 等工件与当前构建，实质差异 = `LIB_STALE`；唯一归一化 = tsdown 的 `//#region \0rcm-css:<构建机路径>` 注释噪声（AGENTS.md §4）。

**运行时契约**（不变）：`src/host/dsh-adapter/host/index.ts #resolveSchemaRoot` 自包内模块向上一级查找 `<pkg>/schema`（`common.schema.json` + `history/` + `declarative/` + `operational/` 可用性判定）——§2.1 的包根布局即解析契约；`DSH_RESEARCH_SCHEMA_ROOT` 显式部署覆盖优先（G0 的测试根契约 `scripts/resolve-e2e-schema-root.sh` 亦指向仓内 `schema/`）。

**git 纪律**：契约面 + `SNAPSHOT.md` + 预构建 `lib/` 提交进版本树——git 安装（宿主 publish.md「build-script catch」）只取仓库树，必须随树交付。`lib/` 新鲜度自 EB1 起是**机器门**（上文第 5 条），不再是「记得 build 后 push」的口头纪律。

**历史**（superseded）：SI-001（裁决书原件不可访问，缺口已按 `docs/BASELINE_INDEX.md` 登记 UNKNOWN）裁定的「工作区根开发期正本 + 构建期父目录复制 + 0444/0555 只读 + 源根缺席 loud-skip」由旧版脚本执行。EB0 实测该机制在**部分污染**的父目录（schema 只来其一）下会静默清空包内 `schema/` 并 exit 0（PoC 记录 `docs/engineering-baseline/gates/G1.md`）——这正是退役理由。「不要在包根编辑快照」旧纪律由「仓内正源经冻结变更流程编辑」取代。

## 3. 安装流与零构建脚本（`allowBuilds` 不需要）

三条发行通道，**全部零构建许可**（V2 发布批次修订：`prepare` 已移除，`lib/` 预构建随树提交；宿主 publish.md「the build-script catch」对本包不再适用）：

| 通道 | 命令 | 构建许可 |
|---|---|---|
| 本地 tarball | `dsh plugin --profile <p> add ./dsh-research-control-<v>.tgz` | **无**（预构建字节，零安装脚本） |
| 本地/远程 git | `dsh plugin --profile <p> add <path>\|github:you/repo[#sha]` | **无**：版本树含冻结面 + 预构建 `lib/`，包内无任何安装期构建脚本，pnpm 零脚本执行直接成功 |
| npm 注册表 | `dsh plugin add dsh-research-control`（未来） | 无（当前未公开发布） |

**新鲜度纪律（维护者义务）**：每次推送 / 打包前必须先 `pnpm run build`（先编译后推送）；发布门禁跑 `pack:verify` 复核产物面。开发期 `pnpm install` 不再自动构建 `lib/`，显式 `pnpm run build` 刷新。

**git 安装建议**：pin commit（`github:you/repo#<sha>`）——git 安装直接消费版本树内容，pin 住 sha 避免后续推送静默改变运行代码。

## 4. 发布门禁冒烟（`pnpm run pack:verify`）

`scripts/pack-verify.mjs` 三步，任一违例即非零退出：

1. **pack**：插件根跑 `pnpm pack`（**先 `pnpm run build`** 保证 `lib/` + 快照为当前面，tarball 恒含预构建产物，零安装脚本）；
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
