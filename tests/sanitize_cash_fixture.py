#!/usr/bin/env python3
"""One-time test-fixture package sanitization preserving Excel formula caches.
Use only on an offline copy. Rebuild shared string references; remove orphaned text.
No mapping to original labels is stored in the output or logged.
"""
import copy, hashlib, json, re, sys, zipfile
from pathlib import Path
from lxml import etree as ET
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
Q=lambda t:f'{{{NS}}}{t}'
LABELS=['Взнос','Компенсация','Резерв проекта','Аванс проекта','Расходные материалы','Обслуживание А','Обслуживание Б','Монтаж А','Монтаж Б','Настройка А','Настройка Б','Поддержка А','Поддержка Б','Аренда оборудования','Консультация','Пусконаладка','Логистика А','Логистика Б','Упаковка','Сервис площадки','Энергоресурсы','Транспортировка','Комплектующие','Разработка А','Разработка Б','Поставка А','Хозяйственные закупки','Ремкомплект','Сезонный сервис А','Сезонный сервис Б','Инвентарь','Поставка Б']
NOTES=['Демонстрационная запись','Учебная операция','Тестовый расчёт','Пример движения','Условная проводка','Проверка отчёта','Сценарий сверки','Пример записи']
def main():
 src,fixture,out,output_json=map(Path,sys.argv[1:]);f=json.loads(fixture.read_text(encoding='utf8'))
 rows=f['dictionaries']['Типы Транзакций'];types=[r for r in rows[1:] if r and r[0]];assert len(types)==len(LABELS)==32
 mapping={r[0].casefold():label for r,label in zip(types,LABELS)}
 original_notes={r['note'].strip().casefold() for r in f['entries'] if isinstance(r['note'],str) and len(r['note'])>8}
 # A journal note can also be reused as a counterparty label; remove that copy consistently.
 reused={r[0].strip().casefold():f'Прочее_Демо_{i:02d}' for i,r in enumerate(f['dictionaries']['Прочие'][1:],1) if r and isinstance(r[0],str) and r[0].strip().casefold() in original_notes}
 mapping.update(reused)
 # Case-insensitive canonical mapping keeps all report groups and numerical caches unchanged.
 def label(x):return mapping.get(x.strip().casefold(),x) if isinstance(x,str) else x
 def note(i):return f'{NOTES[i%len(NOTES)]} №{i:04d}'
 note_rows={r['excelRow']:note(i) for i,r in enumerate(f['entries'],1)}
 z=zipfile.ZipFile(src);parts={n:z.read(n) for n in z.namelist()};ss=ET.fromstring(parts['xl/sharedStrings.xml']);original=list(ss);strings=[''.join(si.itertext()) for si in original]
 def inline(c,val):
  for x in list(c):
   if x.tag in (Q('v'),Q('is')):c.remove(x)
  c.set('t','inlineStr');ET.SubElement(ET.SubElement(c,Q('is')),Q('t')).text=val
 worksheets={n:ET.fromstring(b) for n,b in parts.items() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',n)}
 # Sheet names resolved via relationships, not inferred from physical filename.
 wb=ET.fromstring(parts['xl/workbook.xml']);rels=ET.fromstring(parts['xl/_rels/workbook.xml.rels']);targets={x.get('Id'):'xl/'+x.get('Target').removeprefix('/') for x in rels};rn='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id';sheets={x.get('name'):targets[x.get(rn)] for x in wb.find(Q('sheets'))}
 journal=sheets['Транзакции'];dictionary=sheets['Типы Транзакций'];extras={}
 for rowidx,r in enumerate(rows[1:],2):
  if not r or not r[0]:continue
  for j,x in enumerate(r[1:],2):
   if isinstance(x,str) and x:extras[(rowidx,j)]=f'Демо-описание {rowidx-1:02d}/{j-1}'
 # Rewrite cell values, cached labels, and source descriptions. Unchanged formulas/numbers are retained.
 def val(c):
  v=c.find(Q('v'));return strings[int(v.text)] if c.get('t')=='s' and v is not None else v.text if v is not None else ''.join(x.text or '' for x in c.iter(Q('t')))
 used=set()
 for n,t in worksheets.items():
  for c in t.iter(Q('c')):
   m=re.fullmatch(r'([A-Z]+)(\d+)',c.get('r',''));col,num=m.group(1),int(m.group(2));typ=c.get('t');v=c.find(Q('v'));old=val(c)
   if n==journal and col=='K' and num in note_rows:inline(c,note_rows[num]);continue
   if n==dictionary and len(col)==1 and (num,ord(col)-64) in extras:inline(c,extras[num,ord(col)-64]);continue
   new=label(old)
   if new!=old:
    if c.find(Q('f')) is not None:
     assert typ=='str' and v is not None;v.text=new
    else:inline(c,new)
    continue
   if typ=='s' and v is not None:used.add(int(v.text))
 # Compact shared strings, ensuring orphaned original comments and type labels are absent.
 idx={old:i for i,old in enumerate(sorted(used))};count=0
 for n,t in worksheets.items():
  for c in t.iter(Q('c')):
   if c.get('t')=='s':v=c.find(Q('v'));v.text=str(idx[int(v.text)]);count+=1
  parts[n]=ET.tostring(t,encoding='UTF-8',xml_declaration=True,standalone=True)
 for child in list(ss):ss.remove(child)
 for old in sorted(used):ss.append(copy.deepcopy(original[old]))
 ss.set('count',str(count));ss.set('uniqueCount',str(len(used)));parts['xl/sharedStrings.xml']=ET.tostring(ss,encoding='UTF-8',xml_declaration=True,standalone=True)
 # Rewrite Excel note objects and author metadata; chart labels if cached.
 for n,b in list(parts.items()):
  if re.fullmatch(r'xl/comments\d+\.xml',n):
   t=ET.fromstring(b)
   for a in t.iter(Q('author')):a.text='Demo'
   for i,c in enumerate(t.iter(Q('comment')),1):
    text=c.find(Q('text'))
    if text is not None:
     text.clear();ET.SubElement(text,Q('t')).text=f'Демонстрационная заметка {i}'
   parts[n]=ET.tostring(t,encoding='UTF-8',xml_declaration=True,standalone=True)
  elif n.startswith('xl/charts/') and n.endswith('.xml'):
   t=ET.fromstring(b)
   for e in t.iter():
    if e.text:e.text=label(e.text)
   parts[n]=ET.tostring(t,encoding='UTF-8',xml_declaration=True,standalone=True)
 # Build the sanitized fixture JSON from the same transformation, not original labels.
 for i,r in enumerate(f['entries'],1):
  r['type']=label(r['type']);r['note']=note(i)
  for side in ('to','from'):r[side]=label(r[side])
 for r in f['dictionaries']['Прочие'][1:]:
  if r and isinstance(r[0],str) and r[0].strip().casefold() in reused:r[0]=label(r[0])
 for rowidx,r in enumerate(rows[1:],2):
  if r and r[0]:
   r[0]=label(r[0]);
   for j in range(2,len(r)+1):
    if (rowidx,j) in extras:r[j-1]=extras[rowidx,j]
 for name,report in f['reports'].items():
  if name!='Участники(Фонд)':
   for r in report['rows']:r['name']=label(r['name'])
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as zz:
  for n,b in parts.items():zz.writestr(n,b)
 f['sourceFile']='cash_input.xlsx';f['sourceSha256']=hashlib.sha256(out.read_bytes()).hexdigest()
 output_json.write_text(json.dumps(f,ensure_ascii=False,separators=(',',':')),encoding='utf8')
 print('Synthetic fixture:',len(f['entries']),'rows;',len(LABELS),'categories;',len(note_rows),'notes;',len(idx),'live shared strings')
if __name__=='__main__':main()
