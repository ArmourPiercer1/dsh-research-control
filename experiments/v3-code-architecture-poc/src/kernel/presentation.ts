/**
 * 呈现层脱敏（#44 §9.4、RPT-09/RPT-10、SP-07/SP-10、XC-23/XC-25）。
 *
 * 纪律：真源只有一份不可改的审计记录；**脱敏发生在呈现层**，绝不为"对外安全"少记或改写。
 * 对外把 REF_UNRESOLVED 与 WITHHELD_REFERENCE 合并成同一个 UNVERIFIABLE_REFERENCE，
 * 使"目标不存在"与"你无权看到"不可区分；且不给出任何可反推存在性的计数。
 */
export interface ReportLike { readonly items: readonly { code: string; outcome: string }[]; readonly coverage: string }
export interface Presented { readonly items: readonly { code: string; outcome: string }[]; readonly verdict: string; readonly coverage: string }

const MERGE = new Set(['SYNTH_REF_UNRESOLVED', 'REF_UNRESOLVED', 'SYNTH_WITHHELD_REFERENCE', 'WITHHELD_REFERENCE']);

/** 生产环境该谓词由授权层给出（需同时对检查对象空间与被屏蔽范围有可见权）；此处是合成占位。 */
export const SYNTHETIC_AUDIT_VISIBILITY = (actor: string): boolean => actor === 'auditor';

export function presentReport(r: ReportLike, caller: string, canAudit: (actor: string) => boolean = SYNTHETIC_AUDIT_VISIBILITY): Presented {
  if (canAudit(caller)) {
    const verdict = r.items.some((i) => i.outcome === 'FAIL') ? 'NOT_ACHIEVED'
      : r.items.some((i) => i.outcome === 'INDETERMINATE') ? 'INDETERMINATE' : 'ACHIEVED';
    return { items: r.items, verdict, coverage: r.coverage };
  }
  let merged = false;
  const items = r.items.map((i) => {
    if (!MERGE.has(i.code)) return i;
    merged = true;
    return { code: 'UNVERIFIABLE_REFERENCE', outcome: 'INDETERMINATE' };
  });
  // 脱敏移除了检查项 ⇒ 对外不得呈 ACHIEVED/NOT_ACHIEVED（RPT-10）
  const verdict = merged || r.coverage === 'INCOMPLETE_DUE_TO_VISIBILITY' ? 'UNVERIFIABLE_TO_YOU'
    : items.some((i) => i.outcome === 'FAIL') ? 'NOT_ACHIEVED'
      : items.some((i) => i.outcome === 'INDETERMINATE') ? 'INDETERMINATE' : 'ACHIEVED';
  return { items, verdict, coverage: merged || r.coverage === 'INCOMPLETE_DUE_TO_VISIBILITY' ? 'NOT_DISCLOSED' : r.coverage };
}
