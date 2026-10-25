/**
 * Cerimonial BAGL - Geração, Cópia, Exportação Word e Impressão A4 da Nominata Oficial
 */
window.CerimonialNominata = (function () {
  // Texto da nominata é exibido via innerHTML: evita interpretar trechos de PDF como marcação.
  function htmlSafe(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  /**
   * Formata a linha cerimonial de uma autoridade
   */
  function formatNominataLine(item) {
    const treatment = (item.treatment || 'SENHOR').trim().toUpperCase();
    const rawRank = (item.full_rank || item.rank_abbr || '').trim();
    const name = item.full_name || item.war_name;
    const cargo = (item.cargo || '').trim();

    // Evita duplicação caso o posto de civil seja igual ao próprio tratamento (ex: "SENHOR" + "SENHOR")
    const rank =
      rawRank.toUpperCase() === treatment ||
      rawRank.toUpperCase() === 'SENHOR' ||
      rawRank.toUpperCase() === 'SENHORA'
        ? ''
        : rawRank;

    let text = '';
    if (cargo) {
      text = rank
        ? `${treatment} ${cargo.toUpperCase()}, ${rank} ${name}.`
        : `${treatment} ${cargo.toUpperCase()}, ${name}.`;
    } else {
      text = rank ? `${treatment} ${rank} ${name}.` : `${treatment} ${name}.`;
    }

    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Retorna as autoridades estritamente na ordem de precedência (e desempate estável)
   */
  function getSortedAuthorities(authorities) {
    return [...authorities].sort((a, b) => {
      const diff = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (Math.abs(diff) > 1e-6) return diff;
      const subDiff = (Number(a.subOrder) || 0) - (Number(b.subOrder) || 0);
      if (subDiff !== 0) return subDiff;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  }

  /**
   * Obtém os títulos cerimoniais do cabeçalho do documento da Nominata
   * mantendo o padrão da OMA 2026 ou refletindo o evento importado.
   */
  function getEventTitles(state) {
    const ev = String((state && state.eventName) || 'OMA 2026').trim().toUpperCase();
    if (!ev || ev === 'OMA 2026' || ev.includes('ORDEM DO MÉRITO AERONÁUTICO')) {
      return {
        shortTitle: 'OMA 2026',
        line1: 'DIA DA FORÇA AÉREA BRASILEIRA E DIA DO AVIADOR',
        line2: 'ENTREGA DA ORDEM DO MÉRITO AERONÁUTICO 2026'
      };
    }
    return {
      shortTitle: ev,
      line1: 'SOLENIDADE MILITAR — BASE AÉREA DO GALEÃO',
      line2: ev
    };
  }

  /**
   * Renderiza a visualização A4 da Nominata na tela
   */
  function renderNominata(state) {
    const listContainer = document.getElementById('nominata-content-list');
    const footerLegend = document.getElementById('nominata-footer-legend');
    if (!listContainer || !footerLegend) return;

    const titles = getEventTitles(state);
    const sub1 = document.getElementById('nominata-doc-subtitle-1');
    const sub2 = document.getElementById('nominata-doc-subtitle-2');
    if (sub1) sub1.textContent = titles.line1;
    if (sub2) sub2.textContent = titles.line2;

    const sortedAuthorities = getSortedAuthorities(state.authorities);

    let itemsToDisplay = [];
    if (state.nominataMode === 'present_only') {
      itemsToDisplay = sortedAuthorities.filter((a) => a.present);
      footerLegend.classList.add('hidden');
    } else {
      itemsToDisplay = sortedAuthorities;
      footerLegend.classList.remove('hidden');
    }

    if (itemsToDisplay.length === 0) {
      listContainer.innerHTML = `
        <div class="text-center py-12 text-slate-400">
          <p class="font-medium text-base">Nenhuma autoridade marcada como presente até o momento.</p>
          <p class="text-xs mt-1 text-slate-500">Volte para a Chamada Visual e marque presença nas autoridades que chegarem.</p>
        </div>
      `;
      return;
    }

    const html = itemsToDisplay
      .map((item) => {
        const lineText = formatNominataLine(item);

        if (state.nominataMode === 'present_only') {
          return `
            <div class="flex items-start gap-2 text-justify">
              <span class="font-bold select-none text-slate-800 leading-normal">•</span>
              <div class="flex-1 font-serif-doc text-slate-900 leading-relaxed tracking-wide font-medium">
                ${htmlSafe(lineText)}
              </div>
            </div>
          `;
        } else {
          const isPres = item.present;
          const bgHighlight = isPres
            ? 'bg-yellow-200 text-slate-950 font-bold px-1.5 py-0.5 rounded'
            : 'text-slate-800';
          const marker = isPres ? ' <span class="font-black text-slate-900">&lt;-</span>' : '';

          return `
            <div class="flex items-start gap-2 text-justify">
              <span class="font-bold select-none text-slate-800 leading-normal">•</span>
              <div class="flex-1 font-serif-doc leading-relaxed tracking-wide ${bgHighlight}">
                ${htmlSafe(lineText)}${marker}
              </div>
            </div>
          `;
        }
      })
      .join('');

    listContainer.innerHTML = html;
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      window.showToast('Nominata copiada para a área de transferência!');
    } catch (e) {
      window.showToast('Não foi possível copiar automaticamente.', 'error');
    }
    document.body.removeChild(ta);
  }

  /**
   * Copia o texto formatado da Nominata para a área de transferência
   */
  function copyNominataText(state) {
    const sorted = getSortedAuthorities(state.authorities);
    const items =
      state.nominataMode === 'present_only' ? sorted.filter((a) => a.present) : sorted;

    if (items.length === 0) {
      window.showToast('Nenhum item para copiar.', 'warning');
      return;
    }

    const titles = getEventTitles(state);
    const header = `COMANDO DA AERONÁUTICA\nCOMANDO DE PREPARO\nBAGL\n\n${titles.line1}\n${titles.line2}\n\n`;
    const body = items
      .map((item) => {
        const line = formatNominataLine(item);
        if (state.nominataMode === 'full_annotated' && item.present) {
          return `• ${line} <-`;
        }
        return `• ${line}`;
      })
      .join('\n');

    const fullText = header + body;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(fullText)
        .then(() => {
          window.showToast('Nominata copiada para a área de transferência!');
        })
        .catch(() => fallbackCopy(fullText));
    } else {
      fallbackCopy(fullText);
    }
  }

  /**
   * Imprime ou salva em PDF a Nominata Oficial
   */
  function printNominata(state) {
    const sorted = getSortedAuthorities(state.authorities);
    const items =
      state.nominataMode === 'present_only' ? sorted.filter((a) => a.present) : sorted;

    if (items.length === 0) {
      window.showToast('Nenhuma autoridade selecionada para impressão.', 'warning');
      return;
    }

    const isAnnotated = state.nominataMode === 'full_annotated';
    const titles = getEventTitles(state);

    const itemsHtml = items
      .map((item) => {
        const line = formatNominataLine(item);
        if (isAnnotated) {
          const mark = item.present ? ' <strong style="color: #000;">&lt;-</strong>' : '';
          const bg = item.present
            ? 'background-color: #fef08a; padding: 2px 4px; border-radius: 2px;'
            : '';
          return `<div style="margin-bottom: 11px; text-align: justify; text-justify: inter-word; line-height: 1.5; font-size: 11.5pt; ${bg}">• ${line}${mark}</div>`;
        }
        return `<div style="margin-bottom: 11px; text-align: justify; text-justify: inter-word; line-height: 1.5; font-size: 11.5pt;">• ${line}</div>`;
      })
      .join('\n');

    const printHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Nominata Oficial - ${titles.shortTitle}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 20mm 20mm 20mm;
    }
    body {
      font-family: 'Times New Roman', Times, serif;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .container {
      max-width: 760px;
      margin: 0 auto;
      padding: 15px;
    }
    .header {
      text-align: center;
      margin-bottom: 25px;
      padding-bottom: 12px;
      border-bottom: 1px solid #111;
    }
    .header .inst {
      font-size: 11pt;
      font-weight: bold;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .header .sub {
      font-size: 10pt;
      font-weight: bold;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .header .event {
      font-size: 11pt;
      font-weight: bold;
      text-transform: uppercase;
      margin-top: 10px;
      letter-spacing: 0.5px;
    }
    .list {
      margin-top: 15px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 10px;
      border-top: 1px solid #999;
      font-size: 9pt;
      color: #444;
      display: flex;
      justify-content: space-between;
    }
    .no-print-bar {
      background: #0B1D3A;
      color: white;
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .btn-action {
      background: #10B981;
      color: white;
      border: none;
      padding: 7px 16px;
      border-radius: 6px;
      font-weight: bold;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-action:hover {
      background: #059669;
    }
    .btn-close {
      background: #4B5563;
      color: white;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      margin-left: 8px;
    }
    @media print {
      .no-print-bar {
        display: none !important;
      }
      .container {
        padding: 0 !important;
      }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <div><strong>Nominata Oficial - ${titles.shortTitle}</strong> (${items.length} autoridades)</div>
    <div>
      <button class="btn-action" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
      <button class="btn-close" onclick="window.close()">Fechar</button>
    </div>
  </div>

  <div class="container">
    <div class="header">
      <div class="inst">Comando da Aeronáutica</div>
      <div class="sub">Comando de Preparo</div>
      <div class="inst">BAGL</div>
      <div class="event">${titles.line1}</div>
      <div class="event">${titles.line2}</div>
    </div>

    <div class="list">
      ${itemsHtml}
    </div>

    <div class="footer">
      <div>${isAnnotated ? 'Legenda: &lt;- Presença confirmada' : 'Nominata Oficial dos Presentes em Ordem de Precedência'}</div>
      <div>Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • BAGL</div>
    </div>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        try {
          window.print();
        } catch(e) {
          console.error(e);
        }
      }, 500);
    });
  <\/script>
</body>
</html>`;

    try {
      const blob = new Blob([printHtml], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, '_blank');
      if (printWindow) {
        window.showToast('Janela de impressão aberta! Salve como PDF ou Imprima.');
        return;
      }
    } catch (err) {
      console.warn('Window open blob error:', err);
    }

    try {
      const blob = new Blob([printHtml], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Nominata_Oficial_OMA_2026.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.showToast('Pop-up bloqueado: arquivo HTML baixado para impressão!');
    } catch (e) {
      try {
        window.print();
      } catch (errPrint) {
        window.showToast('Use o botão "Baixar Word (.doc)" ou "Copiar Texto"!', 'warning');
      }
    }
  }

  /**
   * Exporta documento Word (.doc) compatível com Microsoft Word e LibreOffice
   */
  function downloadWordDoc(state) {
    const sorted = getSortedAuthorities(state.authorities);
    const items =
      state.nominataMode === 'present_only' ? sorted.filter((a) => a.present) : sorted;

    if (items.length === 0) {
      window.showToast('Nenhuma autoridade selecionada para exportação.', 'warning');
      return;
    }

    const isAnnotated = state.nominataMode === 'full_annotated';
    const titles = getEventTitles(state);
    const linesHtml = items
      .map((item) => {
        const line = formatNominataLine(item);
        if (isAnnotated) {
          const mark = item.present ? ' <b>&lt;-</b>' : '';
          const bg = item.present ? 'background-color:#ffff99;' : '';
          return `<p style="margin:0 0 9pt 0; text-align:justify; font-family:'Times New Roman',serif; font-size:12pt; ${bg}">• ${line}${mark}</p>`;
        }
        return `<p style="margin:0 0 9pt 0; text-align:justify; font-family:'Times New Roman',serif; font-size:12pt;">• ${line}</p>`;
      })
      .join('\n');

    const wordDoc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset="utf-8">
  <title>Nominata Oficial - OMA 2026</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page {
      size: 21cm 29.7cm;
      margin: 2cm 2.5cm 2cm 2.5cm;
      mso-page-orientation: portrait;
    }
    body {
      font-family: 'Times New Roman', serif;
      font-size: 12pt;
      line-height: 1.4;
      color: #000;
    }
    .header-box {
      text-align: center;
      margin-bottom: 25pt;
    }
    .inst-title {
      font-weight: bold;
      font-size: 11pt;
      text-transform: uppercase;
      letter-spacing: 1.5pt;
      margin: 0;
    }
    .event-title {
      font-weight: bold;
      font-size: 11pt;
      text-transform: uppercase;
      margin-top: 10pt;
    }
    .footer-box {
      margin-top: 30pt;
      padding-top: 10pt;
      border-top: 1pt solid #888;
      font-size: 9.5pt;
      color: #555;
    }
  </style>
</head>
<body>
  <div class="header-box">
    <p class="inst-title">COMANDO DA AERONÁUTICA</p>
    <p class="inst-title">COMANDO DE PREPARO</p>
    <p class="inst-title">BAGL</p>
    <p class="event-title">${titles.line1}</p>
    <p class="event-title">${titles.line2}</p>
  </div>

  <div class="content-box">
    ${linesHtml}
  </div>

  <div class="footer-box">
    <p>${isAnnotated ? 'Legenda: &lt;- Presença confirmada' : 'Nominata Oficial dos Presentes em Ordem de Precedência Protocolar'}</p>
    <p>Documento gerado pelo Cerimonial em ${new Date().toLocaleDateString('pt-BR')} • BAGL</p>
  </div>
</body>
</html>`;

    const blob = new Blob(['\ufeff' + wordDoc], { type: 'application/msword;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Nominata_Oficial_OMA_2026.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.showToast('Documento Word (.doc) baixado com sucesso!');
  }

  return {
    formatNominataLine,
    getSortedAuthorities,
    renderNominata,
    copyNominataText,
    printNominata,
    downloadWordDoc
  };
})();
