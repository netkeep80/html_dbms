"""Public cash acceptance over genuine HTTPS, with native Web Crypto (no shim).
Without an argument a temporary loopback TLS server serves only the audited file.
With a URL, checks the deployed site and refuses unexpected network requests.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
import functools, hashlib, json, re, ssl, subprocess, sys, urllib.parse
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
def test(url, expected=None, self_signed=False):
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(ignore_https_errors=self_signed,accept_downloads=True)
        errors=[]; unexpected=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda d:d.accept())
        def route(r):
            if r.request.url.split('#')[0]==url and r.request.is_navigation_request():r.continue_()
            elif r.request.url.startswith(('blob:','data:')):r.continue_()
            else:unexpected.append(r.request.url);r.abort()
        page.route('**/*',route)
        response=page.goto(url,wait_until='domcontentloaded')
        assert response.status==200 and page.url.startswith('https://')
        if expected is not None:assert response.body()==expected,'deployed bytes differ from approved artifact'
        assert page.evaluate('''async()=>{const b=new Uint8Array([1,2,3]),h=await crypto.subtle.digest('SHA-256',b),k=await crypto.subtle.importKey('raw',h,'AES-GCM',false,['encrypt','decrypt']),iv=new Uint8Array(12),c=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,b),p=await crypto.subtle.decrypt({name:'AES-GCM',iv},k,c);return isSecureContext&&h.byteLength===32&&Array.from(new Uint8Array(p)).join(',')==='1,2,3'}''')
        app=page.frame_locator('#entry-area iframe')
        expect(app.locator('h1')).to_contain_text('Касса',timeout=30000)
        expect(app.locator('#cash-count')).to_contain_text('720')
        expect(app.locator('.ledger tbody tr')).to_have_count(720)
        assert page.locator('#entry-area iframe').get_attribute('sandbox')=='allow-scripts'
        page.locator('#validation-toggle').click();page.locator('#verify').click()
        expect(page.locator('#validation-report')).to_contain_text('"status": "complete"',timeout=30000)
        app.locator('#cash-tabs button',has_text='Операции(Фонд)').click()
        expect(app.locator('.histogram svg')).to_be_visible()
        app.locator('#cash-tabs button',has_text='Транзакции').click()
        app.get_by_role('button',name='+ Транзакция').click()
        app.locator('.form input[name="amount"]').fill('321')
        app.get_by_role('button',name='Записать транзакцию').click()
        expect(app.locator('#cash-count')).to_contain_text('721',timeout=30000)
        with page.expect_download() as download:page.locator('#save').click()
        with TemporaryDirectory() as tmp:
            saved=Path(tmp)/'saved.html';download.value.save_as(saved)
            other=browser.new_page()
            other.goto(saved.as_uri(),wait_until='domcontentloaded')
            expect(other.frame_locator('#entry-area iframe').locator('#cash-count')).to_contain_text('721',timeout=30000)
            other.close()
        page.reload(wait_until='domcontentloaded')
        expect(page.frame_locator('#entry-area iframe').locator('#cash-count')).to_contain_text('720',timeout=30000)
        assert not unexpected,unexpected
        assert not errors,errors
        browser.close()
    print('PUBLIC CASH HTTPS PASS: native crypto, auto-open, all rows, report, validation, local write, saved copy, unchanged remote snapshot, no external requests')
def main():
    if len(sys.argv)>1:
        test(sys.argv[1],Path(sys.argv[2]).read_bytes() if len(sys.argv)>2 else None);return
    with TemporaryDirectory() as tmp:
        p=Path(tmp);site=p/'site';site.mkdir();index=site/'index.html'
        subprocess.run(['node',str(ROOT/'examples/cash/build-pages.cjs'),str(index)],check=True)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',str(p/'key.pem'),'-out',str(p/'cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(site)))
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(p/'cert.pem',p/'key.pem');server.socket=context.wrap_socket(server.socket,server_side=True)
        thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        try:test(f'https://127.0.0.1:{server.server_port}/',index.read_bytes(),True)
        finally:server.shutdown();server.server_close()
if __name__=='__main__':main()
