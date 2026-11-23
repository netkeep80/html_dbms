"""Native Web Crypto file:// regression for document-bound RPC.
Navigation uses an offline replacement document; no real external destination.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import shutil
from playwright.sync_api import sync_playwright, expect
from browser_dual import ROOT, frame, store_from_output
from browser_head_url import replace_store

def snapshot(page,kind,path):
    with page.expect_download() as dl:page.locator('#save').click()
    dl.value.save_as(str(path))
    return store_from_output(kind,path.read_text('utf8'))

def scenario(browser,kind,tmp):
    ctx=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':900})
    requests=[];errors=[]
    ctx.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:','ws:','wss:')) else None)
    ctx.route('http**/*',lambda r:r.abort())
    page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept('Session') if d.type=='prompt' else d.accept())
    src=ROOT/'dist'/f'html_dbms.{kind}';page.goto(src.as_uri(),wait_until='domcontentloaded')
    page.locator('#new-db').click();expect(frame(page).locator('#db-title')).to_have_text('Session')
    original=snapshot(page,kind,tmp/f'original-{kind}.{kind}')
    head=page.locator('#head').evaluate('e=>e.value')
    # The original WindowProxy alone is no longer an RPC capability.
    page.evaluate('''()=>{window.forgedReplies=[];window.addEventListener('message',e=>{if(e.data?.kind==='html-dbms-reply')window.forgedReplies.push(e.data);});}''')
    child=next(f for f in page.frames if f!=page.main_frame)
    child.evaluate('''()=>parent.postMessage({kind:'html-dbms-rpc',id:900,method:'read',payload:{ref:''}},'*')''')
    child.evaluate('''()=>parent.postMessage({kind:'html-dbms-rpc',id:901,method:'createDocument',payload:{name:'FORGED',state:{}}},'*')''')
    # Gate an actual staged write before it reaches the shell commit.
    page.evaluate('''()=>{
      const db=HTML_DBMS,original=db.createDocument;window.navGate={};
      db.createDocument=async(...args)=>{const r=await original(...args);window.navGate.entered=true;await new Promise(ok=>window.navGate.release=ok);window.navGate.returned=true;return r;};
    }''')
    frame(page).locator('#add-document').click();frame(page).locator('#new-document-name').fill('STALE_NAV')
    frame(page).locator('#new-document-json').fill('{}');frame(page).locator('#create-document').click()
    page.wait_for_function('window.navGate.entered')
    # Same browsing context, different document. The original channel is revoked.
    page.evaluate('''()=>{
      const f=document.querySelector('#entry-area iframe');window.oldProxy=f.contentWindow;
      f.srcdoc='<script>parent.postMessage({kind:"html-dbms-rpc",id:902,method:"read",payload:{ref:""}},"*")<\\/script>';
    }''')
    expect(page.locator('#entry-area iframe')).to_have_count(0,timeout=15000)
    expect(page.locator('#entry-area')).to_contain_text('Сессия entry завершена')
    # A new session is usable even while the old RPC promise is suspended.
    page.locator('#open-head').click();expect(frame(page).locator('#db-title')).to_have_text('Session')
    page.evaluate('window.navGate.release()');page.wait_for_function('window.navGate.returned')
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    assert snapshot(page,kind,tmp/f'after-nav-{kind}.{kind}')==original
    assert page.evaluate('window.forgedReplies.length')==0
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
    fixture=page.evaluate('''async()=>{const db=HTML_DBMS,s=db.newStore();const r=await db.createDatabase(s,'Static',{entry:{type:'text/html',html:'<p>STATIC</p><script>parent.postMessage({kind:"html-dbms-rpc",id:1,method:"read",payload:{ref:""}},"*")<\\/script>'}});db.commit(s,r.store);return JSON.parse(JSON.stringify(s));}''')
    p=tmp/f'static-{kind}.{kind}';p.write_text(replace_store(src.read_text('utf8'),kind,fixture),encoding='utf8')
    page.goto(p.as_uri(),wait_until='domcontentloaded')
    expect(page.locator('#entry-area iframe')).to_have_count(1)
    assert page.locator('#entry-area iframe').get_attribute('sandbox')==''
    assert snapshot(page,kind,tmp/f'static-save-{kind}.{kind}')==fixture
    assert not requests,requests
    assert not errors,errors
    ctx.close()
    print('NATIVE RPC SESSION PASS',kind,': forged WindowProxy messages, navigation revocation, suspended write, new-session progress, entry replacement, static sandbox; no external requests',flush=True)

if __name__=='__main__':
    with sync_playwright() as pw,TemporaryDirectory() as d:
        opt={'executable_path':shutil.which('chromium')} if shutil.which('chromium') else {}
        browser=pw.chromium.launch(headless=True,**opt,args=['--no-sandbox','--disable-dev-shm-usage'])
        for kind in ('html','xml'):scenario(browser,kind,Path(d))
        browser.close()
