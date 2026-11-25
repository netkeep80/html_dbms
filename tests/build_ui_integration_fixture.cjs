'use strict';
/** Test-only crypto shim: exercises full iframe->RPC->core state machine, NOT crypto security. */
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const subtle={
 async digest(_algorithm,data){const bytes=new Uint8Array(data),out=new Uint8Array(32);for(let k=0;k<8;k++){let a=(2166136261^(k*0x9e3779b1))>>>0;for(const b of bytes){a=Math.imul(a^(b+k),16777619)>>>0;a^=a>>>13;}for(let j=0;j<4;j++)out[k*4+j]=(a>>>(8*j))&255;}return out.buffer;},
 async importKey(_kind,key){return new Uint8Array(key);},
 async encrypt(_opts,key,buffer){const data=new Uint8Array(buffer),out=new Uint8Array(data.length+16);out.set(data);out.set(key.slice(0,16),data.length);return out.buffer;},
 async decrypt(_opts,key,buffer){const data=new Uint8Array(buffer);if(data.length<16||Array.from(data.slice(-16)).some((x,i)=>x!==key[i]))throw Error('bad tag');return data.slice(0,-16).buffer;}
};
Object.defineProperty(globalThis,'crypto',{value:{subtle},configurable:true});
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
 fs.writeFileSync(process.argv[2]||path.join(root,'dist/ui_test_crypto_shim_fixture.html'),html);
 console.log('Fake crypto UI integration fixture ready:',db.storeInfo(s).count);
})().catch(e=>{console.error(e);process.exit(1)});
