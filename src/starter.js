/* Default application template. This source is stored in the newly created root JSON entry. */
export async function main(db, mount) {
  const css = document.createElement('style');
  css.textContent = 'body{font:14px/1.5 system-ui;color:#e5edf8;background:#0d1724;margin:0}button,select,textarea,input{font:inherit;color:inherit;background:#192c41;border:1px solid #435c77;border-radius:5px;padding:6px}button{cursor:pointer}button:hover{background:#2b4f6e}button:disabled{opacity:.6}header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 8px;border-bottom:1px solid #35516b}strong{margin-right:auto}main{padding:12px}h2{font-size:16px}pre,textarea{font:12px/1.5 ui-monospace,Consolas,monospace;background:#081522;padding:12px;border-radius:6px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}textarea{width:100%;box-sizing:border-box;min-height:130px}pre{max-height:65vh}button.active{background:#236d83}.meta{color:#92aec8;font-size:12px}#message{min-height:19px;color:#a9d8bd}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #34465a;padding:7px}';
  document.head.appendChild(css);
  mount.innerHTML = '<header><strong id="db-title">Документы JSON</strong><span class="meta" id="entry-state">● Приложение запущено из entry</span><button id="add-document">+ Документ</button><button id="edit-document">JSON Patch</button><button id="refresh">Обновить</button></header><main><nav id="document-nav"></nav><p id="message" role="status"></p><section id="new-document" hidden><h2>Новый документ</h2><label>Имя документа <input id="new-document-name" autocomplete="off"></label><p>Начальное JSON-состояние</p><textarea id="new-document-json" spellcheck="false">{}</textarea><p><button id="create-document">Создать документ</button><button id="cancel-create">Отмена</button></p></section><section id="editor" hidden><h2>Изменить документ · RFC 6902</h2><textarea id="patch" spellcheck="false">[{"op":"add","path":"/example","value":1}]</textarea><p><button id="write">Записать</button><button id="cancel">Отмена</button></p></section><h2 id="document-title">Корневой документ</h2><pre id="json"></pre></main>';
  const $ = id => document.getElementById(id);
  let current = '';
  const msg=(text,bad=false)=>{$('message').textContent=text;$('message').style.color=bad?'#ffa4a4':'#9bd9b8';};
  const nav = $('document-nav');
  async function draw() {
    const root=await db.read('');
    $('db-title').textContent=root.name||'JSON DB';
    nav.replaceChildren();
    const names=['',...Object.keys(root.$refs||{})];
    if(!names.includes(current))current='';
    for(const name of names){const b=document.createElement('button');b.textContent=name||'⌂ Корень';b.className=name===current?'active':'';b.style.margin='0 6px 6px 0';b.addEventListener('click',()=>{current=name;draw().catch(e=>msg(e.message,true));});nav.appendChild(b);}
    $('document-title').textContent=current||'Корневой JSON · исходный код entry скрыт';
    const visible=current?await db.read(current+'/'):JSON.parse(JSON.stringify(root));
    if(!current&&visible.entry&&visible.entry.type==='application/javascript'&&typeof visible.entry.source==='string'){
      visible.entry.source='[JS-код скрыт в рабочем представлении; полный исходный текст — в системной «Отладка»]';
    }
    $('json').textContent=JSON.stringify(visible,null,2);
  }
  $('add-document').onclick=()=>{$('new-document').hidden=!$('new-document').hidden;if(!$('new-document').hidden)$('new-document-name').focus();};
  $('cancel-create').onclick=()=>{$('new-document').hidden=true;};
  $('create-document').onclick=async()=>{try{
    const name=$('new-document-name').value.trim();
    if(!name)throw Error('Введите имя нового документа');
    const state=JSON.parse($('new-document-json').value);
    await db.createDocument(name,state);
    current=name;$('new-document').hidden=true;$('new-document-name').value='';$('new-document-json').value='{}';
    await draw();msg('Документ создан');
  }catch(e){msg(e.message,true);}};
  $('edit-document').onclick=()=>{$('editor').hidden=!$('editor').hidden;};
  $('cancel').onclick=()=>{$('editor').hidden=true;};
  $('write').onclick=async()=>{try{await db.patch(current,JSON.parse($('patch').value));$('editor').hidden=true;await draw();msg('Изменение записано. Сохраните HTML в системной строке.');}catch(e){msg(e.message,true);}};
  $('refresh').onclick=()=>draw().catch(e=>msg(e.message,true));
  await draw();
  msg('Приложение из entry успешно запущено. Выберите документ или создайте новый.');
}
