/**
 * PoC-3 检查归约 / 摘要域 / 两世界恒定面 / 写入幂等。
 * 独立审查第一轮（基线 da113bcd）判本单元三处 P0 全部成立并已复现：
 *   #2 `exhausted` 语义写反（文档锚点：可见 200 条、页长 100 ⇒ 第 1 页 false、第 2 页 true），
 *      而原测试**跟着断言了错误语义**，所以是绿的——这正是"绿灯不等于验证"。
 *   #3 把 SCR-54 的同形排除集 `{report_id, checked_at}` 误当成摘要排除集；SCR-06 明文摘要排除集**恰一项** `{report_digest}`。
 *   #4 幂等测试用只读操作 + 进程内 Map，验不到 SI-41 要求的写入幂等。
 * 第二轮审查判本单元一项 P0，成立并已复现（`.scratch/probe-review2.mjs` R1）：
 *   部分可见报告的脱敏只过滤 findings、**保留存储 verdict** ⇒ "目标存在于他空间"（存储
 *   `INDETERMINATE(WITHHELD_REFERENCE)`）与"目标不存在"（存储 `FAIL(REF_UNRESOLVED)`）两个世界
 *   呈现不同 verdict，被屏蔽内容的存在性被 verdict 说了出去（违反 SCR-51/53/54/55）。
 *   上一版 P3-7 之所以是绿的：它挑的两个世界的**存储 verdict 恰好相同**，等于没测这条判据。
 * 第三轮审查判本单元一项 P1，成立并已复现（`.scratch/probe-review3.mjs` R1）：
 *   脱敏的呈现面仍随"本次是否真的过滤过内容"变化——**隐藏 0 条 vs 隐藏 1 条**不同形。上一轮的配对是
 *   "隐藏 1 vs 隐藏 2"，两条都发生了遮蔽，于是"是否发生遮蔽"这个变量被构造方式固定住了：**判据的
 *   边界在 0，配对却在 1 与 2**。现 P3-7d 把 0/1/≥2 三态一起配，并把上一轮的实现写成反向锚点。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceLevel, sanitize, S_constant, paginate, digest, canonical, DIGEST_EXCLUSION, SHAPE_EXCLUSION,
  Idempotency, AUDIT, noVisibility, partialView, PRESENTATION_ONLY, FIELD_PLACEHOLDER, visiblePayload } from './core.mjs';

const DEFAULT_LIMIT = 50, MAX_LIMIT = 200;                       // SI-50：超限拒绝而非静默夹取
const mkReport = (over = {}) => ({ operation: 'hsr_object_get', report_id: 'rpt:1', checked_at: 100,
  level_results: [{ rule_id: 'SCR-57', verdict: 'PASS' }], findings: [{ rule_id: 'SCR-57', item: 'v1', owner: 'me' }],
  verdict: 'ACHIEVED', items: [], ...over });
const PARTIAL = partialView(f => f.owner !== 'me');
const NO_VIS = noVisibility();
const PAGE = { effectiveLimit: 41 };

// ---- 归约（RPT-02 + SCR-77） -----------------------------------------------------
test('P3-1 归约优先序：FAIL 最高、否则 INDETERMINATE、全通过才 ACHIEVED（RPT-02）', () => {
  assert.equal(reduceLevel(['PASS', 'INDETERMINATE', 'FAIL']), 'NOT_ACHIEVED');
  assert.equal(reduceLevel(['PASS', 'INDETERMINATE']), 'INDETERMINATE');
  assert.equal(reduceLevel(['PASS']), 'ACHIEVED');
});
test('P3-2 零适用规则不得归约为通过（SCR-77 沉默不等于通过）', () => {
  assert.equal(reduceLevel([]), 'INDETERMINATE', '第一轮纠正 #4：原实现返回 ACHIEVED');
  const naive = v => (v.includes('FAIL') ? 'NOT_ACHIEVED' : v.includes('INDETERMINATE') ? 'INDETERMINATE' : 'ACHIEVED');
  assert.equal(naive([]), 'ACHIEVED', '反向锚点：不判零覆盖的实现与判据分歧，本用例能抓住它');
});
test('P3-3 候选载荷不参与归约：它没有层级结果，也不得被填成 INDETERMINATE（SS-56）', () => {
  const candidate = { levelResults: [], candidate: true, entryFindings: ['SUBTYPE_UNREGISTERED'] };
  assert.equal(candidate.levelResults.length, 0);
  assert.equal('verdict' in candidate, false, '候选载荷不产出层级 verdict');
  assert.deepEqual(candidate.entryFindings, ['SUBTYPE_UNREGISTERED'], '失败只存在于入口检查报告这个**另一个载体**');
});

// ---- 摘要域：三个互不相同的排除集（第一轮纠正 #3） ---------------------------------
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

// ---- 无可见权者：S 常量（SCR-57） -------------------------------------------------
const worldA = [{ id: 'v1', owner: 'me' }, { id: 'v2', owner: 'me' }, { id: 'h1', owner: 'other' }, { id: 'h2', owner: 'other' }];
const worldB = [{ id: 'v1', owner: 'me' }, { id: 'v2', owner: 'me' }];
test('P3-6 无可见权者输出 == S 常量，逐键穷举，两个页长各跑一次（SCR-57 粒度 = (操作, 生效页长)）', () => {
  for (const L of [37, DEFAULT_LIMIT]) {
    for (const w of [worldA, worldB])
      assert.equal(canonical(sanitize(mkReport({ items: w }), NO_VIS, { effectiveLimit: L })),
        canonical(S_constant('hsr_object_get', L)), `页长 ${L} 下必须逐字节等于 S（与被请求对象的属性无关）`);
    const S = S_constant('hsr_object_get', L);
    assert.deepEqual(S.level_results, [], 'S 的 level_results 是空数组——无可见权者不获得任何层级声明');
    assert.deepEqual(S.findings, []); assert.equal(S.verdict, 'UNVERIFIABLE_TO_YOU');
    assert.deepEqual(Object.keys(S.boundary).sort(), ['coverage', 'limit_applied', 'truncated']);
    assert.equal(S.boundary.coverage, 'NOT_DISCLOSED'); assert.equal(S.boundary.truncated, false);
    assert.equal(S.boundary.limit_applied, L, 'limit_applied 按 SI-14 如实反映请求页长，不是常量');
  }
});
test('P3-6b 有权者见完整审计视图 A：存储 verdict 与完整 findings 原样在场，且 A ≠ S（SCR-55 只承认这一条授权边界）', () => {
  const rep = mkReport({ level_results: [{ level: 'L1', verdict: 'FAIL' }], verdict: 'NOT_ACHIEVED',
    findings: [{ code: 'X', level: 'L1', owner: 'me' }, { outcome: 'FAIL', reason: 'REF_UNRESOLVED', level: 'L1', owner: 'other' }] });
  const a = sanitize(rep, AUDIT, PAGE);
  assert.equal(a.verdict, 'NOT_ACHIEVED'); assert.equal(a.findings.length, 2, 'A 视图不删任何 finding');
  assert.equal(a.boundary.coverage, 'COMPLETE', '存储侧 coverage 永不取 NOT_DISCLOSED（SCR-33）');
  assert.notEqual(canonical(a), canonical(S_constant(rep.operation, PAGE.effectiveLimit)));
  assert.equal(canonical(sanitize(rep, NO_VIS, PAGE)), canonical(S_constant(rep.operation, PAGE.effectiveLimit)));
  // SCR-52：呈现层专用取值与存储枚举分离——存储形态里一个都不许出现
  for (const v of PRESENTATION_ONLY) assert.ok(!canonical(rep).includes(v), `存储报告里出现了呈现层取值 ${v}`);
  assert.ok(canonical(sanitize(rep, NO_VIS, PAGE)).includes('UNVERIFIABLE_TO_YOU'), '呈现层取值只在呈现面出现');
});

// ---- 部分可见：SCR-51 合并 + SCR-53 占位 + SCR-54 同形（第二轮 P0） ----------------
const visibleF = { code: 'L1_OK', level: 'L1', owner: 'me' };
const hiddenAt = (level, extra) => ({ level, owner: 'other', rule_id: 'SCR-30',
  field_path: '/fields/other-space-individual', ...extra });
/** XC-25 的两个世界：同一请求、同一授权类、同一时间参数，只差"目标存在于他空间 / 目标不存在" */
const xc25 = world => mkReport({
  level_results: [{ level: 'L1', verdict: world === 'A' ? 'PASS' : 'FAIL', findings_count: world === 'A' ? 3 : 2 }],
  findings: [visibleF, world === 'A'
    ? hiddenAt('L1', { outcome: 'INDETERMINATE', reason: 'WITHHELD_REFERENCE' })
    : hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' })],
  verdict: world === 'A' ? 'INDETERMINATE' : 'NOT_ACHIEVED' });
test('P3-7 XC-25 两世界逐字节同形：合并为恰一条 UNVERIFIABLE_REFERENCE、层级只剩占位形态（SCR-51/53/54）', () => {
  const a = sanitize(xc25('A'), PARTIAL, PAGE), b = sanitize(xc25('B'), PARTIAL, PAGE);
  assert.equal(canonical(a), canonical(b), '存储 verdict 不同的两个世界，呈现必须逐字节相同');
  assert.deepEqual(a.level_results, [{ level: 'L1', verdict: 'UNVERIFIABLE_TO_YOU' }],
    '受影响层级：verdict → UNVERIFIABLE_TO_YOU，且 findings_count 这类**条数键**整键消失（SCR-53）');
  assert.deepEqual(a.findings, [visibleF, { level: 'L1', outcome: 'INDETERMINATE', code: 'UNVERIFIABLE_REFERENCE', field_path: FIELD_PLACEHOLDER }],
    'SCR-51：两条被屏蔽引用 finding 合并为一条；SCR-53：占位 /fields，原 rule_id 不出现');
  assert.equal(a.verdict, 'UNVERIFIABLE_TO_YOU', '发生过脱敏 ⇒ 报告级 verdict 不得由可见子集归约（SCR-55）');
  assert.equal(a.boundary.coverage, 'NOT_DISCLOSED');
  const bytes = canonical(a);
  for (const leak of ['secret', 'other-space-individual', 'SCR-30', 'WITHHELD_REFERENCE', 'REF_UNRESOLVED', 'findings_count'])
    assert.ok(!bytes.includes(leak), `呈现字节里出现了不该有的 ${leak}`);
});
test('P3-7b 隐藏 1 条与隐藏 2 条同形：被遮蔽项数量不得从数组长度泄漏（SCR-55）', () => {
  assert.equal(canonical(sanitize(xc25('A'), PARTIAL, PAGE)), canonical(sanitize(xc25('B'), PARTIAL, PAGE)));
  const one = sanitize({ ...xc25('B'), findings: [visibleF, hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' })] }, PARTIAL, PAGE);
  const two = sanitize({ ...xc25('B'), findings: [visibleF,
    hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' }),
    hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' })] }, PARTIAL, PAGE);
  assert.equal(canonical(one), canonical(two), '同层级多条被屏蔽 → 仍合并为一条');
  assert.equal(two.findings.filter(f => f.code === 'UNVERIFIABLE_REFERENCE').length, 1);
});
test('P3-7c 错误实现必红：四种我或实现者会写的脱敏变体都被这套用例抓住（第二轮 P0）', () => {
  const A = xc25('A'), B = xc25('B');
  const twoHidden = { ...xc25('B'), findings: [visibleF, hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' }),
    hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' })] };
  const dropMerge = r => { const p = sanitize(r, PARTIAL, PAGE); return { ...p, findings: p.findings.filter(f => f.code !== 'UNVERIFIABLE_REFERENCE') }; };
  const perHidden = r => {
    const p = sanitize(r, PARTIAL, PAGE), n = r.findings.filter(f => f.owner !== 'me').length;
    return { ...p, findings: [...p.findings.filter(f => f.code !== 'UNVERIFIABLE_REFERENCE'),
      ...Array.from({ length: n }, () => ({ level: 'L1', outcome: 'INDETERMINATE', code: 'UNVERIFIABLE_REFERENCE', field_path: FIELD_PLACEHOLDER }))] };
  };
  const keepFieldPath = r => { const p = sanitize(r, PARTIAL, PAGE);
    return { ...p, findings: p.findings.map(f => (f.code === 'UNVERIFIABLE_REFERENCE' ? { ...f, field_path: '/fields/other-space-individual' } : f)) }; };
  const cases = [
    ['保留存储 verdict（本轮 P0）', r => ({ ...sanitize(r, PARTIAL, PAGE), verdict: r.verdict }), A,
      m => canonical(m(A)) !== canonical(m(B)), '两世界 verdict 分歧'],
    ['删掉合并出来的那一条（SCR-51 未实现）', dropMerge, A,
      m => m(A).findings.length === 1, '呈现里再没有"你无从核实这条引用"的声明'],
    ['每条被屏蔽项各产一条（数量泄漏）', perHidden, twoHidden,
      m => canonical(m(A)) !== canonical(m(twoHidden)), '隐藏 1 条与 2 条呈现不同长'],
    ['保留原 field_path（字段名泄漏）', keepFieldPath, A,
      m => canonical(m(A)).includes('other-space-individual'), '被屏蔽字段名出现在字节里'],
  ];
  for (const [name, m, witness, discriminates, why] of cases) {
    assert.equal(discriminates(m), true, `变异体"${name}"没被抓住 ⇒ 判据分辨力不足（${why}）`);
    assert.notEqual(canonical(m(witness)), canonical(sanitize(witness, PARTIAL, PAGE)), `"${name}"与正确实现分歧在 ${why}`);
  }
});

test('P3-7d **隐藏 0 条**也必须与隐藏 ≥1 条同形：边界格才是泄漏发生的地方（SCR-55；第三轮审查 P1）', () => {
  // 审查原话：此前覆盖了"隐藏 1 vs 隐藏 2"，却没覆盖"隐藏 0 vs 隐藏 1"。
  // 构造照抄审查描述：可见 finding 完全一致，只有额外隐藏项的**有无**不同，连存储 verdict 都不同。
  const none = { ...xc25('B'), findings: [visibleF], verdict: 'ACHIEVED' };
  const one = { ...xc25('B'), findings: [visibleF, hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' })] };
  const two = { ...xc25('B'), findings: [visibleF, hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' }),
    hiddenAt('L1', { outcome: 'FAIL', reason: 'REF_UNRESOLVED' })] };
  const bytesOf = r => canonical(sanitize(r, PARTIAL, PAGE));
  const [n, o, t] = [none, one, two].map(bytesOf);
  assert.equal(n, o, '隐藏 0 条 vs 隐藏 1 条：可见集相同 ⇒ 呈现必须逐字节相同');
  assert.equal(o, t, '隐藏 1 条 vs 隐藏 2 条：同上');
  assert.equal(sanitize(none, PARTIAL, PAGE).verdict, 'UNVERIFIABLE_TO_YOU',
    'MASKED 档的 verdict 是**该授权类的常量**，不是"本次是否过滤过内容"的函数');
  // 反向锚点：第二轮的实现（"发生过脱敏才降级 + 按受影响层级发占位"）恰好在**这一格**泄漏，
  // 而它在"1 vs 2"那一格与正确实现同形——所以旧用例给不了这条分辨力，必须新增边界格。
  const prevRound = r => {
    const hid = r.findings.filter(f => f.owner !== 'me');
    const levels = [...new Set(hid.map(f => f.level))];
    return { ...sanitize(r, PARTIAL, PAGE),
      level_results: hid.length ? r.level_results.map(l => ({ level: l.level, verdict: 'UNVERIFIABLE_TO_YOU' })) : r.level_results,
      findings: [...r.findings.filter(f => f.owner === 'me'),
        ...levels.map(level => ({ level, outcome: 'INDETERMINATE', code: 'UNVERIFIABLE_REFERENCE', field_path: FIELD_PLACEHOLDER }))],
      verdict: hid.length ? 'UNVERIFIABLE_TO_YOU' : r.verdict };
  };
  assert.notEqual(canonical(prevRound(none)), canonical(prevRound(one)),
    '锚点失效检查：上一轮的实现在"隐藏 0 vs 1"必须分歧，否则本用例没在验任何东西');
  assert.equal(canonical(prevRound(one)), canonical(prevRound(two)),
    '它在"1 vs 2"上同形 ⇒ 这正是 P3-7b 一片绿灯却漏掉本条缺陷的原因');
  // 占位条数只跟**报告自身的层级结构**有关，与遮蔽了多少条无关
  const twoLevel = r => ({ ...r, level_results: [{ level: 'L1', verdict: 'PASS' }, { level: 'L2', verdict: 'PASS' }] });
  assert.equal(canonical(sanitize(twoLevel(none), PARTIAL, PAGE)), canonical(sanitize(twoLevel(one), PARTIAL, PAGE)));
  assert.equal(sanitize(twoLevel(one), PARTIAL, PAGE).findings.filter(f => f.code === 'UNVERIFIABLE_REFERENCE').length, 2,
    '每层恰一条固定占位：条数是层数的函数，不是被遮蔽条数的函数');
});

// ---- 分页（SI-14 / SI-50） --------------------------------------------------------
test('P3-8 分页真相（SI-14/SI-50 文档锚点）：201 条、页长 60 ⇒ 首页 exhausted=false、末页 true', () => {
  const items = Array.from({ length: 201 }, (_, i) => ({ id: 'v' + i, owner: 'me' }));
  const p1 = paginate(items, 60, 0, MAX_LIMIT, DEFAULT_LIMIT), p2 = paginate(items, 60, 180, MAX_LIMIT, DEFAULT_LIMIT);
  assert.equal(p1.refused, undefined); assert.equal(p1.exhausted, false, '第 1 页后面还有内容 → false');
  assert.equal(p2.exhausted, true, '末页无后续 → true');
  assert.equal(p1.limit_applied, 60, '等于实际生效页长，不是缺省常量 50');
  assert.notEqual(p1.next_cursor, null); assert.equal(p2.next_cursor, null);
  assert.equal(sanitize(mkReport({ items }), PARTIAL, { effectiveLimit: p1.limit_applied }).boundary.truncated, false,
    '盲区下 truncated 是披露常量，与 exhausted 语义不同、允许并存');
  assert.equal(paginate(items, 500, 0, MAX_LIMIT, DEFAULT_LIMIT).refused, 'F-LIMIT-TOO-LARGE', '超限拒绝而非静默夹取');
});
test('P3-8b 顺序判据：先按可见性过滤再分页，两世界的载荷与包络同形；先分页再过滤则条数可辨', () => {
  const visA = visiblePayload(worldA, i => i.owner === 'me'), visB = visiblePayload(worldB, i => i.owner === 'me');
  const pa = paginate(visA, 60, 0, MAX_LIMIT, DEFAULT_LIMIT), pb = paginate(visB, 60, 0, MAX_LIMIT, DEFAULT_LIMIT);
  assert.equal(canonical(pa), canonical(pb), '可见集相同 ⇒ 载荷与 limit/exhausted 全部同形');
  // 反向锚点：对**未过滤**的全量分页（页长 2）——世界 A 还有后续、世界 B 已到底，
  // 包络字节当场把"这个世界多两条"说了出来。这就是"过滤必须发生在分页之前"的判据形态。
  const rawA = paginate(worldA, 2, 0, MAX_LIMIT, DEFAULT_LIMIT), rawB = paginate(worldB, 2, 0, MAX_LIMIT, DEFAULT_LIMIT);
  assert.equal(rawA.exhausted, false); assert.equal(rawB.exhausted, true);
  assert.notEqual(canonical(rawA), canonical(rawB), '先分页再过滤 ⇒ 包络成为存在性 oracle');
});

// ---- 反向断言（第一轮要求的"错误实现必红"） ---------------------------------------
test('P3-9 反向断言：三类错误实现必须被抓（第一轮审查要求）', () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: 'v' + i, owner: 'me' }));
  const wrongExhausted = (n, req, off) => off + req < n;                              // 我犯过的反向版
  assert.notEqual(wrongExhausted(items.length, 100, 0), paginate(items, 100, 0, MAX_LIMIT, DEFAULT_LIMIT).exhausted,
    '反向实现在第 1 页就与判据分歧');
  assert.notEqual(canonical(S_constant('hsr_object_get', DEFAULT_LIMIT)), canonical(S_constant('hsr_object_get', 73)),
    '把页长钉成缺省常量 ⇒ 非缺省页长必红（golden 须按 (操作, 生效页长) 逐份生成）');
  const dropBoundary = r => { const { boundary, ...rest } = sanitize(r, NO_VIS, PAGE); return rest; };
  assert.notEqual(canonical(dropBoundary(mkReport())), canonical(sanitize(mkReport(), NO_VIS, PAGE)),
    '删掉 boundary 属呈现面缺键（SI-33 恒定在场）');
  assert.notDeepEqual(Object.keys(sanitize(mkReport(), NO_VIS, PAGE)), ['items'],
    '呈现面不是"过滤后的 items"，而是 SCR-57 穷举的那套键');
  assert.throws(() => sanitize(mkReport(), { hiddenFinding: () => true }, PAGE), /授权类必须声明 view/,
    '授权类形态不完整时不得静默走某条分支（静默选分支就是本轮 P0 的成因）');
});

// ---- 写入幂等（SI-41，第一轮纠正 #4） ----------------------------------------------
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
