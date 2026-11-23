'use strict';
// Public demonstration data: generated from constants, never from a workbook,
// existing database, ciphertext, private fixture, or real financial history.
const {createHash}=require('node:crypto');
const serial=(y,m,d)=>(Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000;
const numbered=(prefix,n)=>Array.from({length:n},(_,i)=>prefix+String(i+1).padStart(3,'0'));
function syntheticFixture(){
 const entities={'Участник':numbered('Участник_A',12),'Поставщик':numbered('Поставщик_B',14),'Покупатель':numbered('Покупатель_D',8),'Госструктура':numbered('Организация_C',3),'Арендатор':numbered('Арендатор_E',6),'Фонд':numbered('Фонд_F',12),'Прочее':numbered('Прочее_G',4)};
 const labels=['Учебный взнос','Демо-поставка','Демо-аренда','Учебный резерв','Расходники','Демо-транспорт','Демо-сервис','Учебная закупка','Демо-консультация','Учебный возврат','Демо-оборудование','Учебная компенсация'];
 const dict=values=>[['Название'],...values.map(x=>[x])];
 const dictionaries={'Типы Сущностей':dict(Object.keys(entities)),'Типы Транзакций':dict(labels),'Участники':dict(entities['Участник']),'Поставщики':dict(entities['Поставщик']),'Покупатели':dict(entities['Покупатель']),'Госструктуры':dict(entities['Госструктура']),'Арендаторы':dict(entities['Арендатор']),'Фонды':dict(entities['Фонд']),'Прочие':dict(entities['Прочее']),'Служебный':dict(['Учебные данные'])};
 let seed=0x41ca5526;
 function random(n){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n;}
 const choose=xs=>xs[random(xs.length)];
 const period={fromSerial:serial(2026,1,1),toSerial:serial(2026,12,31)};
 const types=Object.keys(entities).filter(x=>x!=='Фонд');
 const entries=Array.from({length:720},(_,i)=>{
  const incoming=i%3===0||i%7===0, counterparty=choose(types);
  const fromType=incoming?counterparty:'Фонд',toType=incoming?'Фонд':counterparty;
  const date=period.fromSerial+Math.floor(i*365/720);
  return {excelRow:null,n:i+1,date,toType,to:choose(entities[toType]),type:choose(labels),fromType,from:choose(entities[fromType]),amount:100+random(9900),note:'Учебная операция №'+String(i+1).padStart(4,'0'),dd:i%13===0?'Нет':'Да'};
 });
 const f={sourceFile:'synthetic-pages-v1',sheetNames:['Транзакции',...Object.keys(dictionaries)],headers:['№','Дата','Тип реципиента','Реципиент','Тип транзакции','Тип источника','Источник','Сумма','Примечание','ДД'],period,dictionaries,entries};
 return {...f,sourceSha256:createHash('sha256').update(JSON.stringify(f)).digest('hex')};
}
module.exports={syntheticFixture};
if(require.main===module)process.stdout.write(JSON.stringify(syntheticFixture()));
