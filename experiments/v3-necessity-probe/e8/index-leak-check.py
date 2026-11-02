#!/usr/bin/env python3
"""装置自检：索引的某个字段（或字段组合）能否单独把靶案分流出来。
用在前：任何"贫索引 vs 富索引"对照，必须先过这道自检——否则操纵条件会被索引里的
旁路信息抵消（E8 实测：靶案是单日会话，仅凭 t 即可 12/12 全命中，"差索引"条件失效）。"""
import json, sys, collections
rig, tgt_file = sys.argv[1], sys.argv[2]
tgt = set(json.load(open(tgt_file)))
idx = json.load(open(f"{rig}/INDEX.json"))
fields = [k for k in idx[0] if k != "id"]
def seg(keys, name):
    g = collections.defaultdict(set)
    for r in idx: g[tuple(str(r[k])[:10] for k in keys)].add(r["id"])
    best = max(g.items(), key=lambda kv: len(kv[1] & tgt))
    hit, size = len(best[1] & tgt), len(best[1])
    purity = hit / size if size else 0
    flag = "  ← 泄漏：仅凭该字段即可分流靶案" if purity >= 0.9 and hit >= 0.8 * len(tgt) else ""
    print(f"  {name:28s} 最优组命中靶案 {hit}/{len(tgt)}，组内纯度 {purity:.0%}{flag}")
print(f"装置 {rig}（{len(idx)} 条，靶案 {len(tgt)} 条）")
for f in fields: seg([f], f)
if len(fields) > 1: seg(fields, "全部字段组合")
