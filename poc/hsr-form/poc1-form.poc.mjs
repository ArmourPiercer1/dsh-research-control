/**
 * PoC-1 对象形态与五态：五类各一个最小合法实例 + 空集合 / UNKNOWN / ABSENT /
 * 错误标签 / 缺必填 的保存与规范化结果。审查指定：不依赖底层架构。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest, expand, checkTagged, isTagged } from './core.mjs';

// ---- 夹具：把文档里的槽位契约写成数据（★=身份槽位，NA 列 = na_allowed） --------------
const envelopeKeys = ['object_id', 'object_kind', 'schema_version', 'subtype_code', 'space_id',
  'source_refs', 'registrant_ref', 'recorded_at', 'boundary'];
export const reg = {
  kinds: ['ENTITY', 'CONCEPT', 'ASSOCIATION', 'ARGUMENTATION', 'PROPOSITION'],
  envelopeKeys,
  nameAlias: { entity_subtype: 'subtype_code', concept_subtype: 'subtype_code', proposition_subtype: 'subtype_code' }, // SS-09a
  identitySlots: { ENTITY: ['world_membership', 'entity_subtype'], CONCEPT: ['concept_subtype'] },
  contractRulings: { world_membership: ['EN-W-7'] },
  subtypes: {},
};
const S = (code, kind, slots, over = {}) => reg.subtypes[code] = {
  subtype_code: code, kind, slot_set: slots, identity_slots: over.identity_slots ?? [],
  identity_slot_exemptions: over.exempt ?? [], status: over.status ?? 'ACTIVE', singleton: !!over.singleton,
};
// 每槽位契约：required（语义必填）/ na_allowed / na_reasons / empty_allowed（§5.2 机器可读表）
export const contracts = {
  aliases: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: true },          // 空合法
  description: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: false },     // 空串非法
  world_membership: { na_allowed: false, na_reasons: [], empty_allowed: false },
  construction_state: { na_allowed: false, na_reasons: [], empty_allowed: false },
  conclusion: { na_allowed: false, na_reasons: [], empty_allowed: false },
  _default: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: false },
};
const C = s => contracts[s] || contracts._default;

// 注意：entity_subtype **不在** slot_set 内——P1-1 修复后它由信封承载（SS-09a）
S('PHYSICAL_OBJECT', 'ENTITY', ['world_membership', 'aliases', 'description'], { identity_slots: ['world_membership', 'subtype_code'] });
S('CONCEPT_PLAIN', 'CONCEPT', ['alt_labels', 'definition'], { identity_slots: ['subtype_code'] });
S('ASS_REL', 'ASSOCIATION', ['relation_type_ref', 'participants', 'described_interval', 'applicability_context']);
S('ARG_SCHEME', 'ARGUMENTATION', ['scheme_ref', 'engagement_target', 'conclusion', 'construction_state', 'local_outcome']);
S('PROP_PLAIN', 'PROPOSITION', ['statement']);

const mkOut = () => ({ findings: [], refused: null, candidate: false,
  fail(code, msg, sev = 'VIOLATION') { this.findings.push({ code, msg, sev }); } });
const env = (kind, sub, extra = {}) => ({ object_id: 'o1', object_kind: kind, schema_version: '1.0',
  subtype_code: sub, space_id: 'sp1', source_refs: { '@st': 'DECLARED', v: ['rec:1'] },
  registrant_ref: { '@st': 'DECLARED', v: 'agt:me' }, recorded_at: 1,
  boundary: { coverage: 'COMPLETE', truncated: false, limit_applied: 50 }, ...extra });  // SS-15a 第①③类不带标签
const ok = (kind, sub, payload, extra) => {
  const o = mkOut();
  const r = ingest(env(kind, sub, extra), payload, reg, o);
  const entry = reg.subtypes[sub];
  const norm = entry ? expand(entry, payload) : payload;
  if (entry && !r.refused) for (const s of entry.slot_set) checkTagged(s, norm[s], C(s), o);   // SF-11/SF-14/SF-16/SF-17
  return { r, o, norm };
};

test('P1-1 五类最小合法实例：不拒写，规范形态槽位穷尽且全部带状态标签', () => {
  const cases = [
    ['ENTITY', 'PHYSICAL_OBJECT', { world_membership: { '@st': 'DECLARED', v: { kind_ref: null, individual_ref: 'e:root' } } }],
    ['CONCEPT', 'CONCEPT_PLAIN', {}],
    ['ASSOCIATION', 'ASS_REL', { relation_type_ref: { '@st': 'DECLARED', v: 'c:r' }, participants: { '@st': 'DECLARED', v: ['e:a', 'e:b'] } }],
    ['ARGUMENTATION', 'ARG_SCHEME', { scheme_ref: { '@st': 'DECLARED', v: 'c:s' }, engagement_target: { '@st': 'DECLARED', v: 'p:1@1' } }],
    ['PROPOSITION', 'PROP_PLAIN', { statement: { '@st': 'DECLARED', v: 's' } }],
  ];
  for (const [k, s, p] of cases) {
    const { r, norm } = ok(k, s, p);
    assert.equal(r.refused, false, `${s} 不应被拒写`);
    assert.deepEqual(Object.keys(norm).sort(), [...reg.subtypes[s].slot_set].sort(), `${s} 槽位穷尽（SF-03）`);
    assert.ok(Object.values(norm).every(isTagged), `${s} 每槽位都是带标签值`);
  }
});

test('P1-2 空集合：empty_allowed=true 合法；=false 产 finding 且记录仍保存（SF-11/SF-14）', () => {
  const a = ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'DECLARED', v: [] } });
  assert.equal(a.o.findings.length, 0, 'DECLARED([]) 在 aliases 上必须完全合法');
  assert.equal(a.o.refused, null);
  const b = ok('ENTITY', 'PHYSICAL_OBJECT', { description: { '@st': 'DECLARED', v: '' } });
  assert.equal(b.o.refused, null, 'empty_allowed=false 也不得拒写（SF-14/SF-04）');
  assert.deepEqual(b.o.findings.map(f => f.code), ['EMPTY_NOT_PERMITTED']);
  assert.equal(b.o.findings[0].sev, 'DEFICIENCY');
});

test('P1-3 缺 @st 的空容器 = 用空代替未知 → STATE_UNDECLARED，但保存不阻断', () => {
  const { o, norm } = ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: [] });
  assert.deepEqual(o.findings.map(f => f.code), ['STATE_UNDECLARED']);
  assert.equal(o.refused, null);
  assert.equal(norm.aliases['@st'], undefined, '原样保留问题值，由 findings 表达（不静默改写）');
});

test('P1-4 三态互不代替：DECLARED([]) / ABSENT / UNKNOWN(reason) 是三个不同事实', () => {
  const o = mkOut();
  const t = v => { checkTagged('aliases', v, C('aliases'), o); return o.findings.length; };
  assert.equal(t({ '@st': 'DECLARED', v: [] }), 0);
  assert.equal(t({ '@st': 'ABSENT' }), 0);
  assert.equal(t({ '@st': 'UNKNOWN', reason: 'NOT_SURVEYED' }), 0);
  assert.notEqual(t({ '@st': 'UNKNOWN', v: [] }), 0, 'UNKNOWN 不得带 v（SF-17）');
});

test('P1-5 语义必填但未提交 → 展开 ABSENT 并保存；只有形态五项才拒写（SF-04）', () => {
  const { r, norm } = ok('ENTITY', 'PHYSICAL_OBJECT', {});   // 连身份槽位 world_membership 都不提交
  assert.equal(r.refused, false, '缺语义必填槽位不是形态错误（P0-2）');
  assert.deepEqual(norm.world_membership, { '@st': 'ABSENT' });
});

test('P1-6 拒写封闭五项之未知键 / 异名重复 / 标签越界 / kind 不可解析', () => {
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { confidence: { '@st': 'DECLARED', v: 0.9 } }).r.code, 'UNKNOWN_KEY_IN_PAYLOAD');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { entity_subtype: { '@st': 'DECLARED', v: 'X' } }).r.code, 'ENVELOPE_KEY_DUPLICATE_IN_PAYLOAD'); // 信封 subtype_code=PHYSICAL_OBJECT vs 载荷 entity_subtype=X
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'MISSING', reason: 'x' } }).r.code, 'STATE_TAG_OUT_OF_RANGE');
  assert.equal(ok('GOBLIN', 'PHYSICAL_OBJECT', {}).r.code, 'OBJECT_KIND_UNRESOLVABLE');
});

test('P1-7 未注册子型 → 候选载荷，不拒写、不冒充规范形态（SS-13/SS-56）', () => {
  const o = mkOut();
  const r = ingest(env('ENTITY', 'WORLD_MID', {}), {}, reg, o);
  assert.equal(r.refused, false);
  assert.equal(o.candidate, true);
  assert.deepEqual(o.findings.map(f => f.code), ['SUBTYPE_UNREGISTERED']);
});
