'use strict';
// External comparison with the audited main. Temporary instrumented source
// copies are used ONLY for measurement, never as production artifacts.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..'),BASE='fdfbe17a57a92442b8a8c138c69430dea0fe0b37';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hdbms-bench-'));
const subtle=globalThis.crypto.subtle,cryptoOriginal={},native={create:Object.create,keys:Object.keys,entries:Object.entries,values:Object.values,ownKeys:Reflect.ownKeys,stringify:JSON.stringify,from:Buffer.from,atob:globalThis.atob};
let mode='',probe=null,counts;
function reset(){counts={digest:0,encrypt:0,decrypt:0,headDecodes:0,patchCalls:0,fullValidation:0,physicalEnumerations:0,enumeratedSlots:0,serializedStoreBytes:0};globalThis.__hdbmsBench=counts;}
reset();
for(const k of ['digest','encrypt','decrypt']){cryptoOriginal[k]=subtle[k];subtle[k]=function(...args){counts[k]++;return cryptoOriginal[k].apply(this,args);};}
function physical(o){return probe&&o&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,probe);}
for(const k of ['keys','entries','values'])Object[k]=function(o){const result=native[k](o);if(mode==='baseline'&&physical(o)){counts.physicalEnumerations++;counts.enumeratedSlots+=result.length;}return result;};
Reflect.ownKeys=function(o){const result=native.ownKeys(o);if(mode==='baseline'&&physical(o)){counts.physicalEnumerations++;counts.enumeratedSlots+=result.length;}return result;};
Object.create=function(proto,...args){const obj=native.create(proto,...args);return proto===null?new Proxy(obj,{ownKeys(t){const result=native.ownKeys(t);if(mode==='current'&&physical(t)){counts.physicalEnumerations++;counts.enumeratedSlots+=result.length;}return result;}}):obj;};
JSON.stringify=function(value,...args){const result=native.stringify(value,...args);if(physical(value?.records))counts.serializedStoreBytes+=Buffer.byteLength(result);return result;};
Buffer.from=function(value,...args){if(typeof value==='string'&&value.length===64&&args[0]==='base64url')counts.headDecodes++;return native.from.call(Buffer,value,...args);};
globalThis.atob=function(s){if(s.length===64&&!s.endsWith('='))counts.headDecodes++;return native.atob(s);};
function instrument(s){for(const [anchor,key] of [['function patch(json,ops){','patchCalls'],['function validateStore(s){','fullValidation']]){const actual=s.includes(anchor)?anchor:anchor==='function patch(json,ops){'?'function patch(json,ops,parent){':anchor;assert.ok(s.includes(actual));s=s.replace(actual,actual+'globalThis.__hdbmsBench.'+key+'++;');}return s;}
async function measured(kind,fn){mode=kind;global.gc?.();const heap=process.memoryUsage().heapUsed,start=performance.now();reset();await fn();const result={...counts,ms:+(performance.now()-start).toFixed(3),heapDeltaBytes:process.memoryUsage().heapUsed-heap};mode='';return result;}
(async()=>{
 const oldPath=path.join(temp,'baseline.cjs'),newPath=path.join(temp,'current.mjs');
 fs.writeFileSync(oldPath,instrument(cp.execFileSync('git',['show',BASE+':src/core.js'],{cwd:ROOT,encoding:'utf8'})));
 fs.writeFileSync(newPath,instrument(fs.readFileSync(path.join(ROOT,'src/core.js'),'utf8')));
 const baseline=require(oldPath),current=await import(pathToFileURL(newPath).href);
 const cases=[{hidden:0,history:0,docs:1,published:1},{hidden:1000,history:0,docs:1,published:1},{hidden:10000,history:0,docs:1,published:1},{hidden:0,history:50,docs:1,published:1},{hidden:0,history:200,docs:1,published:1},{hidden:0,history:0,docs:10,published:1},{hidden:0,history:0,docs:100,published:1},{hidden:0,history:0,docs:1,published:100}];
 for(const spec of cases){
  const s=current.newStore();
  // Structurally canonical hidden slots without disclosed HEADs: only test
  // cost of irrelevant physical storage, not their cryptographic validity.
  for(let i=0;i<spec.hidden;i++){const bytes=new Uint8Array(16);new DataView(bytes.buffer).setUint32(0,i+1);current.writePhysical(s,current.encode64(bytes),'A'.repeat(22));}
  for(let i=1;i<spec.published;i++){const r=await current.createDatabase(s,'Other'+i);current.commit(s,r.store);}
  const root=await current.createDatabase(s,'Bench');current.commit(s,root.store);let h=root.rootHead;
  for(let i=0;i<spec.docs;i++){const r=await current.createDocument(s,h,'d'+i,{n:0});current.commit(s,r.store);h=r.rootHead;}
  for(let i=0;i<spec.history;i++){const r=await current.patchDocument(s,h,'d0',[{op:'replace',path:'/n',value:i+1}]);current.commit(s,r.store);h=r.rootHead;}
  current.publish(s,'Bench',h,root.rootHead);
  const raw=current.snapshot(s),old=JSON.parse(native.stringify(raw)),now=current.adoptStore(raw);probe=current.unpackHead(root.rootHead).id;
  const ops=[{op:'replace',path:'/n',value:9999}];
  const oldOpen=await measured('baseline',async()=>{await baseline.verifyDatabase(old,h);await baseline.load(old,h);});
  const newOpen=await measured('current',async()=>{await current.openDatabase(now,h);});
  const oldWrite=await measured('baseline',async()=>{const r=await baseline.patchDocument(old,h,'d0',ops);await baseline.verifyDatabase(r.store,r.rootHead);baseline.publish(r.store,'Bench',r.rootHead,h);baseline.commit(old,r.store);});
  const newWrite=await measured('current',async()=>{const r=await current.patchDocument(now,h,'d0',ops);current.publish(r.store,'Bench',r.rootHead,h);current.commit(now,r.store);current.storeInfo(now);});
  assert.equal(newOpen.decrypt,1+2*spec.docs+2*spec.history);assert.equal(newOpen.headDecodes,newOpen.decrypt);
  assert.equal(newOpen.fullValidation,0);assert.equal(newOpen.physicalEnumerations,0);
  assert.equal(newWrite.digest,4);assert.equal(newWrite.encrypt,2);assert.equal(newWrite.decrypt,0);assert.equal(newWrite.headDecodes,2);assert.equal(newWrite.patchCalls,2);assert.equal(newWrite.fullValidation,0);assert.equal(newWrite.physicalEnumerations,0);assert.equal(newWrite.serializedStoreBytes,0);
  assert.equal((await current.verifyDatabase(now,current.catalog(now).Bench)).status,'complete');
  console.log('BENCHMARK '+native.stringify({spec,physicalSlots:Object.keys(raw.records).length,oldOpen,newOpen,oldWrite,newWrite}));
 }
 console.log('BENCHMARK PASS: baseline='+BASE+'; old write includes independent verification for equivalent guarantee; heap delta is not peak');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const k of ['keys','entries','values','create'])Object[k]=native[k];Reflect.ownKeys=native.ownKeys;JSON.stringify=native.stringify;Buffer.from=native.from;globalThis.atob=native.atob;for(const k of Object.keys(cryptoOriginal))subtle[k]=cryptoOriginal[k];delete globalThis.__hdbmsBench;fs.rmSync(temp,{recursive:true,force:true});});
