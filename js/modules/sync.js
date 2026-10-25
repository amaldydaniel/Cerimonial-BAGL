(function () {
  const URL = 'https://zjeljjgfbqalaxqamjhb.supabase.co/functions/v1/cerimonial-multi';
  // O servidor identifica a unidade pela sessão; nenhum ID fixo de carômetro no navegador.

  let session = sessionStorage.getItem('cerimonial_multi_session') || '';
  let refreshToken = sessionStorage.getItem('cerimonial_multi_refresh') || '';
  let account = null;
  let connected = false;
  let admin = false;
  let version = -1;
  let structureVersion = -1;
  let initialLoadDone = false;
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
    version = -1; structureVersion = -1; initialLoadDone = false;
    sessionStorage.removeItem('cerimonial_multi_session');
    sessionStorage.removeItem('cerimonial_multi_refresh');
  }

  // Normaliza e valida o horário de presença estritamente no padrão HH:MM
  function formatCheckedTime(val) {
    if (!val) return null;
    const str = String(val).trim();
    if (!str) return null;
    // 1. Já está no formato HH:MM (ex: "10:14")
    if (/^\d{2}:\d{2}$/.test(str)) {
      return str;
    }
    // 2. Formato HH:MM:SS (ex: "10:14:32") -> extrai HH:MM
    const matchHms = str.match(/^(\d{2}:\d{2}):\d{2}$/);
    if (matchHms) {
      return matchHms[1];
    }
    // 3. Formato ISO ou timestamptz parseável (ex: "2026-10-24T13:14:32Z")
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo'
      });
    }
    // 4. Fallback seguro buscando ocorrência de HH:MM
    const matchAny = str.match(/\b\d{2}:\d{2}\b/);
    return matchAny ? matchAny[0] : null;
  }

  // Aplica dados do carômetro recebidos do servidor
  async function apply(data) {
    initialLoadDone = true;
    if (data && data.structure_version !== undefined && data.structure_version !== null) {
      structureVersion = String(data.structure_version);
    }
    if (!data.items || !data.items.length) {
      app.authorities = [];
      app.manualCounter = 0;
      app.eventName = data.name || 'CERIMONIAL ' + (account ? account.login : '');
      redraw();
      updateStatusBadge('online', '● Conectado (Sem carômetro)');
      setClearVisible(false);
      return;
    }
    // Garante que todo item carregado por read tenha checkedTime no padrão HH:MM
    data.items.forEach((it) => {
      if (it) {
        it.checkedTime = it.present ? formatCheckedTime(it.checkedTime) : null;
      }
    });
    app.authorities = window.CerimonialNominata.getSortedAuthorities(data.items);
    app.eventName = data.name || app.eventName;
    app.manualCounter = app.authorities.filter((a) => a.isManual).length;
    redraw();
    updateStatusBadge('online', '● Sincronizado (' + (account ? account.login : '') + ')');
    setClearVisible(true);
  }

  // Valida e aplica atomicamente as alterações de presença recebidas do servidor
  function applyPresences(items) {
    if (!Array.isArray(items) || !app || !Array.isArray(app.authorities)) return false;
    if (items.length !== app.authorities.length) {
      return false; // contagem divergente requer leitura estrutural completa
    }

    // FASE 1: Validação rigorosa de todos os dados e integridade dos IDs (sem mutação prévia)
    const validatedMap = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || typeof it !== 'object') return false;
      const id = typeof it.id === 'string' ? it.id.trim() : '';
      if (!id) return false;
      if (validatedMap.has(id)) return false; // detecção de IDs duplicados no payload

      if (typeof it.present !== 'boolean') return false; // integridade de tipo booleano obrigatória
      const isPresent = it.present === true;

      let cleanTime = null;
      if (isPresent) {
        cleanTime = formatCheckedTime(it.checkedTime);
      }
      validatedMap.set(id, { present: isPresent, checkedTime: cleanTime });
    }

    // Verifica se todas as autoridades locais possuem correspondência estrita nos dados validados
    for (let i = 0; i < app.authorities.length; i++) {
      const auth = app.authorities[i];
      if (!auth || !validatedMap.has(String(auth.id))) {
        return false; // ID local ausente no delta requer leitura estrutural completa
      }
    }

    // FASE 2: Aplicação atômica garantida (apenas após 100% dos dados serem validados)
    for (let i = 0; i < app.authorities.length; i++) {
      const a = app.authorities[i];
      const validated = validatedMap.get(String(a.id));
      a.present = validated.present;
      a.checkedTime = validated.checkedTime;
    }

    redraw();
    updateStatusBadge('online', app.authorities.length ? '● Sincronizado (' + (account ? account.login : '') + ')' : '● Conectado (Sem carômetro)');
    setClearVisible(app.authorities.length > 0);
    return true;
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
  let pendingStructuralForce = false;

  async function doRefresh(force, forceStructural = false) {
    busy = true;
    try {
      const isForced = force || pendingForce;
      const isStructural = forceStructural || pendingStructuralForce;
      pendingForce = false;
      pendingStructuralForce = false;

      const v = await request('version');
      isOffline = false;

      const serverVersion = (v && v.version !== undefined && v.version !== null) ? String(v.version) : '-1';
      const serverStructure = (v && v.structure_version !== undefined && v.structure_version !== null) ? String(v.structure_version) : null;

      // Cenário 1: Leitura completa obrigatória (com fotos)
      // - Forçado explicitamente estrutural (novo upload ou exclusão local)
      // - Carga inicial ainda não realizada (!initialLoadDone)
      // - Versão estrutural local ainda não inicializada
      // - Versão estrutural do servidor divergiu (novo PDF publicado)
      // - Servidor legado que não envia structure_version (fallback retrocompatível)
      const needsFullRead = isStructural ||
        !initialLoadDone ||
        structureVersion === -1 ||
        structureVersion === '-1' ||
        (serverStructure !== null && serverStructure !== String(structureVersion)) ||
        (serverStructure === null && (isForced || serverVersion !== String(version)));

      if (needsFullRead) {
        const data = await request('read');
        version = String(data.version);
        structureVersion = (data.structure_version !== undefined && data.structure_version !== null) ? String(data.structure_version) : '1';
        admin = !!data.admin;
        await apply(data);
      } else if (serverVersion !== String(version)) {
        // Se não há carômetro carregado, alinha a versão sem tentar delta de presenças
        if (!app.authorities || app.authorities.length === 0) {
          version = serverVersion;
          if (serverStructure !== null) structureVersion = serverStructure;
        } else {
          // Cenário 2: Atualização parcial de presenças (estrutura idêntica)
          try {
            const delta = await request('presences');
            const deltaVersion = String(delta.version);
            const deltaStructure = (delta.structure_version !== undefined && delta.structure_version !== null) ? String(delta.structure_version) : String(structureVersion);

            if (deltaStructure !== String(structureVersion) || !applyPresences(delta.items)) {
              const data = await request('read');
              version = String(data.version);
              structureVersion = (data.structure_version !== undefined && data.structure_version !== null) ? String(data.structure_version) : '1';
              admin = !!data.admin;
              await apply(data);
            } else {
              version = deltaVersion;
              structureVersion = deltaStructure;
            }
          } catch (deltaErr) {
            console.warn('[CerimonialSync] Falha na sincronização parcial, recorrendo à leitura completa:', deltaErr);
            const data = await request('read');
            version = String(data.version);
            structureVersion = (data.structure_version !== undefined && data.structure_version !== null) ? String(data.structure_version) : '1';
            admin = !!data.admin;
            await apply(data);
          }
        }
      } else {
        updateStatusBadge('online', app.authorities.length ? '● Sincronizado (' + (account ? account.login : '') + ')' : '● Conectado (Sem carômetro)');
        setClearVisible(app.authorities.length > 0);
      }
    } catch (e) {
      if (e.status === 401) {
        connected = false; session = ''; admin = false; version = -1; structureVersion = -1;
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
      if (pendingForce || pendingStructuralForce) {
        await doRefresh(pendingForce, pendingStructuralForce);
      }
    }
  }

  async function refresh(force = false, forceStructural = false) {
    if (!connected) return;
    if (busy) {
      if (force) pendingForce = true;
      if (forceStructural) pendingStructuralForce = true;
      return;
    }
    return doRefresh(force, forceStructural);
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
      version = String(data.version);
      structureVersion = (data.structure_version !== undefined && data.structure_version !== null) ? String(data.structure_version) : '1';
      initialLoadDone = true;

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
      structureVersion = -1;
      initialLoadDone = false;
      stopPolling();
      if (app) { app.authorities = []; app.eventName = 'EVENTO CERIMONIAL'; redraw(); }
      updateUserHeaderBadge(false);
      showLoginModal(true);
      updateStatusBadge('disconnected', '○ Desconectado');
      window.CerimonialAccounts?.hideMaster();
      toast('Sessão encerrada.');
    }
  }

  const pendingPresenceRequests = new Set();

  // Marca presença somente quando o servidor confirma a gravação.
  async function presence(item) {
    if (!connected || isOffline) { toast('Sem conexão. Aguarde para registrar a presença.', 'warning'); return false; }
    const itemId = String(item.id);
    if (pendingPresenceRequests.has(itemId)) return false;
    pendingPresenceRequests.add(itemId);
    try {
      await request('toggle', { id: item.id, present: !item.present });
      await refresh(true, false);
      return true;
    } catch (e) {
      updateStatusBadge('offline', '⚠ Falha ao salvar no servidor');
      toast('Presença não registrada. Tente novamente.', 'error');
      return false;
    } finally {
      pendingPresenceRequests.delete(itemId);
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
    structureVersion = -1;
    initialLoadDone = false;
    await refresh(true, true);
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
      structureVersion = -1;
      initialLoadDone = false;
      await refresh(true, true);
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
        if (masterButton) masterButton.style.display = account?.role === 'master' ? 'inline-flex' : 'none';
        const el = document.getElementById('sync-logged-user');
        if (el && account) el.textContent = account.login;
      }
      else {
        badge.classList.add('hidden');
        const masterButton = document.getElementById('cerimonial-master-open');
        if (masterButton) masterButton.style.display = 'none';
      }
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
        refresh(true, false);
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

    // Botão discreto para reabrir o Painel Master
    const btnMasterOpen = document.getElementById('cerimonial-master-open');
    if (btnMasterOpen) {
      btnMasterOpen.onclick = () => {
        if (account?.role === 'master') {
          window.CerimonialAccounts?.showMaster();
        }
      };
    }

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