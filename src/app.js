/* HTML_DBMS/3 minimal physical shell. All database UI is provided by the JSON entry. */
(function(){
'use strict';
const db=HTML_DBMS, $=id=>document.getElementById(id);
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
 $('store-summary').textContent='Физических сообщений: '+Object.keys(store.records).length+' · опубликованных БД: '+Object.keys(store.publicHeads||{}).length+'.';
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
 const sel=$('databases'),prev=sel.value,names=Object.keys(store.publicHeads||{});
 sel.replaceChildren();
 const empty=new Option(names.length?'— выберите БД —':'— БД отсутствуют —','');
 empty.disabled=true;
 sel.add(empty);
 for(const name of names)sel.add(new Option(name,name));
 sel.disabled=names.length===0;
 if(names.includes(prev))sel.value=prev;
 else if(preselect&&names.length){sel.value=names[0];setFields(store.publicHeads[names[0]]);}
 else sel.value='';
}
function selectAlias(alias){const h=store.publicHeads?.[alias];if(!db.validHead(h))return;setFields(h);notice('ID и H подставлены для «'+alias+'». Нажмите «Открыть».');}
function findPublicName(h){const selected=$('databases').value;if(selected&&db.sameHead(store.publicHeads?.[selected],h))return selected;return Object.keys(store.publicHeads||{}).find(n=>db.sameHead(store.publicHeads[n],h))||null;}
function stopApp(){if(activeFrame){activeFrame.remove();activeFrame=null;}}
function clearEntry(){stopApp();$('entry-area').replaceChildren();}
function element(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function placeholder(text){const e=element('div',text,'placeholder');$('entry-area').appendChild(e);}
function getRootRefs(root){return db.getRootRefs?db.getRootRefs(root):root?.$refs||{};}
async function openFields(){await openHead(fieldHead());}
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
   const f=document.createElement('iframe');f.title='HTML entry (без исполнения JS)';f.setAttribute('sandbox','');f.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">'+value.html;hostSafeAppend(f);return;
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
async function launchSandbox(entry){if(activeFrame)stopApp();const f=document.createElement('iframe');f.title='Приложение из JSON entry';f.setAttribute('sandbox','allow-scripts');activeFrame=f;
 const startup=e=>{if(e.source!==f.contentWindow||!e.data||e.data.kind!=='html-dbms-ready')return;window.removeEventListener('message',startup);if(activeFrame===f)f.contentWindow.postMessage({kind:'html-dbms-start',source:entry.source,exportName:entry.export||'main'},'*');};window.addEventListener('message',startup);f.addEventListener('load',()=>{if(activeFrame!==f)window.removeEventListener('message',startup);},{once:true});
 $('entry-area').appendChild(f);f.srcdoc=SANDBOX_DOCUMENT;
}
async function stagedUpdate(result,previous){if(activePublished())db.publish(result.store,publicName,result.rootHead,previous);db.commit(store,result.store);rootHead=result.rootHead;setFields(rootHead);syncCatalog();notice('Изменение записано · новый root: '+format(rootHead)+' · сохраните HTML.');if(debug)await showDebug();}
async function authorizeWrite(promptText){if(!confirm(promptText+'\nИзменение будет сохранено в рабочей копии HTML DBMS. Продолжить?'))throw Error('Запись отменена пользователем');}
window.addEventListener('message',event=>{if(!activeFrame||event.source!==activeFrame.contentWindow)return;const msg=event.data;if(!msg||typeof msg!=='object')return;if(msg.kind==='html-dbms-error'){notice('entry: '+msg.error,true);return;}if(msg.kind!=='html-dbms-rpc')return;
 runRpc(msg).then(value=>{if(activeFrame&&event.source===activeFrame.contentWindow)event.source.postMessage({kind:'html-dbms-reply',id:msg.id,ok:true,value},'*');}).catch(e=>{if(activeFrame&&event.source===activeFrame.contentWindow)event.source.postMessage({kind:'html-dbms-reply',id:msg.id,ok:false,error:(e?.code?e.code+': ':'')+(e?.message||String(e))},'*');});
});
async function runRpc(message){needRoot();const params=message.payload||{};switch(message.method){
 case 'read':{const ref=params.ref;if(typeof ref!=='string')throw Error('Неверная ссылка');if(ref==='')return (await db.load(store,rootHead)).state;return (await db.resolve(store,rootHead,rootHead,{$ref:ref})).value;}
 case 'getHead':return [...rootHead];
 case 'patch':{const name=params.document;const ops=params.operations;if(typeof name!=='string'||!Array.isArray(ops))throw Error('Неверный запрос patch');await authorizeWrite('JSON Patch: '+(name||'(корень)')+' ('+ops.length+' операций)');const previous=[...rootHead];let result;if(name===''){const staged=db.staging(store),r=await db.append(staged,rootHead,ops);result={store:staged,rootHead:r.head};}else result=await db.patchDocument(store,rootHead,name,ops);await stagedUpdate(result,previous);return {rootHead:[...rootHead]};}
 case 'createDocument':{if(!validName(params.name))throw Error('Недопустимое имя документа');db.assertJson(params.state);await authorizeWrite('Создать документ «'+params.name+'»');const previous=[...rootHead];const result=await db.createDocument(store,rootHead,params.name,params.state);await stagedUpdate(result,previous);return {rootHead:[...rootHead],documentHead:result.documentHead};}
 default:throw Error('Неподдерживаемая операция entry: '+String(message.method));}}
async function createDatabase(){const name=prompt('Имя новой БД');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const exists=OWN(store.publicHeads||{},name);if(exists)throw Error('БД с таким именем уже опубликована');const entry={type:'application/javascript',export:'main',source:STARTER_SOURCE};const result=await db.createDatabase(store,name,{entry,visible:true});db.commit(store,result.store);syncCatalog();$('databases').value=name;setFields(result.rootHead);await openHead(result.rootHead);notice('БД «'+name+'» создана и открыта. Чтобы сохранить её для следующего запуска, нажмите «Сохранить» и откройте скачанный HTML.');}
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
function readStoreFromHTML(raw){
 const parsed=new DOMParser().parseFromString(raw,'text/html');
 const nodes=parsed.querySelectorAll('[id="db-store"]');
 if(nodes.length!==1||nodes[0].tagName!=='SCRIPT'||nodes[0].getAttribute('type')!=='application/json')throw Error('Не найден единственный валидный db-store');
 const value=JSON.parse(nodes[0].textContent);db.validateStore(value);return value;
}
async function verifyFile(){
 const file=$('external').files[0];if(!file)throw Error('Выберите HTML для внешней проверки');
 const other=readStoreFromHTML(await file.text());
 const h=rootHead||fieldHead();
 let external;
 try{external=await db.verifyDatabase(other,h);}catch(e){external={status:'failed',code:e.code||'ERROR',message:e.message};}
 const changed=[];let shared=0;
 for(const [id,ct]of Object.entries(store.records))if(Object.prototype.hasOwnProperty.call(other.records,id)){
   shared++;if(other.records[id]!==ct)changed.push(id);
 }
 validationOutput({target:file.name,verifiedHead:h,external,sharedSlots:shared,changedPhysicalSlots:changed.length,changedIds:changed.slice(0,100),note:'Внешний HTML прочитан только как данные. Разные шифротексты одного ID — возможная физическая перезапись.'});
 notice(changed.length?'Внешняя проверка: изменены физические слоты '+changed.length:'Внешний HTML проверен. Общих слотов: '+shared,changed.length>0);
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
async function publish(){needRoot();const root=(await db.load(store,rootHead)).state;const name=prompt('Имя публичной БД',publicName||root.name||'База');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const prev=store.publicHeads?.[name];if(prev&&!db.sameHead(prev,rootHead)&&!confirm('Заменить опубликованный head «'+name+'»?'))return;const tx=db.staging(store);db.publish(tx,name,rootHead);db.commit(store,tx);publicName=name;syncCatalog();$('databases').value=name;notice('Опубликована «'+name+'»');}
async function hideHead(){needRoot();if(!publicName||!store.publicHeads||!OWN(store.publicHeads,publicName)){notice('Текущий head не опубликован');return;}if(!confirm('Скрыть «'+publicName+'»? Сохраните пару ID/H перед скрытием.'))return;const tx=db.staging(store);delete tx.publicHeads[publicName];if(!Object.keys(tx.publicHeads).length)delete tx.publicHeads;db.commit(store,tx);publicName=null;syncCatalog();notice('Публикация удалена. Для повторного открытия используйте ID/H.');}
async function copyHead(){const h=fieldHead(),t=format(h);try{await navigator.clipboard.writeText(t);notice('Скопировано: '+t);}catch{prompt('Скопируйте ID/H:',t);}}
async function loadHtml(file){if(!file)return;const raw=await file.text();const candidate=readStoreFromHTML(raw);store=candidate;rootHead=null;publicName=null;debug=false;lastDiagnosis=null;setFields(null);$('databases').value='';syncCatalog(true);show('debug-panel',false);$('debug-toggle').setAttribute('aria-expanded','false');clearEntry();const count=Object.keys(store.publicHeads||{}).length;placeholder(count?'БД выбрана и её ID/H подставлены. Нажмите «Открыть».':'В загруженном файле нет опубликованных БД. Можно открыть скрытую по ID/H или создать новую.');notice('Контейнер загружен. Опубликованных БД: '+count+(count?'. Выбрана «'+$('databases').value+'», нажмите «Открыть».':'.'));}
function exportDocument(){const doc=exportTemplate.cloneNode(true);const s=doc.querySelector('#db-store');s.textContent=JSON.stringify(store).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');return '<!doctype html>\n'+doc.outerHTML;}
function save(){db.validateStore(store);const html=exportDocument();const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='html_dbms_3_saved.html';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);notice('Новый HTML-файл скачан. Исходный файл на диске не перезаписывается: открывайте сохранённую копию.');}
async function init(){
 store=JSON.parse($('db-store').textContent);
 db.validateStore(store);setFields(null);syncCatalog(true);
 const names=Object.keys(store.publicHeads||{});
 if(names.length)notice('Опубликованных БД: '+names.length+'. Выбрана «'+$('databases').value+'»: ID и H подставлены, нажмите «Открыть».');
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
