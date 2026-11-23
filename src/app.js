/* HTML_DBMS/3 minimal physical shell. All database UI is provided by the JSON entry. */
(function(){
'use strict';
const db=HTML_DBMS, $=id=>document.getElementById(id);
// Export from a pristine template: never copy decrypted application DOM into saved HTML.
const exportTemplate=document.documentElement.cloneNode(true);
const STARTER_SOURCE=$('starter-source').textContent;
let store, rootHead=null, publicName=null, debug=false, busy=false, activeFrame=null;
const OWN=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function notice(message,bad=false){$('status').textContent=message;$('status').className='notice '+(bad?'error':'good');}
function err(e){notice((e?.code?e.code+': ':'')+(e?.message||String(e)),true);}
async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){err(e);}finally{busy=false;}}
function format(h){return h?JSON.stringify(h):'—';}
function show(id,on){$(id).hidden=!on;}
function validName(s){return typeof s==='string'&&s.trim().length>0&&!s.includes('/')&&!['__proto__','constructor','prototype'].includes(s);}
function needRoot(){if(!rootHead)throw Error('Сначала откройте базу');}
function activePublished(){return !!(publicName&&store.publicHeads&&db.sameHead(store.publicHeads[publicName],rootHead));}
function setFields(head){$('head-id').value=head?.[0]||'';$('head-hash').value=head?.[1]||'';}
function fieldHead(){const h=[$('head-id').value.trim(),$('head-hash').value.trim()];if(!db.validHead(h))throw Error('Введите корректные ID (22 символа) и H (43 символа)');return h;}
function syncCatalog(){const sel=$('databases'),prev=sel.value;sel.replaceChildren();sel.add(new Option('— существующая —',''));for(const name of Object.keys(store.publicHeads||{}))sel.add(new Option(name,name));if(OWN(store.publicHeads||{},prev))sel.value=prev;}
function selectAlias(alias){const h=store.publicHeads?.[alias];if(!db.validHead(h))return;setFields(h);notice('ID и H подставлены для «'+alias+'». Нажмите «Открыть».');}
function findPublicName(h){const selected=$('databases').value;if(selected&&db.sameHead(store.publicHeads?.[selected],h))return selected;return Object.keys(store.publicHeads||{}).find(n=>db.sameHead(store.publicHeads[n],h))||null;}
function stopApp(){if(activeFrame){activeFrame.remove();activeFrame=null;}}
function clearEntry(){stopApp();$('entry-area').replaceChildren();}
function element(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function placeholder(text){const e=element('div',text,'placeholder');$('entry-area').appendChild(e);}
function getRootRefs(root){return db.getRootRefs?db.getRootRefs(root):root?.$refs||{};}
async function openFields(){await openHead(fieldHead());}
async function openHead(head){const chain=await db.load(store,head);getRootRefs(chain.state);rootHead=[...head];publicName=findPublicName(head);debug=false;show('debug-panel',false);setFields(head);await renderEntry();notice('Открыто: '+(chain.state?.name||'JSON')+' · '+format(head));}
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
async function createDatabase(){const name=prompt('Имя новой БД');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const exists=OWN(store.publicHeads||{},name);if(exists)throw Error('БД с таким именем уже опубликована');const entry={type:'application/javascript',export:'main',source:STARTER_SOURCE};const result=await db.createDatabase(store,name,{entry,visible:true});db.commit(store,result.store);syncCatalog();$('databases').value=name;setFields(result.rootHead);await openHead(result.rootHead);}
async function showDebug(){needRoot();const chain=await db.load(store,rootHead);const children={};for(const [name,head]of Object.entries(getRootRefs(chain.state)))children[name]=(await db.inspect(store,head));
 $('debug-raw').textContent=JSON.stringify({rootHead,root:{genesis:chain.genesis,events:chain.events.map(x=>({head:x.head,raw:x.r})),state:chain.state},children},null,2);show('debug-panel',true);}
async function verify(){needRoot();const root=await db.inspect(store,rootHead);const results={root:root.status,documents:{}};if(root.status==='complete')for(const [name,head]of Object.entries(getRootRefs(root.chain.state))){const result=await db.inspect(store,head);results.documents[name]=result.status==='complete'?'OK':result.code;}show('debug-panel',true);$('debug-raw').textContent=JSON.stringify(results,null,2);notice('Проверено. Подробности — в блоке отладки.');}
async function publish(){needRoot();const root=(await db.load(store,rootHead)).state;const name=prompt('Имя публичной БД',publicName||root.name||'База');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const prev=store.publicHeads?.[name];if(prev&&!db.sameHead(prev,rootHead)&&!confirm('Заменить опубликованный head «'+name+'»?'))return;const tx=db.staging(store);db.publish(tx,name,rootHead);db.commit(store,tx);publicName=name;syncCatalog();$('databases').value=name;notice('Опубликована «'+name+'»');}
async function hideHead(){needRoot();if(!publicName||!store.publicHeads||!OWN(store.publicHeads,publicName)){notice('Текущий head не опубликован');return;}if(!confirm('Скрыть «'+publicName+'»? Сохраните пару ID/H перед скрытием.'))return;const tx=db.staging(store);delete tx.publicHeads[publicName];if(!Object.keys(tx.publicHeads).length)delete tx.publicHeads;db.commit(store,tx);publicName=null;syncCatalog();notice('Публикация удалена. Для повторного открытия используйте ID/H.');}
async function copyHead(){const h=fieldHead(),t=format(h);try{await navigator.clipboard.writeText(t);notice('Скопировано: '+t);}catch{prompt('Скопируйте ID/H:',t);}}
async function loadHtml(file){if(!file)return;const raw=await file.text();const parsed=new DOMParser().parseFromString(raw,'text/html');const nodes=parsed.querySelectorAll('[id="db-store"]');if(nodes.length!==1||nodes[0].tagName!=='SCRIPT'||nodes[0].getAttribute('type')!=='application/json')throw Error('Не найден единственный валидный db-store');const candidate=JSON.parse(nodes[0].textContent);db.validateStore(candidate);store=candidate;rootHead=null;publicName=null;debug=false;syncCatalog();setFields(null);show('debug-panel',false);clearEntry();placeholder('Файл открыт. Выберите БД или введите ID/H, затем нажмите «Открыть».');notice('Контейнер HTML_DBMS/3 загружен. БД: '+Object.keys(store.publicHeads||{}).length+'.');}
function exportDocument(){const doc=exportTemplate.cloneNode(true);const s=doc.querySelector('#db-store');s.textContent=JSON.stringify(store).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');return '<!doctype html>\n'+doc.outerHTML;}
function save(){db.validateStore(store);const html=exportDocument();const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='html_dbms_3.html';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);notice('Автономный HTML_DBMS/3 сохранён.');}
async function init(){store=JSON.parse($('db-store').textContent);db.validateStore(store);syncCatalog();setFields(null);notice('Контейнер готов. Опубликованных БД: '+Object.keys(store.publicHeads||{}).length+'.');}
$('new-db').onclick=()=>run(createDatabase);
$('databases').onchange=()=>selectAlias($('databases').value);
$('open-head').onclick=()=>run(openFields);
$('save').onclick=()=>run(save);
$('debug-toggle').onclick=()=>run(async()=>{if(debug){debug=false;show('debug-panel',false);}else{debug=true;await showDebug();}});
$('import').onclick=()=>{$('input-html').click();$('more-menu').open=false;};
$('input-html').onchange=()=>run(async()=>{const f=$('input-html').files[0];await loadHtml(f);$('input-html').value='';});
$('copy-head').onclick=()=>run(copyHead);
$('verify').onclick=()=>run(verify);
$('publish').onclick=()=>run(publish);
$('hide-head').onclick=()=>run(hideHead);
init().catch(err);
})();
