// Synthetic isolated snapshot only: no server/database-connection imports.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const Database = require('better-sqlite3');
const { performance } = require('node:perf_hooks');
const workerModule = {};
const source = ts.transpileModule(fs.readFileSync('server/src/services/backup-sanitizer.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(source, {exports:workerModule,require,setTimeout,clearTimeout});
(async () => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(),'lead-os-backup-benchmark-'));
 try {
  const original = path.join(directory,'original.db');
  const db = new Database(original);
  db.exec('CREATE TABLE app_sessions(id TEXT); CREATE TABLE payload(value TEXT)');
  db.prepare('INSERT INTO app_sessions VALUES (?)').run('synthetic-session-secret');
  const insert = db.prepare('INSERT INTO payload VALUES (?)');
  db.transaction(() => { for(let i=0;i<10000;i++)insert.run('x'.repeat(4096)); })();
  db.close();
  const sample = async (name, work) => {
   const copy = path.join(directory,`${name}.db`);
   await fs.promises.copyFile(original,copy);
   let last = performance.now(), maximum = 0, ticks = 0;
   const timer = setInterval(() => { const now=performance.now(); maximum=Math.max(maximum,now-last);last=now;ticks++; },5);
   await new Promise(resolve=>setTimeout(resolve,15));
   const start = performance.now();
   await work(copy);
   const duration = performance.now()-start;
   await new Promise(resolve=>setTimeout(resolve,15));
   clearInterval(timer);
   console.log(JSON.stringify({name,snapshotBytes:fs.statSync(original).size,durationMs:+duration.toFixed(1),maximumTimerGapMs:+maximum.toFixed(1),ticks,sessionRemoved:!fs.readFileSync(copy).includes(Buffer.from('synthetic-session-secret'))}));
  };
  await sample('http-thread', async copy => { const db = new Database(copy);try { db.pragma('journal_mode = DELETE');db.exec('DELETE FROM app_sessions');db.exec('VACUUM'); }finally{db.close();} });
  await sample('worker', workerModule.sanitizeBackupCopy);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
