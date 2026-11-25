'use strict';
/** Isolated native-crypto fixture for full iframe->RPC->core acceptance. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),root=path.resolve(__dirname,'..');
const db=require(path.join(root,'src/core-node.cjs'));
const {createModel,SHEETS,loadFixture}=require(path.join(root,'examples/cash/import-model.cjs'));
(async()=>{
 const f=loadFixture(path.join(root,'tests/fixtures/cash_excel_extracted.json'));
 const {transactions,catalogs}=createModel(f);
 // Browser RPC fixture keeps every dictionary but only 20 cash rows. Full 1641-row parity is tested independently.
 transactions.rows=transactions.rows.slice(0,20);
 const entry=fs.readFileSync(path.join(root,'examples/cash/cash-entry.js'),'utf8');
 const s=db.newStore();const g=await db.createDatabase(s,'Касса',{entry:{type:'application/javascript',export:'main',source:entry},visible:true});db.commit(s,g.store);
 let h=g.rootHead;
 for(const [alias,d] of [['transactions',transactions],...SHEETS.map(([a])=>[a,catalogs[a]])]){const t=await db.createDocument(s,h,alias,d);db.commit(s,t.store);h=t.rootHead;}
 db.publish(s,'Касса',h,g.rootHead);
 let html=fs.readFileSync(path.join(root,'dist/html_dbms_cash_demo.html'),'utf8');
 html=html.replace(/<script id="db-store" type="application\/json">[\s\S]*?<\/script>/,'<script id="db-store" type="application/json">'+JSON.stringify(db.snapshot(s))+'</script>');
 const output=process.argv[2]||path.join(fs.mkdtempSync(path.join(os.tmpdir(),'cash-rpc-')),'cash.html');
 fs.writeFileSync(output,html,{flag:'wx'});
 console.log('Native crypto UI integration fixture ready:',db.storeInfo(s).count,output);
})().catch(e=>{console.error(e);process.exit(1)});
