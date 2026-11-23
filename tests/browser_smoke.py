"""Browser UI regression with intentionally INSECURE WebCrypto shim.

For browser behavior only: real AES-GCM/SHA-256 are covered in core.test.cjs.
Must test real DOM interaction, both modal decisions, file import/export and
failure states. Local navigation is prohibited by this test environment.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

HTML = Path(__file__).resolve().parent.parent/'dist/html_dbms.html'
SHIM = """
Object.defineProperty(crypto,'subtle',{configurable:true,value:{
 async digest(_algorithm,data){const bytes=new Uint8Array(data),out=new Uint8Array(32);let a=2166136261;for(const b of bytes){a=Math.imul(a^b,16777619)>>>0;}for(let i=0;i<32;i++){a=Math.imul(a^(i+17),16777619)>>>0;out[i]=a&255;}return out.buffer;},
 async importKey(_kind,key){return new Uint8Array(key);},
 async encrypt(_opts,key,buffer){const data=new Uint8Array(buffer),out=new Uint8Array(data.length+16);out.set(data);out.set(key.slice(0,16),data.length);return out.buffer;},
 async decrypt(_opts,key,buffer){const data=new Uint8Array(buffer);if(data.length<16||Array.from(data.slice(-16)).some((x,i)=>x!==key[i]))throw Error('bad tag');return data.slice(0,-16).buffer;}
}});
"""

def pair(page):
    return (page.locator('#head-id').input_value(),page.locator('#head-hash').input_value())

def fill_pair(page,p):
    page.locator('#head-id').fill(p[0]);page.locator('#head-hash').fill(p[1])

def choose(page,name):
    page.locator('#databases').select_option(name)
    assert page.locator('#databases').input_value()=='', 'head-picker must reset immediately to placeholder'

def frame(page):
    return page.frame_locator('iframe[title="Приложение из JSON entry"]')

with sync_playwright() as pl:
    browser=pl.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(accept_downloads=True)
    errors=[];prompts=iter(['Касса','Склад'])
    confirmation_policy={'overwrite':False}; dialogs=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    def dialog_handler(d):
        dialogs.append((d.type,d.message))
        if d.type=='prompt': d.accept(next(prompts))
        elif 'ФИЗИЧЕСКУЮ ПЕРЕЗАПИСЬ' in d.message:
            d.accept() if confirmation_policy['overwrite'] else d.dismiss()
        else: d.accept()
    page.on('dialog',dialog_handler)
    page.evaluate(SHIM)
    page.set_content(HTML.read_text(encoding='utf8'),wait_until='domcontentloaded')
    expect(page.locator('#databases')).to_be_disabled()
    expect(page.locator('#status')).to_contain_text('Контейнер пуст')

    page.locator('#new-db').click();expect(frame(page).locator('#db-title')).to_have_text('Касса')
    kasa=pair(page)
    # No iframe modal dialogs: the starter must provide a real form.
    before=len(dialogs)
    frame(page).locator('#add-document').click()
    expect(frame(page).locator('#new-document')).to_be_visible()
    frame(page).locator('#new-document-name').fill('funds')
    frame(page).locator('#new-document-json').fill('{"F001":{"name":"Основной"}}')
    frame(page).locator('#create-document').click()
    expect(frame(page).locator('#message')).to_contain_text('Документ создан')
    assert len(dialogs)==before+1 and dialogs[-1][0]=='confirm', 'Only parent write approval allowed'
    root_after_doc=pair(page)
    assert root_after_doc!=kasa
    expect(frame(page).locator('#document-title')).to_contain_text('funds')

    page.locator('#new-db').click();expect(frame(page).locator('#db-title')).to_have_text('Склад')
    sklad=pair(page)
    assert root_after_doc!=sklad
    # User selection only fills the fields. Repeat same selection after manual edit.
    choose(page,'Касса')
    assert pair(page)==root_after_doc
    assert frame(page).locator('#db-title').inner_text()=='Склад'
    page.locator('#head-id').fill('not-current')
    choose(page,'Касса')
    assert pair(page)==root_after_doc,'repeat choosing same alias must restore head'
    page.locator('#open-head').click()
    expect(frame(page).locator('#db-title')).to_have_text('Касса')
    page.locator('#info-toggle').click()
    expect(page.locator('#current-root')).to_contain_text('Касса')
    expect(page.locator('#store-summary')).to_contain_text('байт')
    page.locator('#info-toggle').click()
    # Pending head fields must not enable writes to a different active root.
    fill_pair(page,sklad)
    frame(page).locator('#edit-document').click()
    frame(page).locator('#write').click()
    expect(frame(page).locator('#message')).to_contain_text('отличаются от открытой БД')
    # Restore active state by explicit Open.
    fill_pair(page,root_after_doc)
    page.locator('#open-head').click()
    expect(frame(page).locator('#db-title')).to_have_text('Касса')
    # Failed Open must revoke old app entirely.
    page.locator('#head-id').fill('invalid')
    page.locator('#open-head').click()
    expect(page.locator('#entry-area iframe')).to_have_count(0)
    expect(page.locator('#status')).to_contain_text('ID')
    page.locator('#info-toggle').click()
    expect(page.locator('#current-root')).to_contain_text('Открытая версия: —')
    page.locator('#info-toggle').click()
    # Select published root again and open explicitly.
    choose(page,'Касса');page.locator('#open-head').click()
    expect(frame(page).locator('#db-title')).to_have_text('Касса')

    # Create one occupied successor by editing the current root twice from
    # the same old head: 1st branch exists; 2nd requires explicit overwrite.
    root_before_write=pair(page)
    frame(page).locator('#edit-document').click()
    frame(page).locator('#patch').fill('[{"op":"add","path":"/note","value":"old"}]')
    frame(page).locator('#write').click()
    expect(frame(page).locator('#message')).to_contain_text('Изменение записано')
    earlier_branch=pair(page)
    assert earlier_branch!=root_before_write
    fill_pair(page,root_before_write);page.locator('#open-head').click()
    expect(frame(page).locator('#db-title')).to_have_text('Касса')
    frame(page).locator('#edit-document').click()
    frame(page).locator('#patch').fill('[{"op":"add","path":"/note","value":"new"}]')
    frame(page).locator('#write').click()
    expect(frame(page).locator('#message')).to_contain_text('Физическая перезапись отменена')
    assert pair(page)==root_before_write
    confirmation_policy['overwrite']=True
    frame(page).locator('#write').click()
    expect(frame(page).locator('#message')).to_contain_text('Изменение записано')
    replaced_branch=pair(page)
    assert replaced_branch!=earlier_branch
    assert any('ФИЗИЧЕСКУЮ ПЕРЕЗАПИСЬ' in message for _,message in dialogs)
    page.locator('#debug-toggle').click()
    expect(page.locator('#debug-panel')).to_be_visible()
    page.locator('#debug-toggle').click()

    # The compare must show deleted, added and changed physical IDs separately.
    with page.expect_download() as dl:page.locator('#save').click()
    saved=HTML.parent/'audit_saved_browser.html';dl.value.save_as(str(saved))
    text=saved.read_text(encoding='utf8')
    from re import search
    match=search(r'<script id="db-store" type="application/json">(.*?)</script>',text)
    assert match
    store=json.loads(match.group(1))
    common=next(iter(store['records']))
    mutated=json.loads(json.dumps(store));del mutated['records'][common]
    fake='AAAAAAAAAAAAAAAAAAAAAA'
    assert fake not in mutated['records']
    mutated['records'][fake]='AAAAAAAAAAAAAAAAAAAAAA'
    changing=next(iter(mutated['records']))
    mutated['records'][changing]='AAAAAAAAAAAAAAAAAAAAAA'
    modified=text[:match.start(1)]+json.dumps(mutated,ensure_ascii=False)+text[match.end(1):]
    external=HTML.parent/'audit_external.html';external.write_text(modified,encoding='utf8')
    page.locator('#validation-toggle').click()
    page.locator('#external').set_input_files(str(external))
    page.locator('#verify-file').click()
    expect(page.locator('#validation-report')).to_contain_text('missingIds')
    result=json.loads(page.locator('#validation-report').inner_text())
    assert common in result['missingIds'],result
    assert fake in result['addedIds'],result
    assert changing in result['changedIds'],result
    assert not errors,errors
    print('UI REGRESSIONS PASS: genuine form, stateless picker, pending/failed Open, explicit overwrite cancel/accept, saved-file physical diff')
    browser.close()
