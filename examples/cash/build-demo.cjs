'use strict';
/** Build the Cash example using only the generic v4 DBMS core and physical JSON store. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const project=path.resolve(__dirname,'../..');
const db=require(path.join(project,'src/core-node.cjs'));
const {createModel,SHEETS,loadFixture}=require('./import-model.cjs');
const fixturePath=process.argv[2]||path.join(project,'tests/fixtures/cash_excel_extracted.json');
const historical=path.join(project,'dist/html_dbms_cash_demo.html');
// Build new snapshots only; never silently replace an existing file (including a historical snapshot).
const output=process.argv[3]?path.resolve(process.argv[3]):path.join(fs.mkdtempSync(path.join(os.tmpdir(),'hdbms-cash-')),'cash.html');
async function main(){
 if(output===historical||fs.existsSync(output))throw Error('Output must be a new file; historical snapshots cannot be overwritten');
 const f=loadFixture(fixturePath);
 const {transactions,catalogs}=createModel(f);
 const appSource=fs.readFileSync(path.join(__dirname,'cash-entry.js'),'utf8');
 const store=db.newStore();
 const g=await db.createDatabase(store,'Касса',{entry:{type:'application/javascript',export:'main',source:appSource},visible:true});db.commit(store,g.store);
 let head=g.rootHead;
 for(const [alias,doc] of [['transactions',transactions],...SHEETS.map(([alias])=>[alias,catalogs[alias]])]){
   const r=await db.createDocument(store,head,alias,doc);db.commit(store,r.store);head=r.rootHead;
 }
 db.publish(store,'Касса',head,g.rootHead);
 let html=fs.readFileSync(path.join(project,'dist/html_dbms.html'),'utf8');
 const marker=/<script id="db-store" type="application\/json">[\s\S]*?<\/script>/;
 if(!marker.test(html))throw Error('Missing embedded db-store');
 html=html.replace(marker,()=>'<script id="db-store" type="application/json">'+JSON.stringify(db.snapshot(store)).replace(/</g,'\\u003c')+'</script>');
 const sourceTag='<script id="cash-demo-source" type="application/json">'+JSON.stringify(appSource).replace(/</g,'\\u003c')+'</script>';
 if(!html.includes('<script id="starter-source"'))throw Error('Missing trusted entry data anchor');
 html=html.replace('<script id="starter-source"',()=>sourceTag+'\n<script id="starter-source"');
 const fullscreenCss='<style id="cash-fullscreen-css">.app-main{max-width:none;width:100%;height:calc(100vh - 44px);min-height:0;margin:0;padding:5px 8px;display:flex;flex-direction:column}.app-main>.notice{flex:0 0 auto;margin-bottom:3px}.entry-area{flex:1;min-height:0;overflow:hidden}.entry-area iframe{height:100%;min-height:0;width:100%;border-radius:0}</style>';
 html=html.replace('</head>',fullscreenCss+'</head>');
 html=html.replace('<title>HTML DBMS 4.0.0</title>','<title>HTML DBMS · Касса 2026 (демо)</title>');
 const parsed=db.validateStore(JSON.parse(html.match(/<script id="db-store" type="application\/json">([\s\S]*?)<\/script>/)[1]));
 const rr=await db.load(parsed,head);if(Object.keys(rr.state.$refs).length!==11)throw Error('Missing documents');
 const check=await db.load(parsed,rr.state.$refs.transactions);
 if(check.state.rows.length!==f.entries.length)throw Error('Transaction import count mismatch');
 const v=await db.verifyDatabase(parsed,head);
 if(v.status!=='complete'||v.checks.documents!==11)throw Error('Invalid document ancestry: '+JSON.stringify(v));
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html,{flag:'wx'});
 console.log('CASH DEMO BUILD PASS:',output,'bytes',Buffer.byteLength(html),'rows',check.state.rows.length,'document chains',Object.keys(rr.state.$refs).length,'verified',v.status);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
