'use strict';
const assert=require('node:assert/strict'),db=require('../src/core-node.cjs');
(async()=>{
 const s=db.newStore(),g=await db.createDatabase(s,'Test');db.commit(s,g.store);
 const d=await db.createDocument(s,g.rootHead,'child',{v:0});db.commit(s,d.store);
 const p=await db.patchDocument(s,d.rootHead,'child',[{op:'replace',path:'/v',value:1}]);db.commit(s,p.store);
 const rm=await db.patchRoot(s,p.rootHead,[{op:'remove',path:'/$refs/child'}]);db.commit(s,rm.store);
 const before=JSON.stringify(db.snapshot(s));
 await assert.rejects(db.patchRoot(s,rm.rootHead,[{op:'add',path:'/$refs/child',value:d.documentHead}]),{code:'REFERENCE_ROLLBACK'});
 await assert.rejects(db.patchRoot(s,rm.rootHead,[{op:'replace',path:'/$refs',value:[]}]),{code:'INVALID_ROOT'});
 assert.equal(JSON.stringify(db.snapshot(s)),before);
 const good=await db.patchRoot(s,rm.rootHead,[{op:'add',path:'/$refs/child',value:p.documentHead}]);
 assert.equal((await db.openDatabase(good.store,good.rootHead)).report.status,'complete');
 const id=db.unpackHead(g.rootHead).id,ct=db.readCipher(s,id);
 let enumerations=0,reads=0;
 const rawForLookup=db.snapshot(s),instrumented={...rawForLookup,records:new Proxy(rawForLookup.records,{ownKeys(){enumerations++;throw Error('lookup enumerates records');},get(t,k){reads++;assert.equal(k,id);return t[k];}})};
 await db.readRecord(instrumented,g.rootHead);assert.equal(enumerations,0);assert.equal(reads,1);
 for(const bad of ['', 'A'.repeat(21), 'A'.repeat(21)+'B', 'A'.repeat(22)+'!', 'A'.repeat(25)]){
  const invalid={...db.snapshot(s),records:{[id]:bad}};
  assert.throws(()=>db.validateStore(invalid),{code:'INVALID_RECORD'});
 }
 assert.equal(db.readCipher(s,id),ct);
 // Concurrent staging: both start from one revision, only the first can commit.
 const cs=db.newStore(),cg=await db.createDatabase(cs,'Concurrent');db.commit(cs,cg.store);
 const one=await db.patchRoot(cs,cg.rootHead,[{op:'add',path:'/x',value:1}]);
 const two=await db.patchRoot(cs,cg.rootHead,[{op:'add',path:'/x',value:2}]);
 db.publish(one.store,'Concurrent',one.rootHead,cg.rootHead);db.commit(cs,one.store);
 const committed=JSON.stringify(db.snapshot(cs));
 assert.throws(()=>db.commit(cs,two.store),{code:'STALE_TRANSACTION'});
 assert.throws(()=>JSON.stringify(db.snapshot(two.store)),{code:'STALE_TRANSACTION'});
 assert.equal(JSON.stringify(db.snapshot(cs)),committed);
 assert.equal((await db.load(cs,one.rootHead)).state.x,1);
 // Even the physical primitive rejects a concurrent write after its await.
 const physical=db.newStore(),pg=await db.genesis(physical,'Primitive',{});
 const attempts=await Promise.allSettled([1,2].map(v=>db.append(physical,pg.head,[{op:'add',path:'/x',value:v}])));
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.ok(['STALE_TRANSACTION','SUCCESSOR_OCCUPIED'].includes(attempts.find(x=>x.status==='rejected').reason.code));
 assert.equal(db.storeInfo(physical).count,2);
 // A direct controlled mutation invalidates the proof; the next checked write
 // must detect an authenticated-history violation instead of trusting stale state.
 const broken=db.adoptStore(JSON.parse(JSON.stringify(db.snapshot(cs))));
 await db.openDatabase(broken,one.rootHead);
 const rootId=db.unpackHead(cg.rootHead).id,patchId=db.unpackHead(one.rootHead).id;
 db.writePhysical(broken,rootId,db.readCipher(broken,patchId));
 const damaged=JSON.stringify(db.snapshot(broken));
 await assert.rejects(db.patchRoot(broken,one.rootHead,[{op:'add',path:'/y',value:3}]),{code:'INVALID_GCM'});
 assert.equal(JSON.stringify(db.snapshot(broken)),damaged);
 // Verify cached results cannot be modified through external state objects.
 const leaked=await db.readState(cs,one.rootHead);leaked.x=999;
 assert.equal((await db.readState(cs,one.rootHead)).x,1);
 const opened=await db.openDatabase(cs,one.rootHead);opened.chain.state.x=999;
 assert.equal((await db.readState(cs,one.rootHead)).x,1);
 assert.throws(()=>{db.writePhysical(cs,patchId,'A'.repeat(23)+'\n');},{code:'INVALID_RECORD'});
 // Snapshot caller-owned JSON before the first await. Cached state and
 // authenticated replay must remain exactly the same even if the caller mutates it.
 const input=[{op:'replace',path:'/x',value:7}];
 const pending=db.patchRoot(cs,one.rootHead,input);input[0].value=999;
 const snapshot=await pending;db.commit(cs,snapshot.store);
 assert.equal((await db.readState(cs,snapshot.rootHead)).x,7);
 assert.equal((await db.load(cs,snapshot.rootHead)).state.x,7);
 const badArray=[];Object.defineProperty(badArray,'0',{get(){throw Error('accessor ran');},enumerable:true,configurable:true});badArray.length=1;
 assert.throws(()=>db.assertJson(badArray),{code:'INVALID_JSON'});
 // Unmanaged raw reads take an adopted snapshot instead of rescanning mutable input.
 const raw=db.snapshot(cs);const verifying=db.verifyDatabase(raw,snapshot.rootHead);
 delete raw.records[db.unpackHead(snapshot.rootHead).id];
 assert.equal((await verifying).status,'complete');
 console.log('STABILITY PASS: immutable operation input and external read snapshot');
 console.log('STABILITY PASS: concurrent commit/append, proof invalidation, state isolation, strict hidden records');
 console.log('STABILITY PASS: checked root write, rollback rejection, atomic failure, direct physical lookup, strict ciphertext');
})().catch(e=>{console.error(e);process.exitCode=1;});
