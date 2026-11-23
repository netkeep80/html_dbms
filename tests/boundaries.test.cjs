'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),db=require('../src/core-node.cjs');
(async()=>{
 for(let n=0;n<=80;n++){
  const bytes=Uint8Array.from({length:n},(_,i)=>(i*71+n)%256),encoded=Buffer.from(bytes).toString('base64url');
  assert.equal(db.encode64(bytes),encoded);assert.deepEqual(db.decode64(encoded),bytes);
 }
 for(const bad of ['A','AB','AAB','AA=','A+','A/','AA\n',' AA',null,[]])assert.throws(()=>db.decode64(bad),{code:'INVALID_BASE64'});
 const h=Buffer.alloc(32,7),id=crypto.createHash('sha256').update(h).digest().subarray(0,16);
 assert.equal(await db.rootId(h.toString('base64url')),id.toString('base64url'));
 const head=db.packHead(id,h);assert.equal(db.sameHead(head,head),true);assert.equal(db.sameHead('bad','bad'),false);
 assert.equal(await db.successorId(head),crypto.createHash('sha256').update(Buffer.from(head,'base64url')).digest().subarray(0,16).toString('base64url'));
 assert.equal(db.escapePtr('a~/b'),'a~0~1b');
 assert.deepEqual(db.pointer({'a~/b':[1,2]},'/a~0~1b/1'),2);
 const input={a:[1,2,3],x:{b:1},'__test':null};
 const p=db.patch(input,[{op:'test',path:'/x',value:{b:1}},{op:'copy',from:'/x',path:'/copy'},{op:'move',from:'/a/0',path:'/a/-'},{op:'remove',path:'/__test'},{op:'replace',path:'/copy/b',value:2},{op:'add',path:'/__proto__',value:{safe:true}}]);
 assert.deepEqual(p.a,[2,3,1]);assert.deepEqual(p.x,{b:1});assert.deepEqual(p.copy,{b:2});assert.equal(Object.getPrototypeOf(p),Object.prototype);assert.equal(p.__proto__.safe,true);assert.equal(input.a[0],1);
 assert.equal(db.patch({},[{op:'replace',path:'',value:4}]),4);
 for(const ops of [[{op:'test',path:'/x',value:{b:2}}],[{op:'move',from:'/x',path:'/x/b'}],[{op:'add',path:'/a/01',value:4}],[{op:'remove',path:'/absent'}],[{op:'invalid',path:''}]])assert.throws(()=>db.patch(input,ops));
 const cyclic={};cyclic.self=cyclic;let deep=null;for(let i=0;i<35;i++)deep=[deep];
 const accessor={};Object.defineProperty(accessor,'x',{get(){throw Error('must not run');},enumerable:true});
 for(const bad of [cyclic,deep,accessor,[,1],{n:Infinity},{n:undefined},new Date(),{[Symbol('x')]:1}])assert.throws(()=>db.assertJson(bad),{code:'INVALID_JSON'});
 const s=db.newStore(),g=await db.genesis(s,'Test',{});
 const again=await db.genesis(s,'Test',{});assert.equal(again.existing,true);assert.equal(again.head,g.head);
 const original=db.readCipher(s,db.unpackHead(g.head).id);
 const raw={format:db.VERSION,records:{},publicHeads:{}};
 assert.throws(()=>db.validateStore({...raw,extra:true}),{code:'UNSUPPORTED_STORAGE'});
 assert.throws(()=>db.validateStore({...raw,records:{[id.toString('base64url')]:'A'.repeat(21)+'B'}}),{code:'INVALID_RECORD'});
 assert.throws(()=>db.publish(s,'',g.head),{code:'INVALID_PUBLIC_HEADS'});
 db.publish(s,'__proto__',g.head);assert.equal(Object.hasOwn(db.catalog(s),'__proto__'),true);
 assert.throws(()=>db.publish(s,'__proto__',g.head,'A'.repeat(64)),{code:'STALE_PUBLIC_HEAD'});
 db.unpublish(s,'__proto__');assert.ok(!('publicHeads' in db.snapshot(s)));
 const originalId=db.unpackHead(g.head).id;db.writePhysical(s,originalId,'A'.repeat(22));
 await assert.rejects(db.genesis(s,'Test',{}),{code:'ROOT_OCCUPIED'});
 const repaired=await db.genesis(s,'Test',{},null,{overwrite:true});assert.equal(repaired.head,g.head);assert.equal(db.readCipher(s,originalId),original);
 function ciphertext(bytes,key,address){const cipher=crypto.createCipheriv('aes-256-gcm',key,address.subarray(0,12));return Buffer.concat([cipher.update(bytes),cipher.final(),cipher.getAuthTag()]).toString('base64url');}
 const bytes=Buffer.from(JSON.stringify([null,{name:'Test',parent:null,state:{}}])),digest=crypto.createHash('sha256').update(bytes).digest(),wrongId=Buffer.alloc(16,7),wrongHash=Buffer.alloc(32,6);
 db.writePhysical(s,wrongId.toString('base64url'),ciphertext(bytes,digest,wrongId));await assert.rejects(db.readRecord(s,db.packHead(wrongId,digest)),{code:'ADDRESS_MISMATCH'});
 db.writePhysical(s,wrongId.toString('base64url'),ciphertext(bytes,wrongHash,wrongId));await assert.rejects(db.readRecord(s,db.packHead(wrongId,wrongHash)),{code:'HASH_MISMATCH'});
 db.removePhysical(s,wrongId.toString('base64url'));await assert.rejects(db.readRecord(s,db.packHead(wrongId,digest)),{code:'MISSING_RECORD'});
 const a=await db.append(s,g.head,[{op:'add',path:'/a',value:1}]);const b=await db.overwrite(s,g.head,[{op:'add',path:'/a',value:2}]);assert.equal(b.overwritten,true);await assert.rejects(db.load(s,a.head),{code:'INVALID_GCM'});
 const q=db.newStore(),r=await db.createDatabase(q,'Failure');db.commit(q,r.store);
 const d=await db.createDocument(q,r.rootHead,'child',{n:0});db.commit(q,d.store);
 const before=JSON.stringify(db.snapshot(q)),subtle=globalThis.crypto.subtle,encrypt=subtle.encrypt;let calls=0;
 subtle.encrypt=function(...args){if(++calls===2)return Promise.reject(Error('second encryption injected'));return encrypt.apply(this,args);};
 try{await assert.rejects(db.patchDocument(q,d.rootHead,'child',[{op:'replace',path:'/n',value:1}]),/second encryption injected/);assert.equal(calls,2);assert.equal(JSON.stringify(db.snapshot(q)),before);}finally{subtle.encrypt=encrypt;}
 const read=db.readState(q,d.rootHead),tx=db.staging(q);db.publish(tx,'Failure',d.rootHead);db.commit(q,tx);await assert.rejects(read,{code:'STALE_TRANSACTION'});
 assert.equal((await db.verifyDatabase(q,d.rootHead)).status,'complete');
 console.log('BOUNDARIES PASS: codec residual bits, independent wrong address/hash ciphertext, RFC6902, JSON limits, genesis idempotence/overwrite, publication, second encryption failure, stale read');
})().catch(e=>{console.error(e);process.exitCode=1;});
