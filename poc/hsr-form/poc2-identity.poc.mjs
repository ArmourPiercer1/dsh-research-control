/**
 * PoC-2 身份、修订与注册：根世界（EN-W-7/SS-54）、受控豁免、结论×构造状态（AR-ID-6/§4.1）、
 * 转移（AR-ID-1/2/4/6）、身份变化与 completion_basis（SS-55/EN-ID-6）、注册边界（SS-56/SRG-13）、
 * 摘要重放（SS-12/SF-52a）。判据注明文档规则号，反查忠实度；**红 = 发现**，逐条见 FINDINGS-poc2.md。
 * 夹具自含（不 import poc1：那会把它的测试一起收进本文件）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest, expand, checkTagged, isTagged, checkSubtypeEntry, checkSingleton,
  checkConclusion, conclusionTransition, digest, canonical, reduceLevel, slotSetDigest } from './core.mjs';

// ---- 夹具：契约层事实写成数据（poc1 约定） --------------------------------------
const envelopeKeys = ['object_id', 'object_kind', 'schema_version', 'subtype_code', 'space_id',
  'source_refs', 'registrant_ref', 'recorded_at', 'boundary'];
export const reg = {
  kinds: ['ENTITY', 'CONCEPT', 'ASSOCIATION', 'ARGUMENTATION', 'PROPOSITION'],
  envelopeKeys,
  nameAlias: { entity_subtype: 'subtype_code' },                      // SS-09a
  // 契约层身份构成表（Entity 契约 §4，槽粒度）。比较名空间取**契约阅读名**（`entity_subtype`），
  // 与 poc1 夹具（归一名 `subtype_code`）**不**一致——同一判据两种夹具都过 = 名空间未定，见 FINDINGS F-10。
  identitySlots: { ENTITY: ['world_membership.individual_ref', 'subtype_code'] },  // SS-15a 裁决后：引用位形态，子路径按契约原文,
  // SS-54 当前唯一契约裁定项：world_membership ← EN-W-7（锚定写法见 FINDINGS F-4）
  contractRulings: { world_membership: ['EN-W-7'] },
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
  _default: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: false },
};
const C = s => contracts[s] || contracts._default;

// WORLD_ROOT（EN-W-7）：slot_set 不含 world_membership；identity_slots = 基类减去 EN-W-7 豁免项；
// WorldType 分类由条目 kind + subtype_code 承载，singleton: true。
S('WORLD_ROOT', 'ENTITY', ['aliases', 'description'], {
  identity_slots: ['subtype_code'], exempt: [{ slot: 'world_membership.individual_ref', cited_rule: 'EN-W-7' }], singleton: true,
});
S('PHYSICAL_OBJECT', 'ENTITY', ['world_membership', 'aliases', 'description'], { identity_slots: ['world_membership.individual_ref', 'subtype_code'] });
S('OLD_THING', 'ENTITY', ['world_membership', 'description'], { identity_slots: ['world_membership.individual_ref', 'subtype_code'], status: 'DEPRECATED' });
S('ARG_FORM', 'ARGUMENTATION', ['scheme_ref', 'engagement_target', 'conclusion', 'construction_state', 'local_outcome']);

const mkOut = () => ({ findings: [], badEntries: [], refused: null, candidate: false,
  fail(code, msg, sev = 'VIOLATION') { this.findings.push({ code, msg, sev }); },
  badEntry(sub, code) { this.badEntries.push({ sub, code }); } });
const env = (kind, sub, extra = {}) => ({ object_id: 'o1', object_kind: kind, schema_version: '1.0',
  subtype_code: sub, space_id: 'sp1', source_refs: { '@st': 'DECLARED', v: ['rec:1'] },
  registrant_ref: { '@st': 'DECLARED', v: 'agt:me' }, recorded_at: 1,
  boundary: { coverage: 'COMPLETE', truncated: false, limit_applied: 50 }, ...extra });
const ok = (kind, sub, payload, extra) => {                      // 入口 → 规范化 → 五态检查（同 poc1）
  const o = mkOut();
  const r = ingest(env(kind, sub, extra), payload, reg, o);
  const entry = reg.subtypes[sub];
  const norm = entry ? expand(entry, payload) : payload;
  if (entry && !r.refused) for (const s of entry.slot_set) checkTagged(s, norm[s], C(s), o);
  return { r, o, norm, entry };
};
const cs = v => ({ '@st': 'DECLARED', v });
const concl = m => ({ '@st': 'DECLARED', v: { mode: m, proposition_rev: m === 'NONE_DECLARED' ? null : 'p:1@1' } });
const argNorm = (conclusion, construction_state, local_outcome) => ({
  conclusion, construction_state: cs(construction_state), local_outcome });

// ---- 测试内实现（core 未提供判据者，按文档逐字编码；偏离即红） --------------------
/**
 * SS-55 × G-REV × RV-04：变化集触及 identity_slots 中 head **已声明**的值 → F-CONFLICT 拒绝并提示新建，
 * completion_basis（含 SAME_INTENT_CONFIRMED）不参与判定。UNKNOWN/ABSENT → DECLARED 属补全（EN-ID-6/RV-01）。
 * 粒度：按 identity_slots 的**槽名**整值比较——文档未给子路径粒度，见 FINDINGS F-2。
 */
function submitRevision(entry, head, payload, completionBasis) {
  for (const s of entry.identity_slots) {
    const root = s.split('.')[0];                    // SS-15a：引用位 = 根槽名 + 子路径
    const h = head?.[root];
    if (h?.['@st'] !== 'DECLARED') continue;                                   // 未触及"已声明"值
    const n = payload[root];
    if (!isTagged(n) || n['@st'] !== 'DECLARED') continue;                     // 未提交 = 无变化
    // SS-15a 裁决后：比较的是"契约点名的引用位"，不是整槽
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
 *  DEPRECATED 走正常规范化，层级结果照常归约（RPT-02）。 */
function hierarchy(o, norm, entry) {
  if (!entry || o.candidate) return null;
  const tagged = entry.slot_set.every(s => isTagged(norm[s]));
  return reduceLevel(tagged ? [] : ['FAIL']);
}
/** SS-12：摘要对象 = 注册表条目声明的身份构成**槽名集合**（不是记录内容）。承载形态文档未定，取 {slots:[…]}。 */
// 局部版本已删：SS-12 裁决后摘要输入 = 去重排序序列，统一用 core 的 slotSetDigest，避免两处真源

// ================================ 根世界（EN-W-7 × SS-54） ================================

test('P2-01 根世界最小正例：slot_set 不含 world_membership、identity_slots=基类−EN-W-7 豁免 → 条目合法且形态合法（EN-W-7/SS-54）', () => {
  const o = mkOut();
  checkSubtypeEntry(reg.subtypes.WORLD_ROOT, reg, o);
  assert.deepEqual(o.badEntries, [], '受控豁免合法：从超集减去契约点名的一项（SS-54）');
  assert.deepEqual(reg.subtypes.WORLD_ROOT.slot_set.includes('world_membership'), false, '缺槽位是类型层事实（EN-W-7）');
  assert.deepEqual(reg.subtypes.WORLD_ROOT.identity_slots, ['subtype_code'], '基类身份槽位 − EN-W-7 豁免项（SS-15a 裁决后只用规范键名）');
  const a = ok('ENTITY', 'WORLD_ROOT', {});
  assert.equal(a.r.refused, false, '形态合法');
  assert.deepEqual(a.o.findings, [], '不触发缺槽位判定（缺槽判定输入=slot_set，非全局清单）');
  // 负例配对：WorldType 分类由注册表 kind+subtype_code 承载，不得在载荷里再造一份
  assert.equal(ok('ENTITY', 'WORLD_ROOT', { kind_ref: { '@st': 'DECLARED', v: 'c:wt' } }).r.code, 'UNKNOWN_KEY_IN_PAYLOAD');
});

test('P2-02 同 space 第二个 WORLD_ROOT：保存不阻断 + SINGLETON_SUBTYPE_DUPLICATE；异 space 无 finding（EN-W-7）', () => {
  const store = [];
  const save = (space, seq) => {
    const e = env('ENTITY', 'WORLD_ROOT', { space_id: space, object_id: `o${seq}` });
    const o = mkOut();
    const r = ingest(e, {}, reg, o);
    checkSingleton(store, e, reg, o);
    store.push({ env: e });                                     // 保存不阻断：入库照做
    return { r, o };
  };
  const first = save('sp1', 1);
  assert.deepEqual(first.o.findings.map(f => f.code), [], '首个根世界合法');
  const dup = save('sp1', 2);
  assert.deepEqual(dup.o.findings.map(f => f.code), ['SINGLETON_SUBTYPE_DUPLICATE']);
  assert.equal(dup.o.findings[0].sev, 'VIOLATION');
  assert.equal(dup.r.refused, false, '不拒写');
  assert.equal(store.length, 2, '不静默合并');
  const other = save('sp2', 3);
  assert.deepEqual(other.o.findings.map(f => f.code), [], '谓词按 (space_id, subtype_code)：异 space 不是重复');
});

test('P2-03 豁免援引不到契约规则号 → 条目非法（不得启用）；援引 EN-W-7 成立则合法（SS-54）', () => {
  const bad = { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_BAD',
    identity_slot_exemptions: [{ slot: 'world_membership', cited_rule: 'EN-W-99' }] };
  const o = mkOut();
  checkSubtypeEntry(bad, reg, o);
  assert.ok(o.badEntries.map(b => b.code).includes('EXEMPTION_NOT_ADJUDICATED'), '子型不得自行宣布豁免');
  const good = mkOut();
  checkSubtypeEntry(reg.subtypes.WORLD_ROOT, reg, good);
  assert.deepEqual(good.badEntries, [], '同一豁免换真援引号即合法——核验的是援引是否成立');
});

test('P2-03b 豁免项照 EN-W-7 原文写成子路径 `world_membership.individual_ref` → core 判非法（红：豁免项书写形态未定，F-4）', () => {
  const lit = { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_LIT',
    identity_slot_exemptions: [{ slot: 'world_membership.individual_ref', cited_rule: 'EN-W-7' }] };
  const o = mkOut();
  checkSubtypeEntry(lit, reg, o);
  // EN-W-7 逐字：「当前唯一已裁项：world_membership.individual_ref ← EN-W-7」。照原文写豁免应成立。
  assert.deepEqual(o.badEntries, [], '照契约原文书写的受控豁免应被核验通过');
});

test('P2-04 豁免不得用来整体置空 identity_slots → 条目非法；只减一项则合法（SS-54）', () => {
  const emptied = { ...reg.subtypes.WORLD_ROOT, subtype_code: 'WORLD_ROOT_EMPTY',
    identity_slots: [], identity_slot_exemptions: [{ slot: 'world_membership', cited_rule: 'EN-W-7' }] };
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
  assert.deepEqual(good.findings, []);
});

test('P2-08 ABSENT × 非 DRAFT 构造状态：§4.1 未覆盖的组合，本实现产 finding 且保存（钉 F-7 实现 A）', () => {
  const o = mkOut();
  checkConclusion(argNorm({ '@st': 'ABSENT' }, 'TERMINATED_BY_SCOPE', { '@st': 'ABSENT' }), o);
  assert.deepEqual(o.findings.map(f => f.code), ['DRAFT_STATE_CONCLUSION_MISMATCH']);
  assert.equal(o.findings[0].sev, 'DEFICIENCY', '对齐表未覆盖 → 缺陷而非拒写（SF-04 封闭五项之外必保存）');
});

// ===================================== 转移（AR-ID-1/2/4/6） =====================================

test('P2-09 结论转移：ABSENT→ASSERTS=补全修订（同 id）；NONE_DECLARED→ASSERTS=新论证（AR-ID-6/AR-ID-1/AR-ID-2）', () => {
  assert.equal(conclusionTransition({ conclusion: { '@st': 'ABSENT' } }), 'COMPLETION', '草稿从未声明结论端，不是 AR-ID-2 的"已声明值"变化');
  assert.equal(conclusionTransition({ conclusion: concl('NONE_DECLARED') }), 'NEW_ARGUMENTATION', '已声明的"无结论"被改掉 = 身份变化');
});

test('P2-09b 无 head（首次登记）按补全处理（红：core 判据缺省形态与 AR-ID-6 不符，F-6）', () => {
  // AR-ID-6 末句：「无 head（首次登记）按补全处理」。core.conclusionTransition(prevNorm) 直接取
  // prevNorm.conclusion → 无 head 即 TypeError，缺省行为落在判据之外。按其契约断言文档行为：
  assert.equal(conclusionTransition(undefined), 'COMPLETION');
});

test('P2-10 构造状态转移：DRAFT→CLOSED_DRAFT 合法；曾提交者不得回落 CLOSED_DRAFT；SUBMITTED→WITHDRAWN 合法（AR-ID-4/§7）', () => {
  assert.equal(csTransition({ cs: 'DRAFT', submittedEver: false }, 'CLOSED_DRAFT').accepted, true, '从未提交过的草稿可停止推进');
  assert.deepEqual(csTransition({ cs: 'SUBMITTED', submittedEver: true }, 'CLOSED_DRAFT'),
    { accepted: false, code: 'F-CONFLICT' }, '已提交论证只能 WITHDRAWN / TERMINATED_BY_SCOPE');
  assert.equal(csTransition({ cs: 'WITHDRAWN', submittedEver: true }, 'CLOSED_DRAFT').accepted, false, '判"曾提交过"，不是只看 head 当前值');
  assert.equal(csTransition({ cs: 'SUBMITTED', submittedEver: true }, 'WITHDRAWN').accepted, true, '关闭≠撤回；撤回是生命周期修订');
});

test('P2-11 身份变化 → 要求新建，不得就地修订；非身份槽位变化 → 修订合法（SS-55/G-REV/EN-ID-8）', () => {
  const entry = reg.subtypes.PHYSICAL_OBJECT;
  const head = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'c:wt@1', individual_ref: 'e:wA@1' } }, description: cs('old') };
  const r1 = submitRevision(entry, head, { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'c:wt@1', individual_ref: 'e:wB@1' } } });
  assert.equal(r1.accepted, false);
  assert.equal(r1.code, 'F-CONFLICT');
  assert.match(r1.hint, /新建/, '拒绝并提示应新建对象（SS-55）');
  const r2 = submitRevision(entry, head, { description: cs('new') });
  assert.deepEqual(r2, { accepted: true, sameObjectIdRevision: true }, '别名/说明补全 = 修订（非身份构成）');
});

test('P2-11b NONE_DECLARED 论证的 WITHDRAWN 生命周期修订不应新增 finding（红：§4.1 表 × AR-ID-4 冲突，F-5）', () => {
  const o = mkOut();
  checkConclusion(argNorm(concl('NONE_DECLARED'), 'WITHDRAWN', cs('INCONCLUSIVE')), o);
  // AR-ID-4：构造状态变化是生命周期修订，"不改变身份，也不改变任何其它状态轴"——
  // 声明时合法的 NONE_DECLARED+INCONCLUSIVE 不因后续 WITHDRAWN 被判违规。
  assert.deepEqual(o.findings, [], '生命周期修订不得使旧声明形态变违规（§4.1 的 SUBMITTED 是声明时对齐，不是永久约束）');
});

test('P2-12 转移判定的输入面：仅 head 不足以判"改变实际结论内容 → 新论证"（红：core 判据与 AR-ID-2 不符，F-1）', () => {
  const head = { conclusion: concl('ASSERTS') };
  const submission = { conclusion: { '@st': 'DECLARED', v: { mode: 'ASSERTS', proposition_rev: 'p:2@1' } } };
  // AR-ID-2：改变实际结论内容 → 新论证。AR-ID-6：判别输入 = 本次提交载荷 + head 载荷（输入是现成的）。
  // core.conclusionTransition 只收 head：ASSERTS→* 一律 COMPLETION，无法表达 AR-ID-2。按其契约（转移类型）断言文档行为：
  assert.equal(conclusionTransition(head, submission), 'NEW_ARGUMENTATION');
});

// ============================== 身份变化 × completion_basis（SS-55） ==============================

test('P2-13 completion_basis 三值都不得覆盖身份变化；UNKNOWN→DECLARED 补全合法（SS-55/EN-ID-6/RV-01）', () => {
  const entry = reg.subtypes.PHYSICAL_OBJECT;
  const head = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'c:wt@1', individual_ref: 'e:M@1' } } };
  const changed = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'c:wt@1', individual_ref: 'e:M′@1' } } };
  for (const basis of ['SAME_INTENT_CONFIRMED', 'NEW_JUDGEMENT', 'UNDETERMINED']) {
    const r = submitRevision(entry, head, changed, basis);
    assert.equal(r.accepted, false, `${basis} 不得为同 ID 身份漂移放行（SS-55）`);
    assert.equal(r.basisIgnored, true, 'basis 不参与判定：身份判据不能由主张放宽');
  }
  const unkHead = { world_membership: { '@st': 'UNKNOWN', reason: 'NOT_SURVEYED' } };
  const done = submitRevision(entry, unkHead, { world_membership: { '@st': 'DECLARED', v: { individual_ref: 'e:M@1' } } }, 'SAME_INTENT_CONFIRMED');
  assert.equal(done.accepted, true, 'UNKNOWN→DECLARED 属原意确认 = 修订（EN-ID-6/RV-01）');
});

test('P2-14 只改 world_membership.kind_ref 应仍是修订（红：SS-55 槽粒度 × Entity 契约子路径身份冲突，F-2）', () => {
  const entry = reg.subtypes.PHYSICAL_OBJECT;
  const head = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'c:wt@1', individual_ref: 'e:M@1' } } };
  const recl = { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'c:wt@2', individual_ref: 'e:M@1' } } };
  // Entity 契约 §4：「改 kind_ref 只是重新分类 → 修订」；EN-W-1：只有 individual_ref 构成身份。
  const r = submitRevision(entry, head, recl);
  assert.equal(r.accepted, true, 'kind_ref 重新分类不是身份变化');
});

// ============================== 注册边界（SS-56 / SRG-13 / SRG-12） ==============================

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
  const dep = ok('ENTITY', 'OLD_THING', { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'c:wt@1', individual_ref: 'e:wA@1' } } });
  assert.equal(dep.o.candidate, false, '候选态只针对"解析不到"（SRG-13）');
  assert.deepEqual(dep.o.findings.map(f => f.code), ['CODE_DEPRECATED']);
  assert.equal(dep.o.findings[0].sev, 'DEFICIENCY', '提示而非阻断（DF-07）');
  assert.deepEqual(Object.keys(dep.norm).sort(), [...reg.subtypes.OLD_THING.slot_set].sort(), '槽位集与白名单俱在：正常规范化');
  assert.notEqual(hierarchy(dep.o, dep.norm, reg.subtypes.OLD_THING), null, '层级结果照常归约');
});

// ================================= 摘要重放（SS-12 / SF-52a） =================================

test('P2-16 identity_slot_set_digest 按当时声明可重算且稳定；不随记录内容变（SS-12）', () => {
  const d1 = slotSetDigest(reg.subtypes.WORLD_ROOT);
  const d2 = slotSetDigest(reg.subtypes.WORLD_ROOT);
  assert.deepEqual(d1, d2, '同一声明重放两次逐字节一致');
  const d3 = slotSetDigest({ identity_slots: ['entity_subtype', 'world_membership'] });   // 声明变了（子型新版本）
  assert.notEqual(d1.hex, d3.hex, '摘要对象是槽名集合：声明变更必须换摘要');
  const content = { object_id: 'o1', description: cs('v1') };
  const content2 = { object_id: 'o1', description: cs('v2') };   // 同对象的内容修订
  // 重放 = 「按当时声明重算 ↔ 信封记载值」，摘要输入不含记录内容：两个修订重放判定同为一致（SS-12）
  const replay = rec => slotSetDigest(reg.subtypes.WORLD_ROOT).hex === rec.identity_slot_set_digest;
  const envelope = { ...content, identity_slot_set_digest: d1.hex };
  const envelope2 = { ...content2, identity_slot_set_digest: d1.hex };
  assert.equal(replay(envelope), true);
  assert.equal(replay(envelope2), true, '内容变了不改 identity_slot_set_digest（它是当时的声明，不是内容）');
});

test('P2-17 排除集含摘要键本身时结果不循环：d = H(canonical(object − {self}))（SF-52a）', () => {
  const rec = { object_id: 'o1', object_kind: 'ENTITY', identity_slot_set_digest: { alg: 'sha256', hex: 'aa' } };
  const { identity_slot_set_digest, ...without } = rec;
  assert.equal(digest(rec, ['identity_slot_set_digest']).hex, digest(without, []).hex, '排除自摘要键 = 无该键时的摘要');
  const a = { ...without, record_digest: 'a'.repeat(64) };
  const b = { ...without, record_digest: 'b'.repeat(64) };
  assert.equal(digest(a, ['record_digest']).hex, digest(b, ['record_digest']).hex, 'record_digest 取值不参与自身摘要（排除集=恰 {record_digest}）');
});

test('P2-18 同一槽名集合不同声明顺序 → 同一摘要（红：SS-12"集合"× SF-50 数组保序未闭合，F-3）', () => {
  // SS-12 裁决后：摘要输入 = 去重并排序后的引用位名序列（slotSetDigest），不是原样数组
  const dA = slotSetDigest({ identity_slots: ['subtype_code', 'world_membership.individual_ref'] });
  const dB = slotSetDigest({ identity_slots: ['world_membership.individual_ref', 'subtype_code', 'subtype_code'] });
  // SS-12 的摘要对象是"槽名**集合**"：同一集合应得同一摘要，否则"按当时的声明重放"依赖注册表条目字节序。
  assert.equal(dA.hex, dB.hex);
});
