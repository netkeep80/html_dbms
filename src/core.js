/* HTML_DBMS/4 — standalone JSON temporal store. No legacy compatibility. */
const VERSION = 'HTML_DBMS/4';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const subtle = globalThis.crypto.subtle;
const MAX_RECORDS = 200000, MAX_BYTES = 12 * 1024 * 1024, MAX_PATCH = 10000, MAX_DEPTH = 32;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function error(code, message, more={}) { return Object.assign(new Error(message), {code, ...more}); }
function ensure(ok, code, message) { if (!ok) throw error(code, message); }
function plain(x) { return x !== null && typeof x === 'object' && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null); }
function assertJson(x, seen=new Set(), depth=0) {
  ensure(depth<=MAX_DEPTH, 'INVALID_JSON', 'JSON depth exceeded');
  if(x===null || typeof x==='string' || typeof x==='boolean') return;
  if(typeof x==='number') { ensure(Number.isFinite(x), 'INVALID_JSON','Non-finite number');return; }
  ensure(Array.isArray(x)||plain(x),'INVALID_JSON','Only JSON values allowed');
  ensure(!seen.has(x),'INVALID_JSON','Cyclic value');seen.add(x);
  if(Array.isArray(x)) { ensure(Reflect.ownKeys(x).length===x.length+1,'INVALID_JSON','Sparse or decorated array');for(let i=0;i<x.length;i++){const d=Object.getOwnPropertyDescriptor(x,i);ensure(d&&own(d,'value')&&d.enumerable,'INVALID_JSON','Sparse array or accessor');assertJson(d.value,seen,depth+1);} }
  else {ensure(Reflect.ownKeys(x).every(k=>typeof k==='string'), 'INVALID_JSON', 'Symbol property');for(const k of Object.keys(x)) { const d=Object.getOwnPropertyDescriptor(x,k);ensure(d&&own(d,'value')&&d.enumerable,'INVALID_JSON','Accessors forbidden');assertJson(d.value,seen,depth+1);}ensure(Reflect.ownKeys(x).length===Object.keys(x).length,'INVALID_JSON','Hidden property');}
  seen.delete(x);
}
function clone(x){assertJson(x);return JSON.parse(JSON.stringify(x));}
function encode64(b){let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function valid64(s){if(typeof s!=='string'||/[^A-Za-z0-9_-]/.test(s))return false;const rem=s.length%4;return rem===0||rem===2&&/[AQgw]/.test(s.at(-1))||rem===3&&/[AEIMQUYcgkosw048]/.test(s.at(-1));}
function decodeBytes(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
function decode64(s){ensure(valid64(s),'INVALID_BASE64','Invalid or noncanonical Base64url');return decodeBytes(s);}
function validId(s){return typeof s==='string'&&s.length===22&&valid64(s);}
function componentBytes(value,size){const bytes=typeof value==='string'?decode64(value):value;ensure(bytes instanceof Uint8Array&&bytes.length===size,'INVALID_HEAD','Invalid HEAD component');return bytes;}
function packHead(id,hash){const b=new Uint8Array(48);b.set(componentBytes(id,16));b.set(componentBytes(hash,32),16);return encode64(b);}
function validHead(h){return typeof h==='string'&&h.length===64&&/^[A-Za-z0-9_-]{64}$/.test(h);}
function sameHead(a,b){return validHead(a)&&a===b;}
function decodeHead(h){ensure(validHead(h),'INVALID_HEAD','Invalid HEAD');return decodeBytes(h);}
function splitHead(head){const bytes=decodeHead(head),idBytes=bytes.subarray(0,16),hashBytes=bytes.subarray(16);return {bytes,idBytes,hashBytes,id:encode64(idBytes)};}
function unpackHead(head){const {idBytes,hashBytes,id}=splitHead(head);return {idBytes,hashBytes,id,hash:encode64(hashBytes)};}
function physicalId(h){return splitHead(h).id;}
async function sha(b){return new Uint8Array(await subtle.digest('SHA-256',b));}
async function address(bytes){return (await sha(bytes)).subarray(0,16);}
async function rootId(hash){return encode64(await address(componentBytes(hash,32)));}
async function successorId(prev){return encode64(await address(decodeHead(prev)));}
async function encodeRecord(record){assertJson(record);const bytes=encoder.encode(JSON.stringify(record));ensure(bytes.length<=MAX_BYTES,'RESOURCE_LIMIT','Record too large');return {bytes,h:await sha(bytes)};}
async function encrypt(bytes,h,idBytes){const aes=await subtle.importKey('raw',h,'AES-GCM',false,['encrypt']);const data=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv:idBytes.subarray(0,12),tagLength:128},aes,bytes));return encode64(data);}
async function decrypt(ct,{idBytes,hashBytes:h}){let data=decode64(ct);ensure(data.length>=16&&data.length<=MAX_BYTES+16,'RESOURCE_LIMIT','Bad ciphertext length');const aes=await subtle.importKey('raw',h,'AES-GCM',false,['decrypt']);let plaintext;try{plaintext=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:idBytes.subarray(0,12),tagLength:128},aes,data));}catch{throw error('INVALID_GCM','Authentication failed');}
const digest=await sha(plaintext);ensure(digest.every((b,i)=>b===h[i]),'HASH_MISMATCH','Hash mismatch');let r;try{r=JSON.parse(decoder.decode(plaintext));}catch{throw error('INVALID_JSON','Invalid record JSON');}assertJson(r);return r;}
function validCipher(id,ct){
 ensure(validId(id)&&typeof ct==='string'&&ct.length>=22&&ct.length<=Math.ceil((MAX_BYTES+16)*4/3)&&valid64(ct),'INVALID_RECORD','Invalid or noncanonical physical record');
}
function validPublication(name,head){ensure(typeof name==='string'&&name.length>0&&validHead(head),'INVALID_PUBLIC_HEADS','Invalid public head: '+String(name));}
function dataKeys(o){
 ensure(plain(o),'INVALID_JSON','Expected object');
 const keys=Reflect.ownKeys(o);for(const k of keys){const d=Object.getOwnPropertyDescriptor(o,k);ensure(typeof k==='string'&&d.enumerable&&own(d,'value'),'INVALID_JSON','Non-data property');}return keys;
}
function validateStore(s){
 ensure(plain(s)&&own(s,'format')&&own(s,'records'),'UNSUPPORTED_STORAGE','Expected HTML_DBMS/4');
 ensure(dataKeys(s).every(k=>['format','publicHeads','records'].includes(k))&&s.format===VERSION&&plain(s.records),'UNSUPPORTED_STORAGE','Expected HTML_DBMS/4');
 if(own(s,'publicHeads'))for(const n of dataKeys(s.publicHeads))validPublication(n,s.publicHeads[n]);
 const ids=dataKeys(s.records);ensure(ids.length<=MAX_RECORDS,'RESOURCE_LIMIT','Too many records');for(const id of ids)validCipher(id,s.records[id]);return s;
}
// Only these controlled stores are mutable. External containers are adopted once.
// Overlay reads are revision-bound; a stale transaction cannot read a mixed snapshot.
const stores=new WeakMap(),REMOVED=Symbol('removed');
function meta(s){const m=stores.get(s);ensure(m,'UNMANAGED_STORE','Adopt external storage before mutation');ensure(!m.closed&&(!m.base||m.base.rev===m.baseRev),'STALE_TRANSACTION','Store revision changed');return m;}
function revision(s){return meta(s).rev;}
function unchanged(s,rev){if(rev!==undefined)ensure(revision(s)===rev,'STALE_TRANSACTION','Store revision changed');}
function beginRead(s){if(stores.has(s))return revision(s);validateStore(s);}
function makeStore(m){const handle=Object.freeze({});stores.set(handle,m);return handle;}
function catalog(s){return {...meta(s).catalog};}
function readCipher(s,id){
 if(!stores.has(s))return own(s.records,id)?s.records[id]:undefined;
 const m=meta(s);if(m.delta?.has(id)){const ct=m.delta.get(id);return ct===REMOVED?undefined:ct;}return (m.base?.raw||m.raw)[id];
}
function writePhysical(s,id,ct){
 const m=meta(s),prior=readCipher(s,id);validCipher(id,ct);
 if(prior===undefined){ensure(m.count<MAX_RECORDS,'RESOURCE_LIMIT','Too many records');m.count++;m.bytes+=27+ct.length;}else m.bytes+=ct.length-prior.length;
 if(m.delta)m.delta.set(id,ct);else put(m.raw,id,ct);m.proof=null;m.rev++;
}
function removePhysical(s,id){
 const m=meta(s),prior=readCipher(s,id);if(prior===undefined)return;
 m.count--;m.bytes-=27+prior.length;if(m.delta)m.delta.set(id,REMOVED);else delete m.raw[id];m.proof=null;m.rev++;
}
function catalogFrom(value){return Object.assign(Object.create(null),value);}
function adoptStore(s){
 validateStore(s);const raw=Object.assign(Object.create(null),s.records),values=Object.values(raw);
 return makeStore({raw,count:values.length,bytes:values.reduce((n,ct)=>n+27+ct.length,0),catalog:own(s,'publicHeads')?catalogFrom(s.publicHeads):null,rev:0});
}
function newStore(){return makeStore({raw:Object.create(null),count:0,bytes:0,catalog:Object.create(null),rev:0});}
function snapshot(s){
 const m=meta(s),out={format:VERSION};if(m.catalog)out.publicHeads={...m.catalog};
 const records=Object.assign({},m.base?.raw||m.raw);
 if(m.delta)for(const [id,ct] of m.delta)ct===REMOVED?delete records[id]:put(records,id,ct);
 out.records=records;return out;
}
function storeInfo(s){const m=meta(s),header={format:VERSION};if(m.catalog)header.publicHeads=m.catalog;header.records={};return {count:m.count,published:m.catalog?Object.keys(m.catalog).length:0,bytes:encoder.encode(JSON.stringify(header)).length+m.bytes+Math.max(0,m.count-1)};}
function iso(s){return typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString()===s;}
// Compact v4 format: genesis = [null,{name,parent,state}], patch = [ISO-time,previousHEAD,RFC6902-operations].
// Sequence is derived from verified ancestry; it is NEVER serialized.
function isGenesis(r){return Array.isArray(r)&&r.length===2&&r[0]===null;}
function validateRecord(r){
 assertJson(r);ensure(Array.isArray(r),'INVALID_EVENT','Record must be array');
 if(isGenesis(r)){
  const v=r[1];ensure(plain(v)&&typeof v.name==='string'&&v.name.trim()&&(v.parent===null||validHead(v.parent))&&own(v,'state'),'INVALID_GENESIS','Invalid genesis');
  ensure(Object.keys(v).length===3&&['name','parent','state'].every(k=>own(v,k)),'INVALID_GENESIS','Genesis fields');
 }else{
  ensure(r.length===3&&iso(r[0])&&validHead(r[1])&&Array.isArray(r[2])&&r[2].length>=1&&r[2].length<=MAX_PATCH,'INVALID_EVENT','Invalid patch header');
 }
 return r;
}
async function readDecoded(s,decoded){
 const ct=readCipher(s,decoded.id);ensure(ct!==undefined,'MISSING_RECORD','Missing record '+decoded.id);
 const record=validateRecord(await decrypt(ct,decoded)),previous=isGenesis(record)?null:splitHead(record[1]);
 const expected=await address(previous?previous.bytes:decoded.hashBytes);
 ensure(expected.every((b,i)=>b===decoded.idBytes[i]),'ADDRESS_MISMATCH','Wrong physical address');
 return {record,previous};
}
async function readRecord(s,head){const rev=stores.has(s)?revision(s):undefined;const {record}=await readDecoded(s,splitHead(head));unchanged(s,rev);return record;}
function parts(pointer){ensure(typeof pointer==='string'&&(pointer===''||pointer[0]==='/'),'INVALID_POINTER','Not a JSON Pointer');if(pointer==='')return [];return pointer.slice(1).split('/').map(s=>{ensure(!/~(?![01])/.test(s),'INVALID_POINTER','Invalid tilde escape');return s.replace(/~1/g,'/').replace(/~0/g,'~');});}
function indexOfToken(t,len,insert=false){ensure(t==='-'&&insert||/^(0|[1-9]\d*)$/.test(t),'INVALID_POINTER','Invalid array index');if(t==='-')return len;const i=Number(t);ensure(Number.isSafeInteger(i)&&i<=(insert?len:len-1),'INVALID_POINTER','Array index out of bounds');return i;}
function jsonEqual(a,b){
 if(a===b)return true;
 if(a===null||b===null||typeof a!==typeof b||typeof a!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>jsonEqual(v,b[i]));
 if(!plain(a)||!plain(b))return false;
 const ak=Object.keys(a),bk=Object.keys(b);
 return ak.length===bk.length&&ak.every(k=>own(b,k)&&jsonEqual(a[k],b[k]));
}
function atPath(obj,tokens){let x=obj;for(const t of tokens){if(Array.isArray(x)){x=x[indexOfToken(t,x.length)];}else{ensure(plain(x)&&own(x,t),'INVALID_POINTER','Missing JSON Pointer target');x=x[t];}}return x;}
function put(target,k,v){Object.defineProperty(target,k,{value:v,writable:true,enumerable:true,configurable:true});}
function parentAndKey(obj,tokens){ensure(tokens.length>0,'INVALID_POINTER','Root target needs special handling');return [atPath(obj,tokens.slice(0,-1)),tokens.at(-1)];}
function patch(json,ops){assertJson(json);assertJson(ops);ensure(Array.isArray(ops)&&ops.length>=1&&ops.length<=MAX_PATCH,'INVALID_PATCH','Patch must contain an operation');let out=clone(json);
 for(const op of ops){ensure(plain(op)&&typeof op.op==='string'&&typeof op.path==='string','INVALID_PATCH','Malformed JSON Patch operation');const dest=parts(op.path);if(op.op==='test'){ensure(own(op,'value')&&jsonEqual(atPath(out,dest),op.value),'INVALID_PATCH','Test failed');continue;}
 let value;if(op.op==='add'||op.op==='replace') {ensure(own(op,'value'),'INVALID_PATCH','Missing value');value=clone(op.value);}else if(op.op==='copy'||op.op==='move'){ensure(typeof op.from==='string','INVALID_PATCH','Missing from');const src=parts(op.from);ensure(op.op!=='move'||!(dest.length>src.length&&src.every((t,i)=>t===dest[i])),'INVALID_PATCH','Move into descendant');value=clone(atPath(out,src));if(op.op==='move')out=remove(out,src);}else if(op.op!=='remove')throw error('INVALID_PATCH','Unknown operation');
 if(op.op==='remove'){out=remove(out,dest);continue;}
 if(op.op==='replace') atPath(out,dest);
 if(dest.length===0){out=value;continue;}
 const [p,k]=parentAndKey(out,dest);if(Array.isArray(p)){if(op.op==='replace')p[indexOfToken(k,p.length)]=value;else p.splice(indexOfToken(k,p.length,true),0,value);}else{ensure(plain(p),'INVALID_POINTER','Parent is not object');put(p,k,value);}
 }assertJson(out);return out;}
function remove(out,tokens){if(!tokens.length)return null;const [p,k]=parentAndKey(out,tokens);if(Array.isArray(p))p.splice(indexOfToken(k,p.length),1);else{ensure(plain(p)&&own(p,k),'INVALID_POINTER','Missing remove target');delete p[k];}return out;}
function diagnose(e,head,events=[]){return {status:'broken',code:e.code||'INVALID_CHAIN',message:e.message||String(e),sourceHead:validHead(head)?head:null,tailIds:events.map(x=>physicalId(x.head))};}
async function inspect(s,head,limit=MAX_RECORDS){return inspectChain(s,head,limit);}
async function inspectChain(s,head,limit=MAX_RECORDS,visit){try{if(!stores.has(s))s=adoptStore(s);const revisionAtStart=beginRead(s);ensure(validHead(head),'INVALID_HEAD','Head required');const rev=[],seen=new Set();let h=head,decoded=splitHead(h);while(true){ensure(!seen.has(decoded.id),'CYCLE','Cycle in physical chain');seen.add(decoded.id);ensure(rev.length<limit,'RESOURCE_LIMIT','Chain too long');let r,previous;try{({record:r,previous}=await readDecoded(s,decoded));unchanged(s,revisionAtStart);}catch(e){const d=diagnose(e,head,rev);d.invalid=h;d.tailIds=[decoded.id,...d.tailIds];d.recoveryHead=null;return d;}
 rev.push({head:h,r});if(!previous)break;h=r[1];decoded=previous;}
const events=rev.reverse();let state=clone(events[0].r[1].state);if(visit)visit(state,events[0].head,false);for(let i=1;i<events.length;i++){try{state=patch(state,events[i].r[2]);}catch(e){const d=diagnose(e,head,events.slice(i));d.invalid=events[i].head;return d;}if(visit)visit(state,events[i-1].head,true);}
unchanged(s,revisionAtStart);return {status:'complete',chain:{head,genesis:clone(events[0].r[1]),state,events}};
}catch(e){return diagnose(e,head);}}
async function load(s,head){return loadChain(s,head);}
async function loadChain(s,head,visit){const x=await inspectChain(s,head,MAX_RECORDS,visit);if(x.status!=='complete')throw error(x.code,x.message,{diagnosis:x});return x.chain;}
async function genesis(s,name,state,parent=null,options={}){const rev=revision(s),overwrite=!!options.overwrite;ensure(typeof name==='string'&&name.trim(),'INVALID_NAME','Document name required');ensure(parent===null||validHead(parent),'INVALID_HEAD','Invalid genesis parent');const r=validateRecord([null,{name,parent:parent===null?null:clone(parent),state:clone(state)}]);const {bytes,h}=await encodeRecord(r),idBytes=await address(h),id=encode64(idBytes),head=packHead(idBytes,h);const occupied=readCipher(s,id)!==undefined;if(occupied&&!overwrite){const old=await readRecord(s,head).catch(()=>null);unchanged(s,rev);if(old&&JSON.stringify(old)===JSON.stringify(r))return {head,existing:true,overwritten:false};throw error('ROOT_OCCUPIED','Genesis slot occupied');}
const ciphertext=await encrypt(bytes,h,idBytes);unchanged(s,rev);writePhysical(s,id,ciphertext);return {head,existing:false,overwritten:occupied};}
async function append(s,head,operations,options={}){const rev=revision(s),ops=clone(operations),opts={overwrite:!!options.overwrite,timestamp:options.timestamp},chain=await load(s,head);return appendKnown(s,head,chain.state,ops,opts,rev);}
async function appendKnown(s,head,previous,operations,{overwrite=false,timestamp}={},rev=revision(s)){unchanged(s,rev);const state=patch(previous,operations);const idBytes=await address(decodeHead(head)),id=encode64(idBytes);const occupied=readCipher(s,id)!==undefined;if(occupied&&!overwrite)throw error('SUCCESSOR_OCCUPIED','Canonical successor occupied',{id,predecessor:head});const stamp=timestamp||new Date().toISOString();ensure(iso(stamp),'INVALID_TIME','Invalid timestamp');const r=validateRecord([stamp,head,operations]);const {bytes,h}=await encodeRecord(r);const ciphertext=await encrypt(bytes,h,idBytes);unchanged(s,rev);writePhysical(s,id,ciphertext);return {head:packHead(idBytes,h),state,overwritten:occupied};}
async function patchRoot(s,head,operations,options={}){
 const ops=clone(operations),opts={overwrite:!!options.overwrite,timestamp:options.timestamp},tx=staging(s),proof=await checkedProof(s,head);
 const r=await appendKnown(tx,head,proof.state,ops,opts);
 await checkChange(tx,proof,r,null,r.overwritten);
 return {store:tx,rootHead:r.head};
}
function pointer(value,path){return clone(atPath(value,parts(path)));}
function escapePtr(k){return k.replace(/~/g,'~0').replace(/\//g,'~1');}
function getRootRefs(root){if(!plain(root))return {};if(!own(root,'$refs'))return {};ensure(plain(root.$refs),'INVALID_ROOT','$refs must be an object');for(const [k,h] of Object.entries(root.$refs))ensure(k.length>0&&!k.includes('/')&&validHead(h),'INVALID_ROOT','Invalid $refs: '+k);return root.$refs;}
// A reference has exactly one field: {$ref:"/local/pointer"} or {$ref:"alias/path"}.
async function resolve(s,rootHead,currentHead,reference,{maxDepth=16}={}){ensure(validHead(rootHead)&&validHead(currentHead),'INVALID_HEAD','Need root and current heads');if(!stores.has(s))s=adoptStore(s);let ref=clone(reference);const rev=beginRead(s),proof=stores.get(s)?.proof;const root=await stateFor(s,rootHead,proof);const refs=getRootRefs(root);const visited=new Set();let here=currentHead;
 for(let depth=0;depth<maxDepth;depth++){ensure(plain(ref)&&Object.keys(ref).length===1&&typeof ref.$ref==='string','INVALID_REF','Expected {$ref: string}');const source=ref.$ref;let h,p;if(source.startsWith('/')){h=here;p=source;}else{const i=source.indexOf('/');ensure(i>0,'INVALID_REF','External ref must contain /');const name=source.slice(0,i);ensure(own(refs,name),'UNKNOWN_DOCUMENT','Unknown document '+name);h=refs[name];p=source.slice(i);if(p==='/')p='';}
 const signature=h+' '+p;ensure(!visited.has(signature),'REF_CYCLE','Reference cycle');visited.add(signature);const value=pointer(await stateFor(s,h,proof),p);if(plain(value)&&Object.keys(value).length===1&&own(value,'$ref')){ref=value;here=h;continue;}unchanged(s,rev);return {head:h,pointer:p,value};}
 throw error('REF_DEPTH','Reference resolution depth exceeded');}
// Proofs never escape the core. A physical write invalidates them; a checked
// commit installs a proof of the new revision. Independent verification ignores them.
function stateFor(s,head,proof){
 if(proof?.head===head)return proof.state;
 if(proof)for(const child of proof.children.values())if(child.head===head)return child.state;
 return load(s,head).then(c=>c.state);
}
async function readState(s,head){if(!stores.has(s))s=adoptStore(s);const rev=beginRead(s),state=await stateFor(s,head,stores.get(s)?.proof);unchanged(s,rev);return clone(state);}
async function checkedProof(s,head){
 const m=meta(s);if(m.proof?.head===head)return m.proof;
 return (await verifySnapshot(s,head)).proof;
}
async function checkChange(tx,proof,root,known,overwritten){
 // Occupied-slot replacement can destroy dependencies elsewhere in this graph.
 // Never use old proofs across such a replacement.
 if(overwritten){await openDatabase(tx,root.head);return;}
 const rev=revision(tx),children=new Map(proof.children);
 for(const [alias,head] of Object.entries(getRootRefs(root.state))){
  const last=children.get(alias);
  if(last?.head===head)continue;
  if(known?.alias===alias&&known.head===head&&(!last||last.head===known.previous)){
   children.set(alias,{head,state:known.state});continue;
  }
  const next=await load(tx,head);
  ensure(!last||next.events.some(e=>e.head===last.head),'REFERENCE_ROLLBACK','Document "'+alias+'" was replaced, rolled back or diverged across historical $refs');
  children.set(alias,{head,state:next.state});
 }
 unchanged(tx,rev);meta(tx).proof={head:root.head,state:root.state,children};
}
function staging(s){const base=meta(s);ensure(!base.base,'INVALID_TRANSACTION','Nested staging is not supported');return makeStore({base,baseRev:base.rev,delta:new Map(),count:base.count,bytes:base.bytes,catalog:base.catalog?catalogFrom(base.catalog):null,rev:0,proof:base.proof});}
function publish(s,alias,newHead,oldHead=null){
 const m=meta(s);validPublication(alias,newHead);
 if(oldHead!==null)ensure(sameHead(m.catalog?.[alias],oldHead),'STALE_PUBLIC_HEAD','Published version changed');
 if(!m.catalog)m.catalog=Object.create(null);put(m.catalog,alias,newHead);m.rev++;
}
function unpublish(s,alias){const m=meta(s);if(!m.catalog||!own(m.catalog,alias))return;delete m.catalog[alias];if(!Object.keys(m.catalog).length)m.catalog=null;m.rev++;}

async function createDatabase(s,name,{visible=true,entry=null}={}){const tx=staging(s);ensure(!visible||!own(meta(tx).catalog||{},name),'DUPLICATE_DB','DB alias already exists');const root={name,entry:clone(entry),$refs:{}};const g=await genesis(tx,name,root,null);if(visible)publish(tx,name,g.head);meta(tx).proof={head:g.head,state:root,children:new Map()};return {store:tx,rootHead:g.head,genesis:g};}
async function createDocument(s,rootHead,name,initial,alias=null,options={}){
 const state=clone(initial),overwriteRoot=!!options.overwriteRoot,tx=staging(s),proof=await checkedProof(s,rootHead),refs=getRootRefs(proof.state),n=alias||name;
 ensure(typeof n==='string'&&n.length>0&&!n.includes('/')&&!own(refs,n),'DUPLICATE_DOCUMENT','Name already exists');
 const g=await genesis(tx,name,state,rootHead);
 const ops=own(proof.state,'$refs')?[{op:'add',path:'/$refs/'+escapePtr(n),value:g.head}]:[{op:'add',path:'/$refs',value:{[n]:g.head}}];
 const r=await appendKnown(tx,rootHead,proof.state,ops,{overwrite:overwriteRoot});
 await checkChange(tx,proof,r,{alias:n,head:g.head,state},r.overwritten||g.overwritten);
 return {store:tx,rootHead:r.head,documentHead:g.head};
}
async function patchDocument(s,rootHead,alias,operations,options={}){
 const ops=clone(operations),overwriteChild=!!options.overwriteChild,overwriteRoot=!!options.overwriteRoot,tx=staging(s),proof=await checkedProof(s,rootHead),refs=getRootRefs(proof.state);
 ensure(own(refs,alias),'UNKNOWN_DOCUMENT','Unknown document');let p,r;
 try{p=await appendKnown(tx,refs[alias],proof.children.get(alias).state,ops,{overwrite:overwriteChild});}catch(e){if(e.code==='SUCCESSOR_OCCUPIED')e.phase='child';throw e;}
 try{r=await appendKnown(tx,rootHead,proof.state,[{op:'replace',path:'/$refs/'+escapePtr(alias),value:p.head}],{overwrite:overwriteRoot});}catch(e){if(e.code==='SUCCESSOR_OCCUPIED')e.phase='root';throw e;}
 await checkChange(tx,proof,r,{alias,head:p.head,state:p.state,previous:refs[alias]},p.overwritten||r.overwritten);
 return {store:tx,rootHead:r.head,documentHead:p.head};
}
// Validate a database snapshot, including the historical references published by its root.
// The independent verifier checks root history and all historical references.
async function verifyDatabase(s, rootHead, options={}) {
  return (await openDatabase(s,rootHead,options)).report;
}
async function openDatabase(s,rootHead,options={}) {const {chain,report}=await verifySnapshot(s,rootHead,options);return {chain,report};}
async function verifySnapshot(s,rootHead,{anchorHead}={}) {
  if(!stores.has(s))s=adoptStore(s);const rev=beginRead(s);
  // NEVER forget an alias when it disappears from an effective root state.
  // A removal does not erase earlier references or reset the rollback baseline.
  const history=new Map(), warnings=[];
  const checks={rootEvents:0,documents:0,activeDocuments:0,historicalReferences:0,causalOrigins:0};
  function scan(references, beforeHead, introduced) {
    for(const [name,head] of Object.entries(references)) {
      let entry=history.get(name);
      if(!entry){entry={firstBefore:clone(beforeHead),firstEvent:introduced,heads:[]};history.set(name,entry);}
      const previous=entry.heads.at(-1);
      if(previous!==head) {
        entry.heads.push(clone(head));
        checks.historicalReferences++;
      }
    }
  }
  const root=await loadChain(s,rootHead,(state,before,introduced)=>scan(getRootRefs(state),before,introduced));
  checks.rootEvents=root.events.length;
  const activeRefs=getRootRefs(root.state),documents={},children=new Map(),loaded=new Map();
  for(const [name,meta] of history){
    // The most recently referenced head must descend from EVERY earlier head,
    // including ones removed and subsequently reintroduced. Loading it checks
    // the entire authenticated child ancestry (genesis, patches, ciphertext).
    const lastHead=meta.heads.at(-1);let child=loaded.get(lastHead);if(!child){child=await load(s,lastHead);loaded.set(lastHead,child);}children.set(name,{head:lastHead,state:child.state});
    const indices=new Map(child.events.map((e,i)=>[e.head,i]));
    let previousIndex=-1;
    for(const referencedHead of meta.heads){
      const index=indices.get(referencedHead);
      ensure(index!==undefined&&index>=previousIndex,'REFERENCE_ROLLBACK',
        'Document "'+name+'" was replaced, rolled back or diverged across historical $refs');
      previousIndex=index;
    }
    checks.documents++;
    const active=own(activeRefs,name);
    if(active)checks.activeDocuments++;
    const parent=child.genesis.parent;
    if(meta.firstEvent&&parent===meta.firstBefore)checks.causalOrigins++;
    else if(parent!==null&&!root.events.some(e=>e.head===parent))
      warnings.push('Документ '+name+': genesis.parent не входит в ancestry выбранного корня');
    else if(meta.firstEvent&&parent!==null&&!sameHead(parent,meta.firstBefore))
      warnings.push('Документ '+name+': origin не совпадает с версией корня перед первой регистрацией (возможно, импортирован)');
    put(documents,name,{head:lastHead,active,events:child.events.length,referencedVersions:meta.heads.length,origin:parent});
  }
  if(anchorHead!==undefined){
    ensure(validHead(anchorHead),'INVALID_HEAD','Invalid trusted historical HEAD');
    const index=root.events.findIndex(e=>e.head===anchorHead);
    ensure(index>=0,'ANCHOR_MISMATCH','Trusted HEAD is not in the root ancestry');
    checks.anchorIndex=index;
  }
  unchanged(s,rev);const proof={head:rootHead,state:clone(root.state),children};if(stores.has(s))meta(s).proof=proof;return {chain:root,proof,report:{status:'complete',rootHead,checks,documents,warnings}};
}
// Recovery is explicitly destructive. Never remove a physical slot whose contents
// were overwritten: it might belong to a different branch of history.
async function truncateInvalidTail(s,diagnosis,recoveryHead) {
  const rev=revision(s);
  ensure(diagnosis&&diagnosis.status==='broken'&&validHead(diagnosis.sourceHead)&&Array.isArray(diagnosis.tailIds),'INVALID_TRUNCATION','Broken diagnosis required');
  ensure(validHead(recoveryHead),'INVALID_HEAD','Explicit recovery head required');
  const fresh=await inspect(s,diagnosis.sourceHead);
  ensure(fresh.status==='broken'&&fresh.code===diagnosis.code&&JSON.stringify(fresh.tailIds)===JSON.stringify(diagnosis.tailIds),'STALE_DIAGNOSIS','Diagnosis is stale');
  // If the first corrupt slot is not a successor of the proposed recovery head,
  // there is no proof that the manual anchor is the right recovery boundary.
  const invalid=validHead(fresh.invalid)?physicalId(fresh.invalid):null;
  ensure(validId(invalid),'INVALID_TRUNCATION','No identifiable corrupt physical slot');
  ensure(await successorId(recoveryHead)===invalid,'INVALID_RECOVERY_HEAD','Recovery head must precede the corrupt slot');
  const recovered=await load(s,recoveryHead);
  ensure(recovered.events.length>0,'INVALID_RECOVERY_HEAD','Recovery chain is invalid');
  const descendants=fresh.tailIds.filter(id=>id!==invalid);
  // Keep only later records for which the broken source chain's decrypted ancestry
  // actually points back to the corrupt slot; no guesses and no deleting the occupant.
  const deletions=[];
  for(const id of descendants){
    if(readCipher(s,id)===undefined)continue;
    // These records were read and authenticated while inspecting from the broken tip.
    deletions.push(id);
  }
  unchanged(s,rev);const out=staging(s);
  for(const id of deletions)removePhysical(out,id);
  return {store:out,recoveryHead,deletedIds:deletions,keptInvalidSlot:invalid};
}
function commit(s,tx){
 const base=meta(s),stage=meta(tx);ensure(stage.base===base,'INVALID_TRANSACTION','Wrong transaction base');
 // The stage owns its private catalog; transfer it without another copy.
 for(const [id,ct] of stage.delta)ct===REMOVED?delete base.raw[id]:put(base.raw,id,ct);
 base.count=stage.count;base.bytes=stage.bytes;base.catalog=stage.catalog;
 base.proof=stage.proof;base.rev++;stage.closed=true;return s;
}
// Physical destructive replacement requires explicit confirmation in the caller.
async function overwrite(s,head,ops){return append(s,head,ops,{overwrite:true});}
export {VERSION,newStore,validateStore,adoptStore,revision,storeInfo,snapshot,catalog,readCipher,writePhysical,removePhysical,unpublish,packHead,unpackHead,validHead,sameHead,assertJson,patch,pointer,resolve,readState,getRootRefs,genesis,append,inspect,load,successorId,rootId,readRecord,createDatabase,createDocument,patchDocument,patchRoot,verifyDatabase,openDatabase,truncateInvalidTail,staging,publish,commit,overwrite,escapePtr,encode64,decode64};
