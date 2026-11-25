/* HTML_DBMS/4 minimal physical shell. All database UI is provided by the JSON entry. */
(function(){
'use strict';
const db=HTML_DBMS, $=id=>document.querySelector('[id="'+id+'"]');
const XHTML_NS='http://www.w3.org/1999/xhtml';
const XML_CONTAINER=/\b(?:xml|xhtml\+xml)\b/i.test(document.contentType||'');
const makeElement=tag=>XML_CONTAINER?document.createElementNS(XHTML_NS,tag):document.createElement(tag);
function makeOption(label,value){const e=makeElement('option');e.textContent=label;e.value=value;return e;}
// Export from a pristine template: never copy decrypted application DOM into saved HTML.
let exportTemplate, templateBytes;
const STARTER_SOURCE=$('starter-source').textContent,demoNode=$('cash-demo-source'),DEMO_SOURCE=demoNode?JSON.parse(demoNode.textContent):undefined;
let pendingRpc=0,debugBusy=false;
let store, rootHead=null, publicName=null, busy=null, activeFrame=null, lastDiagnosis=null, openEpoch=0, rpcBusy=null, session=null, startupListener=null;
const OWN=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function notice(message,bad=false){$('status').textContent=message;$('status').className='notice '+(bad?'error':'good');}
function err(e){notice((e?.code?e.code+': ':'')+(e?.message||String(e)),true);}
function context(){return {epoch:openEpoch,store,revision:store?db.revision(store):null,hash:location.hash,head:rootHead,field:$('head').value};}
function current(c){return c.epoch===openEpoch&&c.store===store&&c.hash===location.hash&&c.head===rootHead&&c.field===$('head').value&&(!store||c.revision===db.revision(store));}
function requireCurrent(c){if(!current(c))throw Error('Контекст операции изменился');}
const locked=()=>busy?.epoch===openEpoch||rpcBusy?.epoch===openEpoch;
async function run(fn){if(locked())return;const c=context();busy=c;try{await fn();}catch(e){if(current(c))err(e);}finally{if(busy===c)busy=null;}}
function format(h){return h||'—';}
function show(id,on){const el=$(id);on?el.removeAttribute('hidden'):el.setAttribute('hidden','hidden');}
function validName(s){return typeof s==='string'&&s.trim().length>0&&!s.includes('/')&&!['__proto__','constructor','prototype'].includes(s);}
function needRoot(){if(!rootHead)throw Error('Сначала откройте базу');}
function activePublished(){return !!(publicName&&db.sameHead(db.catalog(store)[publicName],rootHead));}
function updateInfo(){
 if(!store)return;
 if(!$('info-panel').hasAttribute('hidden')){const {bytes,count,published}=db.storeInfo(store);
 $('store-summary').textContent='Физических сообщений: '+count+' · размер хранилища: '+bytes+' байт · опубликованных БД: '+published+'.';}
 $('current-root').textContent='Открытая версия: '+format(rootHead)+(publicName?' · '+publicName:' · не опубликована');
}
function debugVisible(){return !$('debug-panel').hasAttribute('hidden');}
function togglePanel(which){
 const names=['info','validation','debug'];
 const panel=which+'-panel';
 const next=$(panel).hasAttribute('hidden');
 for(const name of names){show(name+'-panel',name===which&&next);$(name+'-toggle').setAttribute('aria-expanded',String(name===which&&next));}
 if(!debugVisible())$('debug-raw').textContent='';
 if(which==='info'&&next)updateInfo();
 return next;
}
function validationOutput(value){$('validation-report').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);}
function setFields(head){$('head').value=head||'';}
function fieldHead(){const h=$('head').value;if(!db.validHead(h))throw Error('Введите корректный HEAD (64 символа Base64url)');return h;}
function syncCatalog(){
 updateInfo();
 const sel=$('databases'),names=Object.keys(db.catalog(store));
 sel.replaceChildren();
 const empty=makeOption(names.length?'— существующая —':'— БД отсутствуют —','');
 sel.add(empty);
 for(const name of names)sel.add(makeOption(name,name));
 sel.disabled=names.length===0;
 // The select is an ACTION, not the currently opened database's state.
 sel.value='';
}
function selectAlias(alias){
 const h=db.catalog(store)[alias];
 $('databases').value=''; // enables choosing the same alias again
 if(!db.validHead(h))return;
 setFields(h);
 notice('HEAD подставлены для «'+alias+'». Нажмите «Открыть»; активная БД пока не изменена.');
}
function findPublicName(h){return Object.entries(db.catalog(store)).find(([,head])=>head===h)?.[0]||null;}
function stopApp(){if(startupListener){window.removeEventListener('message',startupListener);startupListener=null;}if(session){session.port.close();session=null;}if(activeFrame){activeFrame.remove();activeFrame=null;}}
function clearEntry(){stopApp();$('entry-area').replaceChildren();}
function element(tag,text,cls){const el=makeElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function placeholder(text){const e=element('div',text,'placeholder');$('entry-area').appendChild(e);}
const getRootRefs=db.getRootRefs;
function clearOpened(){openEpoch++;notice('БД не открыта');rootHead=null;publicName=null;lastDiagnosis=null;show('debug-panel',false);$('debug-toggle').setAttribute('aria-expanded','false');$('debug-raw').textContent='';validationOutput('Проверка ещё не выполнялась.');clearEntry();placeholder('БД не открыта. Укажите HEAD или выберите БД.');updateInfo();return openEpoch;}
function fragmentHead(hash){if(!hash)return null;const match=/^#head=([A-Za-z0-9_-]{64})$/.exec(hash);if(!match||!db.validHead(match[1]))throw Error('Некорректный HEAD в URL');return match[1];}
function accessUrl(head){const url=new URL(location.href);url.search='';url.hash='head='+head;return url.href;}
function syncUrl(head){if(!location.hash)return;const url=new URL(location.href);url.hash=head?'head='+head:'';history.replaceState(null,'',url.href);}
async function openFields(){const requested=$('head').value;await openHead(requested,true);}
function assertWriteTarget(){needRoot();if(!db.sameHead($('head').value,rootHead))throw Error('Поле HEAD отличается от открытой БД. Для записи откройте нужную версию кнопкой «Открыть».');}
async function openHead(head,updateUrl=false){
 clearOpened();setFields(head);const c=context();let chain;
 try{if(!db.validHead(head))throw Error('Некорректный HEAD (64 символа Base64url)');({chain}=await db.openDatabase(c.store,head));}
 catch(e){if(current(c)){clearOpened();err(e);}return;}
 if(!current(c))return;
 rootHead=head;publicName=findPublicName(head);if(updateUrl)syncUrl(head);updateInfo();
 const opened=context();
 try{await renderEntry(opened.epoch,chain.state);if(current(opened))notice('Открыто: '+(chain.state?.name||'JSON')+' · '+format(head));}
 catch(e){if(current(opened)){clearEntry();placeholder('Ошибка entry: '+(e.code||'')+' '+e.message);notice('БД открыта; ошибка entry: '+e.message,true);}}
}
async function openInitial(useFragment=true){
 clearOpened();setFields(null);syncCatalog();const catalog=db.catalog(store),names=Object.keys(catalog);
 let explicit;try{explicit=useFragment?fragmentHead(location.hash):null;}catch(e){err(e);return;}
 if(explicit){await openHead(explicit);return;}if(names.length===1){await openHead(catalog[names[0]]);return;}
 clearEntry();placeholder(names.length?'Выберите опубликованную БД, затем нажмите «Открыть».':'Для открытия требуется HEAD или ссылка доступа.');notice(names.length?'Выберите БД · опубликовано '+names.length:'Контейнер пуст: опубликованных БД нет.');
}
function entryValue(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===1&&typeof x.$ref==='string';}
async function resolvedEntry(s,h,root){let value=(root??await db.readState(s,h))?.entry;return entryValue(value)?(await db.resolve(s,h,h,value)).value:value;}
async function renderEntry(epoch=openEpoch,checkedRoot){if(epoch!==openEpoch)return;const c=context();clearEntry();if(!rootHead){placeholder('Выберите БД, укажите HEAD и нажмите «Открыть».');return;}const value=await resolvedEntry(c.store,c.head,checkedRoot);
 if(!current(c))return;
 if(value===undefined||value===null){placeholder('В корневом JSON-документе отсутствует entry. Приложение не задано.');return;}
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='application/javascript'&&typeof value.source==='string'){
   const host=$('entry-area'), block=element('div',undefined,'pane');block.appendChild(element('div','Исполняемое entry: '+(value.export||'main'),'meta'));const btn=element('button','Запустить приложение','primary');btn.classList.add('entry-launch');block.appendChild(btn);block.appendChild(element('p','JavaScript выполняется только после подтверждения, в изолированном iframe. Запись в БД требует отдельного подтверждения.','meta'));host.appendChild(block);
   btn.onclick=()=>run(async()=>{if(!current(c))return;block.remove();await launchSandbox(value);});
   // Автозапуск разрешён исключительно для поставляемого неизменённого стартового приложения.
   if((value.source===STARTER_SOURCE||value.source===DEMO_SOURCE)&&value.export==='main'){block.remove();await launchSandbox(value);}
   return;
 }
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='text/html'&&typeof value.html==='string'){
   const f=makeElement('iframe');f.title='HTML entry (без исполнения JS)';f.setAttribute('sandbox','');f.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">'+value.html;$('entry-area').appendChild(f);return;
 }
 const pre=element('pre',JSON.stringify(value,null,2));$('entry-area').appendChild(pre);
}
const SANDBOX_DOCUMENT='/* SANDBOX_DOCUMENT */';
async function launchSandbox(entry){
 stopApp();const f=makeElement('iframe');f.title='Приложение из JSON entry';f.setAttribute('sandbox','allow-scripts');activeFrame=f;
 let loads=0;
 const revoke=()=>{if(activeFrame===f){rpcBusy=null;clearEntry();placeholder('Сессия entry завершена. Откройте HEAD повторно.');}};
 f.addEventListener('load',()=>{if(++loads>1)revoke();});
 const startup=e=>{
  if(activeFrame!==f||e.source!==f.contentWindow||e.data?.kind!=='html-dbms-ready'||e.ports.length!==1)return;
  window.removeEventListener('message',startup);startupListener=null;
  const port=e.ports[0],s={port,entry};session=s;
  port.onmessage=event=>{
   if(session!==s)return;const msg=event.data;if(!msg||typeof msg!=='object')return;
   if(msg.kind==='html-dbms-revoke'){revoke();return;}
   if(msg.kind==='html-dbms-error'){notice('entry: '+msg.error,true);return;}
   if(msg.kind!=='html-dbms-rpc')return;
   const reply=data=>{if(session===s)port.postMessage({kind:'html-dbms-reply',id:msg.id,...data});};
   if(pendingRpc>=8){reply({ok:false,error:'RESOURCE_LIMIT: RPC concurrency limit exceeded'});return;}
   pendingRpc++;runRpc(msg,s).then(value=>reply({ok:true,value}),e=>reply({ok:false,error:(e?.code?e.code+': ':'')+(e?.message||String(e))})).finally(()=>{pendingRpc--;});
  };
  port.postMessage({kind:'html-dbms-start',source:entry.source,exportName:entry.export||'main'});
 };
 startupListener=startup;window.addEventListener('message',startup);f.srcdoc=SANDBOX_DOCUMENT;$('entry-area').appendChild(f);
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
function stagedUpdate(result,previous){
 if(activePublished())db.publish(result.store,publicName,result.rootHead,previous);
 commitStage(result.store);rootHead=result.rootHead;
 // Commit is complete. Presentation failures must not turn a successful write
 // into a rejected RPC or invite the user to repeat an already committed patch.
 try{syncUrl(rootHead);setFields(rootHead);syncCatalog();notice('Изменение записано · новый root: '+format(rootHead)+' · сохраните контейнер.');}
 catch(e){if(location.hash&&location.hash!=='#head='+rootHead)clearEntry();notice('Изменение записано; ошибка интерфейса: '+e.message,true);}
 if(debugVisible()){const c=context();showDebug().catch(e=>{if(current(c)&&debugVisible())notice('Изменение записано; ошибка отладки: '+e.message,true);});}
}
async function authorizeWrite(promptText){if(!confirm(promptText+'\nИзменение будет сохранено только в рабочей копии HTML DBMS, не на сервере. Продолжить?'))throw Error('Запись отменена пользователем');}
async function runRpc(message,s){
 needRoot();const c=context();
 const guard=()=>{requireCurrent(c);if(session!==s)throw Error('Сессия entry завершена');};
 guard();if(c.hash&&fragmentHead(c.hash)!==c.head)throw Error('Контекст URL изменился');
 const params=message.payload||{};db.assertJson(params);
 switch(message.method){
 case 'read':{const ref=params.ref;if(typeof ref!=='string')throw Error('Неверная ссылка');const value=ref===''?await db.readState(c.store,c.head):(await db.resolve(c.store,c.head,c.head,{$ref:ref})).value;guard();return value;}
 case 'getHead':return c.head;
 case 'patch':case 'createDocument':{
  assertWriteTarget();if(locked())throw Error('Запись уже выполняется');rpcBusy=c;
  try{
   const create=message.method==='createDocument',name=create?params.name:params.document,ops=params.operations;
   if(create){if(!validName(name))throw Error('Недопустимое имя документа');db.assertJson(params.state);}
   else if(typeof name!=='string'||!Array.isArray(ops))throw Error('Неверный запрос patch');
   await authorizeWrite(create?'Создать документ «'+name+'»':'JSON Patch: '+(name||'(корень)')+' ('+ops.length+' операций)');
   guard();
   const result=await retryOccupied(create?'Создание документа '+name:'JSON Patch '+(name||'(корень)'),opts=>{
    guard();
    if(create)return db.createDocument(c.store,c.head,name,params.state,null,opts);
    return name===''?db.patchRoot(c.store,c.head,ops,{overwrite:opts.overwriteRoot}):db.patchDocument(c.store,c.head,name,ops,opts);
   });
   guard();let next;try{next=await resolvedEntry(result.store,result.rootHead);}catch{}
   guard();assertWriteTarget();
   const changed=next?.type!==s.entry.type||next?.source!==s.entry.source||(next?.export||'main')!==(s.entry.export||'main');
   stagedUpdate(result,c.head);
   const response=create?{rootHead,documentHead:result.documentHead}:{rootHead};
   if(changed){clearEntry();const opened=context();renderEntry(opened.epoch).catch(e=>{if(current(opened)){placeholder('Ошибка entry: '+e.message);notice('БД открыта; ошибка entry: '+e.message,true);}});}
   return response;
  }finally{if(rpcBusy===c)rpcBusy=null;}
 }
 default:throw Error('Неподдерживаемая операция entry: '+String(message.method));}
}
async function createDatabase(){
 const c=context(),name=prompt('Имя новой БД');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');
 const entry={type:'application/javascript',export:'main',source:STARTER_SOURCE};
 const result=await db.createDatabase(c.store,name,{entry,visible:true});requireCurrent(c);
 commitStage(result.store);syncCatalog();await openHead(result.rootHead,true);
}
async function showDebug(){
 if(!debugVisible())return false;
 if(debugBusy){$('debug-raw').textContent='Предыдущая диагностика ещё выполняется; откройте панель повторно.';return false;}
 const c=context(),h=c.head||fieldHead();$('debug-raw').textContent='';debugBusy=true;
 try{const text=await db.debugDatabase(c.store,h);if(!current(c)||!debugVisible())return false;$('debug-raw').textContent=text;return true;}finally{debugBusy=false;}
}
async function verify(){
 const c=context(),h=c.head||fieldHead();lastDiagnosis=null;
 try{const result=await db.verifyDatabase(c.store,h);if(!current(c))return;validationOutput(result);notice('Цепочки и ссылки выбранной БД проверены.');}
 catch(e){if(!current(c))return;
  if(e.code==='RESOURCE_LIMIT'){validationOutput({status:'limited',code:e.code,message:e.message,rootHead:h});err(e);}
  else if(e.diagnosis?.sourceHead===h){lastDiagnosis=e.diagnosis;validationOutput({status:'broken',rootHead:h,diagnosis:e.diagnosis});notice('Обнаружен разрыв цепочки: '+e.code,true);}
  else{validationOutput({status:'failed',code:e.code||'ERROR',message:e.message});err(e);}
 }
}
async function verifyStore(){
 const c=context();db.validateStore(db.snapshot(c.store));lastDiagnosis=null;let all;
 try{all=await db.verifyCatalog(c.store);}catch(e){if(current(c)){validationOutput({status:e.code==='RESOURCE_LIMIT'?'limited':'failed',code:e.code||'ERROR',message:e.message});err(e);}return;}
 if(!current(c))return;
 validationOutput({format:db.VERSION,records:db.storeInfo(c.store).count,publishedHeads:Object.keys(all).length,publicDatabases:all,warnings:['Скрытые цепочки без известного head не перечисляются и не проверяются.']});
 notice('Проверка контейнера завершена. Детали в «Валидация».');
}
async function verifyAnchor(){
 const c=context(),h=c.head||fieldHead(),anchor=$('anchor').value;if(!anchor)throw Error('Укажите доверенный исторический HEAD');
 try{const result=await db.verifyDatabase(c.store,h,{anchorHead:anchor});if(!current(c))return;validationOutput(result);notice('Доверенный HEAD найден в проверенной ancestry.');}
 catch(e){if(current(c)){validationOutput({status:'failed',code:e.code||'ANCHOR_FAILED',message:e.message});err(e);}}
}
const MAX_CONTAINER_BYTES=256*1024*1024;
function checkSize(bytes){if(bytes>MAX_CONTAINER_BYTES)throw Error('Превышен размер контейнера (256 МиБ)');}
// Ciphertext and IDs are ASCII; only publication names need an escaping allowance.
// A conservative six-byte bound per escaped character also covers XML entities.
function assertFits(candidate){
 const {bytes}=db.storeInfo(candidate),catalog=JSON.stringify(db.catalog(candidate)),encoder=new TextEncoder();
 const extra=encoder.encode(catalog.replace(/[<&>\u2028\u2029]/g,'xxxxxx')).length-encoder.encode(catalog).length;
 checkSize(templateBytes+bytes+extra);
}
function commitStage(tx){assertFits(tx);db.commit(store,tx);}
async function containerText(file){checkSize(file.size);return file.text();}
function readStoreFromDocument(raw){
 // XML declarations/entities/processing instructions may have external effects.
 // Reject them before parsing, ignoring literal source text in CDATA/comments.
 const xml=/^\s*(?:<\?xml\b|<html\b[^>]*\bxmlns\s*=)/i.test(raw);
 let scope;
 if(xml){
  const markup=raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g,'');
  if(/<!\s*(?:DOCTYPE|ENTITY)\b|<\?(?!xml\s)/i.test(markup))throw Error('Внешние XML декларации запрещены');
  const parsed=new DOMParser().parseFromString(raw,'application/xml');
  if(parsed.getElementsByTagName('parsererror').length||parsed.documentElement.localName!=='html'||parsed.documentElement.namespaceURI!==XHTML_NS)throw Error('Некорректный XML/XHTML контейнер');
  scope=parsed;
 }else{
  if(!/^\s*(?:<!doctype html\s*>|<html(?:\s|>))/i.test(raw))throw Error('Некорректный HTML контейнер');
  // A template in a detached HTML document has inert template contents:
  // no custom element activation, scripts, iframe documents or image fetches.
  // It works even when the owner container is an XML document.
  const inert=document.implementation.createHTMLDocument(''),template=inert.createElement('template');
  template.innerHTML=raw;scope=template.content;
 }
 const nodes=[],pending=[scope];let templates=0;
 while(pending.length){const tree=pending.pop();for(const node of tree.querySelectorAll('[id="db-store"]')){nodes.push(node);if(nodes.length>1)throw Error('Не найден единственный валидный db-store');}for(const t of tree.querySelectorAll('template'))if(t.content){if(++templates>10000)throw Error('Слишком много вложенных template');pending.push(t.content);}}
 if(nodes.length!==1||nodes[0].localName!=='script'||nodes[0].namespaceURI!==XHTML_NS||nodes[0].getAttribute('type')!=='application/json'||nodes[0].hasAttribute('src')||nodes[0].children.length)throw Error('Не найден единственный валидный db-store');
 return db.parseStore(nodes[0].textContent);
}
async function verifyFile(){
 const file=$('external').files[0];if(!file)throw Error('Выберите HTML или XML для внешней проверки');
 const c=context(),h=c.head||fieldHead(),raw=await containerText(file);if(!current(c))return;const other=readStoreFromDocument(raw);
 let external;
 try{external=await db.verifyDatabase(other,h);}catch(e){external={status:'failed',code:e.code||'ERROR',message:e.message};}
 if(!current(c))return;
 const changedIds=[],missingIds=[],addedIds=[],a=db.snapshot(c.store).records,b=db.snapshot(other).records;let shared=0;
 for(const [id,ct]of Object.entries(a)){if(!OWN(b,id))missingIds.push(id);else{shared++;if(b[id]!==ct)changedIds.push(id);}}
 for(const id of Object.keys(b))if(!OWN(a,id))addedIds.push(id);
 validationOutput({target:file.name,verifiedHead:h,external,sharedSlots:shared,missingIds,addedIds,changedIds,changedPhysicalSlots:changedIds.length,note:'missingIds отсутствуют во внешнем HTML; addedIds появились во внешнем HTML; changedIds имеют другой ciphertext при том же ID.'});
 notice('Внешняя проверка: удалены '+missingIds.length+', добавлены '+addedIds.length+', изменены '+changedIds.length,!!(missingIds.length||changedIds.length||external.status!=='complete'));
}
async function truncate(){
 if(!lastDiagnosis)throw Error('Сначала выполните проверку и получите диагноз разрыва');
 const recovery=$('recovery-head').value;
 if(!db.validHead(recovery))throw Error('Укажите корректные Recovery HEAD');
 const c=context(),diagnosis=lastDiagnosis;const result=await db.truncateInvalidTail(c.store,diagnosis,recovery);if(!current(c))return;await db.verifyDatabase(result.store,recovery);if(!current(c))return;
 const aliases=Object.entries(db.catalog(store)).filter(([_,h])=>db.sameHead(h,diagnosis.sourceHead)).map(([n])=>n);
 const message='Восстановление необратимо.\nСохранится повреждённый physical slot: '+result.keptInvalidSlot+'\nБудут удалены ID: '+JSON.stringify(result.deletedIds)+'\nПубличные записи будут перенаправлены на recovery head: '+aliases.join(', ')+'\nПодтвердить?';
 if(!confirm(message))return;
 for(const alias of aliases)db.publish(result.store,alias,recovery,diagnosis.sourceHead);
 requireCurrent(c);commitStage(result.store);await openHead(recovery,true);if(store!==c.store||rootHead!==recovery)return;validationOutput({status:'recovered',recoveryHead:recovery,deletedIds:result.deletedIds,keptInvalidSlot:result.keptInvalidSlot});
 notice('Восстановление выполнено. Сохраните новый HTML.');
}
async function publish(){needRoot();const c=context();const {chain}=await db.openDatabase(c.store,c.head);if(!current(c))return;const root=chain.state;const name=prompt('Имя публичной БД',publicName||root.name||'База');if(name===null)return;if(!validName(name))throw Error('Некорректное имя');const prev=db.catalog(store)[name];if(prev&&!db.sameHead(prev,rootHead)&&!confirm('Заменить опубликованный head «'+name+'»?'))return;requireCurrent(c);const tx=db.staging(c.store);db.publish(tx,name,c.head);commitStage(tx);publicName=name;syncCatalog();notice('Опубликована «'+name+'»');}
async function hideHead(){needRoot();if(!publicName||!OWN(db.catalog(store),publicName)){notice('Текущий head не опубликован');return;}if(!confirm('Скрыть «'+publicName+'»? Сохраните HEAD перед скрытием.'))return;const tx=db.staging(store);db.unpublish(tx,publicName);commitStage(tx);publicName=null;syncCatalog();notice('Публикация удалена. Для повторного открытия используйте HEAD.');}
async function copyText(t,label){const c=context();try{await navigator.clipboard.writeText(t);if(current(c))notice('Скопировано: '+label);}catch{if(current(c))prompt(label,t);}}
async function copyHead(){needRoot();await copyText(rootHead,'HEAD открытой версии');}
async function copyLink(){needRoot();await copyText(accessUrl(rootHead),'Ссылка доступа');}
async function loadHtml(file){if(!file)return;const c=context(),raw=await containerText(file);if(!current(c))return;const candidate=readStoreFromDocument(raw);assertFits(candidate);clearOpened();store=candidate;syncUrl(null);await openInitial(false);if(store===candidate&&!location.hash&&!$('status').classList.contains('error'))notice('Контейнер загружен. '+(rootHead?'БД открыта.':'Опубликованных БД: '+db.storeInfo(store).published));}
// Convert the pristine XHTML template to HTML, never the live application DOM.
function htmlSerialize(node){if(node.nodeType===3||node.nodeType===4)return node.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');if(node.nodeType===8)return '<!--'+node.data+'-->';if(node.nodeType!==1)return '';const tag=node.localName;const attrs=Array.from(node.attributes).filter(a=>a.name!=='xmlns').map(a=>' '+a.name+'="'+a.value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')+'"').join('');const start='<'+tag+attrs+'>';if(/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag))return start;const content=tag==='script'?node.textContent.replace(/<\/script/gi,'<\\/script'):tag==='style'?node.textContent:Array.from(node.childNodes).map(htmlSerialize).join('');return start+content+'</'+tag+'>';}
function exportDocument(data,asXML=XML_CONTAINER){
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
 const data=db.snapshot(store);if(publishSite)data.publicHeads={};
 const asXML=XML_CONTAINER&&!publishSite,output=exportDocument(data,asXML),extension=asXML?'xml':'html';
 const mime=asXML?'application/xml':'text/html';
 const blob=new Blob([output],{type:mime+';charset=utf-8'});checkSize(blob.size);
 const url=URL.createObjectURL(blob);
 const a=makeElement('a');a.href=url;a.download=publishSite?'index.html':'html_dbms_4_saved.'+extension;
 document.querySelector('body').appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 notice('Новый '+extension.toUpperCase()+'-файл скачан. Исходный файл на диске не перезаписывается.');
}
async function init(){
 const node=$('db-store'),candidate=db.parseStore(node.textContent);
 // Adopt once, then discard the original ciphertext before cloning the pristine shell.
 node.textContent='';exportTemplate=document.documentElement.cloneNode(true);
 const envelope=asXML=>new Blob([exportDocument({},asXML)]).size-2;
 templateBytes=XML_CONTAINER?Math.max(envelope(true),envelope(false)):envelope(false);
 assertFits(candidate);store=candidate;await openInitial();
}
window.addEventListener('hashchange',()=>{if(store)openInitial().catch(err);});
$('new-db').onclick=()=>run(createDatabase);
$('databases').onchange=()=>selectAlias($('databases').value);
$('open-head').onclick=()=>run(openFields);
$('save').onclick=()=>run(save);
$('info-toggle').onclick=()=>togglePanel('info');
$('validation-toggle').onclick=()=>togglePanel('validation');
$('debug-toggle').onclick=()=>run(async()=>{if(togglePanel('debug'))await showDebug();});
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
