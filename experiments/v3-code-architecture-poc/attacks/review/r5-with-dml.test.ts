import {test, expect} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {POC_DATA_DIR} from '../../src/harness/paths.ts';
import {openWorld} from '../../src/harness/world.ts';
test('read callback must reject valid WITH-prefixed UPDATE',()=>{
 const dir=mkdtempSync(join(POC_DATA_DIR,'r5-with-'));
 const w=openWorld({file:join(dir,'x.db'),space:'R5-WITH'});
 try {
  const before=w.ledgerHead();
  let error: unknown;
  try { w.kernel.port.read(raw=>raw.run("/* probe */ WiTh x AS (SELECT 1) UPDATE meta SET value=900 WHERE key='ledger_seq'")); } catch(e){error=e;}
  console.log(JSON.stringify({before,after:w.ledgerHead(),error:String(error)}));
  expect(w.ledgerHead()).toBe(before);
 }finally{w.close();rmSync(dir,{recursive:true,force:true});}
});
