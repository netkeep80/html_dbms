'use strict';
/** Pure import stage. Runtime documents only contain source records and stable dictionary IDs. */
const SHEETS=Object.freeze([
 ['entityTypes','Типы Сущностей','et'],
 ['other','Прочие','ot'],
 ['transactionTypes','Типы Транзакций','tt'],
 ['participants','Участники','pa'],
 ['suppliers','Поставщики','su'],
 ['buyers','Покупатели','bu'],
 ['agencies','Госструктуры','ag'],
 ['tenants','Арендаторы','te'],
 ['funds','Фонды','fu'],
 ['service','Служебный','sv']
]);
const TYPE_DOCUMENTS=Object.freeze({'Участник':'participants','Поставщик':'suppliers','Покупатель':'buyers','Госструктура':'agencies','Арендатор':'tenants','Фонд':'funds','Прочее':'other'});
const fold=value=>String(value??'').trim().toLocaleLowerCase('ru-RU');
function dictDoc(sheet, alias, prefix, rows){
 const entries={}, order=[], seen=new Map();
 for(let i=1;i<rows.length;i++){
  const cells=rows[i];if(!cells||!cells[0]||!String(cells[0]).trim())continue;
  const name=String(cells[0]).trim(), norm=fold(name);
  if(seen.has(norm))throw Error(`Duplicate normalized name in ${sheet}: ${name}`);
  const id=prefix+'-'+String(i).padStart(4,'0');seen.set(norm,id);
  const extra=cells.slice(1);
  entries[id]={id,name,excelRow:i+1,...(extra.some(x=>x!==null&&x!=='')?{extra}: {})};order.push(id);
 }
 return {sourceSheet:sheet,alias,entries,order};
}
function createModel(f){
 const catalogs={}, normalized={};
 for(const [alias,sheet,prefix] of SHEETS){
  const doc=dictDoc(sheet,alias,prefix,f.dictionaries[sheet]);catalogs[alias]=doc;
  normalized[alias]=new Map(doc.order.map(id=>[fold(doc.entries[id].name),id]));
 }
 function lookup(alias,value){
  const id=normalized[alias]?.get(fold(value));
  if(!id)throw Error(`Unmapped reference ${alias}: ${JSON.stringify(value)}`);
  return id;
 }
 const variants={};
 const rows=f.entries.map(row=>{
  const toTypeId=lookup('entityTypes',row.toType),fromTypeId=lookup('entityTypes',row.fromType);
  const toAlias=TYPE_DOCUMENTS[catalogs.entityTypes.entries[toTypeId].name];
  const fromAlias=TYPE_DOCUMENTS[catalogs.entityTypes.entries[fromTypeId].name];
  if(!toAlias||!fromAlias)throw Error('Unknown entity type in source');
  const typeId=lookup('transactionTypes',row.type);
  const canonical=catalogs.transactionTypes.entries[typeId].name;
  if(row.type!==canonical){variants[row.type]=(variants[row.type]||0)+1;}
  return {excelRow:row.excelRow,n:row.n,date:row.date,toTypeId,toId:lookup(toAlias,row.to),typeId,fromTypeId,fromId:lookup(fromAlias,row.from),amount:row.amount,note:row.note,dd:row.dd,plan:row.plan};
 });
 const transactions={sourceSheet:'Транзакции',headers:f.headers,period:f.period,rows,source:{file:f.sourceFile,sha256:f.sourceSha256,excelSheets:f.sheetNames.length,sourceRows:rows.length,caseVariants:variants}};
 return {transactions,catalogs,typeDocuments:TYPE_DOCUMENTS};
}
module.exports={SHEETS,TYPE_DOCUMENTS,createModel,fold};