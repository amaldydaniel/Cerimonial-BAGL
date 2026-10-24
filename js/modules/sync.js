(function () {
  const URL = 'https://zjeljjgfbqalaxqamjhb.supabase.co/functions/v1/cerimonial-multi';
  // O servidor identifica a unidade pela sessão; nenhum ID fixo de carômetro no navegador.

  let session = sessionStorage.getItem('cerimonial_multi_session') || '';
  let refreshToken = sessionStorage.getItem('cerimonial_multi_refresh') || '';
  let account = null;
  let connected = false;
  let admin = false;
  let version = -1;
  let busy = false;
  let isOffline = false;
  let app = null;
  let redraw = null;
  let statusEl = null;
  let pollInterval = null;

  const toast = (msg, kind) => window.showToast ? window.showToast(msg, kind || 'info') : alert(msg);

  // Requisição base para a API (Edge Function ou proxy local)
  async function request(action, extra = {}, didRetry = false) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const body = {
        action,
        session,
        ...extra
      };

      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
        cache: 'no-store'
      });

      const data = await res.json().catch(() => ({}));
      if (!didRetry && res.status === 401 && session && refreshToken && action !== 'refresh' && action !== 'login' && action !== 'apply_recovery') {
        try {
          const refreshed = await request('refresh', { refresh: refreshToken });
          setAuth(refreshed);
          return await request(action, extra, true);
        } catch (_) { /* sessão efetivamente expirada */ }
      }
      if (!res.ok) {
        const err = new Error(data.error || `Erro de sincronização (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function setAuth(data) {
    session = data.token || '';
    refreshToken = data.refresh || '';
    if (data.account) account = data.account;
    sessionStorage.setItem('cerimonial_multi_session', session);
    sessionStorage.setItem('cerimonial_multi_refresh', refreshToken);
  }
  function clearAuth() {
    session = ''; refreshToken = ''; account = null; connected = false;
    sessionStorage.removeItem('cerimonial_multi_session');
    sessionStorage.removeItem('cerimonial_multi_refresh');
  }

  // Aplica dados do carômetro recebidos do servidor
  async function apply(data) {
    if (!data.items || !data.items.length) {
      app.authorities = [];
      app.manualCounter = 0;
      app.eventName = data.name || 'CERIMONIAL ' + (account ? account.login : '');
      redraw();
      updateStatusBadge('online', '● Conectado (Sem carômetro)');
      setClearVisible(false);
      return;
    }
    app.authorities = window.CerimonialNominata.getSortedAuthorities(data.items);
    app.eventName = data.name || app.eventName;
    app.manualCounter = app.authorities.filter((a) => a.isManual).length;
    redraw();
    updateStatusBadge('online', '● Sincronizado (' + (account ? account.login : '') + ')');
    setClearVisible(true);
  }

  // Atualiza visual do status de sincronização
  function updateStatusBadge(state, text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (state === 'online') {
      statusEl.className = 'text-xs font-semibold text-emerald-400 flex items-center gap-1.5';
    } else if (state === 'busy') {
      statusEl.className = 'text-xs font-semibold text-sky-400 flex items-center gap-1.5';
    } else if (state === 'offline') {
      statusEl.className = 'text-xs font-semibold text-amber-400 flex items-center gap-1.5';
    } else {
      statusEl.className = 'text-xs font-semibold text-slate-300 flex items-center gap-1.5';
    }
  }

  // Fila para chamadas de sincronização forçadas
  let pendingForce = false;
  async function doRefresh(force) {
    busy = true;
    try {
      const isForced = force || pendingForce;
      pendingForce = false;
      const v = await request('version');
      isOffline = false;
      if (isForced || v.version !== version) {
        const data = await request('read');
        version = data.version;
        admin = !!data.admin;
        await apply(data);
      } else {
        updateStatusBadge('online', app.authorities.length ? '● Sincronizado (' + (account ? account.login : '') + ')' : '● Conectado (Sem carômetro)');
        setClearVisible(app.authorities.length > 0);
      }
    } catch (e) {
      if (e.status === 401) {
        connected = false; session = ''; admin = false; version = -1;
        clearAuth(); stopPolling();
        showLoginModal(true); updateUserHeaderBadge(false);
        updateStatusBadge('disconnected', '○ Sessão expirada — faça login');
        return;
      }
      isOffline = true;
      updateStatusBadge('offline', '⚠ Sem conexão — operações indisponíveis');
      console.warn('[CerimonialSync] Sem conexão com o servidor:', e.message);
    } finally {
      busy = false;
      if (pendingForce) {
        pendingForce = false;
        await doRefresh(true);
      }
    }
  }

  async function refresh(force = false) {
    if (!connected) return;
    if (busy) {
      if (force) pendingForce = true;
      return;
    }
    return doRefresh(force);
  }

  // Conecta e inicializa o carômetro a partir da sessão
  async function connectWithSession() {
    try {
      updateStatusBadge('busy', '⟳ Validando conta...');
      account = await request('whoami');
      if (account.role === 'master') {
        connected = true; isOffline = false; version = -1;
        app.authorities = []; redraw();
        showLoginModal(false); updateUserHeaderBadge(true);
        updateStatusBadge('online','● Administrador Master');
        stopPolling();
        window.CerimonialAccounts?.showMaster();
        return;
      }
      const data = await request('read');
      connected = true;
      isOffline = false;
      admin = !!data.admin;
      version = data.version;

      // O servidor é a única fonte de dados: nunca publica dados locais automaticamente.
      await apply(data);

      showLoginModal(false);
      updateUserHeaderBadge(true);
      startPolling();
    } catch (e) {
      console.error('[CerimonialSync] Falha na conexão com a sessão:', e);
      connected = false;
      stopPolling();
      clearAuth();
      showLoginModal(true);
      updateUserHeaderBadge(false);
      updateStatusBadge('disconnected', '○ Faça login para continuar');
      throw e;
    }
  }

  // Login compartilhado (BAGL)
  async function login(username, password) {
    const res = await request('login', { username, password });
    if (res.token) {
      setAuth(res);
      await connectWithSession();
      if (!connected) throw new Error('Não foi possível carregar o carômetro do servidor.');
      toast('Acesso autorizado: ' + (account ? account.login : username), 'success');
      return true;
    }
    throw new Error('Falha ao autenticar.');
  }

  // Logout da sessão
  function logout() {
    if (confirm('Deseja realmente sair da sua conta neste dispositivo?')) {
      clearAuth();
      connected = false;
      admin = false;
      version = -1;
      stopPolling();
      if (app) { app.authorities = []; app.eventName = 'EVENTO CERIMONIAL'; redraw(); }
      updateUserHeaderBadge(false);
      showLoginModal(true);
      updateStatusBadge('disconnected', '○ Desconectado');
      window.CerimonialAccounts?.hideMaster();
      toast('Sessão encerrada.');
    }
  }

  // Marca presença somente quando o servidor confirma a gravação.
  async function presence(item) {
    if (!connected || isOffline) { toast('Sem conexão. Aguarde para registrar a presença.', 'warning'); return false; }
    try {
      await request('toggle', { id: item.id, present: !item.present });
      await refresh(true);
      return true;
    } catch (e) {
      updateStatusBadge('offline', '⚠ Falha ao salvar no servidor');
      toast('Presença não registrada. Tente novamente.', 'error');
      return false;
    }
  }

  // O carômetro só entra no painel depois de gravado no Supabase.
  async function publish(items, name) {
    if (!connected || isOffline) throw new Error('Sem conexão com o servidor.');
    if (!Array.isArray(items) || !items.length) throw new Error('Carômetro vazio.');
    // O importador de PDF cria tempId para a revisão, mas o Supabase exige um
    // campo id não vazio e único por autoridade. A numeração definitiva nasce
    // somente na publicação, respeitando a ordem revisada de precedência.
    const normalized = items.map((item, index) => {
      const { tempId, candidatePhoto, candidateImageId, rawLines, ...data } = item;
      return {
        ...data,
        id: `autoridade-${String(index + 1).padStart(4, '0')}`,
        order: index + 1,
        present: false,
        checkedTime: null
      };
    });
    const result = await request('upload', {items: normalized, name});
    version = -1;
    await refresh(true);
    if (!connected || isOffline) throw new Error('Carômetro salvo, mas não foi possível confirmar a atualização.');
    toast(`Carômetro publicado para todos (${result.count} autoridades).`, 'success');
    return result;
  }

  // Compatibilidade com chamadas antigas. Não publica dados locais automaticamente.
  async function autoPublish() { return false; }

  async function clearCarometro() {
    if (!connected || isOffline) return false;
    if (!confirm('Excluir o carômetro compartilhado para TODOS os operadores?')) return false;
    try {
      const result = await request('clear');
      version = -1;
      await refresh(true);
      toast('Carômetro excluído para todos os operadores.', 'success');
      setClearVisible(false);
      return !!result;
    } catch {
      toast('Não foi possível excluir o carômetro.', 'error');
      return false;
    }
  }

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(() => refresh(), 2000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function showLoginModal(show) {
    const modal = document.getElementById('modal-shared-login');
    if (modal) {
      modal.style.display = show ? 'flex' : 'none';
    }
  }

  function updateUserHeaderBadge(show) {
    const badge = document.getElementById('sync-user-badge-container');
    if (badge) {
      if (show) {
        badge.classList.remove('hidden');
        const masterButton = document.getElementById('cerimonial-master-open');
        if (masterButton) masterButton.style.display = account?.role === 'master' ? '' : 'none';
        const el = document.getElementById('sync-logged-user');
        if (el && account) el.textContent = account.login;
      }
      else badge.classList.add('hidden');
      setClearVisible(show && !!(app && app.authorities && app.authorities.length));
    }
  }

  function setClearVisible(show) {
    const el = document.getElementById('btn-clear-shared-carometro');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  // Inicialização do módulo integrado ao aplicativo
  function init(state, render) {
    app = state;
    redraw = render;

    // Constrói a barra discreta e moderna de status no canto inferior esquerdo
    const bar = document.createElement('div');
    bar.id = 'sync-status-bar';
    bar.style.cssText =
      'position:fixed;bottom:12px;left:12px;z-index:40;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:20px;background:#0B1D3A;color:white;font:12px Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,0.3);border:1px solid #1E3D6B;cursor:pointer;user-select:none;';
    bar.title = 'Clique para forçar verificação de sincronização agora';
    bar.onclick = () => {
      if (connected) {
        toast('Verificando atualizações no servidor...');
        refresh(true);
      }
    };

    statusEl = document.createElement('span');
    statusEl.textContent = '○ Conectando...';
    bar.appendChild(statusEl);
    document.body.appendChild(bar);

    // Eventos do formulário de login
    const formLogin = document.getElementById('form-shared-login');
    const inputUser = document.getElementById('input-shared-login-user');
    const inputPass = document.getElementById('input-shared-login-pass');
    const btnSubmit = document.getElementById('btn-shared-login-submit');
    const btnSpinner = document.getElementById('btn-login-spinner');
    const btnLabel = document.getElementById('btn-login-label');
    const errContainer = document.getElementById('login-error-container');
    const errText = document.getElementById('login-error-text');
    const btnTogglePass = document.getElementById('btn-toggle-login-pass');
    const iconPassHidden = document.getElementById('icon-pass-hidden');
    const iconPassVisible = document.getElementById('icon-pass-visible');

    if (btnTogglePass && inputPass) {
      btnTogglePass.onclick = () => {
        const isPass = inputPass.type === 'password';
        inputPass.type = isPass ? 'text' : 'password';
        if (iconPassHidden && iconPassVisible) {
          iconPassHidden.classList.toggle('hidden', isPass);
          iconPassVisible.classList.toggle('hidden', !isPass);
        }
      };
    }

    if (formLogin) {
      formLogin.onsubmit = async (e) => {
        e.preventDefault();
        const user = inputUser ? inputUser.value : 'BAGL';
        const pass = inputPass ? inputPass.value : '';

        if (errContainer) errContainer.classList.add('hidden');
        if (btnSpinner) btnSpinner.classList.remove('hidden');
        if (btnLabel) btnLabel.textContent = 'Autenticando...';
        if (btnSubmit) btnSubmit.disabled = true;

        try {
          await login(user, pass);
        } catch (err) {
          if (errContainer && errText) {
            errText.textContent = err.message || 'Erro ao realizar login.';
            errContainer.classList.remove('hidden');
          }
        } finally {
          if (btnSpinner) btnSpinner.classList.add('hidden');
          if (btnLabel) btnLabel.textContent = 'Acessar Cerimonial';
          if (btnSubmit) btnSubmit.disabled = false;
        }
      };
    }

    // Botão de Logout no header
    const btnLogout = document.getElementById('btn-sync-logout');
    if (btnLogout) {
      btnLogout.onclick = logout;
    }
    const btnClear = document.getElementById('btn-clear-shared-carometro');
    if (btnClear) btnClear.onclick = clearCarometro;

    // Funcionalidades de contas e recuperação vinculadas à mesma sessão.
    window.CerimonialAccounts?.init();

    // Se já houver sessão ativa, inicializa automaticamente
    if (window.location.hash.includes('type=recovery')) {
      showLoginModal(true);
    } else if (session) {
      connectWithSession().catch(() => {});
    } else {
      showLoginModal(true);
      updateStatusBadge('disconnected', '○ Aguardando login');
    }
  }

  window.CerimonialSync = {
    init,
    presence,
    autoPublish,
    publish,
    clearCarometro,
    login,
    logout,
    refresh,
    isConnected: () => connected,
    isOffline: () => isOffline,
    request,
    account: () => account,
    useRecoveryToken(token) { session = token; },
    clearRecoveryToken() { clearAuth(); },
    closeLogin() { showLoginModal(false); }
  };
})();