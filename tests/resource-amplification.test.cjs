'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),db=require('../src/core-node.cjs');
const {LIMITS:L}=db,MiB=1024*1024;
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
const code={code:'RESOURCE_LIMIT'};
function rawEvent(s,record,prev){
 const bytes=Buffer.from(JSON.stringify(record)),h=crypto.createHash('sha256').update(bytes).digest(),id=crypto.createHash('sha256').update(prev?Buffer.from(prev,'base64url'):h).digest().subarray(0,16);
 const cipher=crypto.createCipheriv('aes-256-gcm',h,id.subarray(0,12));
 db.writePhysical(s,id.toString('base64url'),Buffer.concat([cipher.update(bytes),cipher.final(),cipher.getAuthTag()]).toString('base64url'));
 return db.packHead(id,h);
}
const stamp='2026-01-01T00:00:00.000Z';
const patchEvent=(s,prev,ops)=>rawEvent(s,[stamp,prev,ops],prev);
function state(s){return {snapshot:db.snapshot(s),revision:db.revision(s),info:db.storeInfo(s)};}
async function unchanged(s,fn){const before=state(s);await assert.rejects(fn,code);assert.deepEqual(state(s),before);}
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
 // Independent UTF-8 oracle, including malformed surrogate sequences and escaping.
 const values=[null,true,false,0,-0,1e-7,1e21,1.2345,'\u0000\b\t\n\f\r"\\éЖ😀\ud800\udc00\ud800',{'\udc00😀\n':[null,'é',-123.4]}];
 for(const v of values){const m=db.measureJson(v),o=measure(v);assert.deepEqual({bytes:m.bytes,nodes:m.nodes,maxDepth:m.depth},o);}
 const rng=(()=>{let x=45;return n=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)%n;};})();
 for(let i=0;i<250;i++){const v=Array.from({length:20},()=>String.fromCharCode(rng(65536)));assert.equal(db.measureJson(v).bytes,Buffer.byteLength(JSON.stringify(v)));}
 const seed={payload:'x'.repeat(512*1024)},ops=copies(5);
 const native=JSON.stringify;let safeCopies=0,forbidden=0;
 JSON.stringify=function(value,...args){
  if(value&&typeof value==='object'){if(Object.hasOwn(value,'c2'))safeCopies++;if(Object.hasOwn(value,'c3'))forbidden++;}
  return native(value,...args);
 };
 try{
  const valid=db.patch(seed,copies(3));assert.ok(safeCopies>0);assert.equal(forbidden,0);
  assert.equal(measure(valid).bytes,db.measureJson(valid).bytes);assert.ok(measure(valid).bytes<L.stateBytes);
  native(valid);JSON.stringify(valid);assert.equal(forbidden,1,'instrument positive control');forbidden=0;
  assert.throws(()=>db.patch(seed,ops),code);assert.equal(forbidden,0,'oversized destination cloned before refusal');
  assert.throws(()=>db.patch(seed,[...ops,...ops.map(op=>({op:'remove',path:op.path}))]),code);assert.equal(forbidden,0);
 }finally{JSON.stringify=native;}
 const nodeSeed={a:Array(8192).fill(null)};
 assert.equal(measure(db.patch(nodeSeed,copies(3))).nodes,65552);
 assert.throws(()=>db.patch(nodeSeed,copies(4)),code);
 // Exact bytes and nodes at boundaries, including add/replace and array shifts.
 const max='x'.repeat(L.stateBytes-2);
 assert.equal(db.measureJson(max).bytes,L.stateBytes);
 assert.throws(()=>db.measureJson(max+'x'),code);
 assert.equal(db.measureJson(Array(L.stateNodes-1).fill(null)).nodes,L.stateNodes);
 assert.throws(()=>db.measureJson(Array(L.stateNodes).fill(null)),code);
 assert.throws(()=>db.patch({a:max.slice(0,L.stateBytes/2)},[{op:'add',path:'/b',value:max.slice(0,L.stateBytes/2)}]),code);
 assert.throws(()=>db.patch({a:max.slice(0,L.stateBytes/2),b:0},[{op:'replace',path:'/b',value:max.slice(0,L.stateBytes/2)}]),code);
 let deep=0;for(let i=0;i<L.depth;i++)deep=[deep];assert.equal(db.measureJson(deep).depth,L.depth);
 assert.throws(()=>db.patch({a:0},[{op:'add',path:'/a',value:deep}]),code);
 // Repeated bounded copies/removes exceed work even with a small final state.
 const workSeed={payload:'z'.repeat(MiB)},repeat=Array.from({length:70},()=>[{op:'copy',from:'/payload',path:'/b'},{op:'remove',path:'/b'}]).flat();
 assert.deepEqual(db.patch(workSeed,repeat.slice(0,2)),workSeed);
 assert.throws(()=>db.patch(workSeed,repeat),code);
 assert.deepEqual(db.patch({a:[1,2,3],b:{x:1}},[{op:'move',from:'/a/0',path:'/a/-'},{op:'copy',from:'/b',path:'/b/c'},{op:'replace',path:'/a/0',value:4}]),{a:[4,3,1],b:{x:1,c:{x:1}}});
 const s=db.newStore(),g=await db.createDatabase(s,'Resource');db.commit(s,g.store);
 const d=await db.createDocument(s,g.rootHead,'doc',seed);db.commit(s,d.store);
 await unchanged(s,()=>db.genesis(s,'too large',max+'x'));
 await unchanged(s,()=>db.patchDocument(s,d.rootHead,'doc',ops));
 await unchanged(s,()=>db.append(s,d.documentHead,ops));
 const ok=await db.patchDocument(s,d.rootHead,'doc',copies(2));db.commit(s,ok.store);
 assert.equal((await db.verifyDatabase(db.adoptStore(db.snapshot(s)),ok.rootHead)).status,'complete');
 // Independent authenticated history, not constructed through the checked write.
 const raw=db.adoptStore(db.snapshot(s)),bad=patchEvent(raw,ok.documentHead,copies(5));
 const badRoot=patchEvent(raw,ok.rootHead,[{op:'replace',path:'/$refs/doc',value:bad}]);
 const diagnosis=await db.inspect(raw,bad);
 assert.equal(diagnosis.status,'limited');assert.equal(diagnosis.code,'RESOURCE_LIMIT');assert.ok(!('tailIds' in diagnosis)&&!('invalid' in diagnosis));
 await assert.rejects(db.load(raw,bad),code);
 await assert.rejects(db.readState(raw,bad),code);
 await assert.rejects(db.resolve(raw,badRoot,badRoot,{$ref:'doc/'}),code);
 await assert.rejects(db.verifyDatabase(raw,badRoot),code);
 assert.match(await db.debugDatabase(raw,badRoot),/"status": "limited"/);
 const snapshot=state(raw);
 await assert.rejects(db.truncateInvalidTail(raw,diagnosis,ok.documentHead),{code:'INVALID_TRUNCATION'});
 await assert.rejects(db.truncateInvalidTail(raw,{...diagnosis,status:'broken',code:'INVALID_GCM',tailIds:[db.unpackHead(bad).id]},ok.documentHead),{code:'STALE_DIAGNOSIS'});
 assert.deepEqual(state(raw),snapshot);
 // Historically removed aliases continue consuming the retained proof budget.
 const ps=db.newStore(),pg=await db.createDatabase(ps,'Proof');db.commit(ps,pg.store);let h=pg.rootHead;
 const payload=Array(90000).fill(null);
 for(const name of ['a','b']){const p=await db.createDocument(ps,h,name,payload);db.commit(ps,p.store);h=p.rootHead;}
 const removed=await db.patchRoot(ps,h,[{op:'remove',path:'/$refs/a'}]);db.commit(ps,removed.store);h=removed.rootHead;
 await unchanged(ps,()=>db.createDocument(ps,h,'c',payload));
 const detached=db.adoptStore(db.snapshot(ps)),third=await db.genesis(detached,'c',payload,h);
 const badProof=patchEvent(detached,h,[{op:'add',path:'/$refs/c',value:third.head}]);
 await assert.rejects(db.verifyDatabase(detached,badProof),code);
 assert.equal((await db.verifyDatabase(db.adoptStore(db.snapshot(ps)),h)).status,'complete');
 await sizing();
 console.log('RESOURCE REGRESSION PASS: exact UTF8, before-clone controls, transient/work/node/depth limits, atomic write, authenticated limited replay, non-destructive diagnosis, historical proof budget');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
