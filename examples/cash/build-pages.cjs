'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const db=require('../../src/core.js'),{syntheticFixture}=require('./synthetic-pages.cjs'),{createModel,SHEETS}=require('./import-model.cjs');
const project=path.resolve(__dirname,'../..');
function storeFromHtml(html){
 const matches=[...html.matchAll(/<script id="db-store" type="application\/json">([\s\S]*?)<\/script>/g)];
 assert.equal(matches.length,1,'exactly one physical store');
 return db.validateStore(JSON.parse(matches[0][1]));
}
async function audit(html){
 const fixture=syntheticFixture(),{transactions,catalogs}=createModel(fixture),store=storeFromHtml(html);
 const entry={type:'application/javascript',export:'main',source:fs.readFileSync(path.join(__dirname,'cash-entry.js'),'utf8')};
 assert.equal(store.format,'HTML_DBMS/4');assert.deepEqual(Object.keys(store.publicHeads),['Касса']);
 const head=store.publicHeads['Касса'],root=await db.load(store,head);
 const expected=[['transactions',transactions],...SHEETS.map(([name])=>[name,catalogs[name]])];
 assert.deepEqual(root.genesis,{name:'Касса',parent:null,state:{name:'Касса',entry,$refs:{}}});
 assert.equal(root.events.length,expected.length+1,'unexpected root history');
 const ids=new Set(),refs={};
 for(const event of root.events)ids.add(db.unpackHead(event.head).id);
 for(let i=0;i<expected.length;i++){
  const [name,state]=expected[i],event=root.events[i+1],childHead=root.state.$refs[name],child=await db.load(store,childHead);
  assert.deepEqual(event.r.slice(1),[root.events[i].head,[{op:'add',path:'/$refs/'+db.escapePtr(name),value:childHead}]]);
  assert.equal(child.events.length,1,'unexpected child history');
  assert.deepEqual(child.genesis,{name,parent:root.events[i].head,state});
  assert.deepEqual(child.state,state);
  ids.add(db.unpackHead(childHead).id);refs[name]=childHead;
 }
 assert.deepEqual(root.state,{name:'Касса',entry,$refs:refs});
 assert.deepEqual(Object.keys(store.records).sort(),[...ids].sort(),'orphan or hidden physical record');
 assert.equal((await db.verifyDatabase(store,head)).status,'complete');
 return {sha256:fixture.sourceSha256,rows:transactions.rows.length,documents:expected.length,records:ids.size};
}
async function build(out){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hdbms-public-'));
 try{
  const fixture=path.join(tmp,'synthetic.json');fs.writeFileSync(fixture,JSON.stringify(syntheticFixture()));
  cp.execFileSync(process.execPath,[path.join(__dirname,'build-demo.cjs'),fixture,out],{stdio:'inherit'});
  let html=fs.readFileSync(out,'utf8');
  assert.ok(html.includes('<span class="version">4.0.0</span>'),'missing public demo label anchor');
  html=html.replace('<span class="version">4.0.0</span>','<span class="version">4.0.0 · Учебные синтетические данные · изменения только локальные</span>');
  html=html.replace('</head>','<link rel="icon" href="data:,"></head>');
  fs.writeFileSync(out,html);
  const summary=await audit(html);
  console.log('PUBLIC DATA AUDIT PASS',JSON.stringify(summary));
  return summary;
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
module.exports={audit,build,storeFromHtml};
if(require.main===module){
 const out=path.resolve(process.argv[2]||path.join(project,'dist','pages','index.html'));
 build(out).catch(e=>{console.error(e.message);process.exitCode=1;});
}
