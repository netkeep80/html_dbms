'use strict';
const assert = require('node:assert/strict');
const db = require('../src/core-node.cjs');
const id=head=>db.unpackHead(head).id;
const fixedTime = '2026-11-23T18:00:00.000Z';

(async()=>{
 const bytes=Uint8Array.from({length:48},(_,i)=>i*5%256);
 const head=db.packHead(bytes.slice(0,16),bytes.slice(16));
 assert.equal(head,Buffer.from(bytes).toString('base64url'));assert.equal(head.length,64);
 const decoded=db.unpackHead(head);assert.deepEqual(decoded.idBytes,bytes.slice(0,16));assert.deepEqual(decoded.hashBytes,bytes.slice(16));
 assert.equal(db.packHead(decoded.id,decoded.hash),head);assert.notEqual(decoded.id,head.slice(0,22));
 for(const bad of [null,[],[decoded.id,decoded.hash],head+'=',head+' ',head.slice(1),'!'+head.slice(1),decoded.id+decoded.hash]){assert.equal(db.validHead(bad),false);assert.throws(()=>db.unpackHead(bad));}
 assert.throws(()=>db.packHead(decoded.id.slice(0,-1)+'B',decoded.hash));
 assert.equal(await db.successorId(head),require('node:crypto').createHash('sha256').update(bytes).digest().subarray(0,16).toString('base64url'));
 assert.throws(()=>db.validateStore({format:'HTML_DBMS/3',records:{}}),{code:'UNSUPPORTED_STORAGE'});
 assert.throws(()=>db.validateStore({format:db.VERSION,records:{},publicHeads:{x:[decoded.id,decoded.hash]}}),{code:'INVALID_PUBLIC_HEADS'});

 const s=db.newStore();assert.equal(s.format,'HTML_DBMS/4');
 const created=await db.createDatabase(s,'Касса');db.commit(s,created.store);
 const r0=created.rootHead;
 assert.deepEqual(s.publicHeads['Касса'],r0);
 assert.deepEqual((await db.load(s,r0)).state,{name:'Касса',entry:null,$refs:{}});
 let rg=await db.readRecord(s,r0);assert.equal(rg.length,2);assert.equal(rg[0],null);
 assert.deepEqual(rg[1].parent,null);
 // Compact patch must have exactly three fields; no sequence or repeated patch type marker.
 const doc=await db.createDocument(s,r0,'funds',{F001:{name:'Первый',amount:0}});
 db.commit(s,doc.store); const r1=doc.rootHead;const f0=doc.documentHead;
 assert.deepEqual((await db.load(s,f0)).genesis.parent,r0);
 const rootPatch=await db.readRecord(s,r1);assert.equal(rootPatch.length,3);
 assert.match(rootPatch[0],/^2026-|^20\d\d-/);
 assert.equal(rootPatch[1],r0);
 assert.deepEqual(rootPatch[2],[{op:'add',path:'/$refs/funds',value:f0}]);
 assert.deepEqual((await db.load(s,r0)).state.$refs,{});
 assert.deepEqual((await db.load(s,r1)).state.$refs.funds,f0);
 assert.deepEqual((await db.resolve(s,r1,r1,{$ref:'funds/F001/name'})).value,'Первый');
 assert.deepEqual((await db.resolve(s,r1,f0,{$ref:'/F001/name'})).value,'Первый');
 assert.deepEqual((await db.resolve(s,r1,r1,{$ref:'funds/'})).value,{F001:{name:'Первый',amount:0}});
 const updated=await db.patchDocument(s,r1,'funds',[{op:'replace',path:'/F001/name',value:'Второй'}]);db.commit(s,updated.store);const r2=updated.rootHead;
 assert.deepEqual((await db.resolve(s,r2,r2,{$ref:'funds/F001/name'})).value,'Второй');
 assert.deepEqual((await db.resolve(s,r1,r1,{$ref:'funds/F001/name'})).value,'Первый');
 assert.equal((await db.load(s,r2)).events.length,3);
 assert.equal((await db.load(s,r2)).events[2].r.length,3);
 assert.equal((await db.load(s,updated.documentHead)).events.length,2);
 // Optional deep validation checks all child histories, temporal references and origins.
 const verified=await db.verifyDatabase(s,r2,{anchorHead:r0});
 assert.equal(verified.status,'complete');
 assert.equal(verified.checks.rootEvents,3);
 assert.equal(verified.checks.causalOrigins,1);
 assert.equal(verified.checks.anchorIndex,0);
 assert.equal(verified.documents.funds.events,2);
 await assert.rejects(db.verifyDatabase(s,r2,{anchorHead:'A'.repeat(64)}),{code:'ANCHOR_MISMATCH'});
 // Publishing is not implicit in the low-level core.
 assert.deepEqual(s.publicHeads['Касса'],r0);
 let staged=db.staging(s);db.publish(staged,'Касса',r2,r0);db.commit(s,staged);
 assert.deepEqual(s.publicHeads['Касса'],r2);
 // Multiple independent databases in one physical file.
 const warehouse=await db.createDatabase(s,'Склад');db.commit(s,warehouse.store);
 assert.equal(Object.keys(s.publicHeads).length,2);
 assert.notDeepEqual(warehouse.rootHead,r2);
 // Hidden database and optional publication catalog.
 const hidden=await db.createDatabase(s,'Бухгалтерия',{visible:false});db.commit(s,hidden.store);
 assert.equal(s.publicHeads['Бухгалтерия'],undefined);
 assert.equal((await db.load(s,hidden.rootHead)).state.name,'Бухгалтерия');
 let hiddenStore=db.staging(s);delete hiddenStore.publicHeads;db.validateStore(hiddenStore);
 assert.equal((await db.load(hiddenStore,r2)).state.name,'Касса');
 assert.throws(()=>db.validateStore({...s,format:'HTML_DBMS/2.2'}),{code:'UNSUPPORTED_STORAGE'});
 assert.throws(()=>db.validateStore({...s,publicHead:r2}),{code:'UNSUPPORTED_STORAGE'});
 // Attempting second write on an occupied successor never silently replaces it.
 await assert.rejects(db.append(s,r1,[{op:'add',path:'/name2',value:'collision'}]),{code:'SUCCESSOR_OCCUPIED'});
 // Invalid JSON Patch should fail before any mutation.
 const before=JSON.stringify(s.records);
 await assert.rejects(db.append(s,r2,[]),{code:'INVALID_PATCH'});
 assert.equal(JSON.stringify(s.records),before);
 // Timestamp is preserved; it is metadata from the local clock, not trusted time.
 const testStore=db.newStore();const g=await db.genesis(testStore,'Test',{});
 const e=await db.append(testStore,g.head,[{op:'add',path:'/x',value:1}],{timestamp:fixedTime});
 const crypto=require('node:crypto');
 function assertCipher(record,physical,expectedHead){
   const bytes=Buffer.from(JSON.stringify(record));const digest=crypto.createHash('sha256').update(bytes).digest();
   const cipher=crypto.createCipheriv('aes-256-gcm',digest,physical.subarray(0,12));
   const ct=Buffer.concat([cipher.update(bytes),cipher.final(),cipher.getAuthTag()]).toString('base64url');
   assert.equal(expectedHead,Buffer.concat([physical,digest]).toString('base64url'));
   assert.equal(testStore.records[physical.toString('base64url')],ct);
 }
 const gRecord=[null,{name:'Test',parent:null,state:{}}],gDigest=crypto.createHash('sha256').update(JSON.stringify(gRecord)).digest();
 assertCipher(gRecord,crypto.createHash('sha256').update(gDigest).digest().subarray(0,16),g.head);
 assertCipher([fixedTime,g.head,[{op:'add',path:'/x',value:1}]],crypto.createHash('sha256').update(Buffer.from(g.head,'base64url')).digest().subarray(0,16),e.head);

 assert.deepEqual(await db.readRecord(testStore,e.head),[fixedTime,g.head,[{op:'add',path:'/x',value:1}]]);
 // Cause of creation is selected root head, not globally published head.
 const plain=await db.genesis(testStore,'leaf',{$refs:{}},g.head);
 assert.deepEqual((await db.load(testStore,plain.head)).genesis.parent,g.head);
 // Arbitrary document can be opened as root, with no refs.
 const emptyRefs=await db.resolve(s,hidden.rootHead,hidden.rootHead,{$ref:'/name'});
 assert.equal(emptyRefs.value,'Бухгалтерия');
 await assert.rejects(db.resolve(s,r2,r2,{$ref:'missing/x'}),{code:'UNKNOWN_DOCUMENT'});
 await assert.rejects(db.resolve(s,r2,r2,{$ref:'funds/~2'}),{code:'INVALID_POINTER'});
 // Cycle diagnostics by logical references, not physical loop.
 const cycStore=db.newStore();const cyc=await db.genesis(cycStore,'C',{a:{$ref:'/b'},b:{$ref:'/a'}});
 await assert.rejects(db.resolve(cycStore,cyc.head,cyc.head,{$ref:'/a'}),{code:'REF_CYCLE'});
 // Corruption is detected, history is not automatically truncated.
 const brokenStore=db.staging(testStore);brokenStore.records[id(g.head)]=brokenStore.records[id(e.head)];
 const broken=await db.inspect(brokenStore,e.head);
 assert.equal(broken.status,'broken');assert.equal(broken.code,'INVALID_GCM');assert.ok(brokenStore.records[id(e.head)]);
 assert.equal((await db.inspect(testStore,e.head)).status,'complete');
 // Destructive overwrite of an intermediate slot: preserve occupant, remove only
 // authenticated descendants after explicit diagnosis and a verified recovery head.
 const branch=db.newStore();
 const bg=await db.genesis(branch,'branch',{x:0});
 const b1=await db.append(branch,bg.head,[{op:'replace',path:'/x',value:1}]);
 const b2=await db.append(branch,b1.head,[{op:'replace',path:'/x',value:2}]);
 const overwrite=await db.append(branch,bg.head,[{op:'replace',path:'/x',value:99}],{overwrite:true});
 assert.equal(overwrite.overwritten,true);
 const damage=await db.inspect(branch,b2.head);
 assert.equal(damage.status,'broken');
 assert.equal(id(damage.invalid),id(b1.head));
 const recovered=await db.truncateInvalidTail(branch,damage,bg.head);
 assert.deepEqual(recovered.deletedIds,[id(b2.head)]);
 assert.equal(recovered.keptInvalidSlot,id(b1.head));
 assert.ok(recovered.store.records[id(b1.head)]);
 assert.equal(recovered.store.records[id(b2.head)],undefined);
 assert.equal((await db.load(recovered.store,bg.head)).state.x,0);
 await assert.rejects(db.truncateInvalidTail(branch,damage,overwrite.head),{code:'INVALID_RECOVERY_HEAD'});
 // Distinct append messages from same predecessor always target the same address.
 assert.equal(await db.successorId(g.head),id(e.head));
 // Audit BLOCKER: removed aliases are still part of the historical verification domain.
 const historical=db.newStore();
 const hg=await db.createDatabase(historical,'History');db.commit(historical,hg.store);
 const hd=await db.createDocument(historical,hg.rootHead,'funds',{value:0});db.commit(historical,hd.store);
 const hp=await db.patchDocument(historical,hd.rootHead,'funds',[{op:'replace',path:'/value',value:1}]);db.commit(historical,hp.store);
 const prevRoot=await db.load(historical,hp.rootHead);
 const removed=await db.append(historical,hp.rootHead,[{op:'remove',path:'/$refs/funds'}]);
 const verifiedRemoved=await db.verifyDatabase(historical,removed.head);
 assert.equal(verifiedRemoved.status,'complete');
 assert.equal(verifiedRemoved.checks.documents,1,'removed historical document must remain verified');
 assert.equal(verifiedRemoved.checks.activeDocuments,0);
 assert.equal(verifiedRemoved.documents.funds.active,false);
 const rollback=await db.append(historical,removed.head,[{op:'add',path:'/$refs/funds',value:hd.documentHead}]);
 await assert.rejects(db.verifyDatabase(historical,rollback.head),{code:'REFERENCE_ROLLBACK'},'remove then re-add older child is rollback');
 const damaged=db.staging(historical);
 damaged.records[id(hd.documentHead)]=damaged.records[id(hp.rootHead)];
 await assert.rejects(db.verifyDatabase(damaged,removed.head),{code:'INVALID_GCM'},'corrupt removed historical ciphertext must fail verification');
 const returnNew=await db.append(historical,rollback.head,[{op:'replace',path:'/$refs/funds',value:hp.documentHead}]);
 await assert.rejects(db.verifyDatabase(historical,returnNew.head),{code:'REFERENCE_ROLLBACK'},'rollback cannot be laundered by a later forward update');
 // Allow a temporarily removed alias to return to the SAME latest head.
 const keep=db.staging(historical);
 const returnSame=await db.append(keep,removed.head,[{op:'add',path:'/$refs/funds',value:hp.documentHead}],{overwrite:true});
 assert.equal((await db.verifyDatabase(keep,returnSame.head)).status,'complete');
 // Explicit overwrite can be enabled independently for child and root successor.
 const conflict=db.newStore();const cg=await db.createDatabase(conflict,'Collision');db.commit(conflict,cg.store);
 const cd=await db.createDocument(conflict,cg.rootHead,'child',{v:0});db.commit(conflict,cd.store);
 const cfirst=await db.patchDocument(conflict,cd.rootHead,'child',[{op:'replace',path:'/v',value:1}]);db.commit(conflict,cfirst.store);
 await assert.rejects(db.patchDocument(conflict,cd.rootHead,'child',[{op:'replace',path:'/v',value:2}]),{code:'SUCCESSOR_OCCUPIED',phase:'child'});
 await assert.rejects(db.patchDocument(conflict,cd.rootHead,'child',[{op:'replace',path:'/v',value:2}],{overwriteChild:true}),{code:'SUCCESSOR_OCCUPIED',phase:'root'});
 const accepted=await db.patchDocument(conflict,cd.rootHead,'child',[{op:'replace',path:'/v',value:2}],{overwriteChild:true,overwriteRoot:true});
 assert.equal((await db.load(accepted.store,accepted.rootHead)).state.$refs.child,accepted.documentHead);
 assert.equal((await db.load(accepted.store,accepted.documentHead)).state.v,2);
 // Staging leaves physical source unchanged until commit after confirmation.
 assert.deepEqual((await db.load(conflict,cfirst.documentHead)).state,{v:1});
 await assert.rejects(db.createDocument(conflict,cg.rootHead,'new-child',{value:2}),{code:'SUCCESSOR_OCCUPIED'});
 const overrideDoc=await db.createDocument(conflict,cg.rootHead,'new-child',{value:2},null,{overwriteRoot:true});
 assert.equal((await db.load(overrideDoc.store,overrideDoc.rootHead)).state.$refs['new-child'],overrideDoc.documentHead);
 console.log('HTML_DBMS/4 core tests PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
