/* Cerimonial — conta, recuperação e dashboard exclusivo do Master.
 * O Master nunca recebe operações de carômetro no backend. Esta tela é isolada.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = (...args) => window.CerimonialSync.request(...args);
  const toast = (message, type='info') => window.showToast ? window.showToast(message,type) : alert(message);
  let dashboard = null;
  let dialog = null;
  let recoveryToken = '';
  let accountList = [];
  let filter = '';
  let fieldCounter = 0;

  function el(tag, text, className='') {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function button(label, action, style='primary') {
    const classes = {
      primary:'bg-blue-700 hover:bg-blue-800 text-white',
      secondary:'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
      danger:'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
      dark:'border border-white/20 bg-white/10 hover:bg-white/20 text-white'
    };
    const b = el('button', label, 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition disabled:opacity-50 disabled:cursor-wait '+(classes[style]||classes.primary));
    b.type='button';
    b.addEventListener('click', async () => {
      if(b.disabled)return;
      b.disabled=true;
      try { await action(); } catch(e) { toast(e.message || 'Falha na solicitação','error'); }
      finally {b.disabled=false;}
    });
    return b;
  }
  // Campos de senha usam botão independente para mostrar/ocultar sem alterar o valor.
  function passwordIcon(visible) {
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','20');
    svg.setAttribute('height','20');
    svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2');
    svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');
    svg.setAttribute('aria-hidden','true');
    function path(d) {
      const p=document.createElementNS(ns,'path');p.setAttribute('d',d);svg.appendChild(p);
    }
    if (visible) {
      // Olho riscado: o valor está visível; clicar oculta novamente.
      path('M3 3l18 18');
      path('M10.58 10.58a2 2 0 0 0 2.84 2.84');
      path('M9.88 5.09A10.9 10.9 0 0 1 12 4.9c7 0 10 7.1 10 7.1a13.2 13.2 0 0 1-2.18 3.24');
      path('M6.61 6.61A13.2 13.2 0 0 0 2 12s3 7.1 10 7.1a10.8 10.8 0 0 0 5.39-1.49');
    } else {
      // Olho aberto: o valor está oculto; clicar mostra o que foi digitado.
      path('M2 12s3.64-7 10-7 10 7 10 7-3.64 7-10 7S2 12 2 12Z');
      const pupil=document.createElementNS(ns,'circle');
      pupil.setAttribute('cx','12');pupil.setAttribute('cy','12');pupil.setAttribute('r','3');
      svg.appendChild(pupil);
    }
    return svg;
  }
  function field(label, type='text', value='', extra={}) {
    const wrap=el('div',null,'block text-sm text-slate-700');
    const caption=el('label',label,'block mb-1.5 font-semibold');
    const input=el('input');
    input.id='cerimonial-input-'+(++fieldCounter);
    caption.htmlFor=input.id;
    input.type=type;
    input.value=value;
    input.className='block w-full px-3.5 py-3 rounded-xl border border-slate-300 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white text-slate-900';
    input.autocomplete=type==='password'?'new-password':'off';
    if(extra.placeholder)input.placeholder=extra.placeholder;
    if(extra.required)input.required=true;
    if(extra.maxLength)input.maxLength=extra.maxLength;
    wrap.appendChild(caption);
    if(type==='password') {
      const area=el('div',null,'relative');
      input.classList.add('pr-12');
      const reveal=el('button',null,'absolute inset-y-0 right-1 w-11 flex items-center justify-center rounded-r-xl text-slate-500 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-300');
      reveal.type='button'; // Nunca submeter o formulário ao clicar no olhinho.
      function setVisible(visible) {
        input.type=visible?'text':'password';
        const title=visible?'Ocultar senha':'Mostrar senha';
        reveal.setAttribute('aria-label',title);
        reveal.setAttribute('aria-pressed',String(visible));
        reveal.title=title;
        reveal.replaceChildren(passwordIcon(visible));
      }
      setVisible(false);
      reveal.addEventListener('click',()=>setVisible(input.type==='password'));
      area.append(input,reveal);
      wrap.appendChild(area);
    } else {
      wrap.appendChild(input);
    }
    return {wrap,input};
  }
  function panel(title) {
    const shade=el('div',null,'fixed inset-0 flex items-center justify-center p-4 bg-slate-950/75');
    shade.style.zIndex=100010;
    shade.style.overflowY='auto';
    const body=el('section',null,'w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl bg-white text-slate-900 p-5 sm:p-7');
    body.setAttribute('role','dialog');
    body.setAttribute('aria-modal','true');
    body.setAttribute('aria-label',title);
    const head=el('div',null,'flex items-center justify-between gap-4 mb-5');
    head.append(el('h2',title,'text-xl font-bold'),button('Fechar',()=>shade.remove(),'secondary'));
    body.appendChild(head);shade.appendChild(body);document.body.appendChild(shade);
    const esc=e=>{if(e.key==='Escape'){shade.remove();document.removeEventListener('keydown',esc);}};
    document.addEventListener('keydown',esc);
    shade.addEventListener('click',e=>{if(e.target===shade){shade.remove();document.removeEventListener('keydown',esc);}});
    return {shade,body};
  }

function forgottenLogin() {
  const {shade,body}=panel('Recuperação de senha');
  dialog=shade;
  const username=field('Login da unidade','text',($('input-shared-login-user')?.value||'').toUpperCase());
  const info=el('p','Informe o login da unidade e confirme o envio para o e-mail cadastrado.','mb-4 text-sm text-slate-600');
  const dest=el('div',null,'hidden my-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm');
  const label=el('span','O link será enviado para:');
  const full=el('strong','', 'block break-all mt-1');
  const feedback=el('p','', 'mt-2 text-slate-600');
  dest.append(label,full,feedback);
  let selected='';
  let lookupPromise=null;
  let lookupLogin='';
  // Consultar o endereço automaticamente, sem exigir um botão extra.
  function lookUp(login) {
    if(lookupPromise && lookupLogin===login)return lookupPromise;
    lookupLogin=login;
    const job=(async()=>{
      const data=await api('recovery_lookup',{username:login});
      if(username.input.value.trim().toUpperCase()!==login)return '';
      if(!data?.found){selected='';dest.classList.add('hidden');return '';}
      selected=login;
      label.textContent='O link será enviado para:';
      full.textContent=data.email;
      feedback.textContent='';
      dest.classList.remove('hidden');
      return data.email;
    })();
    lookupPromise=job;
    job.finally(()=>{if(lookupPromise===job)lookupPromise=null;}).catch(()=>{});
    return job;
  }
  const submit=button('Confirmar e enviar',async()=>{
    const login=username.input.value.trim().toUpperCase();
    if(!/^[A-Z0-9_-]{2,20}$/.test(login))throw new Error('Informe um login válido.');
    const email=(selected===login&&full.textContent)?full.textContent:await lookUp(login);
    if(!email)throw new Error('Unidade não localizada ou consulta indisponível.');
    const resp=await api('recovery_send',{username:login});
    if(!resp.sent)throw new Error('Não foi possível confirmar o envio.');
    label.textContent='Link enviado para:';
    full.textContent=email;
    feedback.textContent='Verifique a caixa de entrada e a pasta de spam.';
    dest.classList.remove('hidden');
    submit.classList.add('hidden');
  });
  username.input.addEventListener('input',()=>{
    selected='';
    dest.classList.add('hidden');
    submit.classList.remove('hidden');
  });
  username.input.addEventListener('change',()=>{
    const login=username.input.value.trim().toUpperCase();
    if(/^[A-Z0-9_-]{2,20}$/.test(login))lookUp(login).catch(()=>{});
  });
  body.append(info,username.wrap,dest,submit);
  // Login já preenchido: mostre o endereço automaticamente, sem novo clique.
  const initial=username.input.value.trim().toUpperCase();
  if(/^[A-Z0-9_-]{2,20}$/.test(initial))lookUp(initial).catch(()=>{});
}
  function changePassword() {
    const {shade,body}=panel('Alterar minha senha');
    const old=field('Senha atual','password');
    const pw=field('Nova senha','password');
    const again=field('Confirmar nova senha','password');
    const form=el('div',null,'space-y-4');
    form.append(old.wrap,pw.wrap,again.wrap);
    form.appendChild(button('Salvar nova senha',async()=>{
      if(!pw.input.value||pw.input.value!==again.input.value)throw new Error('A confirmação não coincide.');
      await api('change_password',{currentPassword:old.input.value,newPassword:pw.input.value});
      shade.remove();toast('Senha alterada com sucesso.','success');
    }));
    body.appendChild(form);
  }
  function newPasswordFromRecovery(token) {
    recoveryToken=token;
    window.CerimonialSync.closeLogin();
    const {shade,body}=panel('Criar nova senha');
    const pw=field('Nova senha','password');const again=field('Confirmar nova senha','password');
    body.appendChild(el('p','Você chegou pelo link de recuperação enviado ao e-mail cadastrado.','text-sm text-slate-600 mb-4'));
    const form=el('div',null,'space-y-4');form.append(pw.wrap,again.wrap);
    form.appendChild(button('Atualizar senha',async()=>{
      if(!pw.input.value||pw.input.value!==again.input.value)throw new Error('As senhas não coincidem.');
      window.CerimonialSync.useRecoveryToken(recoveryToken);
      await api('apply_recovery',{newPassword:pw.input.value});
      window.CerimonialSync.clearRecoveryToken();
      shade.remove();toast('Senha redefinida. Faça login novamente.','success');
      location.replace(location.pathname+location.search);
    }));
    body.appendChild(form);
  }
  function refreshStatistics() {
    const total=accountList.filter(x=>x.role!=='pending').length;
    const active=accountList.filter(x=>x.role!=='pending'&&x.active).length;
    if($('master-total'))$('master-total').textContent=total.toLocaleString('pt-BR');
    if($('master-active'))$('master-active').textContent=active.toLocaleString('pt-BR');
    if($('master-inactive'))$('master-inactive').textContent=(total-active).toLocaleString('pt-BR');
  }
  function match(unit) {
    return [unit.login,unit.name,unit.email].some(x=>String(x||'').toLocaleLowerCase('pt-BR').includes(filter));
  }
  function listRow(unit) {
    const row=el('article',null,'p-4 flex flex-wrap items-center gap-4 justify-between border-b border-slate-100 last:border-b-0 hover:bg-slate-50');
    const left=el('div',null,'min-w-0 flex-1 flex flex-wrap gap-3 items-center');
    const initial=el('div',unit.login.slice(0,2),'h-11 w-11 shrink-0 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center font-bold');
    const detail=el('div',null,'min-w-0');
    const top=el('div',null,'flex flex-wrap gap-2 items-center');
    top.append(el('strong',unit.login,'text-slate-950'),el('span',unit.role==='pending'?'Exclusão pendente':(unit.active?'Ativa':'Inativa'),'px-2 py-0.5 rounded-full text-xs font-semibold '+(unit.active?'text-emerald-700 bg-emerald-50':'text-red-700 bg-red-50')));
    detail.append(top,el('div',unit.name,'text-sm font-semibold text-slate-600 break-words'),el('div',unit.email,'text-xs text-slate-500 break-all'));
    left.append(initial,detail);row.append(left);
    const gear=button('⚙ Gerenciar',()=>manageUnit(unit),'secondary');
    gear.title='Editar cadastro e recuperação de '+unit.login;
    row.appendChild(gear);
    return row;
  }
  function drawRows() {
    const container=$('master-units'); if(!container)return;
    container.replaceChildren();
    const matches=accountList.filter(match);
    const count=$('master-filter-count'); if(count)count.textContent=matches.length.toLocaleString('pt-BR')+' unidade(s)';
    if(!matches.length){container.append(el('div', accountList.length?'Nenhuma unidade encontrada para esta busca.':'Nenhuma unidade cadastrada. Utilize o formulário para criar a primeira.','p-7 text-center text-sm text-slate-500'));return;}
    const fragment=document.createDocumentFragment();
    matches.slice(0,150).forEach(u=>fragment.appendChild(listRow(u)));
    container.appendChild(fragment);
    if(matches.length>150)container.appendChild(el('p','Exibindo 150 de '+matches.length.toLocaleString('pt-BR')+' resultados. Refine a busca para localizar a unidade desejada.','p-4 text-sm text-slate-500 text-center'));
  }
  async function renderMaster() {
    const container=$('master-units');if(container)container.replaceChildren(el('p','Carregando unidades...','p-6 text-sm text-slate-500'));
    const res=await api('admin_list');
    accountList=[...(Array.isArray(res.units)?res.units:[]),...(Array.isArray(res.pending)?res.pending:[])];
    refreshStatistics();drawRows();
  }
  function manageUnit(unit) {
    const {shade,body}=panel('Gerenciar unidade — '+unit.login);
    if(unit.role==='pending'){
      body.appendChild(el('p','A exclusão desta unidade está pendente de finalização.','mb-4 text-sm text-slate-600'));
      const finalize=button('Concluir exclusão',async()=>{
        const result=await api('admin_delete',{login:unit.login,confirmLogin:unit.login});
        if(result?.deleted!==true)throw new Error('A exclusão ainda não foi confirmada.');
        shade.remove();await renderMaster();toast('Cadastro excluído.','success');
      },'danger');
      body.appendChild(finalize);
      return;
    }
    const name=field('Nome da unidade','text',unit.name,{maxLength:120});
    const email=field('E-mail institucional de recuperação','email',unit.email);
    const information=el('div',null,'space-y-3 rounded-xl border border-slate-200 p-4 mb-4');
    information.append(name.wrap,button('Salvar nome da unidade',async()=>{
      if(name.input.value.trim()===unit.name)return;
      await api('admin_update_name',{login:unit.login,name:name.input.value.trim()});
      await renderMaster();toast('Nome atualizado.','success');
    }));
    information.append(email.wrap,el('p','Cada conta precisa de um e-mail exclusivo. Somente o Master pode alterá-lo.','text-xs text-slate-500'));
    information.appendChild(button('Salvar e-mail',async()=>{
      if(email.input.value.trim().toLowerCase()===unit.email.toLowerCase())return;
      if(!window.confirm('Atualizar o e-mail cadastrado da unidade '+unit.login+'?'))return;
      await api('admin_set_email',{login:unit.login,email:email.input.value.trim()});
      await renderMaster();toast('E-mail atualizado.','success');
    }));
    body.appendChild(information);

    // Operações essenciais; Master não faz gestão de bloqueios regulares.
    const secure=el('div',null,'space-y-3 rounded-xl border border-slate-200 p-4');
    secure.appendChild(el('h3','Acesso e recuperação','font-semibold'));
    secure.appendChild(button('Redefinir senha (123456)',async()=>{
      await api('admin_reset_password',{login:unit.login,password:'123456'});
      toast('Senha de '+unit.login+' redefinida para 123456. Compartilhe o acesso por canal autorizado.','success');
    }));
    secure.appendChild(button('Liberar recuperação',async()=>{
      await api('admin_unlock',{login:unit.login});
      toast('Recuperação liberada para '+unit.login+'.','success');
    },'secondary'));
    body.appendChild(secure);

    const deleteButton=button('Excluir cadastro',async()=>{
      if(!window.confirm('Tem certeza de que deseja excluir a unidade '+unit.login+'?'))return;
      try {
        const result=await api('admin_delete',{login:unit.login,confirmLogin:unit.login});
        if(result?.deleted!==true)throw new Error('O servidor ainda não confirmou a exclusão.');
        shade.remove();
        try { await renderMaster(); }
        catch (_) { toast('Exclusão concluída. Atualize a página para conferir a lista.','warning'); return; }
        toast('Unidade '+unit.login+' excluída.','success');
      } catch(e) {
        // Em falha parcial, reconsultar e mostrar "exclusão pendente" para retomar.
        try { await renderMaster(); } catch (_) { /* mensagem original tem prioridade */ }
        shade.remove();
        throw e;
      }
    },'danger');
    deleteButton.classList.add('mt-4');
    body.appendChild(deleteButton);
  }
  function newMetric(title,id) {
    const card=el('section',null,'rounded-2xl bg-white border border-slate-200 p-5 shadow-sm');
    card.append(el('p',title,'text-sm font-medium text-slate-500'),el('strong','0','text-3xl font-bold text-slate-900 block mt-1'));
    card.lastChild.id=id;
    return card;
  }
  function showMaster() {
    if(dashboard){return renderMaster().catch(e=>toast(e.message,'error'));}
    dashboard=el('div');dashboard.id='cerimonial-master-dashboard';
    dashboard.style.cssText='position:fixed;inset:0;z-index:99998;overflow-y:auto;background:#f1f5f9;color:#0f172a;';
    dashboard.setAttribute('aria-label','Administração geral das unidades do Cerimonial');
    const top=el('header',null,'bg-[#0B1D3A] text-white shadow-lg');
    const nav=el('div',null,'max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap justify-between items-center gap-4');
    const title=el('div');
    title.append(el('p','CERIMONIAL • ADMINISTRAÇÃO','uppercase tracking-widest text-xs text-blue-300 font-semibold'),el('h1','Painel Master','text-2xl sm:text-3xl font-bold mt-1'),el('p','Gerenciamento exclusivo de unidades e acessos','text-sm text-slate-300 mt-1'));
    const actions=el('div',null,'flex gap-2 flex-wrap');
    actions.append(button('Alterar minha senha',changePassword,'dark'),button('Fechar painel',()=>hideMaster(),'dark'),button('Sair',()=>window.CerimonialSync.logout(),'dark'));
    nav.append(title,actions);top.appendChild(nav);dashboard.appendChild(top);
    const main=el('main',null,'max-w-7xl mx-auto px-4 sm:px-6 py-8');
    const stats=el('div',null,'grid grid-cols-1 sm:grid-cols-3 gap-4 mb-7');
    stats.append(newMetric('Unidades cadastradas','master-total'),newMetric('Ativas','master-active'),newMetric('Inativas','master-inactive'));
    main.appendChild(stats);
    const grid=el('div',null,'grid grid-cols-1 lg:grid-cols-3 gap-6 items-start');
    const registration=el('section',null,'bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6');
    registration.append(el('h2','Cadastrar unidade','font-bold text-lg'),el('p','O carômetro será exclusivo desta conta.','text-sm text-slate-600 mt-1 mb-5'));
    const form=el('form',null,'space-y-4');
    const login=field('Login da unidade','text','',{placeholder:'Ex.: BABR',required:true,maxLength:20});
    const name=field('Nome da unidade','text','',{placeholder:'Ex.: Base Aérea de Brasília',required:true,maxLength:120});
    const email=field('E-mail de recuperação','email','',{placeholder:'E-mail exclusivo desta conta',required:true});
    const password=field('Senha inicial','password','',{required:true});
    form.append(login.wrap,name.wrap,email.wrap,password.wrap);
    form.appendChild(el('p','A senha inicial precisa ter pelo menos 6 caracteres. Use o ícone de olho para conferir o que digitou.','text-xs text-slate-500'));
    form.appendChild(el('p','Use um e-mail ainda não cadastrado no Supabase, diferente do e-mail do Master. A troca de senha no primeiro acesso não é obrigatória.','text-xs text-slate-500'));
    const submit=button('＋ Cadastrar unidade',async()=>{
      const body={login:login.input.value.toUpperCase().trim(),name:name.input.value.trim(),email:email.input.value.trim().toLowerCase(),password:password.input.value};
      if(!/^[A-Z0-9_-]{2,20}$/.test(body.login))throw new Error('O login deve ter de 2 a 20 letras, números, _ ou -.');
      if(body.name.length<2)throw new Error('Informe o nome completo da unidade.');
      if(!email.input.validity.valid)throw new Error('Informe um e-mail válido.');
      if(body.password.length<6)throw new Error('Use pelo menos 6 caracteres na senha inicial, sujeito à política do Supabase.');
      await api('admin_create',body);
      form.reset();
      await renderMaster();toast('Unidade '+body.login+' cadastrada com sucesso.','success');
    });
    form.addEventListener('submit',e=>{e.preventDefault();submit.click();});
    form.appendChild(submit);registration.appendChild(form);
    const section=el('section',null,'lg:col-span-2 rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden');
    const sectionHead=el('div',null,'p-5 sm:p-6 border-b border-slate-100');
    const titleRow=el('div',null,'flex flex-wrap items-center justify-between gap-2');
    const header=el('h2','Unidades cadastradas','text-lg font-bold');
    const count=el('span','0 unidade(s)','text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full');count.id='master-filter-count';
    titleRow.append(header,count);
    const search=el('input');search.type='search';search.id='master-search';search.placeholder='⌕ Buscar login, nome ou e-mail...';
    search.setAttribute('aria-label','Pesquisar unidades');
    search.className='mt-4 w-full border border-slate-300 rounded-xl px-4 py-3 bg-white text-slate-900 focus:ring-2 focus:ring-blue-100 focus:border-blue-600 focus:outline-none';
    search.addEventListener('input',()=>{filter=search.value.trim().toLocaleLowerCase('pt-BR');drawRows();});
    sectionHead.append(titleRow,search);section.appendChild(sectionHead);
    const rows=el('div');rows.id='master-units';section.appendChild(rows);
    grid.append(registration,section);main.appendChild(grid);dashboard.appendChild(main);
    document.body.appendChild(dashboard);
    const status=$('sync-status-bar');if(status)status.style.display='none';
    renderMaster().catch(e=>toast(e.message,'error'));
  }
  function hideMaster() {
    if(dashboard)dashboard.remove();dashboard=null;accountList=[];filter='';
    const status=$('sync-status-bar');if(status)status.style.display='';
  }
  function init() {
    const loginSubmit=$('btn-shared-login-submit');
    if(loginSubmit&&!$('cerimonial-forgot-button')){
      const forgot=button('Esqueceu sua senha?',forgottenLogin,'secondary');
      forgot.id='cerimonial-forgot-button';
      forgot.className='text-xs text-blue-300 underline mt-2 block mx-auto hover:text-white';
      loginSubmit.after(forgot);
    }
    const badge=$('sync-user-badge-container');
    if(badge&&!$('cerimonial-user-change-password')){
      const config=button('Alterar senha',changePassword,'secondary');
      config.id='cerimonial-user-change-password';
      config.className='text-xs text-slate-200 hover:text-white px-2 py-1 border border-slate-500 rounded';
      badge.prepend(config);
    }
    const params=new URLSearchParams(location.hash.replace(/^#/,''));
    if(params.get('error') || params.get('error_code')){
      history.replaceState(null,'',location.pathname+location.search);
      const message=params.get('error_code')==='otp_expired'
        ?'O link de recuperação é inválido, expirou ou já foi utilizado. Solicite outro link.'
        :'Não foi possível abrir o link de recuperação. Solicite outro link.';
      setTimeout(()=>toast(message,'error'),0);
    }
    if(params.get('type')==='recovery'&&params.get('access_token')){
      const token=params.get('access_token');
      history.replaceState(null,'',location.pathname+location.search);
      setTimeout(()=>newPasswordFromRecovery(token),0);
    }
  }
  window.CerimonialAccounts={init,showMaster,hideMaster,changePassword};
})();
