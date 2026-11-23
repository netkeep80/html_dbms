/* HTML_DBMS/3 Demo Cash — data in independent JSON chains, views are computed. */
export const SOURCE_CATALOGS = Object.freeze([
 ['entityTypes','Типы Сущностей'],['other','Прочие'],['transactionTypes','Типы Транзакций'],
 ['participants','Участники'],['suppliers','Поставщики'],['buyers','Покупатели'],
 ['agencies','Госструктуры'],['tenants','Арендаторы'],['funds','Фонды'],['service','Служебный']
]);
export const TYPE_DOCUMENTS=Object.freeze({'Участник':'participants','Поставщик':'suppliers','Покупатель':'buyers','Госструктура':'agencies','Арендатор':'tenants','Фонд':'funds','Прочее':'other'});
export const REPORTS=[
 {tab:'Операции(ТипСущности)',selectorAlias:'entityTypes',mode:'entityType',default:'Фонд'},
 {tab:'Операции(Фонд)',selectorAlias:'funds',mode:'entity',default:'Фонд_F011'},
 {tab:'Операции(Участник)',selectorAlias:'participants',mode:'entity',default:'Участник_A003'},
 {tab:'Операции(Поставщик)',selectorAlias:'suppliers',mode:'entity',default:'Поставщик_B012'},
 {tab:'Операции(Госструктуры)',selectorAlias:'agencies',mode:'entity',default:'Организация_C001'},
 {tab:'Участники(Фонд)',selectorAlias:'funds',mode:'participants',default:'Фонд_F002'}
];
export const norm=x=>String(x??'').trim().toLocaleLowerCase('ru-RU');
export const dateFromExcel=n=>new Date(Date.UTC(1899,11,30)+Number(n)*86400000).toISOString().slice(0,10);
export const dateToExcel=iso=>Math.round((Date.parse(iso+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000);
export function idByLabel(doc,label){return (doc?.order||[]).find(id=>norm(doc.entries[id].name)===norm(label))||null;}
export const labelById=(doc,id)=>doc?.entries?.[id]?.name??'⚠ '+String(id);
export function validateReferences(rows,documents){
 const errors=[];
 for(const [index,r] of rows.entries()){
  for(const [field,alias] of [['toTypeId','entityTypes'],['fromTypeId','entityTypes'],['typeId','transactionTypes']]){
   if(!documents[alias]?.entries?.[r[field]])errors.push(`Строка ${index}: ${field}=${r[field]}`);
  }
  for(const side of ['to','from']){
   const ty=documents.entityTypes?.entries?.[r[side+'TypeId']]?.name;
   const alias=TYPE_DOCUMENTS[ty];
   if(!alias||!documents[alias]?.entries?.[r[side+'Id']])errors.push(`Строка ${index}: ${side}Id=${r[side+'Id']}`);
  }
 }
 return errors;
}
/** Excel SUMIFS parity: values matched by normalized canonical lookup IDs, not display strings. */
export function calculateReport(rows,report,selectorId,categoryIds,period,documents){
 const participantId=idByLabel(documents.entityTypes,'Участник');
 const data=[];let incoming=0,outgoing=0;
 for(const categoryId of categoryIds){let i=0,o=0;
  for(const row of rows){
   if(row.date<period.fromSerial||row.date>period.toSerial||norm(row.dd)!=='да')continue;
   const amount=Number(row.amount)||0;
   if(report.mode==='participants'){
    if(row.toId===selectorId&&row.fromId===categoryId&&row.fromTypeId===participantId)i+=amount;
    if(row.fromId===selectorId&&row.toId===categoryId&&row.toTypeId===participantId)o+=amount;
   }else if(row.typeId===categoryId){
    if(report.mode==='entityType'){
     if(row.toTypeId===selectorId)i+=amount;
     if(row.fromTypeId===selectorId)o+=amount;
    }else{
     if(row.toId===selectorId)i+=amount;
     if(row.fromId===selectorId)o+=amount;
    }
   }
  }
  data.push({id:categoryId,incoming:i,outgoing:o,balance:i-o});
  // Known source workbook defect: 32nd visible transaction category excluded from five SUM ranges.
  if(report.mode==='participants'||data.length<=31){incoming+=i;outgoing+=o;}
 }
 return {rows:data,incoming,outgoing,balance:incoming-outgoing};
}
export function describeTransaction(row,docs){
 const toType=labelById(docs.entityTypes,row.toTypeId),fromType=labelById(docs.entityTypes,row.fromTypeId);
 return {...row,toType,to:labelById(docs[TYPE_DOCUMENTS[toType]],row.toId),type:labelById(docs.transactionTypes,row.typeId),fromType,from:labelById(docs[TYPE_DOCUMENTS[fromType]],row.fromId)};
}
export async function main(db,mount){
 const style=document.createElement('style');style.textContent=`
 :root{font:14px/1.45 system-ui,Segoe UI,sans-serif;color:#20344b;background:#e3edf6;color-scheme:light}
 *{box-sizing:border-box}body{margin:0;background:#dce9f4;color:#20344b}
 button,select,input,textarea{font:inherit;max-width:100%;border:1px solid #91a9bf;background:white;color:#172b3d;border-radius:4px;padding:6px 9px}
 button{cursor:pointer}button:hover{background:#e1edf8}button.active{background:#286993;border-color:#286993;color:white}
 button.primary{background:#177365;border-color:#177365;color:#fff}button.primary:hover{background:#0c594e}
 button:disabled{opacity:.55;cursor:not-allowed}.cash-wrap{max-width:1700px;margin:auto;padding:10px 12px}
 .banner{display:flex;align-items:center;justify-content:space-between;gap:15px;background:#f5f9fc;border:1px solid #9bb4c8;padding:10px 13px;border-radius:6px}
 h1{margin:0;font-size:19px}h2{font-size:16px}.meta{color:#587086;font-size:12px}
 .tabs{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}.tabs button{font-size:12px;padding:6px 8px}
 .sheet{border:1px solid #aac0d2;background:#eef4fa;border-radius:7px;padding:10px;min-height:350px}
 .controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:7px 0}.controls label{font-size:12px;display:flex;align-items:center;gap:6px}
 .gridbox{overflow:auto;border:1px solid #adbdc9;background:#fff;max-height:64vh}
 table{border-collapse:collapse}.ledger{width:max-content;min-width:100%;font-size:12px}
 .ledger th{background:#d8e7f4;border:1px solid #a8bfd2;padding:7px;white-space:nowrap;position:sticky;top:0;z-index:1}
 .ledger td{border:1px solid #d4e0e9;padding:6px;white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
 .ledger tbody tr:nth-child(even){background:#f5f9fc}.ledger tbody tr:hover{background:#e7f4ff}
 .num{text-align:right;font-variant-numeric:tabular-nums}
 .summary{display:flex;flex-wrap:wrap;gap:10px;padding:7px 0}.metric{background:#fff;border:1px solid #a3bccc;border-radius:6px;padding:7px 11px;min-width:145px}.metric strong{display:block;font-size:17px}
 .report{max-width:900px;margin:8px auto}.report table{width:100%;background:#f2f2f2}
 .report th,.report td{border:1px solid #7f8a91;padding:5px 9px}.report .label-col{background:#eee;text-align:left;font-weight:600}
 .report .income{background:#c8eecf;color:#0c621e;text-align:right}.report .expense{background:#ffdade;color:#901c2c;text-align:right}
 .report .balance{background:#f4f4f4;text-align:right}.report .total td{font-weight:800;border:2px solid #2c343b}
 .form{background:#f8fcff;border:1px solid #9db9ce;border-radius:5px;padding:13px;margin:10px 0}
 .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px}.form-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px}.form-grid input,.form-grid select{width:100%}
 .form textarea{width:100%;min-height:68px}.pager{display:flex;justify-content:space-between;gap:7px;flex-wrap:wrap;padding:10px 0}
 .dict-nav{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px}.error{color:#a61728}.good{color:#17683b}.view-note{font-size:12px;color:#5e7081;margin:9px 0}
 `;document.head.appendChild(style);
 mount.innerHTML=`<div class="cash-wrap"><div class="banner"><div><h1>Касса · HTML DBMS</h1><span class="meta">Данные — независимые JSON-документы; отчёты — вычисляемые view</span></div><span class="meta" id="cash-count">Загрузка…</span></div><nav id="cash-tabs" class="tabs"></nav><section id="cash-content" class="sheet"></section><p id="cash-msg" class="meta" role="status"></p></div>`;
 const $=id=>document.getElementById(id);
 let tx=await db.read('transactions/'),docs={};for(const [alias] of SOURCE_CATALOGS)docs[alias]=await db.read(alias+'/');
 const refs=validateReferences(tx.rows,docs);if(refs.length)throw Error('Ошибка ссылок: '+refs.slice(0,3).join('; '));
 let tab='Транзакции',dictionaryTab='funds',page=0,pageSize=80,showCreate=false;
 let from=tx.period.fromSerial,to=tx.period.toSerial,mode='По периоду',search='',plan='Все';
 const chosen={};for(const r of REPORTS)chosen[r.tab]=idByLabel(docs[r.selectorAlias],r.default);
 const el=(type,text,cls)=>{const node=document.createElement(type);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
 const btn=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.addEventListener('click',()=>Promise.resolve(fn()).catch(e=>message(e.message,true)));return b;};
 const line=(text,control)=>{const l=el('label',text);l.appendChild(control);return l;};
 function dropdown(doc,selected,onchange){const s=el('select');for(const id of doc.order){const e=el('option',doc.entries[id].name);e.value=id;s.appendChild(e);}if(selected&&doc.entries[selected])s.value=selected;s.addEventListener('change',()=>onchange(s.value));return s;}
 function choose(values,selected,onchange){const s=el('select');for(const x of values){const o=el('option',x);o.value=x;s.appendChild(o);}s.value=selected;s.addEventListener('change',()=>onchange(s.value));return s;}
 const td=(tr,x,cl)=>{const cell=el('td',x,cl);tr.appendChild(cell);};const th=(tr,x,cl)=>{const cell=el('th',x,cl);tr.appendChild(cell);};
 const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
 const message=(s,bad=false)=>{$('cash-msg').textContent=s;$('cash-msg').className=bad?'error':'good';};
 const timeRange=()=>mode==='По периоду'?{fromSerial:from,toSerial:to}:{fromSerial:-Infinity,toSerial:to};
 function renderTabs(){const nav=$('cash-tabs');nav.replaceChildren();for(const name of ['Транзакции',...REPORTS.map(r=>r.tab),'Справочники'])nav.appendChild(btn(name,()=>{tab=name;page=0;render();},name===tab?'active':''));}
 function controlPeriod(host){const div=el('div',undefined,'controls');div.appendChild(line('Режим',choose(['По периоду','Нарастающий'],mode,x=>{mode=x;page=0;render();})));
  for(const [name,value,set] of [['С',from,x=>from=x],['По',to,x=>to=x]]){const inp=el('input');inp.type='date';inp.value=dateFromExcel(value);inp.addEventListener('change',()=>{if(!inp.value)return;set(dateToExcel(inp.value));page=0;render();});div.appendChild(line(name,inp));}
  host.appendChild(div);
 }
 function renderMetrics(host,inc,out,balance,n){const area=el('div',undefined,'summary');for(const [name,value] of [['Поступления',money(inc)],['Расходы',money(out)],['Остаток',money(balance)],['Транзакций',n]]){const box=el('div',undefined,'metric');box.appendChild(el('span',name));box.appendChild(el('strong',value));area.appendChild(box);}host.appendChild(area);}
 function visibleTransaction(r){const v=describeTransaction(r,docs);return [v.n,dateFromExcel(v.date),v.toType,v.to,v.type,v.fromType,v.from,v.amount,v.note,v.dd,v.plan];}
 function transactionForm(host){const box=el('section',undefined,'form');box.appendChild(el('h2','Добавить транзакцию'));const form=el('form'),grid=el('div',undefined,'form-grid');const fields={};
  const input=(key,title,type,value)=>{const i=el('input');i.type=type;i.name=key;i.value=value;if(type==='number')i.step='any';i.required=true;grid.appendChild(line(title,i));fields[key]=i;return i;};
  input('date','Дата','date',dateFromExcel(to));input('amount','Числовое значение','number','0');
  const selectField=(key,title,doc,id,onchange)=>{const s=dropdown(doc,id,onchange||(()=>{}));s.name=key;s.required=true;grid.appendChild(line(title,s));fields[key]=s;return s;};
  const toType=selectField('toTypeId','Тип реципиента',docs.entityTypes,idByLabel(docs.entityTypes,'Фонд'));
  const toAlias=()=>TYPE_DOCUMENTS[labelById(docs.entityTypes,toType.value)];
  const recipient=selectField('toId','Реципиент',docs[toAlias()],docs[toAlias()].order[0]);
  const transactionType=selectField('typeId','Тип операции',docs.transactionTypes,idByLabel(docs.transactionTypes,'Нал'));
  const fromType=selectField('fromTypeId','Тип источника',docs.entityTypes,idByLabel(docs.entityTypes,'Участник'));
  const fromAlias=()=>TYPE_DOCUMENTS[labelById(docs.entityTypes,fromType.value)];
  const source=selectField('fromId','Источник',docs[fromAlias()],docs[fromAlias()].order[0]);
  function reloadEntity(selectElement,alias){const fresh=dropdown(docs[alias],docs[alias].order[0],()=>{});selectElement.replaceChildren(...Array.from(fresh.children));selectElement.value=fresh.value;}
  toType.addEventListener('change',()=>reloadEntity(recipient,toAlias()));fromType.addEventListener('change',()=>reloadEntity(source,fromAlias()));
  selectField('plan','План / факт',{order:['-','План','Факт'],entries:{'-':{name:'-'},'План':{name:'План'},'Факт':{name:'Факт'}}},'-');
  selectField('dd','ДД',{order:['Да','Нет'],entries:{'Да':{name:'Да'},'Нет':{name:'Нет'}}},'Да');
  form.appendChild(grid);const note=el('textarea');note.placeholder='Текстовое значение (примечание)';form.appendChild(line('Примечание',note));
  const buttons=el('div',undefined,'controls');const submit=el('button','Записать транзакцию','primary');submit.type='submit';buttons.appendChild(submit);buttons.appendChild(btn('Отмена',()=>{showCreate=false;render();}));form.appendChild(buttons);
  form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;
   try{
    const amount=Number(fields.amount.value);if(!Number.isFinite(amount))throw Error('Сумма должна быть конечным числом');
    const row={excelRow:null,n:Math.max(0,...tx.rows.map(r=>Number(r.n)||0))+1,date:dateToExcel(fields.date.value),toTypeId:fields.toTypeId.value,toId:fields.toId.value,typeId:fields.typeId.value,fromTypeId:fields.fromTypeId.value,fromId:fields.fromId.value,amount,note:note.value,dd:fields.dd.value,plan:fields.plan.value};
    const errors=validateReferences([row],docs);if(errors.length)throw Error(errors[0]);
    await db.patch('transactions',[{op:'add',path:'/rows/-',value:row}]);tx=await db.read('transactions/');showCreate=false;page=Math.floor((tx.rows.length-1)/pageSize);await render();message('Транзакция добавлена. Сохраните HTML кнопкой в системной панели.');
   }catch(error){message(error.message,true);}finally{submit.disabled=false;}
  });box.appendChild(form);host.appendChild(box);
 }
 function renderTransactions(host){controlPeriod(host);const ctrl=el('div',undefined,'controls');const q=el('input');q.placeholder='Поиск в транзакциях';q.value=search;q.style.width='300px';q.addEventListener('change',()=>{search=q.value;page=0;render();});ctrl.appendChild(q);
  ctrl.appendChild(line('План/факт',choose(['Все','-','План','Факт'],plan,v=>{plan=v;page=0;render();})));ctrl.appendChild(btn(showCreate?'Скрыть форму':'+ Транзакция',()=>{showCreate=!showCreate;render();},'primary'));host.appendChild(ctrl);if(showCreate)transactionForm(host);
  const period=timeRange(),needle=norm(search);
  const filtered=tx.rows.filter(r=>{if(r.date<period.fromSerial||r.date>period.toSerial)return false;if(plan!=='Все'&&r.plan!==plan)return false;if(!needle)return true;return norm(visibleTransaction(r).join(' ')).includes(needle);});
  const fund=idByLabel(docs.entityTypes,'Фонд');let inc=0,out=0;for(const r of filtered){if(r.toTypeId===fund)inc+=r.amount;if(r.fromTypeId===fund)out+=r.amount;}
  renderMetrics(host,inc,out,inc-out,filtered.length);const maxPage=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,maxPage-1);
  const pane=el('div',undefined,'gridbox'),table=el('table',undefined,'ledger'),head=el('thead'),hr=el('tr');
  for(const name of tx.headers.slice(0,11))th(hr,name);head.appendChild(hr);table.appendChild(head);const body=el('tbody');
  for(const r of filtered.slice(page*pageSize,(page+1)*pageSize)){const tr=el('tr');visibleTransaction(r).forEach((v,i)=>td(tr,v??'',i===7?'num':''));body.appendChild(tr);}table.appendChild(body);pane.appendChild(table);host.appendChild(pane);
  const pg=el('div',undefined,'pager');pg.appendChild(el('span',`Строки ${filtered.length?page*pageSize+1:0}–${Math.min(filtered.length,(page+1)*pageSize)} из ${filtered.length}`));
  const controls=el('div');controls.appendChild(btn('◀ Назад',()=>{page=Math.max(0,page-1);render();}));controls.appendChild(el('span',` ${page+1}/${maxPage} `));controls.appendChild(btn('Вперёд ▶',()=>{page=Math.min(maxPage-1,page+1);render();}));pg.appendChild(controls);host.appendChild(pg);
 }
 function renderReport(host,report){const selectorDoc=docs[report.selectorAlias];const control=el('div',undefined,'controls');control.appendChild(line('Субъект',dropdown(selectorDoc,chosen[report.tab],id=>{chosen[report.tab]=id;render();})));host.appendChild(control);controlPeriod(host);
  const catDoc=report.mode==='participants'?docs.participants:docs.transactionTypes;
  const totals=calculateReport(tx.rows,report,chosen[report.tab],catDoc.order,timeRange(),docs);
  const area=el('div',undefined,'report');area.appendChild(el('h2',report.tab+' · '+labelById(selectorDoc,chosen[report.tab])));
  const t=el('table'),h=el('thead'),hr=el('tr');for(const [n,c] of [['Категория','label-col'],['Поступления','income'],['Расходы','expense'],['Остаток','balance']])th(hr,n,c);h.appendChild(hr);t.appendChild(h);const body=el('tbody'),tr=el('tr',undefined,'total');
  for(const [v,c] of [['ИТОГО','label-col'],[money(totals.incoming),'income'],[money(totals.outgoing),'expense'],[money(totals.balance),'balance']])td(tr,v,c);body.appendChild(tr);
  for(const r of totals.rows){const row=el('tr');td(row,labelById(catDoc,r.id),'label-col');td(row,money(r.incoming),'income');td(row,money(r.outgoing),'expense');td(row,money(r.balance),'balance');body.appendChild(row);}t.appendChild(body);area.appendChild(t);host.appendChild(area);
  host.appendChild(el('p',report.mode==='participants'?'View: суммы взносов участников по выбранному фонду и периоду.':'View: пересчёт из транзакций по ID источников, реципиентов и категорий. В исходном Excel пять итогов исключают последнюю видимую категорию — сохранено для идентичности отчёта.','view-note'));
 }
 function renderDictionaries(host){const nav=el('nav',undefined,'dict-nav');for(const [alias,title] of SOURCE_CATALOGS)nav.appendChild(btn(title,()=>{dictionaryTab=alias;render();},dictionaryTab===alias?'active':''));host.appendChild(nav);
  const doc=docs[dictionaryTab];host.appendChild(el('h2',doc.sourceSheet+' · '+doc.order.length+' записей'));const pane=el('div',undefined,'gridbox'),t=el('table',undefined,'ledger'),h=el('thead'),tr=el('tr');for(const col of ['ID','Название','Дополнительные сведения','Строка Excel'])th(tr,col);h.appendChild(tr);t.appendChild(h);const body=el('tbody');
  for(const id of doc.order){const row=doc.entries[id],r=el('tr');for(const v of [id,row.name,(row.extra||[]).filter(v=>v!==null&&v!=='').join(' · '),row.excelRow])td(r,v);body.appendChild(r);}t.appendChild(body);pane.appendChild(t);host.appendChild(pane);
 }
 async function render(){renderTabs();$('cash-count').textContent=`${tx.rows.length.toLocaleString('ru-RU')} операций · ${SOURCE_CATALOGS.length} справочников · 6 views`;
  const content=$('cash-content');content.replaceChildren();if(tab==='Транзакции')renderTransactions(content);else if(tab==='Справочники')renderDictionaries(content);else renderReport(content,REPORTS.find(r=>r.tab===tab));
 }
 await render();message('Данные восстановлены из JSON-цепочек. Справочные значения связаны по ID.');
}