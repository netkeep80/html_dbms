'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const db=require('../src/core-node.cjs'),{audit,build,storeFromHtml}=require('../examples/cash/build-pages.cjs'),{syntheticFixture}=require('../examples/cash/synthetic-pages.cjs');
function withStore(html,store){return html.replace(/(<script id="db-store" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(store).replace(/</g,'\\u003c')+b);}
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hdbms-pages-test-'));
 try{
  const output=path.join(tmp,'index.html'),summary=await build(output),html=fs.readFileSync(output,'utf8');
  assert.equal(summary.rows,720);assert.equal(summary.documents,11);assert.equal(summary.records,23);
  assert.deepEqual(syntheticFixture(),syntheticFixture());
  const s=storeFromHtml(html),h=s.publicHeads['Касса'];
  // Extra valid ciphertext, even if not advertised, must fail the public audit.
  const hidden=await db.createDatabase(s,'PRIVATE_SENTINEL',{visible:false});
  await assert.rejects(audit(withStore(html,hidden.store)));
  const root=await db.load(s,h);
  // A change followed by removal must fail even if the final value is unchanged.
  const first=await db.append(s,h,[{op:'add',path:'/private',value:'PRIVATE_SENTINEL'}]);
  const second=await db.append(s,first.head,[{op:'remove',path:'/private'}]);
  db.publish(s,'Касса',second.head,h);await assert.rejects(audit(withStore(html,s)));
  const damaged=storeFromHtml(html);const id=db.unpackHead(root.state.$refs.transactions).id;
  damaged.records[id]=(damaged.records[id][0]==='A'?'B':'A')+damaged.records[id].slice(1);
  await assert.rejects(audit(withStore(html,damaged)));
  console.log('PAGES DATA ACCEPTANCE PASS: fresh deterministic fixture, every genesis/patch, orphan rejection, reverted-history rejection, corruption rejection');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
