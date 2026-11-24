"""Native Web Crypto file:// regression for document-bound RPC.
Navigation uses an offline replacement document; no real external destination.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import shutil
from playwright.sync_api import sync_playwright, expect
from browser_dual import ROOT, frame, store_from_output
from browser_head_url import replace_store
from browser_network import block_service_workers

def snapshot(page,kind,path):
    with page.expect_download() as dl:page.locator('#save').click()
    dl.value.save_as(str(path))
    return store_from_output(kind,path.read_text('utf8'))

def scenario(browser,kind,tmp):
    ctx=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':900})
    requests=[];errors=[];probe_url='https://rpc-probe.invalid/replacement';probe_requests=[];probe_frames=[]
    block_service_workers(ctx,requests)
    ctx.on('request',lambda r:probe_requests.append(r.url) if r.url==probe_url else requests.append(r.url) if r.url.startswith(('http:','https:','ws:','wss:')) else None)
    ctx.route('http**/*',lambda r:r.abort())
    def probe(route):
        probe_frames.append(route.request.frame)
        route.fulfill(status=200,content_type='text/html',body='''<script>addEventListener('message',e=>{if(e.data?.kind==='html-dbms-reply')parent.postMessage(e.data,'*')});const ch=new MessageChannel();ch.port1.onmessage=e=>parent.postMessage(e.data,'*');parent.postMessage({kind:'html-dbms-ready'},'*',[ch.port2]);parent.postMessage({kind:'html-dbms-rpc',id:903,method:'read',payload:{ref:''}},'*');parent.postMessage({kind:'probe-ready'},'*');</script>''')
    ctx.route(probe_url,probe)
    page=ctx.new_page();page.on('websocket',lambda w:requests.append(w.url));page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept('Session') if d.type=='prompt' else d.accept())
    src=ROOT/'dist'/f'html_dbms.{kind}';page.goto(src.as_uri(),wait_until='domcontentloaded')
    page.locator('#new-db').click();expect(frame(page).locator('#db-title')).to_have_text('Session')
    original=snapshot(page,kind,tmp/f'original-{kind}.{kind}')
    head=page.locator('#head').evaluate('e=>e.value')
    # The original WindowProxy alone is no longer an RPC capability.
    page.evaluate('''()=>{window.forgedReplies=[];window.addEventListener('message',e=>{if(['html-dbms-reply','html-dbms-start'].includes(e.data?.kind))window.forgedReplies.push(e.data);});}''')
    child=next(f for f in page.frames if f!=page.main_frame)
    child.evaluate('''()=>{window.addEventListener('message',e=>{if(e.data?.kind==='html-dbms-reply')parent.postMessage(e.data,'*');});parent.postMessage({kind:'html-dbms-rpc',id:900,method:'read',payload:{ref:''}},'*');}''')
    child.evaluate('''()=>parent.postMessage({kind:'html-dbms-rpc',id:901,method:'createDocument',payload:{name:'FORGED',state:{}}},'*')''')
    def cross_origin_active():
        # Capture the existing iframe's Frame before initiating navigation.
        # Revocation may remove it before the replacement script executes.
        active=page.locator('#entry-area iframe').element_handle().content_frame()
        n=len(probe_frames)
        page.locator('#entry-area iframe').evaluate("(f,url)=>{f.src=url;f.removeAttribute('srcdoc');}",probe_url)
        expect(page.locator('#entry-area iframe')).to_have_count(0,timeout=15000)
        assert len(probe_frames)==n+1 and probe_frames[-1]==active, 'HTTPS navigation did not target the active iframe'
    # Gate an actual staged write before it reaches the shell commit.
    page.evaluate('''()=>{
      const db=HTML_DBMS,original=db.createDocument;window.navGate={};
      db.createDocument=async(...args)=>{const r=await original(...args);window.navGate.entered=true;await new Promise(ok=>window.navGate.release=ok);window.navGate.returned=true;return r;};
    }''')
    frame(page).locator('#add-document').click();frame(page).locator('#new-document-name').fill('STALE_NAV')
    frame(page).locator('#new-document-json').fill('{}');frame(page).locator('#create-document').click()
    page.wait_for_function('window.navGate.entered')
    # Cross-origin navigation of the active iframe, not a parallel probe.
    cross_origin_active()
    expect(page.locator('#entry-area')).to_contain_text('Сессия entry завершена')
    # A new session is usable even while the old RPC promise is suspended.
    page.locator('#open-head').click();expect(frame(page).locator('#db-title')).to_have_text('Session')
    page.evaluate('window.navGate.release()');page.wait_for_function('window.navGate.returned')
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    assert snapshot(page,kind,tmp/f'after-nav-{kind}.{kind}')==original
    assert page.evaluate('window.forgedReplies.length')==0
    # An actual cross-origin browser document, fulfilled locally without network,
    # has neither the document-bound port nor a valid handshake.
    page.evaluate('''url=>{window.probeReady=false;window.addEventListener('message',e=>{if(e.data?.kind==='probe-ready')window.probeReady=true;});const f=document.createElementNS('http://www.w3.org/1999/xhtml','iframe');f.id='rpc-probe';f.setAttribute('sandbox','allow-scripts');f.src=url;document.body.appendChild(f);}''',probe_url)
    page.wait_for_function('window.probeReady')
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    assert probe_requests==[probe_url,probe_url],probe_requests
    assert page.evaluate('window.forgedReplies.length')==0
    page.locator('#rpc-probe').evaluate('e=>e.remove()')
    # A delayed genuine read may finish after navigation, but cannot publish a
    # reply to the replacement document or to the next application session.
    page.evaluate('''()=>{
      const db=HTML_DBMS,original=db.readState;window.readGate={};
      db.readState=async(...args)=>{const value=await original(...args);if(!window.readGate.entered){
        window.readGate.entered=true;await new Promise(ok=>window.readGate.release=ok);window.readGate.returned=true;}
        return value;};
    }''')
    frame(page).locator('#refresh').click();page.wait_for_function('window.readGate.entered')
    cross_origin_active()
    assert probe_requests==[probe_url]*3,probe_requests
    page.locator('#open-head').click();expect(frame(page).locator('#db-title')).to_have_text('Session')
    page.evaluate('window.readGate.release()');page.wait_for_function('window.readGate.returned')
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    assert page.evaluate('window.forgedReplies.length')==0
    assert snapshot(page,kind,tmp/f'after-read-nav-{kind}.{kind}')==original
    # Changing executable entry revokes the old capability immediately after commit.
    frame(page).locator('#edit-document').click()
    frame(page).locator('#patch').fill('[{"op":"replace","path":"/entry","value":null}]')
    frame(page).locator('#write').click()
    expect(page.locator('#entry-area iframe')).to_have_count(0,timeout=15000)
    expect(page.locator('#entry-area')).to_contain_text('отсутствует entry')
    assert page.locator('#head').evaluate('e=>e.value')!=head
    changed=snapshot(page,kind,tmp/f'changed-{kind}.{kind}')
    assert len(changed['records'])==len(original['records'])+1
    page.locator('#validation-toggle').click();page.locator('#verify').click()
    expect(page.locator('#validation-report')).to_contain_text('"status": "complete"')
    # A static HTML entry has no MessagePort or script permission.
    fixture=page.evaluate('''async()=>{const db=HTML_DBMS,s=db.adoptStore({format:db.VERSION,publicHeads:{},records:{}});const r=await db.createDatabase(s,'Static',{entry:{type:'text/html',html:'<meta http-equiv="refresh" content="0;url=about:blank"><p>STATIC</p><script>parent.postMessage({kind:"html-dbms-rpc",id:1,method:"read",payload:{ref:""}},"*")<\\/script>'}});db.commit(s,r.store);return db.snapshot(s);}''')
    p=tmp/f'static-{kind}.{kind}';p.write_text(replace_store(src.read_text('utf8'),kind,fixture),encoding='utf8')
    page.goto(p.as_uri(),wait_until='domcontentloaded')
    expect(page.locator('#entry-area iframe')).to_have_count(1)
    assert page.locator('#entry-area iframe').get_attribute('sandbox')==''
    assert snapshot(page,kind,tmp/f'static-save-{kind}.{kind}')==fixture
    # Resolved executable changes must revoke the old session even if root.entry
    # itself is unchanged and only the target child JSON has been edited.
    linked=page.evaluate('''async()=>{
      const db=HTML_DBMS,s=db.adoptStore({format:db.VERSION,publicHeads:{},records:{}}),source=document.querySelector('#starter-source').textContent;
      const g=await db.createDatabase(s,'Linked',{entry:{$ref:'application/'}});db.commit(s,g.store);
      const d=await db.createDocument(s,g.rootHead,'application',{type:'application/javascript',source,export:'main'});
      db.publish(d.store,'Linked',d.rootHead,g.rootHead);db.commit(s,d.store);return db.snapshot(s);
    }''')
    p=tmp/f'linked-{kind}.{kind}';p.write_text(replace_store(src.read_text('utf8'),kind,linked),encoding='utf8')
    page.goto(p.as_uri(),wait_until='domcontentloaded');expect(frame(page).locator('#db-title')).to_have_text('Linked')
    frame(page).locator('#document-nav button',has_text='application').click()
    expect(frame(page).locator('#document-title')).to_have_text('application')
    frame(page).locator('#edit-document').click()
    import json
    frame(page).locator('#patch').fill(json.dumps([{'op':'replace','path':'/source','value':'export async function main(db,mount){mount.textContent="NEW_ENTRY"}'}]))
    frame(page).locator('#write').click()
    expect(page.locator('#entry-area iframe')).to_have_count(0)
    expect(page.locator('.entry-launch')).to_be_visible()
    page.locator('.entry-launch').click()
    expect(frame(page).locator('#app')).to_have_text('NEW_ENTRY')
    linked_after=snapshot(page,kind,tmp/f'linked-after-{kind}.{kind}')
    assert len(linked_after['records'])==len(linked['records'])+2
    page.locator('#validation-toggle').click();page.locator('#verify').click()
    expect(page.locator('#validation-report')).to_contain_text('"status": "complete"')
    assert not requests,requests
    assert not errors,errors
    ctx.close()
    print('NATIVE RPC SESSION PASS',kind,': forged WindowProxy and cross-origin messages, navigation revocation, suspended read/write, new-session progress, direct/referenced entry replacement, static sandbox; no real external requests',flush=True)

if __name__=='__main__':
    with sync_playwright() as pw,TemporaryDirectory() as d:
        opt={'executable_path':shutil.which('chromium')} if shutil.which('chromium') else {}
        browser=pw.chromium.launch(headless=True,**opt,args=['--no-sandbox','--disable-dev-shm-usage'])
        for kind in ('html','xml'):scenario(browser,kind,Path(d))
        browser.close()
