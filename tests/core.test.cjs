const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');globalThis.crypto=webcrypto;
require('../src/core.js');const C=globalThis.HTMLDBMSCore;

async function putEvent(store,id,event){
 const te=new TextEncoder();const plain=te.encode(JSON.stringify(event));
 const h=new Uint8Array(await crypto.subtle.digest('SHA-256',plain));
 const hash=C.to64(h);const key=await crypto.subtle.importKey('raw',h,{name:'AES-GCM'},false,['encrypt']);
 const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:C.ivForId(id),tagLength:128},key,plain));
 store.records[id]=C.to64(ct);return hash;
}
function txState(){return {title:'История операций',columns:{date:{title:'Дата',type:'date'},amount:{title:'Сумма',type:'number'},note:{title:'Примечание',type:'text'}},rows:{}};}
function mainState(tx){return {title:'Demo',tabs:['items','transactions'],tables:{items:{title:'Предметы',columns:{name:{title:'Название',type:'text'}},rows:{}},transactions:{title:'Операции',type:'chain',head:[tx.id,tx.hash]}}};}

(async()=>{
 assert.equal(C.VERSION,'HTML_DBMS/2.2');
 const store=C.newStore();assert.equal(store.publicHead,null);
 const tg=await C.genesis(store,'transaction',txState());
 const mg=await C.genesis(store,'main',mainState(tg));store.publicHead=[mg.id,mg.hash];
 let main=await C.load(store,[mg.id,mg.hash]);assert.equal(main.searched,false);assert.equal(main.policy,'main');
 let found=await C.load(store,[null,mg.hash]);assert.equal(found.headId,mg.id);assert.equal(found.searched,true);
 let nohead=await C.inspect(store,null);assert.equal(nohead.code,'HEAD_REQUIRED');
 await C.verifyNestedChains(store,main);

 // JSON-only domain is enforced before commit.
 const before=Object.keys(store.records).length;
 await assert.rejects(C.append(store,main,[{op:'add',path:'/x',value:undefined}]),e=>e.code==='NON_JSON_VALUE');
 await assert.rejects(C.append(store,main,[{op:'add',path:'/x',value:NaN}]),e=>e.code==='NON_JSON_VALUE');
 await assert.rejects(C.genesis(store,'main',{x:new Date()}),e=>e.code==='NON_JSON_VALUE'||e.code==='INVALID_STATE');
 const sparse=[];sparse.length=2;sparse[1]=1;assert.throws(()=>C.assertJson(sparse),e=>e.code==='NON_JSON_VALUE');
 assert.equal(Object.keys(store.records).length,before);

 // Transaction schema is immutable and checked on append.
 let tx=await C.load(store,[tg.id,tg.hash]);
 const t1=await C.append(store,tx,[{op:'add',path:'/rows/r1',value:{date:'2026-11-23',amount:8,note:'ok'}}]);
 tx=await C.load(store,[t1.id,t1.head]);assert.equal(tx.state.rows.r1.amount,8);
 await assert.rejects(C.append(store,tx,[{op:'add',path:'/rows/r2',value:{date:'bad',amount:'8',note:'x'}}]),e=>e.code==='SCHEMA_VIOLATION');

 // Main stores only nested pointer; transaction columns come from transaction chain.
 main=await C.load(store,[mg.id,mg.hash]);
 const m1=await C.append(store,main,[{op:'replace',path:'/tables/transactions/head',value:[t1.id,t1.head]}]);
 main=await C.load(store,[m1.id,m1.head]);await C.verifyNestedChains(store,main);
 assert.equal(main.state.tables.transactions.columns,undefined);

 // Effective-state continuity catches subtree rollback, regardless of patch path, before commit.
 await assert.rejects(C.append(store,main,[{op:'replace',path:'/tables/transactions',value:{title:'Операции',type:'chain',head:[tg.id,tg.hash]}}]),e=>e.code==='NESTED_CHAIN_ROLLBACK');
 // A manually forged rollback event is still rejected on read.
 const rollbackId=await C.address(main.headId,main.head);
 const rollbackEvent=[main.events.at(-1).r[0]+1,'patch','2026-11-23T00:00:00.000Z',main.headId,main.head,{patch:[{op:'replace',path:'/tables/transactions',value:{title:'Операции',type:'chain',head:[tg.id,tg.hash]}}]}];
 const rollbackHash=await putEvent(store,rollbackId,rollbackEvent);
 const rolled=await C.inspect(store,[rollbackId,rollbackHash]);assert.equal(rolled.status,'complete');
 await assert.rejects(C.load(store,[rollbackId,rollbackHash]),e=>e.code==='NESTED_CHAIN_ROLLBACK');
 delete store.records[rollbackId];

 // Occupied canonical successor is non-destructive by default and overwritable explicitly.
 const forkStore=C.newStore();const g=await C.genesis(forkStore,'main',{title:'X',tabs:['t'],tables:{t:{title:'T',columns:{x:{title:'X',type:'text'}},rows:{}}}});
 let c=await C.load(forkStore,[g.id,g.hash]);
 const a=await C.append(forkStore,c,[{op:'add',path:'/tables/t/rows/a',value:{x:'a'}}]);
 c=await C.load(forkStore,[a.id,a.head]);
 const b=await C.append(forkStore,c,[{op:'replace',path:'/tables/t/rows/a/x',value:'b'}]);
 c=await C.load(forkStore,[b.id,b.head]);
 const later=await C.append(forkStore,c,[{op:'replace',path:'/tables/t/rows/a/x',value:'later'}]);
 const oldHead=[later.id,later.head];
 const fromA=await C.load(forkStore,[a.id,a.head]);
 const occupiedBytes=forkStore.records[b.id];
 await assert.rejects(C.append(forkStore,fromA,[{op:'replace',path:'/tables/t/rows/a/x',value:'branch'}]),e=>e.code==='SUCCESSOR_OCCUPIED'&&e.details.id===b.id);
 assert.equal(forkStore.records[b.id],occupiedBytes);
 const branched=await C.append(forkStore,fromA,[{op:'replace',path:'/tables/t/rows/a/x',value:'branch'}],{overwrite:true});
 assert.equal(branched.id,b.id);assert.equal(branched.overwritten,true);assert.notEqual(forkStore.records[b.id],occupiedBytes);

 // A later old head detects that an intermediate physical slot was replaced.
 const broken=await C.inspect(forkStore,oldHead);assert.equal(broken.code,'REPLACED_OR_CORRUPTED_PREDECESSOR');assert.equal(broken.invalid.id,b.id);assert.ok(broken.tailIds.includes(b.id));
 // Explicit truncate with independently known older pointer removes the broken tail only when requested.
 const truncated=await C.truncateInvalidTail(forkStore,broken,[a.id,a.head]);assert.equal(truncated.head[0],a.id);
 assert.equal(Object.hasOwn(forkStore.records,b.id),true,'Never delete occupied successor of a new branch');
 assert.deepEqual(truncated.preservedIds,[b.id]);
 assert.equal(Object.hasOwn(forkStore.records,later.id),false,'Only orphaned descendants are deleted');
 assert.equal((await C.load(forkStore,[branched.id,branched.head])).state.tables.t.rows.a.x,'branch');
 assert.equal((await C.load(forkStore,[a.id,a.head])).state.tables.t.rows.a.x,'a');
 await assert.rejects(C.truncateInvalidTail(forkStore,broken,[a.id,a.head]),e=>e.code==='STALE_DIAGNOSIS');

 // Manual replay-time schema violation is detected even if ciphertext/hash/address are internally consistent.
 const badStore=C.newStore();const root=await C.genesis(badStore,'transaction',txState());
 const badId=await C.address(root.id,root.hash);
 const badEvent=[2,'patch','2026-11-23T00:00:00.000Z',root.id,root.hash,{patch:[{op:'add',path:'/rows/bad',value:{date:'2026-11-23',amount:'oops',note:'x'}}]}];
 const badHash=await putEvent(badStore,badId,badEvent);
 const badInspect=await C.inspect(badStore,[badId,badHash]);assert.equal(badInspect.code,'SCHEMA_VIOLATION');assert.deepEqual(badInspect.recoveryHead,[root.id,root.hash]);

 // Invalid timestamp is rejected on read.
 const tsStore=C.newStore();const tsRoot=await C.genesis(tsStore,'main',{title:'X',tabs:['t'],tables:{t:{title:'T',columns:{x:{title:'X',type:'text'}},rows:{}}}});
 const tsId=await C.address(tsRoot.id,tsRoot.hash);const tsEvent=[2,'patch','not-a-date',tsRoot.id,tsRoot.hash,{patch:[]}];const tsHash=await putEvent(tsStore,tsId,tsEvent);
 const tsInspect=await C.inspect(tsStore,[tsId,tsHash]);assert.equal(tsInspect.code,'HEAD_RECORD_INVALID');

 // Canonical Base64url only.
 assert.throws(()=>C.from64('AAAAAAAAAAAAAAAAAAAAAB'),e=>e.code==='NON_CANONICAL_BASE64URL');

 // Public head exposure mode is preserved after append.
 const pStore=C.newStore();const pg=await C.genesis(pStore,'main',{title:'P',tabs:['t'],tables:{t:{title:'T',columns:{x:{title:'X',type:'text'}},rows:{}}}});let pc=await C.load(pStore,[pg.id,pg.hash]);
 pStore.publicHead=[null,pg.hash];const pa=await C.append(pStore,pc,[{op:'add',path:'/tables/t/rows/a',value:{x:'1'}}]);assert.deepEqual(C.publicHeadAfter(pStore,pa),[null,pa.head]);
 pStore.publicHead=null;assert.equal(C.publicHeadAfter(pStore,pa),null);


 // Direct load ignores unrelated physical garbage, while H-only scan applies global resource limits.
 const perfStore=C.newStore();const perfRoot=await C.genesis(perfStore,'main',{title:'Perf',tabs:['t'],tables:{t:{title:'T',columns:{x:{title:'X',type:'text'}},rows:{}}}});
 const unrelated=C.to64(Uint8Array.from({length:16},(_,i)=>i+10));perfStore.records[unrelated]='A'.repeat(Math.ceil(C.MAX_CT_BYTES*4/3)+4);
 const directPerf=await C.load(perfStore,[perfRoot.id,perfRoot.hash]);assert.equal(directPerf.headId,perfRoot.id);
 const scanPerf=await C.inspect(perfStore,[null,perfRoot.hash]);assert.equal(scanPerf.code,'RESOURCE_LIMIT');
 delete perfStore.records[unrelated];

 // Legacy is not supported.
 assert.throws(()=>C.validateStore({format:'HTML_DBMS/2.1',publicHead:null,records:{}}),e=>e.code==='UNSUPPORTED_STORAGE');
 assert.throws(()=>C.validateStore({format:C.VERSION,publicHead:null,records:{[pg.id]:{iv:'x',ct:'y'}}}),/Invalid record envelope|Invalid ciphertext/);

 // Existing JSON Patch protections remain.
 assert.equal(C.patch({arr:[1,2],x:{'a/b':1}},[{op:'replace',path:'/x/a~1b',value:2},{op:'add',path:'/arr/1',value:4}]).arr.join(','),'1,4,2');
 assert.throws(()=>C.patch({},[{op:'add',path:'/__proto__/polluted',value:1}]));
 console.log('HTML DBMS 2.2 protocol / audit regression tests: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
