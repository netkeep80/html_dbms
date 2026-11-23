#!/usr/bin/env python3
"""Compare original XLSX cells with decrypted HTML DBMS/3 demo documents and JS views.
Do not use XLSX formula-cache as source data; it is an independent report reference.
Usage: python3 tests/compare_excel.py tests/fixtures/cash_input.xlsx dist/html_dbms_cash_demo.html
"""
from __future__ import annotations
import hashlib,json,re,subprocess,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
NS={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
SHEET_TO_ALIAS={
 'Типы Сущностей':'entityTypes','Прочие':'other','Типы Транзакций':'transactionTypes',
 'Участники':'participants','Поставщики':'suppliers','Покупатели':'buyers',
 'Госструктуры':'agencies','Арендаторы':'tenants','Фонды':'funds','Служебный':'service'
}
TYPE_DOCUMENTS={'Участник':'participants','Поставщик':'suppliers','Покупатель':'buyers','Госструктура':'agencies','Арендатор':'tenants','Фонд':'funds','Прочее':'other'}

def xlsx_cells(filepath):
 with zipfile.ZipFile(filepath) as z:
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   ss=ET.fromstring(z.read('xl/sharedStrings.xml'))
   shared=[''.join(t.text or '' for t in si.findall('.//x:t',NS)) for si in ss.findall('x:si',NS)]
  wb=ET.fromstring(z.read('xl/workbook.xml'))
  rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
  targets={r.attrib['Id']:r.attrib['Target'] for r in rels}
  sheets={}
  for sh in wb.findall('.//x:sheet',NS):
   name=sh.attrib['name']; target=targets[sh.attrib['{%s}id'%NS['r']]].lstrip('/')
   if not target.startswith('xl/'):target='xl/'+target
   tree=ET.fromstring(z.read(target));cells={}
   for c in tree.findall('.//x:sheetData/x:row/x:c',NS):
    ref=c.attrib['r']; typ=c.attrib.get('t');value=c.find('x:v',NS)
    if value is None:
     if typ!='inlineStr':continue
     val=''.join(t.text or '' for t in c.findall('.//x:t',NS))
    elif typ=='s':val=shared[int(value.text)]
    elif typ in ('e','str','inlineStr'):val=value.text or ''
    elif typ=='b':val=value.text=='1'
    else:
     try:
      val=float(value.text)
      if val.is_integer():val=int(val)
     except (TypeError,ValueError):val=value.text
    cells[ref]=val
   sheets[name]=cells
  return sheets

def same(actual,expected,location):
 if isinstance(actual,(float,int)) and isinstance(expected,(float,int)):
  if abs(actual-expected)<=1e-7:return
 if actual!=expected:raise AssertionError(f'{location}: {actual!r} vs Excel {expected!r}')
def fold(v):return str(v if v is not None else '').strip().casefold()
def get(cells,col,row):return cells.get(f'{col}{row}')
def column_name(n):
 s=''
 while n:
  n,i=divmod(n-1,26);s=chr(65+i)+s
 return s

def main():
 xlsx=Path(sys.argv[1]);demo=Path(sys.argv[2]);book=xlsx_cells(xlsx)
 project=Path(__file__).resolve().parents[1]
 data=json.loads(subprocess.check_output(['node',str(project/'tests/dump-demo.cjs'),str(demo)],text=True))
 assert data['verification']=='complete',data['verification']
 assert len(data['root']['$refs'])==11,'Expected exactly 11 source documents'
 assert len(book)==17,'Excel sheets changed'
 docs=data['documents']; rows=data['transactions']['rows'];s=book['Транзакции']
 expected=[i for i in range(4,2487) if isinstance(get(s,'D',i),(float,int)) and isinstance(get(s,'J',i),(float,int)) and get(s,'E',i) and get(s,'H',i)]
 same(len(rows),len(expected),'populated transaction rows')
 variants=0
 for i,(r,rowidx) in enumerate(zip(rows,expected)):
  same(r['excelRow'],rowidx,f'transaction {i} Excel row');same(r['n'],get(s,'C',rowidx),f'transaction {i} number')
  for k,col in [('date','D'),('amount','J'),('note','K'),('dd','L')]:same(r[k],get(s,col,rowidx),f'transaction {i} {k}')
  for k,col in [('toTypeId','E'),('typeId','G'),('fromTypeId','H')]:
   assert isinstance(r[k],str) and r[k] in docs['entityTypes' if k!='typeId' else 'transactionTypes']['entries']
   value=docs['entityTypes' if k!='typeId' else 'transactionTypes']['entries'][r[k]]['name']
   assert fold(value)==fold(get(s,col,rowidx)),f'transaction {i} {k}: {value} != {get(s,col,rowidx)}'
   if str(value)!=str(get(s,col,rowidx)):variants+=1
  for k,col,ty in [('toId','F','toTypeId'),('fromId','I','fromTypeId')]:
   typeName=docs['entityTypes']['entries'][r[ty]]['name'];catalog=TYPE_DOCUMENTS[typeName]
   assert r[k] in docs[catalog]['entries'],f'{i} {k}'
   value=docs[catalog]['entries'][r[k]]['name']
   assert fold(value)==fold(get(s,col,rowidx)),f'transaction {i} {k}: {value} vs {get(s,col,rowidx)}'
   if str(value)!=str(get(s,col,rowidx)):variants+=1
 assert len(rows)==1641,'Unexpected import row count'
 assert all(re.fullmatch(r'(?:Демонстрационная запись|Учебная операция|Тестовый расчёт|Пример движения|Условная проводка|Проверка отчёта|Сценарий сверки|Пример записи) №\d{4}',r['note']) for r in rows),'Non-synthetic transaction comment'
 assert len({r['note'] for r in rows})==1641
 assert len(docs['transactionTypes']['order'])==32
 assert all(not re.search(r'Нал|Щебень|КАМАЗ|р/ч',e['name']) for e in docs['transactionTypes']['entries'].values())
 assert all('plan' not in row for row in rows),'Plan/Fact must not be stored in the DBMS demo'
 assert len(data['transactions']['headers'])==10,'Plan/Fact must not be shown in the ledger'
 assert sum(get(s,'M',i)=='План' for i in expected)==3,'Source Excel plan flags changed unexpectedly'
 dict_cells=0
 for name,alias in SHEET_TO_ALIAS.items():
  raw=book[name];d=docs[alias]
  entries=d['entries'];order=d['order'];assert len(set(order))==len(order)
  expected_rows=[]
  for i in range(2,max([int(m.group(1)) for c in raw if (m:=re.match(r'^A(\d+)$',c))] or [1])+1):
   label=get(raw,'A',i)
   if isinstance(label,str) and label.strip():expected_rows.append(i)
  same(len(order),len(expected_rows),f'dictionary {name} count')
  for ident,index in zip(order,expected_rows):
   e=entries[ident];assert 'excelRow' not in e,f'{name}: Excel row must not be persisted in JSON dictionary';same(e['name'],get(raw,'A',index),f'{name} label');dict_cells+=1
   for j,v in enumerate(e.get('extra',[]),2):
    same(v,get(raw,column_name(j),index),f'{name} row {index} {column_name(j)}');dict_cells+=1
 report_cells=0
 for name,report in data['reports'].items():
  cells=book[name];same(report['selector'],get(cells,'B',2),f'{name} selector')
  for col,key in [('D','incoming'),('E','outgoing'),('F','balance')]:same(report[key],get(cells,col,6),f'{name}!{col}6');report_cells+=1
  for i,r in enumerate(report['rows'],7):
   for col,key in [('C','name'),('D','incoming'),('E','outgoing'),('F','balance')]:same(r[key],get(cells,col,i),f'{name}!{col}{i}');report_cells+=1
 same(data['transactions']['source']['sha256'],hashlib.sha256(xlsx.read_bytes()).hexdigest(),'Excel source checksum')
 assert not any('"reports"' in str(data['root']['$refs']) for _ in [0]),'Analytic views must not be persisted'
 print(f'EXCEL↔HTML_DBMS PASS: {len(rows)} nonempty transactions, 11 source document chains, {dict_cells} dictionary cells, {report_cells} view cells, {variants} normalized spelling variants, all six cached Excel report totals')
if __name__=='__main__':main()
