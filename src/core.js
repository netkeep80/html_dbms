/* HTML_DBMS/4 — standalone JSON temporal store. No legacy compatibility. */
(function (g) {
'use strict';
const VERSION = 'HTML_DBMS/4';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const subtle = g.crypto?.subtle || (typeof require === 'function' ? require('node:crypto').webcrypto.subtle : null);
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
  if(Array.isArray(x)) { ensure(Object.keys(x).length===x.length,'INVALID_JSON','Sparse or decorated array');for(let i=0;i<x.length;i++) {ensure(own(x,i),'INVALID_JSON','Sparse array');assertJson(x[i],seen,depth+1);} }
  else {ensure(Reflect.ownKeys(x).every(k=>typeof k==='string'), 'INVALID_JSON', 'Symbol property');for(const k of Object.keys(x)) { const d=Object.getOwnPropertyDescriptor(x,k);ensure(d&&own(d,'value')&&d.enumerable,'INVALID_JSON','Accessors forbidden');assertJson(d.value,seen,depth+1);}ensure(Reflect.ownKeys(x).length===Object.keys(x).length,'INVALID_JSON','Hidden property');}
  seen.delete(x);
}
function clone(x){assertJson(x);return JSON.parse(JSON.stringify(x));}
function encode64(b){if(typeof Buffer!=='undefined')return Buffer.from(b).toString('base64url');let s='';for(const n of b)s+=String.fromCharCode(n);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode64(s){ensure(typeof s==='string'&&/^[A-Za-z0-9_-]*$/.test(s)&&s.length%4!==1,'INVALID_BASE64','Invalid Base64url');let b;if(typeof Buffer!=='undefined') b=new Uint8Array(Buffer.from(s,'base64url'));else{const v=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));b=Uint8Array.from(v,c=>c.charCodeAt(0));}ensure(encode64(b)===s,'INVALID_BASE64','Non-canonical Base64url');return b;}
function validId(s){try{return decode64(s).length===16;}catch{return false;}}
function validHash(s){try{return decode64(s).length===32;}catch{return false;}}
function componentBytes(value,size){const bytes=typeof value==='string'?decode64(value):value;ensure(bytes instanceof Uint8Array&&bytes.length===size,'INVALID_HEAD','Invalid HEAD component');return bytes;}
function packHead(id,hash){const b=new Uint8Array(48);b.set(componentBytes(id,16));b.set(componentBytes(hash,32),16);return encode64(b);}
function unpackHead(head){ensure(typeof head==='string'&&head.length===64&&/^[A-Za-z0-9_-]{64}$/.test(head),'INVALID_HEAD','Invalid HEAD');const bytes=decode64(head);ensure(bytes.length===48,'INVALID_HEAD','Invalid HEAD bytes');const idBytes=bytes.slice(0,16),hashBytes=bytes.slice(16);return {idBytes,hashBytes,id:encode64(idBytes),hash:encode64(hashBytes)};}
function validHead(h){try{unpackHead(h);return true;}catch{return false;}}
function sameHead(a,b){return validHead(a)&&a===b;}
function key(h){return h;}
function physicalId(h){return unpackHead(h).id;}
async function sha(b){return new Uint8Array(await subtle.digest('SHA-256',b));}
async function rootId(hash){return encode64((await sha(decode64(hash))).slice(0,16));}
async function successorId(prev){ensure(validHead(prev),'INVALID_HEAD','Invalid predecessor head');const b=decode64(prev);return encode64((await sha(b)).slice(0,16));}
function ivFrom(id){return decode64(id).slice(0,12);}
async function encrypt(record,id){assertJson(record);ensure(validId(id),'INVALID_ID','Invalid address');const bytes=encoder.encode(JSON.stringify(record));ensure(bytes.length<=MAX_BYTES,'RESOURCE_LIMIT','Record too large');const h=await sha(bytes);const aes=await subtle.importKey('raw',h,'AES-GCM',false,['encrypt']);const data=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv:ivFrom(id),tagLength:128},aes,bytes));return {hash:encode64(h),ct:encode64(data)};}
async function decrypt(ct,head){ensure(validHead(head),'INVALID_HEAD','Bad head');let data=decode64(ct);ensure(data.length>=16&&data.length<=MAX_BYTES+16,'RESOURCE_LIMIT','Bad ciphertext length');const {id,hash,hashBytes:h}=unpackHead(head);const aes=await subtle.importKey('raw',h,'AES-GCM',false,['decrypt']);let plaintext;try{plaintext=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:ivFrom(id),tagLength:128},aes,data));}catch{throw error('INVALID_GCM','Authentication failed');}
ensure(encode64(await sha(plaintext))===hash,'HASH_MISMATCH','Hash mismatch');let r;try{r=JSON.parse(decoder.decode(plaintext));}catch{throw error('INVALID_JSON','Invalid record JSON');}assertJson(r);return r;}
function validateStore(s){ensure(plain(s)&&s.format===VERSION&&plain(s.records),'UNSUPPORTED_STORAGE','Expected HTML_DBMS/4');ensure(!own(s,'publicHead'),'UNSUPPORTED_STORAGE','Legacy publicHead is unsupported');if(own(s,'publicHeads')){ensure(plain(s.publicHeads),'INVALID_PUBLIC_HEADS','publicHeads must be an object');for(const [n,h] of Object.entries(s.publicHeads)){ensure(n.length>0&&validHead(h),'INVALID_PUBLIC_HEADS','Invalid public head: '+n);}}
  const ids=Object.keys(s.records);ensure(ids.length<=MAX_RECORDS,'RESOURCE_LIMIT','Too many records');for(const id of ids)ensure(validId(id)&&typeof s.records[id]==='string'&&s.records[id].length<=Math.ceil((MAX_BYTES+16)*4/3),'INVALID_RECORD','Invalid physical record');return s;}
function newStore(){return {format:VERSION,publicHeads:{},records:{}};}
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
async function expectedId(r,hash){return isGenesis(r)?rootId(hash):successorId(r[1]);}
async function readRecord(s,head){ensure(validHead(head),'INVALID_HEAD','Invalid head');const {id,hash}=unpackHead(head);ensure(own(s.records,id),'MISSING_RECORD','Missing record '+id);let r=validateRecord(await decrypt(s.records[id],head));ensure((await expectedId(r,hash))===id,'ADDRESS_MISMATCH','Wrong physical address');return r;}
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
function patch(json,ops){assertJson(json);ensure(Array.isArray(ops)&&ops.length>=1&&ops.length<=MAX_PATCH,'INVALID_PATCH','Patch must contain an operation');let out=clone(json);
 for(const op of ops){ensure(plain(op)&&typeof op.op==='string'&&typeof op.path==='string','INVALID_PATCH','Malformed JSON Patch operation');const dest=parts(op.path);if(op.op==='test'){ensure(own(op,'value')&&jsonEqual(atPath(out,dest),op.value),'INVALID_PATCH','Test failed');continue;}
 let value;if(op.op==='add'||op.op==='replace') {ensure(own(op,'value'),'INVALID_PATCH','Missing value');value=clone(op.value);}else if(op.op==='copy'||op.op==='move'){ensure(typeof op.from==='string','INVALID_PATCH','Missing from');const src=parts(op.from);ensure(op.op!=='move'||!(dest.length>src.length&&src.every((t,i)=>t===dest[i])),'INVALID_PATCH','Move into descendant');value=clone(atPath(out,src));if(op.op==='move')out=remove(out,src);}else if(op.op!=='remove')throw error('INVALID_PATCH','Unknown operation');
 if(op.op==='remove'){out=remove(out,dest);continue;}
 if(op.op==='replace') atPath(out,dest);
 if(dest.length===0){out=value;continue;}
 const [p,k]=parentAndKey(out,dest);if(Array.isArray(p)){if(op.op==='replace')p[indexOfToken(k,p.length)]=value;else p.splice(indexOfToken(k,p.length,true),0,value);}else{ensure(plain(p),'INVALID_POINTER','Parent is not object');put(p,k,value);}
 }assertJson(out);return out;}
function remove(out,tokens){if(!tokens.length)return null;const [p,k]=parentAndKey(out,tokens);if(Array.isArray(p))p.splice(indexOfToken(k,p.length),1);else{ensure(plain(p)&&own(p,k),'INVALID_POINTER','Missing remove target');delete p[k];}return out;}
function diagnose(e,head,events=[]){return {status:'broken',code:e.code||'INVALID_CHAIN',message:e.message||String(e),sourceHead:validHead(head)?head:null,tailIds:events.map(x=>physicalId(x.head))};}
async function inspect(s,head,limit=MAX_RECORDS){try{validateStore(s);ensure(validHead(head),'INVALID_HEAD','Head required');const rev=[],seen=new Set();let h=head;while(true){ensure(!seen.has(physicalId(h)),'CYCLE','Cycle in physical chain');seen.add(physicalId(h));ensure(rev.length<limit,'RESOURCE_LIMIT','Chain too long');let r;try{r=await readRecord(s,h);}catch(e){const d=diagnose(e,head,rev);d.invalid=h;d.tailIds=[physicalId(h),...d.tailIds];d.recoveryHead=null;return d;}
 rev.push({head:h,r});if(isGenesis(r))break;h=r[1];}
const events=rev.reverse();let state=clone(events[0].r[1].state);for(let i=1;i<events.length;i++)try{state=patch(state,events[i].r[2]);}catch(e){const d=diagnose(e,head,events.slice(i));d.invalid=events[i].head;return d;}
return {status:'complete',chain:{head:clone(head),genesis:clone(events[0].r[1]),state,events}};
}catch(e){return diagnose(e,head);}}
async function load(s,head){const x=await inspect(s,head);if(x.status!=='complete')throw error(x.code,x.message,{diagnosis:x});return x.chain;}
async function genesis(s,name,state,parent=null,options={}){validateStore(s);ensure(typeof name==='string'&&name.trim(),'INVALID_NAME','Document name required');ensure(parent===null||validHead(parent),'INVALID_HEAD','Invalid genesis parent');const r=validateRecord([null,{name,parent:parent===null?null:clone(parent),state:clone(state)}]);const bytes=encoder.encode(JSON.stringify(r));const h=encode64(await sha(bytes)),id=await rootId(h);const occupied=own(s.records,id);if(occupied&&!options.overwrite){const old=await readRecord(s,packHead(id,h)).catch(()=>null);if(old&&JSON.stringify(old)===JSON.stringify(r))return {head:packHead(id,h),existing:true,overwritten:false};throw error('ROOT_OCCUPIED','Genesis slot occupied');}
const e=await encrypt(r,id);ensure(e.hash===h,'INTERNAL_ERROR','Unexpected hash');s.records[id]=e.ct;return {head:packHead(id,h),existing:false,overwritten:occupied};}
async function append(s,head,operations,options={}){validateStore(s);const chain=await load(s,head);const state=patch(chain.state,operations);const id=await successorId(head);const occupied=own(s.records,id);if(occupied&&!options.overwrite)throw error('SUCCESSOR_OCCUPIED','Canonical successor occupied',{id,predecessor:head});const stamp=options.timestamp||new Date().toISOString();ensure(iso(stamp),'INVALID_TIME','Invalid timestamp');const r=validateRecord([stamp,head,clone(operations)]);const e=await encrypt(r,id);s.records[id]=e.ct;return {head:packHead(id,e.hash),state,overwritten:occupied};}
function pointer(value,path){return clone(atPath(value,parts(path)));}
function escapePtr(k){return k.replace(/~/g,'~0').replace(/\//g,'~1');}
function getRootRefs(root){if(!plain(root))return {};if(!own(root,'$refs'))return {};ensure(plain(root.$refs),'INVALID_ROOT','$refs must be an object');for(const [k,h] of Object.entries(root.$refs))ensure(k.length>0&&!k.includes('/')&&validHead(h),'INVALID_ROOT','Invalid $refs: '+k);return root.$refs;}
// A reference has exactly one field: {$ref:"/local/pointer"} or {$ref:"alias/path"}.
async function resolve(s,rootHead,currentHead,reference,{maxDepth=16}={}){ensure(validHead(rootHead)&&validHead(currentHead),'INVALID_HEAD','Need root and current heads');const root=(await load(s,rootHead)).state;const refs=getRootRefs(root);const visited=new Set();let here=currentHead, ref=reference;
 for(let depth=0;depth<maxDepth;depth++){ensure(plain(ref)&&Object.keys(ref).length===1&&typeof ref.$ref==='string','INVALID_REF','Expected {$ref: string}');const source=ref.$ref;let h,p;if(source.startsWith('/')){h=here;p=source;}else{const i=source.indexOf('/');ensure(i>0,'INVALID_REF','External ref must contain /');const name=source.slice(0,i);ensure(own(refs,name),'UNKNOWN_DOCUMENT','Unknown document '+name);h=refs[name];p=source.slice(i);if(p==='/')p='';}
 const signature=key(h)+' '+p;ensure(!visited.has(signature),'REF_CYCLE','Reference cycle');visited.add(signature);const value=pointer((await load(s,h)).state,p);if(plain(value)&&Object.keys(value).length===1&&own(value,'$ref')){ref=value;here=h;continue;}return {head:h,pointer:p,value};}
 throw error('REF_DEPTH','Reference resolution depth exceeded');}
function staging(s){validateStore(s);return clone(s);}
function publish(staged,alias,newHead,oldHead=null){ensure(validHead(newHead),'INVALID_HEAD','Bad published head');if(!own(staged,'publicHeads'))staged.publicHeads={};ensure(plain(staged.publicHeads),'INVALID_PUBLIC_HEADS','Invalid publicHeads');if(oldHead!==null)ensure(sameHead(staged.publicHeads[alias],oldHead),'STALE_PUBLIC_HEAD','Published version changed');put(staged.publicHeads,alias,clone(newHead));}
async function createDatabase(s,name,{visible=true,entry=null}={}){const tx=staging(s);ensure(!visible||!own(tx.publicHeads||{},name),'DUPLICATE_DB','DB alias already exists');const root={name,entry:clone(entry),$refs:{}};const g=await genesis(tx,name,root,null);if(visible)publish(tx,name,g.head);return {store:tx,rootHead:g.head,genesis:g};}
async function createDocument(s,rootHead,name,initial,alias=null,options={}){const tx=staging(s),root=await load(tx,rootHead);const refs=getRootRefs(root.state);const n=alias||name;ensure(n.length>0&&!n.includes('/')&&!own(refs,n),'DUPLICATE_DOCUMENT','Name already exists');const g=await genesis(tx,name,initial,rootHead);const ops=own(root.state,'$refs')?[{op:'add',path:'/$refs/'+escapePtr(n),value:g.head}]:[{op:'add',path:'/$refs',value:{[n]:g.head}}];const r=await append(tx,rootHead,ops,{overwrite:!!options.overwriteRoot});return {store:tx,rootHead:r.head,documentHead:g.head};}
async function patchDocument(s,rootHead,alias,operations,options={}){const tx=staging(s),root=await load(tx,rootHead);const refs=getRootRefs(root.state);ensure(own(refs,alias),'UNKNOWN_DOCUMENT','Unknown document');let p,r;try{p=await append(tx,refs[alias],operations,{overwrite:!!options.overwriteChild});}catch(e){if(e.code==='SUCCESSOR_OCCUPIED')e.phase='child';throw e;}try{r=await append(tx,rootHead,[{op:'replace',path:'/$refs/'+escapePtr(alias),value:p.head}],{overwrite:!!options.overwriteRoot});}catch(e){if(e.code==='SUCCESSOR_OCCUPIED')e.phase='root';throw e;}return {store:tx,rootHead:r.head,documentHead:p.head};}
// Validate a database snapshot, including the historical references published by its root.
// Unlike cryptographic validation, reference policy is a separate optional check.
async function verifyDatabase(s, rootHead, options={}) {
  validateStore(s);
  const root=await load(s,rootHead);
  let state=clone(root.genesis.state);
  // NEVER forget an alias when it disappears from an effective root state.
  // A removal does not erase earlier references or reset the rollback baseline.
  const history=new Map(), warnings=[];
  const checks={rootEvents:root.events.length,documents:0,activeDocuments:0,historicalReferences:0,causalOrigins:0};
  function scan(references, beforeHead, introduced) {
    for(const [name,head] of Object.entries(references)) {
      let entry=history.get(name);
      if(!entry){entry={firstBefore:clone(beforeHead),firstEvent:introduced,heads:[]};history.set(name,entry);}
      const previous=entry.heads.at(-1);
      if(!previous||!sameHead(previous,head)) {
        entry.heads.push(clone(head));
        checks.historicalReferences++;
      }
    }
  }
  scan(getRootRefs(state),root.events[0].head,false);
  for(let i=1;i<root.events.length;i++){
    const before=root.events[i-1].head;
    state=patch(state,root.events[i].r[2]);
    scan(getRootRefs(state),before,true);
  }
  const activeRefs=getRootRefs(state),documents={};
  for(const [name,meta] of history){
    // The most recently referenced head must descend from EVERY earlier head,
    // including ones removed and subsequently reintroduced. Loading it checks
    // the entire authenticated child ancestry (genesis, patches, ciphertext).
    const lastHead=meta.heads.at(-1),child=await load(s,lastHead);
    const indices=new Map(child.events.map((e,i)=>[key(e.head),i]));
    let previousIndex=-1;
    for(const referencedHead of meta.heads){
      const index=indices.get(key(referencedHead));
      ensure(index!==undefined&&index>=previousIndex,'REFERENCE_ROLLBACK',
        'Document "'+name+'" was replaced, rolled back or diverged across historical $refs');
      previousIndex=index;
    }
    checks.documents++;
    const active=own(activeRefs,name);
    if(active)checks.activeDocuments++;
    const parent=child.genesis.parent;
    if(meta.firstEvent&&sameHead(parent,meta.firstBefore))checks.causalOrigins++;
    else if(parent!==null&&!root.events.some(e=>sameHead(e.head,parent)))
      warnings.push('Документ '+name+': genesis.parent не входит в ancestry выбранного корня');
    else if(meta.firstEvent&&parent!==null&&!sameHead(parent,meta.firstBefore))
      warnings.push('Документ '+name+': origin не совпадает с версией корня перед первой регистрацией (возможно, импортирован)');
    documents[name]={head:clone(lastHead),active,events:child.events.length,referencedVersions:meta.heads.length,origin:parent};
  }
  if(options.anchorHead!==undefined){
    ensure(validHead(options.anchorHead),'INVALID_HEAD','Invalid trusted historical HEAD');
    const index=root.events.findIndex(e=>sameHead(e.head,options.anchorHead));
    ensure(index>=0,'ANCHOR_MISMATCH','Trusted HEAD is not in the root ancestry');
    checks.anchorIndex=index;
  }
  return {status:'complete',rootHead,checks,documents,warnings};
}
// Recovery is explicitly destructive. Never remove a physical slot whose contents
// were overwritten: it might belong to a different branch of history.
async function truncateInvalidTail(s,diagnosis,recoveryHead) {
  validateStore(s);
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
    if(!own(s.records,id))continue;
    // These records were read and authenticated while inspecting from the broken tip.
    deletions.push(id);
  }
  const out=staging(s);
  for(const id of deletions)delete out.records[id];
  return {store:out,recoveryHead,deletedIds:deletions,keptInvalidSlot:invalid};
}
function commit(s,tx){validateStore(tx);for(const k of Object.keys(s))delete s[k];Object.assign(s,tx);return s;}
// Physical destructive replacement requires explicit confirmation in the caller.
async function overwrite(s,head,ops){return append(s,head,ops,{overwrite:true});}
const api={VERSION,newStore,validateStore,packHead,unpackHead,validHead,sameHead,assertJson,patch,pointer,resolve,getRootRefs,genesis,append,inspect,load,successorId,rootId,readRecord,createDatabase,createDocument,patchDocument,verifyDatabase,truncateInvalidTail,staging,publish,commit,overwrite,escapePtr,encode64,decode64};
g.HTML_DBMS=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
