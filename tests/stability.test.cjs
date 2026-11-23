'use strict';
const assert=require('node:assert/strict'),db=require('../src/core.js');
(async()=>{
 const s=db.newStore(),g=await db.createDatabase(s,'Test');db.commit(s,g.store);
 const d=await db.createDocument(s,g.rootHead,'child',{v:0});db.commit(s,d.store);
 const p=await db.patchDocument(s,d.rootHead,'child',[{op:'replace',path:'/v',value:1}]);db.commit(s,p.store);
 const rm=await db.patchRoot(s,p.rootHead,[{op:'remove',path:'/$refs/child'}]);db.commit(s,rm.store);
 const before=JSON.stringify(s);
 await assert.rejects(db.patchRoot(s,rm.rootHead,[{op:'add',path:'/$refs/child',value:d.documentHead}]),{code:'REFERENCE_ROLLBACK'});
 await assert.rejects(db.patchRoot(s,rm.rootHead,[{op:'replace',path:'/$refs',value:[]}]),{code:'INVALID_ROOT'});
 assert.equal(JSON.stringify(s),before);
 const good=await db.patchRoot(s,rm.rootHead,[{op:'add',path:'/$refs/child',value:p.documentHead}]);
 assert.equal((await db.openDatabase(good.store,good.rootHead)).report.status,'complete');
 const id=db.unpackHead(g.rootHead).id,ct=s.records[id];
 let enumerations=0,reads=0;
 const instrumented={...s,records:new Proxy(s.records,{ownKeys(){enumerations++;throw Error('lookup enumerates records');},get(t,k){reads++;assert.equal(k,id);return t[k];}})};
 await db.readRecord(instrumented,g.rootHead);assert.equal(enumerations,0);assert.equal(reads,1);
 for(const bad of ['', 'A'.repeat(21), 'A'.repeat(21)+'B', 'A'.repeat(22)+'!', 'A'.repeat(25)]){
  const invalid={...s,records:{[id]:bad}};
  assert.throws(()=>db.validateStore(invalid),{code:'INVALID_RECORD'});
 }
 assert.equal(s.records[id],ct);
 console.log('STABILITY PASS: checked root write, rollback rejection, atomic failure, direct physical lookup, strict ciphertext');
})().catch(e=>{console.error(e);process.exitCode=1;});
