"""Browser DOM interoperability regression for HTML and XML/XHTML.

Local evaluation prohibits real file:// navigation, while GitHub Actions tests
file:// directly. The local fallback reparses XHTML with DOMParser. To test the
namespace-specific code paths, we reparse the REAL XML output via DOMParser,
replace the live root with that XHTML namespace tree, and run its embedded
scripts with document.contentType set to text/xml.  This is NOT a genuine XML
navigation and does not prove file:// Web Crypto support.

Uses the deliberately insecure Web Crypto shim from browser_smoke.py.
"""
from pathlib import Path
import json
import re
import shutil
import os
from playwright.sync_api import sync_playwright, expect
# Read the test-only shim literal without executing browser_smoke.py's scenarios.
import ast
_S=(Path(__file__).parent/'browser_smoke.py').read_text(encoding='utf8')
SHIM=next(ast.literal_eval(item.value) for item in ast.parse(_S).body
          if isinstance(item,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SHIM' for t in item.targets))
ROOT=Path(__file__).resolve().parents[1]


def setup(page, kind):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        # Full native XHTML/XML parser + script execution on file://.
        # Intentionally test-only shim; this does not assert genuine AES-GCM.
        page.add_init_script(SHIM)
        page.goto((ROOT/'dist'/('html_dbms.xml' if kind=='xml' else 'html_dbms.html')).resolve().as_uri(),wait_until='domcontentloaded')
        if kind=='xml':
            assert page.evaluate('document.contentType') in ('text/xml','application/xml')
            assert page.evaluate('document.documentElement.namespaceURI') == 'http://www.w3.org/1999/xhtml'
        return
    page.evaluate(SHIM)
    if kind=='html':
        page.set_content((ROOT/'dist/html_dbms.html').read_text(encoding='utf8'),wait_until='domcontentloaded')
    else:
        page.set_content('<!doctype html><html><body></body></html>',wait_until='domcontentloaded')
        xml=(ROOT/'dist/html_dbms.xml').read_text(encoding='utf8')
        diagnostics=page.evaluate('''text => {
          const parsed=new DOMParser().parseFromString(text,'application/xml');
          if(parsed.getElementsByTagName('parsererror').length)throw Error('Malformed XML');
          document.replaceChild(document.importNode(parsed.documentElement,true),document.documentElement);
          Object.defineProperty(document,'contentType',{configurable:true,value:'text/xml'});
          for(const script of document.querySelectorAll('script'))if(!script.getAttribute('type'))(0,eval)(script.textContent);
          return {contentType:document.contentType,namespace:document.documentElement.namespaceURI};
        }''',xml)
        assert diagnostics=={'contentType':'text/xml','namespace':'http://www.w3.org/1999/xhtml'},diagnostics


def current_pair(page):
    return [page.locator('#head-id').evaluate('(e)=>e.value'),page.locator('#head-hash').evaluate('(e)=>e.value')]


def frame(page):
    # Playwright frame_locator() does not reliably attach to an XHTML iframe
    # inside a native XML document despite the subframe being live and usable.
    if page.evaluate('document.contentType') in ('text/xml', 'application/xml'):
        children=[child for child in page.frames if child != page.main_frame]
        assert len(children)==1, f'Expected one sandboxed child frame, got {len(children)}'
        return children[0]
    return page.frame_locator('#entry-area iframe')


def store_from_output(kind,text):
    if kind=='xml':
        import xml.etree.ElementTree as ET
        root=ET.fromstring(text)
        return json.loads(root.find('.//{http://www.w3.org/1999/xhtml}script[@id="db-store"]').text)
    m=re.search(r'<script id="db-store" type="application/json">(.*?)</script>',text,re.S)
    assert m
    return json.loads(m.group(1))


def scenario(browser,kind,tmp_path):
    page=browser.new_page(accept_downloads=True,viewport={'width':1440,'height':900})
    errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
    consoles=[];page.on('console',lambda msg:consoles.append(f'{msg.type}: {msg.text}'))
    prompts=iter(['Касса'])
    def dialog(d):
        d.accept(next(prompts)) if d.type=='prompt' else d.accept()
    page.on('dialog',dialog)
    setup(page,kind)
    expect(page.locator('#status')).to_contain_text('Контейнер пуст')
    page.locator('#new-db').click()
    expect(frame(page).locator('#db-title')).to_have_text('Касса',timeout=15000)
    frame(page).locator('#add-document').click()
    expect(frame(page).locator('#new-document')).to_be_visible()
    frame(page).locator('#new-document-name').fill('funds')
    frame(page).locator('#new-document-json').fill('{"F001":{"name":"Основной"}}')
    frame(page).locator('#create-document').click()
    expect(frame(page).locator('#message')).to_contain_text('Документ создан')
    frame(page).locator('#edit-document').click()
    frame(page).locator('#patch').fill('[{"op":"add","path":"/F001/amount","value":5}]')
    frame(page).locator('#write').click()
    expect(frame(page).locator('#message')).to_contain_text('Изменение записано')
    page.locator('#validation-toggle').click()
    page.locator('#verify').click()
    expect(page.locator('#validation-report')).to_contain_text('complete')
    page.locator('#debug-toggle').click()
    expect(page.locator('#debug-panel')).to_be_visible()
    page.locator('#debug-toggle').click()
    page.locator('#status').evaluate("el => el.textContent='DECRYPTED_UI_PRIVATE_SENTINEL_742'")
    with page.expect_download() as dl:page.locator('#save').click()
    saved=Path(tmp_path)/f'ui_saved.{kind if kind=="xml" else "html"}'
    dl.value.save_as(str(saved))
    assert saved.suffix==('.xml' if kind=='xml' else '.html')
    saved_text=saved.read_text(encoding='utf8')
    assert 'DECRYPTED_UI_PRIVATE_SENTINEL_742' not in saved_text
    data=store_from_output(kind,saved_text)
    assert data['format']=='HTML_DBMS/3' and len(data['records'])>=3
    assert len(data.get('publicHeads',{}))==1
    assert not any('"F001"' in key for key in data['records'])
    assert not errors,errors
    page.close()
    return data, saved


def main():
    from tempfile import TemporaryDirectory
    with sync_playwright() as pw,TemporaryDirectory() as tmp:
        binary={'executable_path':shutil.which('chromium')} if shutil.which('chromium') else {}
        browser=pw.chromium.launch(**binary,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        html_store,html_file=scenario(browser,'html',tmp)
        xml_store,xml_file=scenario(browser,'xml',tmp)
        # Same logical workflow with shim should give identical ciphertext
        # only when clock timestamps match; cross-format transfer must be byte exact.
        for src,kind in [(html_store,'xml'),(xml_store,'html')]:
            # The second container can parse imported data, without executing it.
            page=browser.new_page(accept_downloads=True)
            page.on('dialog',lambda d:d.accept())
            setup(page,kind)
            fixture=Path(tmp)/('input.html' if src is html_store else 'input.xml')
            source_text=html_file.read_text(encoding='utf8') if src is html_store else xml_file.read_text(encoding='utf8')
            fixture.write_text(source_text,encoding='utf8')
            if kind=='xml' and os.environ.get('GITHUB_ACTIONS')=='true':
                # Playwright isolated-world set_input_files rejects a valid
                # HTMLInputElement from text/xml. Main-world File + DataTransfer
                # preserves the real file-input change handler and File.text().
                result=page.locator('#input-html').evaluate('''(e,{name,content}) => {
                    if(!(e instanceof HTMLInputElement))throw Error('Not an HTMLInputElement');
                    const dt=new DataTransfer();dt.items.add(new File([content],name,{type:'text/plain'}));
                    e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));
                    return {files:e.files.length,ctor:e.constructor.name};
                }''',{'name':fixture.name,'content':fixture.read_text('utf8')})
                assert result=={'files':1,'ctor':'HTMLInputElement'},result
            else:
                page.locator('#input-html').set_input_files(str(fixture))
            expect(page.locator('#status')).to_contain_text('Контейнер загружен')
            assert current_pair(page)==next(iter(src['publicHeads'].values()))
            page.locator('#open-head').click()
            expect(frame(page).locator('#db-title')).to_have_text('Касса')
            page.locator('#validation-toggle').click();page.locator('#verify').click()
            expect(page.locator('#validation-report')).to_contain_text('complete')
            with page.expect_download() as dl:page.locator('#save').click()
            out=Path(tmp)/('cross.xml' if kind=='xml' else 'cross.html')
            dl.value.save_as(str(out))
            assert store_from_output(kind,out.read_text(encoding='utf8'))==src
            page.close()
        browser.close()
    print('BROWSER DUAL PASS: HTML + XML namespace emulation, real iframe RPC, save/load and byte-identical physical store (INSECURE SHIM; NO genuine XML file:// navigation)')

if __name__=='__main__':
    main()
