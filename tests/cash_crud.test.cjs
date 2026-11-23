'use strict';
/** Integration without shims: real WebCrypto, generic JSON chains and CAS root refs. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const db=require(path.resolve(__dirname,'../src/core-node.cjs'));
async function main(){
 const html=fs.readFileSync(path.resolve(__dirname,'../dist/html_dbms_cash_demo.html'),'utf8');
 const match=html.match(/<script id="db-store" type="application\/json">([\s\S]*?)<\/script>/);
 assert.ok(match,'encrypted store is embedded');
 const store=db.adoptStore(JSON.parse(match[1]));
 const original=db.catalog(store)['Касса'];
 const originalRoot=await db.load(store,original);
 assert.equal(Object.keys(originalRoot.state.$refs).length,11);
 const earlier=(await db.load(store,originalRoot.state.$refs.participants)).state;
 const firstId=earlier.order[0],beforeName=earlier.entries[firstId].name;
 // Create a user-defined dictionary as a child of the current root.
 const created=await db.createDocument(store,original,'projects',{sourceSheet:'Проекты',alias:'projects',entries:{},order:[]});
 db.commit(store,created.store);db.publish(store,'Касса',created.rootHead,original);
 const child=await db.load(store,created.documentHead);
 assert.deepEqual(child.genesis.parent,original,'genesis cause must be parent root head');
 assert.equal((await db.verifyDatabase(store,created.rootHead)).checks.documents,12);
 // New row: stable ID used from now on; no modification to old catalog row.
 const ops=[{op:'add',path:'/entries/projects-0001',value:{id:'projects-0001',name:'Проект А',extra:['тест']}},{op:'add',path:'/order/-',value:'projects-0001'}];
 const add=await db.patchDocument(store,created.rootHead,'projects',ops);db.commit(store,add.store);db.publish(store,'Касса',add.rootHead,created.rootHead);
 assert.deepEqual((await db.load(store,add.documentHead)).state.order,['projects-0001']);
 assert.ok(!('excelRow' in (await db.load(store,add.documentHead)).state.entries['projects-0001']));
 // Edit record without changing identity.
 const update=await db.patchDocument(store,add.rootHead,'projects',[{op:'replace',path:'/entries/projects-0001/name',value:'Проект Б'}]);db.commit(store,update.store);db.publish(store,'Касса',update.rootHead,add.rootHead);
 const updated=(await db.load(store,update.documentHead)).state;
 assert.equal(updated.entries['projects-0001'].name,'Проект Б');
 assert.equal(updated.order[0],'projects-0001');
 // Rename an imported participant: its ID, transaction references and analytics remain intact.
 const renamed=await db.patchDocument(store,update.rootHead,'participants',[{op:'replace',path:'/entries/'+firstId+'/name',value:'Участник_ПЕРЕИМЕНОВАН'}]);db.commit(store,renamed.store);db.publish(store,'Касса',renamed.rootHead,update.rootHead);
 const endRoot=(await db.load(store,renamed.rootHead)).state;
 const participants=(await db.load(store,endRoot.$refs.participants)).state;
 assert.equal(participants.entries[firstId].name,'Участник_ПЕРЕИМЕНОВАН');
 const rows=(await db.load(store,endRoot.$refs.transactions)).state.rows;
 assert.ok(rows.some(row=>row.fromId===firstId||row.toId===firstId));
 assert.equal(rows.length,1641);
 assert.equal((await db.load(store,originalRoot.state.$refs.participants)).state.entries[firstId].name,beforeName,'historical snapshot preserved');
 const verified=await db.verifyDatabase(store,renamed.rootHead);
 assert.equal(verified.status,'complete');
 assert.equal(verified.checks.documents,12);
 console.log('CASH REAL CRYPTO CRUD PASS: 12 reference chains, create dictionary, insert/edit and stable historical IDs');
}
main().catch(e=>{console.error(e);process.exitCode=1});
