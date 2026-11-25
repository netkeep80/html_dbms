#!/usr/bin/env python3
"""Independent exact oracle for the approved synthetic data and fractional stress cases.
No private data, no float arithmetic, no use of JS report logic in expected values.
"""
import json,random,subprocess,tempfile
from pathlib import Path
from compare_excel import oracle,fold,minor
ROOT=Path(__file__).resolve().parents[1]
def node(*args,stdin=None):
 return json.loads(subprocess.check_output(['node',*args],input=stdin,text=True,cwd=ROOT))
KEYS=('incoming','outgoing','balance')
def compare(report,expected):
 assert len(report['rows'])==len(expected)
 for cell,wanted in zip(report['rows'],expected):
  assert tuple(int(cell[k]) for k in KEYS)==tuple(wanted),'Report cell differs from oracle'
 assert tuple(int(report[k]) for k in KEYS)==tuple(sum(row[j] for row in expected) for j in range(3)),'Report total differs from oracle'
 return 3*(1+len(expected))
def approved():
 f=node('examples/cash/synthetic-pages.cjs')
 with tempfile.TemporaryDirectory() as tmp:
  output=Path(tmp)/'index.html'
  subprocess.run(['node','examples/cash/build-pages.cjs',str(output)],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
  data=node('tests/dump-demo.cjs',str(output))
 assert data['verification']=='complete' and len(data['transactions']['rows'])==720
 assert data['transactions']['source']['sha256']==f['sourceSha256']
 assert data['transactions']['period']==f['period']
 raw=[]
 docs=data['documents']
 for src,actual in zip(f['entries'],data['transactions']['rows']):
  n=minor(src['amount'])
  assert actual['amountMinor']==n and 'amount' not in actual
  for side in ('to','from'):
   ty=docs['entityTypes']['entries'][actual[side+'TypeId']]
   assert fold(ty['name'])==fold(src[side+'Type'])
   assert fold(docs[ty['documentAlias']]['entries'][actual[side+'Id']]['name'])==fold(src[side])
  assert fold(docs['transactionTypes']['entries'][actual['typeId']]['name'])==fold(src['type'])
  assert actual['date']==src['date'] and actual['dd']==src['dd']
  raw.append((src['date'],src['toType'],src['to'],src['type'],src['fromType'],src['from'],n,src['dd']))
 count=0
 for name,report in data['reports'].items():
  mode='participants' if name=='Участники(Фонд)' else 'entityType' if name=='Операции(ТипСущности)' else 'entity'
  categories=[row[0] for row in f['dictionaries']['Участники' if mode=='participants' else 'Типы Транзакций'][1:]]
  assert [fold(row['name']) for row in report['rows']]==[fold(c) for c in categories]
  count+=compare(report,oracle(raw,fold(report['selector']),categories,mode,f['period']))
 return count

def stress():
 rng=random.Random(0x45cafe)
 maximum=9007199254740991
 types={'f':'Фонд','p':'Участник','s':'Поставщик','a':'Госструктура'}
 entities={'f':['f1','f2'],'p':['p1','p2'],'s':['s1'],'a':['a1']}
 categories=['c'+str(i) for i in range(1,34)]
 def catalog(ids):return {'order':ids,'entries':{i:{'name':i} for i in ids}}
 docs={'transactionTypes':catalog(categories),'participants':catalog(entities['p']),
       'entityTypes':{'order':list(types),'entries':{k:{'name':v,'documentAlias':{'f':'funds','p':'participants','s':'suppliers','a':'agencies'}[k]} for k,v in types.items()}}}
 def row(n,cat,to,fr,date=4,dd='Да',note='selected'):
  return dict(amountMinor=n,typeId=cat,toTypeId=to[0],toId=to[1],fromTypeId=fr[0],fromId=fr[1],date=date,dd=dd,note=note)
 f=('f','f1');p=('p','p1')
 # Explicit positive controls for the formerly omitted rows, signed self transfer, huge opposing totals.
 rows=[row(maximum,'c32',f,p),row(maximum,'c33',f,p),row(maximum,'c32',p,f),row(maximum-1,'c33',p,f),
       row(1,'c1',f,f),row(-29,'c33',f,p),row(29,'c33',f,p),row(5,'c32',f,p,dd='Нет'),row(3,'c33',f,p,date=9)]
 scenarios=[('entityType','f'),('entity','f1'),('entity','p1'),('entity','s1'),('entity','a1'),('participants','f1')]
 def wanted(rows,mode,selector,order,period):
  raw=[(r['date'],types[r['toTypeId']],r['toId'],r['typeId'],types[r['fromTypeId']],r['fromId'],r['amountMinor'],r['dd']) for r in rows]
  return oracle(raw,fold(types[selector] if mode=='entityType' else selector),order,mode,period)
 period={'fromSerial':2,'toSerial':8}
 assert sum(b for _,_,b in wanted(rows,'entityType','f',categories,period))==1
 inputs=[];expected=[];ledger=[]
 for iteration in range(8):
  current=list(rows)
  if iteration:
   for i in range(180):
    a,b=rng.choices(list(types),k=2)
    current.append(row(rng.choice([0,1,-1,29,maximum,-maximum,rng.randrange(-99999,100000)]),rng.choice(categories),(a,rng.choice(entities[a])),(b,rng.choice(entities[b])),rng.randrange(1,11),rng.choice(['Да','Нет']),rng.choice(['selected','other'])))
   rng.shuffle(current)
  for mode,selector in scenarios:
   order=list(entities['p'] if mode=='participants' else categories)
   rng.shuffle(order)
   inputs.append(dict(rows=current,mode=mode,selector=selector,order=order,period=period))
   expected.append(wanted(current,mode,selector,order,period))
   chosen=[r for r in current if 2<=r['date']<=8 and r['note']=='selected']
   inc=sum(r['amountMinor'] for r in chosen if r['toTypeId']=='f')
   out=sum(r['amountMinor'] for r in chosen if r['fromTypeId']=='f')
   ledger.append((inc,out,inc-out))
 js=r"""
 const fs=require('node:fs'),m=require('./examples/cash/cash-entry.js');
 const {docs,inputs}=JSON.parse(fs.readFileSync(0,'utf8'));
 const result=inputs.map(c=>({report:m.calculateReport(c.rows,{mode:c.mode},c.selector,c.order,c.period,docs),
  ledger:m.calculateLedger(c.rows.filter(r=>r.date>=c.period.fromSerial&&r.date<=c.period.toSerial&&r.note==='selected'),'f')}));
 console.log(JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v));
 """
 actual=node('-e',js,stdin=json.dumps(dict(docs=docs,inputs=inputs),ensure_ascii=False))
 count=0
 for a,w,l in zip(actual,expected,ledger):
  count+=compare(a['report'],w)
  assert tuple(int(a['ledger'][k]) for k in KEYS)==l,'Ledger period/search oracle mismatch'
  count+=3
 assert len(actual)==len(inputs)==48
 return count

if __name__=='__main__':
 print(f'CASH INDEPENDENT ORACLE PASS: approved 720 source rows, {approved()} report money cells; 48 seeded fractional/permutation cases, {stress()} report/ledger money cells')
