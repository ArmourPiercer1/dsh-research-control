# RE-REVIEW R5–R8：作者自述修复独立复验

状态：**完成**
席位：独立复验席（只允许新建 `attacks/review/` 下文件）
仓库：`dsh-research-control`，目标 `experiments/v3-code-architecture-poc/`
基线：**已核** HEAD=570723d，`30afe91` 为祖先（`git merge-base --is-ancestor` 通过）

## 判定口径

- **真修好**：本席独立攻击实测封死，证据为本次攻击的运行结果。
- **不完全**：声称的封死存在但留有可枚举的缝（列出缝与复现）。
- **只是变绿**：测试变绿来自断言改写/记录现状/过时断言，而非行为修复；或声称与代码不符。

## 待复验清单

1. S-0 读句柄：`guardRead()` 只放 SELECT/WITH + 禁多语句（RAW_SQL_REFUSED）；三表触发器禁 UPDATE/DELETE
2. S-1 coverage 不驱动结论：synthReduce 忽略 coverage；Coverage 封闭三值；核实"剩 1 条绿=过时断言"声明
3. S-3 报告自身身份：recordReport 事务内写 records；找"不入 records 仍被引用/计数"的路径
4. S-2/F-24 空集可归因：找第四种把"空"伪装成"没有"的成因；复核 D-12（计数不抗探测）
5. S-4 HARD_REF_NOT_PINNED 位置主张实测（幽灵/存在但被修订/record-ref 三种目标）
6. S-7/S-8 XC-28 可检测性：真可检测性 vs "作者写的规则会触发"；缺省空视图是否被误当通过
7. 附加：`tests/stopline-vocabulary` B 条红转绿的"计数假象"叙述核对（F-31 仍开放）

## 各项结论

（逐项追加，完成后更新此处）
