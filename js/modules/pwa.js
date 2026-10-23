/**
 * Cerimonial BAGL — Gerenciador de PWA, Instalação, Status Offline e Atualização Segura
 *
 * Responsabilidades:
 * 1. Registrar o Service Worker (`sw.js`) exclusivamente em contextos suportados (HTTPS ou localhost),
 *    sem falhar caso o arquivo seja aberto temporariamente via `file://`.
 * 2. Monitorar a conectividade (`online` / `offline`) e atualizar o indicador discreto na barra superior.
 * 3. Capturar o evento `beforeinstallprompt` para oferecer o botão "Instalar App" na barra superior.
 * 4. Detectar novas versões do Service Worker (`waiting`) e exibir um aviso claro ao operador,
 *    NUNCA recarregando a página automaticamente durante o registro de presenças, aplicando a atualização
 *    somente após confirmação explícita do operador ("Atualizar Agora").
 */
window.CerimonialPWA = (function () {
  let deferredInstallPrompt = null;
  let waitingServiceWorker = null;
  let swRegistration = null;
  let userConfirmedRefresh = false;

  /**
   * Verifica se o ambiente atual suporta Service Workers (HTTPS ou localhost/127.0.0.1)
   */
  function isServiceWorkerSupportedEnvironment() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!('serviceWorker' in navigator)) return false;

    const protocol = (window.location && window.location.protocol) || '';
    const hostname = (window.location && window.location.hostname) || '';

    if (protocol === 'https:') return true;
    if (
      protocol === 'http:' &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Atualiza o indicador visual de conectividade (Online / Modo Offline Ativo)
   */
  function updateConnectionStatusUI() {
    const badge = document.getElementById('pwa-connection-badge');
    const dot = document.getElementById('pwa-connection-dot');
    const label = document.getElementById('pwa-connection-label');
    if (!badge || !dot || !label) return;

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

    if (isOnline) {
      badge.className =
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#132F5B] text-emerald-300 border border-[#20457E]';
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      label.textContent = 'Offline Pronto';
      badge.title = 'Conectado — Aplicativo preparado para operar offline sem internet';
    } else {
      badge.className =
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/50';
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      label.textContent = 'Modo Offline';
      badge.title = 'Sem internet — Operando 100% localmente via Cache PWA e IndexedDB';
    }
  }

  /**
   * Exibe o banner/alerta de nova versão disponível sem interromper a operação em andamento
   */
  function notifyUpdateAvailable(worker) {
    waitingServiceWorker = worker;
    const banner = document.getElementById('pwa-update-banner');
    if (banner) {
      banner.classList.remove('hidden');
    }
  }

  /**
   * Aplica a atualização do Service Worker SOMENTE após confirmação explícita do operador
   */
  function confirmAndApplyUpdate() {
    if (!waitingServiceWorker) {
      const banner = document.getElementById('pwa-update-banner');
      if (banner) banner.classList.add('hidden');
      return false;
    }

    userConfirmedRefresh = true;
    waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  /**
   * Oculta o banner de atualização caso o operador decida atualizar apenas depois do evento
   */
  function dismissUpdateBanner() {
    const banner = document.getElementById('pwa-update-banner');
    if (banner) {
      banner.classList.add('hidden');
    }
  }

  /**
   * Registra o Service Worker e configura os listeners de ciclo de vida e atualização controlada
   */
  async function registerServiceWorker() {
    if (!isServiceWorkerSupportedEnvironment()) {
      return {
        registered: false,
        reason: 'unsupported_protocol_or_environment'
      };
    }

    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      swRegistration = reg;

      // Caso já exista um Service Worker em espera (waiting) de um carregamento anterior
      if (reg.waiting) {
        notifyUpdateAvailable(reg.waiting);
      }

      // Monitorar quando um novo Service Worker for baixado
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          // Somente notifica atualização quando já existe um controller ativo (não na primeira instalação)
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            notifyUpdateAvailable(newWorker);
          }
        });
      });

      // Recarregar a página SOMENTE se o próprio operador clicou em "Atualizar Agora"
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (userConfirmedRefresh) {
          userConfirmedRefresh = false;
          window.location.reload();
        }
      });

      return {
        registered: true,
        registration: reg
      };
    } catch (err) {
      console.warn('[PWA Cerimonial BAGL] Falha ao registrar Service Worker:', err);
      return {
        registered: false,
        reason: err.message || 'registration_error'
      };
    }
  }

  /**
   * Aciona o prompt nativo de instalação da PWA quando disponível
   */
  async function promptInstallPWA() {
    if (!deferredInstallPrompt) {
      if (window.showToast) {
        window.showToast(
          'Para instalar: use o ícone de instalação na barra de endereços do navegador ou "Adicionar à Tela de Início".',
          'info'
        );
      }
      return { outcome: 'manual_instructions' };
    }

    try {
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        const btnInstall = document.getElementById('btn-install-pwa');
        if (btnInstall) btnInstall.classList.add('hidden');
        deferredInstallPrompt = null;
        if (window.showToast) {
          window.showToast('Aplicativo Cerimonial BAGL instalado com sucesso!', 'success');
        }
      }
      return choiceResult || { outcome: 'dismissed' };
    } catch (err) {
      console.warn('[PWA Cerimonial BAGL] Erro ao exibir prompt de instalação:', err);
      return { outcome: 'error' };
    }
  }

  /**
   * Inicializa os controles e eventos de PWA na interface
   */
  function initPWA() {
    updateConnectionStatusUI();

    window.addEventListener('online', () => {
      updateConnectionStatusUI();
      if (window.showToast) {
        window.showToast('Conexão restabelecida.', 'success');
      }
    });

    window.addEventListener('offline', () => {
      updateConnectionStatusUI();
      if (window.showToast) {
        window.showToast(
          'Modo Offline ativo: Carômetro, Presenças, PDF e Nominata funcionando localmente.',
          'warning'
        );
      }
    });

    const btnInstall = document.getElementById('btn-install-pwa');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (btnInstall) {
        btnInstall.classList.remove('hidden');
      }
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      if (btnInstall) {
        btnInstall.classList.add('hidden');
      }
    });

    if (btnInstall) {
      btnInstall.addEventListener('click', promptInstallPWA);
    }

    const btnApplyUpdate = document.getElementById('btn-pwa-apply-update');
    const btnDismissUpdate = document.getElementById('btn-pwa-dismiss-update');

    if (btnApplyUpdate) {
      btnApplyUpdate.addEventListener('click', confirmAndApplyUpdate);
    }
    if (btnDismissUpdate) {
      btnDismissUpdate.addEventListener('click', dismissUpdateBanner);
    }

    registerServiceWorker();
  }

  return {
    initPWA,
    registerServiceWorker,
    isServiceWorkerSupportedEnvironment,
    updateConnectionStatusUI,
    notifyUpdateAvailable,
    confirmAndApplyUpdate,
    dismissUpdateBanner,
    promptInstallPWA,
    getState: () => ({
      hasInstallPrompt: !!deferredInstallPrompt,
      hasWaitingUpdate: !!waitingServiceWorker,
      isRegistered: !!swRegistration
    })
  };
})();
