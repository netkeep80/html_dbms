'use strict';
const assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),db=require('../src/core-node.cjs');
const subtle=(globalThis.crypto||webcrypto).subtle;
const serial=s=>JSON.stringify(db.snapshot(s));
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
 // Bidirectional decision test: construct a candidate by the low-level append
 // route on a detached snapshot, then invoke the full history verifier.
 // This does not reuse the incremental proof or checkChange implementation.
 const oracleStore=db.newStore(),base=await db.createDatabase(oracleStore,'Oracle');db.commit(oracleStore,base.store);
 let oh=base.rootHead,oracleAccepted=0,oracleRejected=0;
 const child=await db.createDocument(oracleStore,oh,'child',{n:0});db.commit(oracleStore,child.store);oh=child.rootHead;
 const advanced=await db.patchDocument(oracleStore,oh,'child',[{op:'replace',path:'/n',value:1}]);db.commit(oracleStore,advanced.store);oh=advanced.rootHead;
 const oldChild=child.documentHead,newChild=advanced.documentHead,stamp='2026-01-01T00:00:00.000Z';
 async function compareRoot(ops,expected){
  const before=serial(oracleStore),detached=db.adoptStore(JSON.parse(before));
  let reference=null,actual=null,referenceError=null,actualError=null;
  try{const event=await db.append(detached,oh,ops,{timestamp:stamp});await db.verifyDatabase(JSON.parse(serial(detached)),event.head);reference=event.head;}catch(e){referenceError=e.code;if(!referenceError)throw e;}
  try{actual=await db.patchRoot(oracleStore,oh,ops,{timestamp:stamp});}catch(e){actualError=e.code;if(!actualError)throw e;}
  assert.equal(serial(oracleStore),before);
  assert.equal(actualError,referenceError,'oracle decision/code differs');
  assert.equal(actualError,expected);
  if(actual){assert.equal(actual.rootHead,reference);assert.equal(serial(actual.store),serial(detached));db.commit(oracleStore,actual.store);oh=actual.rootHead;oracleAccepted++;}
  else{assert.equal(reference,null);oracleRejected++;}
 }
 await compareRoot([{op:'add',path:'/$refs/shared',value:newChild}],null);
 await compareRoot([{op:'remove',path:'/$refs/child'}],null);
 await compareRoot([{op:'add',path:'/$refs/child',value:oldChild}],'REFERENCE_ROLLBACK');
 await compareRoot([{op:'add',path:'/$refs/child',value:newChild}],null);
 await compareRoot([{op:'replace',path:'/$refs/shared',value:oldChild}],'REFERENCE_ROLLBACK');
 await compareRoot([{op:'replace',path:'/$refs',value:[]}],'INVALID_ROOT');
 await compareRoot([{op:'replace',path:'/$refs/child',value:'A'.repeat(64)}],"MISSING_RECORD");
 await compareRoot([{op:'remove',path:'/missing'}],'INVALID_POINTER');
 await compareRoot([{op:'replace',path:'',value:0}],null);
 await compareRoot([{op:'replace',path:'',value:{$refs:{child:oldChild}}}],'REFERENCE_ROLLBACK');
 await compareRoot([{op:'replace',path:'',value:{$refs:{child:newChild}}}],null);
 assert.equal(oracleAccepted,5);assert.equal(oracleRejected,6);
 console.log('BIDIRECTIONAL ROOT ORACLE PASS',JSON.stringify({accepted:oracleAccepted,rejected:oracleRejected}));
 // Compare child transactions against independently constructed physical
 // candidates. Freeze the clock only here so accepted snapshots compare byte
 // for byte, not just by effective JSON value. The core code is unmodified.
 const RealDate=globalThis.Date;
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return RealDate.parse(stamp);}};
 let childAccepted=0,childRejected=0;
 try{
  const store=db.newStore(),g=await db.createDatabase(store,'Child oracle');db.commit(store,g.store);
  let h=g.rootHead;
  async function compareChild(kind,alias,value,expected,options={},at=h,name=alias){
   const before=serial(store),base=db.adoptStore(JSON.parse(before)),root=(await db.load(base,at)).state,refs=root.$refs||{};
   let ref=null,actual=null,referenceError=null,actualError=null;
   try{
    const escaped=alias.replace(/~/g,'~0').split('/').join('~1');
    let ch;
    if(kind==='create'){
     if(!alias||alias.includes('/')||Object.hasOwn(refs,alias))throw Object.assign(Error('Duplicate or invalid alias'),{code:'DUPLICATE_DOCUMENT'});
     ch=(await db.genesis(base,name,value,at)).head;
    }else{
     if(!Object.hasOwn(refs,alias))throw Object.assign(Error('Missing alias'),{code:'UNKNOWN_DOCUMENT'});
     ch=(await db.append(base,refs[alias],value,{overwrite:!!options.overwriteChild,timestamp:stamp})).head;
    }
    const ops=kind==='create'&&!Object.hasOwn(root,'$refs')?[{op:'add',path:'/$refs',value:{[alias]:ch}}]:[{op:kind==='create'?'add':'replace',path:'/$refs/'+escaped,value:ch}];
    const rr=await db.append(base,at,ops,{overwrite:!!options.overwriteRoot,timestamp:stamp});
    await db.verifyDatabase(JSON.parse(serial(base)),rr.head);
    ref={rootHead:rr.head,documentHead:ch};
   }catch(e){referenceError=e.code;if(!referenceError)throw e;}
   try{actual=kind==='create'?await db.createDocument(store,at,name,value,alias,options):await db.patchDocument(store,at,alias,value,options);}catch(e){actualError=e.code;if(!actualError)throw e;}
   assert.equal(serial(store),before);
   assert.equal(actualError,referenceError,'child oracle decision/code differs');
   if(expected==='reject'){assert.ok(actualError);console.log('CHILD ORACLE OVERWRITE REJECT',actualError);}
   else assert.equal(actualError,expected);
   if(actual){
    assert.deepEqual({rootHead:actual.rootHead,documentHead:actual.documentHead},ref);
    assert.equal(serial(actual.store),serial(base));
    db.commit(store,actual.store);h=actual.rootHead;measure(store);childAccepted++;
   }else{assert.equal(ref,null);childRejected++;}
   return actual;
  }
  const created=await compareChild('create','a',{n:0},null);
  const oldRoot=h;
  await compareChild('create','a',{},'DUPLICATE_DOCUMENT');
  await compareChild('create','bad/name',{},'DUPLICATE_DOCUMENT');
  await compareChild('patch','missing',[],'UNKNOWN_DOCUMENT');
  await compareChild('patch','a',[{op:'remove',path:'/missing'}],'INVALID_POINTER');
  await compareChild('patch','a',[{op:'replace',path:'/n',value:1}],null);
  await compareChild('patch','a',[{op:'replace',path:'/n',value:2}],'SUCCESSOR_OCCUPIED',{},oldRoot);
  await compareChild('create','b',{},'SUCCESSOR_OCCUPIED',{},oldRoot);
  await compareChild('create','b',{},null);
  // Shared historical alias; a physical overwrite of its successor must
  // invalidate the current root graph and be rejected by BOTH algorithms.
  const shared=await db.patchRoot(store,h,[{op:'add',path:'/$refs/shared',value:created.documentHead}],{timestamp:stamp});db.commit(store,shared.store);h=shared.rootHead;
  await compareChild('patch','shared',[{op:'replace',path:'/n',value:3}],'SUCCESSOR_OCCUPIED');
  await compareChild('patch','shared',[{op:'replace',path:'/n',value:3}],'reject',{overwriteChild:true});
  await compareChild('patch','a',[{op:'replace',path:'/n',value:4}],null);
  // Root replacement with a detached genesis and no dependency on its old
  // successor is explicitly allowed, with full revalidation.
  await compareChild('create','alternate',{},null,{overwriteRoot:true},oldRoot);
  assert.equal(childAccepted,5);assert.equal(childRejected,8);
 }finally{globalThis.Date=RealDate;}
 console.log('BIDIRECTIONAL CHILD ORACLE PASS',JSON.stringify({accepted:childAccepted,rejected:childRejected}));
 // Explicit overwrite invalidates the previous proof and leaves old ciphertext descendants untouched.
 const s=db.newStore(),g=await db.createDatabase(s,'Overwrite');db.commit(s,g.store);
 const a=await db.patchRoot(s,g.rootHead,[{op:'add',path:'/n',value:1}]);db.commit(s,a.store);
 const b=await db.patchRoot(s,a.rootHead,[{op:'replace',path:'/n',value:2}]);db.commit(s,b.store);
 const oldId=db.unpackHead(b.rootHead).id,oldCipher=db.readCipher(s,oldId);
 const repl=await db.patchRoot(s,g.rootHead,[{op:'add',path:'/n',value:3}],{overwrite:true});db.commit(s,repl.store);
 assert.equal(db.readCipher(s,oldId),oldCipher);assert.equal((await db.verifyDatabase(s,repl.rootHead)).status,'complete');
 await assert.rejects(db.verifyDatabase(s,b.rootHead),{code:'INVALID_GCM'});measure(s);
 // Physical insert, replace, delete and catalog omission preserve exact size metadata.
 const id=db.encode64(new Uint8Array(16));db.writePhysical(s,id,'A'.repeat(22));measure(s);db.writePhysical(s,id,'A'.repeat(24));measure(s);db.removePhysical(s,id);db.unpublish(s,'Overwrite');measure(s);
 const detached=db.snapshot(s);detached.records[id]='A'.repeat(22);detached.publicHeads={Fake:'A'.repeat(64)};assert.equal(db.readCipher(s,id),undefined);assert.deepEqual(db.catalog(s),{});assert.equal(Object.isFrozen(s),true);assert.throws(()=>{s.records={};},TypeError);
 assert.ok(accepted>=12&&rejected>=3);
 console.log('DIFFERENTIAL PASS',JSON.stringify({seeds:3,accepted,rejected,aliases:true,overwrite:true,byteAccounting:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
