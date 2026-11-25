"""Native file:// regressions on the actual production containers, no crypto shim.
Only test-side gates delay completion of real core calls to reproduce races.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json, shutil
from playwright.sync_api import sync_playwright, expect
from browser_dual import ROOT, frame, store_from_output, current_pair
from browser_head_url import replace_store

def upload(page, name, raw):
    # XHTML input controls require the native DataTransfer path.
    page.locator('#input-html').evaluate('''(e,p)=>{
      const dt=new DataTransfer();dt.items.add(new File([p.raw],p.name,{type:'text/plain'}));
      e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));
    }''',{'name':name,'raw':raw})

def save(page, kind, path):
    with page.expect_download() as dl:page.locator('#save').click()
    dl.value.save_as(str(path))
    return store_from_output(kind,path.read_text('utf8'))

def scenario(browser, kind, tmp):
    context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':900})
    external=[];errors=[]
    context.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:','ws:','wss:')) else None)
    context.route('http**/*',lambda r:r.abort())
    def monitor(p):
        p.on('websocket',lambda w:external.append(w.url))
        p.on('pageerror',lambda e:errors.append(str(e)))
        p.on('dialog',lambda d:d.accept())
    context.on('page',monitor)
    page=context.new_page()
    src=ROOT/'dist'/f'html_dbms.{kind}'
    page.goto(src.as_uri(),wait_until='domcontentloaded')
    expect(page.locator('#status')).to_contain_text('Контейнер пуст')
    assert page.evaluate('isSecureContext && !!crypto.subtle')
    fixture=page.evaluate('''async()=>{
      const db=HTML_DBMS,s=db.adoptStore({format:db.VERSION,publicHeads:{},records:{}}),entry={type:'application/javascript',export:'main',source:document.querySelector('#starter-source').textContent};
      const heads={};for(const name of ['Alpha','Beta','BrokenEntry']){
        const r=await db.createDatabase(s,name,{entry:name==='BrokenEntry'?{$ref:'missing/'}:entry});
        db.commit(s,r.store);heads[name]=r.rootHead;
      }return {heads,store:db.snapshot(s)};
    }''')
    heads=fixture['heads'];base=src.read_text('utf8')
    def container(name,catalog):
        p=tmp/f'{name}-{kind}.{kind}'
        data={**fixture['store'],'publicHeads':catalog}
        p.write_text(replace_store(base,kind,data),encoding='utf8')
        return p,data
    broken,data=container('broken-entry',{'BrokenEntry':heads['BrokenEntry']})
    page.goto(broken.as_uri(),wait_until='domcontentloaded')
    expect(page.locator('#status')).to_contain_text('БД открыта; ошибка entry')
    expect(page.locator('#entry-area')).to_contain_text('UNKNOWN_DOCUMENT')
    expect(page.locator('#current-root')).to_contain_text(heads['BrokenEntry'])
    expect(page.locator('#entry-area iframe')).to_have_count(0)
    page.locator('#validation-toggle').click();page.locator('#verify').click()
    expect(page.locator('#validation-report')).to_contain_text('"status": "complete"')
    saved=tmp/f'broken-saved.{kind}'
    assert save(page,kind,saved)==data
    copy=context.new_page();copy.goto(saved.as_uri(),wait_until='domcontentloaded')
    expect(copy.locator('#current-root')).to_contain_text(heads['BrokenEntry'])
    expect(copy.locator('#status')).to_contain_text('БД открыта; ошибка entry')
    copy.close()
    # Hostile markup is parsed as data; it is never adopted or executed.
    safe,data=container('alpha',{'Alpha':heads['Alpha']})
    page.goto(safe.as_uri(),wait_until='domcontentloaded')
    expect(frame(page).locator('#db-title')).to_have_text('Alpha')
    store=json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    tag='<script id="db-store" type="application/json">'+store+'</script>'
    hostile='<!doctype html><html><head><script>window.evil=1;fetch("https://invalid.example/script")</script><link rel="stylesheet" href="https://invalid.example/css"></head><body><img src="https://invalid.example/image"><iframe src="https://invalid.example/frame"></iframe>'+tag+'</body></html>'
    upload(page,'hostile.html',hostile)
    expect(page.locator('#status')).to_contain_text('Контейнер загружен')
    expect(frame(page).locator('#db-title')).to_have_text('Alpha')
    assert page.evaluate('typeof window.evil')=='undefined'
    assert page.locator('#db-store').text_content()==''
    assert save(page,kind,tmp/f'imported.{kind}')==data
    assert save(page,kind,tmp/f'imported-again.{kind}')==data
    # Check size BEFORE reading the blob without allocating a huge fixture.
    page.evaluate('''()=>{const p=Blob.prototype;window.sizeGate={descriptor:Object.getOwnPropertyDescriptor(p,'size'),text:p.text,read:false};
      Object.defineProperty(p,'size',{configurable:true,get:()=>256*1024*1024+1});
      p.text=function(){window.sizeGate.read=true;return window.sizeGate.text.call(this);};
    }''')
    upload(page,'large.html',hostile)
    expect(page.locator('#status')).to_contain_text('Превышен размер контейнера')
    assert page.evaluate('window.sizeGate.read') is False
    page.evaluate('''()=>{Object.defineProperty(Blob.prototype,'size',window.sizeGate.descriptor);Blob.prototype.text=window.sizeGate.text;}''')
    for name,raw,error in [
        ('duplicate.html','<!doctype html><html><body>'+tag+'<template>'+tag+'</template></body></html>','единственный'),
        ('templates.html','<!doctype html><html><body>'+tag+'<template></template>'*10001+'</body></html>','Слишком много вложенных template'),
        ('dtd.xml','<?xml version="1.0"?><!DOCTYPE html SYSTEM "https://invalid.example/dtd"><html xmlns="http://www.w3.org/1999/xhtml">'+tag+'</html>','декларации запрещены'),
        ('stylesheet.xml','<?xml version="1.0"?><?xml-stylesheet href="https://invalid.example/xsl" type="text/xsl"?><html xmlns="http://www.w3.org/1999/xhtml">'+tag+'</html>','декларации запрещены'),
        ('malformed.xml','<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'+tag,'Некорректный XML')
    ]:
        upload(page,name,raw);expect(page.locator('#status')).to_contain_text(error)
        assert current_pair(page)==heads['Alpha']
        expect(frame(page).locator('#db-title')).to_have_text('Alpha')
    assert save(page,kind,tmp/f'after-invalid.{kind}')==data
    # Gate a completed independent verification before it returns to the shell.
    # The result for Alpha must never be rendered in Beta's validation panel.
    page.evaluate('''()=>{
      const db=HTML_DBMS,original=db.verifyDatabase;window.gate={};
      db.verifyDatabase=async(...args)=>{const result=await original(...args);
        if(!window.gate.entered){window.gate.entered=true;await new Promise(r=>window.gate.release=r);window.gate.returned=true;}
        return result;};
    }''')
    page.locator('#validation-toggle').click();page.locator('#verify').click()
    page.wait_for_function('window.gate.entered')
    page.evaluate('(h)=>location.hash="head="+h',heads['Beta'])
    expect(frame(page).locator('#db-title')).to_have_text('Beta')
    page.evaluate('window.gate.release()');page.wait_for_function('window.gate.returned')
    expect(page.locator('#validation-report')).to_contain_text('Проверка ещё не выполнялась')
    page.locator('#validation-toggle').click()
    # Gate a genuine staged write, then switch the active HEAD before commit.
    page.evaluate('''()=>{
      const db=HTML_DBMS,original=db.createDocument;window.writeGate={};
      db.createDocument=async(...args)=>{const result=await original(...args);
        window.writeGate.entered=true;await new Promise(r=>window.writeGate.release=r);
        window.writeGate.returned=true;return result;};
    }''')
    frame(page).locator('#add-document').click()
    frame(page).locator('#new-document-name').fill('RACE_SENTINEL')
    frame(page).locator('#new-document-json').fill('{}')
    frame(page).locator('#create-document').click()
    page.wait_for_function('window.writeGate.entered')
    page.evaluate('(h)=>location.hash="head="+h',heads['Alpha'])
    expect(frame(page).locator('#db-title')).to_have_text('Alpha')
    page.evaluate('window.writeGate.release()');page.wait_for_function('window.writeGate.returned')
    # Wait a browser task (not a fixed timer) for the shell's promise continuation.
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    assert save(page,kind,tmp/f'after-race.{kind}')==data
    assert current_pair(page)==heads['Alpha']
    # The hidden debug panel must not start another history traversal on commit.
    page.evaluate('''()=>{const original=HTML_DBMS.debugDatabase;window.inspectCount=0;
      HTML_DBMS.debugDatabase=(...a)=>{window.inspectCount++;return original(...a);};}''')
    page.locator('#debug-toggle').click()
    expect(page.locator('#debug-raw')).to_contain_text('"rootHead"')
    observed=page.evaluate('window.inspectCount')
    assert observed>0
    page.locator('#info-toggle').click()
    expect(page.locator('#debug-panel')).to_be_hidden()
    assert page.locator('#debug-raw').text_content()==''
    page.locator('#info-toggle').click()
    # Use a fresh wrapper after the earlier intentionally delayed write.
    page.reload(wait_until='domcontentloaded')
    expect(frame(page).locator('#db-title')).to_have_text('Alpha')
    page.evaluate('''()=>{const original=HTML_DBMS.debugDatabase;window.inspectCount=0;
      HTML_DBMS.debugDatabase=(...a)=>{window.inspectCount++;return original(...a);};}''')
    page.locator('#debug-toggle').click()
    expect(page.locator('#debug-raw')).to_contain_text('"rootHead"')
    observed=page.evaluate('window.inspectCount')
    page.locator('#info-toggle').click();page.locator('#info-toggle').click()
    frame(page).locator('#add-document').click()
    frame(page).locator('#new-document-name').fill('NO_DEBUG_REPLAY')
    frame(page).locator('#new-document-json').fill('{}')
    frame(page).locator('#create-document').click()
    expect(frame(page).locator('#message')).to_contain_text('Документ создан')
    assert page.evaluate('window.inspectCount')==observed
    before_limit=save(page,kind,tmp/f'before-limit.{kind}')
    before_head=current_pair(page)
    # Emulate the exact incremental counter crossing the cap, without allocating 256 MiB.
    page.evaluate('''()=>{const db=HTML_DBMS,original=db.storeInfo;
      window.restoreInfo=()=>{db.storeInfo=original;};
      db.storeInfo=(...a)=>({...original(...a),bytes:256*1024*1024});}''')
    frame(page).locator('#add-document').click()
    frame(page).locator('#new-document-name').fill('OVER_LIMIT')
    frame(page).locator('#new-document-json').fill('{}')
    frame(page).locator('#create-document').click()
    expect(frame(page).locator('#message')).to_contain_text('Превышен размер контейнера')
    page.evaluate('window.restoreInfo()')
    assert current_pair(page)==before_head
    assert save(page,kind,tmp/f'after-limit.{kind}')==before_limit
    assert not external,external
    assert not errors,errors
    context.close()
    print('NATIVE STABILITY PASS',kind,': broken entry remains open, inert hostile import, duplicate/DTD/PI rejection, stale verification/write discarded, unchanged store; no external requests',flush=True)

if __name__=='__main__':
    with sync_playwright() as pw,TemporaryDirectory() as d:
        opt={'executable_path':shutil.which('chromium')} if shutil.which('chromium') else {}
        browser=pw.chromium.launch(headless=True,**opt,args=['--no-sandbox','--disable-dev-shm-usage'])
        for kind in ('html','xml'):scenario(browser,kind,Path(d))
        browser.close()
