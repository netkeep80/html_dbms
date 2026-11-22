from pathlib import Path
root = Path(__file__).parent
html = (root/'src/index.html').read_text(encoding='utf-8')
for name, token in [('core.js','/* CORE_JS */'), ('app.js','/* APP_JS */')]:
    js = (root/'src'/name).read_text(encoding='utf-8')
    assert '</script' not in js.lower(), name+' contains unsafe script terminator'
    html = html.replace(token, js)
assert '/* CORE_JS */' not in html and '/* APP_JS */' not in html
(root/'dist').mkdir(exist_ok=True)
(root/'dist/html_dbms.html').write_text(html, encoding='utf-8')
print('Wrote', root/'dist/html_dbms.html', len(html), 'chars')
