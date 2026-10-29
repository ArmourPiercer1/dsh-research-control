/**
 * PoC-2 身份、修订与注册。
 * 本轮（第二轮审查纠正后）与重写过的 core.mjs 及文档对齐：
 *   ① 夹具换成 poc1 标准：SF-22 文法标识 + **整数** schema_version + 无响应回显键（SS-15a 第③类）
 *      + `reg.refPaths` 声明引用位（SF-04 ④ 的适用面）；
 *   ② 身份引用位一律用**规范键名与契约点名的子路径**（`world_membership.individual_ref`、`subtype_code`）；
 *      父槽位 `world_membership` 冒充子路径按 SS-15a「契约点名到子路径就用子路径」判条目非法——保留为**负例**；
 *   ③ `checkConclusion` 的事件作用域（§4.1 L116）：首次登记的 `NONE_DECLARED` 必须产生时为 `SUBMITTED`；
 *      上一版已声明 `NONE_DECLARED` 的生命周期修订（`SUBMITTED→WITHDRAWN`）不得新增 finding——正反例配对（审查纠正 #6）；
 *   ④ `conclusionTransition(x)` 单参调用返回 `ILLEGAL_INPUT`（旧兼容分支"看似合法"已被纠正；
 *      「无 head 首次登记按补全」由双参调用 `(undefined, next)` 表达）；
 *   ⑤ 变异断言 P2-19：三个错误实现（父槽位冒充子路径 / 豁免不核验援引 / 转移不比 `proposition_rev`）
 *      必须在本文件用例集上与文档判据分歧。
 * 红 = 核心判据疑似不忠实于文档，逐条写入 FINDINGS-poc2.md「对新核心的反例」；夹具问题不再产红。
 * 夹具自含（不 import poc1：那会把它的测试一起收进本文件）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest, expand, checkTagged, isTagged, checkSubtypeEntry, checkSingleton,
  checkConclusion, conclusionTransition, digest, canonical, reduceLevel, slotSetDigest } from './core.mjs';

// ---- 夹具：契约层事实写成数据（poc1 标准） ----------------------------------------
const envelopeKeys = ['object_id', 'object_kind', 'space_id', 'revision_id', 'schema_version',
  'recorded_at', 'identity_slot_set_digest', 'subtype_code', 'registrant_ref', 'source_refs'];
export const reg = {
  kinds: ['ENTITY', 'CONCEPT', 'ASSOCIATION', 'ARGUMENTATION', 'PROPOSITION'],
  envelopeKeys,
  nameAlias: { entity_subtype: 'subtype_code' },                      // SS-09a
  // SS-15a 裁决：身份判定单位 = 契约点名的引用位；条目内只允许规范键名形态（阅读名 `entity_subtype` 禁入，F-10 已裁）
  identitySlots: { ENTITY: ['world_membership.individual_ref', 'subtype_code'] },
  // SS-54「当前唯一已裁项」逐字：`world_membership.individual_ref` ← `EN-W-7`——裁定表键 = 子路径本体
  contractRulings: { 'world_membership.individual_ref': ['EN-W-7'] },
  // SF-04 ④ 只作用于契约声明为引用的位置（poc1 约定）；结论端 = 精确 PropositionRevision（ARG §5）
  refPaths: { world_membership: ['v.kind_ref', 'v.individual_ref'], scheme_ref: ['v'], conclusion: ['v.proposition_rev'] },
  subtypes: {},
};
const S = (code, kind, slots, over = {}) => reg.subtypes[code] = {
  subtype_code: code, kind, slot_set: slots, identity_slots: over.identity_slots ?? [],
  identity_slot_exemptions: over.exempt ?? [], status: over.status ?? 'ACTIVE', singleton: !!over.singleton,
};
const contracts = {
  aliases: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: true },
  description: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: false },
  world_membership: { na_allowed: false, na_reasons: [], empty_allowed: false },
  conclusion: { na_allowed: false, na_reasons: [], empty_allowed: false },
  _default: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: false },
};
const C = s => contracts[s] || contracts._default;

// WORLD_ROOT（EN-W-7）：slot_set 不含 world_membership；identity_slots = 基类减去**逐字子路径**豁免项；
// WorldType 分类由条目 kind + subtype_code 承载（载荷再造一份 = UNKNOWN_KEY_IN_PAYLOAD 负例），singleton: true。
S('WORLD_ROOT', 'ENTITY', ['aliases', 'description'], {
  identity_slots: ['subtype_code'], exempt: [{ slot: 'world_membership.individual_ref', cited_rule: 'EN-W-7' }], singleton: true,
});
S('PHYSICAL_OBJECT', 'ENTITY', ['world_membership', 'aliases', 'description'], { identity_slots: ['world_membership.individual_ref', 'subtype_code'] });
S('OLD_THING', 'ENTITY', ['world_membership', 'description'], { identity_slots: ['world_membership.individual_ref', 'subtype_code'], status: 'DEPRECATED' });
S('ARG_FORM', 'ARGUMENTATION', ['scheme_ref', 'engagement_target', 'conclusion', 'construction_state', 'local_outcome']);

const mkOut = () => ({ findings: [], badEntries: [], refused: null, candidate: false,
  fail(code, msg, sev = 'VIOLATION') { this.findings.push({ code, msg, sev }); },
  badEntry(sub, code) { this.badEntries.push({ sub, code }); } });
/** 写信封：SF-22 文法标识 + 整数 schema_version + 无回显键（SS-15a 第③类仅响应侧）；registrant_ref 是 V1 主体 */
const env = (kind, sub, extra = {}) => ({ object_id: 'HENT-e1', object_kind: kind,
  schema_version: 1, space_id: 'sp-root', subtype_code: sub,
  source_refs: { '@st': 'DECLARED', v: ['HENT-src@r1'] },
  registrant_ref: { '@st': 'DECLARED', v: 'agt:me' }, recorded_at: 1, ...extra });
const ok = (kind, sub, payload, extra) => {                      // 入口 → 规范化 → 五态检查（同 poc1）
  const o = mkOut();
  const r = ingest(env(kind, sub, extra), payload, reg, o);
  const entry = reg.subtypes[sub];
  const norm = entry ? expand(entry, payload) : payload;
  if (entry && !r.refused) for (const s of entry.slot_set) checkTagged(s, norm[s], C(s), o);
  return { r, o, norm, entry };
};
const cs = v => ({ '@st': 'DECLARED', v });
const P1 = 'HPRO-p1@r1', P2 = 'HPRO-p2@r1';                       // 结论端 = 精确 PropositionRevision（SF-22 文法）
const concl = (m, rev = P1) => ({ '@st': 'DECLARED', v: { mode: m, proposition_rev: m === 'NONE_DECLARED' ? null : rev } });
const argNorm = (conclusion, construction_state, local_outcome) => ({
  conclusion, construction_state: cs(construction_state), local_outcome });

// ---- 测试内实现（core 未提供判据者，按文档逐字编码；偏离即红） --------------------
/**
 * SS-55 × SS-15a × G-REV：变化集触及 identity_slots 中 head **已声明**的**引用位**值 → F-CONFLICT 拒绝并提示新建，
 * completion_basis（含 SAME_INTENT_CONFIRMED）不参与判定。UNKNOWN/ABSENT → DECLARED 属补全（EN-ID-6/RV-01）。
 * SS-15a 后果封闭：比较的是契约点名的引用位本体——只改 `world_membership.kind_ref` 不构成身份变化。
 */
function submitRevision(entry, head, payload, completionBasis) {
  for (const s of entry.identity_slots) {
    const root = s.split('.')[0];                    // 引用位 = 根槽名 + 子路径
    const h = head?.[root];
    if (h?.['@st'] !== 'DECLARED') continue;                                   // 未触及"已声明"值
    const n = payload[root];
    if (!isTagged(n) || n['@st'] !== 'DECLARED') continue;                     // 未提交 = 无变化
    const at = pos => s.split('.').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), pos?.v);
    if (canonical(at(h)) !== canonical(at(n)))
      return { accepted: false, code: 'F-CONFLICT', hint: '身份变化：请新建对象', basisIgnored: completionBasis !== undefined, slot: s };
  }
  return { accepted: true, sameObjectIdRevision: true };
}
/** AR-ID-4 / §7：CLOSED_DRAFT 只用于从未提交过的草稿；曾提交过（含 head 之后的生命周期修订）不得回落。
 *  载体（拒绝 vs 保存+finding）与理由码文档未定，此处取 F-CONFLICT 拒绝，见 FINDINGS F-8。 */
function csTransition(head, next) {
  if (next === 'CLOSED_DRAFT' && head.submittedEver) return { accepted: false, code: 'F-CONFLICT' };
  return { accepted: true, lifecycleRevision: true };   // AR-ID-4：构造状态变化是生命周期修订
}
/** SS-56：候选载荷不获得任何正式 S-L1/R-L1 层级结果（非 PASS/NOT_APPLICABLE/INDETERMINATE）；
 *  DEPRECATED 走正常规范化，层级结果照常归约（RPT-02 + SCR-77：零适用规则 = INDETERMINATE，不是 PASS）。 */
function hierarchy(o, norm, entry) {
  if (!entry || o.candidate) return null;
  const tagged = entry.slot_set.every(s => isTagged(norm[s]));
  return reduceLevel(tagged ? [] : ['FAIL']);
}

// ================================ 根世界（EN-W-7 × SS-54） ================================

test('P2-01 根世界最小正例：slot_set 不含 world_membership、identity_slots=基类−EN-W-7 逐字子路径豁免 → 条目合法且形态合法（EN-W-7/SS-54/SS-15a）', () => {
  const o = mkOut();
  checkSubtypeEntry(reg.subtypes.WORLD_ROOT, reg, o);
  assert.deepEqual(o.badEntries, [], '受控豁免合法：从超集减去契约点名的一项（SS-54）');
  assert.deepEqual(reg.subtypes.WORLD_ROOT.slot_set.includes('world_membership'), false, '缺槽位是类型层事实（EN-W-7）');
  assert.deepEqual(reg.subtypes.WORLD_ROOT.identity_slots, ['subtype_code'], '基类身份引用位 − EN-W-7 豁免项；SS-15a：条目只用规范键名（F-10 已裁）');
  const a = ok('ENTITY', 'WORLD_ROOT', {});
  assert.equal(a.r.refused, false, '形态合法（HENT 文法 + 整数版本 + 无回显键）');
  assert.deepEqual(a.o.findings, [], '不触发缺槽位判定（缺槽判定输入=slot_set，非全局清单）');
  // 负例配对：WorldType 分类由注册表 kind+subtype_code 承载，不得在载荷里再造一份
  assert.equal(ok('ENTITY', 'WORLD_ROOT', { kind_ref: { '@st': 'DECLARED', v: 'HCON-wt@r1' } }).r.code, 'UNKNOWN_KEY_IN_PAYLOAD');
});

test('P2-02 同 space 第二个 WORLD_ROOT：保存不阻断 + SINGLETON_SUBTYPE_DUPLICATE；异 space 无 finding（EN-W-7/SS-54 L268）', () => {
  const store = [];
  const save = (space, seq) => {
    const e = env('ENTITY', 'WORLD_ROOT', { space_id: space, object_id: `HENT-w${seq}` });
    const o = mkOut();
    const r = ingest(e, {}, reg, o);
    checkSingleton(store, e, reg, o);
    store.push({ env: e });                                     // 保存不阻断：入库照做
    return { r, o };
  };
  const first = save('sp-root', 1);
  assert.deepEqual(first.o.findings.map(f => f.code), [], '首个根世界合法');
  const dup = save('sp-root', 2);
  assert.deepEqual(dup.o.findings.map(f => f.code), ['SINGLETON_SUBTYPE_DUPLICATE']);
  assert.equal(dup.o.findings[0].sev, 'VIOLATION');
  assert.equal(dup.r.refused, false, '不拒写');
  assert.equal(store.length, 2, '不静默合并');
  const other = save('sp-2', 3);
  assert.deepEqual(other.o.findings.map(f => f.code), [], '谓词按 (space_id, subtype_code)：异 space 不是重复（配对）');
});

test('P2-03 豁免援引不到契约规则号 → 条目非法（不得启用）；援引 EN-W-7 成立则合法（SS-54）', () => {
  const bad = { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_BAD',
    identity_slot_exemptions: [{ slot: 'world_membership.individual_ref', cited_rule: 'EN-W-99' }] };
  const o = mkOut();
  checkSubtypeEntry(bad, reg, o);
  assert.ok(o.badEntries.map(b => b.code).includes('EXEMPTION_NOT_ADJUDICATED'), '子型不得自行宣布豁免');
  const good = mkOut();
  checkSubtypeEntry(reg.subtypes.WORLD_ROOT, reg, good);
  assert.deepEqual(good.badEntries, [], '同一豁免换真援引号即合法——核验的是援引是否成立');
});

test('P2-03b 照 EN-W-7 原文书写子路径豁免 → 核验通过（F-4 已由 SS-15a 裁决：豁免项与 identity_slots 同形态）', () => {
  const o = mkOut();
  checkSubtypeEntry(reg.subtypes.WORLD_ROOT, reg, o);   // 豁免项就是逐字子路径 world_membership.individual_ref
  assert.deepEqual(o.badEntries, [], 'EN-W-7 逐字裁项原样落注册表条目，核验不再要求改写成槽名');
});

test('P2-03c 父槽位 `world_membership` 冒充子路径豁免 → 条目非法（SS-15a：契约点名到子路径就用子路径；审查纠正 #5 的红线）', () => {
  const fake = { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_FAKE',
    identity_slot_exemptions: [{ slot: 'world_membership', cited_rule: 'EN-W-7' }] };
  const o = mkOut();
  checkSubtypeEntry(fake, reg, o);
  const codes = o.badEntries.map(b => b.code);
  assert.ok(codes.includes('EXEMPTION_NOT_ADJUDICATED'),
    '契约裁定的是子路径；父槽位没有援引对象，前缀相似不算援引');
  assert.ok(codes.includes('IDENTITY_SLOT_DROPPED'), '伪豁免被撤销后，未豁免的基类引用位缺失同样判非法（SS-54 超集约束）');
});

test('P2-04 豁免不得用来整体置空 identity_slots → 条目非法；只减一项则合法（SS-54）', () => {
  const emptied = { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_EMPTY',
    identity_slots: [], identity_slot_exemptions: [{ slot: 'world_membership.individual_ref', cited_rule: 'EN-W-7' }] };
  const o = mkOut();
  checkSubtypeEntry(emptied, reg, o);
  assert.ok(o.badEntries.map(b => b.code).includes('IDENTITY_SLOTS_EMPTIED'), '豁免是减法，不是取消超集约束');
  const good = mkOut();
  checkSubtypeEntry(reg.subtypes.PHYSICAL_OBJECT, reg, good);   // 配对正例：无豁免的超集条目
  assert.deepEqual(good.badEntries, []);
});

// ============================ 结论 × 构造状态（AR-ID-6 / §4.1） ============================

test('P2-05 §4.1 四行各自全部合法（不新增状态，只对齐既有用法）', () => {
  const rows = [
    ['尚在构造，未得结论', { '@st': 'ABSENT' }, 'DRAFT'],
    ['放弃了未完成的构造', { '@st': 'ABSENT' }, 'CLOSED_DRAFT'],
    ['研究完成但无定论', concl('NONE_DECLARED'), 'SUBMITTED'],
    ['已形成明确命题结论', concl('ASSERTS'), 'SUBMITTED'],
  ];
  for (const [name, c, state] of rows) {
    const o = mkOut();
    const norm = argNorm(c, state, c['@st'] === 'DECLARED' && c.v.mode === 'NONE_DECLARED' ? cs('INCONCLUSIVE') : { '@st': 'ABSENT' });
    checkConclusion(norm, o);
    assert.deepEqual(o.findings, [], `§4.1 行「${name}」应 0 finding`);
  }
  const o4 = mkOut();                                           // 第四行 construction_state「按实际生命周期记录」
  checkConclusion(argNorm(concl('ASSERTS'), 'WITHDRAWN', { '@st': 'ABSENT' }), o4);
  assert.deepEqual(o4.findings, [], 'ASSERTS × WITHDRAWN 仍合法（按实际生命周期）');
});

test('P2-06 ABSENT×DRAFT 与 ABSENT×CLOSED_DRAFT 是两个不同事实，不得互相代替（AR-ID-6）', () => {
  const draft = ok('ARGUMENTATION', 'ARG_FORM', { conclusion: { '@st': 'ABSENT' }, construction_state: cs('DRAFT') });
  const closed = ok('ARGUMENTATION', 'ARG_FORM', { conclusion: { '@st': 'ABSENT' }, construction_state: cs('CLOSED_DRAFT') });
  assert.deepEqual(draft.o.findings, []);
  assert.deepEqual(closed.o.findings, []);
  assert.notEqual(canonical(draft.norm), canonical(closed.norm), '两个规范形态可区分（推进中 vs 已放弃）');
  assert.notEqual(digest(draft.norm, []).hex, digest(closed.norm, []).hex, '摘要区分二者，回放不会折叠');
});

test('P2-07 NONE_DECLARED 缺 INCONCLUSIVE → 产 finding 且不阻断保存；配齐则 0（AR-ID-6 §3 第二行）', () => {
  const bad = mkOut();
  checkConclusion(argNorm(concl('NONE_DECLARED'), 'SUBMITTED', cs('CONCLUSIVE')), bad);
  assert.deepEqual(bad.findings.map(f => f.code), ['NONE_DECLARED_WITHOUT_INCONCLUSIVE']);
  assert.equal(bad.findings[0].sev, 'VIOLATION');                // 码名与严重度是 core 自取，文档未注册，见 F-9
  const good = mkOut();
  checkConclusion(argNorm(concl('NONE_DECLARED'), 'SUBMITTED', cs('INCONCLUSIVE')), good);
  assert.deepEqual(good.findings, [], '产生时 SUBMITTED + INCONCLUSIVE：首次登记即合法，无需 prev');
});

test('P2-07b 首次登记（无 prev）NONE_DECLARED+INCONCLUSIVE+CLOSED_DRAFT → NONE_DECLARED_NOT_SUBMITTED；带 prev 的 SUBMITTED→WITHDRAWN 生命周期修订 0 finding（§4.1 L116 / AR-ID-4；审查纠正 #6 的正反例）', () => {
  const first = mkOut();
  checkConclusion(argNorm(concl('NONE_DECLARED'), 'CLOSED_DRAFT', cs('INCONCLUSIVE')), first);
  assert.deepEqual(first.findings.map(f => f.code), ['NONE_DECLARED_NOT_SUBMITTED'],
    '「NONE_DECLARED 一旦出现，其产生时的 head 为 SUBMITTED」——首次登记没有可豁免的上一版，CLOSED_DRAFT 不是产生时');
  assert.equal(first.findings[0].sev, 'VIOLATION');
  const prev = argNorm(concl('NONE_DECLARED'), 'SUBMITTED', cs('INCONCLUSIVE'));   // 该声明产生时 SUBMITTED+INCONCLUSIVE
  const rev = mkOut();
  checkConclusion(argNorm(concl('NONE_DECLARED'), 'WITHDRAWN', cs('INCONCLUSIVE')), rev, prev);
  assert.deepEqual(rev.findings, [], 'AR-ID-4：生命周期修订不改变其它状态轴，不得使旧声明形态凭空变违规');
});

test('P2-08 ABSENT × 非 DRAFT 构造状态：§4.1 未覆盖的组合，本实现产 finding 且保存（钉 F-7 实现 A）', () => {
  const o = mkOut();
  checkConclusion(argNorm({ '@st': 'ABSENT' }, 'TERMINATED_BY_SCOPE', { '@st': 'ABSENT' }), o);
  assert.deepEqual(o.findings.map(f => f.code), ['DRAFT_STATE_CONCLUSION_MISMATCH']);
  assert.equal(o.findings[0].sev, 'DEFICIENCY', '对齐表未覆盖 → 缺陷而非拒写（SF-04 封闭五项之外必保存）');
});

// ===================================== 转移（AR-ID-1/2/4/6） =====================================

test('P2-09 结论转移：ABSENT→ASSERTS=补全修订（同 id）；NONE_DECLARED→ASSERTS=新论证；ASSERTS(P1)→ASSERTS(P2)=新论证（AR-ID-6/AR-ID-2/SS-15a）', () => {
  assert.equal(conclusionTransition({ conclusion: { '@st': 'ABSENT' } }, { conclusion: concl('ASSERTS') }), 'COMPLETION',
    '草稿从未声明结论端，不是 AR-ID-2 的"已声明值"变化');
  assert.equal(conclusionTransition({ conclusion: concl('NONE_DECLARED') }, { conclusion: concl('ASSERTS') }), 'NEW_ARGUMENTATION',
    '已声明的"无结论"被改掉 = 身份变化');
  assert.equal(conclusionTransition({ conclusion: concl('ASSERTS', P1) }, { conclusion: concl('ASSERTS', P2) }), 'NEW_ARGUMENTATION',
    'AR-ID-2「改变实际结论内容 → 新论证」：同 mode 换 proposition_rev 本体即新论证（F-1/F-6 已由裁决闭合）');
  assert.equal(conclusionTransition({ conclusion: concl('ASSERTS', P1) }, { conclusion: concl('ASSERTS', P1) }), 'NO_CHANGE', '配对正例');
});

test('P2-09b 首次登记=双参 (undefined, next) 按补全处理；单参调用是非法输入，不得返回"看似合法"的判断（AR-ID-6 末句；审查纠正 #6）', () => {
  assert.equal(conclusionTransition(undefined, { conclusion: concl('ASSERTS') }), 'COMPLETION',
    '「无 head（首次登记）按补全处理」的合法表达是把缺省显式传给 prev 参数');
  assert.equal(conclusionTransition({ conclusion: concl('ASSERTS', P1) }), 'ILLEGAL_INPUT',
    '转移判定必须有前后两版（AR-ID-2 比较的是内容）；单参调用旧版返回 COMPLETION 属"看似合法"，现必须 ILLEGAL_INPUT');
  assert.equal(conclusionTransition(undefined), 'ILLEGAL_INPUT', 'next 缺省同样非法');
});
test('P2-09c 仍未声明不是补全：ABSENT→ABSENT = NO_CHANGE，ABSENT→声明 = COMPLETION（父代理修正）', () => {
  assert.equal(conclusionTransition({ conclusion: { '@st': 'ABSENT' } }, { conclusion: { '@st': 'ABSENT' } }), 'NO_CHANGE',
    '补全要求本次真的声明了结论，否则"补全修订"这个标签会被滥用为任意空修订');
  assert.equal(conclusionTransition({ conclusion: { '@st': 'ABSENT' } }, { conclusion: { '@st': 'DECLARED', v: { mode: 'ASSERTS', proposition_rev: 'HPRO-p1@r1' } } }), 'COMPLETION');});


test('P2-10 构造状态转移：DRAFT→CLOSED_DRAFT 合法；曾提交者不得回落 CLOSED_DRAFT；SUBMITTED→WITHDRAWN 合法（AR-ID-4/§7）', () => {
  assert.equal(csTransition({ cs: 'DRAFT', submittedEver: false }, 'CLOSED_DRAFT').accepted, true, '从未提交过的草稿可停止推进');
  assert.deepEqual(csTransition({ cs: 'SUBMITTED', submittedEver: true }, 'CLOSED_DRAFT'),
    { accepted: false, code: 'F-CONFLICT' }, '已提交论证只能 WITHDRAWN / TERMINATED_BY_SCOPE');
  assert.equal(csTransition({ cs: 'WITHDRAWN', submittedEver: true }, 'CLOSED_DRAFT').accepted, false, '判"曾提交过"，不是只看 head 当前值');
  assert.equal(csTransition({ cs: 'SUBMITTED', submittedEver: true }, 'WITHDRAWN').accepted, true, '关闭≠撤回；撤回是生命周期修订');
});

test('P2-11 身份变化 → 要求新建，不得就地修订；非身份槽位变化 → 修订合法（SS-55/G-REV/EN-ID-8）', () => {
  const entry = reg.subtypes.PHYSICAL_OBJECT;
  const head = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt@r1', individual_ref: 'HENT-eA@r1' } }, description: cs('old') };
  const r1 = submitRevision(entry, head, { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt@r1', individual_ref: 'HENT-eB@r1' } } });
  assert.equal(r1.accepted, false);
  assert.equal(r1.code, 'F-CONFLICT');
  assert.match(r1.hint, /新建/, '拒绝并提示应新建对象（SS-55）');
  const r2 = submitRevision(entry, head, { description: cs('new') });
  assert.deepEqual(r2, { accepted: true, sameObjectIdRevision: true }, '别名/说明补全 = 修订（非身份构成）');
});

// ============================== 身份变化 × completion_basis（SS-55） ==============================

test('P2-13 completion_basis 三值都不得覆盖身份变化；UNKNOWN→DECLARED 补全合法（SS-55/EN-ID-6/RV-01）', () => {
  const entry = reg.subtypes.PHYSICAL_OBJECT;
  const head = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt@r1', individual_ref: 'HENT-eM@r1' } } };
  const changed = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt@r1', individual_ref: 'HENT-eN@r1' } } };
  for (const basis of ['SAME_INTENT_CONFIRMED', 'NEW_JUDGEMENT', 'UNDETERMINED']) {
    const r = submitRevision(entry, head, changed, basis);
    assert.equal(r.accepted, false, `${basis} 不得为同 ID 身份漂移放行（SS-55）`);
    assert.equal(r.basisIgnored, true, 'basis 不参与判定：身份判据不能由主张放宽');
  }
  const unkHead = { world_membership: { '@st': 'UNKNOWN', reason: 'NOT_SURVEYED' } };
  const done = submitRevision(entry, unkHead, { world_membership: { '@st': 'DECLARED', v: { individual_ref: 'HENT-eM@r1' } } }, 'SAME_INTENT_CONFIRMED');
  assert.equal(done.accepted, true, 'UNKNOWN→DECLARED 属原意确认 = 修订（EN-ID-6/RV-01）');
});

test('P2-14 只改 world_membership.kind_ref 是合法修订（SS-15a 后果封闭：分类位不构成身份变化；EN-W-6）', () => {
  const entry = reg.subtypes.PHYSICAL_OBJECT;
  const head = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt@r1', individual_ref: 'HENT-eM@r1' } } };
  const recl = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt2@r1', individual_ref: 'HENT-eM@r1' } } };
  const r = submitRevision(entry, head, recl);
  assert.equal(r.accepted, true, '「改 kind_ref 只是重新分类 → 修订」已由 SS-15a 明文收口（F-2 已裁）');
});

// ============================== 注册边界（SS-56 / SRG-13 / SS-13） ==============================

test('P2-15 未注册子型 → 候选载荷且无任何层级结果；DEPRECATED → 正常规范化 + CODE_DEPRECATED 而非候选（SS-56/SRG-13）', () => {
  const miss = mkOut();
  const r1 = ingest(env('ENTITY', 'WORLD_NOT_REG', {}), { description: cs('x') }, reg, miss);
  assert.equal(r1.refused, false);
  assert.equal(miss.candidate, true, '候选载荷：原样保存键值+信封+来源（SS-56）');
  assert.deepEqual(miss.findings.map(f => f.code), ['SUBTYPE_UNREGISTERED']);
  assert.equal(miss.findings[0].sev, 'DEFICIENCY');
  assert.equal(hierarchy(miss, { description: cs('x') }, reg.subtypes.WORLD_NOT_REG), null,
    '不获得任何正式 S-L1/R-L1 层级结果——非 PASS、非 NOT_APPLICABLE、非 INDETERMINATE（SS-56）');
  // 配对正例：解析得到的退役码绝不落入候选态
  const dep = ok('ENTITY', 'OLD_THING', { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt@r1', individual_ref: 'HENT-eA@r1' } } });
  assert.equal(dep.o.candidate, false, '候选态只针对"解析不到"（SRG-13）');
  assert.deepEqual(dep.o.findings.map(f => f.code), ['CODE_DEPRECATED']);
  assert.equal(dep.o.findings[0].sev, 'DEFICIENCY', '提示而非阻断（DF-07）');
  assert.deepEqual(Object.keys(dep.norm).sort(), [...reg.subtypes.OLD_THING.slot_set].sort(), '槽位集与白名单俱在：正常规范化');
  assert.notEqual(hierarchy(dep.o, dep.norm, reg.subtypes.OLD_THING), null, '层级结果照常归约（SCR-77：零适用规则=INDETERMINATE，不冒充 PASS）');
});

// ================================= 摘要重放（SS-12 / SF-52a） =================================

test('P2-16 identity_slot_set_digest 按当时声明可重算且稳定；不随记录内容变（SS-12/SS-15a）', () => {
  const decl = reg.subtypes.WORLD_ROOT.identity_slots;            // 摘要输入 = 引用位名序列（SS-15a）
  const d1 = slotSetDigest(decl);
  const d2 = slotSetDigest(decl);
  assert.deepEqual(d1, d2, '同一声明重放两次逐字节一致');
  const d3 = slotSetDigest(['subtype_code', 'world_membership.individual_ref']);   // 声明变了（豁免撤销后的全集）
  assert.notEqual(d1.hex, d3.hex, '摘要对象是引用位名集合：声明变更必须换摘要');
  const replay = rec => slotSetDigest(reg.subtypes.WORLD_ROOT.identity_slots).hex === rec.identity_slot_set_digest;
  const envelope = { object_id: 'HENT-w1', description: cs('v1'), identity_slot_set_digest: d1.hex };
  const envelope2 = { object_id: 'HENT-w1', description: cs('v2'), identity_slot_set_digest: d1.hex };   // 同对象内容修订
  assert.equal(replay(envelope), true);
  assert.equal(replay(envelope2), true, '内容变了不改 identity_slot_set_digest（它是当时的声明，不是内容）');
});

test('P2-17 排除集含摘要键本身时结果不循环：d = H(canonical(object − {self}))（SF-52a）', () => {
  const rec = { object_id: 'HENT-e1', object_kind: 'ENTITY', identity_slot_set_digest: { alg: 'sha256', hex: 'aa' } };
  const { identity_slot_set_digest, ...without } = rec;
  assert.equal(digest(rec, ['identity_slot_set_digest']).hex, digest(without, []).hex, '排除自摘要键 = 无该键时的摘要');
  const a = { ...without, record_digest: 'a'.repeat(64) };
  const b = { ...without, record_digest: 'b'.repeat(64) };
  assert.equal(digest(a, ['record_digest']).hex, digest(b, ['record_digest']).hex, 'record_digest 取值不参与自身摘要（排除集=恰 {record_digest}）');
});

test('P2-18 同一引用位名集合不同声明顺序/重复 → 同一摘要（SS-15a：输入=去重并排序后的引用位名序列；F-3 已闭合）', () => {
  const dA = slotSetDigest(['subtype_code', 'world_membership.individual_ref']);
  const dB = slotSetDigest(['world_membership.individual_ref', 'subtype_code', 'subtype_code']);
  assert.equal(dA.hex, dB.hex, '「按当时的声明重放」不得依赖注册表条目字节序');
});

// ============================ 变异断言：错误实现必被用例集抓住 ============================

/** 变异体 A —— 父槽位冒充子路径：豁免项与前缀容忍匹配（第一轮 core 犯过的错，审查纠正 #5） */
function checkSubtypeEntryPrefix(entry, reg2, out) {
  const base = reg2.identitySlots[entry.kind] || [];
  const inBase = s => base.some(b => b === s || b.startsWith(s + '.'));
  const ruling = s => Object.entries(reg2.contractRulings).find(([k]) => k === s || k.startsWith(s + '.'))?.[1] || [];
  const exempt = (entry.identity_slot_exemptions || []).map(e => {
    if (!ruling(e.slot).includes(e.cited_rule)) { out.badEntry(entry.subtype_code, 'EXEMPTION_NOT_ADJUDICATED'); return null; }
    if (!inBase(e.slot)) { out.badEntry(entry.subtype_code, 'EXEMPTION_OUTSIDE_BASE'); return null; }
    return e.slot;
  }).filter(Boolean);
  if (entry.identity_slots.length === 0 && base.length > exempt.length) out.badEntry(entry.subtype_code, 'IDENTITY_SLOTS_EMPTIED');
  for (const s of base)
    if (!exempt.some(x => s === x || s.startsWith(x + '.')) && !entry.identity_slots.includes(s))
      out.badEntry(entry.subtype_code, 'IDENTITY_SLOT_DROPPED');
}
/** 变异体 B —— 豁免不需要援引契约号：只要槽名在基类里就直接放行（"子型不得自行宣布豁免"失效） */
function checkSubtypeEntryNoCite(entry, reg2, out) {
  const base = reg2.identitySlots[entry.kind] || [];
  const exempt = (entry.identity_slot_exemptions || []).map(e => {
    if (!base.includes(e.slot)) { out.badEntry(entry.subtype_code, 'EXEMPTION_OUTSIDE_BASE'); return null; }
    return e.slot;
  }).filter(Boolean);
  if (entry.identity_slots.length === 0 && base.length > exempt.length) out.badEntry(entry.subtype_code, 'IDENTITY_SLOTS_EMPTIED');
  for (const s of base) if (!exempt.includes(s) && !entry.identity_slots.includes(s)) out.badEntry(entry.subtype_code, 'IDENTITY_SLOT_DROPPED');
}
/** 变异体 C —— 转移只看声明形态不看 proposition_rev 本体（旧 core；与 AR-ID-2「改变实际结论内容」不符） */
function transitionModeOnly(prevNorm, nextNorm) {
  if (nextNorm === undefined) return 'ILLEGAL_INPUT';
  const ps = prevNorm?.conclusion?.['@st'], ns = nextNorm.conclusion?.['@st'];
  if (prevNorm === undefined || ps === undefined || ps === 'ABSENT') return 'COMPLETION';
  if (ps === 'DECLARED' && ns === 'DECLARED')
    return prevNorm.conclusion.v.mode !== nextNorm.conclusion.v.mode ? 'NEW_ARGUMENTATION' : 'NO_CHANGE';
  if (ps === 'DECLARED' && ns === 'ABSENT') return 'ILLEGAL_WITHDRAWAL';
  return 'NO_CHANGE';
}

const ENTRY_CASES = [
  ['合法逐字豁免（WORLD_ROOT）', reg.subtypes.WORLD_ROOT],
  ['父槽位冒充子路径（world_membership←EN-W-7）', { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_FAKE',
    identity_slot_exemptions: [{ slot: 'world_membership', cited_rule: 'EN-W-7' }] }],
  ['援引不存在的规则号（EN-W-99）', { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_BAD',
    identity_slot_exemptions: [{ slot: 'world_membership.individual_ref', cited_rule: 'EN-W-99' }] }],
  ['借豁免整体置空', { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_EMPTY', identity_slots: [],
    identity_slot_exemptions: [{ slot: 'world_membership.individual_ref', cited_rule: 'EN-W-7' }] }],
  ['阅读名 entity_subtype 混入条目', { ...reg.subtypes.PHYSICAL_OBJECT, subtype_code: 'PO_ALIAS',
    identity_slots: ['entity_subtype', 'world_membership.individual_ref'] }],
];
const sig = (fn, entry) => { const o = mkOut(); fn(entry, reg, o); return o.badEntries.map(b => b.code).sort().join(','); };
const divergences = (mutant) => ENTRY_CASES
  .map(([name, e]) => ({ name, doc: sig(checkSubtypeEntry, e), mutant: sig(mutant, e) }))
  .filter(r => r.doc !== r.mutant);

const TRANSITION_CASES = [
  ['ABSENT→ASSERTS（补全）', { conclusion: { '@st': 'ABSENT' } }, { conclusion: concl('ASSERTS') }],
  ['NONE_DECLARED→ASSERTS（新论证）', { conclusion: concl('NONE_DECLARED') }, { conclusion: concl('ASSERTS') }],
  ['ASSERTS(P1)→ASSERTS(P2)（改变实际结论内容）', { conclusion: concl('ASSERTS', P1) }, { conclusion: concl('ASSERTS', P2) }],
  ['ASSERTS(P1)→ASSERTS(P1)（无变化）', { conclusion: concl('ASSERTS', P1) }, { conclusion: concl('ASSERTS', P1) }],
];

test('P2-19a 变异"父槽位冒充子路径"（前缀容忍）必须被我的豁免用例集抓住（SS-15a/审查纠正 #5）', () => {
  // 先钉文档判据本身：每条非法条目都被 core 抓住，合法条目 0 判罚
  assert.equal(sig(checkSubtypeEntry, ENTRY_CASES[0][1]), '', '合法逐字豁免不得有判罚');
  for (const [, e] of ENTRY_CASES.slice(1))
    assert.notEqual(sig(checkSubtypeEntry, e), '', `${e.subtype_code} 必须被判条目非法`);
  const d = divergences(checkSubtypeEntryPrefix);
  assert.ok(d.some(x => x.name.includes('冒充') && x.doc !== '' && x.mutant === ''),
    '前缀容忍变体必须在"父槽位冒充子路径"一行放行文档判非法的条目 ⇒ 用例集抓住了它');
});

test('P2-19b 变异"豁免不需要援引契约号"必须被 EN-W-99 用例抓住（SS-54：核验援引是否成立）', () => {
  const d = divergences(checkSubtypeEntryNoCite);
  assert.ok(d.some(x => x.name.includes('EN-W-99') && x.doc.includes('EXEMPTION_NOT_ADJUDICATED') && x.mutant === ''),
    '不核验援引的变体把虚构规则号当合法豁免 ⇒ 用例集抓住了它');
});

test('P2-19c 变异"转移只看声明形态不看 proposition_rev"必须被 ASSERTS(P1)→ASSERTS(P2) 用例抓住（AR-ID-2）', () => {
  const d = TRANSITION_CASES
    .map(([name, p, n]) => ({ name, doc: conclusionTransition(p, n), mutant: transitionModeOnly(p, n) }))
    .filter(r => r.doc !== r.mutant);
  assert.deepEqual(d.map(x => x.name), ['ASSERTS(P1)→ASSERTS(P2)（改变实际结论内容）'],
    '旧判据把换命题修订当 NO_CHANGE，与文档判据（core）恰好在这一条裁决过的转移上分歧 ⇒ 用例集抓住了它');
});
