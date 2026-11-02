#!/usr/bin/env python3
"""把植入缺口的答案标签从刺激语料中剥离（E1–E4 开跑前的强制脱敏步骤，可独立复跑）。
用法: python3 scrub-corpus.py <src_corpus_dir> <dst_dir>   # 输出目录必须在工作区内
脱敏后必须校验: 目标语料中 'GAP-' 残留行数 = 0，且 planted.json 的 location 仍逐字保留。"""
import json, glob, re, os, sys
src, dst = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 仓根
assert os.path.abspath(dst).startswith(os.path.abspath(ROOT) + os.sep), "输出目录必须在工作区内"
pat = re.compile(r'（?GAP-\d{2}[^）]*）?|GAP-\d{2}')
n = 0
os.makedirs(dst, exist_ok=True)
def scrub(o):
    global n
    if isinstance(o, str):
        o2 = pat.sub('', o)
        if o2 != o: n += 1
        return re.sub(r'\s{2,}', ' ', o2).strip(' ：:（）()')
    if isinstance(o, dict): return {k: scrub(v) for k, v in o.items()}
    if isinstance(o, list): return [scrub(v) for v in o]
    return o
for f in sorted(glob.glob(os.path.join(src, '*.jsonl'))):
    lines = []
    for l in open(f):
        l = l.strip()
        if l: lines.append(json.dumps(scrub(json.loads(l)), ensure_ascii=False))
    open(os.path.join(dst, os.path.basename(f)), 'w').write('\n'.join(lines) + '\n')
import shutil; shutil.copy(os.path.join(src, 'planted.json'), dst)
leak = sum(1 for f in glob.glob(dst + '/*.jsonl') for l in open(f) if 'GAP-' in l)
key_loc = sum(len(g['location']['refs']) for g in json.load(open(dst + '/planted.json'))['gaps'])
print(f'剥离含标签字符串 {n} 处 | 脱敏后 GAP- 残留行 {leak} | answer key 位置引用保留 {key_loc} 条')
assert leak == 0, '脱敏失败：刺激语料仍含答案标签，禁止开跑'
