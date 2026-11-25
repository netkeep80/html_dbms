#!/usr/bin/env python3
"""Compare original XLSX cells with decrypted HTML DBMS/3 demo documents and JS views.
Do not use XLSX formula-cache as source data; it is an independent report reference.
Usage: python3 tests/compare_excel.py tests/fixtures/cash_input.xlsx dist/html_dbms_cash_demo.html
"""
from __future__ import annotations
import hashlib,json,re,subprocess,sys,zipfile
from decimal import Decimal
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
    elif (name=='Транзакции' and re.fullmatch(r'J\d+',ref)) or (name.startswith(('Операции(','Участники(')) and re.fullmatch(r'[DEF]\d+',ref)):
     val=Decimal(value.text)
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

def minor(value):
 assert isinstance(value,(Decimal,int)) and not isinstance(value,bool),'Invalid exact source money'
 d=Decimal(value)
 assert d.is_finite(),'Nonfinite source money'
 n,dn=d.as_integer_ratio()
 assert n*100%dn==0,'Sub-cent source value'
 result=n*100//dn
 return result

def source_lexemes(xlsx,fixture):
 # Never emit source values into CI logs; stdout is consumed directly by the importer.
 book=xlsx_cells(xlsx);s=book['Транзакции']
 f=json.loads(Path(fixture).read_text('utf8'),parse_float=Decimal)
 assert f['sourceSha256']==hashlib.sha256(Path(xlsx).read_bytes()).hexdigest(),'XLSX checksum mismatch'
 expected=[i for i in range(4,2487) if isinstance(get(s,'D',i),(float,int)) and get(s,'E',i) and get(s,'H',i)]
 # A candidate row with a missing amount is not silently dropped.
 expected=[i for i in expected if get(s,'C',i) is not None or get(s,'J',i) is not None]
 assert len(expected)==len(f['entries']),'Source row count mismatch'
 result={}
 for i,row in zip(expected,f['entries']):
  assert row['excelRow']==i,'Source row identity mismatch'
  n=minor(get(s,'J',i))
  assert abs(n)<=9007199254740991,'Source money outside storage bound'
  assert minor(row['amount'])==n,'Extracted amount differs from original XML'
  result[str(i)]=('-' if n<0 else '')+str(abs(n)//100)+'.'+str(abs(n)%100).zfill(2)
 print(json.dumps(result,separators=(',',':')))

def oracle(raw,selected,categories,mode,period):
 # Compute directly from original workbook cells, never JS views or formula caches.
 totals={fold(c):[0,0] for c in categories}
 for date,to_type,to,category,from_type,source,amount,dd in raw:
  if not period['fromSerial']<=date<=period['toSerial'] or fold(dd)!='да':continue
  if mode=='participants':
   if fold(to)==selected and fold(from_type)=='участник' and fold(source) in totals:totals[fold(source)][0]+=amount
   if fold(source)==selected and fold(to_type)=='участник' and fold(to) in totals:totals[fold(to)][1]+=amount
  else:
   target=fold(category)
   assert target in totals,'Source category absent'
   if fold(to_type if mode=='entityType' else to)==selected:totals[target][0]+=amount
   if fold(from_type if mode=='entityType' else source)==selected:totals[target][1]+=amount
 return [(i,o,i-o) for i,o in totals.values()]

def main():
 xlsx=Path(sys.argv[1]);demo=Path(sys.argv[2]);book=xlsx_cells(xlsx)
 project=Path(__file__).resolve().parents[1]
 data=json.loads(subprocess.check_output(['node',str(project/'tests/dump-demo.cjs'),str(demo)],text=True))
 assert data['verification']=='complete',data['verification']
 assert len(data['root']['$refs'])==11,'Expected exactly 11 source documents'
 assert len(book)==17,'Excel sheets changed'
 docs=data['documents']; rows=data['transactions']['rows'];s=book['Транзакции']
 expected=[i for i in range(4,2487) if isinstance(get(s,'D',i),(float,int)) and isinstance(get(s,'J',i),(Decimal,int)) and get(s,'E',i) and get(s,'H',i)]
 same(len(rows),len(expected),'populated transaction rows')
 variants=0
 for i,(r,rowidx) in enumerate(zip(rows,expected)):
  same(r['excelRow'],rowidx,f'transaction {i} Excel row');same(r['n'],get(s,'C',rowidx),f'transaction {i} number')
  for k,col in [('date','D'),('note','K'),('dd','L')]:same(r[k],get(s,col,rowidx),f'transaction {i} {k}')
  assert 'amount' not in r and type(r['amountMinor']) is int and r['amountMinor']==minor(get(s,'J',rowidx)),f'transaction {i}: exact amount mismatch'
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
 report_cells=0;cache_differences=0
 raw=[(get(s,'D',i),get(s,'E',i),get(s,'F',i),get(s,'G',i),get(s,'H',i),get(s,'I',i),minor(get(s,'J',i)),get(s,'L',i)) for i in expected]
 for name,report in data['reports'].items():
  cells=book[name];same(report['selector'],get(cells,'B',2),f'{name} selector')
  mode='participants' if name=='Участники(Фонд)' else 'entityType' if name=='Операции(ТипСущности)' else 'entity'
  categories=[get(cells,'C',i) for i in range(7,7+len(report['rows']))]
  result=oracle(raw,fold(report['selector']),categories,mode,data['transactions']['period'])
  keys=('incoming','outgoing','balance')
  for j,key in enumerate(keys):
   value=sum(row[j] for row in result)
   assert int(report[key])==value,f'{name} total {key}: exact oracle mismatch'
   if value!=minor(get(cells,'DEF'[j],6)):cache_differences+=1
   report_cells+=1
  for i,(r,expected_row) in enumerate(zip(report['rows'],result),7):
   same(r['name'],get(cells,'C',i),f'{name} category {i}')
   for j,key in enumerate(keys):
    assert int(r[key])==expected_row[j],f'{name} row {i} {key}: exact oracle mismatch'
    if expected_row[j]!=minor(get(cells,'DEF'[j],i)):cache_differences+=1
    report_cells+=1
 same(data['transactions']['source']['sha256'],hashlib.sha256(xlsx.read_bytes()).hexdigest(),'Excel source checksum')
 assert not any('"reports"' in str(data['root']['$refs']) for _ in [0]),'Analytic views must not be persisted'
 print(f'EXCEL↔HTML_DBMS PASS: {len(rows)} nonempty transactions, 11 source document chains, {dict_cells} dictionary cells, {report_cells} view cells, {variants} normalized spelling variants, all six exact oracle reports; cached Excel differences: {cache_differences}')
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--source-lexemes':source_lexemes(Path(sys.argv[2]),Path(sys.argv[3]))
 else:main()
