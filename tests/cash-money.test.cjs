'use strict';
const assert=require('node:assert/strict');
const {parseMinor,minorAmount,validateMoneyRows,formatMinor,calculateLedger,calculateReport}=require('../examples/cash/cash-entry.js');
const {sourceAmountMinor}=require('../examples/cash/import-model.cjs');
for(const [text,n] of [['0.1',10],['0,29',29],['-0.01',-1],['-0',0],[' 000.20 ',20],['90071992547409.91',Number.MAX_SAFE_INTEGER],['-90071992547409.91',-Number.MAX_SAFE_INTEGER]]){
 assert.equal(parseMinor(text),n);assert.ok(!Object.is(parseMinor(text),-0));
}
for(const x of ['', ' ', '1.005','1e2','Infinity','NaN','+1','1,2.3','1 000','1.','90071992547409.92','-90071992547409.92',null,0.1])assert.throws(()=>parseMinor(x));
assert.equal(sourceAmountMinor(123),12300);assert.equal(sourceAmountMinor('0.29'),29);assert.throws(()=>sourceAmountMinor(.29));
assert.equal(formatMinor(10n+20n),'0,30 ₽');assert.equal(formatMinor(-1n),'-0,01 ₽');
assert.equal(formatMinor(9007199254740991n*2n),'180\u00a0143\u00a0985\u00a0094\u00a0819,82 ₽');
for(const row of [{},{amount:0},{amount:1,amountMinor:100},{amountMinor:'1'},{amountMinor:NaN},{amountMinor:Infinity},{amountMinor:1.005},{amountMinor:9007199254740992},{amountMinor:-0}])assert.throws(()=>minorAmount(row));
const ids=Array.from({length:33},(_,i)=>'c'+i),catalog=order=>({order,entries:Object.fromEntries(order.map(id=>[id,{name:id}]))});
const docs={transactionTypes:catalog(ids),participants:catalog(['p']),entityTypes:{order:['f','pType'],entries:{f:{name:'Фонд',documentAlias:'funds'},pType:{name:'Участник',documentAlias:'participants'}}}};
const row=(amountMinor,typeId,toTypeId='f',fromTypeId='pType',extra={})=>({amountMinor,typeId,toTypeId,fromTypeId,toId:toTypeId==='f'?'fund':'p',fromId:fromTypeId==='f'?'fund':'p',dd:'Да',date:1,...extra});
const max=Number.MAX_SAFE_INTEGER;
const rows=[row(max,ids[0]),row(max,ids[31]),row(max,ids[0],'pType','f'),row(max-1,ids[32],'pType','f'),row(20,ids[32]),row(-20,ids[32]),row(100,ids[32],'f','f'),row(5,ids[0],'f','pType',{dd:'Нет'}),row(8,ids[0],'f','pType',{date:2})];
const period={fromSerial:1,toSerial:1},r={mode:'entityType'};
const t=calculateReport(rows,r,'f',ids,period,docs);
assert.equal(t.incoming,2n*BigInt(max)+100n);assert.equal(t.outgoing,2n*BigInt(max)+99n);assert.equal(t.balance,1n);
assert.equal(t.rows[31].incoming,BigInt(max));assert.equal(t.rows[32].outgoing,BigInt(max-1)+100n);
assert.equal(t.rows.reduce((s,x)=>s+x.balance,0n),1n);
assert.equal(calculateReport(rows.slice().reverse(),r,'f',ids.slice().reverse(),period,docs).balance,1n);
assert.throws(()=>calculateReport(rows,r,'f',ids.slice(0,31),period,docs));
assert.throws(()=>calculateReport([...rows,{...row(0,ids[0], 'f','pType',{date:99}),amountMinor:null}],r,'f',ids,period,docs));
const ledger=calculateLedger(rows.filter(x=>x.date===1),'f');assert.equal(ledger.balance,6n);
assert.equal(calculateLedger(Array.from({length:10000},()=>row(1,ids[0])),'f').incoming,10000n);
validateMoneyRows(rows);
console.log('CASH MONEY PASS: strict decimal, canonical zero, safe storage, unbounded exact aggregates, 33 categories, signed self-transfer, invalid excluded row, ledger DD difference');
