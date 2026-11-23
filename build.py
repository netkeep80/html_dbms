from pathlib import Path
root=Path(__file__).parent
html=(root/'src/index.html').read_text(encoding='utf-8')
for name,marker in [('core.js','/* CORE_JS */'),('app.js','/* APP_JS */'),('starter.js','/* STARTER_JS */')]:
    script=(root/'src'/name).read_text(encoding='utf-8')
    assert '</script' not in script.lower(), name
    assert html.count(marker)==1
    html=html.replace(marker,script)
assert all(token not in html for token in ('/* CORE_JS */','/* APP_JS */','/* STARTER_JS */'))
(root/'dist').mkdir(exist_ok=True)
(root/'dist/html_dbms.html').write_text(html,encoding='utf-8')
print('Wrote',root/'dist/html_dbms.html',len(html),'characters')
