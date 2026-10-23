(function(){
const URL='https://zjeljjgfbqalaxqamjhb.supabase.co/functions/v1/cerimonial-sync';
const EVENT='a8be272b-8c44-495a-9773-e8fc3241d53a';
let code=sessionStorage.getItem('cerimonial_code')||'',connected=false,admin=false,version=-1,busy=false,app,redraw,status;
const toast=(t,k)=>window.showToast?window.showToast(t,k||'info'):alert(t);
async function request(action,extra={}){
const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),20000);
try{const r=await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:EVENT,code,action,...extra}),signal:ctl.signal,cache:'no-store'});
const data=await r.json();if(!r.ok)throw Error(data.error||'Erro');return data;}finally{clearTimeout(timer);}
}
async function apply(data){
if(!data.items.length){status.textContent='Conectado - aguardando carômetro';return;}
app.authorities=window.CerimonialNominata.getSortedAuthorities(data.items);
app.eventName=data.name||app.eventName;
app.manualCounter=app.authorities.filter(a=>a.isManual).length;
await window.CerimonialDB.saveState(app.authorities,app.manualCounter,app.eventName,app.sourcePdfName);
redraw();status.textContent='● Sincronizado';
}
async function refresh(force=false){
if(!connected||busy)return;busy=true;
try{const v=await request('version');if(force||v.version!==version){const data=await request('read');version=data.version;admin=data.admin;await apply(data);}else status.textContent='● Sincronizado';}
catch(e){status.textContent='⚠ Sem sincronização';console.error(e);}finally{busy=false;}
}
async function connect(saved=false){
const previous=code;
if(!saved){const entered=prompt('Código do evento:');if(entered===null)return;code=entered.trim().toUpperCase();}
try{const data=await request('read');connected=true;admin=data.admin;version=data.version;sessionStorage.setItem('cerimonial_code',code);await apply(data);status.textContent=admin?'● Administrador conectado':'● Operador conectado';if(!saved)toast('Conectado ao evento','success');}
catch(e){code=saved?'':previous;if(saved)sessionStorage.removeItem('cerimonial_code');status.textContent='○ Sem conexão';if(!saved)toast('Código inválido ou servidor indisponível','error');}
}
async function presence(item){
if(!connected)return false;
try{status.textContent='⟳ Registrando...';await request('toggle',{id:item.id,present:!item.present});await refresh(true);}
catch(e){status.textContent='⚠ Presença NÃO registrada';toast('Falha ao registrar presença. Tente novamente.','error');}
return true;
}
async function publish(){
if(!connected||!admin){toast('Entre com código de administrador','error');return;}
if(!app.authorities.length){toast('Importe o carômetro antes','error');return;}
if(!confirm('Substituir TODOS os dados e presenças compartilhados pelo carômetro deste aparelho?'))return;
try{status.textContent='⟳ Publicando...';const result=await request('upload',{items:app.authorities,name:app.eventName});version=result.version;toast('Carômetro publicado!','success');await refresh(true);}
catch(e){status.textContent='⚠ Falha ao publicar';toast('Publicação falhou: '+e.message,'error');}
}
function init(state,render){
app=state;redraw=render;const bar=document.createElement('div');
bar.style.cssText='position:fixed;bottom:10px;left:10px;z-index:9999;display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:9px;border-radius:9px;background:#17334d;color:white;font:13px Arial;box-shadow:0 2px 12px #0005;max-width:calc(100vw - 20px)';
status=document.createElement('span');status.textContent='○ Sem conexão';bar.append(status);
for(const [name,fn] of [['Conectar evento',()=>connect()],['Publicar carômetro',publish]]){
const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=fn;b.style.cssText='padding:7px;border-radius:5px;background:white;color:#17334d;cursor:pointer';bar.append(b);}
document.body.append(bar);if(code)connect(true);setInterval(()=>refresh(),2000);
}
window.CerimonialSync={init,presence,isConnected:()=>connected};
})();