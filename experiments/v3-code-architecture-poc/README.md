# V3 代码架构机制 PoC（侧车实验区）

> **状态词汇（不得互推）**：本区能声称的上限是 **POC VERIFIED**（机制假设被真实运行证明或证伪）。
> 它**不是** ARCHITECTURALLY SOUND 的全部含义、**不是** IMPLEMENTATION READY、
> 更**不是** PRODUCT READY；后两者不得由前者推出。
> 本区不改 V1 冻结契约、不改 `src/**` 生产逻辑、不碰生产 DB、不批准实施、不解锁 `LIVE_*`。

## 为什么存在

PR #44（`design/v3-code-architecture-review-20261027`）§13 列出 12 条"架构可执行检验"并明确声明
**均未作为新架构程序测试执行**；§15.1 收敛出 4 处必须先验证的边界。本区就是把它们变成可执行断言，
用**真实 SQLite**（`node:sqlite`，SQLite 3.53.4）而不是类型签名来回答"这样设计真的做得到吗"。

## 怎么跑

```bash
pnpm run test:poc:arch                                            # 48 例，全部跑真实 SQLite 文件
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json     # 本区独立类型门
```

根 `pnpm test` **不收集**本区（`vitest.config.ts` 排除 `experiments/**`）：侧车进度永不成为主门禁的
依赖。写入红线：只允许 `experiments/v3-code-architecture-poc/.poc-data/**`（`src/harness/paths.ts`
的 `assertInsidePocData` 强制，越界即抛）。

## 布局

| 路径 | 内容 |
| --- | --- |
| `src/contracts/` | 跨域协议：引用、空间、Storage Port、插件清单、拒绝码封闭集（**无校验词汇**，见 CONTRACTS.md §11 F-06） |
| `src/kernel/` | 业务无知的机制层：注册表、UoW、目录、命名空间写入器、中性呈现、影响候选、双时间读、投影 |
| `src/storage-sqlite/` | 真实驱动 + 不可变性触发器 + 驱动错误翻译 |
| `src/domains/` | **测试专用合成策略**（五类对象一律用 `test.*` 占位 kind；文件头声明不得当作科研政策） |
| `src/harness/` | 装配根：一个 ResearchSpace = 一个 SQLite 文件；授权表默认为空 |
| `tests/` | P1 存储与事务 / P2 身份与插件演化 / P3 接纳与校验 / P4 读取与隔离 / 架构独立性硬门 |
| `attacks/<审查轴>/` | 阶段 D 对抗审查员新建的攻击测试（其失败本身就是 finding） |
| `KERNEL_SURFACE.sha256` | Kernel+契约的**面基线**：加领域插件必须不变；改 Kernel 必须显式重生成并说明理由 |
| `RECONCILIATION.md` | 阶段 A：Q1–Q45 × PR #42 条文 × 机制的对账（含被证伪的编号清单） |
| `CONTRACTS.md` | 阶段 C：由实测反推的契约修订（F-01…F-09）+ 已选/已拒 + 替换代价 |
| `EVIDENCE.md` | 阶段 B/E：命令、SHA、退出码、门禁输出 |
| `REVIEW.md` | 阶段 D：独立对抗审查与处置 |
| `ASSESSMENT.md` | 阶段 E：最终评估与就绪结论 |

## 三条不可让步的纪律（由测试把守，不靠自觉）

1. **Kernel 不含科研语义判定规则**——`tests/arch-independence.test.ts` 对 `src/kernel/**` 与
   `src/contracts/**` 做剥注释后的词汇扫描 + 依赖方向扫描 + 面哈希；每条扫描都配变异锚点。
2. **权威唯一**——重复能力、重复 kind 拥有者、第二个领域事件权威 ⇒ 装配期拒绝。
3. **历史真源唯一**——`ledger` 由触发器不可变；`journal` 可压缩，且实测证明单独重放 Journal
   不足以重建历史（`p4` 的缺口用例：Journal 重放只得 1 条而权威记录有 2 条）。
