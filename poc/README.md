# HSR Schema PoC（A 段，刻意最小）

回答一个问题：**PR #42 / #47 的形态与校验规则能否同时成立**。不是产品代码，
不接正式研究数据，不碰 V1 冻结接口，不含持久化与服务层，不上 S-L2/L3。

```sh
node --test poc/hsr-form/poc1-form.poc.mjs poc/hsr-form/poc2-identity.poc.mjs poc/hsr-form/poc3-check.poc.mjs
```

| 单元 | 覆盖 | 结果 |
| --- | --- | --- |
| `poc1-form.poc.mjs` | 真实最小合法形态（SF-22 文法 + 整数版本 + 无回显键）、**五态逐态键集正反例矩阵**、空集合正负、稀疏展开、拒写封闭五项、候选载荷、变异体分辨力 | 10/10 |
| `poc2-identity.poc.mjs` | 根世界单例与受控豁免、§4.1 四行与首次登记/生命周期正反例对、身份变化分流、退役码边界、摘要重放、三个变异断言 | 25/25 |
| `poc3-check.poc.mjs` | RPT-02 归约 + `SCR-77` 零覆盖、三个排除集分离、`S` 常量逐键穷举（两页长）、隐藏 finding、分页真相、写入幂等跨重启 | 12/12 |

**独立审查（基线 `da113bcd`）判 ITERATE 之后**：七条缺陷全部复现成立并修好，核心按规则原文重写；
`FINDINGS-review.md` 是"哪条规则 / 原文怎么说 / 当时怎么做 / 现在怎么钉住"的反查表。

判据实现集中在 `hsr-form/core.mjs`，**每条注明对应的文档规则号**，便于反查忠实度；
`FINDINGS-pocN.md` 是产出本体——PoC 的价值在发现，不在绿灯数。

## 命名说明

文件名用 `.poc.mjs` 而非 `.test.mjs`：vitest 的默认 include 会匹配 `**/*.test.mjs`，
用后者会把这些 `node:test` 用例收进 `pnpm test` 并以 vitest 语义执行。已实测
`poc/**` 不被 vitest 收集（见 FINDINGS 附注），因此本目录不改变仓内测试面。
