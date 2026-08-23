/**
 * WP-6.2 — discovery zone scanner: mechanical type classification
 * (pure, no I/O, NO research-meaning inference — §22.2 边界).
 *
 * The classification signal is exactly two frozen tables + a frozen
 * combination rule (任务书目标 1「机械分类：扩展名/命名模式」):
 *
 *  1. `EXTENSION_TYPE_TABLE` — file extension (lowercased; a few known
 *     double extensions like `csv.gz`) → `ArtifactType`
 *     (DOMAIN_SCHEMA §1.4 冻结枚举). The table encodes FILE-FORMAT
 *     conventions only (a `.csv` is tabular data, a `.png` is a raster
 *     image) — it never reads content, and no entry is justified by
 *     what the file is "about";
 *  2. `NAMING_PATTERN_SIGNALS` — frozen substring patterns matched
 *     against the lowercased file-name STEM (extension removed), in
 *     priority order (first hit wins). Substring match is deliberately
 *     coarse and mechanical: `model_final` → MODEL, `mydata` → DATASET.
 *     A pattern hit only ever fires when the extension table has no
 *     entry (the extension signal is stronger — `data.py` is CODE,
 *     not DATASET);
 *  3. combination rule `combineTypeSignal`: extension > naming pattern
 *     > `OTHER`.
 *
 * Zone `artifact_types` (§14.1「发现分类提示」) is deliberately NOT an
 * input to any function in this module — the hint is carried on the
 * candidate as `zoneArtifactTypes` (informational) and may only ever
 * be consulted by the consumer (WP-6.3 reconciliation). That is the
 * machine-checkable form of the 「不推断科研含义」 boundary: the type
 * face offers no API through which semantics could leak in.
 */

import type { ArtifactType } from '../../domain/loader/index.js'

/**
 * Frozen extension table (V1 conventions). Key = extension WITHOUT the
 * leading dot, lowercased; double extensions included as full tails.
 * Anything absent → `guessFromExtension` returns `null` (→ naming
 * pattern, else `OTHER`).
 */
export const EXTENSION_TYPE_TABLE: Readonly<Record<string, ArtifactType>> = {
  // DATASET — tabular / serialized data containers
  csv: 'DATASET',
  tsv: 'DATASET',
  json: 'DATASET',
  jsonl: 'DATASET',
  ndjson: 'DATASET',
  parquet: 'DATASET',
  feather: 'DATASET',
  arrow: 'DATASET',
  h5: 'DATASET',
  hdf5: 'DATASET',
  npy: 'DATASET',
  pkl: 'DATASET',
  pickle: 'DATASET',
  xlsx: 'DATASET',
  xls: 'DATASET',
  mat: 'DATASET',
  rdata: 'DATASET',
  rds: 'DATASET',
  db: 'DATASET',
  sqlite: 'DATASET',
  sqlite3: 'DATASET',
  dat: 'DATASET',
  avro: 'DATASET',
  // common compressed data containers (double extension)
  'csv.gz': 'DATASET',
  'tsv.gz': 'DATASET',
  'json.gz': 'DATASET',
  'jsonl.gz': 'DATASET',
  'parquet.gz': 'DATASET',
  'npy.gz': 'DATASET',

  // FIGURE — raster / vector image formats
  png: 'FIGURE',
  jpg: 'FIGURE',
  jpeg: 'FIGURE',
  gif: 'FIGURE',
  bmp: 'FIGURE',
  tiff: 'FIGURE',
  tif: 'FIGURE',
  svg: 'FIGURE',
  webp: 'FIGURE',
  ico: 'FIGURE',
  eps: 'FIGURE',
  ps: 'FIGURE',
  fig: 'FIGURE',
  heic: 'FIGURE',
  avif: 'FIGURE',

  // MODEL — learned-model serialization formats
  onnx: 'MODEL',
  tflite: 'MODEL',
  pb: 'MODEL',
  pt: 'MODEL',
  pth: 'MODEL',
  safetensors: 'MODEL',
  gguf: 'MODEL',
  mnn: 'MODEL',

  // CODE — source / notebook / shell / query
  py: 'CODE',
  pyi: 'CODE',
  ipynb: 'CODE',
  js: 'CODE',
  mjs: 'CODE',
  cjs: 'CODE',
  jsx: 'CODE',
  ts: 'CODE',
  tsx: 'CODE',
  r: 'CODE',
  sh: 'CODE',
  bash: 'CODE',
  zsh: 'CODE',
  jl: 'CODE',
  scala: 'CODE',
  java: 'CODE',
  c: 'CODE',
  h: 'CODE',
  cpp: 'CODE',
  cc: 'CODE',
  cxx: 'CODE',
  hpp: 'CODE',
  cs: 'CODE',
  go: 'CODE',
  rs: 'CODE',
  rb: 'CODE',
  pl: 'CODE',
  pm: 'CODE',
  lua: 'CODE',
  m: 'CODE',
  f: 'CODE',
  f90: 'CODE',
  f95: 'CODE',
  sql: 'CODE',
  proto: 'CODE',
  graphql: 'CODE',

  // REPORT — typeset / office document formats
  pdf: 'REPORT',
  tex: 'REPORT',
  rmd: 'REPORT',
  html: 'REPORT',
  htm: 'REPORT',
  doc: 'REPORT',
  docx: 'REPORT',
  odt: 'REPORT',
  ppt: 'REPORT',
  pptx: 'REPORT',
  epub: 'REPORT',

  // NOTE — lightweight plain-text / markup notes
  md: 'NOTE',
  markdown: 'NOTE',
  rst: 'NOTE',
  txt: 'NOTE',
  text: 'NOTE',
  org: 'NOTE',
}

/**
 * Frozen naming-pattern signals (substring over the lowercased stem),
 * in PRIORITY order — the first pattern that occurs anywhere in the
 * stem wins (so `model_data` → MODEL, not DATASET). Coarse by design:
 * these are mechanical string conventions (`readme`, `ckpt`, `plot`),
 * not interpretations.
 */
export const NAMING_PATTERN_SIGNALS: ReadonlyArray<readonly [pattern: string, type: ArtifactType]> = [
  ['model', 'MODEL'],
  ['weights', 'MODEL'],
  ['checkpoint', 'MODEL'],
  ['ckpt', 'MODEL'],
  ['corpus', 'DATASET'],
  ['sample', 'DATASET'],
  ['data', 'DATASET'],
  ['figure', 'FIGURE'],
  ['fig', 'FIGURE'],
  ['plot', 'FIGURE'],
  ['chart', 'FIGURE'],
  ['heatmap', 'FIGURE'],
  ['manuscript', 'REPORT'],
  ['report', 'REPORT'],
  ['draft', 'REPORT'],
  ['summary', 'REPORT'],
  ['review', 'REPORT'],
  ['readme', 'NOTE'],
  ['note', 'NOTE'],
  ['memo', 'NOTE'],
  ['todo', 'NOTE'],
  ['script', 'CODE'],
  ['train', 'CODE'],
  ['eval', 'CODE'],
  ['pipeline', 'CODE'],
  ['experiment', 'CODE'],
]

/**
 * Extract the (lowercased) extension tail of a basename: the last
 * `.`-suffix, or the last TWO suffixes when the two-suffix tail is a
 * known double extension (`archive.csv.gz` → `csv.gz`). Dotfiles
 * (`.env`) and extension-less names have no extension → `null`.
 */
export function extractExtension(basename: string): string | null {
  const name = basename.toLowerCase()
  if (name.length === 0 || name.startsWith('.')) {
    // dotfile: `.env` → no extension; `.env.csv` → `csv` (handle below
    // by looking at the name after the FIRST dot)
    const rest = name.slice(1)
    if (rest.length === 0 || !rest.includes('.')) return null
    return extensionOf(rest)
  }
  return extensionOf(name)
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null // no dot / trailing dot
  const ext = name.slice(dot + 1)
  // double-extension check: `x.csv.gz` → `csv.gz` when known
  const prevDot = name.lastIndexOf('.', dot - 1)
  if (prevDot > 0) {
    const double = name.slice(prevDot + 1)
    if (double.length > 0 && EXTENSION_TYPE_TABLE[double] !== undefined) return double
  }
  return ext
}

/** Extension-table guess for a basename (`null` = no table entry). */
export function guessFromExtension(basename: string): ArtifactType | null {
  const ext = extractExtension(basename)
  if (ext === null) return null
  return EXTENSION_TYPE_TABLE[ext] ?? null
}

/** Lowercased stem (basename minus its extension tail). */
export function stemOf(basename: string): string {
  const name = basename.toLowerCase()
  const eff = name.startsWith('.') ? name.slice(1) : name
  const dot = eff.lastIndexOf('.')
  if (dot <= 0) return eff
  const prevDot = eff.lastIndexOf('.', dot - 1)
  // mirror extractExtension: a known double tail removes both parts
  if (prevDot > 0 && EXTENSION_TYPE_TABLE[eff.slice(prevDot + 1)] !== undefined) {
    return eff.slice(0, prevDot)
  }
  return eff.slice(0, dot)
}

/** Naming-pattern guess for a basename (`null` = no pattern hit). */
export function guessFromNamingPattern(basename: string): ArtifactType | null {
  const stem = stemOf(basename)
  if (stem.length === 0) return null
  for (const [pattern, type] of NAMING_PATTERN_SIGNALS) {
    if (stem.includes(pattern)) return type
  }
  return null
}

export interface TypeSignal {
  /** Extension-table result (`null` = no table entry for this name). */
  readonly guessedType: ArtifactType | null
  /** Combined mechanical result (extension > naming pattern > OTHER). */
  readonly suggestedType: ArtifactType
}

/**
 * The frozen combination rule: extension table first, then naming
 * pattern, else `OTHER`. Pure and total — never throws, never nulls
 * the suggestion.
 */
export function combineTypeSignal(basename: string): TypeSignal {
  const guessedType = guessFromExtension(basename)
  if (guessedType !== null) return { guessedType, suggestedType: guessedType }
  const naming = guessFromNamingPattern(basename)
  return { guessedType: null, suggestedType: naming ?? 'OTHER' }
}
