/**
 * Cerimonial BAGL - Dicionário e Parser de Postos, Graduações, Tratamentos e Nome de Evento
 */
window.CerimonialRankParser = (function () {
  // Regras ordenadas da mais específica para a mais genérica
  const RANK_PATTERNS = [
    { regex: /^Ten(?:ente)?[\s-]*Brig(?:adeiro)?(?:\s+do)?\s+Ar\b/i, abbr: 'Ten Brig Ar', full: 'TENENTE-BRIGADEIRO DO AR' },
    { regex: /^Maj(?:or)?[\s-]*Brig(?:adeiro)?(?:\s+do)?\s+Ar\b/i, abbr: 'Maj Brig Ar', full: 'MAJOR-BRIGADEIRO DO AR' },
    { regex: /^Maj(?:or)?[\s-]*Brig(?:adeiro)?\s+M[eé]d(?:ica)\b/i, abbr: 'Maj Brig Med', full: 'MAJOR-BRIGADEIRO MÉDICA', female: true },
    { regex: /^Maj(?:or)?[\s-]*Brig(?:adeiro)?\s+M[eé]d(?:ico)?\b/i, abbr: 'Maj Brig Med', full: 'MAJOR-BRIGADEIRO MÉDICO' },
    { regex: /^Maj(?:or)?[\s-]*Brig(?:adeiro)?\s+Eng(?:enheiro)?\b/i, abbr: 'Maj Brig Eng', full: 'MAJOR-BRIGADEIRO ENGENHEIRO' },
    { regex: /^Maj(?:or)?[\s-]*Brig(?:adeiro)?\s+Int(?:endente)?\b/i, abbr: 'Maj Brig Int', full: 'MAJOR-BRIGADEIRO INTENDENTE' },
    { regex: /^Brig(?:adeiro)?(?:\s+do)?\s+Ar\b/i, abbr: 'Brig Ar', full: 'BRIGADEIRO DO AR' },
    { regex: /^Brig(?:adeiro)?\s+M[eé]d(?:ica)\b/i, abbr: 'Brig Med', full: 'BRIGADEIRO MÉDICA', female: true },
    { regex: /^Brig(?:adeiro)?\s+M[eé]d(?:ico)?\b/i, abbr: 'Brig Med', full: 'BRIGADEIRO MÉDICO' },
    { regex: /^Brig(?:adeiro)?\s+Int(?:endente)?\b/i, abbr: 'Brig Int', full: 'BRIGADEIRO INTENDENTE' },
    { regex: /^Brig(?:adeiro)?\s+Eng(?:enheiro)?\b/i, abbr: 'Brig Eng', full: 'BRIGADEIRO ENGENHEIRO' },
    { regex: /^Brig(?:adeiro)?(?:\s+de)?\s+Inf(?:antaria)?\b/i, abbr: 'Brig Inf', full: 'BRIGADEIRO DE INFANTARIA' },
    { regex: /^Brig(?:adeiro)?\b/i, abbr: 'Brig', full: 'BRIGADEIRO' },
    { regex: /^Gen(?:eral)?(?:\s+de)?\s+Ex(?:[eé]rcito)?\b/i, abbr: 'Gen Ex', full: 'GENERAL DE EXÉRCITO' },
    { regex: /^Gen(?:eral)?(?:\s+de)?\s+Div(?:is[aã]o)?\b/i, abbr: 'Gen Div', full: 'GENERAL DE DIVISÃO' },
    { regex: /^Gen(?:eral)?(?:\s+de)?\s+Bda\b|^Gen(?:eral)?(?:\s+de)?\s+Brig(?:ada)?\b/i, abbr: 'Gen Bda', full: 'GENERAL DE BRIGADA' },
    { regex: /^Alte\s+Esq\b|^Almirante\s+de\s+Esquadra\b/i, abbr: 'Alte Esq', full: 'ALMIRANTE DE ESQUADRA' },
    { regex: /^V(?:ice)?[\s-]*Alte\s*\(EN\)/i, abbr: 'V Alte (EN)', full: 'VICE-ALMIRANTE (EN)' },
    { regex: /^V(?:ice)?[\s-]*Alte\s*\(FN\)/i, abbr: 'V Alte (FN)', full: 'VICE-ALMIRANTE (FN)' },
    { regex: /^V(?:ice)?[\s-]*Alte\b|^Vice[\s-]*Almirante\b/i, abbr: 'V Alte', full: 'VICE-ALMIRANTE' },
    { regex: /^C(?:ontra)?[\s-]*Alte\s*\(FN\)/i, abbr: 'C Alte (FN)', full: 'CONTRA-ALMIRANTE (FN)' },
    { regex: /^C(?:ontra)?[\s-]*Alte\b|^Contra[\s-]*Almirante\b/i, abbr: 'C Alte', full: 'CONTRA-ALMIRANTE' },
    { regex: /^CMG\b|^Cap(?:it[aã]o)?\s+de\s+Mar\s+e\s+Guerra\b/i, abbr: 'CMG', full: 'CAPITÃO DE MAR E GUERRA' },
    { regex: /^CF\b|^Cap(?:it[aã]o)?\s+de\s+Fragata\b/i, abbr: 'CF', full: 'CAPITÃO DE FRAGATA' },
    { regex: /^CC\b|^Cap(?:it[aã]o)?\s+de\s+Corveta\b/i, abbr: 'CC', full: 'CAPITÃO DE CORVETA' },
    { regex: /^Cel\s+Av\b|^Coronel\s+Aviador(?:a)?\b/i, abbr: 'Cel Av', full: 'CORONEL AVIADOR' },
    { regex: /^Cel\s+Int\b|^Coronel\s+Intendente\b/i, abbr: 'Cel Int', full: 'CORONEL INTENDENTE' },
    { regex: /^Cel\s+Med\b|^Coronel\s+M[eé]d(?:ico|ica)\b/i, abbr: 'Cel Med', full: 'CORONEL MÉDICO' },
    { regex: /^Cel\s+Dent\b|^Coronel\s+Dentista\b/i, abbr: 'Cel Dent', full: 'CORONEL DENTISTA' },
    { regex: /^Cel\s+Farm\b|^Coronel\s+Farmac[eê]utic(?:o|a)\b/i, abbr: 'Cel Farm', full: 'CORONEL FARMACÊUTICO' },
    { regex: /^Cel\s+Eng\b|^Coronel\s+Engenheir(?:o|a)\b/i, abbr: 'Cel Eng', full: 'CORONEL ENGENHEIRO' },
    { regex: /^Cel\s+Inf\b|^Coronel\s+de\s+Infantaria\b/i, abbr: 'Cel Inf', full: 'CORONEL DE INFANTARIA' },
    { regex: /^Cel\s+ESP\s+MET\b|^Coronel\s+Especialista\s+em\s+Meteorologia\b/i, abbr: 'Cel ESP MET', full: 'CORONEL ESPECIALISTA EM METEOROLOGIA' },
    { regex: /^Cel\b|^Coronel\b/i, abbr: 'Cel', full: 'CORONEL' },
    { regex: /^Ten[\s-]*Cel\s+Av\b|^Tenente[\s-]*Coronel\s+Aviador(?:a)?\b/i, abbr: 'Ten Cel Av', full: 'TENENTE-CORONEL AVIADOR' },
    { regex: /^Ten[\s-]*Cel\s+Int\b|^Tenente[\s-]*Coronel\s+Intendente\b/i, abbr: 'Ten Cel Int', full: 'TENENTE-CORONEL INTENDENTE' },
    { regex: /^Ten[\s-]*Cel\s+Med\b|^Tenente[\s-]*Coronel\s+M[eé]d(?:ico|ica)\b/i, abbr: 'Ten Cel Med', full: 'TENENTE-CORONEL MÉDICO' },
    { regex: /^Ten[\s-]*Cel\s+Eng\b|^Tenente[\s-]*Coronel\s+Engenheir(?:o|a)\b/i, abbr: 'Ten Cel Eng', full: 'TENENTE-CORONEL ENGENHEIRO' },
    { regex: /^Ten[\s-]*Cel\b|^Tenente[\s-]*Coronel\b/i, abbr: 'Ten Cel', full: 'TENENTE-CORONEL' },
    { regex: /^Maj\s+Av\b|^Major\s+Aviador(?:a)?\b/i, abbr: 'Maj Av', full: 'MAJOR AVIADOR' },
    { regex: /^Maj\s+Int\b|^Major\s+Intendente\b/i, abbr: 'Maj Int', full: 'MAJOR INTENDENTE' },
    { regex: /^Maj\s+Med\b|^Major\s+M[eé]d(?:ico|ica)\b/i, abbr: 'Maj Med', full: 'MAJOR MÉDICO' },
    { regex: /^Maj\s+Eng\b|^Major\s+Engenheir(?:o|a)\b/i, abbr: 'Maj Eng', full: 'MAJOR ENGENHEIRO' },
    { regex: /^Maj\b|^Major\b/i, abbr: 'Maj', full: 'MAJOR' },
    { regex: /^Cap\s+[A-Z]{2,4}\b/i, abbr: 'Cap', full: 'CAPITÃO' },
    { regex: /^Cap(?:it[aã]o)?\b/i, abbr: 'Cap', full: 'CAPITÃO' },
    { regex: /^1[º°o]?\s*Ten(?:ente)?(?:\s+[A-Z0-9\s]+)?\b/i, abbr: '1º Ten', full: 'PRIMEIRO-TENENTE' },
    { regex: /^2[º°o]?\s*Ten(?:ente)?(?:\s+[A-Z0-9\s]+)?\b/i, abbr: '2º Ten', full: 'SEGUNDO-TENENTE' },
    { regex: /^Asp(?:irante)?\b/i, abbr: 'Asp', full: 'ASPIRANTE-A-OFICIAL' },
    { regex: /^SO(?:\s+[A-Z]{2,4}(?:\s+[A-Z]{2,4})?)?\b|^Suboficial\b/i, abbr: 'SO', full: 'SUBOFICIAL' },
    { regex: /^1[º°o]?\s*Sgt\b|^Primeiro[\s-]*Sargento\b/i, abbr: '1º Sgt', full: 'PRIMEIRO-SARGENTO' },
    { regex: /^2[º°o]?\s*Sgt\b|^Segundo[\s-]*Sargento\b/i, abbr: '2º Sgt', full: 'SEGUNDO-SARGENTO' },
    { regex: /^3[º°o]?\s*Sgt\b|^Terceiro[\s-]*Sargento\b/i, abbr: '3º Sgt', full: 'TERCEIRO-SARGENTO' },
    { regex: /^Dep(?:utad[oa])?\s+Fed(?:eral)?\b/i, abbr: 'Dep Fed', full: 'DEPUTADO FEDERAL' },
    { regex: /^Dep(?:utad[oa])?\s+Est(?:adual)?\b/i, abbr: 'Dep Est', full: 'DEPUTADO ESTADUAL' },
    { regex: /^Sen(?:ador(?:a)?)?\b/i, abbr: 'Senador', full: 'SENADOR' },
    { regex: /^Des(?:embargador(?:a)?)?\b/i, abbr: 'Desembargador', full: 'DESEMBARGADOR' },
    { regex: /^Ju[ií]z(?:a)?\b/i, abbr: 'Juiz', full: 'JUIZ' },
    { regex: /^Pref(?:eit[oa])?\b/i, abbr: 'Prefeito', full: 'PREFEITO' },
    { regex: /^Sec(?:ret[aá]ri[oa])?\b/i, abbr: 'Secretário', full: 'SECRETÁRIO' },
    { regex: /^Sra\.?\b|^Senhora\b/i, abbr: 'Senhora', full: 'SENHORA', female: true },
    { regex: /^Sr\.?\b|^Senhor\b/i, abbr: 'Senhor', full: 'SENHOR' },
    { regex: /^Dra\.?\b|^Doutora\b/i, abbr: 'Senhora', full: 'DOUTORA', female: true },
    { regex: /^Dr\.?\b|^Doutor\b/i, abbr: 'Senhor', full: 'DOUTOR' },
    { regex: /^Profª\.?\b|^Professora\b/i, abbr: 'Senhora', full: 'PROFESSORA', female: true },
    { regex: /^Prof\.?\b|^Professor\b/i, abbr: 'Senhor', full: 'PROFESSOR' }
  ];

  // Nomes próprios femininos comuns no meio militar/civil para inferir SENHORA e flexão (ex: CORONEL MÉDICA)
  const COMMON_FEMALE_FIRST_NAMES = new Set([
    'ANA', 'MARIA', 'CARLA', 'HELENA', 'FERNANDA', 'PATRICIA', 'PATRÍCIA', 'JULIANA', 'CAMILA',
    'ALINE', 'BRUNA', 'LETICIA', 'LETÍCIA', 'VANESSA', 'PRISCILA', 'AMANDA', 'LUCIANA', 'ADRIANA',
    'CLAUDIA', 'CLÁUDIA', 'SIMONE', 'MONICA', 'MÔNICA', 'SANDRA', 'SONIA', 'SÔNIA', 'MARCIA',
    'MÁRCIA', 'CRISTINA', 'CRISTIANE', 'DANIELE', 'DANIELA', 'GABRIELA', 'RAQUEL', 'BEATRIZ',
    'CAROLINA', 'CAROLINE', 'RENATA', 'TATIANA', 'BIANCA', 'FLAVIA', 'FLÁVIA', 'VIVIANE',
    'ELAINE', 'DENISE', 'SILVIA', 'SÍLVIA', 'REGINA', 'VERA', 'LUCIA', 'LÚCIA', 'PAULA',
    'ROBERTA', 'ANDREA', 'ANDRÉA', 'ANDRESSA', 'LARISSA', 'NATALIA', 'NATÁLIA', 'MARIANA',
    'KARINA', 'KELLY', 'MICHELE', 'MICHELLE', 'GISELE', 'JAQUELINE', 'ROSANA', 'ROSELI',
    'SOLANGE', 'VALERIA', 'VALÉRIA', 'DEBORA', 'DÉBORA', 'ERICA', 'ÉRICA', 'FABIANA', 'CINTIA',
    'CÍNTIA', 'SABRINA', 'THAIS', 'THAÍS', 'LILIAN', 'LÍLIAN', 'MIRIAM', 'MÍRIAM', 'RITA',
    'TEREZA', 'TERESA', 'JOANA', 'MARTA', 'ROSA', 'ALICE', 'LAURA', 'CLARA', 'VALENTINA',
    'HELGA', 'ELIANE', 'SUELI', 'NEUSA', 'NADIA', 'NÁDIA', 'KÁTIA', 'KATIA', 'TÂNIA', 'TANIA'
  ]);

  function detectFemale(fullName, rankStr, cargoStr) {
    const firstWord = String(fullName || '').trim().split(/\s+/)[0]?.toUpperCase() || '';
    if (COMMON_FEMALE_FIRST_NAMES.has(firstWord)) return true;

    const combined = `${rankStr || ''} ${cargoStr || ''}`.toUpperCase();
    if (
      /\b(SENHORA|SRA\.?|DOUTORA|DRA\.?|MÉDICA|MEDICA|ENGENHEIRA|DIRETORA|CHEFA|PREFEITA|DEPUTADA|SENADORA|SECRETÁRIA|SECRETARIA|JUÍZA|JUIZA|DESEMBARGADORA|COMANDANTE\s+MÉDICA|CONSELHEIRA|ASSESSORA|COORDENADORA|PROCURADORA)\b/.test(
        combined
      )
    ) {
      return true;
    }
    return false;
  }

  function adjustRankForGender(fullRank, isFemale) {
    if (!isFemale || !fullRank) return fullRank;
    return fullRank
      .replace(/\bMÉDICO\b/g, 'MÉDICA')
      .replace(/\bFARMACÊUTICO\b/g, 'FARMACÊUTICA')
      .replace(/\bSENHOR\b/g, 'SENHORA')
      .replace(/\bDEPUTADO\b/g, 'DEPUTADA')
      .replace(/\bSECRETÁRIO\b/g, 'SECRETÁRIA')
      .replace(/\bPREFEITO\b/g, 'PREFEITA');
  }

  /**
   * Analisa uma linha de posto + nome de guerra (ex: "Ten Brig Ar <NOME DE GUERRA>")
   */
  function parseRankAndWarName(line) {
    const clean = String(line || '').replace(/\s+/g, ' ').trim();
    if (!clean) {
      return { rank_abbr: '', full_rank: '', war_name: '', matched: false };
    }

    for (const pat of RANK_PATTERNS) {
      const m = clean.match(pat.regex);
      if (m) {
        const matchedRankText = m[0].trim();
        const remainder = clean.slice(matchedRankText.length).trim();
        // Preservar códigos de quadro específicos se faziam parte do texto original (ex: "SO QSS SAD")
        const rankAbbr = pat.abbr === 'SO' && /^SO\s+[A-Z]/i.test(matchedRankText)
          ? matchedRankText
          : pat.abbr === '1º Ten' && /^1[º°o]?\s*Ten\s+[A-Z]/i.test(matchedRankText)
          ? matchedRankText
          : pat.abbr;

        return {
          rank_abbr: rankAbbr,
          full_rank: pat.full,
          war_name: remainder.toUpperCase(),
          femaleHint: !!pat.female,
          matched: true
        };
      }
    }

    return {
      rank_abbr: '',
      full_rank: '',
      war_name: clean.toUpperCase(),
      femaleHint: false,
      matched: false
    };
  }

  /**
   * Sugere o nome do evento a partir do nome do arquivo PDF importado.
   * Exemplos:
   * - "Carômetro OMA 2026.pdf" -> "OMA 2026"
   * - "Carômetro Aniversário da Base.pdf" -> "ANIVERSÁRIO DA BASE"
   * - "Carômetro Passagem de Comando.pdf" -> "PASSAGEM DE COMANDO"
   */
  function suggestEventNameFromFilename(filename) {
    if (!filename) return 'EVENTO CERIMONIAL';

    let name = String(filename).trim();
    // Remove caminho se houver
    name = name.split(/[\\/]/).pop();
    // Remove extensão .pdf (case-insensitive)
    name = name.replace(/\.pdf$/i, '').trim();
    // Substitui underscores ou hifens isolados por espaços
    name = name.replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' ').trim();
    // Remove prefixo "Carômetro" ou "Carometro" (seguido opcionalmente de '-', ':', 'de', 'do', 'da' se for só separador, mas mantendo o título exato dos exemplos)
    name = name.replace(/^car[oô]metro[\s\-:_]*/i, '').trim();

    if (!name) {
      return 'EVENTO CERIMONIAL';
    }

    return name.toUpperCase();
  }

  return {
    parseRankAndWarName,
    detectFemale,
    adjustRankForGender,
    suggestEventNameFromFilename
  };
})();
