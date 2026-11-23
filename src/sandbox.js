(function(){'use strict';let sequence=0;const pending=new Map(),channel=new MessageChannel(),port=channel.port1;
const request=(method,payload)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});port.postMessage({kind:'html-dbms-rpc',id,method,payload});});
const api=Object.freeze({read:(ref='')=>request('read',{ref}),patch:(document,operations)=>request('patch',{document,operations}),createDocument:(name,state)=>request('createDocument',{name,state}),getHead:()=>request('getHead',{})});
let started=false;
port.onmessage=async event=>{const data=event.data;if(!data||typeof data!=='object')return;if(data.kind==='html-dbms-reply'){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.ok?p.resolve(data.value):p.reject(new Error(data.error));}
if(data.kind==='html-dbms-start'&&!started){started=true;try{const blob=new Blob([data.source],{type:'text/javascript'});const url=URL.createObjectURL(blob);try{const module=await import(url);const main=module[data.exportName||'main'];if(typeof main!=='function')throw Error('Не найден export '+data.exportName);await main(api,document.getElementById('app'));}finally{URL.revokeObjectURL(url);}}catch(e){document.getElementById('app').textContent='Ошибка запуска entry: '+(e?.message||e);port.postMessage({kind:'html-dbms-error',error:String(e?.message||e)});}}};
window.addEventListener('pagehide',()=>{port.postMessage({kind:'html-dbms-revoke'});port.close();},{once:true});
parent.postMessage({kind:'html-dbms-ready'},'*',[channel.port2]);})();
