"""Genuine file:// Chrome E2E for HTML and XML/XHTML; NO CRYPTO SHIM.

Run in an unrestricted Chromium runner (GitHub Actions); this model execution
sandbox can prohibit file navigation.  An actual Windows/MAX transfer remains
independently manual. Uses only local files; rejects HTTP(S) requests.
"""
import json
import re
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright, expect
from browser_network import block_service_workers

ROOT=Path(__file__).resolve().parents[1]


def physical(kind, text):
    if kind=='xml':
        root=ET.fromstring(text)
        return json.loads(root.find('.//{http://www.w3.org/1999/xhtml}script[@id="db-store"]').text)
    match=re.search(r'<script id="db-store" type="application/json">(.*?)</script>',text,re.S)
    assert match
    return json.loads(match.group(1))


def child(page,kind):
    from browser_dual import frame
    return frame(page)


def case(browser, kind, path):
    ctx=browser.new_context(accept_downloads=True)
    blocked=[];errors=[]
    block_service_workers(ctx, blocked)
    def monitor(p):
        p.on('dialog',lambda d:d.accept('Касса'))
        p.on('pageerror',lambda e:errors.append(str(e)))
        p.on('websocket',lambda w:blocked.append(w.url))
    ctx.on('page',monitor)
    ctx.on('request',lambda r:blocked.append(r.url) if r.url.startswith(('https:','http:')) else None)
    ctx.route('http**/*',lambda r:r.abort())
    page=ctx.new_page()
    page.goto((ROOT/'dist'/f'html_dbms.{kind}').resolve().as_uri(),wait_until='domcontentloaded')
    check=page.evaluate('''async () => {
        const msg=new TextEncoder().encode('real browser crypto');
        const hash=await crypto.subtle.digest('SHA-256',msg);
        const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),'AES-GCM',false,['encrypt','decrypt']);
        const iv=new Uint8Array(12);
        const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,msg);
        const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
        return {secure:isSecureContext,hash:new Uint8Array(hash).byteLength,tag:ct.byteLength-msg.byteLength,text:new TextDecoder().decode(pt)};
    }''')
    assert check=={'secure':True,'hash':32,'tag':16,'text':'real browser crypto'},check
    if kind=='xml':
        assert page.evaluate('document.contentType') in ('text/xml','application/xml')
        assert page.evaluate('document.documentElement.namespaceURI')=='http://www.w3.org/1999/xhtml'
    expect(page.locator('#status')).to_contain_text('Контейнер пуст')
    page.locator('#new-db').click()
    expect(child(page,kind).locator('#db-title')).to_have_text('Касса',timeout=20000)
    child(page,kind).locator('#add-document').click()
    child(page,kind).locator('#new-document-name').fill('crypto-test')
    child(page,kind).locator('#new-document-json').fill('{"test":"AES-GCM"}')
    child(page,kind).locator('#create-document').click()
    expect(child(page,kind).locator('#message')).to_contain_text('Документ создан',timeout=20000)
    page.locator('#validation-toggle').click()
    page.locator('#verify').click()
    expect(page.locator('#validation-report')).to_contain_text('complete',timeout=20000)
    with page.expect_download() as dl: page.locator('#save').click()
    saved=path/f'real_crypto_saved.{kind}'
    dl.value.save_as(str(saved))
    data=physical(kind,saved.read_text('utf8'))
    assert data['format']=='HTML_DBMS/4' and len(data['records'])>=3
    page.goto(saved.resolve().as_uri(),wait_until='domcontentloaded')
    expect(child(page,kind).locator('#db-title')).to_have_text('Касса',timeout=20000)
    assert not blocked,blocked
    assert not errors,errors
    ctx.close()


if __name__=='__main__':
    with TemporaryDirectory(prefix='hdbms_native_') as tmp, sync_playwright() as pw:
        binary={'executable_path':shutil.which('chromium')} if shutil.which('chromium') else {}
        browser=pw.chromium.launch(headless=True,**binary,args=['--no-sandbox','--disable-dev-shm-usage'])
        for container in ('html','xml'):
            case(browser,container,Path(tmp))
        browser.close()
    print('NATIVE FILE CRYPTO PASS: HTML+XML file://, SHA-256, AES-256-GCM, DB/document, save/reopen, no network requests; NO SHIM')
