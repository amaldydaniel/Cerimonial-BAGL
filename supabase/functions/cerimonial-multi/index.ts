// Cerimonial Multiunidades — API de contas, Master e Gestor de Usuários
// Autenticação via Supabase Auth. Chaves secretas disponíveis SOMENTE no servidor.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const ROOT = Deno.env.get('SUPABASE_URL') || '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ORIGINS = new Set(['https://amaldydaniel.github.io','http://127.0.0.1:8081','http://localhost:8081']);
const REDIRECT = 'https://amaldydaniel.github.io/Cerimonial-BAGL/';
const RECOVERY_REDIRECTS: Record<string,string> = {
  'http://127.0.0.1:8081': 'http://127.0.0.1:8081/',
  'http://localhost:8081': 'http://localhost:8081/',
  'https://amaldydaniel.github.io': REDIRECT
};
const encoder = new TextEncoder();
const headers = (origin: string) => ({
  'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'null',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,authorization,apikey',
  'Access-Control-Max-Age': '600', 'Vary':'Origin',
  'Content-Type':'application/json', 'Cache-Control':'no-store'
});
const reply = (obj: unknown, status=200, origin='') =>
  new Response(JSON.stringify(obj), {status,headers:headers(origin)});
const validLogin = (x: unknown) => typeof x==='string' && /^[A-Z0-9_-]{2,20}$/.test(x.trim().toUpperCase());
const validEmail = (x: unknown) => typeof x==='string' && x.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const validPassword = (x: unknown) => typeof x==='string' && x.length>=4 && x.length<=128;
const canManageUnits = (role: string) => role==='master' || role==='manager';
const authHeaders = (key: string) => ({'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key});
async function rpc(action: string, values: Record<string,unknown>={}) {
  const r = await fetch(ROOT+'/rest/v1/rpc/cerimonial_multi_api', {
    method:'POST',headers:authHeaders(SERVICE),body:JSON.stringify({p_action:action,...values})
  });
  if(!r.ok) { console.error('cerimonial-multi RPC',action,r.status); throw new Error('Operação rejeitada pelo armazenamento'); }
  return r.json();
}
async function authUser(token: string) {
  if (!token || token.length>3000) return null;
  const r = await fetch(ROOT+'/auth/v1/user',{headers:{'apikey':ANON,'Authorization':'Bearer '+token}});
  if (!r.ok) return null;
  const user = await r.json();
  return typeof user?.id==='string' ? user : null;
}
async function authAdmin(path: string, method: 'POST'|'PUT'|'DELETE', body?: unknown) {
  const r = await fetch(ROOT+'/auth/v1/admin/'+path,{method,headers:authHeaders(SERVICE),
    body:body===undefined?undefined:JSON.stringify(body)});
  const value=await r.json().catch(()=>({}));
  if(!r.ok) {
    const code=String(value?.error_code||value?.code||'');
    console.error('cerimonial-multi admin',method,path,r.status,code);
    if(code==='email_exists')throw Object.assign(new Error('Este e-mail já está cadastrado em outra conta. Use um e-mail exclusivo da unidade.'),{status:409});
    if(code==='weak_password'||code==='password_too_short')throw Object.assign(new Error('A senha não atende aos requisitos do Supabase. Informe uma senha mais forte.'),{status:422});
    if(r.status===422)throw Object.assign(new Error('Dados recusados pelo Supabase. Confira o e-mail e a política de senha.'),{status:422});
    throw new Error('Não foi possível administrar a conta.');
  }
  return value;
}
async function passwordAuth(email: string, password: string) {
  const r=await fetch(ROOT+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{'apikey':ANON,'Content-Type':'application/json'},
    body:JSON.stringify({email,password})
  });
  return r.ok?await r.json():null;
}
async function sendRecovery(email: string, origin: string) {
  const redirect=RECOVERY_REDIRECTS[origin] || REDIRECT;
  const r=await fetch(ROOT+'/auth/v1/recover?redirect_to='+encodeURIComponent(redirect),{
    method:'POST',headers:{'apikey':ANON,'Content-Type':'application/json'},
    body:JSON.stringify({email})
  });
  if(!r.ok) {
    console.error('cerimonial-multi recovery failed',r.status);
    throw new Error('Não foi possível enviar o e-mail');
  }
}
async function digestIp(req: Request) {
  const ip=req.headers.get('cf-connecting-ip')||
      req.headers.get('x-real-ip')||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'desconhecido';
  const pepper=Deno.env.get('CERIMONIAL_RATE_PEPPER')||SERVICE;
  const hash=await crypto.subtle.digest('SHA-256',encoder.encode(pepper+':'+ip));
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async (req: Request) => {
  const origin=req.headers.get('origin')||'';
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(origin)});
  if(!ORIGINS.has(origin)||req.method!=='POST')return reply({error:'Origem ou método inválido'},403,origin);
  if(!ROOT||!SERVICE||!ANON)return reply({error:'Configuração do servidor indisponível'},503,origin);
  const length=Number(req.headers.get('content-length')||0);
  if(length>14500000)return reply({error:'Carômetro maior que 14 MB'},413,origin);
  try {
    const body=await req.json(),action=String(body?.action||'');
    if(action==='login') {
      if(!validLogin(body.username)||typeof body.password!=='string')
        return reply({error:'Usuário ou senha incorretos'},401,origin);
      const found=await rpc('login_lookup',{p_login:body.username});
      if(!found.found)return reply({error:'Usuário ou senha incorretos'},401,origin);
      // Limite global por conta, persistente no banco e compartilhado entre dispositivos.
      // Cinco senhas erradas bloqueiam NOVOS logins por 15 minutos.
      const loginGuard=async(phase:'precheck'|'failure'|'success')=>{
        const response=await fetch(ROOT+'/rest/v1/rpc/cerimonial_login_guard',{
          method:'POST',headers:authHeaders(SERVICE),
          body:JSON.stringify({p_login:body.username,p_action:phase,p_actor:null})
        });
        if(!response.ok)throw new Error('Não foi possível validar o limite de tentativas. Tente novamente.');
        return response.json();
      };
      const lockMessage='Acesso temporariamente bloqueado após 5 tentativas incorretas. Aguarde 15 minutos ou recupere a senha.';
      const before=await loginGuard('precheck');
      if(!before.allowed) {
        return reply({error:before.reason==='locked'?lockMessage:'Usuário ou senha incorretos',
          locked:before.reason==='locked',retrySeconds:before.retry_seconds??null},
          before.reason==='locked'?429:401,origin);
      }
      const auth=await passwordAuth(found.email,body.password);
      if(!auth?.access_token) {
        const failed=await loginGuard('failure');
        if(failed.reason==='locked')return reply({error:lockMessage,locked:true,
          retrySeconds:failed.retry_seconds??900},429,origin);
        const remaining=Math.max(0,Number(failed.remaining??0));
        return reply({error:'Usuário ou senha incorretos. Restam '+remaining+
          (remaining===1?' tentativa.':' tentativas.')},401,origin);
      }
      const user=await authUser(auth.access_token);
      if(!user)return reply({error:'Autenticação inválida'},401,origin);
      const checked=await loginGuard('success');
      if(!checked.allowed)return reply({error:lockMessage,locked:true,
        retrySeconds:checked.retry_seconds??null},429,origin);
      const account=await rpc('whoami',{p_actor:user.id});
      return reply({token:auth.access_token,refresh:auth.refresh_token,
        expiresIn:auth.expires_in,account},200,origin);
    }
    if(action==='refresh') {
      if(typeof body.refresh!=='string'||body.refresh.length>3000)
        return reply({error:'Sessão inválida'},401,origin);
      const r=await fetch(ROOT+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST',headers:{'apikey':ANON,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:body.refresh})
      });
      if(!r.ok)return reply({error:'Sessão expirada'},401,origin);
      const auth=await r.json();
      const user=await authUser(auth.access_token);
      if(!user)return reply({error:'Sessão inválida'},401,origin);
      const account=await rpc('whoami',{p_actor:user.id});
      return reply({token:auth.access_token,refresh:auth.refresh_token,
        expiresIn:auth.expires_in,account},200,origin);
    }
    if(action==='recovery_lookup') {
      if(!validLogin(body.username))return reply({found:false},200,origin);
      return reply(await rpc('recovery_lookup',{p_login:body.username,p_ip_digest:await digestIp(req)}),200,origin);
    }
    if(action==='recovery_send') {
      if(!validLogin(body.username))return reply({error:'Solicitação inválida'},400,origin);
      const g=await rpc('recovery_guard',{p_login:body.username,p_ip_digest:await digestIp(req)});
      if(!g.allowed)return reply({error:'Aguarde antes de solicitar outro link. Contate o administrador se necessário.',reason:g.reason},429,origin);
      await sendRecovery(g.email,origin);
      return reply({sent:true},200,origin);
    }
    const token=typeof body.session==='string'?body.session:'';
    const user=await authUser(token);
    if(!user)return reply({error:'Sessão inválida ou expirada'},401,origin);
    if(action==='apply_recovery') {
      if(!validPassword(body.newPassword))return reply({error:'Senha inválida'},400,origin);
      // O token de recuperação será validado pela própria API Auth.
      const r=await fetch(ROOT+'/auth/v1/user',{
        method:'PUT',headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+token},
        body:JSON.stringify({password:body.newPassword})
      });
      if(!r.ok)return reply({error:'Não foi possível atualizar a senha. Confira os requisitos do Auth.'},400,origin);
      // Recuperação autenticada do próprio titular encerra também o bloqueio de login.
      const logged=await rpc('whoami',{p_actor:user.id});
      if(logged?.login){
        const unlocked=await fetch(ROOT+'/rest/v1/rpc/cerimonial_login_guard',{
          method:'POST',headers:authHeaders(SERVICE),
          body:JSON.stringify({p_login:logged.login,p_action:'recovered',p_actor:user.id})
        });
        if(!unlocked.ok)console.error('cerimonial-multi recovery unlock',unlocked.status);
      }
      return reply({ok:true},200,origin);
    }
    const mine=await rpc('whoami',{p_actor:user.id});
    if(action==='change_password') {
      if(!validPassword(body.newPassword)||!validPassword(body.currentPassword))
        return reply({error:'Senha inválida'},400,origin);
      const verified=await passwordAuth(mine.email,body.currentPassword);
      if(!verified)return reply({error:'Senha atual incorreta'},403,origin);
      const r=await fetch(ROOT+'/auth/v1/user',{
        method:'PUT',headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+token},
        body:JSON.stringify({password:body.newPassword})
      });
      if(!r.ok)return reply({error:'Não foi possível alterar a senha. Confira a política do Auth.'},400,origin);
      return reply({ok:true},200,origin);
    }
    if(action==='whoami')return reply(mine,200,origin);
    if(action==='admin_list') {
      if(!canManageUnits(mine.role))return reply({error:'Acesso restrito'},403,origin);
      const units=await rpc('list_units',{p_actor:user.id});
      const response=await fetch(ROOT+'/rest/v1/rpc/cerimonial_admin_exclusoes_pendentes',{
        method:'POST',headers:authHeaders(SERVICE),body:JSON.stringify({p_actor:user.id})
      });
      if(!response.ok)throw new Error('Falha ao consultar exclusões pendentes');
      const pending=await response.json();
      return reply({...units,pending:Array.isArray(pending)?pending:[]},200,origin);
    }
    if(action==='admin_create'||action==='admin_create_manager') {
      if(!canManageUnits(mine.role)||(action==='admin_create_manager'&&mine.role!=='master'))
        return reply({error:'Acesso restrito'},403,origin);
      const login=String(body.login||'').trim().toUpperCase();
      if(!validLogin(login)||!validEmail(body.email)||!validPassword(body.password)||
          typeof body.name!=='string'||body.name.trim().length<2)
        return reply({error:'Dados inválidos'},400,origin);
      const created=await authAdmin('users','POST',{
        email:body.email.trim().toLowerCase(),password:body.password,email_confirm:true
      });
      try {
        const v=await rpc(action==='admin_create_manager'?'register_manager':'register_unit',{
          p_actor:user.id,p_login:login,p_target_uid:created.id,
          p_email:body.email,p_nome:body.name});
        return reply(v,201,origin);
      } catch(e) {
        await authAdmin('users/'+created.id,'DELETE').catch(()=>{});
        throw e;
      }
    }
    if(action==='admin_active'||action==='admin_unlock') {
      if(!canManageUnits(mine.role)||!validLogin(body.login))return reply({error:'Acesso restrito'},403,origin);
      const p={p_actor:user.id,p_login:body.login};
      return reply(await rpc(action==='admin_active'?'set_active':'reset_recovery',
        action==='admin_active'?{...p,p_active:!!body.active}:p),200,origin);
    }
    if(action==='admin_update_name') {
      if(!canManageUnits(mine.role)||!validLogin(body.login))return reply({error:'Acesso restrito'},403,origin);
      const name=typeof body.name==='string'?body.name.trim():'';
      if(name.length<2||name.length>120)return reply({error:'Nome da unidade inválido'},400,origin);
      const r=await fetch(ROOT+'/rest/v1/rpc/cerimonial_admin_editar_nome',{
        method:'POST',headers:authHeaders(SERVICE),
        body:JSON.stringify({p_actor:user.id,p_login:body.login,p_nome:name})
      });
      if(!r.ok)throw new Error('Não foi possível atualizar o nome da unidade.');
      return reply(await r.json(),200,origin);
    }
    if(action==='admin_delete') {
      if(!canManageUnits(mine.role)||!validLogin(body.login))return reply({error:'Acesso restrito'},403,origin);
      const login=String(body.login).trim().toUpperCase();
      if(body.confirmLogin!==login)return reply({error:'Confirme o login exato antes da exclusão.'},400,origin);
      // A operação começa bloqueando imediatamente a unidade. Cada chamada SQL
      // valida a hierarquia no banco; Master nunca pode ser alvo de exclusão.
      const deleteRpc=async(phase: 'preparar'|'finalizar',uid?:string)=>{
        const r=await fetch(ROOT+'/rest/v1/rpc/cerimonial_admin_excluir_unidade',{
          method:'POST',headers:authHeaders(SERVICE),
          body:JSON.stringify({p_actor:user.id,p_login:login,p_fase:phase,p_uid:uid??null})
        });
        if(!r.ok){
          console.error('cerimonial-multi unit delete RPC',phase,r.status);
          throw Object.assign(new Error(phase==='preparar'
            ?'Não foi possível preparar a exclusão. Nenhuma alteração foi concluída.'
            :'O cadastro foi removido; falta confirmar o encerramento da conta de acesso.'),{status:502});
        }
        return r.json();
      };
      const prepared=await deleteRpc('preparar');
      const uid=String(prepared?.user_id||'');
      if(!/^[0-9a-f-]{36}$/i.test(uid))
        throw Object.assign(new Error('Cadastro bloqueado; ID da conta inválido. Procure o administrador.'),{status:502});
      // Usar sempre a API oficial do Auth para apagar usuário e sessões.
      const deleted=await fetch(ROOT+'/auth/v1/admin/users/'+encodeURIComponent(uid),{
        method:'DELETE',headers:authHeaders(SERVICE)
      }).catch(()=>null);
      if(!deleted || (!deleted.ok && deleted.status!==404)){
        console.error('cerimonial-multi user deletion pending',deleted?.status);
        return reply({error:'O carômetro foi removido, mas a conta de autenticação ainda exige finalização. Clique em Concluir exclusão.',partial:true},502,origin);
      }
      const final=await deleteRpc('finalizar',uid);
      return reply(final,200,origin);
    }
    if(action==='admin_reset_password'||action==='admin_set_email') {
      if(!canManageUnits(mine.role)||!validLogin(body.login))return reply({error:'Acesso restrito'},403,origin);
      const target=await rpc('master_target',{p_actor:user.id,p_login:body.login});
      if(action==='admin_reset_password') {
        if(!validPassword(body.password))return reply({error:'Senha inválida'},400,origin);
        await authAdmin('users/'+target.user_id,'PUT',{password:body.password});
      } else {
        if(!validEmail(body.email))return reply({error:'E-mail inválido'},400,origin);
        await authAdmin('users/'+target.user_id,'PUT',{email:body.email.trim().toLowerCase(),email_confirm:true});
        await rpc('set_email',{p_actor:user.id,p_login:body.login,p_email:body.email});
      }
      return reply({ok:true},200,origin);
    }
    if(['read','version','presences','toggle','upload','clear'].includes(action)) {
      if(mine.role!=='unit')return reply({error:'Painel exclusivo da unidade'},403,origin);
      if(action==='upload'&&(!Array.isArray(body.items)||body.items.length>2000||
          JSON.stringify(body.items).length>14000000))
        return reply({error:'Carômetro inválido'},413,origin);
      const result=await rpc(action,{p_actor:user.id,p_authority:body.id??null,
        p_present:typeof body.present==='boolean'?body.present:null,
        p_items:action==='upload'?body.items:null,p_name:action==='upload'?body.name:null});
      return reply(result,200,origin);
    }
    return reply({error:'Ação inválida'},400,origin);
  } catch(e) {
    console.error('cerimonial-multi request',{name:e instanceof Error?e.name:'unknown'});
    const message=e instanceof Error?e.message:'Não foi possível concluir esta operação';
    const status=Number((e as {status?:number})?.status)||400;
    return reply({error:message},status,origin);
  }
});