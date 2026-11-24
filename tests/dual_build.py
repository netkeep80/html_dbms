"""Cross-format builder/serializer acceptance. Real file:// is a manual gate (#31)."""
from pathlib import Path
from html.parser import HTMLParser
import copy
import json
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
XHTML='http://www.w3.org/1999/xhtml'

class ExtractHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current=None
        self.scripts={}
        self.styles=[]
        self.comments=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script':
            self.current=dict(attrs).get('id','dynamic-'+str(len(self.scripts)))
            self.scripts[self.current]=''
        elif tag=='style':
            self.current='style'
            self.styles.append('')
    def handle_endtag(self,tag):
        if tag in ('script','style'):self.current=None
    def handle_data(self,data):
        if self.current=='style':self.styles[-1]+=data
        elif self.current is not None:self.scripts[self.current]+=data
    def handle_comment(self,data):self.comments.append(data)



# acorn is already present at an exact version in package-lock.json (terser dependency).
# CSS is checked by a syntax-aware normalizer which removes every comment;
# byte identity to the normalized minified output excludes actual CSS comments.
NODE_AUDIT=r"""
const fs=require('node:fs'),assert=require('node:assert/strict'),acorn=require('acorn'),esbuild=require('esbuild');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
function js(source,sourceType='script'){
 const comments=[],strings=[];
 const root=acorn.parse(source,{ecmaVersion:'latest',sourceType,onComment:comments});
 assert.equal(comments.length,0,'JS comments found');
 function visit(n){
  if(!n||typeof n!=='object')return;
  if(n.type==='Literal'&&typeof n.value==='string')strings.push(n.value);
  if(n.type==='TemplateLiteral'&&!n.expressions.length)strings.push(n.quasis.map(q=>q.value.cooked).join(''));
  if(n.type==='CallExpression'||n.type==='NewExpression')assert.ok(!['require','eval','Function'].includes(n.callee?.name),'Unexpected runtime loader');
  if(n.type==='MemberExpression')assert.ok(!(n.object?.name==='module'&&n.property?.name==='exports')&&n.object?.name!=='Buffer','Node-only runtime');
  for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'&&v.type)visit(v);}
 }
 visit(root);return strings;
}
function css(source){assert.equal(esbuild.transformSync(source,{loader:'css',minify:true,legalComments:'none',charset:'utf8',target:'es2022'}).code.trim(),source.trim(),'CSS not normalized/comment-free');}
js('const literal="/*not a comment*/";');
assert.throws(()=>js('/*comment*/const x=1;'));
assert.throws(()=>css('body{color:red}/*comment*/'));
input.css.forEach(css);
if(input.scripts){
 js(input.scripts['core-source']);
 const app=js(input.scripts['app-source']),starter=js(input.scripts['starter-source'],'module');
 const sandbox=app.find(s=>s.startsWith('<!doctype html>')&&s.includes('html-dbms-ready'));
 const starterMarkup=starter.find(s=>s.startsWith('<header>')&&s.includes('new-document'));
 const starterCSS=starter.find(s=>s.startsWith('body{')&&s.includes('font:'));
 assert.ok(sandbox&&starterMarkup&&starterCSS,'Embedded sandbox/starter missing');
 css(starterCSS);console.log(JSON.stringify({sandbox,starterMarkup}));
}else{js(input.sandbox);console.log('{}');}
"""
def syntax_audit(html_scripts,xml):
    assert not html_scripts.comments, 'HTML comments found'
    xml_comments=ET.fromstring(xml,parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    assert not any(node.tag is ET.Comment for node in xml_comments.iter()), 'XML comments found'
    styles=[node.text or '' for node in xml_comments.iter('{'+XHTML+'}style')]
    assert html_scripts.styles==styles
    assert len(styles)==1
    assert json.loads(html_scripts.scripts['db-store'])=={'format':'HTML_DBMS/4','publicHeads':{},'records':{}}
    result=json.loads(subprocess.check_output(['node','-e',NODE_AUDIT],input=json.dumps({'scripts':html_scripts.scripts,'css':styles}),text=True,cwd=ROOT))
    sandbox=ExtractHTML();sandbox.feed(result['sandbox']);sandbox.close()
    starter=ExtractHTML();starter.feed(result['starterMarkup']);starter.close()
    assert not sandbox.comments and not starter.comments
    assert len(sandbox.scripts)==1 and not starter.scripts
    subprocess.check_output(['node','-e',NODE_AUDIT],input=json.dumps({'sandbox':next(iter(sandbox.scripts.values())),'css':sandbox.styles+starter.styles}),text=True,cwd=ROOT)
    print('SYNTAX AUDIT PASS: HTML/XML, shell/core/starter/sandbox AST, markup and CSS; no own comments or Node loader')

def get_xml_store(xml):
    node=ET.fromstring(xml).find('.//{'+XHTML+'}script[@id="db-store"]')
    assert node is not None
    return json.loads(node.text)


def main():
    before=[(ROOT/'dist'/('html_dbms.'+ext)).read_bytes() for ext in ('html','xml')]
    subprocess.run(['python3','build.py'],cwd=ROOT,check=True)
    assert before==[(ROOT/'dist'/('html_dbms.'+ext)).read_bytes() for ext in ('html','xml')], 'Non-deterministic build'
    html=(ROOT/'dist/html_dbms.html').read_text(encoding='utf-8')
    xml=(ROOT/'dist/html_dbms.xml').read_text(encoding='utf-8')
    assert html.startswith('<!doctype html>')
    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    document=ET.fromstring(xml)
    assert document.tag=='{'+XHTML+'}html'
    assert all(elem.tag.startswith('{'+XHTML+'}') for elem in document.iter())
    ids=[elem.attrib['id'] for elem in document.iter() if 'id' in elem.attrib]
    assert len(ids)==len(set(ids))
    html_scripts=ExtractHTML();html_scripts.feed(html)
    xml_scripts=[x for x in document.iter() if x.tag=='{'+XHTML+'}script']
    assert len(xml_scripts)==4
    for x in xml_scripts:
        key=x.attrib.get('id')
        content=x.text or ''
        assert key in ('db-store','starter-source','core-source','app-source')
        assert content==html_scripts.scripts[key], key
    assert get_xml_store(xml)==json.loads(html_scripts.scripts['db-store'])
    syntax_audit(html_scripts,xml)
    assert 'allow-scripts' in xml and 'allow-same-origin' not in xml
    assert len(html.encode('utf-8'))<66290 and len(xml.encode('utf-8'))<66483
    assert not any(x in html for x in ('require(\"node:crypto\")','Buffer.from','module.exports','Sequence is derived from verified ancestry','sourceMappingURL='))
    # Audit unusual but valid JSON content while leaving encrypted records untouched.
    sentinel='\u003cscript/> & ]]> </script> \u2028 π'
    physical={'format':'HTML_DBMS/4','records':{'ABCD':sentinel},'publicHeads':{'Участники':'A'*64}}
    raw=json.dumps(physical,ensure_ascii=False)
    from importlib.machinery import SourceFileLoader
    build=SourceFileLoader('hdbms_builder',str(ROOT/'build.py')).load_module()
    # XML text may use escaped characters or split CDATA, but must round-trip.
    xml_modified=xml.replace('<![CDATA[{"format":"HTML_DBMS/4","publicHeads":{},"records":{}}]]>',build.cdata(raw))
    assert get_xml_store(xml_modified)==physical
    assert ET.fromstring(xml_modified).tag=='{'+XHTML+'}html'
    from importlib.machinery import SourceFileLoader
    build=SourceFileLoader('hdbms_builder',str(ROOT/'build.py')).load_module()
    assert build.html_script_safe("const x='</script>';") == "const x='<\\/script>';"
    assert build.html_script_safe("const y='</ScRiPt >';") == "const y='<\\/ScRiPt >';"
    for text in ['some ]]> text','</script> & <tag>', '🙂 Привет & < >']:
        wrapped='<root>'+build.cdata(text)+'</root>'
        assert ET.fromstring(wrapped).text==text
    assert not any(x in xml for x in ['/* CORE_JS */','/* APP_JS */','/* STARTER_JS */'])
    print('DUAL BUILD PASS: XHTML namespace, well-formed XML, exact JS/CSS data, special strings, physical-store parity')

if __name__=='__main__':main()
