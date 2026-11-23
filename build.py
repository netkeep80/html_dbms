"""Produce equivalent standalone HTML and XML/XHTML containers from one source tree.

No protocol encoding/serialization, encryption, or runtime JS is changed by this builder.
"""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'src'
DIST = ROOT / 'dist'
XHTML = 'http://www.w3.org/1999/xhtml'
SCRIPTS = {'/* CORE_JS */': 'core.js', '/* APP_JS */': 'app.js', '/* STARTER_JS */': 'starter.js'}
VOID = frozenset('area base br col embed hr img input link meta param source track wbr'.split())


def sources():
    html = (SOURCE / 'index.html').read_text(encoding='utf-8')
    for marker, name in SCRIPTS.items():
        code = (SOURCE / name).read_text(encoding='utf-8')
        if '</script' in code.lower():
            raise ValueError(f'{name}: literal closing script tag would corrupt HTML')
        if html.count(marker) != 1:
            raise ValueError(f'{name}: expected exactly one insertion marker')
        html = html.replace(marker, code)
    return html


def cdata(value):
    # Splitting the terminator preserves EXACT JavaScript/CSS/JSON textContent.
    return '<![CDATA[' + value.replace(']]>', ']]]]><![CDATA[>') + ']]>'


class XHTMLBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.stack = []

    def handle_decl(self, decl):
        if decl.lower() != 'doctype html':
            raise ValueError('Unexpected document declaration: ' + decl)

    def handle_starttag(self, tag, attrs):
        if tag == 'html':
            if any(k == 'xmlns' for k, _ in attrs):
                raise ValueError('The template already declares xmlns')
            attrs = [('xmlns', XHTML), *attrs]
        attr_text = ''.join(f' {key}="{escape(val if val is not None else key, quote=True)}"' for key, val in attrs)
        if tag in VOID:
            self.parts.append(f'<{tag}{attr_text} />')
        else:
            self.parts.append(f'<{tag}{attr_text}>')
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack or self.stack.pop() != tag:
            raise ValueError('Unbalanced HTML template near </' + tag + '>')
        self.parts.append(f'</{tag}>')

    def handle_data(self, text):
        if self.stack and self.stack[-1] in ('script', 'style'):
            self.parts.append(cdata(text))
        else:
            self.parts.append(escape(text))

    def handle_entityref(self, name):
        self.parts.append('&amp;' + name + ';')

    def handle_comment(self, data):
        if '--' in data or data.endswith('-'):
            raise ValueError('Invalid XML comment')
        self.parts.append('<!--' + data + '-->')

    def finish(self):
        if self.stack:
            raise ValueError('Unclosed HTML elements: ' + repr(self.stack))
        result = '<?xml version="1.0" encoding="UTF-8"?>\n' + ''.join(self.parts)
        root = ET.fromstring(result)
        if root.tag != '{' + XHTML + '}html':
            raise ValueError('XHTML root namespace missing')
        store = root.find('.//{' + XHTML + '}script[@id="db-store"]')
        if store is None:
            raise ValueError('XML lacks db-store')
        return result


def build():
    # Convert the template BEFORE inserting JS, so HTMLParser never treats
    # JavaScript '<', '&' or literal script-looking strings as HTML syntax.
    source_template = (SOURCE / 'index.html').read_text(encoding='utf-8')
    parser = XHTMLBuilder()
    parser.feed(source_template)
    parser.close()
    xml_template = parser.finish()
    xml = xml_template
    for marker, name in SCRIPTS.items():
        code = (SOURCE / name).read_text(encoding='utf-8')
        # Marker is inside its own CDATA node, replace the entire node.
        placeholder = cdata(marker)
        if xml.count(placeholder) != 1:
            raise ValueError('XML insertion marker must occur exactly once: ' + name)
        xml = xml.replace(placeholder, cdata(code))
    ET.fromstring(xml)
    html = sources()
    if any(marker in html or marker in xml for marker in SCRIPTS):
        raise ValueError('Unexpanded source marker')
    DIST.mkdir(exist_ok=True)
    (DIST / 'html_dbms.html').write_text(html, encoding='utf-8')
    (DIST / 'html_dbms.xml').write_text(xml, encoding='utf-8')
    print('Built HTML', len(html.encode('utf-8')), 'bytes; XHTML/XML', len(xml.encode('utf-8')), 'bytes')


if __name__ == '__main__':
    build()
