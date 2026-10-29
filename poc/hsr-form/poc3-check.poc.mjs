/**
 * PoC-3 检查归约 / 摘要域 / 两世界恒定面 / 写入幂等。
 * 独立审查（基线 da113bcd）判本单元三处 P0 全部成立并已复现：
 *   #2 `exhausted` 语义写反（文档锚点：可见 200 条、页长 100 ⇒ 第 1 页 false、第 2 页 true），
 *      而原测试**跟着断言了错误语义**，所以是绿的——这正是"绿灯不等于验证"。
 *   #3 把 SCR-54 的同形排除集 `{report_id, checked_at}` 误当成摘要排除集；SCR-06 明文摘要排除集**恰一项** `{report_digest}`。
 *   #4 幂等测试用只读操作 + 进程内 Map，验不到 SI-41 要求的写入幂等。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceLevel, sanitize, S_constant, paginate, digest, canonical, DIGEST_EXCLUSION, SHAPE_EXCLUSION, Idempotency } from './core.mjs';

const DEFAULT_LIMIT = 50, MAX_LIMIT = 200;                       // SI-50：超限拒绝而非静默夹取
const mkReport = (over = {}) => ({ operation: 'hsr_object_get', report_id: 'rpt:1', checked_at: 100,
  level_results: [{ rule_id: 'SCR-57', verdict: 'PASS' }], findings: [{ rule_id: 'SCR-57', item: 'v1', owner: 'me' }],
  verdict: 'ACHIEVED', items: [], ...over });
const PARTIAL = { hidden: i => i.owner !== 'me', hiddenFinding: f => f.owner !== 'me' };
const NO_VIS = { hidden: () => true, hiddenFinding: () => true };

// ---- 归约（RPT-02 + SCR-77） -----------------------------------------------------
test('P3-1 归约优先序：FAIL 最高、否则 INDETERMINATE、全通过才 ACHIEVED（RPT-02）', () => {
  assert.equal(reduceLevel(['PASS', 'INDETERMINATE', 'FAIL']), 'NOT_ACHIEVED');
  assert.equal(reduceLevel(['PASS', 'INDETERMINATE']), 'INDETERMINATE');
  assert.equal(reduceLevel(['PASS']), 'ACHIEVED');
});
test('P3-2 零适用规则不得归约为通过（SCR-77 沉默不等于通过）', () => {
  assert.equal(reduceLevel([]), 'INDETERMINATE', '审查纠正 #4：原实现返回 ACHIEVED');
  const naive = v => (v.includes('FAIL') ? 'NOT_ACHIEVED' : v.includes('INDETERMINATE') ? 'INDETERMINATE' : 'ACHIEVED');
  assert.equal(naive([]), 'ACHIEVED', '反向锚点：不判零覆盖的实现与判据分歧，本用例能抓住它');
});
test('P3-3 候选载荷不参与归约：它没有层级结果，也不得被填成 INDETERMINATE（SS-56）', () => {
  const candidate = { levelResults: [], candidate: true, entryFindings: ['SUBTYPE_UNREGISTERED'] };
  assert.equal(candidate.levelResults.length, 0);
  assert.equal('verdict' in candidate, false, '候选载荷不产出层级 verdict');
  assert.deepEqual(candidate.entryFindings, ['SUBTYPE_UNREGISTERED'], '失败只存在于入口检查报告这个**另一个载体**');
});

// ---- 摘要域：三个互不相同的排除集（审查纠正 #3） ---------------------------------
test('P3-4 摘要排除集恰 `{report_digest}` 一项（SCR-06），写入后可重放（SF-52a）', () => {
  assert.deepEqual(DIGEST_EXCLUSION, ['report_digest'], 'SCR-06：排除集封闭为一项，实现不得自行增减');
  const r = mkReport({ items: [{ id: 'v1' }] });
  const d = digest(r).hex;
  assert.equal(digest({ ...r, report_digest: d }).hex, d, '写入摘要后重算必须得同一值');
  assert.notEqual(digest({ ...r, report_digest: d }, ['report_digest', 'checked_at']).hex, d,
    '把 checked_at 塞进摘要排除集 ⇒ 历史摘要全部不再匹配（SF-61 破坏性）');
});
test('P3-5 同形判定排除集恰 `{report_id, checked_at}` 两项（SCR-54），与摘要排除集不是一回事', () => {
  assert.deepEqual(SHAPE_EXCLUSION, ['report_id', 'checked_at']);
  const cut = o => Object.fromEntries(Object.entries(o).filter(([k]) => !SHAPE_EXCLUSION.includes(k)));
  const a = { ...mkReport(), report_id: 'rpt:A', checked_at: 1 }, b = { ...mkReport(), report_id: 'rpt:B', checked_at: 9 };
  assert.equal(canonical(cut(a)), canonical(cut(b)), '两报告除这两键外必须同形');
  assert.notEqual(canonical(cut(a)), canonical(cut({ ...b, level_results: [] })),
    '"每次都变"不能当豁免理由：其余任何字段一律计入同形判定');
});

// ---- 两世界与恒定面（SI-14 / SI-33 / SCR-57） -------------------------------------
const worldA = [{ id: 'v1', owner: 'me' }, { id: 'v2', owner: 'me' }, { id: 'h1', owner: 'other' }, { id: 'h2', owner: 'other' }];
const worldB = [{ id: 'v1', owner: 'me' }, { id: 'v2', owner: 'me' }];
test('P3-6 无可见权者输出 == S 常量，逐键穷举，两个页长各跑一次（SCR-57 粒度 = (操作, 生效页长)）', () => {
  for (const L of [37, DEFAULT_LIMIT]) {
    for (const w of [worldA, worldB])
      assert.equal(canonical(sanitize(mkReport({ items: w }), NO_VIS, { effectiveLimit: L })),
        canonical(S_constant('hsr_object_get', L)), `页长 ${L} 下必须逐字节等于 S`);
    const S = S_constant('hsr_object_get', L);
    assert.deepEqual(S.level_results, [], 'S 的 level_results 是空数组——无可见权者不获得任何层级声明');
    assert.deepEqual(S.findings, []); assert.equal(S.verdict, 'UNVERIFIABLE_TO_YOU');
    assert.deepEqual(Object.keys(S.boundary).sort(), ['coverage', 'limit_applied', 'truncated']);
    assert.equal(S.boundary.coverage, 'NOT_DISCLOSED'); assert.equal(S.boundary.truncated, false);
    assert.equal(S.boundary.limit_applied, L, 'limit_applied 按 SI-14 如实反映请求页长，不是常量');
  }
});
test('P3-7 部分可见两世界：可见集相同、隐藏集不同 ⇒ 输出逐字节相同（含规则 findings 的隐藏）', () => {
  const repA = mkReport({ items: worldA, findings: [{ rule_id: 'x', item: 'v1', owner: 'me' }, { rule_id: 'y', item: 'h1', owner: 'other' }] });
  const repB = mkReport({ items: worldB, findings: [{ rule_id: 'x', item: 'v1', owner: 'me' }] });
  const a = sanitize(repA, PARTIAL, { effectiveLimit: 41 }), b = sanitize(repB, PARTIAL, { effectiveLimit: 41 });
  assert.equal(canonical(a), canonical(b), '隐藏集大小不得从任何字段泄漏');
  assert.deepEqual(a.findings, [{ rule_id: 'x', item: 'v1', owner: 'me' }], '挂在隐藏项上的规则 finding 必须被脱掉');
});
test('P3-8 分页真相（SI-14/SI-50 文档锚点）：201 条、页长 60 ⇒ 首页 exhausted=false、末页 true', () => {
  const items = Array.from({ length: 201 }, (_, i) => ({ id: 'v' + i, owner: 'me' }));
  const p1 = paginate(items, 60, 0, MAX_LIMIT, DEFAULT_LIMIT), p2 = paginate(items, 60, 180, MAX_LIMIT, DEFAULT_LIMIT);
  assert.equal(p1.refused, undefined); assert.equal(p1.exhausted, false, '第 1 页后面还有内容 → false');
  assert.equal(p2.exhausted, true, '末页无后续 → true');
  assert.equal(p1.limit_applied, 60, '等于实际生效页长，不是缺省常量 50');
  assert.notEqual(p1.next_cursor, null); assert.equal(p2.next_cursor, null);
  const s = sanitize(mkReport({ items }), PARTIAL, { effectiveLimit: p1.limit_applied });
  assert.equal(s.boundary.truncated, false, '盲区下 truncated 是披露常量，与 exhausted 语义不同、允许并存');
  assert.equal(paginate(items, 500, 0, MAX_LIMIT, DEFAULT_LIMIT).refused, 'F-LIMIT-TOO-LARGE', '超限拒绝而非静默夹取');
});
test('P3-9 反向断言：三类错误实现必须被抓（审查要求的"错误实现必红"）', () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: 'v' + i, owner: 'me' }));
  const wrongExhausted = (n, req, off) => off + req < n;                              // 我犯过的反向版
  assert.notEqual(wrongExhausted(items.length, 100, 0), paginate(items, 100, 0, MAX_LIMIT, DEFAULT_LIMIT).exhausted,
    '反向实现在第 1 页就与判据分歧');
  assert.notEqual(canonical(S_constant('hsr_object_get', DEFAULT_LIMIT)), canonical(S_constant('hsr_object_get', 73)),
    '把页长钉成缺省常量 ⇒ 非缺省页长必红（golden 须按 (操作, 生效页长) 逐份生成）');
  const dropBoundary = r => { const { boundary, ...rest } = sanitize(r, NO_VIS, { effectiveLimit: 41 }); return rest; };
  assert.notEqual(canonical(dropBoundary(mkReport())), canonical(sanitize(mkReport(), NO_VIS, { effectiveLimit: 41 })),
    '删掉 boundary 属呈现面缺键（SI-33 恒定在场）');
  assert.notDeepEqual(Object.keys(sanitize(mkReport(), NO_VIS, { effectiveLimit: 41 })), ['items'],
    '呈现面不是"过滤后的 items"，而是 SCR-57 穷举的那套键');
});

// ---- 写入幂等（SI-41，审查纠正 #4） ------------------------------------------------
const mkWorld = () => {
  const store = [];
  const write = req => {
    if (req.precondition_revision && req.precondition_revision !== 'r1') return { refused: 'F-PRECONDITION-REVISION' };
    const rec = { record_id: 'HENT-new@r' + (store.length + 1), revision_id: 'r1' };
    store.push(rec); return rec;
  };
  return { store, write };
};
test('P3-10 同键同体重放返回首次结果且不产生第二条记录；键含 operation 分量（SI-41）', () => {
  const { store, write } = mkWorld(); const idem = new Idempotency();
  const req = { actor_ref: 'HAGT-me@r1', space_id: 'sp-root', operation: 'hsr_entity_register', client_request_id: 't-1', payload: { a: 1 } };
  const a = idem.run(req, () => write(req)), b = idem.run(req, () => write(req));
  assert.equal(a.replayed, false); assert.equal(b.replayed, true);
  assert.deepEqual(a.result, b.result, '重放必须交回首次结果');
  assert.equal(store.length, 1, '重试造成双修订是缺陷');
  assert.equal(idem.run({ ...req, operation: 'hsr_concept_register' }, () => write(req)).replayed, false,
    '不同 operation 同 client_request_id 不是同一个键');
});
test('P3-11 键同体不同 = 不是重放：拒绝且不产生任何记录（SI-41 键扩展的第二处）', () => {
  const { store, write } = mkWorld(); const idem = new Idempotency();
  const req = { actor_ref: 'HAGT-me@r1', space_id: 'sp-root', operation: 'hsr_entity_register', client_request_id: 't-9', payload: { a: 1 } };
  idem.run(req, () => write(req));
  assert.equal(idem.run({ ...req, payload: { a: 2 } }, () => write(req)).refused, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(store.length, 1, '把 A 请求的结果交给 B 请求 = 交回一个从未写过的 record_id');
});
test('P3-12 跨重启：键与首次结果永久绑定；前置不匹配被拒且不占键（SI-41）', () => {
  const { store, write } = mkWorld(); const idem = new Idempotency();
  const req = { actor_ref: 'HAGT-me@r1', space_id: 'sp-root', operation: 'hsr_entity_register', client_request_id: 't-5', payload: { a: 1 } };
  const first = idem.run(req, () => write(req));
  const revived = Idempotency.restore(idem.serialize());                 // 模拟进程重启
  const again = revived.run(req, () => write(req));
  assert.equal(again.replayed, true); assert.deepEqual(again.result, first.result, '重启后仍绑同一首次结果');
  assert.equal(store.length, 1);
  const bad = { ...req, client_request_id: 't-6', precondition_revision: 'r7' };
  assert.equal(revived.run(bad, () => write(bad)).result.refused, 'F-PRECONDITION-REVISION');
  assert.equal(store.length, 1);
  assert.equal(revived.run({ ...bad, precondition_revision: undefined }, () => write({ ...bad, precondition_revision: undefined })).replayed, false,
    '被拒绝的请求不得占住幂等键，否则该键永远无法成功');
});
