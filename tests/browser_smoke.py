"""Chromium UI smoke under this container's blocked-navigation policy.
Uses an INSECURE cryptographic shim solely for UI wiring (real cryptography is tested by node core.test.cjs).
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json
p=Path(__file__).resolve().parent.parent/'dist/html_dbms.html'
shim="""
Object.defineProperty(crypto,'subtle',{configurable:true,value:{
 async digest(_algorithm,data){const bytes=new Uint8Array(data),out=new Uint8Array(32);let a=2166136261;for(const b of bytes){a=Math.imul(a^b,16777619)>>>0;}for(let i=0;i<32;i++){a=Math.imul(a^(i+17),16777619)>>>0;out[i]=a&255;}return out.buffer;},
 async importKey(_kind,key){return new Uint8Array(key);},
 async encrypt(_opts,key,buffer){const data=new Uint8Array(buffer),out=new Uint8Array(data.length+16);out.set(data);out.set(key.slice(0,16),data.length);return out.buffer;},
 async decrypt(_opts,key,buffer){const data=new Uint8Array(buffer);if(data.length<16||Array.from(data.slice(-16)).some((x,i)=>x!==key[i]))throw Error('bad tag');return data.slice(0,-16).buffer;}
}});
"""
with sync_playwright() as pl:
 b=pl.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(accept_downloads=True)
 errors=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 page.on('console',lambda e: errors.append(e.text) if e.type=='error' else None)
 page.evaluate(shim)
 names=iter(('Касса','Склад'))
 page.on('dialog',lambda d: d.accept(next(names) if d.type=='prompt' else None))
 page.set_content(p.read_text(),wait_until='domcontentloaded')
 assert page.locator('#databases').locator('option').count()==1
 assert page.locator('#databases').is_disabled()
 assert 'БД отсутствуют' in page.locator('#databases option').first.inner_text()
 assert 'контейнер пуст' in page.locator('#status').inner_text().lower()
 page.locator('#new-db').click()
 page.wait_for_timeout(1300)
 assert page.locator('#head-id').input_value()
 assert page.locator('#head-hash').input_value()
 iframe=page.frame_locator('iframe[title="Приложение из JSON entry"]')
 assert 'Касса' in iframe.locator('#db-title').inner_text(timeout=5000),iframe.locator('body').inner_text()
 assert 'Приложение запущено' in iframe.locator('#entry-state').inner_text()
 assert 'export async function main' not in iframe.locator('#json').inner_text()
 assert 'JS-код скрыт' in iframe.locator('#json').inner_text()
 root_id=page.locator('#head-id').input_value()
 page.locator('#head-id').fill('not-current')
 page.locator('#databases').select_option('Касса')
 assert page.locator('#head-id').input_value()==root_id
 # Selector only fills fields, it never opens automatically.
 assert iframe.locator('#db-title').inner_text()=='Касса'
 # Selection does not open automatically. Explicit "Открыть" does.
 page.locator('#open-head').click()
 page.wait_for_timeout(500)
 assert 'Открыто:' in page.locator('#status').inner_text()
 iframe=page.frame_locator('iframe[title="Приложение из JSON entry"]')
 iframe.locator('#edit-document').click()
 assert iframe.locator('#editor').is_visible()
 iframe.locator('#write').click()
 page.wait_for_timeout(650)
 assert 'example' in iframe.locator('#json').inner_text(),iframe.locator('body').inner_text()
 page.locator('#debug-toggle').click()
 page.wait_for_timeout(300)
 assert page.locator('#debug-panel').is_visible()
 assert 'raw' in page.locator('#debug-raw').inner_text()
 root_events=json.loads(page.locator('#debug-raw').inner_text())['root']['chain']['events']
 root_genesis_hash=root_events[0]['head'][1]
 page.locator('#info-toggle').click()
 assert page.locator('#info-panel').is_visible()
 assert not page.locator('#debug-panel').is_visible()
 assert 'Физических сообщений:' in page.locator('#store-summary').inner_text()
 page.locator('#validation-toggle').click()
 assert page.locator('#validation-panel').is_visible()
 assert not page.locator('#info-panel').is_visible()
 page.locator('#verify').click()
 page.wait_for_timeout(300)
 assert json.loads(page.locator('#validation-report').inner_text())['status']=='complete'
 page.locator('#anchor').fill(root_genesis_hash)
 page.locator('#verify-anchor').click()
 page.wait_for_timeout(300)
 assert json.loads(page.locator('#validation-report').inner_text())['checks']['anchorIndex']==0
 page.locator('#verify-store').click()
 page.wait_for_timeout(350)
 assert json.loads(page.locator('#validation-report').inner_text())['publishedHeads']==1
 # Two independent DBs: choosing a name only fills ID/H, then Open switches the app.
 kasa=[page.locator('#head-id').input_value(),page.locator('#head-hash').input_value()]
 page.locator('#new-db').click()
 page.wait_for_timeout(850)
 iframe=page.frame_locator('iframe[title="Приложение из JSON entry"]')
 assert iframe.locator('#db-title').inner_text(timeout=5000)=='Склад'
 sklad=[page.locator('#head-id').input_value(),page.locator('#head-hash').input_value()]
 assert kasa!=sklad
 page.locator('#databases').select_option('Касса')
 assert [page.locator('#head-id').input_value(),page.locator('#head-hash').input_value()]==kasa
 assert iframe.locator('#db-title').inner_text()=='Склад', 'Selecting is not opening'
 page.locator('#open-head').click()
 assert iframe.locator('#db-title').inner_text(timeout=5000)=='Касса'
 page.locator('#databases').select_option('Склад')
 assert [page.locator('#head-id').input_value(),page.locator('#head-hash').input_value()]==sklad
 page.locator('#open-head').click()
 assert iframe.locator('#db-title').inner_text(timeout=5000)=='Склад'
 with page.expect_download(timeout=8000) as d:page.locator('#save').click()
 f=d.value
 output=p.parent/'saved_test.html'
 f.save_as(str(output))
 exported=output.read_text()
 assert '<script id="db-store"' in exported
 assert 'example' not in exported.split('<script id="db-store"')[0]
 assert 'HTML_DBMS/3' in exported
 page.locator('#external').set_input_files(str(output))
 page.locator('#verify-file').click()
 page.wait_for_timeout(350)
 assert json.loads(page.locator('#validation-report').inner_text())['changedPhysicalSlots']==0
 # Reload via HTML content to confirm exported store opens.
 page.set_content(exported,wait_until='domcontentloaded')
 assert page.locator('#databases').input_value()=='Касса'
 assert [page.locator('#head-id').input_value(),page.locator('#head-hash').input_value()]==kasa
 assert 'нажмите «Открыть»' in page.locator('#status').inner_text()
 page.locator('#open-head').click()
 page.wait_for_timeout(650)
 iframe=page.frame_locator('iframe[title="Приложение из JSON entry"]')
 assert 'example' in iframe.locator('#json').inner_text(timeout=4000)
 assert not errors, errors
 print('UI SMOKE PASS · Empty startup/Two DB selection/Explicit Open/Starter app/Patch/Validation/Save/Auto-prefill/Reload ·',len(exported),'bytes')
 b.close()
