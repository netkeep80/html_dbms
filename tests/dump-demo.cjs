'use strict';
/** Decrypt demo with current HTML_DBMS core; calculate reports using entry source (not fixture). */
const fs=require('node:fs'),path=require('node:path');
const db=require(path.resolve(__dirname,'../src/core-node.cjs'));
const uri=process.argv[2];if(!uri)throw Error('Provide demo HTML');
const html=fs.readFileSync(uri,'utf8'),m=html.match(/<script id="db-store" type="application\/json">([\s\S]*?)<\/script>/);
if(!m)throw Error('Embedded physical store missing');
(async()=>{
 const store=db.validateStore(JSON.parse(m[1])),head=store.publicHeads?.['Касса'];
 if(!head)throw Error('Published Касса not found');
 const root=(await db.load(store,head)).state;
 const transactions=(await db.load(store,root.$refs.transactions)).state,documents={};
 const mod=await import('data:text/javascript;base64,'+Buffer.from(root.entry.source).toString('base64'));
 for(const [alias] of mod.SOURCE_CATALOGS)documents[alias]=(await db.load(store,root.$refs[alias])).state;
 const refs=mod.validateReferences(transactions.rows,documents);
 if(refs.length)throw Error('Unresolved dictionary references: '+refs.slice(0,5));
 const reports={};
 for(const r of mod.REPORTS){
  const selectorId=mod.idByLabel(documents[r.selectorAlias],r.default);
  const cat=documents[r.mode==='participants'?'participants':'transactionTypes'];
  const summary=mod.calculateReport(transactions.rows,r,selectorId,cat.order,transactions.period,documents);
  reports[r.tab]={selector:r.default,selectorId,rows:summary.rows.map(x=>({...x,name:mod.labelById(cat,x.id)})),incoming:summary.incoming,outgoing:summary.outgoing,balance:summary.balance};
 }
 console.log(JSON.stringify({transactions,documents,reports,root,verification:(await db.verifyDatabase(store,head)).status,physicalRecords:Object.keys(store.records).length},(_,v)=>typeof v==='bigint'?v.toString():v));
})().catch(e=>{console.error(e);process.exitCode=1;});