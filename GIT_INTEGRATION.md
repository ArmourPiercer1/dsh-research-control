# GIT_INTEGRATION.md - Git 集成规范（允许 / 禁止 / 流程 / 错误处理）

> 文档状态：**Frozen V1**（2026-08-22 冻结；含独立审计修订 A-18（W13 预补），追溯见计划书 §40 附录）
> 上游：计划书 §21（Git 版本管理架构）、§22（Workspace Audit）、§11.3/§21.9（blob OID）、§30.1（安全）
> 关联：`ARCHITECTURE.md` §5.8（INV-GIT-\*）、`PLAN_FORK_SPEC.md` §3/§5、`TEST_MATRIX.md` TC-GIT-\*
> 核心立场：**Git 是声明式状态（`.research/`）的唯一版本真源；插件是 Git 的谨慎消费者，绝不越权代替用户操作仓库。**

---

## 1. 安全铁律（总则）

1. **不静默 `git init`**：非 Git repo 的目录拒绝进入 managed research mode；仅提供显式 GUI 操作「Initialize Git Repository」（INV-GIT-1）；
2. **不静默 commit**：默认任何插件行为都不产生 commit；唯一的写历史操作是用户显式触发的 Save Research Checkpoint（INV-GIT-2）；
3. **路径隔离**：插件提交只含 `.research/**`，绝不包含用户其他 staged changes（INV-GIT-3）；
4. **冲突状态 fail loud**：merge/rebase/cherry-pick 进行中禁止插件自动提交（INV-GIT-4）；
5. **restore 显式触发**：恢复产生新 working copy，不改写 Git 历史（INV-GIT-5）；
6. **argv API**：所有 Git 命令以参数数组 spawn，禁止拼接 shell 字符串（INV-GIT-6）；
7. **无网络/历史改写操作**：push/pull/fetch/merge/rebase/reset/clean/stash/branch -D 等一律禁止（INV-GIT-7）；
8. **不自建版本表**：无 PlanRevision/ContractRevision/TopologyRevision；diff/history/restore 全部调 Git（INV-GIT-8）；
9. 所有 Git 调用带超时（默认 10s，可配）与输出大小上限，超时即 kill 并按错误处理。

## 2. 仓库检测与注册

注册 Research Workspace 时（用户在 GUI 选择目录）：

```text
argv: git -C <candidate-root> rev-parse --show-toplevel
```

- 成功 -> 返回 repo 根；`.research/` 必须位于该根下（建议 workspace root = repo root，`workspace.yaml` 记录相对关系）；
- 失败（exit ≠ 0）-> 拒绝 managed mode，提示用户：「该目录不是 Git 仓库」，可选显式操作 `git init`（**仅**经用户点击，init 命令本身也走 argv API）；
- `git` 可执行缺失 -> 同样拒绝，提示安装 Git。

## 3. 操作白名单

「触发」列：**自动** = 插件内部逻辑可随时调用；**用户** = 仅用户显式动作（GUI 按钮/确认）可触发。

| # | 操作 | argv（相对 repo 根） | 用途 | 触发 |
|---|---|---|---|---|
| W1 | 仓库检测 | `git rev-parse --show-toplevel` | 注册/启动校验 | 自动 |
| W2 | git dir 定位 | `git rev-parse --git-dir` | 冲突状态检测前置 | 自动 |
| W3 | blob OID 计算 | `git hash-object -- <path>` | PlanFork closure 基准与 stale 检测 | 自动 |
| W4 | 工作区状态 | `git status --porcelain=v2 [--branch]` | audit（strict tracked 层）、checkpoint 前置检查 | 自动 |
| W5 | 变更清单 | `git diff --name-status [<baseline>]` | audit：已跟踪文件修改 | 自动 |
| W6 | 文件历史 | `git log --format=<fmt> [--] <path>` | Plan/Contract/Topology 历史列表 | 用户（查看） |
| W7 | 历史版本内容 | `git show <commit>:<path>` | 查看历史版本 | 用户（查看） |
| W8 | 恢复文件 | `git restore --source=<commit> -- <path>` | 从历史恢复声明式文件 | **用户** |
| W9 | 暂存 | `git add -- .research/` | checkpoint 第一步 | **用户**（checkpoint） |
| W10 | 检查点提交 | `git commit -m <msg> -- .research/` | checkpoint 第二步 | **用户**（checkpoint） |
| W11 | 取提交 OID | `git rev-parse HEAD` | checkpoint 后记录 | **用户**（checkpoint） |
| W12 | 显式初始化 | `git init` | 非 repo 目录的用户显式选择 | **用户**（确认对话框） |
| W13 | 枚举 tracked 文件 | `git ls-files -- <pathspec>` | audit：判定 strict tracked 路径集内的删除/缺失（Phase 6） | 自动 |

说明：

- W6 格式串建议：`%H%x1f%aI%x1f%s`（OID、作者时间、标题，单元分隔符 `\x1f` 便于解析）；
- W7/W8 的 `<path>` 必须是相对 **repo 根**的路径（`.research/...`）；若 workspace root ≠ repo root，插件负责前缀换算；
- W8 默认只动 working tree（不带 `--staged`/`--worktree` 之外的破坏性参数）。

## 4. 禁止操作清单

`init`（除 W12 显式入口）、`add`（除 W9 的 `.research/` pathspec）、`commit`（除 W10）、`push`、`pull`、`fetch`、`clone`、`merge`、`rebase`、`cherry-pick`、`revert`、`reset`、`checkout`/`switch`（分支切换）、`clean`、`stash`、`rm`、`mv`、`reflog`、`gc`、`filter-branch`、`update-ref`、任何 `-x`/`--exec`、任何强制参数（`--force`、`-f`）。

## 5. Save Research Checkpoint 流程（唯一写历史操作）

```text
用户点击 Save Research Checkpoint
  │
  ├─ 1. 冲突状态检测（见 5.1）；检测到 -> 拒绝并提示用户先自行解决
  ├─ 2. git status --porcelain=v2：汇总 .research/** 的待提交变更；无变更 -> 直接返回「无可提交内容」（成功，不报错）
  ├─ 3. git add -- .research/                          # 只暂存 .research 路径
  ├─ 4. git commit -m "research: <动作摘要>" -- .research/   # pathspec 限定提交范围
  ├─ 5. git rev-parse HEAD -> 记录 commit OID
  └─ 6. 写 ManagementAction(CHECKPOINT_SAVED, git_commit_oid, git_blob_oids)
```

规则：

- commit message 格式：`research: <摘要>`（如 `research: select PF-17 for WS-3`）；
- 提交者身份使用用户自己的 git config，插件不覆盖 author/committer；
- **不包含**用户其他 staged changes（§5.2 实测验证）；
- **不修改**用户其他 staged 状态（实测：pathspec commit 后用户原 staged 条目保持 staged）；
- detached HEAD 状态：允许但给出明确警告（提交会落在游离 HEAD 上，可能被丢弃）；
- 步骤 3-4 中断（进程被杀等）：最坏结果是 `.research/` 变更停留在 staged 状态，用户可自行 `git restore --staged` 或再次 checkpoint；不会损坏仓库。

### 5.1 冲突状态检测（每次 checkpoint 前必须执行）

```text
git rev-parse --git-dir  ->  <gitdir>
存在以下任一项即判定「仓库处于进行中操作」，拒绝 checkpoint：
  <gitdir>/MERGE_HEAD          merge 进行中
  <gitdir>/CHERRY_PICK_HEAD    cherry-pick 进行中
  <gitdir>/REVERT_HEAD         revert 进行中
  <gitdir>/rebase-apply/       rebase (apply) 进行中
  <gitdir>/rebase-merge/       rebase (merge) 进行中
```

双保险：即便检测遗漏，git 本身也会拒绝（实测：merge 进行中执行 pathspec commit 返回 `fatal: cannot do a partial commit during a merge.`，exit 128）。

### 5.2 实测行为记录（2026-08-21，git 通用版本，临时 repo 验证）

以下行为已在临时仓库逐一验证，测试矩阵 TC-GIT-\* 将固化为自动化用例：

| 行为 | 实测结果 |
|---|---|
| `git add -- .research/` + `git commit -m msg -- .research/`（存在无关 staged 修改 + 新增未跟踪 .research 文件） | commit 只含 `.research/` 的修改与新增；无关 staged 修改**未**进入 commit，且事后仍保持 staged |
| `.research/` 无变更时执行 pathspec commit | 失败 exit 1（"no changes added to commit"）-> 流程步骤 2 前置短路，视为成功空操作 |
| merge 冲突进行中的 pathspec commit | `fatal: cannot do a partial commit during a merge.`，exit 128 |
| `git hash-object -- <file>` 与 `git rev-parse HEAD:<file>` | 内容相同时 OID 完全一致；文件修改后 OID 改变（stale 检测的正确性基础） |
| `git restore --source=<commit> -- <path>` | working tree 恢复为历史版本，index/历史不受影响 |
| detached HEAD 下 `git log -- <path>` / `git show <commit>:<path>` | 正常工作 |
| `git rev-parse --git-dir` + 标志文件检测 | merge 状态下 MERGE_HEAD 存在；正常状态五个标志全部缺失 |

## 6. 历史查看与 Restore（W6/W7/W8）

查看（任意声明式文件）：

```text
git log --format=%H%x1f%aI%x1f%s -- .research/topics/TPC-1/workstreams/WS-1/plan.yaml
git show <commit>:.research/merges/TE-17/contract.md
```

恢复（**用户显式**选择某历史版本）：

```text
git restore --source=<commit> -- <path>
```

- 恢复产生**新的 working copy 状态**，不修改旧 commit、不产生新 commit（提交与否由用户随后决定）；
- 恢复后触发该文件的 schema 校验（非法内容 -> 警告并保留文件原状供用户处理，不静默回滚）；
- 记录 `ManagementAction(RESTORE_PERFORMED)`；
- `.research/` 目录外的路径不允许通过本插件 restore。

## 7. PlanFork stale 检测的 hash-object 用法（W3）

```text
对 plan closure 中每个文件：
  git hash-object -- .research/.../plan.yaml
  git hash-object -- .research/.../items/tasks/T-1.yaml
  ...
得到 { path, git_blob_oid }[] 作为 PlanFork 的 base_plan_objects
```

要点（PLAN_FORK_SPEC §3/§5）：

- `hash-object` 对 **working copy 内容**计算，无需 commit -> stale 检测不依赖用户 commit 频率；
- closure = `plan.yaml` + ordered_items 引用的全部 G/T/M 定义文件；
- 比较为集合比较：路径集合变化（增删定义文件）或任一同路径 OID 变化均判 STALE；
- 相同内容重写文件（无实质变化）OID 不变，不误报。

## 8. Workspace Audit 集成（计划书 §22）

三层扫描对 Git 的使用：

| 层 | 数据源 | Git 命令 |
|---|---|---|
| Strict tracked resources | 关键代码 / Task deliverables / 注册 Artifact / merge 相关文件 | `git status --porcelain=v2`（未提交修改）、`git diff --name-status`（已暂存/未暂存变更）、`git diff <baseline>`（对比基线）、`git log`（何时变更） |
| Discovery zones | results/ docs/ figures/ 等目录 | 文件系统扫描 + `git status` 的 untracked 标记辅助；发现未注册产物 -> Inbox（UNREGISTERED_WORKSPACE_CHANGE） |
| Ignored / ephemeral | cache/build/tmp 等 | 不扫描（workspace.yaml `audit.ignored`） |

边界：audit 只回答「工作区发生了哪些插件尚未登记的变化」，**不推断科研含义**；reconciliation 三档（AUTO_RECONCILE / PROPOSE_RECONCILIATION / ESCALATE）不改写历史。

## 9. 错误分类与处理

| 错误条件 | 检测方式 | 处理 |
|---|---|---|
| Git 可执行缺失 | spawn ENOENT | 功能降级：拒绝 managed mode / 禁用 checkpoint；明确提示安装 Git |
| 目录不是 Git repo | W1 exit ≠ 0 | 拒绝注册；提供显式 init 入口 |
| detached HEAD | `git status --porcelain=v2 --branch` 的 `branch.head (detached)` | 读操作正常；checkpoint 前警告 |
| merge/rebase/cherry-pick 进行中 | §5.1 标志文件 / git 自身拒绝 | 拒绝 checkpoint，提示用户先解决 |
| `.research/` 有未提交变更时执行读操作 | 正常情形 | 不阻塞；读 working copy（canonical current state 就是 working copy） |
| `.research/` 手工编辑致文件非法 | schema 校验失败 | 拒载该文件并精确定位（文件+字段）；其余文件正常 |
| 命令超时（默认 10s） | 计时 kill | 报「Git 操作超时」，不重试自动写操作 |
| 输出超大（如 log 列表） | 字节上限截断 | 分页读取（`-n <count> --skip`） |
| repo 损坏（git 自身报错） | 任意命令异常退出 + stderr 特征 | 原样展示 git 错误；插件不尝试修复 |
| 用户 staged 了 `.research/` 之外我们也要读的文件 | - | 读操作无影响；从不 unstage 任何内容 |

## 10. 契约总结（实现 checklist）

- [ ] `git/` 层是唯一 spawn git 的代码位置；导出的每个函数对应白名单一行；
- [ ] 全部 argv 数组调用 + 超时 + 输出上限；
- [ ] checkpoint 实现严格按 §5 步骤与短路规则；
- [ ] 冲突检测在 checkpoint 前必执行（双保险）；
- [ ] restore 仅 `.research/**` + 仅用户触发 + 恢复后 schema 校验；
- [ ] TC-GIT-\* 全部场景（TEST_MATRIX §3.3）有自动化覆盖。
