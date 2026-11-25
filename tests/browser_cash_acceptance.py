"""Native Cash acceptance: actual shell, isolated iframe, RPC and JSON Patch.
Real Web Crypto on file://, temporary source and exported snapshots; no shim.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess, json
from playwright.sync_api import sync_playwright, expect
from browser_network import block_service_workers

root = Path(__file__).resolve().parents[1]

def assert_production_fixture(candidate):
    """All bytes except the physical JSON payload must equal current production."""
    import re
    pattern=rb'(<script id="db-store" type="application/json">)([\s\S]*?)(</script>)'
    production=(root/'dist/html_dbms.html').read_bytes()
    def without_store(data):
        assert len(list(re.finditer(pattern,data)))==1,'Expected exactly one physical store'
        assert b'<script id="cash-demo-source"' not in data,'Unexpected trusted entry'
        return re.sub(pattern,lambda m:m.group(1)+m.group(3),data)
    expected=without_store(production)
    actual=candidate.read_bytes()
    assert without_store(actual)==expected,'Fixture shell differs from production bytes'
    # Negative controls: historical executable or an altered executable byte must fail.
    historical=(root/'dist/html_dbms_cash_demo.html').read_bytes()
    try:
        same=without_store(historical)==expected
    except AssertionError:
        same=False
    assert not same,'Historical demo unexpectedly accepted'
    mutated=actual.replace(b'<script id="app-source">',b'<script id="app-source"> ',1)
    assert mutated!=actual and without_store(mutated)!=expected,'Executable mutation not detected'
    print('CASH RPC FIXTURE IDENTITY PASS: all non-store bytes equal production; historical/mutated shell rejected')

def assert_live_store_cleared(page):
    # Verify actual DOM textContent, not normalized locator text. Retry only until
    # the same exact invariant holds; include size-only diagnostics on failure.
    try:
        page.wait_for_function("""()=>{const nodes=document.querySelectorAll('#db-store');return nodes.length===1&&nodes[0].textContent===''}""",timeout=5000)
    except Exception as error:
        metadata=page.evaluate("""()=>Array.from(document.querySelectorAll('#db-store'),n=>({length:n.textContent.length,children:n.childNodes.length,type:n.type}))""")
        raise AssertionError('Live ciphertext was not cleared: '+str(metadata)) from error
    assert page.evaluate("""()=>document.querySelector('#db-store').textContent===''""")

def frame(page):
    return page.frame_locator('iframe[title="Приложение из JSON entry"]')

def dict_page(page, name):
    app=frame(page)
    app.locator('#cash-tabs button',has_text='Справочники').click()
    app.locator('.dict-nav button',has_text=name).click()
    return app

with TemporaryDirectory(prefix='cash_ui_acceptance_') as tmp:
    fixture=Path(tmp)/'native_cash_browser_ui.html'
    subprocess.run(['node',str(root/'tests/build_ui_integration_fixture.cjs'),str(fixture)],check=True)
    assert_production_fixture(fixture)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(args=['--no-sandbox','--disable-dev-shm-usage'],headless=True)
        context=browser.new_context(viewport={'width':1520,'height':900},accept_downloads=True)
        errors=[]; dialogs=[]; unexpected=[]; allow={'write':True}
        block_service_workers(context,unexpected)
        context.on('request',lambda r:unexpected.append(r.url) if r.url.startswith(('http:','https:')) else None)
        context.route('http**/*',lambda r:r.abort())
        page=context.new_page()
        page.on('websocket',lambda w:unexpected.append(w.url))
        page.on('pageerror',lambda err:errors.append(str(err)))
        def handle_dialog(d):
            dialogs.append((d.type,d.message))
            if d.type!='confirm':
                raise AssertionError('Unexpected modal: '+d.type)
            d.accept() if allow['write'] else d.dismiss()
        page.on('dialog',handle_dialog)
        page.goto(fixture.as_uri(),wait_until='domcontentloaded')
        assert page.evaluate('isSecureContext && !!crypto.subtle')
        # The fixture is built from the universal shell, with no trusted demo-source tag.
        # Require the explicit launch gate, never modify the production trust policy.
        expect(page.locator('.entry-launch')).to_be_visible(timeout=30000)
        page.locator('.entry-launch').click()
        app=frame(page)
        expect(app.locator('h1')).to_contain_text('Касса',timeout=30000)
        assert page.locator('#entry-area iframe').get_attribute('sandbox')=='allow-scripts', 'Sandbox must remain restrictive'
        assert_live_store_cleared(page)
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
        # Full cryptographic graph validation at UI shell level with native Web Crypto.
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
        second=context.new_page()
        second.on('pageerror',lambda err:errors.append(str(err)))
        second.on('websocket',lambda w:unexpected.append(w.url))
        second.goto(saved_path.as_uri(),wait_until='domcontentloaded')
        assert second.evaluate('isSecureContext && !!crypto.subtle')
        expect(second.locator('.entry-launch')).to_be_visible(timeout=20000)
        second.locator('.entry-launch').click()
        app2=frame(second)
        expect(app2.locator('h1')).to_contain_text('Касса',timeout=20000)
        expect(app2.locator('#cash-count')).to_contain_text('21',timeout=20000)
        dict_page(second,'Типы Транзакций')
        expect(app2.locator('.gridbox tbody tr').filter(has_text=first_id)).to_contain_text('Тестовая категория 2')
        assert app2.locator('.gridbox thead').get_by_text('Строка Excel').count()==0
        app2.locator('.dict-nav button',has_text='Проекты').click()
        expect(app2.locator('.gridbox tbody tr').filter(has_text=project_id)).to_contain_text('Проект Б')
        # Inspect recovered JSON, not just visual cells.
        assert_live_store_cleared(second)
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
        assert not unexpected, unexpected
        print('CASH FULL SHELL RPC ACCEPTANCE PASS: cancel/confirm, add/edit/create dictionary, transaction, 12 JSON chains, verify, export, reload; sandbox allow-scripts (no allow-forms); NATIVE WEB CRYPTO, no external requests')
        context.close();browser.close()
