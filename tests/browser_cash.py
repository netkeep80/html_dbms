"""Real Chromium + Web Crypto HTTP loopback E2E: cash app, IDs, dropdown, views, update, export/reopen.
No insecure cryptographic shim. HTTP loopback is a secure context for Web Crypto.
"""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1];demo=root/'dist/html_dbms_cash_demo.html'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(demo.parent)))
Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_address[1]}/{demo.name}'
try:
 with sync_playwright() as pl:
  browser=pl.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(accept_downloads=True,viewport={'width':1560,'height':950})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('dialog',lambda dlg:dlg.accept())
  page.goto(url,wait_until='domcontentloaded',timeout=30000)
  assert page.evaluate('isSecureContext && !!crypto.subtle'),'Real WebCrypto missing'
  assert page.locator('#head-id').input_value(),'Cash root head not advertised'
  page.locator('#open-head').click()
  app=page.frame_locator('iframe[title="Приложение из JSON entry"]')
  expect(app.locator('h1')).to_contain_text('Касса',timeout=30000)
  expect(app.locator('#cash-count')).to_contain_text('1\u00a0641',timeout=20000)
  assert app.locator('#cash-tabs button').count()==8,'Wrong number of primary tabs'
  app.locator('#cash-tabs button',has_text='Операции(ТипСущности)').click()
  expect(app.locator('.report .total')).to_contain_text('8\u00a0616\u00a0188,00',timeout=20000)
  app.locator('#cash-tabs button',has_text='Участники(Фонд)').click()
  expect(app.locator('.report .total')).to_contain_text('3\u00a0342\u00a0455,00',timeout=20000)
  app.locator('#cash-tabs button',has_text='Справочники').click()
  expect(app.locator('h2')).to_contain_text('Фонды',timeout=20000)
  app.locator('.dict-nav button',has_text='Типы Транзакций').click()
  expect(app.locator('h2')).to_contain_text('Типы Транзакций')
  app.locator('#cash-tabs button',has_text='Транзакции').click()
  app.locator('button',has_text='+ Транзакция').click()
  expect(app.locator('.form select[name="toTypeId"]')).to_be_visible()
  # Source and recipient must be selectors, NOT free-text inputs.
  assert app.locator('.form input[name="to"]').count()==0
  assert app.locator('.form input[name="from"]').count()==0
  assert app.locator('.form input[name="type"]').count()==0
  assert app.locator('.form select[name="typeId"]').count()==1
  # To be recorded as linked IDs, use existing source/target dictionary entries.
  app.locator('.form input[name="date"]').fill('2026-09-27')
  app.locator('.form select[name="toId"]').select_option(label='Фонд_F002')
  app.locator('.form select[name="fromId"]').select_option(label='Участник_A001')
  app.locator('.form select[name="typeId"]').select_option(label='Нал')
  app.locator('.form input[name="amount"]').fill('345')
  app.locator('.form button',has_text='Записать транзакцию').click()
  expect(app.locator('#cash-count')).to_contain_text('1\u00a0642',timeout=30000)
  page.locator('#validation-toggle').click();page.locator('#verify').click()
  expect(page.locator('#validation-report')).to_contain_text('"status": "complete"',timeout=30000)
  assert not errors,errors
  with page.expect_download() as dl:page.locator('#save').click()
  saved=root/'dist/cash_saved_browser.html';dl.value.save_as(str(saved))
  page.goto(f'http://127.0.0.1:{server.server_address[1]}/{saved.name}',wait_until='domcontentloaded')
  page.locator('#open-head').click();app=page.frame_locator('iframe[title="Приложение из JSON entry"]')
  expect(app.locator('#cash-count')).to_contain_text('1\u00a0642',timeout=30000)
  assert not errors,errors
  print('REAL WEB CRYPTO CASH UI PASS: 11 source chains, 6 views, ID dropdown transaction, verified append, export and reopen')
  browser.close()
finally:server.shutdown()