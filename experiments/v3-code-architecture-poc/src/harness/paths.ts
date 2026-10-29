/**
 * 侧车写入红线（沿用 experiments/v3-semantic-poc 的纪律）：PoC 的一切写入只允许落在
 * 本目录的 `.poc-data/**`，绝不写源树、绝不碰 V1 `.research/**` / 生产 DB。
 * 路径以本文件锚定，与进程 cwd 无关。
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓根（experiments/v3-code-architecture-poc/src/harness → 上三级）。 */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const POC_ROOT = resolve(HERE, '..', '..');
export const POC_DATA_DIR = join(POC_ROOT, '.poc-data');
mkdirSync(POC_DATA_DIR, { recursive: true });

/** 断言某路径确实在允许写入区内；测试用它强制红线。 */
export const assertInsidePocData = (p: string): string => {
  const abs = resolve(p);
  if (!abs.startsWith(POC_DATA_DIR)) throw new Error(`侧车红线：拒绝写入 .poc-data 之外的路径 ${abs}`);
  return abs;
};
