"""Actual Cash entry UI without cryptographic shim; mock only host RPC/data transport.
The underlying demo is independently decrypted and verified by compare_excel.py.
"""
import json,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
source=(root/'examples/cash/cash-entry.js').read_text()
data=json.loads(subprocess.check_output(['node',str(root/'tests/dump-demo.cjs'),str(root/'dist/html_dbms_cash_demo.html')],text=True))
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'],headless=True)
 page=browser.new_page(viewport={'width':1512,'height':930})
 errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
 page.set_content('<div id="app"></div>')
 page.evaluate('''async ({source,data}) => {
  const url='data:text/javascript;base64,'+btoa(unescape(encodeURIComponent(source)));
  const mod=await import(url);
  const tx=data.transactions,docs=data.documents,root=data.root;
  window.__operations=[];window.__dictWrites=[];window.__created=[];
  const db={
   read:async (path) => path===''?root:path==='transactions/'?tx:docs[path.endsWith('/')?path.slice(0,-1):path],
   patch:async (name,ops)=>{
    if(name==='transactions'){
      if(ops.length!==1||ops[0].op!=='add'||ops[0].path!=='/rows/-')throw Error('Unexpected transaction Patch');
      window.__operations.push(JSON.parse(JSON.stringify(ops[0].value)));tx.rows.push(ops[0].value);return;
    }
    if(!docs[name])throw Error('Unknown dictionary');
    for(const op of ops){
      const seg=op.path.split('/').slice(1).map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~'));
      let obj=docs[name];for(const k of seg.slice(0,-1))obj=obj[k];
      const key=seg.at(-1);
      if(op.op==='add'&&Array.isArray(obj)&&key==='-')obj.push(op.value);
      else if(['add','replace'].includes(op.op))obj[key]=JSON.parse(JSON.stringify(op.value));
      else throw Error('Unexpected dictionary operation');
    }
    window.__dictWrites.push({name,ops});
   },
   createDocument:async(name,state)=>{if(docs[name])throw Error('Duplicate dictionary');docs[name]=JSON.parse(JSON.stringify(state));root.$refs[name]=['MOCK','MOCK'];window.__created.push(name);}
  };
  await mod.main(db,document.getElementById('app'));
}''', {'source':source,'data':{'transactions':data['transactions'],'documents':data['documents'],'root':data['root']}})
 expect(page.locator('h1')).to_contain_text('Касса')
 expect(page.locator('#cash-count')).to_contain_text('1\u00a0641')
 assert page.locator('#cash-tabs button').count()==8
 assert page.locator('.gridbox .ledger tbody tr').count()==1641, 'All transaction rows must be rendered without pagination'
 assert page.locator('.pager').count()==0, 'Pager must be removed'
 assert page.locator('text=План/факт').count()==0
 page.locator('#cash-tabs button',has_text='Операции(ТипСущности)').click()
 expect(page.locator('.report .total')).to_contain_text('8\u00a0616\u00a0188,00')
 assert page.locator('.histogram svg rect').count()>=32, 'Histogram must plot categories'
 page.screenshot(path=str(root/'dist/cash_demo_report.png'))
 page.locator('#cash-tabs button',has_text='Участники(Фонд)').click()
 expect(page.locator('.report .total')).to_contain_text('3\u00a0342\u00a0455,00')
 assert page.locator('.histogram svg rect').count()>=71, 'Fund participant histogram is missing'
 page.locator('#cash-tabs button',has_text='Справочники').click()
 expect(page.locator('h2')).to_contain_text('Фонды')
 page.locator('.dict-nav button',has_text='Типы Транзакций').click()
 expect(page.locator('h2')).to_contain_text('Типы Транзакций')
 # Add a new catalog: writes a new independent JSON document.
 page.locator('.dict-actions button',has_text='+ Справочник').click()
 page.locator('input[name="alias"]').fill('projects')
 page.locator('input[name="title"]').fill('Проекты')
 page.locator('button',has_text='Создать справочник').click()
 expect(page.locator('h2')).to_contain_text('Проекты')
 assert page.evaluate('window.__created')==['projects']
 # Insert a dictionary record and edit it; stable ID must remain the same.
 page.locator('.dict-actions button',has_text='+ Запись').click()
 page.locator('input[name="name"]').fill('Проект А')
 page.locator('textarea[name="extra"]').fill('["Тестовый проект"]')
 page.locator('button',has_text='Добавить запись').click()
 expect(page.locator('.gridbox tbody tr')).to_have_count(1)
 expect(page.locator('.gridbox')).to_contain_text('Проект А')
 page.locator('.gridbox button',has_text='Изменить').click()
 page.locator('input[name="name"]').fill('Проект Б')
 page.locator('button',has_text='Сохранить изменения').click()
 expect(page.locator('.gridbox')).to_contain_text('Проект Б')
 assert len(page.evaluate('window.__dictWrites'))==2
 # Edit an existing catalog item, retaining its ID.
 page.locator('.dict-nav button',has_text='Участники').click()
 page.locator('.gridbox button',has_text='Изменить').first.click()
 page.locator('input[name="name"]').fill('Участник_ПЕРЕИМЕНОВАН')
 page.locator('button',has_text='Сохранить изменения').click()
 expect(page.locator('.gridbox')).to_contain_text('Участник_ПЕРЕИМЕНОВАН')
 page.locator('#cash-tabs button',has_text='Транзакции').click()
 page.locator('button',has_text='+ Транзакция').click()
 assert page.locator('.form input[name="to"]').count()==0
 assert page.locator('.form input[name="from"]').count()==0
 assert page.locator('.form input[name="type"]').count()==0
 assert page.locator('.form select[name="plan"]').count()==0
 expect(page.locator('.form select[name="toId"]')).to_be_visible()
 page.locator('.form select[name="toTypeId"]').select_option(label='Поставщик')
 expect(page.locator('.form select[name="toId"] option').first).to_contain_text('Поставщик_B001')
 page.locator('.form select[name="toTypeId"]').select_option(label='Фонд')
 page.locator('.form select[name="toId"]').select_option(label='Фонд_F002')
 page.locator('.form select[name="fromId"]').select_option(label='Участник_ПЕРЕИМЕНОВАН')
 page.locator('.form select[name="typeId"]').select_option(label='Нал')
 page.locator('.form input[name="date"]').fill('2026-09-27')
 page.locator('.form input[name="amount"]').fill('345')
 page.locator('.form button',has_text='Записать транзакцию').click()
 expect(page.locator('#cash-count')).to_contain_text('1\u00a0642')
 saved=page.evaluate('window.__operations')
 assert len(saved)==1 and saved[0]['amount']==345
 assert saved[0]['toId'].startswith('fu-') and saved[0]['fromId'].startswith('pa-') and saved[0]['typeId'].startswith('tt-')
 assert not errors,errors
 print('CASH ENTRY UI PASS: six reports and reference dropdowns, dependent entity types, ID-only append (mock host RPC)')
 browser.close()