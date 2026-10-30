// 测试装配用：在**独立进程**里打开同一个空间文件，抢到写事务后**等父进程发号释放**再提交。
// 为什么不是忙等固定毫秒：忙等既堵事件循环（读不到 stdin），又把结论押在
// "占用时长 vs busy_timeout vs 父进程被调度"的时序余量上——负载下就变成不稳定测试（F-34）。
// 现在改为**同步驱动**：父进程确认自己已经动手之后才让我们释放，断言窗口内锁必然还持有着。
// 用法：node hold-write-lock.mjs <db 文件> [安全阀毫秒，默认 20000]
import { DatabaseSync } from 'node:sqlite';

const [file, safetyArg] = process.argv.slice(2);
const db = new DatabaseSync(file);
db.exec('pragma busy_timeout = 5000;');
db.exec('begin immediate;');
db.prepare(`insert into journal(tx_epoch, ns, oid, op) values(?, ?, ?, ?)`)
  .run(900001, 'child-process', 'lock-holder', 'child-held');
console.log('locked');

let done = false;
const finish = () => {
  if (done) return;
  done = true;
  db.exec('commit;');
  console.log('child-committed');
  // 必须显式退出：stdin 由父进程持有，不关流就不会自己结束（曾导致 close 永不触发、用例挂死）。
  process.exit(0);
};
// 安全阀：父进程崩溃时不无限挂起（不 unref——它必须真的能触发）
const safety = setTimeout(finish, Number(safetyArg ?? '20000'));
process.stdin.setEncoding('utf8');
process.stdin.on('data', (b) => { if (String(b).includes('release')) { clearTimeout(safety); finish(); } });
// 不把 stdin 的 'end' 当作释放信号：stdio[0]='ignore' 时 fd0 立刻 EOF，会让"等命令释放"
// 退化成"立刻提交"，从而破坏其他调用方（独立复审的 r5-contention-repro）依赖的定时语义。
// 只有显式的 release 或安全阀到期才提交。
