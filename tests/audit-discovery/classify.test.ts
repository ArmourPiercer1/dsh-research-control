/**
 * WP-6.2 — mechanical classification (classify.ts): frozen extension
 * table, naming-pattern signals, combination rule.
 *
 * 边界钉 (任务书目标 1/4 + 计划书 §22.2): 只认扩展名/命名模式的机械
 * 信号 — 每个断言都指向冻结表本身（表是单一真源，测试钉行为不钉
 * 表内容的"理由"）。zone `artifact_types` 提示不进入本模块任何函数
 * （结构性：函数签名无提示参数 — 见 combineTypeSignal 面）。
 */

import { describe, expect, it } from 'vitest'

import {
  combineTypeSignal,
  EXTENSION_TYPE_TABLE,
  extractExtension,
  guessFromExtension,
  guessFromNamingPattern,
  NAMING_PATTERN_SIGNALS,
  stemOf,
} from '../../src/host/audit/discovery/index.js'

describe('extension table (frozen, mechanical)', () => {
  it('every table key classifies its own name (round-trip over the full table)', () => {
    for (const [ext, type] of Object.entries(EXTENSION_TYPE_TABLE)) {
      const probe = `sample.${ext}` // single: sample.csv — double: sample.csv.gz
      expect(guessFromExtension(probe), `ext=${ext}`).toBe(type)
      expect(EXTENSION_TYPE_TABLE[ext]).toBe(type)
    }
  })

  it.each([
    ['data.csv', 'DATASET'],
    ['data.tsv', 'DATASET'],
    ['exp.json', 'DATASET'],
    ['exp.jsonl', 'DATASET'],
    ['exp.parquet', 'DATASET'],
    ['exp.h5', 'DATASET'],
    ['exp.hdf5', 'DATASET'],
    ['exp.npy', 'DATASET'],
    ['exp.pkl', 'DATASET'],
    ['exp.xlsx', 'DATASET'],
    ['exp.sqlite3', 'DATASET'],
    ['exp.dat', 'DATASET'],
    ['archive.csv.gz', 'DATASET'],
    ['archive.parquet.gz', 'DATASET'],
    ['archive.tar.gz', null], // not in the table → null (→ OTHER downstream)
  ])('guessFromExtension(%s) = %s', (name, expected) => {
    expect(guessFromExtension(name)).toBe(expected)
  })

  it.each([
    ['plot.png', 'FIGURE'],
    ['plot.jpg', 'FIGURE'],
    ['plot.svg', 'FIGURE'],
    ['plot.tiff', 'FIGURE'],
    ['plot.webp', 'FIGURE'],
    ['plot.eps', 'FIGURE'],
    ['slide.fig', 'FIGURE'],
  ])('guessFromExtension(%s) = %s (FIGURE)', (name, expected) => {
    expect(guessFromExtension(name)).toBe(expected)
  })

  it.each([
    ['model.onnx', 'MODEL'],
    ['model.tflite', 'MODEL'],
    ['model.pt', 'MODEL'],
    ['model.pth', 'MODEL'],
    ['model.safetensors', 'MODEL'],
    ['model.gguf', 'MODEL'],
  ])('guessFromExtension(%s) = %s (MODEL)', (name, expected) => {
    expect(guessFromExtension(name)).toBe(expected)
  })

  it.each([
    ['train.py', 'CODE'],
    ['notebook.ipynb', 'CODE'],
    ['app.js', 'CODE'],
    ['mod.ts', 'CODE'],
    ['analyze.R', 'CODE'],
    ['run.sh', 'CODE'],
    ['main.c', 'CODE'],
    ['q.sql', 'CODE'],
    ['svc.proto', 'CODE'],
  ])('guessFromExtension(%s) = %s (CODE)', (name, expected) => {
    expect(guessFromExtension(name)).toBe(expected)
  })

  it.each([
    ['paper.pdf', 'REPORT'],
    ['paper.tex', 'REPORT'],
    ['report.rmd', 'REPORT'],
    ['site.html', 'REPORT'],
    ['doc.docx', 'REPORT'],
    ['slides.pptx', 'REPORT'],
  ])('guessFromExtension(%s) = %s (REPORT)', (name, expected) => {
    expect(guessFromExtension(name)).toBe(expected)
  })

  it.each([
    ['notes.md', 'NOTE'],
    ['notes.markdown', 'NOTE'],
    ['notes.rst', 'NOTE'],
    ['log.txt', 'NOTE'],
    ['todo.org', 'NOTE'],
  ])('guessFromExtension(%s) = %s (NOTE)', (name, expected) => {
    expect(guessFromExtension(name)).toBe(expected)
  })

  it('is case-insensitive and handles dotfiles / extension-less names', () => {
    expect(guessFromExtension('DATA.CSV')).toBe('DATASET')
    expect(guessFromExtension('Data.Csv')).toBe('DATASET')
    expect(guessFromExtension('archive.CSV.GZ')).toBe('DATASET')
    expect(guessFromExtension('.env')).toBeNull() // dotfile, no extension
    expect(guessFromExtension('.hidden.csv')).toBe('DATASET') // dotfile WITH extension
    expect(guessFromExtension('mydata')).toBeNull() // no extension
    expect(guessFromExtension('trailing.')).toBeNull() // trailing dot
    expect(guessFromExtension('')).toBeNull()
  })

  it('extractExtension: double tails only when known, else the last suffix', () => {
    expect(extractExtension('archive.csv.gz')).toBe('csv.gz')
    expect(extractExtension('archive.tar.gz')).toBe('gz')
    expect(extractExtension('archive.gz')).toBe('gz')
    expect(extractExtension('a.b.c')).toBe('c')
    expect(extractExtension('.env')).toBeNull()
    expect(extractExtension('plain')).toBeNull()
  })
})

describe('naming-pattern signals (frozen, substring on stem, priority order)', () => {
  it.each([
    ['model_final', 'MODEL'],
    ['weights_epoch10', 'MODEL'],
    ['checkpoint_001', 'MODEL'],
    ['ckpt', 'MODEL'],
    ['my_corpus', 'DATASET'],
    ['sample_batch', 'DATASET'],
    ['mydata', 'DATASET'],
    ['figure_1', 'FIGURE'],
    ['fig2', 'FIGURE'],
    ['plot_v2', 'FIGURE'],
    ['chart_a', 'FIGURE'],
    ['manuscript_v3', 'REPORT'],
    ['draft_report', 'REPORT'],
    ['summary', 'REPORT'],
    ['peer_review', 'REPORT'],
    ['readme', 'NOTE'],
    ['meeting_notes', 'NOTE'],
    ['memo', 'NOTE'],
    ['todo', 'NOTE'],
    ['script_train', 'CODE'],
    ['training_run', 'CODE'],
    ['eval_loop', 'CODE'],
    ['pipeline', 'CODE'],
    ['experiment_a', 'CODE'],
  ])('guessFromNamingPattern(%s) = %s', (name, expected) => {
    expect(guessFromNamingPattern(name)).toBe(expected)
  })

  it('priority is frozen: earlier signal wins on multi-hit stems', () => {
    expect(guessFromNamingPattern('model_data')).toBe('MODEL') // MODEL before DATASET
    expect(guessFromNamingPattern('data_figure')).toBe('DATASET') // DATASET before FIGURE
    expect(guessFromNamingPattern('fig_notes')).toBe('FIGURE') // FIGURE before NOTE
    expect(guessFromNamingPattern('report_train')).toBe('REPORT') // REPORT before CODE
  })

  it('no pattern hit → null (→ OTHER downstream)', () => {
    expect(guessFromNamingPattern('mystery')).toBeNull()
    expect(guessFromNamingPattern('x9')).toBeNull()
    expect(guessFromNamingPattern('')).toBeNull()
  })

  it('the frozen signal list is non-empty and vocabulary-valid (drift guard)', () => {
    const vocab = new Set(['DATASET', 'FIGURE', 'MODEL', 'CODE', 'REPORT', 'NOTE', 'OTHER'])
    expect(NAMING_PATTERN_SIGNALS.length).toBeGreaterThan(0)
    for (const [pattern, type] of NAMING_PATTERN_SIGNALS) {
      expect(pattern.length).toBeGreaterThan(0)
      expect(vocab.has(type), `pattern=${pattern}`).toBe(true)
    }
  })

  it('stemOf mirrors extractExtension (double tails remove both parts)', () => {
    expect(stemOf('archive.csv.gz')).toBe('archive')
    expect(stemOf('data.py')).toBe('data')
    expect(stemOf('mydata')).toBe('mydata')
    expect(stemOf('.env')).toBe('env')
    expect(stemOf('.hidden.csv')).toBe('hidden')
    expect(stemOf('a.b.c')).toBe('a.b')
  })
})

describe('combineTypeSignal (frozen rule: extension > naming > OTHER)', () => {
  it('extension wins over naming pattern', () => {
    expect(combineTypeSignal('data.py')).toEqual({ guessedType: 'CODE', suggestedType: 'CODE' })
    expect(combineTypeSignal('model.csv')).toEqual({ guessedType: 'DATASET', suggestedType: 'DATASET' })
  })

  it('naming pattern fires only when the extension table misses', () => {
    expect(combineTypeSignal('mydata')).toEqual({ guessedType: null, suggestedType: 'DATASET' })
    expect(combineTypeSignal('plot_v2')).toEqual({ guessedType: null, suggestedType: 'FIGURE' })
  })

  it('no signal at all → OTHER (never null, never throws)', () => {
    expect(combineTypeSignal('mystery.xyz')).toEqual({ guessedType: null, suggestedType: 'OTHER' })
    expect(combineTypeSignal('')).toEqual({ guessedType: null, suggestedType: 'OTHER' })
    expect(combineTypeSignal('.env')).toEqual({ guessedType: null, suggestedType: 'OTHER' })
  })

  it('is deterministic (same input → same output, repeated)', () => {
    const a = combineTypeSignal('results/run_7/mydata.csv')
    const b = combineTypeSignal('results/run_7/mydata.csv')
    expect(a).toEqual(b)
  })
})
