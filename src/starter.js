/* Default application template. This source is stored in the newly created root JSON entry. */
export async function main(db, mount) {
  const css = document.createElement('style');
  css.textContent = '/* STARTER_CSS */';
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
