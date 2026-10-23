/**
 * Cerimonial BAGL - Camada de Persistência (IndexedDB + Migração Segura + Backup JSON + Troca Transacional de Evento)
 */
window.CerimonialDB = (function () {
  const DB_NAME = 'CerimonialBAGL_DB';
  const DB_VERSION = 1;
  const STORE_AUTHORITIES = 'authorities';
  const STORE_METADATA = 'metadata';
  const LEGACY_LS_KEY = 'oma2026_cerimonial_state';
  const DEFAULT_EVENT_NAME = 'EVENTO CERIMONIAL';

  let dbInstance = null;

  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB não suportado neste navegador.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_AUTHORITIES)) {
          const authStore = db.createObjectStore(STORE_AUTHORITIES, { keyPath: 'id' });
          authStore.createIndex('order', 'order', { unique: false });
          authStore.createIndex('present', 'present', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Erro ao abrir banco de dados local (IndexedDB).'));
      };
    });
  }

  function getAllAuthorities(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_AUTHORITIES], 'readonly');
      const store = tx.objectStore(STORE_AUTHORITIES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function getMetadata(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_METADATA], 'readonly');
      const store = tx.objectStore(STORE_METADATA);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
      req.onerror = () => reject(req.error);
    });
  }

  function saveAllToIndexedDB(authorities, manualCounter, eventName, sourcePdfName) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_AUTHORITIES, STORE_METADATA], 'readwrite');
        const authStore = tx.objectStore(STORE_AUTHORITIES);
        const metaStore = tx.objectStore(STORE_METADATA);

        // Clear and repopulate within the same atomic transaction
        authStore.clear();
        for (let i = 0; i < authorities.length; i++) {
          authStore.put(authorities[i]);
        }

        metaStore.put({ key: 'manualCounter', value: manualCounter || 0 });
        if (typeof eventName === 'string' && eventName.trim()) {
          metaStore.put({ key: 'eventName', value: eventName.trim() });
        }
        if (typeof sourcePdfName === 'string') {
          metaStore.put({ key: 'sourcePdfName', value: sourcePdfName.trim() });
        }
        metaStore.put({ key: 'lastSavedAt', value: new Date().toISOString() });

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Falha na transação do IndexedDB.'));
        tx.onabort = () => reject(tx.error || new Error('Transação do IndexedDB abortada.'));
      });
    });
  }

  /**
   * Substitui o carômetro de forma atômica e transacional após a revisão do PDF.
   * Garante que todas as autoridades iniciem com zero presenças (present: false, sem checkedTime)
   * e reverte/mantém o estado anterior em caso de qualquer erro.
   */
  async function replaceCarometroTransaction(newAuthorities, eventName, sourcePdfName) {
    if (!Array.isArray(newAuthorities) || newAuthorities.length === 0) {
      throw new Error('Não é possível substituir o carômetro por uma lista vazia de autoridades.');
    }

    const cleanEventName = String(eventName || DEFAULT_EVENT_NAME).trim().toUpperCase();
    const cleanPdfName = String(sourcePdfName || '').trim();

    // Preparar registros limpos garantindo zero presenças iniciais no novo evento
    const preparedAuthorities = newAuthorities.map((item, idx) => {
      const orderNum = Number(item.order) || idx + 1;
      const cleanRecord = {
        id: idx + 1,
        order: orderNum,
        rank_abbr: String(item.rank_abbr || '').trim(),
        full_rank: String(item.full_rank || item.rank_abbr || '').trim().toUpperCase(),
        war_name: String(item.war_name || item.full_name || '').trim().toUpperCase(),
        full_name: String(item.full_name || item.war_name || '').trim().toUpperCase(),
        cargo: String(item.cargo || '').trim(),
        treatment: String(item.treatment || 'SENHOR').trim().toUpperCase(),
        present: false,
        initially_confirmed: false,
        isManual: false,
        photo: item.photo || ''
      };
      return cleanRecord;
    });

    const db = await openDB();
    // Capturar snapshot de segurança em memória antes da transação para rollback garantido caso ocorra falha externa
    const previousAuthorities = await getAllAuthorities(db);
    const previousManualCounter = (await getMetadata(db, 'manualCounter')) || 0;
    const previousEventName = (await getMetadata(db, 'eventName')) || DEFAULT_EVENT_NAME;
    const previousSourcePdf = (await getMetadata(db, 'sourcePdfName')) || '';

    try {
      await saveAllToIndexedDB(preparedAuthorities, 0, cleanEventName, cleanPdfName);
      syncLegacyMirror(preparedAuthorities, 0, cleanEventName, cleanPdfName);
      return {
        authorities: preparedAuthorities,
        manualCounter: 0,
        eventName: cleanEventName,
        sourcePdfName: cleanPdfName
      };
    } catch (err) {
      console.error('Erro durante substituição transacional do carômetro. Restaurando evento anterior:', err);
      try {
        if (previousAuthorities && previousAuthorities.length > 0) {
          await saveAllToIndexedDB(
            previousAuthorities,
            previousManualCounter,
            previousEventName,
            previousSourcePdf
          );
          syncLegacyMirror(
            previousAuthorities,
            previousManualCounter,
            previousEventName,
            previousSourcePdf
          );
        }
      } catch (rollbackErr) {
        console.error('Erro adicional ao executar rollback:', rollbackErr);
      }
      throw new Error('Falha ao gravar o novo carômetro no banco local. O evento anterior foi preservado.');
    }
  }

  function deleteAuthorityFromIndexedDB(authorityId) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_AUTHORITIES, STORE_METADATA], 'readwrite');
        const authStore = tx.objectStore(STORE_AUTHORITIES);
        const metaStore = tx.objectStore(STORE_METADATA);

        authStore.delete(authorityId);
        metaStore.put({ key: 'lastSavedAt', value: new Date().toISOString() });

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Falha ao excluir autoridade do IndexedDB.'));
      });
    });
  }

  function updateAuthorityInIndexedDB(authority, manualCounter) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_AUTHORITIES, STORE_METADATA], 'readwrite');
        const authStore = tx.objectStore(STORE_AUTHORITIES);
        const metaStore = tx.objectStore(STORE_METADATA);

        authStore.put(authority);
        if (typeof manualCounter === 'number') {
          metaStore.put({ key: 'manualCounter', value: manualCounter });
        }
        metaStore.put({ key: 'lastSavedAt', value: new Date().toISOString() });

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Falha ao atualizar autoridade no IndexedDB.'));
      });
    });
  }

  /**
   * Salva também um espelho leve de segurança no localStorage
   */
  function syncLegacyMirror(authorities, manualCounter, eventName, sourcePdfName) {
    try {
      const payload = {
        authorities: authorities,
        manualCounter: manualCounter || 0
      };
      if (typeof eventName === 'string' && eventName.trim()) {
        payload.eventName = eventName.trim();
      }
      if (typeof sourcePdfName === 'string') {
        payload.sourcePdfName = sourcePdfName.trim();
      }
      localStorage.setItem(LEGACY_LS_KEY, JSON.stringify(payload));
    } catch (e) {
      // Se localStorage exceder 5MB por fotos extras, IndexedDB continua sendo a fonte primária
      console.warn('Aviso: Espelho secundário em localStorage excedeu limite, mas IndexedDB está ativo.', e);
    }
  }

  /**
   * Carrega o estado inicial (Versão de Distribuição HTTPS Limpa):
   * 1. Verifica se já há dados salvos no IndexedDB local do dispositivo.
   * 2. Se não houver, verifica eventual estado em localStorage e migra preservando tudo.
   * 3. Se o banco estiver vazio (primeiro acesso após instalação), inicia com base vazia ([])
   *    aguardando a importação de um Carômetro PDF ou restauração de um Backup JSON no dispositivo.
   */
  async function loadState() {
    try {
      const db = await openDB();
      const existingAuth = await getAllAuthorities(db);
      const savedEventName = (await getMetadata(db, 'eventName')) || DEFAULT_EVENT_NAME;
      const savedSourcePdf = (await getMetadata(db, 'sourcePdfName')) || '';
      const manualCounter = (await getMetadata(db, 'manualCounter')) || 0;

      if (existingAuth && existingAuth.length > 0) {
        existingAuth.sort((a, b) => a.order - b.order);
        return {
          authorities: existingAuth,
          manualCounter: manualCounter,
          eventName: savedEventName,
          sourcePdfName: savedSourcePdf,
          source: 'indexeddb'
        };
      }
    } catch (idbErr) {
      console.warn('Erro ao ler IndexedDB inicialmente:', idbErr);
    }

    // 2. Migração transparente do localStorage caso exista no dispositivo
    try {
      const saved = localStorage.getItem(LEGACY_LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.authorities) && parsed.authorities.length > 0) {
          const migratedAuth = parsed.authorities;
          const migratedCounter = parsed.manualCounter || 0;
          const migratedEventName = parsed.eventName || DEFAULT_EVENT_NAME;
          const migratedPdfName = parsed.sourcePdfName || '';
          try {
            await saveAllToIndexedDB(migratedAuth, migratedCounter, migratedEventName, migratedPdfName);
          } catch (migErr) {
            console.warn('Não foi possível migrar para IndexedDB:', migErr);
          }
          return {
            authorities: migratedAuth,
            manualCounter: migratedCounter,
            eventName: migratedEventName,
            sourcePdfName: migratedPdfName,
            source: 'localstorage_migrated'
          };
        }
      }
    } catch (lsErr) {
      console.warn('Erro ao ler localStorage na migração:', lsErr);
    }

    // 3. Base inicial limpa (sem dados pessoais embutidos na distribuição HTTPS)
    return {
      authorities: [],
      manualCounter: 0,
      eventName: DEFAULT_EVENT_NAME,
      sourcePdfName: '',
      source: 'empty_initial'
    };
  }

  /**
   * Salva todo o estado no IndexedDB + espelho
   */
  async function saveState(authorities, manualCounter, eventName, sourcePdfName) {
    let idbSaved = false;
    let idbError = null;

    try {
      await saveAllToIndexedDB(authorities, manualCounter, eventName, sourcePdfName);
      idbSaved = true;
    } catch (err) {
      idbError = err;
      console.error('Erro ao salvar no IndexedDB:', err);
    }

    try {
      syncLegacyMirror(authorities, manualCounter, eventName, sourcePdfName);
    } catch (lsErr) {
      if (!idbSaved) {
        if (window.showToast) {
          window.showToast('ERRO CRÍTICO: Falha ao salvar informações localmente. Faça um Backup JSON!', 'error');
        }
        throw lsErr;
      }
    }

    if (!idbSaved && idbError) {
      if (window.showToast) {
        window.showToast('Aviso: Falha no IndexedDB; dados salvos apenas em armazenamento alternativo.', 'warning');
      }
    }

    return true;
  }

  /**
   * Constrói o objeto de payload do backup JSON
   */
  function buildBackupPayload(authorities, manualCounter, eventName, sourcePdfName) {
    const now = new Date();
    return {
      app: 'Cerimonial BAGL',
      version: '1.3.0',
      organization: 'BAGL',
      eventName: String(eventName || DEFAULT_EVENT_NAME).trim(),
      sourcePdfName: String(sourcePdfName || '').trim(),
      exportedAt: now.toISOString(),
      manualCounter: manualCounter || 0,
      stats: {
        total: authorities.length,
        present: authorities.filter((a) => a.present).length,
        manual: authorities.filter((a) => a.isManual).length
      },
      authorities: authorities
    };
  }

  /**
   * Exporta um arquivo JSON contendo o backup integral do estado atual
   */
  function exportBackupJSON(authorities, manualCounter, eventName, sourcePdfName, options = {}) {
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}h${pad(now.getMinutes())}`;

      const payload = buildBackupPayload(authorities, manualCounter, eventName, sourcePdfName);
      const safeEventSlug = String(payload.eventName || 'OMA_2026')
        .replace(/[^a-zA-Z0-9À-ÿ_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 40);

      const prefix = options.prefix || 'Backup_Cerimonial_BAGL';
      const filename = `${prefix}_${safeEventSlug}_${timestamp}.json`;

      const jsonString = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);

      if (!options.silent && window.showToast) {
        window.showToast(`Backup exportado com sucesso (${authorities.length} registros)!`, 'success');
      }
      return {
        success: true,
        filename: filename,
        exportedAt: payload.exportedAt,
        totalRecords: authorities.length,
        payload: payload
      };
    } catch (err) {
      console.error('Erro ao exportar backup JSON:', err);
      if (!options.silent && window.showToast) {
        window.showToast('Falha ao gerar o arquivo de backup JSON.', 'error');
      }
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Valida e importa um arquivo JSON de backup
   */
  function parseBackupFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('Nenhum arquivo selecionado.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = String(e.target.result || '').replace(/^\uFEFF/, '');
          const parsed = JSON.parse(content);

          // Suporta tanto o formato completo de backup ({ authorities: [...] }) quanto um array direto [...]
          let authorities = null;
          let manualCounter = 0;
          let eventName = DEFAULT_EVENT_NAME;
          let sourcePdfName = '';

          if (Array.isArray(parsed)) {
            authorities = parsed;
            manualCounter = authorities.filter((a) => a.isManual).length;
          } else if (parsed && Array.isArray(parsed.authorities)) {
            authorities = parsed.authorities;
            manualCounter =
              typeof parsed.manualCounter === 'number'
                ? parsed.manualCounter
                : authorities.filter((a) => a.isManual).length;
            if (typeof parsed.eventName === 'string' && parsed.eventName.trim()) {
              eventName = parsed.eventName.trim();
            }
            if (typeof parsed.sourcePdfName === 'string') {
              sourcePdfName = parsed.sourcePdfName.trim();
            }
          }

          if (!authorities || authorities.length === 0) {
            reject(new Error('O arquivo JSON não contém uma lista válida de autoridades.'));
            return;
          }

          // Validar estrutura mínima do primeiro item
          const sample = authorities[0];
          if (typeof sample.id === 'undefined' || (!sample.full_name && !sample.war_name)) {
            reject(new Error('Formato de registro inválido no arquivo de backup.'));
            return;
          }

          resolve({
            authorities: authorities,
            manualCounter: manualCounter,
            eventName: eventName,
            sourcePdfName: sourcePdfName,
            exportedAt: parsed.exportedAt || null
          });
        } catch (parseErr) {
          reject(new Error('O arquivo selecionado não é um JSON válido.'));
        }
      };

      reader.onerror = () => reject(new Error('Erro de leitura do arquivo selecionado.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  return {
    openDB,
    loadState,
    saveState,
    replaceCarometroTransaction,
    updateAuthorityInIndexedDB,
    deleteAuthorityFromIndexedDB,
    buildBackupPayload,
    exportBackupJSON,
    parseBackupFile
  };
})();
