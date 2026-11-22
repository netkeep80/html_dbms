const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');globalThis.crypto=webcrypto;
require('../src/core.js');const C=globalThis.HTMLDBMSCore;
(async()=>{
const genesisState={title:'demo',tables:{items:{rows:{}}}};
const store=C.newStore();
const base=await C.genesis(store,'main',genesisState);
assert.equal(base.existing,false);
assert.equal(base.id,await C.rootAddress(base.hash));
const rawHead=C.from64(base.hash);
const rootDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',rawHead));
assert.equal(base.id,C.to64(rootDigest.slice(0,16)));
assert.equal(typeof store.records[base.id],'string');
assert.equal(Object.keys(store.records).length,1);
let chain=await C.load(store,base.hash);
assert.equal(chain.events.length,1);
assert.equal(chain.events[0].r.length,6);
assert.equal(chain.events[0].r[2],null);
assert.equal(chain.events[0].r[3],null);
assert.equal(chain.events[0].r[4],null);

// Genesis is content-addressed and idempotent: identical initializer => same logical DB.
const again=await C.genesis(store,'main',genesisState);
assert.equal(again.existing,true);
assert.equal(again.id,base.id);
assert.equal(again.hash,base.hash);
assert.equal(Object.keys(store.records).length,1);

// Determinism holds across independent stores too.
const independent=C.newStore();
const same=await C.genesis(independent,'main',genesisState);
assert.equal(same.id,base.id);
assert.equal(same.hash,base.hash);
assert.equal(independent.records[same.id],store.records[base.id]);

// Different genesis => different root with overwhelming probability.
const other=await C.genesis(store,'main',{title:'other',tables:{items:{rows:{}}}});
assert.notEqual(other.id,base.id);
assert.notEqual(other.hash,base.hash);

const first=await C.append(store,chain,[{op:'add',path:'/tables/items/rows/a',value:{name:'Synthetic A'}}]);
assert.equal(first.id,await C.address(base.id,base.hash));
const rawPrevId=C.from64(base.id),rawPrevHash=C.from64(base.hash),material=new Uint8Array(48);
material.set(rawPrevId);material.set(rawPrevHash,16);
const nextDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',material));
assert.equal(first.id,C.to64(nextDigest.slice(0,16)));
assert.equal(typeof store.records[first.id],'string');

// One predecessor maps to one successor address; competing successor is rejected.
const fork=await C.load(store,base.hash);
await assert.rejects(C.append(store,fork,[{op:'add',path:'/tables/items/rows/b',value:{name:'Synthetic B'}}]),/fork conflict/);

chain=await C.load(store,first.head);
assert.equal(chain.state.tables.items.rows.a.name,'Synthetic A');
const snapshot=store.records[base.id];
const second=await C.append(store,chain,[{op:'replace',path:'/tables/items/rows/a/name',value:'Synthetic B'}]);
assert.equal(store.records[base.id],snapshot);
chain=await C.load(store,second.head);
assert.equal(chain.events.length,3);
assert.equal(chain.state.tables.items.rows.a.name,'Synthetic B');

// Independent transaction chain remains append-only.
const extra=await C.genesis(store,'transaction',{rows:{}});let t=await C.load(store,extra.hash);
const next=await C.append(store,t,[{op:'add',path:'/rows/x',value:{amount:8}}]);
t=await C.load(store,next.head);assert.equal(t.state.rows.x.amount,8);
await assert.rejects(C.append(store,t,[{op:'replace',path:'/rows/x/amount',value:9}]),/append-only/);
assert.equal((await C.load(store,second.head)).events.length,3);

// Ciphertext tampering fails.
const bad=structuredClone(store);bad.records[second.id]='A'+bad.records[second.id].slice(1);await assert.rejects(C.load(bad,second.head));

// Physical ID participates in AES-GCM IV: moving a ciphertext breaks authentication.
const moved=structuredClone(store);const wrongId=C.to64(Uint8Array.from({length:16},(_,i)=>i+1));assert.notEqual(wrongId,second.id);moved.records[wrongId]=moved.records[second.id];delete moved.records[second.id];await assert.rejects(C.load(moved,second.head));

// Experimental legacy formats are deliberately unsupported before stable release.
assert.throws(()=>C.validateStore({format:'HTML_DBMS/2.0',publicHead:null,records:{}}),/Unsupported storage/);
assert.throws(()=>C.validateStore({format:C.VERSION,publicHead:null,records:{[base.id]:{iv:'x',ct:'y'}}}),/Invalid record envelope/);

// JSON Patch behavior retained.
assert.equal(C.patch({arr:[1,2],x:{'a/b':1}},[{op:'replace',path:'/x/a~1b',value:2},{op:'add',path:'/arr/1',value:4}]).arr.join(','),'1,4,2');
assert.equal(C.patch({x:1},[{op:'remove',path:'/x'},{op:'add',path:'/x',value:null}]).x,null);
assert.throws(()=>C.patch({x:1},[{op:'replace',path:'/x',value:3},{op:'test',path:'/x',value:1}]));
assert.throws(()=>C.patch({},[{op:'add',path:'/__proto__/polluted',value:1}]));
assert.equal(C.patch({x:{a:1,b:2}},[{op:'test',path:'/x',value:{b:2,a:1}}]).x.a,1);
assert.equal(C.sortedStore(store).format,'HTML_DBMS/2.1');
console.log('HTML DBMS 2.1 core protocol tests: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
