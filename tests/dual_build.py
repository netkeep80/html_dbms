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
    def handle_starttag(self,tag,attrs):
        if tag=='script':
            self.current=dict(attrs).get('id','dynamic-'+str(len(self.scripts)))
            self.scripts[self.current]=''
    def handle_endtag(self,tag):
        if tag=='script':self.current=None
    def handle_data(self,data):
        if self.current is not None:self.scripts[self.current]+=data


def get_xml_store(xml):
    node=ET.fromstring(xml).find('.//{'+XHTML+'}script[@id="db-store"]')
    assert node is not None
    return json.loads(node.text)


def main():
    subprocess.run(['python3','build.py'],cwd=ROOT,check=True)
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
        if key == 'starter-source':
            assert content==(ROOT/'src/starter.js').read_text(encoding='utf-8')
        elif key == 'db-store':
            assert content==html_scripts.scripts['db-store']
        else:
            expected=(ROOT/'src/core.js').read_text(encoding='utf-8') if 'Sequence is derived from verified ancestry' in content else (ROOT/'src/app.js').read_text(encoding='utf-8')
            assert content==expected
    assert get_xml_store(xml)==json.loads(html_scripts.scripts['db-store'])
    assert 'allow-scripts' in xml and 'allow-same-origin' not in xml
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
    assert build.html_script_safe("const y='</ScRiPt >';") == "const y='<\\/script >';"
    for text in ['some ]]> text','</script> & <tag>', '🙂 Привет & < >']:
        wrapped='<root>'+build.cdata(text)+'</root>'
        assert ET.fromstring(wrapped).text==text
    assert not any(x in xml for x in ['/* CORE_JS */','/* APP_JS */','/* STARTER_JS */'])
    print('DUAL BUILD PASS: XHTML namespace, well-formed XML, exact JS/CSS data, special strings, physical-store parity')

if __name__=='__main__':main()
