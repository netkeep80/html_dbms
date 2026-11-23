"""HEAD/URL/publication acceptance. Uses actual host + sandbox RPC, test-only shim.
Native XML/HTML parser in GitHub Actions; DOM emulation locally (no crypto claim).
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import base64,json,re,shutil,os
REAL_CRYPTO=os.environ.get("HDBMS_REAL_CRYPTO")=="1"
from playwright.sync_api import sync_playwright,expect
from browser_dual import ROOT,setup,frame,store_from_output,current_pair

def replace_store(text,kind,store):
    raw=json.dumps(store,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    if kind=='xml':raw='<![CDATA['+raw.replace(']]>',']]]]><![CDATA[>')+']]>'
    return re.sub(r'(<script id="db-store" type="application/json">)[\s\S]*?(</script>)',lambda m:m[1]+raw+m[2],text,count=1)

def visible(page,name):
    expect(page.locator('#entry-area iframe')).to_have_count(1,timeout=15000)
    expect(frame(page).locator('#db-title')).to_have_text(name,timeout=15000)

def empty(page):expect(page.locator('#entry-area iframe')).to_have_count(0)

def fill_head(page,value):
    if page.evaluate('document.contentType') in ('text/xml','application/xml'):
        page.locator('#head').evaluate("(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}",value)
    else:page.locator('#head').fill(value)

def select_db(page,value):
    if page.evaluate('document.contentType') in ('text/xml','application/xml'):
        page.locator('#databases').evaluate("(e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));}",value)
    else:page.locator('#databases').select_option(value)

def scenario(browser,kind,tmp):
    print("URL scenarios",kind,flush=True)
    page=browser.new_page(accept_downloads=True)
    names=iter(['Alpha','Beta']);page.on('dialog',lambda d:d.accept(next(names)) if d.type=='prompt' else d.accept())
    setup(page,kind,real_crypto=REAL_CRYPTO)
    empty(page);expect(page.locator('#status')).to_contain_text('Контейнер пуст')
    page.locator('#new-db').click();visible(page,'Alpha');a=current_pair(page)
    page.locator('#new-db').click();visible(page,'Beta');b=current_pair(page)
    assert len(a)==len(b)==64 and a!=b
    page.locator('#info-toggle').click()
    # The clipboard action must use the ACTIVE head and not pending form text.
    page.evaluate('''()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}})''')
    fill_head(page,a);page.locator('#copy-link').click()
    assert page.evaluate('window.__copied').endswith('#head='+b)
    fill_head(page,b)
    with page.expect_download() as dl:page.locator('#save').click()
    original=tmp/f'original.{kind}';dl.value.save_as(str(original));full=store_from_output(kind,original.read_text('utf8'))
    page.locator('#status').evaluate("e=>e.textContent='UNSAVED_PLAINTEXT_SENTINEL'")
    with page.expect_download() as dl:page.locator('#publish-site').click()
    assert dl.value.suggested_filename=='index.html'
    site=tmp/f'site-{kind}.html';dl.value.save_as(str(site));raw=site.read_text('utf8');published=store_from_output('html',raw)
    assert published['publicHeads']=={} and published['records']==full['records']
    assert a not in raw and b not in raw and 'UNSAVED_PLAINTEXT_SENTINEL' not in raw
    assert current_pair(page)==b;visible(page,'Beta')
    # Owner's store not changed by publication.
    with page.expect_download() as dl:page.locator('#save').click()
    owner=tmp/f'owner.{kind}';dl.value.save_as(str(owner));assert store_from_output(kind,owner.read_text('utf8'))==full
    page.close()
    base=(ROOT/'dist'/f'html_dbms.{kind}').read_text('utf8')
    def fixture(name,catalog,records=None):
        p=tmp/f'{name}-{kind}.{kind}';data={**full,'publicHeads':catalog,'records':full['records'] if records is None else records};p.write_text(replace_store(base,kind,data),encoding='utf8');return p
    zero=fixture('zero',{});one=fixture('one',{'Alpha':a});two=fixture('two',{'Alpha':a,'Beta':b})
    def open_case(path,frag='',name=None,error=None,container=kind):
        p=browser.new_page();setup(p,container,path,frag,real_crypto=REAL_CRYPTO)
        if name:
            try:visible(p,name)
            except Exception:
                print(p.locator("#status").inner_text(),p.locator("#entry-area").evaluate("e=>e.innerHTML")[:1000],flush=True);raise
        else:
            if error:expect(p.locator('#status')).to_contain_text(error,timeout=15000)
            empty(p)
        return p
    open_case(zero,error='Контейнер пуст').close()
    open_case(one,name='Alpha').close()
    p=open_case(two,error='Выберите БД');assert current_pair(p)=='';select_db(p,'Beta');empty(p);assert current_pair(p)==b;p.locator('#open-head').click();visible(p,'Beta');p.close()
    open_case(one,'#head='+b,name='Beta').close()
    for frag in ['#head=','#head=bad','#head='+a+'&head='+b,'#head='+a+'%20','#head='+'A'*64]:
        open_case(one,frag,error='HEAD' if frag!='#head='+'A'*64 else 'MISSING_RECORD').close()
    for h,n in [(a,'Alpha'),(b,'Beta')]:open_case(site,'#head='+h,name=n,container='html').close()
    open_case(site,error='Контейнер пуст',container='html').close()
    # Broken published root: correct codec but corrupted/missing physical slot.
    pid=base64.urlsafe_b64encode(base64.urlsafe_b64decode(a)[:16]).decode().rstrip('=')
    records={**full['records']};del records[pid]
    open_case(fixture('broken',{'Alpha':a},records),error='MISSING_RECORD').close()
    # URL changes revoke old application and do not fall back on public Alpha.
    p=open_case(one,'#head='+b,name='Beta')
    p.evaluate('(v)=>location.hash="head="+v',a);visible(p,'Alpha')
    p.evaluate('location.hash="head=bad"');expect(p.locator('#status')).to_contain_text('Некорректный HEAD');empty(p)
    p.evaluate('(v)=>location.hash="head="+v',b);visible(p,'Beta')
    p.evaluate('location.hash=""');visible(p,'Alpha');p.close()

if __name__=='__main__':
    with sync_playwright() as pw,TemporaryDirectory() as d:
        opt={'executable_path':shutil.which('chromium')} if shutil.which('chromium') else {}
        browser=pw.chromium.launch(**opt,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        for kind in ('html','xml'):scenario(browser,kind,Path(d))
        browser.close()
    print('HEAD URL ACCEPTANCE PASS: HTML/XML matrix, access links, no fallback, hashchange, hidden index and owner store parity; '+('NATIVE WEB CRYPTO (NO SHIM)' if REAL_CRYPTO else 'INSECURE TEST SHIM'))
