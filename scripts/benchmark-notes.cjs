const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');
const exportsObject = {};
const source = ts.transpileModule(fs.readFileSync('client/src/lib/note-markdown.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(source,{exports:exportsObject,require:()=>({})});
const developers = Array.from({length:50},(_,i)=>({accountId:`dev-${i}`,displayName:`Person${i} Example${i}`}));
for (const bullets of [500,1000]) {
 const body = Array.from({length:bullets},(_,i)=>`- Follow up with @Person${i%50} Example${i%50} on item ${i}`).join('\n');
 const times=[];
 for(let run=0;run<5;run++){const start=performance.now();const result=exportsObject.wrapUpCandidates(body,developers);times.push(+(performance.now()-start).toFixed(2));if(result.length!==bullets)throw Error('candidate mismatch');}
 console.log(JSON.stringify({bullets,characters:body.length,times}));
}
