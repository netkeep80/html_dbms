'use strict';
const assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),db=require('../src/core-node.cjs');
const subtle=(globalThis.crypto||webcrypto).subtle;
const serial=s=>JSON.stringify(s);
function measure(s){
 const snapshot=JSON.parse(serial(s)),info=db.storeInfo(s);
 assert.deepEqual(info,{count:Object.keys(snapshot.records).length,published:Object.keys(snapshot.publicHeads||{}).length,bytes:Buffer.byteLength(serial(s))});
}
(async()=>{
 let accepted=0,rejected=0;
 for(const initialSeed of [17,317,991]){
  let seed=initialSeed;function rand(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;}
  const s=db.newStore(),g=await db.createDatabase(s,'Проверка '+initialSeed);db.commit(s,g.store);let h=g.rootHead;
  const historical=new Map(),roots=[h];
  async function commit(r){
   db.publish(r.store,'Проверка '+initialSeed,r.rootHead,h);
   // Full verifier before commit on a separately adopted snapshot, never using proof.
   const raw=JSON.parse(serial(r.store));
   assert.equal((await db.verifyDatabase(raw,r.rootHead)).status,'complete');
   assert.deepEqual(await db.readState(r.store,r.rootHead),(await db.load(raw,r.rootHead)).state);
   measure(r.store);db.commit(s,r.store);h=r.rootHead;roots.push(h);measure(s);
   assert.equal((await db.verifyDatabase(JSON.parse(serial(s)),h)).status,'complete');
   assert.throws(()=>db.commit(s,r.store),{code:'STALE_TRANSACTION'});
   accepted++;
  }
  async function deny(p,code,before){await assert.rejects(p,{code});assert.equal(serial(s),before);rejected++;}
  for(const name of ['a','b','c']){const r=await db.createDocument(s,h,name,{n:0});await commit(r);historical.set(name,[r.documentHead]);}
  const alias=await db.patchRoot(s,h,[{op:'add',path:'/$refs/alias',value:historical.get('a')[0]}]);await commit(alias);historical.set('alias',[historical.get('a')[0]]);
  for(let i=0;i<36;i++){
   const state=await db.readState(s,h),names=[...historical.keys()],name=names[rand(names.length)],versions=historical.get(name),active=Object.hasOwn(state.$refs,name),before=serial(s);
   const path='/$refs/'+name;
   switch(rand(6)){
    case 0: if(active){
      // Shared aliases can point to different historical versions; only advance from the newest physical version.
      try{const r=await db.patchDocument(s,h,name,[{op:'replace',path:'/n',value:i+1}]);await commit(r);versions.push(r.documentHead);}
      catch(e){if(e.code!=='SUCCESSOR_OCCUPIED')throw e;assert.equal(serial(s),before);rejected++;}
     }break;
    case 1: if(active)await commit(await db.patchRoot(s,h,[{op:'remove',path}]));
     else await commit(await db.patchRoot(s,h,[{op:'add',path,value:versions.at(-1)}]));break;
    case 2: if(versions.length>1)await deny(db.patchRoot(s,h,[{op:'add',path,value:versions[0]}]),'REFERENCE_ROLLBACK',before);break;
    case 3: await deny(db.patchRoot(s,h,[{op:'replace',path:'/$refs',value:[]}]),'INVALID_ROOT',before);break;
    case 4: await commit(await db.patchRoot(s,h,[{op:'replace',path:'',value:{...state,iteration:i}}]));break;
    case 5: {const earlier=roots[rand(roots.length)];await db.openDatabase(s,earlier);assert.deepEqual(await db.readState(s,earlier),(await db.load(s,earlier)).state);assert.equal(serial(s),before);break;}
   }
  }
  // A transaction belongs to exactly one base, even if its contents are identical.
  const foreign=db.adoptStore(JSON.parse(serial(s))),tx=db.staging(s);
  assert.throws(()=>db.commit(foreign,tx),{code:'INVALID_TRANSACTION'});
  assert.equal(serial(foreign),serial(s));db.commit(s,tx);measure(s);
  // Inject second encrypt failure after a valid child event is staged.
  const current=await db.readState(s,h),name=Object.keys(current.$refs).find(k=>k!=='alias'&&k!=='a');
  if(name){const before=serial(s),encrypt=subtle.encrypt;let calls=0;
   subtle.encrypt=function(...args){if(++calls===2)return Promise.reject(Error('second encrypt failed'));return encrypt.apply(this,args);};
   try{await assert.rejects(db.patchDocument(s,h,name,[{op:'replace',path:'/n',value:1000}]),/second encrypt failed/);assert.equal(calls,2);assert.equal(serial(s),before);rejected++;}
   finally{subtle.encrypt=encrypt;}
  }
 }
 // Explicit overwrite invalidates the previous proof and leaves old ciphertext descendants untouched.
 const s=db.newStore(),g=await db.createDatabase(s,'Overwrite');db.commit(s,g.store);
 const a=await db.patchRoot(s,g.rootHead,[{op:'add',path:'/n',value:1}]);db.commit(s,a.store);
 const b=await db.patchRoot(s,a.rootHead,[{op:'replace',path:'/n',value:2}]);db.commit(s,b.store);
 const oldId=db.unpackHead(b.rootHead).id,oldCipher=s.records[oldId];
 const repl=await db.patchRoot(s,g.rootHead,[{op:'add',path:'/n',value:3}],{overwrite:true});db.commit(s,repl.store);
 assert.equal(s.records[oldId],oldCipher);assert.equal((await db.verifyDatabase(s,repl.rootHead)).status,'complete');
 await assert.rejects(db.verifyDatabase(s,b.rootHead),{code:'INVALID_GCM'});measure(s);
 // Physical insert, replace, delete and catalog omission preserve exact size metadata.
 const id=db.encode64(new Uint8Array(16));s.records[id]='A'.repeat(22);measure(s);s.records[id]='A'.repeat(24);measure(s);delete s.records[id];delete s.publicHeads;measure(s);
 assert.ok(accepted>=12&&rejected>=3);
 console.log('DIFFERENTIAL PASS',JSON.stringify({seeds:3,accepted,rejected,aliases:true,overwrite:true,byteAccounting:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
