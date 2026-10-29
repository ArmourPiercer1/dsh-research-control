// 测试装配用：在**独立进程**里打开同一个空间文件，抢到写事务后忙等若干毫秒再提交。
// 用途是给"多进程并发写同一空间文件"提供真实证据，而不是同进程双连接的近似。
// 用法：node hold-write-lock.mjs <db 文件> <占用毫秒>
import { DatabaseSync } from 'node:sqlite';

const [file, msArg] = process.argv.slice(2);
const holdMs = Number(msArg ?? '1500');
const db = new DatabaseSync(file);
db.exec('pragma busy_timeout = 5000;');
db.exec('begin immediate;');
db.prepare(`insert into journal(tx_epoch, ns, oid, op) values(?, ?, ?, ?)`)
  .run(900001, 'child-process', 'lock-holder', 'child-held');
// 抢到写锁后立刻上报，父进程据此再试——用 sleep 猜时机会在负载下假绿/假红
console.log('locked');
const until = Date.now() + holdMs;
while (Date.now() < until) { /* 忙等：保持写事务打开 */ }
db.exec('commit;');
db.close();
console.log('child-committed');
