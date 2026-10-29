# HSR Schema PoC（A 段，刻意最小）

回答一个问题：**PR #42 / #47 的形态与校验规则能否同时成立**。不是产品代码，
不接正式研究数据，不碰 V1 冻结接口，不含持久化与服务层，不上 S-L2/L3。

```sh
node --test poc/hsr-form/poc1-form.poc.mjs poc/hsr-form/poc2-identity.poc.mjs poc/hsr-form/poc3-check.poc.mjs
```

| 单元 | 覆盖 | 结果 |
| --- | --- | --- |
| `poc1-form.poc.mjs` | 五态标签值、空集合正负、稀疏展开、拒写封闭五项、候选载荷 | 7/7 |
| `poc2-identity.poc.mjs` | 根世界单例与受控豁免、结论×构造状态四行、身份变化分流、退役码边界、摘要重放 | 21/21 |
| `poc3-check.poc.mjs` | RPT-02 归约、摘要排除集、两世界差分与恒定面、分页真相、幂等重放 | 10/10 |

判据实现集中在 `hsr-form/core.mjs`，**每条注明对应的文档规则号**，便于反查忠实度；
`FINDINGS-pocN.md` 是产出本体——PoC 的价值在发现，不在绿灯数。

## 命名说明

文件名用 `.poc.mjs` 而非 `.test.mjs`：vitest 的默认 include 会匹配 `**/*.test.mjs`，
用后者会把这些 `node:test` 用例收进 `pnpm test` 并以 vitest 语义执行。已实测
`poc/**` 不被 vitest 收集（见 FINDINGS 附注），因此本目录不改变仓内测试面。
