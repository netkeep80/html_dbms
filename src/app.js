/* HTML_DBMS/4 minimal physical shell. All database UI is provided by the JSON entry. */
(function(){
'use strict';
const db=HTML_DBMS, $=id=>document.querySelector('[id="'+id+'"]');
const XHTML_NS='http://www.w3.org/1999/xhtml';
const XML_CONTAINER=/\b(?:xml|xhtml\+xml)\b/i.test(document.contentType||'');
const makeElement=tag=>XML_CONTAINER?document.createElementNS(XHTML_NS,tag):document.createElement(tag);
function makeOption(label,value){const e=makeElement('option');e.textContent=label;e.value=value;return e;}
// Export from a pristine template: never copy decrypted application DOM into saved HTML.
const exportTemplate=document.documentElement.cloneNode(true);
const STARTER_SOURCE=$('starter-source').textContent;
let store, rootHead=null, publicName=null, debug=false, busy=false, activeFrame=null, lastDiagnosis=null, openEpoch=0, rpcBusy=false;
const OWN=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function notice(message,bad=false){$('status').textContent=message;$('status').className='notice '+(bad?'error':'good');}
function err(e){notice((e?.code?e.code+': ':'')+(e?.message||String(e)),true);}
async function run(fn){if(busy||rpcBusy)return;busy=true;const epoch=openEpoch;try{await fn();}catch(e){if(epoch===openEpoch||!rootHead)err(e);}finally{busy=false;}}
function format(h){return h||'—';}
function show(id,on){const el=$(id);on?el.removeAttribute('hidden'):el.setAttribute('hidden','hidden');}
function validName(s){return typeof s==='string'&&s.trim().length>0&&!s.includes('/')&&!['__proto__','constructor','prototype'].includes(s);}
function needRoot(){if(!rootHead)throw Error('Сначала откройте базу');}
function activePublished(){return !!(publicName&&store.publicHeads&&db.sameHead(store.publicHeads[publicName],rootHead));}
function updateInfo(){
 if(!store)return;
 const bytes=new TextEncoder().encode(JSON.stringify(store)).length;
 $('store-summary').textContent='Физических сообщений: '+Object.keys(store.records).length+' · размер хранилища: '+bytes+' байт · опубликованных БД: '+Object.keys(store.publicHeads||{}).length+'.';
 $('current-root').textContent='Открытая версия: '+format(rootHead)+(publicName?' · '+publicName:' · не опубликована');
}
function togglePanel(which){
 const names=['info','validation','debug'];
 const panel=which+'-panel';
 const next=$(panel).hasAttribute('hidden');
 for(const name of names){show(name+'-panel',name===which&&next);$(name+'-toggle').setAttribute('aria-expanded',String(name===which&&next));}
 if(which==='info'&&next)updateInfo();
 return next;
}
function validationOutput(value){$('validation-report').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);}
function setFields(head){$('head').value=head||'';}
function fieldHead(){const h=$('head').value;if(!db.validHead(h))throw Error('Введите корректный HEAD (64 символа Base64url)');return h;}
function syncCatalog(){
 updateInfo();
 const sel=$('databases'),names=Object.keys(store.publicHeads||{});
 sel.replaceChildren();
 const empty=makeOption(names.length?'— существующая —':'— БД отсутствуют —','');
 sel.add(empty);
 for(const name of names)sel.add(makeOption(name,name));
 sel.disabled=names.length===0;
 // The select is an ACTION, not the currently opened database's state.
 sel.value='';
}
function selectAlias(alias){
 const h=store.publicHeads?.[alias];
 $('databases').value=''; // enables choosing the same alias again
 if(!db.validHead(h))return;
 setFields(h);
 notice('HEAD подставлены для «'+alias+'». Нажмите «Открыть»; активная БД пока не изменена.');
}
function findPublicName(h){return Object.keys(store.publicHeads||{}).find(n=>db.sameHead(store.publicHeads[n],h))||null;}
function stopApp(){if(activeFrame){activeFrame.remove();activeFrame=null;}}
function clearEntry(){stopApp();$('entry-area').replaceChildren();}
function element(tag,text,cls){const el=makeElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function placeholder(text){const e=element('div',text,'placeholder');$('entry-area').appendChild(e);}
const getRootRefs=db.getRootRefs;
function clearOpened(){openEpoch++;notice('БД не открыта');rootHead=null;publicName=null;lastDiagnosis=null;debug=false;show('debug-panel',false);$('debug-toggle').setAttribute('aria-expanded','false');$('debug-raw').textContent='';validationOutput('Проверка ещё не выполнялась.');clearEntry();placeholder('БД не открыта. Укажите HEAD или выберите БД.');updateInfo();return openEpoch;}
function fragmentHead(hash){if(!hash)return null;const match=/^#head=([A-Za-z0-9_-]{64})$/.exec(hash);if(!match||!db.validHead(match[1]))throw Error('Некорректный HEAD в URL');return match[1];}
function accessUrl(head){const url=new URL(location.href);url.search='';url.hash='head='+head;return url.href;}
function syncUrl(head){if(!location.hash)return;const url=new URL(location.href);url.hash=head?'head='+head:'';history.replaceState(null,'',url.href);}
async function openFields(){const requested=$('head').value;await openHead(requested,true);}
function assertWriteTarget(){needRoot();if(!db.sameHead($('head').value,rootHead))throw Error('Поле HEAD отличается от открытой БД. Для записи откройте нужную версию кнопкой «Открыть».');}
async function openHead(head,updateUrl=false){const epoch=clearOpened(),requestedHash=location.hash,snapshot=store;setFields(head);try{if(!db.validHead(head))throw Error('Некорректный HEAD (64 символа Base64url)');const {chain}=await db.openDatabase(snapshot,head);if(epoch!==openEpoch||requestedHash!==location.hash||snapshot!==store)return;rootHead=head;publicName=findPublicName(head);if(updateUrl)syncUrl(head);updateInfo();await renderEntry(epoch,chain.state);if(epoch===openEpoch)notice('Открыто: '+(chain.state?.name||'JSON')+' · '+format(head));}catch(e){if(epoch===openEpoch){clearOpened();throw e;}}}
async function openInitial(useFragment=true){clearOpened();setFields(null);syncCatalog();const names=Object.keys(store.publicHeads||{});const explicit=useFragment?fragmentHead(location.hash):null;if(explicit){await openHead(explicit);return;}if(names.length===1){await openHead(store.publicHeads[names[0]]);return;}clearEntry();placeholder(names.length?'Выберите опубликованную БД, затем нажмите «Открыть».':'Для открытия требуется HEAD или ссылка доступа.');notice(names.length?'Выберите БД · опубликовано '+names.length:'Контейнер пуст: опубликованных БД нет.');}
function entryValue(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===1&&typeof x.$ref==='string';}
async function renderEntry(epoch=openEpoch,checkedRoot){clearEntry();if(!rootHead){placeholder('Выберите БД, укажите HEAD и нажмите «Открыть».');return;}const root=checkedRoot??(await db.load(store,rootHead)).state;let value=root?.entry;if(entryValue(value))value=(await db.resolve(store,rootHead,rootHead,value)).value;
 if(epoch!==openEpoch)return;
 if(value===undefined||value===null){placeholder('В корневом JSON-документе отсутствует entry. Приложение не задано.');return;}
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='application/javascript'&&typeof value.source==='string'){
   const host=$('entry-area'), block=element('div',undefined,'pane');block.appendChild(element('div','Исполняемое entry: '+(value.export||'main'),'meta'));const btn=element('button','Запустить приложение','primary');btn.classList.add('entry-launch');block.appendChild(btn);block.appendChild(element('p','JavaScript выполняется только после подтверждения, в изолированном iframe. Запись в БД требует отдельного подтверждения.','meta'));host.appendChild(block);
   btn.onclick=()=>run(async()=>{if(epoch!==openEpoch)return;block.remove();await launchSandbox(value);});
   // Автозапуск разрешён исключительно для поставляемого неизменённого стартового приложения.
   if(value.source===STARTER_SOURCE&&value.export==='main'){block.remove();await launchSandbox(value);}
   return;
 }
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='text/html'&&typeof value.html==='string'){
   const f=makeElement('iframe');f.title='HTML entry (без исполнения JS)';f.setAttribute('sandbox','');f.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">'+value.html;$('entry-area').appendChild(f);return;
 }
 const pre=element('pre',JSON.stringify(value,null,2));$('entry-area').appendChild(pre);
}
const SANDBOX_DOCUMENT=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"></head><body><div id="app"></div><script>
(function(){'use strict';let sequence=0;const pending=new Map();const request=(method,payload)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});parent.postMessage({kind:'html-dbms-rpc',id,method,payload},'*');});
const api=Object.freeze({read:(ref='')=>request('read',{ref}),patch:(document,operations)=>request('patch',{document,operations}),createDocument:(name,state)=>request('createDocument',{name,state}),getHead:()=>request('getHead',{})});
window.addEventListener('message',async event=>{if(event.source!==parent)return;const data=event.data;if(!data||typeof data!=='object')return;if(data.kind==='html-dbms-reply'){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.ok?p.resolve(data.value):p.reject(new Error(data.error));}if(data.kind==='html-dbms-start'){
try{const blob=new Blob([data.source],{type:'text/javascript'});const url=URL.createObjectURL(blob);try{const module=await import(url);const main=module[data.exportName||'main'];if(typeof main!=='function')throw Error('Не найден export '+data.exportName);await main(api,document.getElementById('app'));}finally{URL.revokeObjectURL(url);}}catch(e){document.getElementById('app').textContent='Ошибка запуска entry: '+(e?.message||e);parent.postMessage({kind:'html-dbms-error',error:String(e?.message||e)},'*');}
}});parent.postMessage({kind:'html-dbms-ready'},'*');})();
<\/script></body></html>`;
async function launchSandbox(entry){if(activeFrame)stopApp();const f=makeElement('iframe');f.title='Приложение из JSON entry';f.setAttribute('sandbox','allow-scripts');activeFrame=f;
 const startup=e=>{if(e.source!==f.contentWindow||!e.data||e.data.kind!=='html-dbms-ready')return;window.removeEventListener('message',startup);if(activeFrame===f)f.contentWindow.postMessage({kind:'html-dbms-start',source:entry.source,exportName:entry.export||'main'},'*');};window.addEventListener('message',startup);f.addEventListener('load',()=>{if(activeFrame!==f)window.removeEventListener('message',startup);},{once:true});
 $('entry-area').appendChild(f);f.srcdoc=SANDBOX_DOCUMENT;
}
async function confirmOccupied(operation,error){
  const slot=error.id||'неизвестен';
  const predecessor=JSON.stringify(error.predecessor||null);
  return confirm('ВНИМАНИЕ: физический successor занят.\nОперация: '+operation+'\nID слота: '+slot+'\nПредыдущий head: '+predecessor+'\n\nПерезапись может необратимо нарушить доступность старых цепочек и исторических БД. Существующий ciphertext будет заменён без удаления потомков.\n\nПодтвердить ФИЗИЧЕСКУЮ ПЕРЕЗАПИСЬ?');
}
async function retryOccupied(operation,perform){
  const opts={overwriteChild:false,overwriteRoot:false};
  for(let attempt=0;attempt<3;attempt++){
    try{return await perform(opts);}catch(e){
      if(e.code!=='SUCCESSOR_OCCUPIED')throw e;
      const phase=e.phase||'root';
      if(!await confirmOccupied(operation+' / '+phase,e))throw Error('Физическая перезапись отменена');
      if(phase==='child')opts.overwriteChild=true;
      else opts.overwriteRoot=true;
    }
  }
  throw Error('Не удалось разрешить конфликт successor');
}
async function stagedUpdate(result,previous){if(activePublished())db.publish(result.store,publicName,result.rootHead,previous);syncUrl(result.rootHead);db.commit(store,result.store);rootHead=result.rootHead;setFields(rootHead);syncCatalog();notice('Изменение записано · новый root: '+format(rootHead)+' · сохраните контейнер.');if(debug)await showDebug();}
async function authorizeWrite(promptText){if(!confirm(promptText+'\nИзменение будет сохранено только в рабочей копии HTML DBMS, не на сервере. Продолжить?'))throw Error('Запись отменена пользователем');}
window.addEventListener('message',event=>{if(!activeFrame||event.source!==activeFrame.contentWindow)return;const msg=event.data;if(!msg||typeof msg!=='object')return;if(msg.kind==='html-dbms-error'){notice('entry: '+msg.error,true);return;}if(msg.kind!=='html-dbms-rpc')return;
 const epoch=openEpoch,requestedHash=location.hash;runRpc(msg,epoch,requestedHash).then(value=>{if(epoch===openEpoch&&activeFrame&&event.source===activeFrame.contentWindow&&(!location.hash||location.hash==='#head='+rootHead))event.source.postMessage({kind:'html-dbms-reply',id:msg.id,ok:true,value},'*');}).catch(e=>{if(epoch===openEpoch&&activeFrame&&event.source===activeFrame.contentWindow&&(!location.hash||location.hash==='#head='+rootHead))event.source.postMessage({kind:'html-dbms-reply',id:msg.id,ok:false,error:(e?.code?e.code+': ':'')+(e?.message||String(e))},'*');});
});
async function runRpc(message,epoch,requestedHash){needRoot();if(location.hash&&fragmentHead(location.hash)!==rootHead)throw Error('Контекст URL изменился');const params=message.payload||{};switch(message.method){
 case 'read':{const ref=params.ref;if(typeof ref!=='string')throw Error('Неверная ссылка');if(ref==='')return (await db.load(store,rootHead)).state;return (await db.resolve(store,rootHead,rootHead,{$ref:ref})).value;}
 case 'getHead':return rootHead;
 case 'patch':{assertWriteTarget();if(busy||rpcBusy)throw Error('Запись уже выполняется');rpcBusy=true;try{const name=params.document;const ops=params.operations;if(typeof name!=='string'||!Array.isArray(ops))throw Error('Неверный запрос patch');await authorizeWrite('JSON Patch: '+(name||'(корень)')+' ('+ops.length+' операций)');const previous=rootHead;const result=await retryOccupied('JSON Patch '+(name||'(корень)'),async opts=>{if(name==='')return db.patchRoot(store,rootHead,ops,{overwrite:opts.overwriteRoot});return db.patchDocument(store,rootHead,name,ops,opts);});if(epoch!==openEpoch||requestedHash!==location.hash||!db.sameHead(rootHead,previous))throw Error('Контекст записи изменился');assertWriteTarget();await stagedUpdate(result,previous);return {rootHead};}finally{rpcBusy=false;}}
 case 'createDocument':{assertWriteTarget();if(busy||rpcBusy)throw Error('Запись уже выполняется');rpcBusy=true;try{if(!validName(params.name))throw Error('Недопустимое имя документа');db.assertJson(params.state);await authorizeWrite('Создать документ «'+params.name+'»');const previous=rootHead;const result=await retryOccupied('Создание документа '+params.name,opts=>db.createDocument(store,rootHead,params.name,params.state,null,opts));if(epoch!==openEpoch||requestedHash!==location.hash||!db.sameHead(rootHead,previous))throw Error('Контекст записи изменился');assertWriteTarget();await stagedUpdate(result,previous);return {rootHead,documentHead:result.documentHead};}finally{rpcBusy=false;}}
 default:throw Error('Неподдерживаемая операция entry: '+String(message.method));}}
async function createDatabase(){const epoch=openEpoch,requestedHash=location.hash;const name=prompt('Имя новой БД');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const exists=OWN(store.publicHeads||{},name);if(exists)throw Error('БД с таким именем уже опубликована');const entry={type:'application/javascript',export:'main',source:STARTER_SOURCE};const result=await db.createDatabase(store,name,{entry,visible:true});if(epoch!==openEpoch||requestedHash!==location.hash)throw Error('Контекст открытия изменился');db.commit(store,result.store);syncCatalog();setFields(result.rootHead);await openHead(result.rootHead,true);notice('БД «'+name+'» создана и открыта. Чтобы сохранить её для следующего запуска, нажмите «Сохранить» и откройте скачанный файл.');}
async function showDebug(){
 const epoch=openEpoch,h=rootHead||fieldHead(),snapshot=store,root=await db.inspect(snapshot,h);
 const children={};
 if(root.status==='complete')for(const [name,head]of Object.entries(getRootRefs(root.chain.state)))Object.defineProperty(children,name,{value:await db.inspect(snapshot,head),enumerable:true});
 if(epoch!==openEpoch||snapshot!==store||!debug&&$('debug-panel').hasAttribute('hidden'))return false;
 $('debug-raw').textContent=JSON.stringify({rootHead:h,root,children},null,2);
}
async function verify(){
 const h=rootHead||fieldHead();lastDiagnosis=null;
 const inspected=await db.inspect(store,h);
 if(inspected.status!=='complete'){
   lastDiagnosis=inspected;
   validationOutput({status:'broken',rootHead:h,diagnosis:inspected});
   notice('Обнаружен разрыв цепочки: '+inspected.code,true);return;
 }
 try{
   const result=await db.verifyDatabase(store,h);
   validationOutput(result);notice('Цепочки и ссылки выбранной БД проверены.');
 }catch(e){validationOutput({status:'failed',code:e.code||'ERROR',message:e.message});throw e;}
}
async function verifyStore(){
 db.validateStore(store);lastDiagnosis=null;
 const all={};
 for(const [alias,head] of Object.entries(store.publicHeads||{})){
   try{all[alias]=await db.verifyDatabase(store,head);}
   catch(e){all[alias]={status:'failed',code:e.code||'ERROR',message:e.message};}
 }
 const result={format:store.format,records:Object.keys(store.records).length,publishedHeads:Object.keys(all).length,publicDatabases:all,warnings:['Скрытые цепочки без известного head не перечисляются и не проверяются.']};
 validationOutput(result);
 notice('Проверка контейнера завершена. Детали в «Валидация».');
}
async function verifyAnchor(){
 const h=rootHead||fieldHead(),anchor=$('anchor').value;
 if(!anchor)throw Error('Укажите доверенный исторический HEAD');
 try{
 const result=await db.verifyDatabase(store,h,{anchorHead:anchor});
 validationOutput(result);notice('Доверенный HEAD найден в проверенной ancestry.');
 }catch(e){validationOutput({status:'failed',code:e.code||'ANCHOR_FAILED',message:e.message});throw e;}
}
function readStoreFromDocument(raw){
 // Parse both representations AS DATA; never inject imported markup into the DOM.
 const xml=/^\s*(?:<\?xml\b|<html\b[^>]*\bxmlns\s*=)/i.test(raw);
 const parsed=new DOMParser().parseFromString(raw,xml?'application/xml':'text/html');
 if(xml){
   if(parsed.getElementsByTagName('parsererror').length ||
      parsed.documentElement.localName!=='html' ||
      parsed.documentElement.namespaceURI!==XHTML_NS)
     throw Error('Некорректный XML/XHTML контейнер');
 }
 const nodes=parsed.querySelectorAll('[id="db-store"]');
 if(nodes.length!==1||nodes[0].localName!=='script'||
   (xml&&nodes[0].namespaceURI!==XHTML_NS)||
   nodes[0].getAttribute('type')!=='application/json')
   throw Error('Не найден единственный валидный db-store');
 const value=JSON.parse(nodes[0].textContent);
 db.validateStore(value);
 return value;
}
async function verifyFile(){
 const file=$('external').files[0];if(!file)throw Error('Выберите HTML или XML для внешней проверки');
 const other=readStoreFromDocument(await file.text());
 const h=rootHead||fieldHead();
 let external;
 try{external=await db.verifyDatabase(other,h);}catch(e){external={status:'failed',code:e.code||'ERROR',message:e.message};}
 const changedIds=[],missingIds=[],addedIds=[];let shared=0;
 for(const [id,ct]of Object.entries(store.records)){
   if(!OWN(other.records,id))missingIds.push(id);
   else {shared++;if(other.records[id]!==ct)changedIds.push(id);}
 }
 for(const id of Object.keys(other.records))if(!OWN(store.records,id))addedIds.push(id);
 validationOutput({target:file.name,verifiedHead:h,external,sharedSlots:shared,missingIds,addedIds,changedIds,changedPhysicalSlots:changedIds.length,note:'missingIds отсутствуют во внешнем HTML; addedIds появились во внешнем HTML; changedIds имеют другой ciphertext при том же ID.'});
 notice('Внешняя проверка: удалены '+missingIds.length+', добавлены '+addedIds.length+', изменены '+changedIds.length,!!(missingIds.length||changedIds.length||external.status!=='complete'));
}
async function truncate(){
 if(!lastDiagnosis)throw Error('Сначала выполните проверку и получите диагноз разрыва');
 const recovery=$('recovery-head').value;
 if(!db.validHead(recovery))throw Error('Укажите корректные Recovery HEAD');
 const epoch=openEpoch,snapshot=store,diagnosis=lastDiagnosis;const result=await db.truncateInvalidTail(snapshot,diagnosis,recovery);if(epoch!==openEpoch||snapshot!==store)return;await db.verifyDatabase(result.store,recovery);if(epoch!==openEpoch||snapshot!==store)return;
 const aliases=Object.entries(store.publicHeads||{}).filter(([_,h])=>db.sameHead(h,lastDiagnosis.sourceHead)).map(([n])=>n);
 const message='Восстановление необратимо.\nСохранится повреждённый physical slot: '+result.keptInvalidSlot+'\nБудут удалены ID: '+JSON.stringify(result.deletedIds)+'\nПубличные записи будут перенаправлены на recovery head: '+aliases.join(', ')+'\nПодтвердить?';
 if(!confirm(message))return;
 for(const alias of aliases)db.publish(result.store,alias,recovery,lastDiagnosis.sourceHead);
 db.commit(store,result.store);rootHead=recovery;syncUrl(recovery);publicName=aliases[0]||null;setFields(recovery);syncCatalog();lastDiagnosis=null;
 await renderEntry();validationOutput({status:'recovered',recoveryHead:recovery,deletedIds:result.deletedIds,keptInvalidSlot:result.keptInvalidSlot});
 notice('Восстановление выполнено. Сохраните новый HTML.');
}
async function publish(){needRoot();const epoch=openEpoch,snapshot=store,head=rootHead;const {chain}=await db.openDatabase(snapshot,head);if(epoch!==openEpoch||snapshot!==store||head!==rootHead)return;const root=chain.state;const name=prompt('Имя публичной БД',publicName||root.name||'База');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const prev=store.publicHeads?.[name];if(prev&&!db.sameHead(prev,rootHead)&&!confirm('Заменить опубликованный head «'+name+'»?'))return;const tx=db.staging(store);db.publish(tx,name,rootHead);db.commit(store,tx);publicName=name;syncCatalog();notice('Опубликована «'+name+'»');}
async function hideHead(){needRoot();if(!publicName||!store.publicHeads||!OWN(store.publicHeads,publicName)){notice('Текущий head не опубликован');return;}if(!confirm('Скрыть «'+publicName+'»? Сохраните HEAD перед скрытием.'))return;const tx=db.staging(store);delete tx.publicHeads[publicName];if(!Object.keys(tx.publicHeads).length)delete tx.publicHeads;db.commit(store,tx);publicName=null;syncCatalog();notice('Публикация удалена. Для повторного открытия используйте HEAD.');}
async function copyText(t,label){try{await navigator.clipboard.writeText(t);notice('Скопировано: '+label);}catch{prompt(label,t);}}
async function copyHead(){needRoot();await copyText(rootHead,'HEAD открытой версии');}
async function copyLink(){needRoot();await copyText(accessUrl(rootHead),'Ссылка доступа');}
async function loadHtml(file){if(!file)return;const epoch=openEpoch,snapshot=store;const candidate=readStoreFromDocument(await file.text());if(epoch!==openEpoch||snapshot!==store)return;clearOpened();store=candidate;syncUrl(null);await openInitial(false);if(rootHead)notice('Контейнер загружен. БД открыта.');else notice('Контейнер загружен. Опубликованных БД: '+Object.keys(store.publicHeads||{}).length);}
// Convert the pristine XHTML template to HTML, never the live application DOM.
function htmlSerialize(node){if(node.nodeType===3||node.nodeType===4)return node.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');if(node.nodeType===8)return '<!--'+node.data+'-->';if(node.nodeType!==1)return '';const tag=node.localName;const attrs=Array.from(node.attributes).filter(a=>a.name!=='xmlns').map(a=>' '+a.name+'="'+a.value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')+'"').join('');const start='<'+tag+attrs+'>';if(/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag))return start;const content=tag==='script'?node.textContent.replace(/<\/script/gi,'<\\/script'):tag==='style'?node.textContent:Array.from(node.childNodes).map(htmlSerialize).join('');return start+content+'</'+tag+'>';}
function exportDocument(data=store,asXML=XML_CONTAINER){
  const doc=exportTemplate.cloneNode(true);
  const storeNode=doc.querySelector('#db-store');
  // DOM textContent is safely serialized by each container's native serializer.
  // This clone is pristine; no app iframe, debug output or decrypted DOM is copied.
  storeNode.textContent=JSON.stringify(data).replace(/</g,'\\u003c')
    .replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  if(asXML){
    const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(doc);
    // Defensive reparse: fail closed if XML could not be round-tripped.
    const parsed=new DOMParser().parseFromString(xml,'application/xml');
    if(parsed.getElementsByTagName('parsererror').length)throw Error('Экспорт XML некорректен');
    return xml;
  }
  return '<!doctype html>\n'+(XML_CONTAINER?htmlSerialize(doc):doc.outerHTML);
}
function save(publishSite=false){
 db.validateStore(store);const data=publishSite?{...store,publicHeads:{}}:store;
 const asXML=XML_CONTAINER&&!publishSite,output=exportDocument(data,asXML),extension=asXML?'xml':'html';
 const mime=asXML?'application/xml':'text/html';
 const url=URL.createObjectURL(new Blob([output],{type:mime+';charset=utf-8'}));
 const a=makeElement('a');a.href=url;a.download=publishSite?'index.html':'html_dbms_4_saved.'+extension;
 document.querySelector('body').appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 notice('Новый '+extension.toUpperCase()+'-файл скачан. Исходный файл на диске не перезаписывается.');
}
async function init(){store=JSON.parse($('db-store').textContent);db.validateStore(store);await openInitial();}
window.addEventListener('hashchange',()=>{if(store)openInitial().catch(err);});
$('new-db').onclick=()=>run(createDatabase);
$('databases').onchange=()=>selectAlias($('databases').value);
$('open-head').onclick=()=>run(openFields);
$('save').onclick=()=>run(save);
$('info-toggle').onclick=()=>togglePanel('info');
$('validation-toggle').onclick=()=>togglePanel('validation');
$('debug-toggle').onclick=()=>run(async()=>{debug=togglePanel('debug')&&await showDebug()!==false;});
$('import').onclick=()=>{$('input-html').click();};
$('input-html').onchange=()=>run(async()=>{const f=$('input-html').files[0];await loadHtml(f);$('input-html').value='';});
$('copy-head').onclick=()=>run(copyHead);
$('copy-link').onclick=()=>run(copyLink);
$('publish-site').onclick=()=>run(()=>save(true));
$('verify').onclick=()=>run(verify);
$('verify-store').onclick=()=>run(verifyStore);
$('verify-anchor').onclick=()=>run(verifyAnchor);
$('verify-file').onclick=()=>run(verifyFile);
$('truncate').onclick=()=>run(truncate);
$('publish').onclick=()=>run(publish);
$('hide-head').onclick=()=>run(hideHead);
init().catch(err);
})();
