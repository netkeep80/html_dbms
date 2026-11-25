"""Native Web Crypto acceptance of exact Cash money, including large opposing turns.
A new synthetic-only fixture is generated in a temporary directory; no publication.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from decimal import Decimal
import hashlib,json,subprocess
from playwright.sync_api import sync_playwright,expect
from browser_network import block_service_workers
from browser_dual import store_from_output
from browser_head_url import replace_store
from compare_excel import minor,oracle,fold

ROOT=Path(__file__).resolve().parents[1]
MODES=[('Операции(ТипСущности)','entityType','Фонд'),
       ('Операции(Фонд)','entity','Фонд_F011'),
       ('Операции(Участник)','entity','Участник_A003'),
       ('Операции(Поставщик)','entity','Поставщик_B012'),
       ('Операции(Госструктуры)','entity','Организация_C001'),
       ('Участники(Фонд)','participants','Фонд_F002')]
def money(n):
 return ('-' if n<0 else '')+f'{abs(n)//100:,}'.replace(',','\u00a0')+','+f'{abs(n)%100:02}'+' ₽'
def fixture():
 f=json.loads(subprocess.check_output(['node','examples/cash/synthetic-pages.cjs'],text=True,cwd=ROOT))
 f.pop('sourceSha256');f['sourceFile']='synthetic-exact-browser-45'
 cat=f['dictionaries']['Типы Транзакций']
 cat.extend([[f'Категория_{i:02}'] for i in range(len(cat),34)])
 assert len(cat)==34
 cats=[x[0] for x in cat[1:]]
 p=('Участник','Участник_A003');fund=('Фонд','Фонд_F011');fund2=('Фонд','Фонд_F002')
 supplier=('Поставщик','Поставщик_B012');agency=('Госструктура','Организация_C001')
 date=f['period']['fromSerial']+20
 f['entries']=[]
 def add(amount,category,to,fr,dd='Да',day=date,note=None):
  n=len(f['entries'])+1
  f['entries'].append(dict(excelRow=None,n=n,date=day,toType=to[0],to=to[1],type=category,fromType=fr[0],**{'from':fr[1]},amount=amount,note=note or f'Тестовая операция {n:03}',dd=dd))
 maxrub='90071992547409.91'
 add(maxrub,cats[31],fund,p);add(maxrub,cats[32],fund,p)
 add(maxrub,cats[31],p,fund);add('90071992547409.90',cats[32],p,fund)
 add('0.29',cats[0],fund2,p);add('-0.28',cats[0],fund2,p)
 add('0.01',cats[1],p,fund2);add('0.10',cats[2],supplier,fund2)
 add('0.20',cats[2],fund2,supplier);add('0.01',cats[3],agency,fund2)
 add('0.02',cats[3],fund2,agency)
 add('0.03',cats[32],fund,fund);add('0.05',cats[32],fund,p,'Нет',note='Уникальный ДД Нет')
 add('0.08',cats[32],fund,p,day=f['period']['toSerial']+1)
 f['sourceSha256']=hashlib.sha256(json.dumps(f,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 return f
def raw(rows):
 return [(r['date'],r['toType'],r['to'],r['type'],r['fromType'],r['from'],minor(Decimal(r['amount'])),r['dd']) for r in rows]
def app_frame(page):return page.frame_locator('#entry-area iframe')
def tab(app,name):app.locator('#cash-tabs').get_by_role('button',name=name,exact=True).click()
def verify_reports(app,f):
 checks=0
 for name,mode,selector in MODES:
  tab(app,name)
  categories=[x[0] for x in f['dictionaries']['Участники' if mode=='participants' else 'Типы Транзакций'][1:]]
  expected=oracle(raw(f['entries']),fold(selector),categories,mode,f['period'])
  expect(app.locator('.report tbody tr')).to_have_count(len(categories)+1)
  cells=app.locator('.report tbody tr').evaluate_all("rows=>rows.map(r=>Array.from(r.cells,c=>c.textContent))")
  sums=[sum(row[i] for row in expected) for i in range(3)]
  assert cells==[['ИТОГО',*[money(v) for v in sums]]]+[[c,*[money(v) for v in vals]] for c,vals in zip(categories,expected)],'Incorrect report cells: '+name
  expect(app.locator('.histogram svg')).to_be_visible()
  assert app.locator('.histogram svg rect title').all_text_contents()==[c+': '+money(vals[2]) for c,vals in zip(categories,expected)],'Incorrect chart tooltips'
  labels=app.locator('.histogram svg text').all_text_contents()
  assert [labels[2*i+1] for i in range(len(categories))]==[money(vals[2]) for vals in expected],'Incorrect chart labels'
  checks+=3*(len(categories)+1)+2*len(categories)
 return checks
def verify_ledger(app,f,needle=''):
 tab(app,'Транзакции')
 search=app.locator('input[placeholder="Поиск в транзакциях"]')
 search.fill(needle);search.press('Tab')
 selected=[r for r in f['entries'] if f['period']['fromSerial']<=r['date']<=f['period']['toSerial'] and (not needle or needle in r['note'])]
 expect(app.locator('.ledger tbody tr')).to_have_count(len(selected))
 inc=sum(minor(Decimal(r['amount'])) for r in selected if r['toType']=='Фонд')
 out=sum(minor(Decimal(r['amount'])) for r in selected if r['fromType']=='Фонд')
 assert app.locator('.summary .metric strong').all_text_contents()==[money(inc),money(out),money(inc-out),str(len(selected))],'Incorrect ledger totals'
 assert app.locator('.ledger tbody tr td:nth-child(8)').all_text_contents()==[money(minor(Decimal(r['amount']))) for r in selected],'Incorrect ledger row money'
def main():
 with TemporaryDirectory(prefix='hdbms-exact-cash-') as tmp:
  tmp=Path(tmp);f=fixture();source=tmp/'fixture.json';html=tmp/'cash.html'
  source.write_text(json.dumps(f,ensure_ascii=False),encoding='utf8')
  subprocess.run(['node','examples/cash/build-demo.cjs',str(source),str(html)],check=True,cwd=ROOT)
  initial=json.loads(json.dumps(f,ensure_ascii=False))
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   ctx=browser.new_context(accept_downloads=True)
   errors=[];network=[];dialogs=[];accept={'write':True}
   block_service_workers(ctx,network)
   ctx.route('http**/*',lambda r:r.abort())
   ctx.on('request',lambda r:network.append(r.url) if r.url.startswith(('http:','https:')) else None)
   def monitor(p):
    p.on('pageerror',lambda e:errors.append(str(e)))
    p.on('websocket',lambda w:network.append(w.url))
    def dialog(d):
     dialogs.append(d.message)
     assert d.type=='confirm'
     d.accept() if accept['write'] else d.dismiss()
    p.on('dialog',dialog)
   ctx.on('page',monitor);page=ctx.new_page()
   page.goto(html.as_uri(),wait_until='domcontentloaded')
   assert page.evaluate('isSecureContext && !!crypto.subtle')
   app=app_frame(page)
   expect(app.locator('#cash-count')).to_contain_text(str(len(f['entries']))+' операций')
   root0=page.locator('#head').input_value()
   checks=verify_reports(app,f)
   verify_ledger(app,f);verify_ledger(app,f,'Уникальный ДД Нет');verify_ledger(app,f)
   app.get_by_role('button',name='+ Транзакция',exact=True).click()
   amount=app.locator('input[name="amount"]')
   submit=app.get_by_role('button',name='Записать транзакцию',exact=True)
   before=len(dialogs)
   for text,error in [('','Некорректная сумма'),('1.005','Некорректная сумма'),('1e2','Некорректная сумма'),('90071992547409.92','вне допустимого диапазона')]:
    amount.fill(text);submit.click();expect(app.locator('.form-error')).to_contain_text(error)
    assert page.locator('#head').input_value()==root0 and len(dialogs)==before
   accept['write']=False;amount.fill('0,29');submit.click()
   expect(app.locator('.form-error')).to_contain_text('отменена')
   assert page.locator('#head').input_value()==root0
   accept['write']=True
   # Create a new category through the actual application and append to it.
   app.get_by_role('button',name='Отмена',exact=True).click()
   tab(app,'Справочники');app.locator('.dict-nav').get_by_role('button',name='Типы Транзакций',exact=True).click()
   app.get_by_role('button',name='+ Запись',exact=True).click()
   app.locator('input[name="name"]').fill('Категория_34')
   app.get_by_role('button',name='Добавить запись',exact=True).click()
   expect(app.locator('#cash-msg')).to_contain_text('Добавлена запись')
   f['dictionaries']['Типы Транзакций'].append(['Категория_34'])
   tab(app,'Транзакции')
   for text,canonical,stored in [('0,29','0.29',29),('-0.28','-0.28',-28),('-0,00','0.00',0)]:
    head=page.locator('#head').input_value()
    app.get_by_role('button',name='+ Транзакция',exact=True).click()
    app.locator('select[name="toId"]').select_option(label='Фонд_F011')
    app.locator('select[name="fromId"]').select_option(label='Участник_A003')
    app.locator('select[name="typeId"]').select_option(label='Категория_34')
    app.locator('input[name="amount"]').fill(text)
    app.locator('.form textarea').fill('Новая точная проводка')
    app.get_by_role('button',name='Записать транзакцию',exact=True).click()
    # The previous success text may still be visible during a pending RPC.
    # Require the NEW HEAD and row count before interpreting the message.
    expect(page.locator('#head')).not_to_have_value(head,timeout=20000)
    expect(app.locator('#cash-count')).to_contain_text(str(len(f['entries'])+1)+' операций',timeout=20000)
    expect(app.locator('input[name="amount"]')).to_have_count(0)
    expect(app.locator('#cash-msg')).to_contain_text('Транзакция добавлена')
    f['entries'].append(dict(date=f['period']['toSerial'],toType='Фонд',to='Фонд_F011',fromType='Участник',**{'from':'Участник_A003'},type='Категория_34',amount=canonical,note='Новая точная проводка',dd='Да'))
   checks+=verify_reports(app,f);verify_ledger(app,f)
   page.locator('#validation-toggle').click();page.locator('#verify').click()
   expect(page.locator('#validation-report')).to_contain_text('"status": "complete"')
   page.locator('#validation-toggle').click()
   with page.expect_download() as dl:page.locator('#save').click()
   saved=tmp/'saved.html';dl.value.save_as(saved)
   raw_store=store_from_output('html',saved.read_text('utf8'))
   other=ctx.new_page();other.goto(saved.as_uri(),wait_until='domcontentloaded')
   reopened=app_frame(other)
   expect(reopened.locator('#cash-count')).to_contain_text(str(len(f['entries']))+' операций')
   assert other.evaluate("document.querySelectorAll('#db-store').length===1 && document.querySelector('#db-store').textContent===''")
   recovered=other.evaluate("""async raw=>{
    const db=HTML_DBMS,s=db.adoptStore(raw),head=db.catalog(s)['Касса'],r=await db.readState(s,head),t=await db.readState(s,r.$refs.transactions);
    return t.rows.slice(-3).map(row=>[row.amountMinor,Object.hasOwn(row,'amount')]);
   }""",raw_store)
   assert recovered==[[29,False],[-28,False],[0,False]]
   checks+=verify_reports(reopened,f);verify_ledger(reopened,f)
   other.locator('#head').fill(root0);other.locator('#open-head').click()
   expect(reopened.locator('#cash-count')).to_contain_text(str(len(initial['entries']))+' операций')
   checks+=verify_reports(reopened,initial);verify_ledger(reopened,initial)
   # Validly encrypted but financially invalid row, outside period: fail closed.
   bad=other.evaluate("""async raw=>{
    const db=HTML_DBMS,s=db.adoptStore(raw),h=db.catalog(s)['Касса'],root=await db.readState(s,h),t=await db.readState(s,root.$refs.transactions);
    const r=await db.patchDocument(s,h,'transactions',[{op:'add',path:'/rows/-',value:{...t.rows[0],amountMinor:null,date:t.period.toSerial+100}}]);
    db.commit(s,r.store);db.publish(s,'Касса',r.rootHead,h);return db.snapshot(s);
   }""",raw_store)
   damaged=tmp/'invalid.html';damaged.write_text(replace_store(saved.read_text('utf8'),'html',bad),encoding='utf8')
   other.goto(damaged.as_uri(),wait_until='domcontentloaded')
   expect(app_frame(other).locator('#app')).to_contain_text('Некорректная денежная запись')
   assert app_frame(other).locator('.summary,.report').count()==0
   assert not errors,errors
   assert not network,network
   ctx.close();browser.close()
 print(f'CASH NATIVE EXACT PASS: {checks} report/chart money cells, 33/34 categories, invalid input no write, cancel, signed/zero writes, save/reopen, historical HEAD, invalid excluded row fail closed')
if __name__=='__main__':main()
