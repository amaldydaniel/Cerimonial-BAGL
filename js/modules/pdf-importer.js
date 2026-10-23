/**
 * Cerimonial BAGL - Importador de Carômetros PDF (Processamento Local + Associação Espacial 2D)
 *
 * Responsabilidades:
 * 1. Ler arquivos PDF localmente via PDF.js sem uso de serviços externos.
 * 2. Extrair itens de texto com coordenadas espaciais (x, y, width, height, fontSize) em cada página.
 * 3. Extrair fotografias renderizadas na página com seus retângulos delimitadores (bounding boxes) exatos
 *    via rastreamento da matriz de transformação (CTM) na OperatorList do PDF.js e recorte em Canvas.
 * 4. Segmentar blocos de autoridades preservando a sequência visual do documento (topo->base, esquerda->direita).
 * 5. Associar espacialmente cada fotografia à respectiva autoridade usando distância geométrica e alinhamento 2D,
 *    nunca confiando apenas na ordem bruta do fluxo de objetos de imagem do PDF.
 * 6. Sinalizar registros com associação de foto duvidosa, dados incompletos ou duplicidades para conferência manual.
 */
window.CerimonialPdfImporter = (function () {
  // Configurar o worker local do PDF.js quando disponível no navegador
  function configurePdfWorker() {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
      if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/libs/pdf.worker.min.js';
      }
    }
  }

  /**
   * Multiplica duas matrizes afins 2D de 6 elementos [a, b, c, d, e, f]
   */
  function multiplyMatrix(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  /**
   * Aplica uma matriz afim [a, b, c, d, e, f] ao ponto (x, y)
   */
  function applyMatrixToPoint(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  /**
   * Converte um retângulo unitário [0,1]x[0,1] transformado pela matriz CTM do PDF
   * para coordenadas de Viewport (origem no canto superior esquerdo, em pixels na escala 1.0).
   */
  function computeViewportBoxFromCtm(ctm, viewport) {
    // No PDF, imagens XObject são desenhadas no quadrado unitário (0,0)-(1,1) no espaço do usuário
    const cornersPdf = [
      applyMatrixToPoint(ctm, 0, 0),
      applyMatrixToPoint(ctm, 1, 0),
      applyMatrixToPoint(ctm, 0, 1),
      applyMatrixToPoint(ctm, 1, 1)
    ];

    const cornersVp = cornersPdf.map(([px, py]) => {
      if (viewport && typeof viewport.convertToViewportPoint === 'function') {
        return viewport.convertToViewportPoint(px, py);
      }
      const pageH = (viewport && viewport.height) || 842;
      return [px, pageH - py];
    });

    const xs = cornersVp.map((p) => p[0]);
    const ys = cornersVp.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  /**
   * Extrai todas as caixas de imagem (com coordenadas espaciais e Data URL recortado da página renderizada)
   */
  async function extractPageImages(page, viewportScale1) {
    const pageWidth = viewportScale1.width || 595;
    const pageHeight = viewportScale1.height || 842;

    // 1. Caso de suporte direto para mocks/testes estruturados que já fornecem getExtractedImages()
    if (typeof page.getExtractedImages === 'function') {
      const mockImgs = await page.getExtractedImages();
      return (mockImgs || []).map((img, idx) => ({
        id: `p${page.pageNumber || 1}_img_${idx + 1}`,
        pageNumber: page.pageNumber || 1,
        streamIndex: idx,
        x: Number(img.x) || 0,
        y: Number(img.y) || 0,
        width: Number(img.width) || 60,
        height: Number(img.height) || 80,
        centerX: (Number(img.x) || 0) + (Number(img.width) || 60) / 2,
        centerY: (Number(img.y) || 0) + (Number(img.height) || 80) / 2,
        dataUrl: img.dataUrl || ''
      }));
    }

    if (typeof page.getOperatorList !== 'function') {
      return [];
    }

    const opList = await page.getOperatorList();
    const OPS = (window.pdfjsLib && window.pdfjsLib.OPS) || {
      save: 10,
      restore: 11,
      transform: 12,
      paintInlineImageXObject: 83,
      paintImageXObject: 85,
      paintJpegXObject: 82,
      paintImageMaskXObject: 86
    };

    const rawBoxes = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const ctmStack = [];

    const fnArray = opList.fnArray || [];
    const argsArray = opList.argsArray || [];

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === OPS.save) {
        ctmStack.push([...ctm]);
      } else if (fn === OPS.restore) {
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop();
        }
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = multiplyMatrix(ctm, args);
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintJpegXObject ||
        fn === OPS.paintInlineImageXObject
      ) {
        const box = computeViewportBoxFromCtm(ctm, viewportScale1);
        // Filtrar imagens decorativas minúsculas (< 22px), linhas finas, ou planos de fundo de página inteira (> 75% da página)
        const aspect = box.height > 0 ? box.width / box.height : 0;
        const isTooSmall = box.width < 22 || box.height < 25;
        const isFullPageBg = box.width > pageWidth * 0.72 && box.height > pageHeight * 0.72;
        const isBannerOrLine = aspect > 3.2 || aspect < 0.25;

        if (!isTooSmall && !isFullPageBg && !isBannerOrLine) {
          rawBoxes.push({
            streamIndex: rawBoxes.length,
            objId: args && args[0] ? String(args[0]) : `inline_${i}`,
            inlineData: fn === OPS.paintInlineImageXObject ? args && args[0] : null,
            ...box
          });
        }
      }
    }

    // Deduplicar caixas sobrepostas (ex: máscara de imagem + imagem principal no mesmo lugar)
    const uniqueBoxes = [];
    for (const b of rawBoxes) {
      const duplicate = uniqueBoxes.find(
        (u) =>
          Math.abs(u.centerX - b.centerX) < 8 &&
          Math.abs(u.centerY - b.centerY) < 8 &&
          Math.abs(u.width - b.width) < 12
      );
      if (!duplicate) {
        uniqueBoxes.push(b);
      }
    }

    // Renderizar a página em um canvas offscreen (escala 2.0 para nitidez dos retratos) e recortar cada caixa
    let renderedCanvas = null;
    const renderScale = 2.0;

    if (typeof document !== 'undefined' && typeof page.render === 'function') {
      try {
        const viewportHigh = page.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewportHigh.width);
        canvas.height = Math.ceil(viewportHigh.height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: viewportHigh }).promise;
          renderedCanvas = canvas;
        }
      } catch (renderErr) {
        console.warn('Aviso: Não foi possível renderizar canvas da página PDF:', renderErr);
      }
    }

    const extractedImages = [];
    for (let idx = 0; idx < uniqueBoxes.length; idx++) {
      const box = uniqueBoxes[idx];
      let dataUrl = '';

      if (renderedCanvas) {
        try {
          const sx = Math.max(0, Math.floor(box.x * renderScale));
          const sy = Math.max(0, Math.floor(box.y * renderScale));
          const sw = Math.min(renderedCanvas.width - sx, Math.ceil(box.width * renderScale));
          const sh = Math.min(renderedCanvas.height - sy, Math.ceil(box.height * renderScale));

          if (sw > 10 && sh > 10) {
            const cropCanvas = document.createElement('canvas');
            // Limitar tamanho máximo do retrato a 240x300 para manter o IndexedDB leve e rápido
            const maxW = 240;
            const maxH = 300;
            const scaleDown = Math.min(1, maxW / sw, maxH / sh);
            cropCanvas.width = Math.max(1, Math.round(sw * scaleDown));
            cropCanvas.height = Math.max(1, Math.round(sh * scaleDown));
            const cropCtx = cropCanvas.getContext('2d');
            if (cropCtx) {
              cropCtx.fillStyle = '#FFFFFF';
              cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
              cropCtx.drawImage(
                renderedCanvas,
                sx,
                sy,
                sw,
                sh,
                0,
                0,
                cropCanvas.width,
                cropCanvas.height
              );
              dataUrl = cropCanvas.toDataURL('image/jpeg', 0.84);
            }
          }
        } catch (cropErr) {
          console.warn('Erro ao recortar foto da página:', cropErr);
        }
      }

      extractedImages.push({
        id: `p${page.pageNumber || 1}_img_${idx + 1}`,
        pageNumber: page.pageNumber || 1,
        streamIndex: box.streamIndex,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        centerX: box.centerX,
        centerY: box.centerY,
        dataUrl: dataUrl
      });
    }

    return extractedImages;
  }

  /**
   * Verifica se uma linha de texto é cabeçalho/rodapé institucional de página e deve ser ignorada
   */
  function isHeaderOrFooterNoise(str, y, pageHeight) {
    const clean = String(str || '').trim();
    if (!clean) return true;

    // Número de página isolado no topo ou rodapé
    if (/^(p[aá]g(?:ina)?\.?\s*)?\d+(\s*de\s*\d+|\s*\/\s*\d+)?$/i.test(clean)) {
      if (y < 75 || y > pageHeight - 75) return true;
    }

    // Títulos institucionais de topo de página de carômetro
    const upper = clean.toUpperCase();
    if (
      y < 95 &&
      (upper === 'MINISTÉRIO DA DEFESA' ||
        upper === 'COMANDO DA AERONÁUTICA' ||
        upper === 'BASE AÉREA DO GALEÃO' ||
        upper === 'CERIMONIAL BAGL' ||
        upper.startsWith('CARÔMETRO ') ||
        upper.startsWith('CAROMETRO ') ||
        upper === 'CARÔMETRO DE AUTORIDADES' ||
        upper === 'RELAÇÃO DE AUTORIDADES')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Extrai itens de texto normalizados em coordenadas de Viewport (origem no topo-esquerdo)
   */
  async function extractPageTextItems(page, viewportScale1) {
    const textContent = await page.getTextContent();
    const rawItems = (textContent && textContent.items) || [];
    const pageHeight = viewportScale1.height || 842;

    const items = [];
    for (const item of rawItems) {
      const str = String(item.str || '').replace(/\s+/g, ' ').trim();
      if (!str) continue;

      const tr = item.transform || [1, 0, 0, 1, 0, 0];
      const tx = Number(tr[4]) || 0;
      const ty = Number(tr[5]) || 0;
      const fontSize = Math.max(6, Math.abs(Number(tr[3]) || Number(tr[0]) || item.height || 10));

      let vx = tx;
      let vy = pageHeight - ty;
      if (viewportScale1 && typeof viewportScale1.convertToViewportPoint === 'function') {
        const pt = viewportScale1.convertToViewportPoint(tx, ty);
        vx = pt[0];
        vy = pt[1];
      }

      const width = Number(item.width) || str.length * (fontSize * 0.52);
      const height = Number(item.height) || fontSize * 1.15;
      // vy da baseline para o topo aproximado da caixa de texto
      const topY = vy - fontSize * 0.85;

      if (isHeaderOrFooterNoise(str, topY, pageHeight)) {
        continue;
      }

      items.push({
        str,
        x: vx,
        y: topY,
        width,
        height,
        right: vx + width,
        bottom: topY + height,
        fontSize
      });
    }

    return items;
  }

  /**
   * Agrupa fragmentos de texto na mesma linha horizontal e, em seguida, agrupa linhas
   * pertencentes ao mesmo cartão/bloco de autoridade, respeitando colunas e linhas visuais.
   */
  function segmentAuthorityBlocks(textItems, pageNumber) {
    if (!textItems || textItems.length === 0) return [];

    // 1. Ordenar fragmentos por Y e depois X
    const sortedFragments = [...textItems].sort((a, b) => {
      if (Math.abs(a.y - b.y) <= 4) return a.x - b.x;
      return a.y - b.y;
    });

    // 2. Mesclar fragmentos muito próximos na mesma linha (mesmo Y aproximado e gap horizontal curto)
    const lines = [];
    for (const frag of sortedFragments) {
      let targetLine = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = lines[i];
        const yDiff = Math.abs(candidate.y - frag.y);
        if (yDiff > 6) break;
        const xGap = frag.x - candidate.right;
        // Só mescla se estiver na mesma coluna (gap horizontal <= 28px)
        if (yDiff <= 5 && xGap >= -8 && xGap <= 28) {
          targetLine = candidate;
          break;
        }
      }

      if (targetLine) {
        const needsSpace =
          !targetLine.text.endsWith(' ') && !frag.str.startsWith(' ') && frag.x - targetLine.right > 1.5;
        targetLine.text = `${targetLine.text}${needsSpace ? ' ' : ''}${frag.str}`.replace(/\s+/g, ' ').trim();
        targetLine.right = Math.max(targetLine.right, frag.right);
        targetLine.width = targetLine.right - targetLine.x;
        targetLine.bottom = Math.max(targetLine.bottom, frag.bottom);
        targetLine.height = targetLine.bottom - targetLine.y;
        targetLine.fontSize = Math.max(targetLine.fontSize, frag.fontSize);
      } else {
        lines.push({
          text: frag.str,
          x: frag.x,
          y: frag.y,
          width: frag.width,
          height: frag.height,
          right: frag.right,
          bottom: frag.bottom,
          fontSize: frag.fontSize
        });
      }
    }

    // 3. Agrupar linhas verticalmente próximas e alinhadas na mesma coluna em blocos de autoridade
    const blocks = [];
    const rankParser = window.CerimonialRankParser;

    for (const line of lines) {
      // Ignorar rótulos numéricos isolados (ex: "#1" ou "01") ou anexá-los como ordem explícita
      const explicitOrderMatch = line.text.match(/^#?(\d{1,3})[º°.]?$/);
      if (explicitOrderMatch) {
        continue;
      }

      const rankCheck = rankParser ? rankParser.parseRankAndWarName(line.text) : { matched: false };

      // Procurar bloco existente na mesma coluna logo acima desta linha
      let bestBlock = null;
      for (const blk of blocks) {
        const verticalGap = line.y - blk.bottom;
        const horizontalAlignDiff = Math.abs(line.x - blk.x);
        const horizontalOverlap =
          Math.min(line.right, blk.right) - Math.max(line.x, blk.x);

        const sameColumn = horizontalAlignDiff <= 45 || horizontalOverlap > 25;
        if (sameColumn && verticalGap >= -4 && verticalGap <= 20) {
          // Se a nova linha inicia um NOVO posto militar reconhecido e o bloco já possui ao menos 2 linhas (posto + nome), inicia um novo bloco!
          if (rankCheck.matched && blk.lines.length >= 2) {
            continue;
          }
          // Se o bloco já atingiu 5 linhas e a distância vertical é um pouco maior (> 12px), provavelmente é outro cartão
          if (blk.lines.length >= 5 && verticalGap > 12) {
            continue;
          }
          bestBlock = blk;
        }
      }

      if (bestBlock) {
        bestBlock.lines.push(line);
        bestBlock.x = Math.min(bestBlock.x, line.x);
        bestBlock.y = Math.min(bestBlock.y, line.y);
        bestBlock.right = Math.max(bestBlock.right, line.right);
        bestBlock.bottom = Math.max(bestBlock.bottom, line.bottom);
        bestBlock.width = bestBlock.right - bestBlock.x;
        bestBlock.height = bestBlock.bottom - bestBlock.y;
        bestBlock.centerX = (bestBlock.x + bestBlock.right) / 2;
        bestBlock.centerY = (bestBlock.y + bestBlock.bottom) / 2;
      } else {
        blocks.push({
          pageNumber,
          lines: [line],
          x: line.x,
          y: line.y,
          right: line.right,
          bottom: line.bottom,
          width: line.width,
          height: line.height,
          centerX: (line.x + line.right) / 2,
          centerY: (line.y + line.bottom) / 2
        });
      }
    }

    // 4. Ordenar os blocos na sequência visual de leitura da página:
    // Agrupar em faixas horizontais (tolerância Y de 32px para cartões na mesma linha da grade) e ordenar esquerda -> direita
    blocks.sort((a, b) => {
      if (Math.abs(a.y - b.y) <= 32) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });

    return blocks;
  }

  /**
   * Converte as linhas de texto de um bloco em campos estruturados de autoridade
   * (rank_abbr, full_rank, war_name, full_name, cargo, treatment)
   */
  function parseAuthorityBlockFields(block) {
    const rankParser = window.CerimonialRankParser;
    const rawLines = block.lines.map((l) => l.text.replace(/^#?\d{1,3}\s*[-–.]\s*/, '').trim()).filter(Boolean);

    let rank_abbr = '';
    let full_rank = '';
    let war_name = '';
    let full_name = '';
    let cargo = '';
    let femaleHint = false;
    let rankMatched = false;

    if (rawLines.length === 0) {
      return {
        rank_abbr: '',
        full_rank: '',
        war_name: '',
        full_name: '',
        cargo: '',
        treatment: 'SENHOR',
        rankMatched: false
      };
    }

    // Tentar identificar posto + nome de guerra na 1ª linha (padrão FAB/BAGL: "<Posto> <NOME DE GUERRA>")
    const firstLineParsed = rankParser
      ? rankParser.parseRankAndWarName(rawLines[0])
      : { matched: false, rank_abbr: '', full_rank: '', war_name: rawLines[0] };

    if (firstLineParsed.matched) {
      rankMatched = true;
      rank_abbr = firstLineParsed.rank_abbr;
      full_rank = firstLineParsed.full_rank;
      war_name = firstLineParsed.war_name;
      femaleHint = !!firstLineParsed.femaleHint;

      if (rawLines.length >= 2) {
        // Caso o PDF tenha colocado apenas o posto na linha 1 e o nome na linha 2
        if (!war_name) {
          full_name = rawLines[1].toUpperCase();
          war_name = full_name.split(/\s+/).pop() || full_name;
          cargo = rawLines.slice(2).join(' ').trim();
        } else {
          full_name = rawLines[1].toUpperCase();
          cargo = rawLines.slice(2).join(' ').trim();
        }
      } else {
        full_name = war_name;
      }
    } else if (rawLines.length >= 2) {
      // Verificar se a 2ª linha é que contém o posto, ou se trata de autoridade civil (Linha 1: Nome de Guerra ou Nome Completo, Linha 2: Nome Completo ou Cargo)
      const secondLineParsed = rankParser
        ? rankParser.parseRankAndWarName(rawLines[1])
        : { matched: false };

      if (secondLineParsed.matched && secondLineParsed.war_name) {
        rankMatched = true;
        rank_abbr = secondLineParsed.rank_abbr;
        full_rank = secondLineParsed.full_rank;
        war_name = secondLineParsed.war_name;
        full_name = rawLines[0].toUpperCase();
        cargo = rawLines.slice(2).join(' ').trim();
        femaleHint = !!secondLineParsed.femaleHint;
      } else {
        // Autoridade civil ou layout sem sigla militar na primeira linha
        if (rawLines.length >= 3) {
          war_name = rawLines[0].toUpperCase();
          full_name = rawLines[1].toUpperCase();
          cargo = rawLines.slice(2).join(' ').trim();
        } else {
          full_name = rawLines[0].toUpperCase();
          war_name = full_name.split(/\s+/).pop() || full_name;
          cargo = rawLines.slice(1).join(' ').trim();
        }
      }
    } else {
      // Bloco de apenas 1 linha sem posto reconhecido
      full_name = rawLines[0].toUpperCase();
      war_name = full_name.split(/\s+/).pop() || full_name;
    }

    const isFemale =
      femaleHint ||
      (rankParser ? rankParser.detectFemale(full_name, `${rank_abbr} ${full_rank}`, cargo) : false);

    if (!rank_abbr && !full_rank) {
      // Se tem nome e cargo claros mas não tinha posto militar, pode ser autoridade civil (Senhor/Senhora)
      if (cargo) {
        rank_abbr = isFemale ? 'Senhora' : 'Senhor';
        full_rank = isFemale ? 'SENHORA' : 'SENHOR';
      }
    } else if (rankParser) {
      full_rank = rankParser.adjustRankForGender(full_rank, isFemale);
    }

    const treatment = isFemale ? 'SENHORA' : 'SENHOR';

    return {
      rank_abbr,
      full_rank,
      war_name,
      full_name,
      cargo,
      treatment,
      rankMatched
    };
  }

  /**
   * ASSOCIAÇÃO ESPACIAL 2D ENTRE FOTOGRAFIAS E AUTORIDADES NA MESMA PÁGINA
   *
   * Nunca utiliza a ordem bruta de objetos de imagem do PDF.
   * Calcula um custo espacial baseado na geometria dos cartões do carômetro:
   * - Layout Lateral (Foto à esquerda do texto na mesma célula)
   * - Layout Vertical (Foto imediatamente acima do texto na mesma coluna)
   * - Proximidade de centros 2D dentro de um raio máximo estrito
   *
   * Se a associação tiver baixa confiança (distância elevada ou ambiguidade entre dois blocos próximos),
   * NÃO associa automaticamente a foto à pessoa potencialmente incorreta e sinaliza para revisão!
   */
  function matchPhotosToBlocksSpatially(blocks, pageImages, pageWidth) {
    if (!blocks || blocks.length === 0) return;

    // Filtrar eventual brasão/emblema isolado no cabeçalho do topo da página (se houver mais imagens que blocos e uma imagem estiver no topo y < 75 longe dos blocos)
    const candidateImages = (pageImages || []).filter((img) => {
      const minBlockY = Math.min(...blocks.map((b) => b.y));
      if (img.y + img.height < minBlockY - 35 && img.y < 85 && pageImages.length > blocks.length) {
        return false;
      }
      return true;
    });

    // Calcular matriz de afinidade espacial entre cada bloco e cada imagem candidata
    const pairScores = [];

    for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
      const blk = blocks[bIdx];

      for (let iIdx = 0; iIdx < candidateImages.length; iIdx++) {
        const img = candidateImages[iIdx];

        const dxCenter = blk.centerX - img.centerX;
        const dyCenter = blk.centerY - img.centerY;
        const euclideanDist = Math.hypot(dxCenter, dyCenter);

        // Relação 1: Foto à ESQUERDA do texto (padrão clássico de cartão horizontal)
        const imgRight = img.x + img.width;
        const horizGapLeft = blk.x - imgRight; // positivo quando a foto está à esquerda do texto
        const vertOverlap =
          Math.min(blk.bottom, img.y + img.height) - Math.max(blk.y, img.y);
        const vertCenterDiff = Math.abs(blk.centerY - img.centerY);

        const isLeftOfText =
          horizGapLeft >= -25 &&
          horizGapLeft <= 130 &&
          (vertOverlap >= -15 || vertCenterDiff <= Math.max(blk.height, img.height) * 0.85);

        // Relação 2: Foto ACIMA do texto (padrão clássico de cartão vertical em grade)
        const imgBottom = img.y + img.height;
        const vertGapAbove = blk.y - imgBottom; // positivo quando a foto está acima do texto
        const horizCenterDiff = Math.abs(blk.centerX - img.centerX);

        const isAboveText =
          vertGapAbove >= -25 &&
          vertGapAbove <= 110 &&
          horizCenterDiff <= Math.max(blk.width, img.width) * 0.85;

        let score = Infinity;
        let layoutRelation = 'none';

        if (isLeftOfText) {
          score = Math.max(0, horizGapLeft) * 1.1 + vertCenterDiff * 1.4;
          layoutRelation = 'left_of_text';
        } else if (isAboveText) {
          score = Math.max(0, vertGapAbove) * 1.2 + horizCenterDiff * 1.4;
          layoutRelation = 'above_text';
        } else if (euclideanDist <= 185) {
          // Penalidade maior quando a foto está à direita ou abaixo do texto (menos comum em carômetros)
          score = euclideanDist * 1.85 + 45;
          layoutRelation = 'proximity';
        }

        if (score < Infinity) {
          pairScores.push({
            bIdx,
            iIdx,
            score,
            euclideanDist,
            layoutRelation
          });
        }
      }
    }

    // Ordenar pares pelo melhor score espacial (menor distância ponderada)
    pairScores.sort((a, b) => a.score - b.score);

    const assignedBlocks = new Set();
    const assignedImages = new Set();

    for (const pair of pairScores) {
      if (assignedBlocks.has(pair.bIdx) || assignedImages.has(pair.iIdx)) {
        continue;
      }

      const blk = blocks[pair.bIdx];
      const img = candidateImages[pair.iIdx];

      // Verificar se existe ambiguidade espacial (outro bloco livre quase à mesma distância desta foto, ou outra foto livre quase à mesma distância deste bloco)
      const competingPair = pairScores.find(
        (other) =>
          (other.bIdx === pair.bIdx && other.iIdx !== pair.iIdx && !assignedImages.has(other.iIdx)) ||
          (other.iIdx === pair.iIdx && other.bIdx !== pair.bIdx && !assignedBlocks.has(other.bIdx))
      );

      const scoreMargin = competingPair ? competingPair.score - pair.score : 999;

      // Critério de alta confiança: relação geométrica clara (esquerda ou acima), distância curta e margem folgada sobre concorrentes
      const isHighConfidence =
        (pair.layoutRelation === 'left_of_text' || pair.layoutRelation === 'above_text') &&
        pair.score <= 115 &&
        scoreMargin >= 22;

      // Critério de baixa confiança / dúvida na associação:
      // Conforme o requisito 3: "Não associar automaticamente uma fotografia de baixa confiança a uma pessoa incorreta. Sinalizar o registro para revisão; Permitir selecionar ou substituir a fotografia."
      if (isHighConfidence) {
        blk.photo = img.dataUrl || '';
        blk.matchedImageId = img.id;
        blk.photoConfidence = 'high';
        assignedBlocks.add(pair.bIdx);
        assignedImages.add(pair.iIdx);
      } else {
        // Há uma foto próxima, mas a geometria é duvidosa/ambígua: sugerimos como candidata mas NÃO a aplicamos automaticamente como foto confirmada
        blk.photo = '';
        blk.candidatePhoto = img.dataUrl || '';
        blk.candidateImageId = img.id;
        blk.photoConfidence = 'low';
        assignedBlocks.add(pair.bIdx);
      }
    }

    // Qualquer bloco que não teve nenhuma imagem próxima
    for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
      if (!assignedBlocks.has(bIdx)) {
        blocks[bIdx].photo = '';
        blocks[bIdx].photoConfidence = 'missing';
      }
    }
  }

  /**
   * Analisa a lista de registros extraídos (ou editados na tela de revisão) e recalcula:
   * - flags de pendência por registro (incomplete, uncertain_photo, duplicate, unrecognized_rank)
   * - contadores globais (total, completeCount, pendingCount, duplicateCount)
   */
  function analyzeReviewItems(items) {
    if (!Array.isArray(items)) {
      return {
        items: [],
        total: 0,
        completeCount: 0,
        pendingCount: 0,
        duplicateCount: 0
      };
    }

    // Mapear nomes para detectar possíveis duplicidades
    const nameFreq = new Map();
    for (const item of items) {
      const key = String(item.full_name || item.war_name || '')
        .trim()
        .toUpperCase();
      if (key) {
        nameFreq.set(key, (nameFreq.get(key) || 0) + 1);
      }
    }

    let completeCount = 0;
    let pendingCount = 0;
    let duplicateCount = 0;

    items.forEach((item, idx) => {
      item.order = idx + 1;
      const flags = [];
      const reasons = [];

      const fullName = String(item.full_name || '').trim();
      const warName = String(item.war_name || '').trim();
      const rankAbbr = String(item.rank_abbr || '').trim();
      const fullRank = String(item.full_rank || '').trim();

      if (!fullName || fullName.length < 3) {
        flags.push('incomplete_name');
        reasons.push('Nome completo ausente ou incompleto');
      }
      if (!warName) {
        flags.push('incomplete_warname');
        reasons.push('Nome de guerra/abreviado ausente');
      }
      if (!rankAbbr && !fullRank) {
        flags.push('missing_rank');
        reasons.push('Posto/graduação não identificado');
      }

      const nameKey = (fullName || warName).toUpperCase();
      if (nameKey && (nameFreq.get(nameKey) || 0) > 1) {
        flags.push('duplicate');
        reasons.push('Possível registro duplicado no carômetro');
        duplicateCount++;
      }

      if (item.photoConfidence === 'low' && !item.photoConfirmedManually) {
        flags.push('uncertain_photo');
        reasons.push('Associação de fotografia com baixa confiança (verifique e selecione a foto correta)');
      } else if (!item.photo && !item.photoConfirmedManually) {
        flags.push('missing_photo');
        reasons.push('Sem fotografia associada');
      }

      item.reviewFlags = flags;
      item.reviewReasons = reasons;
      item.needsReview = flags.length > 0;

      if (item.needsReview) {
        pendingCount++;
      } else {
        completeCount++;
      }
    });

    return {
      items,
      total: items.length,
      completeCount,
      pendingCount,
      duplicateCount
    };
  }

  /**
   * Processa um objeto de documento PDF já aberto pelo PDF.js (ou mockado nos testes automatizados)
   */
  async function extractFromPdfDocument(pdfDoc, filename = 'Carômetro.pdf', progressCallback = null) {
    if (!pdfDoc || typeof pdfDoc.numPages !== 'number' || pdfDoc.numPages < 1) {
      throw new Error('O documento PDF selecionado é inválido ou não possui páginas.');
    }

    const numPages = pdfDoc.numPages;
    const allExtractedRecords = [];
    const allExtractedImages = [];
    let totalTextItemsAcrossDoc = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (typeof progressCallback === 'function') {
        progressCallback({
          page: pageNum,
          totalPages: numPages,
          message: `Lendo página ${pageNum} de ${numPages}...`
        });
      }

      const page = await pdfDoc.getPage(pageNum);
      page.pageNumber = pageNum;
      const viewportScale1 =
        typeof page.getViewport === 'function'
          ? page.getViewport({ scale: 1.0 })
          : { width: 595, height: 842 };

      const textItems = await extractPageTextItems(page, viewportScale1);
      const pageImages = await extractPageImages(page, viewportScale1);

      totalTextItemsAcrossDoc += textItems.length;
      allExtractedImages.push(...pageImages);

      const blocks = segmentAuthorityBlocks(textItems, pageNum);
      matchPhotosToBlocksSpatially(blocks, pageImages, viewportScale1.width || 595);

      for (const blk of blocks) {
        const parsedFields = parseAuthorityBlockFields(blk);
        allExtractedRecords.push({
          tempId: `rev_${pageNum}_${allExtractedRecords.length + 1}`,
          pageNumber: pageNum,
          order: allExtractedRecords.length + 1,
          rank_abbr: parsedFields.rank_abbr,
          full_rank: parsedFields.full_rank,
          war_name: parsedFields.war_name,
          full_name: parsedFields.full_name,
          cargo: parsedFields.cargo,
          treatment: parsedFields.treatment,
          photo: blk.photo || '',
          candidatePhoto: blk.candidatePhoto || '',
          photoConfidence: blk.photoConfidence || (blk.photo ? 'high' : 'missing'),
          photoConfirmedManually: false,
          rawLines: blk.lines.map((l) => l.text)
        });
      }
    }

    // Detectar PDF digitalizado sem camada de texto (OCR ausente) ou layout não reconhecido
    const isScannedWithoutText = totalTextItemsAcrossDoc === 0 && allExtractedImages.length > 0;
    const isUnrecognizedLayout = allExtractedRecords.length === 0;

    const analysis = analyzeReviewItems(allExtractedRecords);
    const suggestedEventName = window.CerimonialRankParser
      ? window.CerimonialRankParser.suggestEventNameFromFilename(filename)
      : 'EVENTO CERIMONIAL';

    let layoutWarning = null;
    if (isScannedWithoutText) {
      layoutWarning =
        'Este PDF parece ser digitalizado (apenas imagem, sem texto selecionável). Como o processamento é 100% local e sem OCR externo, você pode cadastrar/ajustar as autoridades manualmente na revisão utilizando as imagens extraídas.';
    } else if (isUnrecognizedLayout) {
      layoutWarning =
        'Não foram identificados blocos de autoridades automaticamente neste layout de PDF. Você pode adicionar registros manualmente na tela de revisão ou cancelar a importação.';
    }

    return {
      filename,
      suggestedEventName,
      numPages,
      items: analysis.items,
      total: analysis.total,
      completeCount: analysis.completeCount,
      pendingCount: analysis.pendingCount,
      duplicateCount: analysis.duplicateCount,
      allExtractedImages,
      isScannedWithoutText,
      isUnrecognizedLayout,
      layoutWarning
    };
  }

  /**
   * Ponto de entrada principal: recebe um File (do input type="file"), valida se é PDF e executa a extração local
   */
  async function extractFromPdfFile(file, progressCallback = null) {
    if (!file) {
      throw new Error('Nenhum arquivo selecionado.');
    }

    const fileName = String(file.name || '').trim();
    const isPdfMime = file.type === 'application/pdf' || /\.pdf$/i.test(fileName);
    if (!isPdfMime) {
      throw new Error('Formato de arquivo inválido. Selecione exclusivamente um arquivo PDF (.pdf).');
    }

    configurePdfWorker();

    if (!window.pdfjsLib || typeof window.pdfjsLib.getDocument !== 'function') {
      throw new Error('Biblioteca local PDF.js não encontrada. Verifique assets/libs/pdf.min.js.');
    }

    const arrayBuffer = await file.arrayBuffer();

    // Validar assinatura mágica "%PDF-" nos primeiros bytes
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 8));
    const headerStr = String.fromCharCode(...headerBytes);
    if (!headerStr.includes('%PDF-')) {
      throw new Error('O arquivo selecionado não é um documento PDF válido ou está corrompido.');
    }

    try {
      const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      return await extractFromPdfDocument(pdfDoc, fileName, progressCallback);
    } catch (err) {
      console.error('Erro ao processar PDF via PDF.js:', err);
      throw new Error(
        'Não foi possível ler o arquivo PDF selecionado. O arquivo pode estar corrompido ou protegido por senha.'
      );
    }
  }

  return {
    configurePdfWorker,
    extractFromPdfFile,
    extractFromPdfDocument,
    analyzeReviewItems,
    segmentAuthorityBlocks,
    matchPhotosToBlocksSpatially,
    parseAuthorityBlockFields
  };
})();
