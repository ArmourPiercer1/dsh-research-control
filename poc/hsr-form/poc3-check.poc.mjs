/**
 * PoC-3 检查与接口边界（内存桩件，不依赖正式 Host）。
 * 每条判据注明文档规则号；测试页长一律 ≠ 缺省页长（SI-14 / §10-6b 的显式要求）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceLevel, sanitize, digest, canonical, isTagged } from './core.mjs';

const DEFAULT_LIMIT = 50, MAX_LIMIT = 200;                       // SI-50：超限拒绝而非静默夹取
/** 分页回显：limit_applied 如实于请求（SI-14 第③类，不是披露量） */
function page(items, requested, offset = 0) {
  if (requested > MAX_LIMIT) return { refused: 'F-LIMIT-TOO-LARGE' };            // SI-50
  const slice = items.slice(offset, offset + requested);
  return { slice, limit_applied: requested, exhausted: offset + requested < items.length };  // exhausted 如实于可见集
}
/** 只读幂等（SI-41）：键含 operation 分量 */
const store = new Map();
function readOnlyOp(key, compute) {
  const k = `${key.space}|${key.actor}|${key.operation}|${key.token}`;
  if (store.has(k)) return { ...store.get(k), replayed: true };   // 展开顺序：覆盖标记必须在后，否则被存值盖回 false
  const r = { replayed: false, ...compute() };
  store.set(k, r);
  return r;
}
const mkReport = (items, over = {}) => ({ report_id: 'rpt:1', checked_at: 100,
  rule_id: 'SCR-57', level: 'S-L1', verdict: 'ACHIEVED', items, ...over });
const NO_VIS = { hidden: i => i.owner !== 'me' };

// ---- 归约（RPT-02） --------------------------------------------------------------
test('P3-1 同层 FAIL 与 INDETERMINATE 并存 → NOT_ACHIEVED；只有 INDETERMINATE → INDETERMINATE', () => {
  assert.equal(reduceLevel(['PASS', 'INDETERMINATE', 'FAIL']), 'NOT_ACHIEVED');
  assert.equal(reduceLevel(['PASS', 'INDETERMINATE']), 'INDETERMINATE');
  assert.equal(reduceLevel(['PASS']), 'ACHIEVED');
});
test('P3-2 候选载荷不参与归约：它没有层级结果，也不得被填成 INDETERMINATE（SS-56）', () => {
  const candidate = { levelResults: [], candidate: true, entryFindings: ['SUBTYPE_UNREGISTERED'] };
  assert.equal(candidate.levelResults.length, 0);
  assert.equal(reduceLevel(candidate.levelResults), 'ACHIEVED',
    '空结果集会被误判为 ACHIEVED —— 归约函数无法区分"没有结果"与"全部通过"，见 FINDINGS');
});

// ---- 摘要域（SF-52a） ------------------------------------------------------------
test('P3-3 report_digest 对"去掉自身"可重算且稳定；算进自身则不可实现', () => {
  const r = mkReport([{ id: 'a' }]);
  const d = digest(r, ['report_digest', 'checked_at']);                          // SCR-54 排除集恰两项
  assert.deepEqual({ ...r, report_digest: d }, { ...r, report_digest: digest({ ...r, report_digest: d }, ['report_digest', 'checked_at']) },
    '写入摘要后重算必须得到同一值（排除集含自身）');
  const cyclic = digest({ ...r, report_digest: d }, ['checked_at']);             // 不排除自身
  assert.notDeepEqual(cyclic, d, '把自身算进被摘要对象 → 摘要随写入漂移，永远无法回放一致');
});
test('P3-4 排除集变更 = 破坏性变更：历史摘要全部不再匹配（SF-61）', () => {
  const r = mkReport([{ id: 'a' }]);
  const oldD = digest(r, ['report_digest', 'checked_at']);
  const newD = digest(r, ['report_digest']);                                      // 少排除一项
  assert.notEqual(oldD.hex, newD.hex);
  assert.notEqual(canonical({ ...r, checked_at: 100 }), canonical({ ...r, checked_at: 101 }),
    'checked_at 若不进排除集，每次调用的时间戳都会改变摘要');
});

// ---- 两世界差分与恒定面（SI-14 / SCR-57） ------------------------------------------
const worldA = [{ id: 'v1', owner: 'me' }, { id: 'v2', owner: 'me' }, { id: 'h1', owner: 'other' }];
const worldB = [{ id: 'v1', owner: 'me' }, { id: 'v2', owner: 'me' }];           // 少一条被屏蔽记录
test('P3-5 两个世界的 sanitize 输出逐字节相等；S 的粒度 = (操作, 生效页长)', () => {
  for (const L of [37, DEFAULT_LIMIT]) {                                          // 37 ≠ 缺省页长（§10-6b）
    const a = canonical(sanitize(mkReport(worldA), NO_VIS, { effectiveLimit: L }));
    const b = canonical(sanitize(mkReport(worldB), NO_VIS, { effectiveLimit: L }));
    assert.equal(a, b, `页长 ${L} 下两世界必须不可区分`);
    const S = canonical(sanitize(mkReport([]), NO_VIS, { effectiveLimit: L }));
    assert.notEqual(a, S, 'S 的粒度含可见内容时才可比较——纯空集不是"无可见权者"的正确常量，见 FINDINGS');
  }
});
test('P3-6 分页真相：两页 exhausted 变化、limit_applied 如实、truncated 恒 false', () => {
  const vis = Array.from({ length: 200 }, (_, i) => ({ id: 'v' + i, owner: 'me' })).concat({ id: 'h', owner: 'other' });
  const L = 60;                                                                   // ≠ 缺省 50
  const p1 = page(vis, L, 0), p2 = page(vis, L, L);
  assert.equal(p1.exhausted, true); assert.equal(p2.exhausted, true);
  assert.equal(page(vis, L, 180).exhausted, false, '最后一页（可见集剩余 21 < 页长）必须报告无后续');
  assert.equal(p1.limit_applied, 60, '不得回显成缺省常量 50');
  const s1 = sanitize(mkReport(vis), NO_VIS, { effectiveLimit: p1.limit_applied });
  assert.equal(s1.boundary.truncated, false, '盲区下 truncated 是披露常量');
  assert.equal(s1.boundary.limit_applied, 60, 'limit_applied 是请求的函数，不是披露量（SI-14）');
});
test('P3-7 反向断言：把 limit_applied 钉成缺省常量的实现必须被判红', () => {
  const wrong = { items: [], boundary: { coverage: 'NOT_DISCLOSED', truncated: false, limit_applied: DEFAULT_LIMIT } };
  const right = sanitize(mkReport([]), NO_VIS, { effectiveLimit: 73 });
  assert.notEqual(canonical(wrong), canonical(right), '若两世界都在请求 73，钉常量会让 golden 永假但本断言仍抓不住跨页长差异 → 见 FINDINGS');
});
test('P3-8 比较面层界：排除集恰两项；分页回显不在面内也不得进排除集；删 boundary 判红', () => {
  const excl = ['report_digest', 'checked_at'];
  assert.equal(excl.length, 2, 'SCR-54 的排除集封闭为恰两项');
  const r = mkReport([{ id: 'a' }]);
  const withB = sanitize(r, NO_VIS, { effectiveLimit: 41 });
  assert.ok('boundary' in withB, 'SI-33：boundary 恒定在场，删掉它属呈现面缺键');
  assert.ok(!('exhausted' in withB) && !('next_cursor' in withB),
    '分页回显由响应包络承载，不是 sanitize() 返回值的一部分（SCR-57）');
  assert.ok(!isTagged(withB.boundary.truncated), 'SS-15a 第③类：回显值不是五态标签值');
});

// ---- 幂等（SI-41） ---------------------------------------------------------------
test('P3-9 同键重放返回同一结果且不产生第二条写入；operation 参与键', () => {
  const k = { space: 'sp1', actor: 'agt:me', operation: 'hsr_object_get', token: 't-1' };
  let n = 0;
  const a = readOnlyOp(k, () => ({ record_id: 'r' + (++n) }));
  const b = readOnlyOp(k, () => ({ record_id: 'r' + (++n) }));
  assert.equal(a.replayed, false); assert.equal(b.replayed, true);
  assert.equal(a.record_id, b.record_id, '重放必须同一结果');
  assert.equal(n, 1, '重放不得二次执行');
  const c = readOnlyOp({ ...k, operation: 'hsr_check_report_get' }, () => ({ record_id: 'r' + (++n) }));
  assert.equal(c.replayed, false, '不同 operation 同 token 不算冲突（键含 operation 分量）');
});
test('P3-10 超限页长拒绝而非静默夹取（SI-50 已选拒绝）', () => {
  assert.equal(page([{ id: 'a' }], 500, 0).refused, 'F-LIMIT-TOO-LARGE');
  assert.equal(page([{ id: 'a' }], MAX_LIMIT, 0).limit_applied, MAX_LIMIT);
});
