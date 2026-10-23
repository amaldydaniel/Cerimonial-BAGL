/**
 * Cerimonial BAGL - Controlador Principal da Aplicação
 */
(function () {
  const state = {
    authorities: [],
    eventName: 'EVENTO CERIMONIAL',
    sourcePdfName: '',
    currentTab: 'carometro', // 'carometro' | 'nominata'
    nominataMode: 'present_only', // 'present_only' | 'full_annotated'
    filter: 'all',
    searchQuery: '',
    manualCounter: 0,
    pendingBackupRestore: null,
    editingAuthorityId: null,
    pendingPhotoDataUrl: '',
    pendingDeleteAuthorityId: null,
    pdfReview: null
  };

  window.CerimonialState = state;

  // Mapa auxiliar para sugerir siglas a partir do seletor rápido de postos
  const RANK_ABBR_MAP = {
    'Senhor': 'Senhor',
    'Senhora': 'Senhora',
    'General de Exército': 'Gen Ex',
    'General de Divisão': 'Gen Div',
    'General de Brigada': 'Gen Bda',
    'Tenente-Brigadeiro do Ar': 'Ten Brig Ar',
    'Almirante de Esquadra': 'Alte Esq',
    'Vice-Almirante': 'V Alte',
    'Major-Brigadeiro do Ar': 'Maj Brig Ar',
    'Major-Brigadeiro Médico': 'Maj Brig Med',
    'Major-Brigadeiro Médica': 'Maj Brig Med',
    'Major-Brigadeiro Engenheiro': 'Maj Brig Eng',
    'Major-Brigadeiro Intendente': 'Maj Brig Int',
    'Contra-Almirante': 'C Alte',
    'Brigadeiro do Ar': 'Brig Ar',
    'Brigadeiro Intendente': 'Brig Int',
    'Brigadeiro Médico': 'Brig Med',
    'Brigadeiro Médica': 'Brig Med',
    'Brigadeiro Engenheiro': 'Brig Eng',
    'Brigadeiro de Infantaria': 'Brig Inf',
    'Coronel Aviador': 'Cel Av',
    'Coronel Intendente': 'Cel Int',
    'Coronel Médico': 'Cel Med',
    'Coronel Médica': 'Cel Med',
    'Capitão de Mar e Guerra': 'CMG',
    'Tenente-Coronel Aviador': 'Ten Cel Av',
    'Major Aviador': 'Maj Av',
    'Capitão': 'Cap',
    'Suboficial': 'SO',
    'Deputado Federal': 'Dep Fed',
    'Deputado Estadual': 'Dep Est',
    'Secretário de Estado': 'Sec Est'
  };

  /**
   * Formata o rótulo visual da posição de precedência no cartão
   */
  function formatOrderBadge(item) {
    if (Number.isInteger(item.order)) {
      return `#${item.order}`;
    }
    if (item.insertedAfterOrder) {
      const subLabel = item.subOrder && item.subOrder > 1 ? `.${item.subOrder}` : '.1';
      return `#${item.insertedAfterOrder}${subLabel}`;
    }
    const base = Math.max(0, Math.floor(item.order));
    const frac = Math.round((item.order - base) * 1000);
    return `#${base}.${frac}`;
  }

  /**
   * Atualiza o cabeçalho com a identificação fixa da organização (BAGL) e o nome do evento atual
   */
  function updateHeaderEventBadge() {
    const badgeEl = document.getElementById('header-event-badge');
    const cleanEvent = String(state.eventName || 'EVENTO CERIMONIAL').trim().toUpperCase();
    if (badgeEl) {
      badgeEl.textContent = `BAGL • ${cleanEvent}`;
    }
  }

  /**
   * Atualiza todos os contadores do cabeçalho e dos chips de filtro
   */
  function updateCounters() {
    updateHeaderEventBadge();
    const total = state.authorities.length;
    const present = state.authorities.filter((a) => a.present).length;
    const absent = total - present;
    const manual = state.authorities.filter((a) => a.isManual).length;

    const elTotal = document.getElementById('stat-total');
    const elPresent = document.getElementById('stat-present');
    const elAbsent = document.getElementById('stat-absent');
    const elManual = document.getElementById('stat-manual');

    if (elTotal) elTotal.textContent = String(total);
    if (elPresent) elPresent.textContent = String(present);
    if (elAbsent) elAbsent.textContent = String(absent);
    if (elManual) elManual.textContent = String(manual);

    const chipAll = document.getElementById('count-chip-all');
    const chipPres = document.getElementById('count-chip-present');
    const chipAbs = document.getElementById('count-chip-absent');
    const chipMan = document.getElementById('count-chip-manual');

    if (chipAll) chipAll.textContent = String(total);
    if (chipPres) chipPres.textContent = String(present);
    if (chipAbs) chipAbs.textContent = String(absent);
    if (chipMan) chipMan.textContent = String(manual);

    const badgeNom = document.getElementById('nominata-count-badge');
    if (badgeNom) badgeNom.textContent = `${present} Autoridades Presentes`;

    // Exibir botão de confirmações prévias apenas se o backup/evento carregado tiver registros com initially_confirmed
    const btnPreset = document.getElementById('btn-quick-confirm-preset');
    if (btnPreset) {
      const hasPreset = state.authorities.some((a) => !!a.initially_confirmed);
      if (hasPreset) {
        btnPreset.classList.remove('hidden');
      } else {
        btnPreset.classList.add('hidden');
      }
    }
  }

  /**
   * Salva o estado completo no IndexedDB + espelho
   */
  async function persistState() {
    updateCounters();
    try {
      await window.CerimonialDB.saveState(
        state.authorities,
        state.manualCounter,
        state.eventName,
        state.sourcePdfName
      );
    } catch (err) {
      console.error('Erro ao persistir estado:', err);
      window.showToast('Erro ao salvar alterações localmente. Verifique o armazenamento.', 'error');
    }
  }

  /**
   * Alterna a confirmação de presença da autoridade
   */
  window.togglePresence = async function (id) {
    const item = state.authorities.find((a) => a.id === id);
    if (!item) return;

    item.present = !item.present;
    if (item.present) {
      item.checkedTime = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      });
      window.showToast(
        `Presença confirmada: ${item.rank_abbr || ''} ${item.war_name || item.full_name}`
      );
    } else {
      delete item.checkedTime;
    }

    updateCounters();
    renderCards();
    window.CerimonialNominata.renderNominata(state);

    try {
      await window.CerimonialDB.updateAuthorityInIndexedDB(item, state.manualCounter);
      window.CerimonialDB.saveState(
        state.authorities,
        state.manualCounter,
        state.eventName,
        state.sourcePdfName
      );
    } catch (err) {
      console.error('Erro ao salvar presença:', err);
      window.showToast('Falha ao gravar presença no banco local!', 'error');
    }
  };

  /**
   * Abre o modal de Edição para uma autoridade específica (sem alterar a presença!)
   */
  window.openEditAuthorityModal = function (id, event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }

    const item = state.authorities.find((a) => a.id === id);
    if (!item) return;

    state.editingAuthorityId = item.id;
    state.pendingPhotoDataUrl = item.photo || '';

    const modal = document.getElementById('modal-add-manual');
    const titleEl = document.getElementById('modal-authority-title');
    const subtitleEl = document.getElementById('modal-authority-subtitle');
    const submitBtn = document.getElementById('btn-submit-authority-form');
    const deleteBtn = document.getElementById('btn-delete-from-edit');
    const optKeep = document.getElementById('option-position-keep');

    const inputEditId = document.getElementById('input-edit-authority-id');
    const inputName = document.getElementById('input-add-name');
    const selectTreatment = document.getElementById('select-add-treatment');
    const inputWarname = document.getElementById('input-add-warname');
    const selectRank = document.getElementById('select-add-rank');
    const inputRankAbbr = document.getElementById('input-add-rank-abbr');
    const inputFullRank = document.getElementById('input-add-full-rank');
    const inputCargo = document.getElementById('input-add-cargo');
    const selectPos = document.getElementById('select-add-position');
    const wrapperInsertAfter = document.getElementById('wrapper-insert-after');

    if (titleEl) titleEl.textContent = 'Editar Autoridade';
    if (subtitleEl) {
      subtitleEl.textContent = `Editando #${formatOrderBadge(item).replace('#', '')} — ${item.war_name || item.full_name}`;
    }
    if (submitBtn) submitBtn.textContent = 'Salvar Alterações';
    if (deleteBtn) deleteBtn.classList.remove('hidden');
    if (optKeep) optKeep.classList.remove('hidden');

    if (inputEditId) inputEditId.value = String(item.id);
    if (inputName) inputName.value = item.full_name || '';
    if (selectTreatment) {
      selectTreatment.value = item.treatment || 'SENHOR';
      if (!selectTreatment.value) selectTreatment.value = 'SENHOR';
    }
    if (inputWarname) inputWarname.value = item.war_name || '';

    if (inputRankAbbr) inputRankAbbr.value = item.rank_abbr || '';
    if (inputFullRank) inputFullRank.value = item.full_rank || item.rank_abbr || '';

    if (selectRank) {
      const matchOption = Array.from(selectRank.options || []).find(
        (opt) =>
          opt.value.toUpperCase() === (item.full_rank || '').toUpperCase() ||
          opt.value.toUpperCase() === (item.rank_abbr || '').toUpperCase()
      );
      selectRank.value = matchOption ? matchOption.value : 'Outro';
    }

    if (inputCargo) inputCargo.value = item.cargo || '';

    if (selectPos) {
      selectPos.value = 'keep';
    }
    if (wrapperInsertAfter) {
      wrapperInsertAfter.classList.add('hidden');
    }

    updatePhotoPreviewUI(
      state.pendingPhotoDataUrl,
      item.war_name || item.full_name || 'FT'
    );
    populateReferenceAuthoritySelector('');

    if (modal) {
      modal.classList.remove('hidden');
      if (inputName) inputName.focus();
    }
  };

  /**
   * Abre o modal de confirmação de exclusão para uma autoridade (sem alterar a presença!)
   */
  window.openDeleteAuthorityModal = function (id, event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }

    const item = state.authorities.find((a) => a.id === id);
    if (!item) return;

    state.pendingDeleteAuthorityId = item.id;

    const modalDelete = document.getElementById('modal-confirm-delete');
    const summaryEl = document.getElementById('delete-authority-summary');

    if (summaryEl) {
      const badge = formatOrderBadge(item);
      summaryEl.innerHTML = `Confirma a exclusão de <strong>${badge} — ${item.rank_abbr || ''} ${item.war_name || ''} (${item.full_name})</strong>?<br>Esta autoridade será removida do carômetro e da nominata.`;
    }

    if (modalDelete) {
      modalDelete.classList.remove('hidden');
    }
  };

  /**
   * Executa a exclusão confirmada de uma autoridade e persiste no IndexedDB
   */
  async function confirmDeleteAuthority() {
    const idToDelete = state.pendingDeleteAuthorityId;
    if (idToDelete === null || typeof idToDelete === 'undefined') return;

    const index = state.authorities.findIndex((a) => a.id === idToDelete);
    if (index === -1) {
      state.pendingDeleteAuthorityId = null;
      const modalDelete = document.getElementById('modal-confirm-delete');
      if (modalDelete) modalDelete.classList.add('hidden');
      return;
    }

    const removed = state.authorities[index];
    state.authorities.splice(index, 1);
    state.pendingDeleteAuthorityId = null;

    // Se o modal de edição estava aberto para esta mesma autoridade, fecha-o
    if (state.editingAuthorityId === idToDelete) {
      closeAuthorityModal();
    }

    const modalDelete = document.getElementById('modal-confirm-delete');
    if (modalDelete) modalDelete.classList.add('hidden');

    try {
      await window.CerimonialDB.deleteAuthorityFromIndexedDB(idToDelete);
      await persistState();
      renderCards();
      window.CerimonialNominata.renderNominata(state);
      window.showToast(
        `Autoridade excluída: ${removed.war_name || removed.full_name}`,
        'warning'
      );
    } catch (err) {
      console.error('Erro ao excluir autoridade:', err);
      window.showToast('Falha ao persistir exclusão no banco de dados local.', 'error');
    }
  }

  /**
   * Atualiza a prévia da foto no modal de cadastro/edição
   */
  function updatePhotoPreviewUI(dataUrl, fallbackName) {
    const imgEl = document.getElementById('photo-preview-img');
    const initialsEl = document.getElementById('photo-preview-initials');
    const btnRemove = document.getElementById('btn-remove-photo');

    const initials = String(fallbackName || 'FT')
      .trim()
      .substring(0, 2)
      .toUpperCase();
    if (initialsEl) initialsEl.textContent = initials || 'FT';

    if (dataUrl) {
      if (imgEl) {
        imgEl.src = dataUrl;
        imgEl.classList.remove('hidden');
      }
      if (initialsEl) initialsEl.classList.add('hidden');
      if (btnRemove) btnRemove.classList.remove('hidden');
    } else {
      if (imgEl) {
        imgEl.src = '';
        imgEl.classList.add('hidden');
      }
      if (initialsEl) initialsEl.classList.remove('hidden');
      if (btnRemove) btnRemove.classList.add('hidden');
    }
  }

  /**
   * Popula o seletor pesquisável de autoridades de referência para posicionamento
   */
  function populateReferenceAuthoritySelector(filterQuery = '') {
    const selectRef = document.getElementById('select-reference-authority');
    if (!selectRef) return;

    const q = String(filterQuery || '').trim().toLowerCase();
    const sorted = window.CerimonialNominata.getSortedAuthorities(state.authorities);

    const filtered = sorted.filter((a) => {
      // Não listar a própria autoridade que está sendo editada como referência de si mesma
      if (state.editingAuthorityId !== null && a.id === state.editingAuthorityId) {
        return false;
      }
      if (!q) return true;
      const badge = formatOrderBadge(a).toLowerCase();
      return (
        badge.includes(q) ||
        String(a.order).includes(q) ||
        (a.full_name || '').toLowerCase().includes(q) ||
        (a.war_name || '').toLowerCase().includes(q) ||
        (a.rank_abbr || '').toLowerCase().includes(q) ||
        (a.cargo || '').toLowerCase().includes(q)
      );
    });

    const currentVal = selectRef.value;
    selectRef.innerHTML = filtered
      .map((a) => {
        const badge = formatOrderBadge(a);
        return `<option value="${a.id}">${badge} — ${a.rank_abbr || ''} ${a.war_name || ''} (${a.full_name})</option>`;
      })
      .join('');

    if (currentVal && filtered.some((a) => String(a.id) === String(currentVal))) {
      selectRef.value = currentVal;
    } else if (filtered.length > 0) {
      selectRef.value = String(filtered[0].id);
    }
  }

  /**
   * Renderiza os cartões do Carômetro garantindo a MESMA ordem de precedência da Nominata
   */
  function renderCards() {
    const container = document.getElementById('cards-container');
    const emptyState = document.getElementById('empty-state');
    if (!container || !emptyState) return;

    const q = state.searchQuery.trim().toLowerCase();

    const sortedAuthorities = window.CerimonialNominata.getSortedAuthorities(state.authorities);

    const filtered = sortedAuthorities.filter((item) => {
      if (q) {
        const badgeStr = formatOrderBadge(item).toLowerCase();
        const idMatch =
          `#${item.order}` === q ||
          `${item.order}` === q ||
          badgeStr === q ||
          badgeStr.replace('#', '') === q;
        const nameMatch = (item.full_name || '').toLowerCase().includes(q);
        const warMatch = (item.war_name || '').toLowerCase().includes(q);
        const rankMatch =
          (item.rank_abbr || '').toLowerCase().includes(q) ||
          (item.full_rank || '').toLowerCase().includes(q);
        const cargoMatch = (item.cargo || '').toLowerCase().includes(q);
        if (!idMatch && !nameMatch && !warMatch && !rankMatch && !cargoMatch) {
          return false;
        }
      }

      if (state.filter === 'present') return item.present;
      if (state.filter === 'absent') return !item.present;
      if (state.filter === 'manual') return item.isManual;
      if (state.filter === 'generais') {
        const rk = (item.rank_abbr || '').toLowerCase();
        return rk.includes('gen') || rk.includes('brig') || rk.includes('alte');
      }
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      const msgEl = document.getElementById('empty-state-message');
      const subEl = document.getElementById('empty-state-submessage');
      const btnReset = document.getElementById('btn-reset-filters');
      if (state.authorities.length === 0) {
        if (msgEl) msgEl.textContent = 'Nenhum carômetro carregado neste dispositivo.';
        if (subEl) {
          subEl.innerHTML =
            'Utilize os botões <strong>"Importar Carômetro PDF"</strong>, <strong>"Restaurar Backup"</strong> ou <strong>"+ Adicionar Avulso"</strong> na barra superior para iniciar o evento localmente.';
          subEl.classList.remove('hidden');
        }
        if (btnReset) btnReset.classList.add('hidden');
      } else {
        if (msgEl) msgEl.textContent = 'Nenhuma autoridade encontrada com os filtros selecionados.';
        if (subEl) subEl.classList.add('hidden');
        if (btnReset) btnReset.classList.remove('hidden');
      }
      return;
    }

    emptyState.classList.add('hidden');

    const html = filtered
      .map((item) => {
        const isPres = item.present;
        const cardBg = isPres
          ? 'bg-emerald-50/90 border-emerald-500 shadow-md ring-2 ring-emerald-500/20'
          : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm';

        const photoHtml = item.photo
          ? `<img src="${item.photo}" alt="${item.war_name || item.full_name}" class="w-full h-full object-cover object-top" loading="lazy">`
          : `<div class="w-full h-full bg-slate-200 flex items-center justify-center text-slate-400 font-bold text-xs uppercase">
               ${(item.war_name || item.full_name || 'A').substring(0, 2)}
             </div>`;

        const orderLabel = formatOrderBadge(item);

        return `
          <div 
            onclick="togglePresence(${item.id})" 
            data-authority-id="${item.id}"
            data-authority-order="${item.order}"
            class="card-tap-scale cursor-pointer select-none rounded-xl border p-3 flex flex-col justify-between transition-all duration-150 ${cardBg} relative overflow-hidden group"
          >
            <!-- Precedence Number Badge + Status -->
            <div class="flex items-center justify-between mb-2">
              <span class="inline-flex items-center gap-1 font-mono font-bold text-xs px-2 py-0.5 rounded-full ${isPres ? 'bg-emerald-200 text-emerald-950 font-black' : 'bg-[#0B1D3A] text-amber-300'}">
                <span>${orderLabel}</span>
                ${item.isManual ? '<span class="text-[9px] uppercase tracking-wider text-amber-300 font-sans">• Avulso</span>' : ''}
              </span>

              <div class="flex items-center gap-1">
                ${
                  isPres
                    ? `
                  <span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow-sm">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                    </svg>
                    PRESENTE
                  </span>
                `
                    : `
                  <span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    Ausente
                  </span>
                `
                }
              </div>
            </div>

            <!-- Card Body: Photo + Info -->
            <div class="flex items-start gap-3">
              <!-- Photo Box -->
              <div class="w-16 h-20 sm:w-18 sm:h-22 rounded-lg border border-slate-300 overflow-hidden bg-slate-100 flex-shrink-0 shadow-inner relative">
                ${photoHtml}
                ${
                  isPres
                    ? `
                  <div class="absolute inset-0 bg-emerald-600/10 pointer-events-none flex items-end justify-end p-0.5">
                    <span class="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-black shadow">✓</span>
                  </div>
                `
                    : ''
                }
              </div>

              <!-- Text Details -->
              <div class="flex-1 min-w-0">
                <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide truncate">
                  ${item.rank_abbr || ''}
                </div>
                <div class="text-sm font-black text-slate-900 leading-tight uppercase truncate">
                  ${item.war_name || item.full_name}
                </div>
                <div class="text-xs text-slate-700 font-medium leading-tight line-clamp-1 mt-0.5">
                  ${item.full_name}
                </div>
                ${
                  item.cargo
                    ? `
                  <div class="text-[11px] text-slate-600 leading-tight line-clamp-2 mt-1.5 italic bg-black/5 p-1 rounded">
                    ${item.cargo}
                  </div>
                `
                    : ''
                }
              </div>
            </div>

            <!-- Footer: Quick indicator + Independent Edit/Delete Actions -->
            <div class="mt-2.5 pt-2 border-t border-black/5 flex items-center justify-between text-[11px] gap-1">
              <span class="text-slate-400 truncate">
                ${item.checkedTime ? `Chegada: ${item.checkedTime}` : 'Toque para marcar'}
              </span>

              <div class="flex items-center gap-1 flex-shrink-0" onclick="event.stopPropagation()">
                <button
                  type="button"
                  onclick="openEditAuthorityModal(${item.id}, event)"
                  class="px-2 py-0.5 rounded bg-slate-100 hover:bg-[#0B1D3A] text-slate-600 hover:text-white font-medium transition flex items-center gap-1 border border-slate-200"
                  title="Editar dados, foto ou posição desta autoridade"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                  </svg>
                  <span>Editar</span>
                </button>
                <button
                  type="button"
                  onclick="openDeleteAuthorityModal(${item.id}, event)"
                  class="p-1 rounded bg-slate-100 hover:bg-rose-600 text-slate-500 hover:text-white transition border border-slate-200"
                  title="Excluir esta autoridade"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                </button>
              </div>
            </div>

          </div>
        `;
      })
      .join('');

    container.innerHTML = html;
  }

  /**
   * Alterna entre as abas Carômetro e Nominata
   */
  function setTab(tab) {
    state.currentTab = tab;
    const tabCarometro = document.getElementById('tab-btn-carometro');
    const tabNominata = document.getElementById('tab-btn-nominata');
    const viewCarometro = document.getElementById('view-carometro');
    const viewNominata = document.getElementById('view-nominata');

    if (tab === 'carometro') {
      tabCarometro.className =
        'px-3 py-1.5 rounded-md font-medium text-white bg-[#132F5B] transition flex items-center gap-1.5 border border-[#20457E]';
      tabNominata.className =
        'px-3 py-1.5 rounded-md font-medium text-blue-200/70 hover:text-white hover:bg-[#132F5B] transition flex items-center gap-1.5';
      viewCarometro.classList.remove('hidden');
      viewNominata.classList.add('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      tabNominata.className =
        'px-3 py-1.5 rounded-md font-medium text-white bg-[#132F5B] transition flex items-center gap-1.5 border border-[#20457E]';
      tabCarometro.className =
        'px-3 py-1.5 rounded-md font-medium text-blue-200/70 hover:text-white hover:bg-[#132F5B] transition flex items-center gap-1.5';
      viewCarometro.classList.add('hidden');
      viewNominata.classList.remove('hidden');
      window.CerimonialNominata.renderNominata(state);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * Calcula de forma determinística e sem colisões a posição de precedência:
   * - 'start': no início da relação (antes da primeira autoridade)
   * - 'end': no final da relação (após a última autoridade)
   * - 'before_id': imediatamente antes da autoridade de referência
   * - 'after_id': imediatamente após a autoridade de referência (e após eventuais avulsos já inseridos no mesmo ponto, mantendo ordem FIFO de inserção)
   * Preserva integralmente os números de ordem das demais autoridades sem alterá-los.
   */
  function computePrecedencePosition(posChoice, refAuthorityId, rawAfterOrderNumber, excludeId = null) {
    const others = window.CerimonialNominata.getSortedAuthorities(
      state.authorities.filter((a) => a.id !== excludeId)
    );

    if (others.length === 0) {
      return { order: 1, insertedAfterOrder: null, subOrder: 0 };
    }

    // Localizar a autoridade de referência (por ID do seletor ou pelo número digitado no input numérico)
    let refItem = null;
    if (!isNaN(rawAfterOrderNumber) && rawAfterOrderNumber >= 1) {
      refItem =
        others.find((a) => a.order === rawAfterOrderNumber) ||
        others.find((a) => a.id === rawAfterOrderNumber);
    }
    if (!refItem && refAuthorityId) {
      refItem = others.find((a) => String(a.id) === String(refAuthorityId));
    }

    if (posChoice === 'start') {
      const firstOrder = Number(others[0].order) || 1;
      const newOrder = firstOrder > 0.01 ? Number((firstOrder - 0.001).toFixed(6)) : Number((firstOrder / 2).toFixed(6));
      return {
        order: newOrder,
        insertedAfterOrder: null,
        subOrder: 0
      };
    }

    if (posChoice === 'before_id' && refItem) {
      const refIdx = others.findIndex((a) => a.id === refItem.id);
      const refOrder = Number(refItem.order);
      if (refIdx <= 0) {
        const newOrder = refOrder > 0.01 ? Number((refOrder - 0.001).toFixed(6)) : Number((refOrder / 2).toFixed(6));
        return {
          order: newOrder,
          insertedAfterOrder: null,
          subOrder: 0
        };
      }
      const prevOrder = Number(others[refIdx - 1].order);
      const midOrder = Number(((prevOrder + refOrder) / 2).toFixed(6));
      return {
        order: midOrder,
        insertedAfterOrder: Math.floor(prevOrder) || 1,
        subOrder: 1
      };
    }

    if (posChoice === 'after_id' && refItem) {
      const baseInt = Number.isInteger(refItem.order)
        ? refItem.order
        : refItem.insertedAfterOrder || Math.floor(refItem.order);

      // Se a referência é uma autoridade inteira (ex: #1), agrupa todos os avulsos inseridos diretamente após ela (entre 1 e 2) em sequência 1.001, 1.002...
      if (Number.isInteger(refItem.order)) {
        const refIdx = others.findIndex((a) => a.id === refItem.id);
        // Encontrar o próximo item que NÃO foi inserido após este mesmo baseInt
        let nextMajorOrder = refItem.order + 1;
        for (let i = refIdx + 1; i < others.length; i++) {
          if (others[i].order >= refItem.order + 1) {
            nextMajorOrder = others[i].order;
            break;
          }
        }

        const sameSlotItems = others.filter(
          (a) => a.order > refItem.order && a.order < Math.min(refItem.order + 1, nextMajorOrder)
        );
        const nextSubOrder = sameSlotItems.length + 1;
        const maxInSlot =
          sameSlotItems.length > 0
            ? Math.max(...sameSlotItems.map((a) => Number(a.order)))
            : refItem.order;

        let candidate = Math.max(refItem.order + nextSubOrder * 0.001, maxInSlot + 0.001);
        if (candidate >= nextMajorOrder) {
          candidate = (maxInSlot + nextMajorOrder) / 2;
        }
        return {
          order: Number(candidate.toFixed(6)),
          insertedAfterOrder: baseInt,
          subOrder: nextSubOrder
        };
      } else {
        // Inserir logo após uma autoridade que já tem ordem fracionária
        const refIdx = others.findIndex((a) => a.id === refItem.id);
        const refOrder = Number(refItem.order);
        const nextOrder =
          refIdx + 1 < others.length ? Number(others[refIdx + 1].order) : Math.floor(refOrder) + 1;
        const midOrder = Number(((refOrder + nextOrder) / 2).toFixed(6));
        return {
          order: midOrder,
          insertedAfterOrder: baseInt,
          subOrder: (refItem.subOrder || 1) + 1
        };
      }
    }

    // Padrão ('end'): inserir ao final da lista
    const maxOrder = Math.max(...others.map((a) => Math.floor(Number(a.order) || 0)), 0);
    return {
      order: maxOrder + 1,
      insertedAfterOrder: null,
      subOrder: 0
    };
  }

  /**
   * Fecha e limpa o modal de cadastro/edição de autoridade
   */
  function closeAuthorityModal() {
    const modal = document.getElementById('modal-add-manual');
    const formAdd = document.getElementById('form-add-manual');
    const wrapperInsertAfter = document.getElementById('wrapper-insert-after');
    const optKeep = document.getElementById('option-position-keep');
    const deleteBtn = document.getElementById('btn-delete-from-edit');
    const inputEditId = document.getElementById('input-edit-authority-id');
    const inputName = document.getElementById('input-add-name');
    const inputWarname = document.getElementById('input-add-warname');
    const inputCargo = document.getElementById('input-add-cargo');
    const selectTreatment = document.getElementById('select-add-treatment');
    const selectRank = document.getElementById('select-add-rank');
    const inputRankAbbr = document.getElementById('input-add-rank-abbr');
    const inputFullRank = document.getElementById('input-add-full-rank');
    const inputInsertAfterId = document.getElementById('input-insert-after-id');
    const inputSearchRef = document.getElementById('input-search-reference-authority');

    state.editingAuthorityId = null;
    state.pendingPhotoDataUrl = '';

    if (modal) modal.classList.add('hidden');
    if (formAdd) formAdd.reset();
    if (inputName) inputName.value = '';
    if (inputWarname) inputWarname.value = '';
    if (inputCargo) inputCargo.value = '';
    if (selectTreatment) selectTreatment.value = 'SENHOR';
    if (selectRank) selectRank.value = 'Senhor';
    if (inputRankAbbr) inputRankAbbr.value = 'Senhor';
    if (inputFullRank) inputFullRank.value = 'SENHOR';
    if (inputInsertAfterId) inputInsertAfterId.value = '';
    if (inputSearchRef) inputSearchRef.value = '';
    if (wrapperInsertAfter) wrapperInsertAfter.classList.add('hidden');
    if (optKeep) optKeep.classList.add('hidden');
    if (deleteBtn) deleteBtn.classList.add('hidden');
    if (inputEditId) inputEditId.value = '';
    updatePhotoPreviewUI('', 'FT');
  }

  /**
   * =========================================================================
   * ETAPA 3: FLUXO DE IMPORTAÇÃO E REVISÃO OBRIGATÓRIA DE CARÔMETRO PDF
   * =========================================================================
   */
  function updatePdfReviewSummaryUI() {
    if (!state.pdfReview) return;

    const analysis = window.CerimonialPdfImporter.analyzeReviewItems(state.pdfReview.items);
    state.pdfReview.total = analysis.total;
    state.pdfReview.completeCount = analysis.completeCount;
    state.pdfReview.pendingCount = analysis.pendingCount;
    state.pdfReview.duplicateCount = analysis.duplicateCount;

    const elTotal = document.getElementById('review-stat-total');
    const elComplete = document.getElementById('review-stat-complete');
    const elPending = document.getElementById('review-stat-pending');
    const elFilename = document.getElementById('review-pdf-filename');
    const elPages = document.getElementById('review-pdf-pages');
    const elWarningBanner = document.getElementById('review-warning-banner');
    const elWarningText = document.getElementById('review-warning-text');

    if (elTotal) elTotal.textContent = String(analysis.total);
    if (elComplete) elComplete.textContent = String(analysis.completeCount);
    if (elPending) elPending.textContent = String(analysis.pendingCount);
    if (elFilename) elFilename.textContent = state.pdfReview.filename || 'Carômetro.pdf';
    if (elPages) elPages.textContent = String(state.pdfReview.numPages || 1);

    if (elWarningBanner && elWarningText) {
      if (state.pdfReview.layoutWarning) {
        elWarningBanner.classList.remove('hidden');
        elWarningText.textContent = state.pdfReview.layoutWarning;
      } else if (analysis.pendingCount > 0) {
        elWarningBanner.classList.remove('hidden');
        elWarningText.textContent = `Atenção: Há ${analysis.pendingCount} registro(s) com dados pendentes, duplicidade ou associação de foto de baixa confiança. Confira antes de confirmar.`;
      } else {
        elWarningBanner.classList.add('hidden');
      }
    }
  }

  function renderPdfReviewList() {
    const container = document.getElementById('review-items-container');
    if (!container || !state.pdfReview) return;

    updatePdfReviewSummaryUI();

    const filterMode = state.pdfReview.filter || 'all';
    const items = state.pdfReview.items || [];

    const visibleItems = items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => {
        if (filterMode === 'pending') return !!item.needsReview;
        if (filterMode === 'complete') return !item.needsReview;
        return true;
      });

    if (visibleItems.length === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-xs sm:text-sm">
          Nenhum registro encontrado neste filtro da revisão. Use o botão <strong>"+ Incluir Autoridade Não Identificada"</strong> acima se desejar adicionar manualmente.
        </div>
      `;
      return;
    }

    container.innerHTML = visibleItems
      .map(({ item, idx }) => {
        const isPending = !!item.needsReview;
        const borderClass = isPending
          ? 'border-amber-400 bg-amber-50/40 ring-1 ring-amber-300'
          : 'border-slate-200 bg-white';

        const statusBadge = isPending
          ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
               ⚠ Revisão Necessária: ${(item.reviewReasons || []).join(' • ')}
             </span>`
          : `<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
               ✓ Registro Completo
             </span>`;

        const photoPreview = item.photo
          ? `<img src="${item.photo}" alt="Foto #${idx + 1}" class="w-full h-full object-cover object-top">`
          : `<div class="w-full h-full flex flex-col items-center justify-center text-[10px] text-slate-400 font-bold p-1 text-center">
               <span>SEM FOTO</span>
             </div>`;

        const candidatePhotoBtn =
          !item.photo && item.candidatePhoto
            ? `<button
                 type="button"
                 onclick="acceptReviewCandidatePhoto(${idx})"
                 class="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[10px] font-semibold transition"
                 title="Associar a foto próxima encontrada na página após verificar que pertence a esta autoridade"
               >
                 Usar Foto Sugerida
               </button>`
            : '';

        return `
          <div class="rounded-xl border p-3 sm:p-4 shadow-sm transition ${borderClass}" data-review-index="${idx}">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-200/70">
              <div class="flex items-center gap-2">
                <span class="font-mono font-bold text-xs px-2.5 py-0.5 rounded-full bg-[#0B1D3A] text-amber-300">
                  #${idx + 1}
                </span>
                <span class="text-[11px] text-slate-500">Página ${item.pageNumber || 1}</span>
                ${statusBadge}
              </div>

              <div class="flex items-center gap-1">
                <button
                  type="button"
                  onclick="moveReviewItem(${idx}, -1)"
                  ${idx === 0 ? 'disabled' : ''}
                  class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold border border-slate-200"
                  title="Subir na ordem de precedência"
                >
                  ↑ Subir
                </button>
                <button
                  type="button"
                  onclick="moveReviewItem(${idx}, 1)"
                  ${idx === items.length - 1 ? 'disabled' : ''}
                  class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold border border-slate-200"
                  title="Descer na ordem de precedência"
                >
                  ↓ Descer
                </button>
                <button
                  type="button"
                  onclick="deleteReviewItem(${idx})"
                  class="px-2 py-1 rounded bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white text-xs font-semibold border border-rose-200 transition ml-1"
                  title="Excluir este registro inválido da importação"
                >
                  Excluir
                </button>
              </div>
            </div>

            <div class="flex flex-col sm:flex-row items-start gap-3.5">
              <!-- Coluna da Fotografia -->
              <div class="flex sm:flex-col items-center gap-2 flex-shrink-0">
                <div class="w-16 h-20 rounded-lg border border-slate-300 overflow-hidden bg-slate-100 shadow-inner">
                  ${photoPreview}
                </div>
                <div class="flex flex-col gap-1 w-28 sm:w-20">
                  <button
                    type="button"
                    onclick="triggerReviewRowPhotoUpload(${idx})"
                    class="px-2 py-1 rounded bg-[#0B1D3A] hover:bg-[#162E54] text-white text-[10px] font-medium transition text-center"
                  >
                    Trocar Foto
                  </button>
                  ${
                    item.photo
                      ? `<button
                           type="button"
                           onclick="removeReviewRowPhoto(${idx})"
                           class="px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-medium transition text-center"
                         >
                           Remover
                         </button>`
                      : `<button
                           type="button"
                           onclick="markReviewRowNoPhotoConfirmed(${idx})"
                           class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 text-[10px] font-medium transition text-center"
                           title="Confirmar que esta autoridade não possui foto"
                         >
                           Sem Foto OK
                         </button>`
                  }
                  ${candidatePhotoBtn}
                </div>
              </div>

              <!-- Campos Editáveis da Autoridade -->
              <div class="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2.5 w-full text-xs">
                <div class="sm:col-span-2">
                  <label class="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Sigla Posto</label>
                  <input
                    type="text"
                    value="${(item.rank_abbr || '').replace(/"/g, '&quot;')}"
                    onchange="updateReviewItemField(${idx}, 'rank_abbr', this.value)"
                    placeholder="Ex: Maj Brig Ar"
                    class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-xs"
                  >
                </div>

                <div class="sm:col-span-3">
                  <label class="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Posto na Nominata</label>
                  <input
                    type="text"
                    value="${(item.full_rank || '').replace(/"/g, '&quot;')}"
                    onchange="updateReviewItemField(${idx}, 'full_rank', this.value)"
                    placeholder="Ex: MAJOR-BRIGADEIRO DO AR"
                    class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-xs uppercase"
                  >
                </div>

                <div class="sm:col-span-3">
                  <label class="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Nome de Guerra *</label>
                  <input
                    type="text"
                    value="${(item.war_name || '').replace(/"/g, '&quot;')}"
                    onchange="updateReviewItemField(${idx}, 'war_name', this.value)"
                    placeholder="Nome de guerra"
                    class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-bold uppercase"
                  >
                </div>

                <div class="sm:col-span-2">
                  <label class="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Tratamento</label>
                  <select
                    onchange="updateReviewItemField(${idx}, 'treatment', this.value)"
                    class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-xs"
                  >
                    <option value="SENHOR" ${item.treatment === 'SENHOR' ? 'selected' : ''}>SENHOR</option>
                    <option value="SENHORA" ${item.treatment === 'SENHORA' ? 'selected' : ''}>SENHORA</option>
                    <option value="EXMO. SR." ${item.treatment === 'EXMO. SR.' ? 'selected' : ''}>EXMO. SR.</option>
                    <option value="EXMA. SRA." ${item.treatment === 'EXMA. SRA.' ? 'selected' : ''}>EXMA. SRA.</option>
                  </select>
                </div>

                <div class="sm:col-span-2">
                  <label class="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Ordem (#)</label>
                  <input
                    type="number"
                    min="1"
                    max="${items.length}"
                    value="${idx + 1}"
                    onchange="moveReviewItemToPosition(${idx}, this.value)"
                    class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-mono font-bold"
                  >
                </div>

                <div class="sm:col-span-6">
                  <label class="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Nome Completo *</label>
                  <input
                    type="text"
                    value="${(item.full_name || '').replace(/"/g, '&quot;')}"
                    onchange="updateReviewItemField(${idx}, 'full_name', this.value)"
                    placeholder="Nome completo da autoridade"
                    class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-xs uppercase"
                  >
                </div>

                <div class="sm:col-span-6">
                  <label class="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Cargo / Função</label>
                  <input
                    type="text"
                    value="${(item.cargo || '').replace(/"/g, '&quot;')}"
                    onchange="updateReviewItemField(${idx}, 'cargo', this.value)"
                    placeholder="Cargo ou função oficial"
                    class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-xs"
                  >
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  window.updateReviewItemField = function (index, field, value) {
    if (!state.pdfReview || !state.pdfReview.items[index]) return;
    const item = state.pdfReview.items[index];
    const cleanVal = String(value || '').trim();

    if (field === 'full_name' || field === 'war_name' || field === 'full_rank' || field === 'treatment') {
      item[field] = cleanVal.toUpperCase();
    } else {
      item[field] = cleanVal;
    }

    // Se preencheu rank_abbr e full_rank estava vazio, sugerir full_rank
    if (field === 'rank_abbr' && cleanVal && !item.full_rank && window.CerimonialRankParser) {
      const parsed = window.CerimonialRankParser.parseRankAndWarName(cleanVal);
      if (parsed.matched && parsed.full_rank) {
        item.full_rank = parsed.full_rank;
      } else {
        item.full_rank = cleanVal.toUpperCase();
      }
    }

    renderPdfReviewList();
  };

  window.moveReviewItem = function (index, delta) {
    if (!state.pdfReview || !Array.isArray(state.pdfReview.items)) return;
    const items = state.pdfReview.items;
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const [moved] = items.splice(index, 1);
    items.splice(targetIdx, 0, moved);
    renderPdfReviewList();
  };

  window.moveReviewItemToPosition = function (index, newPosVal) {
    if (!state.pdfReview || !Array.isArray(state.pdfReview.items)) return;
    const items = state.pdfReview.items;
    const targetPos = Math.max(1, Math.min(items.length, parseInt(newPosVal, 10) || index + 1));
    const targetIdx = targetPos - 1;
    if (targetIdx === index) return;

    const [moved] = items.splice(index, 1);
    items.splice(targetIdx, 0, moved);
    renderPdfReviewList();
  };

  window.deleteReviewItem = function (index) {
    if (!state.pdfReview || !Array.isArray(state.pdfReview.items)) return;
    state.pdfReview.items.splice(index, 1);
    renderPdfReviewList();
  };

  window.triggerReviewRowPhotoUpload = function (index) {
    if (!state.pdfReview) return;
    state.pdfReview.photoTargetIndex = index;
    const inputPhoto = document.getElementById('input-review-row-photo');
    if (inputPhoto) {
      inputPhoto.value = '';
      inputPhoto.click();
    }
  };

  window.removeReviewRowPhoto = function (index) {
    if (!state.pdfReview || !state.pdfReview.items[index]) return;
    state.pdfReview.items[index].photo = '';
    state.pdfReview.items[index].photoConfidence = 'missing';
    state.pdfReview.items[index].photoConfirmedManually = false;
    renderPdfReviewList();
  };

  window.markReviewRowNoPhotoConfirmed = function (index) {
    if (!state.pdfReview || !state.pdfReview.items[index]) return;
    state.pdfReview.items[index].photoConfirmedManually = true;
    renderPdfReviewList();
  };

  window.acceptReviewCandidatePhoto = function (index) {
    if (!state.pdfReview || !state.pdfReview.items[index]) return;
    const item = state.pdfReview.items[index];
    if (item.candidatePhoto) {
      item.photo = item.candidatePhoto;
      item.photoConfidence = 'high';
      item.photoConfirmedManually = true;
      renderPdfReviewList();
    }
  };

  function openPdfReviewModal(extractionResult) {
    state.pdfReview = {
      filename: extractionResult.filename,
      eventName: extractionResult.suggestedEventName,
      numPages: extractionResult.numPages,
      items: extractionResult.items || [],
      allExtractedImages: extractionResult.allExtractedImages || [],
      layoutWarning: extractionResult.layoutWarning || null,
      filter: 'all',
      photoTargetIndex: null,
      preReplaceBackupGenerated: false,
      preReplaceBackupFilename: ''
    };

    const inputEventName = document.getElementById('input-review-event-name');
    const previewBadge = document.getElementById('preview-review-event-badge');
    const modalReview = document.getElementById('modal-pdf-review');

    if (inputEventName) {
      inputEventName.value = state.pdfReview.eventName;
    }
    if (previewBadge) {
      previewBadge.textContent = state.pdfReview.eventName;
    }

    document.querySelectorAll('.review-filter-btn').forEach((btn) => {
      const f = btn.getAttribute('data-review-filter');
      if (f === 'all') {
        btn.className = 'review-filter-btn px-2.5 py-1 rounded-md font-semibold bg-[#0B1D3A] text-white transition';
      } else {
        btn.className = 'review-filter-btn px-2.5 py-1 rounded-md font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
      }
    });

    renderPdfReviewList();

    if (modalReview) {
      modalReview.classList.remove('hidden');
    }
  }

  function cancelPdfReview() {
    state.pdfReview = null;
    const modalReview = document.getElementById('modal-pdf-review');
    const modalConfirmReplace = document.getElementById('modal-confirm-replace-carometro');
    if (modalReview) modalReview.classList.add('hidden');
    if (modalConfirmReplace) modalConfirmReplace.classList.add('hidden');
    window.showToast('Importação de PDF cancelada. O carômetro atual foi mantido intacto.');
  }

  /**
   * Configura todos os eventos da interface
   */
  function setupEvents() {
    // Abas
    document.getElementById('tab-btn-carometro').addEventListener('click', () => setTab('carometro'));
    document.getElementById('tab-btn-nominata').addEventListener('click', () => setTab('nominata'));
    document.getElementById('btn-open-nominata').addEventListener('click', () => setTab('nominata'));
    document.getElementById('btn-back-to-carometro').addEventListener('click', () => setTab('carometro'));

    // Busca
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (state.searchQuery) {
        btnClearSearch.classList.remove('hidden');
      } else {
        btnClearSearch.classList.add('hidden');
      }
      renderCards();
    });

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      btnClearSearch.classList.add('hidden');
      renderCards();
      searchInput.focus();
    });

    document.getElementById('btn-reset-filters').addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      state.filter = 'all';
      document.querySelectorAll('.filter-chip').forEach((b) => {
        b.classList.remove('active', 'bg-[#0B1D3A]', 'text-white');
        b.classList.add('bg-slate-100', 'text-slate-700');
      });
      document.querySelector('[data-filter="all"]').classList.add('active', 'bg-[#0B1D3A]', 'text-white');
      renderCards();
    });

    // Chips de filtro
    document.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach((b) => {
          b.classList.remove('active', 'bg-[#0B1D3A]', 'text-white');
          b.classList.add('bg-slate-100', 'text-slate-700');
        });
        btn.classList.add('active', 'bg-[#0B1D3A]', 'text-white');
        btn.classList.remove('bg-slate-100', 'text-slate-700');
        state.filter = btn.getAttribute('data-filter');
        renderCards();
      });
    });

    // Modos de visualização da Nominata
    const btnModePresent = document.getElementById('mode-present-only');
    const btnModeFull = document.getElementById('mode-full-annotated');

    btnModePresent.addEventListener('click', () => {
      state.nominataMode = 'present_only';
      btnModePresent.className =
        'px-3 py-1.5 rounded-md font-semibold bg-white text-slate-900 shadow-sm transition';
      btnModeFull.className =
        'px-3 py-1.5 rounded-md font-medium text-slate-600 hover:text-slate-900 transition';
      window.CerimonialNominata.renderNominata(state);
    });

    btnModeFull.addEventListener('click', () => {
      state.nominataMode = 'full_annotated';
      btnModeFull.className =
        'px-3 py-1.5 rounded-md font-semibold bg-white text-slate-900 shadow-sm transition';
      btnModePresent.className =
        'px-3 py-1.5 rounded-md font-medium text-slate-600 hover:text-slate-900 transition';
      window.CerimonialNominata.renderNominata(state);
    });

    // Botões de exportação da Nominata
    document
      .getElementById('btn-print-nominata')
      .addEventListener('click', () => window.CerimonialNominata.printNominata(state));

    const btnDownloadWord = document.getElementById('btn-download-word');
    if (btnDownloadWord) {
      btnDownloadWord.addEventListener('click', () =>
        window.CerimonialNominata.downloadWordDoc(state)
      );
    }

    document
      .getElementById('btn-copy-nominata')
      .addEventListener('click', () => window.CerimonialNominata.copyNominataText(state));

    // Restaurar confirmações prévias
    document.getElementById('btn-quick-confirm-preset').addEventListener('click', async () => {
      state.authorities.forEach((a) => {
        a.present = !!a.initially_confirmed;
      });
      await persistState();
      renderCards();
      window.CerimonialNominata.renderNominata(state);
      window.showToast('Confirmações prévias do documento restauradas!');
    });

    // Modal Zerar Presenças
    const modalReset = document.getElementById('modal-confirm-reset');
    const btnOpenReset = document.getElementById('btn-open-modal-reset');
    const btnCancelReset = document.getElementById('btn-cancel-reset');
    const btnConfirmReset = document.getElementById('btn-confirm-reset');

    btnOpenReset.addEventListener('click', () => {
      modalReset.classList.remove('hidden');
    });

    btnCancelReset.addEventListener('click', () => {
      modalReset.classList.add('hidden');
    });

    btnConfirmReset.addEventListener('click', async () => {
      state.authorities.forEach((a) => {
        a.present = false;
        delete a.checkedTime;
      });
      await persistState();
      modalReset.classList.add('hidden');
      renderCards();
      window.CerimonialNominata.renderNominata(state);
      window.showToast('Todas as presenças foram zeradas.');
    });

    // Backup JSON: Exportar e Restaurar
    const btnExportBackup = document.getElementById('btn-export-backup');
    if (btnExportBackup) {
      btnExportBackup.addEventListener('click', () => {
        window.CerimonialDB.exportBackupJSON(
          state.authorities,
          state.manualCounter,
          state.eventName,
          state.sourcePdfName
        );
      });
    }

    const btnImportBackup = document.getElementById('btn-import-backup');
    const inputImportBackup = document.getElementById('input-import-backup');
    const modalRestoreBackup = document.getElementById('modal-confirm-restore');
    const btnCancelRestore = document.getElementById('btn-cancel-restore');
    const btnConfirmRestore = document.getElementById('btn-confirm-restore');
    const restoreSummaryText = document.getElementById('restore-backup-summary');

    if (btnImportBackup && inputImportBackup) {
      btnImportBackup.addEventListener('click', () => {
        inputImportBackup.value = '';
        inputImportBackup.click();
      });

      inputImportBackup.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          const parsedBackup = await window.CerimonialDB.parseBackupFile(file);
          state.pendingBackupRestore = parsedBackup;

          if (restoreSummaryText && modalRestoreBackup) {
            const totalCount = parsedBackup.authorities.length;
            const presCount = parsedBackup.authorities.filter((a) => a.present).length;
            const manCount = parsedBackup.authorities.filter((a) => a.isManual).length;
            const evLabel = parsedBackup.eventName ? ` do evento <strong>${parsedBackup.eventName}</strong>` : '';
            restoreSummaryText.innerHTML = `Arquivo válido${evLabel} contendo <strong>${totalCount} autoridades</strong> (${presCount} presentes, ${manCount} avulsos).<br>Deseja substituir os dados atuais por este backup?`;
            modalRestoreBackup.classList.remove('hidden');
          }
        } catch (err) {
          window.showToast(err.message || 'Arquivo de backup inválido.', 'error');
        }
      });
    }

    if (btnCancelRestore && modalRestoreBackup) {
      btnCancelRestore.addEventListener('click', () => {
        state.pendingBackupRestore = null;
        modalRestoreBackup.classList.add('hidden');
      });
    }

    if (btnConfirmRestore && modalRestoreBackup) {
      btnConfirmRestore.addEventListener('click', async () => {
        if (!state.pendingBackupRestore) return;
        const { authorities, manualCounter, eventName, sourcePdfName } = state.pendingBackupRestore;
        state.authorities = window.CerimonialNominata.getSortedAuthorities(authorities);
        state.manualCounter = manualCounter || 0;
        if (eventName) state.eventName = eventName;
        if (typeof sourcePdfName === 'string') state.sourcePdfName = sourcePdfName;
        state.pendingBackupRestore = null;

        modalRestoreBackup.classList.add('hidden');
        await persistState();
        renderCards();
        window.CerimonialNominata.renderNominata(state);
        window.showToast('Backup restaurado com sucesso!', 'success');
      });
    }

    // Modal Confirmar Exclusão de Autoridade
    const modalDelete = document.getElementById('modal-confirm-delete');
    const btnCancelDelete = document.getElementById('btn-cancel-delete');
    const btnConfirmDelete = document.getElementById('btn-confirm-delete');
    const btnDeleteFromEdit = document.getElementById('btn-delete-from-edit');

    if (btnCancelDelete && modalDelete) {
      btnCancelDelete.addEventListener('click', () => {
        state.pendingDeleteAuthorityId = null;
        modalDelete.classList.add('hidden');
      });
    }

    if (btnConfirmDelete) {
      btnConfirmDelete.addEventListener('click', confirmDeleteAuthority);
    }

    if (btnDeleteFromEdit) {
      btnDeleteFromEdit.addEventListener('click', () => {
        if (state.editingAuthorityId !== null) {
          window.openDeleteAuthorityModal(state.editingAuthorityId);
        }
      });
    }

    // Modal Cadastrar / Editar Autoridade
    const modal = document.getElementById('modal-add-manual');
    const btnAdd = document.getElementById('btn-add-manual');
    const btnClose = document.getElementById('btn-close-modal-add');
    const btnCancel = document.getElementById('btn-cancel-modal-add');
    const formAdd = document.getElementById('form-add-manual');
    const selectPos = document.getElementById('select-add-position');
    const wrapperInsertAfter = document.getElementById('wrapper-insert-after');
    const selectRank = document.getElementById('select-add-rank');
    const selectTreatment = document.getElementById('select-add-treatment');
    const inputRankAbbr = document.getElementById('input-add-rank-abbr');
    const inputFullRank = document.getElementById('input-add-full-rank');
    const inputSearchRef = document.getElementById('input-search-reference-authority');
    const selectRefAuth = document.getElementById('select-reference-authority');
    const inputInsertAfterId = document.getElementById('input-insert-after-id');

    // Controles de Fotografia
    const btnSelectPhoto = document.getElementById('btn-select-photo');
    const btnRemovePhoto = document.getElementById('btn-remove-photo');
    const inputPhotoFile = document.getElementById('input-authority-photo');

    if (btnSelectPhoto && inputPhotoFile) {
      btnSelectPhoto.addEventListener('click', () => {
        inputPhotoFile.value = '';
        inputPhotoFile.click();
      });

      inputPhotoFile.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const compressedDataUrl = await window.CerimonialPhotoUtils.processImageFile(file);
          state.pendingPhotoDataUrl = compressedDataUrl;
          const currentName =
            document.getElementById('input-add-warname').value ||
            document.getElementById('input-add-name').value ||
            'FT';
          updatePhotoPreviewUI(state.pendingPhotoDataUrl, currentName);
          window.showToast('Fotografia carregada e otimizada com sucesso.');
        } catch (err) {
          window.showToast(err.message || 'Erro ao processar fotografia.', 'error');
        }
      });
    }

    if (btnRemovePhoto) {
      btnRemovePhoto.addEventListener('click', () => {
        state.pendingPhotoDataUrl = '';
        const currentName =
          document.getElementById('input-add-warname').value ||
          document.getElementById('input-add-name').value ||
          'FT';
        updatePhotoPreviewUI('', currentName);
      });
    }

    // Sincronizar sugestão de posto e tratamento ao escolher no seletor rápido
    if (selectRank) {
      selectRank.addEventListener('change', () => {
        const val = selectRank.value;
        if (val !== 'Outro') {
          if (inputFullRank) inputFullRank.value = val.toUpperCase();
          if (inputRankAbbr) inputRankAbbr.value = RANK_ABBR_MAP[val] || val;
          if (selectTreatment) {
            if (val.includes('Senhora') || val.includes('Médica')) {
              selectTreatment.value = 'SENHORA';
            } else if (val.includes('Senhor') || val.includes('Médico')) {
              selectTreatment.value = 'SENHOR';
            }
          }
        }
      });
    }

    // Abrir modal para NOVA Autoridade Avulsa
    btnAdd.addEventListener('click', () => {
      state.editingAuthorityId = null;
      state.pendingPhotoDataUrl = '';

      const titleEl = document.getElementById('modal-authority-title');
      const subtitleEl = document.getElementById('modal-authority-subtitle');
      const submitBtn = document.getElementById('btn-submit-authority-form');
      const deleteBtn = document.getElementById('btn-delete-from-edit');
      const optKeep = document.getElementById('option-position-keep');
      const inputEditId = document.getElementById('input-edit-authority-id');

      if (formAdd) formAdd.reset();
      if (inputEditId) inputEditId.value = '';
      if (titleEl) titleEl.textContent = 'Adicionar Autoridade Avulsa';
      if (subtitleEl) subtitleEl.textContent = 'Convidado não constante no carômetro inicial';
      if (submitBtn) submitBtn.textContent = 'Cadastrar & Marcar Presença';
      if (deleteBtn) deleteBtn.classList.add('hidden');
      if (optKeep) optKeep.classList.add('hidden');
      if (selectPos) selectPos.value = 'end';
      if (wrapperInsertAfter) wrapperInsertAfter.classList.add('hidden');
      if (inputRankAbbr) inputRankAbbr.value = 'Senhor';
      if (inputFullRank) inputFullRank.value = 'SENHOR';

      updatePhotoPreviewUI('', 'FT');
      populateReferenceAuthoritySelector('');

      modal.classList.remove('hidden');
      document.getElementById('input-add-name').focus();
    });

    btnClose.addEventListener('click', closeAuthorityModal);
    btnCancel.addEventListener('click', closeAuthorityModal);

    selectPos.addEventListener('change', () => {
      if (selectPos.value === 'after_id' || selectPos.value === 'before_id') {
        wrapperInsertAfter.classList.remove('hidden');
        populateReferenceAuthoritySelector(inputSearchRef ? inputSearchRef.value : '');
      } else {
        wrapperInsertAfter.classList.add('hidden');
      }
    });

    if (inputSearchRef) {
      inputSearchRef.addEventListener('input', (e) => {
        populateReferenceAuthoritySelector(e.target.value);
      });
    }

    if (selectRefAuth && inputInsertAfterId) {
      selectRefAuth.addEventListener('change', () => {
        const selectedAuth = state.authorities.find(
          (a) => String(a.id) === String(selectRefAuth.value)
        );
        if (selectedAuth && Number.isInteger(selectedAuth.order)) {
          inputInsertAfterId.value = String(selectedAuth.order);
        } else {
          inputInsertAfterId.value = '';
        }
      });
    }

    // Submissão do formulário (Inclusão Manual OU Edição de Autoridade Existente)
    formAdd.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('input-add-name').value.trim();
      if (!fullName) return;

      const rankSelectVal = document.getElementById('select-add-rank').value;
      const customRankAbbr = inputRankAbbr ? inputRankAbbr.value.trim() : '';
      const customFullRank = inputFullRank ? inputFullRank.value.trim() : '';

      const finalRankAbbr =
        customRankAbbr || (rankSelectVal !== 'Outro' ? RANK_ABBR_MAP[rankSelectVal] || rankSelectVal : '');
      const finalFullRank =
        (customFullRank || (rankSelectVal !== 'Outro' ? rankSelectVal : finalRankAbbr)).toUpperCase();

      const warName =
        document.getElementById('input-add-warname').value.trim() || fullName.split(' ').pop();
      const cargo = document.getElementById('input-add-cargo').value.trim();
      const posChoice = selectPos.value;

      let treatment = selectTreatment ? selectTreatment.value : '';
      if (!treatment) {
        const isFemale = rankSelectVal.includes('Senhora') || rankSelectVal.includes('Médica');
        treatment = isFemale ? 'SENHORA' : 'SENHOR';
      } else if (
        state.editingAuthorityId === null &&
        treatment === 'SENHOR' &&
        (rankSelectVal.includes('Senhora') || rankSelectVal.includes('Médica'))
      ) {
        treatment = 'SENHORA';
      }

      const rawAfterVal = inputInsertAfterId ? parseInt(inputInsertAfterId.value, 10) : NaN;
      const refAuthId = selectRefAuth ? selectRefAuth.value : null;

      // MODO EDIÇÃO
      if (state.editingAuthorityId !== null) {
        const item = state.authorities.find((a) => a.id === state.editingAuthorityId);
        if (!item) {
          closeAuthorityModal();
          return;
        }

        item.full_name = fullName.toUpperCase();
        item.war_name = warName.toUpperCase();
        item.rank_abbr = finalRankAbbr;
        item.full_rank = finalFullRank;
        item.cargo = cargo;
        item.treatment = treatment;
        item.photo = state.pendingPhotoDataUrl || '';

        if (posChoice && posChoice !== 'keep') {
          const orderInfo = computePrecedencePosition(
            posChoice,
            refAuthId,
            rawAfterVal,
            item.id
          );
          item.order = orderInfo.order;
          item.insertedAfterOrder = orderInfo.insertedAfterOrder;
          item.subOrder = orderInfo.subOrder;
        }

        state.authorities = window.CerimonialNominata.getSortedAuthorities(state.authorities);

        await persistState();
        closeAuthorityModal();
        renderCards();
        window.CerimonialNominata.renderNominata(state);
        window.showToast(`Autoridade atualizada: ${item.full_name}`);
        return;
      }

      // MODO INCLUSÃO MANUAL (AVULSO)
      state.manualCounter++;
      const maxExistingId = Math.max(...state.authorities.map((a) => Number(a.id) || 0), 1000);
      const newId = Math.max(1000 + state.manualCounter, maxExistingId + 1);

      const orderInfo = computePrecedencePosition(posChoice, refAuthId, rawAfterVal, null);

      const newAuth = {
        id: newId,
        order: orderInfo.order,
        insertedAfterOrder: orderInfo.insertedAfterOrder,
        subOrder: orderInfo.subOrder,
        rank_abbr: finalRankAbbr,
        full_rank: finalFullRank,
        war_name: warName.toUpperCase(),
        full_name: fullName.toUpperCase(),
        cargo: cargo,
        treatment: treatment,
        present: true, // Cadastrado manualmente entra presente por padrão
        isManual: true,
        checkedTime: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        photo: state.pendingPhotoDataUrl || ''
      };

      state.authorities.push(newAuth);
      state.authorities = window.CerimonialNominata.getSortedAuthorities(state.authorities);

      await persistState();
      closeAuthorityModal();
      renderCards();
      window.CerimonialNominata.renderNominata(state);
      window.showToast(`Autoridade avulsa adicionada: ${newAuth.full_name}`);
    });

    // =======================================================================
    // ETAPA 3: EVENTOS DE IMPORTAÇÃO E REVISÃO DO CARÔMETRO PDF
    // =======================================================================
    const btnImportPdf = document.getElementById('btn-import-pdf-carometro');
    const inputImportPdf = document.getElementById('input-import-pdf-carometro');
    const modalPdfLoading = document.getElementById('modal-pdf-loading');
    const pdfLoadingMsg = document.getElementById('pdf-loading-message');
    const pdfLoadingBar = document.getElementById('pdf-loading-bar');

    if (btnImportPdf && inputImportPdf) {
      btnImportPdf.addEventListener('click', () => {
        inputImportPdf.value = '';
        inputImportPdf.click();
      });

      inputImportPdf.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (modalPdfLoading) modalPdfLoading.classList.remove('hidden');
        if (pdfLoadingMsg) pdfLoadingMsg.textContent = `Analisando arquivo "${file.name}"...`;
        if (pdfLoadingBar) pdfLoadingBar.style.width = '15%';

        try {
          const result = await window.CerimonialPdfImporter.extractFromPdfFile(file, (prog) => {
            if (pdfLoadingMsg && prog.message) {
              pdfLoadingMsg.textContent = prog.message;
            }
            if (pdfLoadingBar && prog.totalPages) {
              const pct = Math.min(95, Math.round((prog.page / prog.totalPages) * 90));
              pdfLoadingBar.style.width = `${pct}%`;
            }
          });

          if (modalPdfLoading) modalPdfLoading.classList.add('hidden');
          openPdfReviewModal(result);
        } catch (err) {
          if (modalPdfLoading) modalPdfLoading.classList.add('hidden');
          window.showToast(err.message || 'Erro ao ler o arquivo PDF selecionado.', 'error');
        }
      });
    }

    // Nome do evento editável na tela de revisão
    const inputReviewEventName = document.getElementById('input-review-event-name');
    const previewReviewBadge = document.getElementById('preview-review-event-badge');
    if (inputReviewEventName) {
      inputReviewEventName.addEventListener('input', (e) => {
        const val = String(e.target.value || '').trim().toUpperCase();
        if (state.pdfReview) {
          state.pdfReview.eventName = val || 'EVENTO CERIMONIAL';
        }
        if (previewReviewBadge) {
          previewReviewBadge.textContent = val || 'EVENTO CERIMONIAL';
        }
      });
    }

    // Filtros na tela de revisão
    document.querySelectorAll('.review-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state.pdfReview) return;
        const filterVal = btn.getAttribute('data-review-filter') || 'all';
        state.pdfReview.filter = filterVal;

        document.querySelectorAll('.review-filter-btn').forEach((b) => {
          b.className = 'review-filter-btn px-2.5 py-1 rounded-md font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
        });
        btn.className = 'review-filter-btn px-2.5 py-1 rounded-md font-semibold bg-[#0B1D3A] text-white transition';
        renderPdfReviewList();
      });
    });

    // Adicionar manualmente autoridade não identificada na tela de revisão
    const btnReviewAddItem = document.getElementById('btn-review-add-item');
    if (btnReviewAddItem) {
      btnReviewAddItem.addEventListener('click', () => {
        if (!state.pdfReview) return;
        const newOrder = state.pdfReview.items.length + 1;
        state.pdfReview.items.push({
          tempId: `rev_manual_${Date.now()}`,
          pageNumber: state.pdfReview.numPages || 1,
          order: newOrder,
          rank_abbr: 'Senhor',
          full_rank: 'SENHOR',
          war_name: '',
          full_name: '',
          cargo: '',
          treatment: 'SENHOR',
          photo: '',
          candidatePhoto: '',
          photoConfidence: 'missing',
          photoConfirmedManually: false,
          rawLines: []
        });
        state.pdfReview.filter = 'all';
        renderPdfReviewList();
        const container = document.getElementById('review-items-container');
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    }

    // Upload de foto individual para uma linha na tela de revisão
    const inputReviewRowPhoto = document.getElementById('input-review-row-photo');
    if (inputReviewRowPhoto) {
      inputReviewRowPhoto.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file || !state.pdfReview) return;
        const targetIdx = state.pdfReview.photoTargetIndex;
        if (targetIdx === null || !state.pdfReview.items[targetIdx]) return;

        try {
          const compressed = await window.CerimonialPhotoUtils.processImageFile(file);
          state.pdfReview.items[targetIdx].photo = compressed;
          state.pdfReview.items[targetIdx].photoConfidence = 'high';
          state.pdfReview.items[targetIdx].photoConfirmedManually = true;
          renderPdfReviewList();
          window.showToast('Fotografia associada ao registro na revisão.');
        } catch (err) {
          window.showToast(err.message || 'Erro ao carregar foto na revisão.', 'error');
        }
      });
    }

    // Cancelar importação de PDF
    const btnClosePdfReview = document.getElementById('btn-close-pdf-review');
    const btnCancelPdfReview = document.getElementById('btn-cancel-pdf-review');
    if (btnClosePdfReview) btnClosePdfReview.addEventListener('click', cancelPdfReview);
    if (btnCancelPdfReview) btnCancelPdfReview.addEventListener('click', cancelPdfReview);

    // Avançar para confirmação final de substituição do carômetro (gerando backup prévio obrigatório)
    const btnProceedReplace = document.getElementById('btn-proceed-replace-carometro');
    const modalConfirmReplace = document.getElementById('modal-confirm-replace-carometro');
    const btnCancelFinalReplace = document.getElementById('btn-cancel-final-replace');
    const btnExecuteFinalReplace = document.getElementById('btn-execute-final-replace');
    const btnDownloadPreReplaceBackup = document.getElementById('btn-download-pre-replace-backup');
    const replaceSummaryEl = document.getElementById('replace-carometro-summary');
    const replaceBackupStatusEl = document.getElementById('replace-backup-status-text');

    if (btnProceedReplace && modalConfirmReplace) {
      btnProceedReplace.addEventListener('click', () => {
        if (!state.pdfReview) return;

        const validItems = state.pdfReview.items.filter(
          (it) => String(it.full_name || it.war_name || '').trim().length > 0
        );

        if (validItems.length === 0) {
          window.showToast(
            'Inclua ou preencha ao menos uma autoridade válida antes de substituir o carômetro.',
            'warning'
          );
          return;
        }

        const newEventName =
          String(
            (inputReviewEventName && inputReviewEventName.value) || state.pdfReview.eventName || 'EVENTO CERIMONIAL'
          )
            .trim()
            .toUpperCase() || 'EVENTO CERIMONIAL';
        state.pdfReview.eventName = newEventName;

        // 1. Se já existir um evento carregado no dispositivo, gerar automaticamente o backup JSON recuperável antes da substituição
        if (state.authorities.length > 0) {
          const backupResult = window.CerimonialDB.exportBackupJSON(
            state.authorities,
            state.manualCounter,
            state.eventName,
            state.sourcePdfName,
            { prefix: 'Backup_Pre_Substituicao_BAGL', silent: true }
          );
          state.pdfReview.preReplaceBackupGenerated = !!(backupResult && backupResult.success);
          state.pdfReview.preReplaceBackupFilename = (backupResult && backupResult.filename) || '';
        } else {
          state.pdfReview.preReplaceBackupGenerated = true;
          state.pdfReview.preReplaceBackupFilename = 'Base inicial vazia (nenhum evento anterior a substituir)';
        }

        if (replaceSummaryEl) {
          if (state.authorities.length > 0) {
            replaceSummaryEl.innerHTML = `O carômetro atual (<strong>BAGL • ${state.eventName}</strong>, com ${state.authorities.length} registros) será substituído pelo novo evento <strong>BAGL • ${newEventName}</strong> contendo <strong>${validItems.length} autoridades</strong>.<br>Todas as autoridades iniciarão com <strong>zero presenças</strong>.`;
          } else {
            replaceSummaryEl.innerHTML = `O novo carômetro do evento <strong>BAGL • ${newEventName}</strong> contendo <strong>${validItems.length} autoridades</strong> será carregado neste dispositivo.<br>Todas as autoridades iniciarão com <strong>zero presenças</strong>.`;
          }
        }

        if (replaceBackupStatusEl) {
          if (state.authorities.length === 0) {
            replaceBackupStatusEl.innerHTML = `Não havia carômetro anterior carregado neste dispositivo. Pronto para gravar o novo evento.`;
          } else if (state.pdfReview.preReplaceBackupGenerated) {
            replaceBackupStatusEl.innerHTML = `Backup automático gerado: <strong>${state.pdfReview.preReplaceBackupFilename}</strong> (${state.authorities.length} registros preservados).`;
          } else {
            replaceBackupStatusEl.innerHTML = `Clique no botão abaixo para salvar o backup do evento atual antes de prosseguir.`;
          }
        }

        modalConfirmReplace.classList.remove('hidden');
      });
    }

    if (btnDownloadPreReplaceBackup) {
      btnDownloadPreReplaceBackup.addEventListener('click', () => {
        const res = window.CerimonialDB.exportBackupJSON(
          state.authorities,
          state.manualCounter,
          state.eventName,
          state.sourcePdfName,
          { prefix: 'Backup_Pre_Substituicao_BAGL' }
        );
        if (state.pdfReview && res && res.success) {
          state.pdfReview.preReplaceBackupGenerated = true;
          state.pdfReview.preReplaceBackupFilename = res.filename;
        }
      });
    }

    if (btnCancelFinalReplace && modalConfirmReplace) {
      btnCancelFinalReplace.addEventListener('click', () => {
        modalConfirmReplace.classList.add('hidden');
      });
    }

    if (btnExecuteFinalReplace) {
      btnExecuteFinalReplace.addEventListener('click', async () => {
        if (!state.pdfReview) return;

        // Garantir que o backup prévio foi gerado e confirmado antes de substituir
        if (!state.pdfReview.preReplaceBackupGenerated) {
          const retryBackup = window.CerimonialDB.exportBackupJSON(
            state.authorities,
            state.manualCounter,
            state.eventName,
            state.sourcePdfName,
            { prefix: 'Backup_Pre_Substituicao_BAGL', silent: true }
          );
          if (!retryBackup || !retryBackup.success) {
            window.showToast(
              'Por segurança, não foi possível gerar o backup do evento anterior. Exporte o backup manualmente antes de substituir.',
              'error'
            );
            return;
          }
          state.pdfReview.preReplaceBackupGenerated = true;
        }

        const validItems = state.pdfReview.items.filter(
          (it) => String(it.full_name || it.war_name || '').trim().length > 0
        );

        try {
          const replaced = await window.CerimonialDB.replaceCarometroTransaction(
            validItems,
            state.pdfReview.eventName,
            state.pdfReview.filename
          );

          state.authorities = window.CerimonialNominata.getSortedAuthorities(replaced.authorities);
          state.manualCounter = 0;
          state.eventName = replaced.eventName;
          state.sourcePdfName = replaced.sourcePdfName;
          state.filter = 'all';
          state.searchQuery = '';
          state.pdfReview = null;

          const modalReview = document.getElementById('modal-pdf-review');
          if (modalConfirmReplace) modalConfirmReplace.classList.add('hidden');
          if (modalReview) modalReview.classList.add('hidden');

          updateCounters();
          renderCards();
          window.CerimonialNominata.renderNominata(state);
          window.showToast(
            `Novo carômetro confirmado: BAGL • ${state.eventName} (${state.authorities.length} autoridades, 0 presentes)!`,
            'success'
          );
        } catch (err) {
          console.error('Erro ao substituir carômetro:', err);
          window.showToast(
            err.message || 'Falha ao substituir carômetro. O evento anterior foi mantido.',
            'error'
          );
        }
      });
    }
  }

  // Inicialização da aplicação
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      const loaded = await window.CerimonialDB.loadState();
      state.authorities = window.CerimonialNominata.getSortedAuthorities(loaded.authorities || []);
      state.manualCounter = loaded.manualCounter || 0;
      state.eventName = loaded.eventName || 'EVENTO CERIMONIAL';
      state.sourcePdfName = loaded.sourcePdfName || '';
    } catch (err) {
      console.error('Erro ao inicializar dados:', err);
      window.showToast('Erro ao carregar banco de dados local.', 'error');
    }

    setupEvents();
    updateCounters();
    renderCards();
    window.CerimonialNominata.renderNominata(state);
    if (window.CerimonialPWA && typeof window.CerimonialPWA.initPWA === 'function') {
      window.CerimonialPWA.initPWA();
    }
  });
})();
