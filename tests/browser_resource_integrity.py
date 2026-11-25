"""Native HTML/XML resource refusal, preserved state, and diagnostic semantics.
Only synthetic data; no unbounded allocation or attack on a live service.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright,expect
from browser_dual import store_from_output
from browser_head_url import replace_store
from browser_network import block_service_workers

ROOT=Path(__file__).resolve().parents[1]
SOURCE=r"""export async function main(api,mount){
 const out=document.createElement('pre');mount.append(out);const results=[];
 const call=async(label,fn)=>{try{await fn();results.push([label,'accepted']);}catch(e){results.push([label,e.message]);}};
 const button=document.createElement('button');button.textContent='Resource test';mount.append(button);
 button.onclick=async()=>{
  const before=await api.getHead();
  await call('oversized',()=>api.patch('doc',Array.from({length:5},(_,i)=>({op:'copy',from:'',path:'/c'+(i+1)}))));
  results.push(['unchanged',(await api.getHead())===before]);
  await call('valid',()=>api.patch('doc',[{op:'add',path:'/n',value:1}]));
  results.push(['saved',(await api.read('doc/n'))===1]);
  const parallel=await Promise.allSettled(Array.from({length:9},()=>api.read('doc/n')));
  results.push(['concurrency',parallel.filter(x=>x.status==='fulfilled').length===8&&parallel.filter(x=>x.status==='rejected').length===1&&parallel.at(-1).reason.message.startsWith('RESOURCE_LIMIT:')]);
  out.textContent=JSON.stringify(results);
 };
}"""
def run(context,tmp,kind):
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 dialogs=[]
 def dialog(d):
  dialogs.append(d.message)
  d.accept() if d.type=='confirm' else d.dismiss()
 page.on('dialog',dialog)
 base=ROOT/'dist'/f'html_dbms.{kind}'
 page.goto(base.as_uri(),wait_until='domcontentloaded')
 assert page.evaluate('isSecureContext && !!crypto.subtle')
 fixture=page.evaluate("""async source=>{
  const db=HTML_DBMS,s=db.adoptStore({format:db.VERSION,records:{},publicHeads:{}});
  const g=await db.createDatabase(s,'Resource',{entry:{type:'application/javascript',source,export:'main'}});db.commit(s,g.store);
  const d=await db.createDocument(s,g.rootHead,'doc',{payload:'x'.repeat(512*1024)});db.commit(s,d.store);db.publish(s,'Resource',d.rootHead,g.rootHead);
  return {data:db.snapshot(s),root:d.rootHead,child:d.documentHead};
 }""",SOURCE)
 good=tmp/f'good.{kind}';good.write_text(replace_store(base.read_text('utf8'),kind,fixture['data']),encoding='utf8')
 page.goto(good.as_uri(),wait_until='domcontentloaded')
 expect(page.locator('.entry-launch')).to_be_visible();page.locator('.entry-launch').click()
 app=page.frame_locator('#entry-area iframe');expect(app.get_by_role('button',name='Resource test')).to_be_visible()
 assert page.locator('#entry-area iframe').get_attribute('sandbox')=='allow-scripts'
 app.get_by_role('button',name='Resource test').click()
 expect(app.locator('pre')).to_contain_text('"saved",true',timeout=30000)
 results=dict(json.loads(app.locator('pre').text_content()))
 assert results['oversized'].startswith('RESOURCE_LIMIT:') and results['unchanged'] is True
 assert results['valid']=='accepted' and results['saved'] is True and results['concurrency'] is True
 page.locator('#validation-toggle').click();page.locator('#verify').click()
 expect(page.locator('#validation-report')).to_contain_text('"status": "complete"')
 # Independently encrypt a valid /4 event with small Patch and oversized replay.
 bad=page.evaluate("""async fixture=>{
  const db=HTML_DBMS,enc=new TextEncoder(),sub=crypto.subtle;
  const b64=b=>btoa(String.fromCharCode(...b)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  const raw=h=>Uint8Array.from(atob(h.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
  async function event(prev,ops){
   const bytes=enc.encode(JSON.stringify(['2026-01-01T00:00:00.000Z',prev,ops]));
   const h=new Uint8Array(await sub.digest('SHA-256',bytes)),id=new Uint8Array(await sub.digest('SHA-256',raw(prev))).slice(0,16);
   const key=await sub.importKey('raw',h,'AES-GCM',false,['encrypt']);
   const ct=new Uint8Array(await sub.encrypt({name:'AES-GCM',iv:id.slice(0,12),tagLength:128},key,bytes));
   fixture.data.records[b64(id)]=b64(ct);const head=new Uint8Array(48);head.set(id);head.set(h,16);return b64(head);
  }
  const c=await event(fixture.child,Array.from({length:5},(_,i)=>({op:'copy',from:'',path:'/c'+(i+1)})));
  const r=await event(fixture.root,[{op:'replace',path:'/$refs/doc',value:c}]);fixture.data.publicHeads.Resource=r;return {data:fixture.data,head:r};
 }""",fixture)
 badfile=tmp/f'limited.{kind}';badfile.write_text(replace_store(base.read_text('utf8'),kind,bad['data']),encoding='utf8')
 # Actual import as well as initial opening. Use native File/DataTransfer for XHTML.
 page.locator('#input-html').evaluate("""(e,p)=>{
   const dt=new DataTransfer();dt.items.add(new File([p.raw],p.name,{type:'text/plain'}));
   e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));
 }""",{'raw':badfile.read_text('utf8'),'name':badfile.name})
 expect(page.locator('#status')).to_contain_text('RESOURCE_LIMIT',timeout=30000)
 assert page.locator('#entry-area iframe').count()==0
 page.goto(badfile.as_uri(),wait_until='domcontentloaded')
 expect(page.locator('#status')).to_contain_text('RESOURCE_LIMIT',timeout=30000)
 assert page.locator('#entry-area iframe').count()==0 and page.locator('.entry-launch').count()==0
 page.locator('#head').fill(bad['head'])
 page.locator('#validation-toggle').click();page.locator('#verify').click()
 expect(page.locator('#validation-report')).to_contain_text('"status": "limited"')
 page.locator('#debug-toggle').click();expect(page.locator('#debug-raw')).to_contain_text('"status": "limited"')
 page.locator('#validation-toggle').click()
 page.locator('#recovery-section summary').click()
 expect(page.locator('#recovery-head')).to_be_visible()
 page.locator('#recovery-head').fill(fixture['root'])
 before=len(dialogs);page.locator('#truncate').click()
 expect(page.locator('#status')).to_contain_text('диагноз')
 assert len(dialogs)==before,'Resource refusal must not offer destructive confirmation'
 with page.expect_download() as dl:page.locator('#save').click()
 out=tmp/f'saved-limited.{kind}';dl.value.save_as(out)
 assert store_from_output(kind,out.read_text('utf8'))==bad['data']
 page.locator('#head').fill(fixture['root']);page.locator('#open-head').click()
 expect(page.locator('.entry-launch')).to_be_visible()
 assert not errors,errors
 page.close()
 print('NATIVE RESOURCE PASS',kind,': atomic RPC refusal, valid subsequent write, authenticated limited history, no entry or truncation, unchanged saved ciphertext')

def main():
 with TemporaryDirectory(prefix='hdbms-resource-') as tmp,sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  ctx=browser.new_context(accept_downloads=True);network=[]
  block_service_workers(ctx,network)
  ctx.on('request',lambda r:network.append(r.url) if r.url.startswith(('http:','https:')) else None)
  ctx.route('http**/*',lambda r:r.abort())
  for kind in ('html','xml'):run(ctx,Path(tmp),kind)
  assert not network,network
  ctx.close();browser.close()
if __name__=='__main__':main()
