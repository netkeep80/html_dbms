"""Cash v3 acceptance: real outer HTML shell + sandboxed iframe + RPC + JSON patch.

Covers clicks (not fake db methods), write authorization, persistent crypto-chain state,
export/reopen, history and Excel row removal. Crypto shim is INTENTIONALLY INSECURE;
run tests/cash_crud.test.cjs and tests/compare_excel.py separately with real Node WebCrypto.
No external browser navigation is needed in this environment.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess, json
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
SHIM = """
Object.defineProperty(crypto,'subtle',{configurable:true,value:{
 async digest(_algorithm,data){const bytes=new Uint8Array(data),out=new Uint8Array(32);for(let k=0;k<8;k++){let a=(2166136261^(k*0x9e3779b1))>>>0;for(const b of bytes){a=Math.imul(a^(b+k),16777619)>>>0;a^=a>>>13;}for(let j=0;j<4;j++)out[k*4+j]=(a>>>(8*j))&255;}return out.buffer;},
 async importKey(_kind,key){return new Uint8Array(key);},
 async encrypt(_opts,key,buffer){const data=new Uint8Array(buffer),out=new Uint8Array(data.length+16);out.set(data);out.set(key.slice(0,16),data.length);return out.buffer;},
 async decrypt(_opts,key,buffer){const data=new Uint8Array(buffer);if(data.length<16||Array.from(data.slice(-16)).some((x,i)=>x!==key[i]))throw Error('bad tag');return data.slice(0,-16).buffer;}
}});
"""

def frame(page):
    return page.frame_locator('iframe[title="Приложение из JSON entry"]')

def dict_page(page, name):
    app=frame(page)
    app.locator('#cash-tabs button',has_text='Справочники').click()
    app.locator('.dict-nav button',has_text=name).click()
    return app

with TemporaryDirectory(prefix='cash_ui_acceptance_') as tmp:
    fake_html=Path(tmp)/'fake_crypto_browser_ui.html'
    subprocess.run(['node',str(root/'tests/build_ui_integration_fixture.cjs'),str(fake_html)],check=True)
    with sync_playwright() as pw:
        system_chromium=next((p for p in (Path('/usr/bin/google-chrome'),Path('/usr/bin/chromium')) if p.exists()),None)
        binary={'executable_path':str(system_chromium)} if system_chromium else {}
        browser=pw.chromium.launch(**binary,args=['--no-sandbox','--disable-dev-shm-usage'],headless=True)
        page=browser.new_page(viewport={'width':1520,'height':900},accept_downloads=True)
        errors=[]; dialogs=[]; allow={'write':True}
        page.on('pageerror',lambda err:errors.append(str(err)))
        def handle_dialog(d):
            dialogs.append((d.type,d.message))
            if d.type!='confirm':
                raise AssertionError('Unexpected modal: '+d.type)
            d.accept() if allow['write'] else d.dismiss()
        page.on('dialog',handle_dialog)
        page.evaluate(SHIM)
        page.set_content(fake_html.read_text(encoding='utf8'),wait_until='domcontentloaded')
        app=frame(page)
        expect(app.locator('h1')).to_contain_text('Касса',timeout=30000)
        assert page.locator('#entry-area iframe').get_attribute('sandbox')=='allow-scripts', 'Sandbox must remain restrictive'
        head_before=page.locator('#head').input_value()
        dict_page(page,'Типы Транзакций')
        # User requested no Excel source line numbers either in UI or dictionary JSON.
        assert app.locator('.gridbox thead').get_by_text('Строка Excel').count()==0
        # Cancellation must not mutate any record or head, and error must appear next to action.
        app.locator('.dict-actions button',has_text='+ Запись').click()
        app.locator('input[name="name"]').fill('Тестовая категория')
        allow['write']=False
        app.get_by_role('button',name='Добавить запись',exact=True).click()
        expect(app.locator('.form-error')).to_contain_text('отменена',timeout=15000)
        assert page.locator('#head').input_value()==head_before
        assert app.locator('button',has_text='Добавить запись').is_enabled()
        allow['write']=True
        app.get_by_role('button',name='Добавить запись',exact=True).click()
        expect(app.locator('#cash-msg')).to_contain_text('Добавлена запись',timeout=20000)
        assert len(dialogs)>=2
        first_id='transactionTypes-0001'
        assert app.locator('.gridbox tbody tr').count()==33
        assert app.locator('.gridbox').get_by_text('Тестовая категория').count()==1
        first_head=page.locator('#head').input_value()
        assert first_head!=head_before,'Append must move root head'
        # Edit existing row and verify ID stable.
        app.locator('.gridbox tbody tr').filter(has_text=first_id).get_by_role('button',name='Изменить').click()
        app.locator('input[name="name"]').fill('Тестовая категория 2')
        app.get_by_role('button',name='Сохранить изменения',exact=True).click()
        expect(app.locator('#cash-msg')).to_contain_text('Изменена запись',timeout=20000)
        assert app.locator('.gridbox tbody tr').filter(has_text=first_id).get_by_text('Тестовая категория 2').count()==1
        # Validation failures must be actionable inline, not silently ignored.
        app.locator('.dict-actions button',has_text='+ Запись').click()
        app.locator('input[name="name"]').fill('тЕсТоВаЯ КаТеГоРиЯ 2')
        app.get_by_role('button',name='Добавить запись',exact=True).click()
        expect(app.locator('.form-error')).to_contain_text('уже есть',timeout=5000)
        app.locator('.dict-actions button',has_text='+ Запись').click() # hide form
        # Create new independent JSON document through the same message boundary.
        app.locator('.dict-actions button',has_text='+ Справочник').click()
        app.locator('input[name="alias"]').fill('projects')
        app.locator('input[name="title"]').fill('Проекты')
        app.get_by_role('button',name='Создать справочник',exact=True).click()
        expect(app.locator('#cash-msg')).to_contain_text('создан',timeout=20000)
        expect(app.locator('h2')).to_contain_text('Проекты')
        expect(app.locator('#cash-count')).to_contain_text('11 справочников')
        app.locator('.dict-actions button',has_text='+ Запись').click()
        app.locator('input[name="name"]').fill('Проект А')
        app.get_by_role('button',name='Добавить запись',exact=True).click()
        expect(app.locator('.gridbox')).to_contain_text('Проект А',timeout=20000)
        project_id='projects-0001'
        app.locator('.gridbox tbody tr').filter(has_text=project_id).get_by_role('button',name='Изменить').click()
        app.locator('input[name="name"]').fill('Проект Б')
        app.get_by_role('button',name='Сохранить изменения',exact=True).click()
        expect(app.locator('.gridbox tbody tr').filter(has_text=project_id)).to_contain_text('Проект Б',timeout=20000)
        # Also guard the shared form bug in transaction insertion.
        app.locator('#cash-tabs button',has_text='Транзакции').click()
        app.get_by_role('button',name='+ Транзакция').click()
        app.locator('.form input[name="date"]').fill('2026-09-27')
        app.locator('.form input[name="amount"]').fill('321,29')
        app.get_by_role('button',name='Записать транзакцию').click()
        expect(app.locator('#cash-count')).to_contain_text('21',timeout=20000)
        # Full cryptographic graph validation at UI shell level (using deterministic test shim).
        page.locator('#validation-toggle').click()
        page.locator('#verify').click()
        expect(page.locator('#validation-report')).to_contain_text('"status": "complete"',timeout=20000)
        assert '"documents": 12' in page.locator('#validation-report').inner_text()
        with page.expect_download() as download_info:
            page.locator('#save').click()
        saved_path=Path(tmp)/'saved.html'
        download_info.value.save_as(saved_path)
        saved=saved_path.read_text(encoding='utf8')
        assert '<script id="db-store" type="application/json">' in saved
        # Reopen in fresh browser tab; actual shell bootstraps from exported ciphertext.
        second=browser.new_page(viewport={'width':1520,'height':900})
        second.on('pageerror',lambda err:errors.append(str(err)))
        second.evaluate(SHIM)
        second.set_content(saved,wait_until='domcontentloaded')
        app2=frame(second)
        expect(app2.locator('h1')).to_contain_text('Касса',timeout=20000)
        expect(app2.locator('#cash-count')).to_contain_text('21',timeout=20000)
        dict_page(second,'Типы Транзакций')
        expect(app2.locator('.gridbox tbody tr').filter(has_text=first_id)).to_contain_text('Тестовая категория 2')
        assert app2.locator('.gridbox thead').get_by_text('Строка Excel').count()==0
        app2.locator('.dict-nav button',has_text='Проекты').click()
        expect(app2.locator('.gridbox tbody tr').filter(has_text=project_id)).to_contain_text('Проект Б')
        # Inspect recovered JSON, not just visual cells.
        assert second.locator('#db-store').text_content()==''
        from browser_dual import store_from_output
        data=second.evaluate('''async raw=>{
          const db=HTML_DBMS,s=db.adoptStore(raw),h=raw.publicHeads['Касса'];
          const root=await db.readState(s,h),docs={};
          for(const name of Object.keys(root.$refs))docs[name]=await db.readState(s,root.$refs[name]);
          return {amountMinor:docs.transactions.rows.at(-1).amountMinor,count:docs.transactions.rows.length,keys:Object.keys(root.$refs),types:docs.transactionTypes,projects:docs.projects,history:(await db.verifyDatabase(s,h)).status,withoutExcelRows:Object.values(docs).filter(v=>v.entries).every(d=>d.order.every(id=>!('excelRow' in d.entries[id])))};
        }''',store_from_output('html',saved))
        assert data['count']==21 and data['amountMinor']==32129
        assert len(data['keys'])==12
        assert data['types']['entries'][first_id]['name']=='Тестовая категория 2'
        assert data['projects']['entries'][project_id]['name']=='Проект Б'
        assert data['history']=='complete'
        assert data['withoutExcelRows']
        assert not errors, errors
        print('CASH FULL SHELL RPC ACCEPTANCE PASS: cancel/confirm, add/edit/create dictionary, transaction, 12 JSON chains, verify, export, reload; sandbox allow-scripts (no allow-forms); insecure shim ONLY for browser transport')
        browser.close()
