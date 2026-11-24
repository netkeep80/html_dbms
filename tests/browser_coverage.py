"""External coverage of exact production scripts on native Chromium.
Collect both page and out-of-process iframe V8 targets through loopback CDP.
Do not disable site isolation, add sandbox permissions, or instrument shipped JS.
This diagnostic run supplements (does not replace) the normal browser gates.
"""
import base64
import functools
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
import websocket
from playwright.sync_api import sync_playwright, BrowserContext, Page, Locator, expect
from dual_build import ROOT, ExtractHTML, NODE_AUDIT
from coverage_report import Coverage
from browser_network import block_service_workers
from browser_dual import frame, store_from_output
from browser_head_url import replace_store
import browser_stability
import browser_head_url
import browser_rpc_session

# The source map is rebuilt only for the coverage report, never shipped.
# Require exact code identity before attributing mangled functions to source.
SHELL_NAMES=r"""
const fs=require('node:fs'),acorn=require('acorn'),esbuild=require('esbuild'),assert=require('node:assert/strict');
const {TraceMap,originalPositionFor}=require('@jridgewell/trace-mapping');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const source=fs.readFileSync('src/app.js','utf8').replace("'/* SANDBOX_DOCUMENT */'",()=>JSON.stringify(input.sandbox));
const generated=esbuild.transformSync(source,{minify:true,legalComments:'none',charset:'utf8',target:'es2022',loader:'js',format:'iife',sourcemap:'external',sourcefile:'src/app.js'});
assert.equal(generated.code.trim(),input.code,'Diagnostic source map must match exact shipped code');
const map=new TraceMap(generated.map),original=[],compiled=[];
function declarations(source,list){
 const ast=acorn.parse(source,{ecmaVersion:'latest',locations:true});
 function visit(n){
  if(!n||typeof n!=='object')return;
  if(n.type==='FunctionDeclaration'&&n.id)list.push(n);
  for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'&&v.type)visit(v);}
 }
 visit(ast);
}
declarations(source,original);declarations(input.code,compiled);
const out={};
for(const n of compiled){
 const p=originalPositionFor(map,{line:n.id.loc.start.line,column:n.id.loc.start.column});
 const match=original.find(f=>f.id.name===p.name)||original.find(f=>f.id.loc.start.line===p.line&&f.id.loc.start.column<=p.column&&f.id.loc.end.column>=p.column);
 if(match)out[match.id.name]={name:n.id.name,start:n.start,end:n.end,sourceLine:match.loc.start.line};
}
const critical=['launchSandbox','runRpc','stagedUpdate','commitStage','assertFits','showDebug','verify','verifyStore','verifyAnchor','verifyFile','truncate','readStoreFromDocument','htmlSerialize','exportDocument','save','init'];
for(const name of critical)assert.ok(out[name],'Missing mapping for '+name);
console.log(JSON.stringify(Object.fromEntries(critical.map(name=>[name,out[name]]))));
"""
def source_reports():
    parser=ExtractHTML()
    parser.feed((ROOT/'dist/html_dbms.html').read_text('utf8'))
    nested=json.loads(subprocess.check_output(['node','-e',NODE_AUDIT],input=json.dumps({'scripts':parser.scripts,'css':parser.styles}),text=True,cwd=ROOT))
    sandbox=ExtractHTML();sandbox.feed(nested['sandbox']);sandbox.close()
    names=json.loads(subprocess.check_output(['node','-e',SHELL_NAMES],input=json.dumps({'code':parser.scripts['app-source'],'sandbox':nested['sandbox']}),text=True,cwd=ROOT))
    return [Coverage('shell+RPC+serializers',parser.scripts['app-source']),
            Coverage('sandbox bootstrap',next(iter(sandbox.scripts.values()))),
            Coverage('starter',parser.scripts['starter-source']),
            Coverage('browser core',parser.scripts['core-source'])],names

class CDPCoverage:
    def __init__(self,url,reports):
        self.ws=websocket.create_connection(url,suppress_origin=True,timeout=10)
        self.ws.settimeout(None)
        self.reports=reports
        self.by_source={r.source:r for r in reports}
        self.sessions={}
        self.sources={}
        self.replies={}
        self.setup={}
        self.sequence=0
        self.lock=threading.Lock()
        self.stopped=False
        self.failure=None
        self.reader=threading.Thread(target=self.receive,daemon=True)
        self.reader.start()
        self.call('Target.setAutoAttach',{'autoAttach':True,'waitForDebuggerOnStart':True,'flatten':True})

    def send(self,method,params=None,session=None,setup=False):
        with self.lock:
            self.sequence+=1
            message={'id':self.sequence,'method':method,'params':params or {}}
            if session:message['sessionId']=session
            if setup:self.setup[self.sequence]=(session,method)
            self.ws.send(json.dumps(message))
            return self.sequence

    def receive(self):
        try:
            while not self.stopped:
                message=json.loads(self.ws.recv())
                if 'id' in message:
                    number=message['id']
                    operation=self.setup.pop(number,None)
                    if operation:
                        if 'error' in message and operation[0] in self.sessions:
                            raise AssertionError((operation,message['error']))
                    else:self.replies[number]=message
                    continue
                params=message.get('params',{})
                if message.get('method')=='Target.attachedToTarget':
                    sid=params['sessionId']
                    target=params['targetInfo']['type']
                    if target in ('page','iframe'):
                        self.sessions[sid]=target
                        self.send('Target.setAutoAttach',{'autoAttach':True,'waitForDebuggerOnStart':True,'flatten':True},sid,True)
                        self.send('Debugger.enable',session=sid,setup=True)
                        self.send('Profiler.enable',session=sid,setup=True)
                        self.send('Profiler.startPreciseCoverage',{'callCount':True,'detailed':True},sid,True)
                    self.send('Runtime.runIfWaitingForDebugger',session=sid,setup=True)
                elif message.get('method')=='Target.detachedFromTarget':
                    self.sessions.pop(params['sessionId'],None)
        except Exception as exc:
            if not self.stopped:self.failure=exc

    def call(self,method,params=None,session=None):
        number=self.send(method,params,session)
        deadline=time.monotonic()+15
        while number not in self.replies:
            if self.failure:raise self.failure
            if time.monotonic()>deadline:raise TimeoutError(method)
            time.sleep(.002)
        result=self.replies.pop(number)
        if 'error' in result:
            if session and session not in self.sessions:return None
            raise AssertionError((method,result['error']))
        return result['result']

    def collect(self):
        if self.failure:raise self.failure
        for sid in list(self.sessions):
            if sid not in self.sessions:continue
            coverage=self.call('Profiler.takePreciseCoverage',session=sid)
            if coverage is None:continue
            for script in coverage['result']:
                if not script['url'].startswith(('file:','blob:','about:srcdoc')):continue
                key=(sid,script['scriptId'])
                if key not in self.sources:
                    response=self.call('Debugger.getScriptSource',{'scriptId':script['scriptId']},sid)
                    if response is None:continue
                    self.sources[key]=self.by_source.get(response['scriptSource'])
                report=self.sources[key]
                if report:report.add(script['functions'])

    def close(self):
        self.stopped=True
        self.ws.close()
        self.reader.join(timeout=5)

@contextmanager
def checkpoints(coverage):
    # Collect before navigating/destroying the document, and before each click
    # so detached iframe scripts are not lost when a later action revokes them.
    saved=[]
    for cls,name in ((Page,'goto'),(Page,'reload'),(Page,'close'),(BrowserContext,'close'),(Locator,'click')):
        original=getattr(cls,name)
        @functools.wraps(original)
        def wrapper(self,*args,_original=original,**kwargs):
            coverage.collect()
            return _original(self,*args,**kwargs)
        setattr(cls,name,wrapper);saved.append((cls,name,original))
    try:yield
    finally:
        for cls,name,original in saved:setattr(cls,name,original)

def extra(browser,kind,tmp):
    # Exercise validation, anchor, external physical comparison, catalog
    # operations and both serializers using the native shell controls.
    ctx=browser.new_context(accept_downloads=True)
    errors=[];requests=[]
    block_service_workers(ctx,requests)
    ctx.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
    ctx.route('http**/*',lambda r:r.abort())
    page=ctx.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('websocket',lambda w:requests.append(w.url))
    decision={'recover':False}
    def dialog(d):
        if d.type=='prompt':d.accept('Coverage')
        elif 'Восстановление необратимо' in d.message and not decision['recover']:d.dismiss()
        else:d.accept()
    page.on('dialog',dialog)
    page.goto((ROOT/'dist'/f'html_dbms.{kind}').as_uri(),wait_until='domcontentloaded')
    page.locator('#new-db').click();expect(frame(page).locator('#db-title')).to_have_text('Coverage')
    head=page.locator('#head').evaluate('e=>e.value')
    frame(page).locator('#add-document').click()
    frame(page).locator('#new-document-name').fill('child')
    frame(page).locator('#new-document-json').fill('{"n":0}')
    frame(page).locator('#create-document').click()
    expect(frame(page).locator('#message')).to_contain_text('Документ создан')
    first=page.locator('#head').evaluate('e=>e.value')
    frame(page).locator('#edit-document').click()
    frame(page).locator('#patch').fill('[{"op":"replace","path":"/n","value":1}]')
    frame(page).locator('#write').click()
    expect(frame(page).locator('#message')).to_contain_text('Изменение записано')
    tip=page.locator('#head').evaluate('e=>e.value')
    with page.expect_download() as dl:page.locator('#save').click()
    saved=tmp/f'coverage-{kind}.{kind}';dl.value.save_as(str(saved))
    page.locator('#validation-toggle').click()
    page.locator('#verify-store').click()
    expect(page.locator('#validation-report')).to_contain_text('publicDatabases')
    page.locator('#anchor').evaluate('(e,v)=>{e.value=v}',head)
    page.locator('#verify-anchor').click()
    expect(page.locator('#validation-report')).to_contain_text('anchorIndex')
    page.locator('#anchor').evaluate("(e)=>{e.value='A'.repeat(64)}")
    page.locator('#verify-anchor').click()
    expect(page.locator('#validation-report')).to_contain_text('ANCHOR_MISMATCH')
    page.locator('#external').evaluate('''(e,p)=>{
        const dt=new DataTransfer();dt.items.add(new File([p.raw],p.name,{type:'text/plain'}));e.files=dt.files;
    }''',{'name':saved.name,'raw':saved.read_text('utf8')})
    page.locator('#verify-file').click()
    expect(page.locator('#validation-report')).to_contain_text('"changedPhysicalSlots": 0')
    page.locator('#info-toggle').click()
    page.locator('#hide-head').click();expect(page.locator('#status')).to_contain_text('Публикация удалена')
    page.locator('#publish').click();expect(page.locator('#status')).to_contain_text('Опубликована')
    with page.expect_download() as dl:page.locator('#publish-site').click()
    assert dl.value.suggested_filename=='index.html'
    # Recovery through the actual UI: corrupt predecessor, authenticated
    # descendant, explicit cancellation followed by explicit confirmation.
    data=store_from_output(kind,saved.read_text('utf8'))
    physical=lambda h:base64.urlsafe_b64encode(base64.urlsafe_b64decode(h)[:16]).decode().rstrip('=')
    broken_id,tail_id=physical(first),physical(tip)
    data['records'][broken_id]='A'*22
    source=(ROOT/'dist'/f'html_dbms.{kind}').read_text('utf8')
    damaged=tmp/f'coverage-damaged.{kind}'
    damaged.write_text(replace_store(source,kind,data),encoding='utf8')
    page.goto(damaged.as_uri(),wait_until='domcontentloaded')
    expect(page.locator('#status')).to_contain_text('INVALID_GCM')
    page.locator('#validation-toggle').click();page.locator('#verify').click()
    expect(page.locator('#validation-report')).to_contain_text('"status": "broken"')
    page.locator('#recovery-section summary').click()
    page.locator('#recovery-head').evaluate('(e,v)=>{e.value=v}',head)
    page.locator('#truncate').click()
    with page.expect_download() as dl:page.locator('#save').click()
    cancelled=tmp/f'coverage-cancelled.{kind}';dl.value.save_as(str(cancelled))
    assert store_from_output(kind,cancelled.read_text('utf8'))==data
    decision['recover']=True
    page.locator('#truncate').click()
    expect(page.locator('#validation-report')).to_contain_text('"status": "recovered"')
    expect(frame(page).locator('#db-title')).to_have_text('Coverage')
    with page.expect_download() as dl:page.locator('#save').click()
    recovered=tmp/f'coverage-recovered.{kind}';dl.value.save_as(str(recovered))
    result=store_from_output(kind,recovered.read_text('utf8'))
    assert result['publicHeads']=={'Coverage':head}
    expected=dict(data['records']);del expected[tail_id]
    assert result['records']==expected and result['records'][broken_id]=='A'*22
    # Authorized custom entry exercises getHead and invalid RPC arguments.
    fixture=page.evaluate('''async()=>{
      const db=HTML_DBMS,s=db.adoptStore({format:db.VERSION,publicHeads:{},records:{}});
      const source="export async function main(api,mount){const messages=[];for(const call of [()=>api.read(42),()=>api.createDocument('',{}),()=>api.patch('child',null)]){try{await call();messages.push('UNEXPECTED')}catch(e){messages.push(e.message)}}mount.textContent=JSON.stringify({head:await api.getHead(),frozen:Object.isFrozen(api),messages});}";
      const r=await db.createDatabase(s,'RPC coverage',{entry:{type:'application/javascript',source,export:'main'}});db.commit(s,r.store);return db.snapshot(s);
    }''')
    custom=tmp/f'coverage-custom.{kind}';custom.write_text(replace_store(source,kind,fixture),encoding='utf8')
    page.goto(custom.as_uri(),wait_until='domcontentloaded')
    expect(page.locator('.entry-launch')).to_be_visible()
    page.locator('.entry-launch').click()
    expect(frame(page).locator('#app')).to_contain_text('Неверный запрос patch')
    reply=json.loads(frame(page).locator('#app').inner_text())
    assert reply['head']==fixture['publicHeads']['RPC coverage'] and reply['frozen'] is True
    assert reply['messages']==['Неверная ссылка','Недопустимое имя документа','Неверный запрос patch']
    assert not requests,requests
    assert not errors,errors
    ctx.close()

def main():
    reports,names=source_reports()
    with sync_playwright() as pw,tempfile.TemporaryDirectory(prefix='hdbms-coverage-') as tmp:
        tmp=Path(tmp);profile=tmp/'profile';profile.mkdir()
        executable=shutil.which('chromium') or pw.chromium.executable_path
        proc=subprocess.Popen([executable,'--headless','--no-sandbox','--disable-dev-shm-usage',
            '--disable-background-networking','--no-first-run','--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=0','--user-data-dir='+str(profile),'about:blank'],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        monitor=None
        try:
            portfile=profile/'DevToolsActivePort'
            deadline=time.monotonic()+20
            while not portfile.exists():
                if proc.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Chromium CDP did not start')
                time.sleep(.05)
            port,path=portfile.read_text().splitlines()[:2]
            monitor=CDPCoverage('ws://127.0.0.1:'+port+path,reports)
            browser=pw.chromium.connect_over_cdp('http://127.0.0.1:'+port)
            # Native file:// mode; no SHIM. Normal independent acceptance jobs
            # remain unchanged and still exercise security with default isolation.
            os.environ['GITHUB_ACTIONS']='true'
            browser_head_url.REAL_CRYPTO=True
            with checkpoints(monitor):
                for kind in ('html','xml'):
                    browser_stability.scenario(browser,kind,tmp)
                    browser_head_url.scenario(browser,kind,tmp)
                    browser_rpc_session.scenario(browser,kind,tmp)
                    extra(browser,kind,tmp)
                monitor.collect()
            result=[report.report() for report in reports]
            shell=result[0]
            critical={}
            for name,info in names.items():
                matches=[f for f in shell['functions'] if f['name']==info['name'] and f['end']==info['end']]
                critical[name]={**info,'observed':bool(matches),'hit':any(f['hit'] for f in matches)}
            shell['criticalFunctions']=critical
            print('V8 CRITICAL SHELL FUNCTIONS',json.dumps(critical,ensure_ascii=False),flush=True)
            assert all(f['hit'] for f in critical.values()),critical
            target=Path(os.environ.get('RUNNER_TEMP',str(ROOT)))/'hdbms-browser-coverage.json'
            target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
            print('BROWSER V8 COVERAGE PASS: exact production script identity, native HTML/XML, page and sandbox renderer targets',flush=True)
            monitor.close();monitor=None
            browser.close()
        finally:
            if monitor:monitor.close()
            if proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=5)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()

if __name__=='__main__':main()
