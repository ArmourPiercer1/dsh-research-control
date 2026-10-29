/**
 * 多进程并发写同一空间文件（此前只证过同进程双连接，属未证明项）。
 *
 * 真值条件：子进程 `begin immediate` 抢到写事务并忙等 3s（> `busy_timeout=2000`）；
 * 父进程此时必须得到 TX_CONTENTION 而不是"看起来成功了但其实没写进去"。
 * 同时验证 WAL 的两条语义：写被挡时**读不受阻**，且子进程未提交的行在提交前不可见。
 * 子进程提交后，两侧内容都必须在（无丢失、无损坏）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';

const ALICE = PRINCIPAL('multi-proc');
const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(POC_DATA_DIR, 'multiproc-'));
const file = join(dir, 'space.db');
const w = openWorld({ file, space: 'SP-MULTI', grants: { 'multi-proc': ['space-write'] } });


beforeAll(() => {
  // 先放一个对象，保证"写被挡时读仍可用"有可读内容
  w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'before-contention' } }));
});
afterAll(() => { w.close(); rmSync(dir, { recursive: true, force: true }); });

describe('多进程并发写同一空间文件', () => {
  test('子进程持写事务时：父进程写被拒（TX_CONTENTION）、读不受阻、子进程未提交行不可见', async () => {
    // F-34 的根因与修法：持锁时长原先靠**定时器**（3000→8000ms 都只是加大余量），
    // 于是断言成立与否取决于"占用时长 vs busy_timeout(2000ms) vs 父进程何时被调度"。
    // 全套并行跑时这个余量会被吃掉——同一个断言在负载下时红时绿。
    // 现在改成**同步驱动**：子进程一直持锁，直到本用例断言完再经 stdin 下令释放；
    // 第三个参数只是父进程崩溃时的安全阀，不参与任何时序假设。
    const child = spawn(process.execPath, [join(HERE, 'helpers/hold-write-lock.mjs'), file, '20000'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let childOut = '';
    const childErr: string[] = [];
    // 等子进程自己报告"已抢到写锁"，而不是 sleep 猜时机：负载下 sleep 会让本用例假绿
    const locked = new Promise<void>((res, rej) => {
      const onData = (b: Buffer | string): void => {
        childOut += String(b);
        if (childOut.includes('locked')) res();
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', (b) => childErr.push(String(b)));
      setTimeout(() => rej(new Error(`子进程未能在 10s 内抢到写锁：${childErr.join('')}`)), 10_000).unref();
    });

    try {
      await locked;

      // ① 写必须被挡，并给出可重试的拒绝码（不是静默成功，也不是静默失败）
      let busy: { code: string; detail?: { retryable?: boolean } } | undefined;
      try {
        w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'during-contention' } }));
      } catch (e) { busy = e as typeof busy; }
      expect(busy?.code).toBe('TX_CONTENTION');
      expect(busy?.detail?.retryable).toBe(true);

      // ② 读不受阻（WAL 语义），且看不到子进程未提交的行
      const rows = w.raw.all<{ c: number }>(`select count(*) c from object_directory`);
      expect(rows[0]!.c).toBe(1);
      const held = w.raw.all<{ c: number }>(`select count(*) c from journal where oid='lock-holder'`);
      expect(held[0]!.c).toBe(0);

      // 断言窗口结束，才放子进程提交（此前它一直真的持着写锁）
      child.stdin?.write('release\n');
      // ③ 子进程提交后两侧内容都在：没有丢写，也没有把被拒的写变成半写
      // 用 close 而不是 exit：等 stdio 关闭，否则最后一行可能还没进 childOut
      const code = await new Promise<number | null>((res) => child.on('close', res));
      expect(code, childErr.join('')).toBe(0);
      expect(childOut).toContain('child-committed');

      const after = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'after-contention' } }));
      expect(w.readObject(after)!.payload).toMatchObject({ label: 'after-contention' });
      expect(w.raw.all<{ c: number }>(`select count(*) c from journal where oid='lock-holder'`)[0]!.c).toBe(1);
      expect(w.raw.all<{ c: number }>(`select count(*) c from object_directory`)[0]!.c).toBe(2);
    } finally {
      if (!child.killed) child.kill('SIGKILL');
    }
  }, 30_000);
});
