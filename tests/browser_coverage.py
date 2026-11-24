"""External coverage of exact production scripts on native Chromium.
Collect both page and out-of-process iframe V8 targets through loopback CDP.
Do not disable site isolation, add sandbox permissions, or instrument shipped JS.
This diagnostic run supplements (does not replace) the normal browser gates.
"""
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
from browser_dual import frame
import browser_stability
import browser_head_url

def source_reports():
    parser=ExtractHTML()
    parser.feed((ROOT/'dist/html_dbms.html').read_text('utf8'))
    nested=json.loads(subprocess.check_output(['node','-e',NODE_AUDIT],input=json.dumps({'scripts':parser.scripts,'css':parser.styles}),text=True,cwd=ROOT))
    sandbox=ExtractHTML();sandbox.feed(nested['sandbox']);sandbox.close()
    return [Coverage('shell+RPC+serializers',parser.scripts['app-source']),
            Coverage('sandbox bootstrap',next(iter(sandbox.scripts.values()))),
            Coverage('starter',parser.scripts['starter-source']),
            Coverage('browser core',parser.scripts['core-source'])]

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
    page.on('dialog',lambda d:d.accept('Coverage') if d.type=='prompt' else d.accept())
    page.goto((ROOT/'dist'/f'html_dbms.{kind}').as_uri(),wait_until='domcontentloaded')
    page.locator('#new-db').click();expect(frame(page).locator('#db-title')).to_have_text('Coverage')
    head=page.locator('#head').evaluate('e=>e.value')
    frame(page).locator('#add-document').click()
    frame(page).locator('#new-document-name').fill('child')
    frame(page).locator('#new-document-json').fill('{"n":0}')
    frame(page).locator('#create-document').click()
    expect(frame(page).locator('#message')).to_contain_text('Документ создан')
    frame(page).locator('#edit-document').click()
    frame(page).locator('#patch').fill('[{"op":"replace","path":"/n","value":1}]')
    frame(page).locator('#write').click()
    expect(frame(page).locator('#message')).to_contain_text('Изменение записано')
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
    assert not requests,requests
    assert not errors,errors
    ctx.close()

def main():
    reports=source_reports()
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
                    extra(browser,kind,tmp)
                monitor.collect()
            result=[report.report() for report in reports]
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
