'use strict';
const assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const subtle=(globalThis.crypto||webcrypto).subtle,counts={digest:0,encrypt:0,decrypt:0,fullScans:0};
const originals={};for(const key of ['digest','encrypt','decrypt']){originals[key]=subtle[key];subtle[key]=function(...args){counts[key]++;return originals[key].apply(this,args);};}
const NativeProxy=Proxy;let probe=null;
globalThis.Proxy=new NativeProxy(NativeProxy,{construct(target,[obj,handler]){
 const enumerate=handler.ownKeys;
 if(enumerate)handler={...handler,ownKeys(t){const keys=enumerate(t);if(probe&&keys.includes(probe))counts.fullScans++;return keys;}};
 return new target(obj,handler);
}});
const db=require('../src/core.js');
const reset=()=>Object.keys(counts).forEach(k=>counts[k]=0);
const sample=()=>({...counts});
(async()=>{
 const result=[];

 for(const size of [0,1000,10000]){
  const s=db.newStore();
  for(let i=0;i<size;i++){const b=new Uint8Array(16);new DataView(b.buffer).setUint32(0,i+1);s.records[db.encode64(b)]='A'.repeat(22);}
  const g=await db.createDatabase(s,'Metrics');db.commit(s,g.store);
  const d=await db.createDocument(s,g.rootHead,'child',{n:0});db.commit(s,d.store);
  probe=db.unpackHead(g.rootHead).id;
  // Positive control: real ownKeys trap is observed by Object.keys.
  reset();Object.keys(s.records);assert.equal(counts.fullScans,1);
  const before=performance.now();reset();await db.openDatabase(s,d.rootHead);const open={...sample(),ms:performance.now()-before};
  assert.equal(open.decrypt,3);assert.equal(open.fullScans,0);
  reset();const t=performance.now();
  let head=d.rootHead;
  for(let i=1;i<=10;i++){const p=await db.patchDocument(s,head,'child',[{op:'replace',path:'/n',value:i}]);db.commit(s,p.store);head=p.rootHead;db.storeInfo(s);}
  const writes={...sample(),ms:performance.now()-t};
  assert.equal(writes.digest,40);assert.equal(writes.encrypt,20);assert.equal(writes.decrypt,0);assert.equal(writes.fullScans,0);
  assert.equal((await db.readState(s,(await db.readState(s,head)).$refs.child)).n,10);
  assert.equal(counts.decrypt,0);
  reset();const verify=await db.verifyDatabase(s,head);assert.equal(verify.status,'complete');assert.equal(counts.decrypt,23);
  result.push({hiddenRecords:size,open,tenChildWrites:writes,independentVerify:sample()});
 }
 reset();const s=db.newStore();await db.genesis(s,'Genesis',{});assert.equal(counts.digest,2);assert.equal(counts.encrypt,1);
 // A failed crypto operation must not publish a partial staged transaction.
 const g=await db.createDatabase(s,'Failure');db.commit(s,g.store);const before=JSON.stringify(s);
 subtle.encrypt=async()=>{throw Error('injected encryption failure');};
 await assert.rejects(db.createDocument(s,g.rootHead,'child',{}),/injected encryption failure/);
 assert.equal(JSON.stringify(s),before);
 subtle.encrypt=function(...args){counts.encrypt++;return originals.encrypt.apply(this,args);};
 console.log('METRICS PASS',JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.Proxy=NativeProxy;for(const k of Object.keys(originals))subtle[k]=originals[k];});
