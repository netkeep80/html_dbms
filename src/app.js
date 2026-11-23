/* HTML_DBMS/3 minimal physical shell. All database UI is provided by the JSON entry. */
(function(){
'use strict';
const db=HTML_DBMS, $=id=>document.getElementById(id);
const XHTML_NS='http://www.w3.org/1999/xhtml';
const XML_CONTAINER=/\b(?:xml|xhtml\+xml)\b/i.test(document.contentType||'');
const makeElement=tag=>XML_CONTAINER?document.createElementNS(XHTML_NS,tag):document.createElement(tag);
function makeOption(label,value){const e=makeElement('option');e.textContent=label;e.value=value;return e;}
// Export from a pristine template: never copy decrypted application DOM into saved HTML.
const exportTemplate=document.documentElement.cloneNode(true);
const STARTER_SOURCE=$('starter-source').textContent;
let store, rootHead=null, publicName=null, debug=false, busy=false, activeFrame=null, lastDiagnosis=null;
const OWN=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function notice(message,bad=false){$('status').textContent=message;$('status').className='notice '+(bad?'error':'good');}
function err(e){notice((e?.code?e.code+': ':'')+(e?.message||String(e)),true);}
async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){err(e);}finally{busy=false;}}
function format(h){return h?JSON.stringify(h):'—';}
function show(id,on){$(id).hidden=!on;}
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
 const next=$(panel).hidden;
 for(const name of names){show(name+'-panel',name===which&&next);$(name+'-toggle').setAttribute('aria-expanded',String(name===which&&next));}
 if(which==='info'&&next)updateInfo();
 return next;
}
function validationOutput(value){$('validation-report').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);}
function setFields(head){$('head-id').value=head?.[0]||'';$('head-hash').value=head?.[1]||'';}
function fieldHead(){const h=[$('head-id').value.trim(),$('head-hash').value.trim()];if(!db.validHead(h))throw Error('Введите корректные ID (22 символа) и H (43 символа)');return h;}
function syncCatalog(preselect=false){
 updateInfo();
 const sel=$('databases'),names=Object.keys(store.publicHeads||{});
 sel.replaceChildren();
 const empty=makeOption(names.length?'— существующая —':'— БД отсутствуют —','');
 sel.add(empty);
 for(const name of names)sel.add(makeOption(name,name));
 sel.disabled=names.length===0;
 // The select is an ACTION, not the currently opened database's state.
 sel.value='';
 if(preselect&&names.length)setFields(store.publicHeads[names[0]]);
}
function selectAlias(alias){
 const h=store.publicHeads?.[alias];
 $('databases').value=''; // enables choosing the same alias again
 if(!db.validHead(h))return;
 setFields(h);
 notice('ID и H подставлены для «'+alias+'». Нажмите «Открыть»; активная БД пока не изменена.');
}
function findPublicName(h){return Object.keys(store.publicHeads||{}).find(n=>db.sameHead(store.publicHeads[n],h))||null;}
function stopApp(){if(activeFrame){activeFrame.remove();activeFrame=null;}}
function clearEntry(){stopApp();$('entry-area').replaceChildren();}
function element(tag,text,cls){const el=makeElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function placeholder(text){const e=element('div',text,'placeholder');$('entry-area').appendChild(e);}
function getRootRefs(root){return db.getRootRefs?db.getRootRefs(root):root?.$refs||{};}
function clearOpened(){rootHead=null;publicName=null;lastDiagnosis=null;clearEntry();placeholder('БД не открыта. Проверьте ID/H и нажмите «Открыть».');updateInfo();}
async function openFields(){
  // A failed Open MUST revoke the previous iframe's ability to issue writes.
  const requested=[$('head-id').value.trim(),$('head-hash').value.trim()];
  clearOpened();
  if(!db.validHead(requested))throw Error('Введите корректные ID (22 символа) и H (43 символа)');
  await openHead(requested);
}
function assertWriteTarget(){
  needRoot();
  const h=[$('head-id').value.trim(),$('head-hash').value.trim()];
  if(!db.sameHead(h,rootHead))throw Error('Поля ID/H отличаются от открытой БД. Для записи откройте нужную версию кнопкой «Открыть».');
}
async function openHead(head){const chain=await db.load(store,head);getRootRefs(chain.state);rootHead=[...head];publicName=findPublicName(head);debug=false;show('debug-panel',false);$('debug-toggle').setAttribute('aria-expanded','false');setFields(head);updateInfo();await renderEntry();notice('Открыто: '+(chain.state?.name||'JSON')+' · '+format(head));}
function entryValue(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===1&&typeof x.$ref==='string';}
async function renderEntry(){clearEntry();if(!rootHead){placeholder('Выберите БД, укажите ID/H и нажмите «Открыть».');return;}const root=(await db.load(store,rootHead)).state;let value=root?.entry;if(entryValue(value))value=(await db.resolve(store,rootHead,rootHead,value)).value;
 if(value===undefined||value===null){placeholder('В корневом JSON-документе отсутствует entry. Приложение не задано.');return;}
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='application/javascript'&&typeof value.source==='string'){
   const host=$('entry-area'), block=element('div',undefined,'pane');block.appendChild(element('div','Исполняемое entry: '+(value.export||'main'),'meta'));const btn=element('button','Запустить приложение','primary');btn.classList.add('entry-launch');block.appendChild(btn);block.appendChild(element('p','JavaScript выполняется только после подтверждения, в изолированном iframe. Запись в БД требует отдельного подтверждения.','meta'));host.appendChild(block);
   btn.onclick=()=>run(async()=>{block.remove();await launchSandbox(value);});
   // Автозапуск разрешён исключительно для поставляемого неизменённого стартового приложения.
   if(value.source===STARTER_SOURCE&&value.export==='main'){block.remove();await launchSandbox(value);}
   return;
 }
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='text/html'&&typeof value.html==='string'){
   const f=makeElement('iframe');f.title='HTML entry (без исполнения JS)';f.setAttribute('sandbox','');f.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">'+value.html;hostSafeAppend(f);return;
 }
 const pre=element('pre',JSON.stringify(value,null,2));$('entry-area').appendChild(pre);
}
function hostSafeAppend(el){$('entry-area').appendChild(el);}
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
async function stagedUpdate(result,previous){if(activePublished())db.publish(result.store,publicName,result.rootHead,previous);db.commit(store,result.store);rootHead=result.rootHead;setFields(rootHead);syncCatalog();notice('Изменение записано · новый root: '+format(rootHead)+' · сохраните HTML.');if(debug)await showDebug();}
async function authorizeWrite(promptText){if(!confirm(promptText+'\nИзменение будет сохранено в рабочей копии HTML DBMS. Продолжить?'))throw Error('Запись отменена пользователем');}
window.addEventListener('message',event=>{if(!activeFrame||event.source!==activeFrame.contentWindow)return;const msg=event.data;if(!msg||typeof msg!=='object')return;if(msg.kind==='html-dbms-error'){notice('entry: '+msg.error,true);return;}if(msg.kind!=='html-dbms-rpc')return;
 runRpc(msg).then(value=>{if(activeFrame&&event.source===activeFrame.contentWindow)event.source.postMessage({kind:'html-dbms-reply',id:msg.id,ok:true,value},'*');}).catch(e=>{if(activeFrame&&event.source===activeFrame.contentWindow)event.source.postMessage({kind:'html-dbms-reply',id:msg.id,ok:false,error:(e?.code?e.code+': ':'')+(e?.message||String(e))},'*');});
});
async function runRpc(message){needRoot();const params=message.payload||{};switch(message.method){
 case 'read':{const ref=params.ref;if(typeof ref!=='string')throw Error('Неверная ссылка');if(ref==='')return (await db.load(store,rootHead)).state;return (await db.resolve(store,rootHead,rootHead,{$ref:ref})).value;}
 case 'getHead':return [...rootHead];
 case 'patch':{assertWriteTarget();const name=params.document;const ops=params.operations;if(typeof name!=='string'||!Array.isArray(ops))throw Error('Неверный запрос patch');await authorizeWrite('JSON Patch: '+(name||'(корень)')+' ('+ops.length+' операций)');const previous=[...rootHead];const result=await retryOccupied('JSON Patch '+(name||'(корень)'),async opts=>{if(name===''){const staged=db.staging(store),r=await db.append(staged,rootHead,ops,{overwrite:opts.overwriteRoot});return {store:staged,rootHead:r.head};}return db.patchDocument(store,rootHead,name,ops,opts);});await stagedUpdate(result,previous);return {rootHead:[...rootHead]};}
 case 'createDocument':{assertWriteTarget();if(!validName(params.name))throw Error('Недопустимое имя документа');db.assertJson(params.state);await authorizeWrite('Создать документ «'+params.name+'»');const previous=[...rootHead];const result=await retryOccupied('Создание документа '+params.name,opts=>db.createDocument(store,rootHead,params.name,params.state,null,opts));await stagedUpdate(result,previous);return {rootHead:[...rootHead],documentHead:result.documentHead};}
 default:throw Error('Неподдерживаемая операция entry: '+String(message.method));}}
async function createDatabase(){const name=prompt('Имя новой БД');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const exists=OWN(store.publicHeads||{},name);if(exists)throw Error('БД с таким именем уже опубликована');const entry={type:'application/javascript',export:'main',source:STARTER_SOURCE};const result=await db.createDatabase(store,name,{entry,visible:true});db.commit(store,result.store);syncCatalog();setFields(result.rootHead);await openHead(result.rootHead);notice('БД «'+name+'» создана и открыта. Чтобы сохранить её для следующего запуска, нажмите «Сохранить» и откройте скачанный HTML.');}
async function showDebug(){
 const h=rootHead||fieldHead(),root=await db.inspect(store,h);
 const children={};
 if(root.status==='complete')for(const [name,head]of Object.entries(getRootRefs(root.chain.state)))children[name]=await db.inspect(store,head);
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
 const all={},warnings=[];
 for(const [alias,head] of Object.entries(store.publicHeads||{})){
   try{all[alias]=await db.verifyDatabase(store,head);}
   catch(e){all[alias]={status:'failed',code:e.code||'ERROR',message:e.message};}
 }
 const result={format:store.format,records:Object.keys(store.records).length,publishedHeads:Object.keys(all).length,publicDatabases:all,warnings:['Скрытые цепочки без известного head не перечисляются и не проверяются.']};
 validationOutput(result);
 notice('Проверка контейнера завершена. Детали в «Валидация».');
}
async function verifyAnchor(){
 const h=rootHead||fieldHead(),anchor=$('anchor').value.trim();
 if(!anchor)throw Error('Укажите доверенный исторический H');
 try{
 const result=await db.verifyDatabase(store,h,{anchorHash:anchor});
 validationOutput(result);notice('Доверенный H найден в проверенной ancestry.');
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
 const recovery=[$('recovery-id').value.trim(),$('recovery-hash').value.trim()];
 if(!db.validHead(recovery))throw Error('Укажите корректные Recovery ID и H');
 const result=await db.truncateInvalidTail(store,lastDiagnosis,recovery);
 const aliases=Object.entries(store.publicHeads||{}).filter(([_,h])=>db.sameHead(h,lastDiagnosis.sourceHead)).map(([n])=>n);
 const message='Восстановление необратимо.\nСохранится повреждённый physical slot: '+result.keptInvalidSlot+'\nБудут удалены ID: '+JSON.stringify(result.deletedIds)+'\nПубличные записи будут перенаправлены на recovery head: '+aliases.join(', ')+'\nПодтвердить?';
 if(!confirm(message))return;
 for(const alias of aliases)db.publish(result.store,alias,recovery,lastDiagnosis.sourceHead);
 db.commit(store,result.store);rootHead=recovery;publicName=aliases[0]||null;setFields(recovery);syncCatalog();lastDiagnosis=null;
 await renderEntry();validationOutput({status:'recovered',recoveryHead:recovery,deletedIds:result.deletedIds,keptInvalidSlot:result.keptInvalidSlot});
 notice('Восстановление выполнено. Сохраните новый HTML.');
}
async function publish(){needRoot();const root=(await db.load(store,rootHead)).state;const name=prompt('Имя публичной БД',publicName||root.name||'База');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const prev=store.publicHeads?.[name];if(prev&&!db.sameHead(prev,rootHead)&&!confirm('Заменить опубликованный head «'+name+'»?'))return;const tx=db.staging(store);db.publish(tx,name,rootHead);db.commit(store,tx);publicName=name;syncCatalog();notice('Опубликована «'+name+'»');}
async function hideHead(){needRoot();if(!publicName||!store.publicHeads||!OWN(store.publicHeads,publicName)){notice('Текущий head не опубликован');return;}if(!confirm('Скрыть «'+publicName+'»? Сохраните пару ID/H перед скрытием.'))return;const tx=db.staging(store);delete tx.publicHeads[publicName];if(!Object.keys(tx.publicHeads).length)delete tx.publicHeads;db.commit(store,tx);publicName=null;syncCatalog();notice('Публикация удалена. Для повторного открытия используйте ID/H.');}
async function copyHead(){const h=fieldHead(),t=format(h);try{await navigator.clipboard.writeText(t);notice('Скопировано: '+t);}catch{prompt('Скопируйте ID/H:',t);}}
async function loadHtml(file){if(!file)return;const raw=await file.text();const candidate=readStoreFromDocument(raw);store=candidate;rootHead=null;publicName=null;debug=false;lastDiagnosis=null;setFields(null);$('databases').value='';syncCatalog(true);show('debug-panel',false);$('debug-toggle').setAttribute('aria-expanded','false');clearEntry();const count=Object.keys(store.publicHeads||{}).length;placeholder(count?'БД выбрана и её ID/H подставлены. Нажмите «Открыть».':'В загруженном файле нет опубликованных БД. Можно открыть скрытую по ID/H или создать новую.');notice('Контейнер загружен. Опубликованных БД: '+count+(count?'. ID/H первой опубликованной БД подставлены, нажмите «Открыть».':'.'));}
function exportDocument(){
  const doc=exportTemplate.cloneNode(true);
  const storeNode=doc.querySelector('#db-store');
  // DOM textContent is safely serialized by each container's native serializer.
  // This clone is pristine; no app iframe, debug output or decrypted DOM is copied.
  storeNode.textContent=JSON.stringify(store).replace(/</g,'\\u003c')
    .replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  if(XML_CONTAINER){
    const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(doc);
    // Defensive reparse: fail closed if XML could not be round-tripped.
    const parsed=new DOMParser().parseFromString(xml,'application/xml');
    if(parsed.getElementsByTagName('parsererror').length)throw Error('Экспорт XML некорректен');
    return xml;
  }
  return '<!doctype html>\n'+doc.outerHTML;
}
function save(){
 db.validateStore(store);
 const output=exportDocument(),extension=XML_CONTAINER?'xml':'html';
 const mime=XML_CONTAINER?'application/xml':'text/html';
 const url=URL.createObjectURL(new Blob([output],{type:mime+';charset=utf-8'}));
 const a=makeElement('a');a.href=url;a.download='html_dbms_3_saved.'+extension;
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 notice('Новый '+extension.toUpperCase()+'-файл скачан. Исходный файл на диске не перезаписывается.');
}
async function init(){
 store=JSON.parse($('db-store').textContent);
 db.validateStore(store);setFields(null);syncCatalog(true);
 const names=Object.keys(store.publicHeads||{});
 if(names.length)notice('Опубликованных БД: '+names.length+'. ID и H первой опубликованной БД подставлены, нажмите «Открыть».');
 else{clearEntry();placeholder('Этот HTML пока не содержит опубликованных БД. Нажмите «Новая» или загрузите другой HTML через «Инфо».');notice('Контейнер пуст: опубликованных БД нет. Создайте новую БД и сохраните новый HTML-файл.');}
}
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
$('verify').onclick=()=>run(verify);
$('verify-store').onclick=()=>run(verifyStore);
$('verify-anchor').onclick=()=>run(verifyAnchor);
$('verify-file').onclick=()=>run(verifyFile);
$('truncate').onclick=()=>run(truncate);
$('publish').onclick=()=>run(publish);
$('hide-head').onclick=()=>run(hideHead);
init().catch(err);
})();
