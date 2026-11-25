'use strict';
// #46 bounded baseline witness, NOT a resource-limit acceptance test.
// Only --baseline is supported before policy/implementation. Never merge this
// pre-fix CI step as a permanent requirement for accepting oversized states.
const assert=require('node:assert/strict');
const db=require('../src/core-node.cjs');
assert.deepEqual(process.argv.slice(2),['--baseline'],'Use --baseline only for the pre-fix witness');
const MiB=1024*1024;
// Independent counting: JSON punctuation, UTF-8 keys/scalars and one node per
// JSON value (object keys are not nodes); no whole-state serialization.
function measure(value){
 let bytes=0,nodes=0,maxDepth=0;
 const stack=[[value,0]];
 while(stack.length){
  const [v,depth]=stack.pop();nodes++;maxDepth=Math.max(maxDepth,depth);
  if(v===null||typeof v!=='object'){bytes+=Buffer.byteLength(JSON.stringify(v));continue;}
  const array=Array.isArray(v),keys=Object.keys(v);
  bytes+=2+Math.max(0,keys.length-1);
  for(const k of keys){if(!array)bytes+=Buffer.byteLength(JSON.stringify(k))+1;stack.push([v[k],depth+1]);}
 }
 return {bytes,nodes,maxDepth};
}
const copies=n=>Array.from({length:n},(_,i)=>({op:'copy',from:'',path:'/c'+(i+1)}));
function predicted(seed,ops){
 let {bytes,nodes,maxDepth}=measure(seed);
 for(const op of ops){bytes=2*bytes+1+Buffer.byteLength(JSON.stringify(op.path.slice(1)))+1;nodes*=2;maxDepth++;}
 return {bytes,nodes,maxDepth};
}
function witness(seed,ops,label){
 const expected=predicted(seed,ops),start=measure(seed);
 // Bound this experiment independently before passing data to the current core.
 assert.ok(expected.bytes<17*MiB&&expected.nodes<150000&&expected.maxDepth<10);
 const t=performance.now(),out=db.patch(seed,ops),actual=measure(out);
 assert.deepEqual(actual,expected);assert.deepEqual(measure(seed),start);
 console.log('RESOURCE BASELINE',JSON.stringify({label,initial:start,operations:ops.length,patchBytes:Buffer.byteLength(JSON.stringify(ops)),materialized:actual,ms:Math.round((performance.now()-t)*100)/100}));
 return actual;
}
async function sizing(){
 const {syntheticFixture}=require('../examples/cash/synthetic-pages.cjs');
 const {createModel}=require('../examples/cash/import-model.cjs');
 const fs=require('node:fs'),path=require('node:path');
 const model=createModel(syntheticFixture()),entry=fs.readFileSync(path.join(__dirname,'../examples/cash/cash-entry.js'),'utf8');
 const root={name:'Касса',entry:{type:'application/javascript',export:'main',source:entry},$refs:{}};
 for(const alias of ['transactions',...Object.keys(model.catalogs)])root.$refs[alias]='A'.repeat(64);
 const sizes=[root,model.transactions,...Object.values(model.catalogs)].map(measure);
 console.log('RESOURCE SIZING',JSON.stringify({fixture:'approved synthetic',rows:model.transactions.rows.length,largest:sizes.reduce((a,b)=>a.bytes>b.bytes?a:b),total:sizes.reduce((a,b)=>({bytes:a.bytes+b.bytes,nodes:a.nodes+b.nodes,maxDepth:Math.max(a.maxDepth,b.maxDepth)}),{bytes:0,nodes:0,maxDepth:0})}));
 const s=db.newStore(),g=await db.createDatabase(s,'Long history');db.commit(s,g.store);
 const d=await db.createDocument(s,g.rootHead,'child',{payload:'x'.repeat(64*1024),n:0});db.commit(s,d.store);
 let h=d.rootHead;const start=performance.now();
 for(let i=0;i<500;i++){const p=await db.patchDocument(s,h,'child',[{op:'replace',path:'/n',value:i+1}]);db.commit(s,p.store);h=p.rootHead;}
 const before=performance.now(),fresh=db.adoptStore(db.snapshot(s)),v=await db.openDatabase(fresh,h);
 assert.equal(v.report.status,'complete');
 console.log('RESOURCE SIZING',JSON.stringify({fixture:'500 child writes, 64KiB state',physical:db.storeInfo(s),childState:measure(await db.readState(fresh,v.chain.state.$refs.child)),rootEvents:v.report.checks.rootEvents,writeMs:Math.round(before-start),verifyMs:Math.round(performance.now()-before),heapUsed:process.memoryUsage().heapUsed}));
}
async function main(){
 await sizing();
 const seed={payload:'x'.repeat(512*1024)},ops=copies(5);
 const large=witness(seed,ops,'byte amplification');
 assert.ok(large.bytes>12*MiB);
 witness({a:Array(8192).fill(null)},copies(4),'node amplification');
 // Small final result is not a bound on intermediate allocation.
 const transient=[...ops,...ops.map(op=>({op:'remove',path:op.path}))];
 assert.deepEqual(db.patch(seed,transient),seed);
 console.log('RESOURCE BASELINE',JSON.stringify({label:'transient amplification',patchBytes:Buffer.byteLength(JSON.stringify(transient)),prefixPeak:large,final:measure(seed)}));
 // Same expansion through authenticated, checked child write and detached replay.
 const s=db.newStore(),g=await db.createDatabase(s,'Resource baseline');db.commit(s,g.store);
 const child=await db.createDocument(s,g.rootHead,'doc',seed);db.commit(s,child.store);
 const before=db.storeInfo(s),beforeHead=db.catalog(s)['Resource baseline'];
 const t=await db.patchDocument(s,child.rootHead,'doc',ops);
 assert.deepEqual(db.storeInfo(s),before);assert.equal(db.catalog(s)['Resource baseline'],beforeHead);
 db.commit(s,t.store);
 const physical=db.snapshot(s),fresh=db.adoptStore(physical);
 const report=await db.verifyDatabase(fresh,t.rootHead);
 assert.equal(report.status,'complete');
 const replay=await db.load(fresh,t.documentHead);
 assert.deepEqual(measure(replay.state),large);
 const info=db.storeInfo(s);
 assert.ok(info.bytes<MiB);assert.equal(info.count-before.count,2);
 console.log('RESOURCE BASELINE',JSON.stringify({label:'authenticated write and detached replay',physical:info,childEvents:replay.events.length,materialized:measure(replay.state),verification:report.status}));
 console.log('RESOURCE AMPLIFICATION REPRODUCED: bounded baseline only, NOT policy acceptance');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
