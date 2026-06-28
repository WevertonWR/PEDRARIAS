/*!
 * price-converter.js v2.0.0
 * Converte preços em USD para a moeda local do visitante.
 *
 * PRIORIDADE DE PREÇOS:
 *   1. hotmart-prices.json  → preços reais coletados do checkout Hotmart 2x/dia
 *   2. APIs de câmbio       → cálculo: USD × cotação + alíquota local
 *   3. Snapshot hardcoded   → fallback offline
 *
 * CONFIGURAÇÃO DO JSON AO VIVO:
 *   Após criar o repositório GitHub com o scraper, defina:
 *   PriceConverter.config({
 *     livePricesUrl: 'https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/hotmart-prices.json'
 *   });
 *   Ou defina o atributo data-live-prices-url na tag <script>:
 *   <script src="price-converter.js"
 *           data-live-prices-url="https://raw.githubusercontent.com/...">
 *   </script>
 *
 * ─── PRIVACIDADE / LGPD / GDPR ──────────────────────────────────────────────
 * Quando useGeoIP: true (padrão), o IP do visitante é enviado ao ipapi.co.
 * Configure useGeoIP: false para desativar (usa navigator.language).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * USO:
 *   <span class="price-converter" data-usd="9.99">$9.99</span>
 *   <script src="price-converter.js"></script>
 *
 * API:
 *   PriceConverter.convert(9.99)        → Promise<ConversionResult>
 *   PriceConverter.convertAll()         → Promise<void>
 *   PriceConverter.config({ ... })      → void
 *
 * @license MIT
 */
(function (global) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configuração por país: moeda, locale, alíquota/markup Hotmart e casas decimais.
   * Derivado de análise de preços reais cobrados pela Hotmart em 17/05/2026.
   * @type {Record<string, {currency:string, symbol:string, locale:string, taxRate:number, decimals:number}>}
   */
  const COUNTRY_CONFIG = {
    BR: { currency: 'BRL', symbol: 'R$',  locale: 'pt-BR', taxRate: 0.00, decimals: 2 },
    MX: { currency: 'MXN', symbol: '$',   locale: 'es-MX', taxRate: 0.16, decimals: 2 }, // IVA confirmado
    CO: { currency: 'COP', symbol: '$',   locale: 'es-CO', taxRate: 0.05, decimals: 0 }, // markup observado
    AR: { currency: 'ARS', symbol: '$',   locale: 'es-AR', taxRate: 0.16, decimals: 2 }, // percepciones
    PE: { currency: 'PEN', symbol: 'S/',  locale: 'es-PE', taxRate: 0.08, decimals: 2 },
    ES: { currency: 'EUR', symbol: '€',   locale: 'es-ES', taxRate: 0.04, decimals: 2 }, // IVA reduzido confirmado
    CL: { currency: 'CLP', symbol: '$',   locale: 'es-CL', taxRate: 0.19, decimals: 0 }, // IVA confirmado
    EC: { currency: 'USD', symbol: '$',   locale: 'es-EC', taxRate: 0.00, decimals: 2 },
    BO: { currency: 'BOB', symbol: 'Bs',  locale: 'es-BO', taxRate: 0.07, decimals: 2 },
    CR: { currency: 'CRC', symbol: '₡',   locale: 'es-CR', taxRate: 0.05, decimals: 2 },
    DO: { currency: 'DOP', symbol: 'RD$', locale: 'es-DO', taxRate: 0.06, decimals: 2 },
    SV: { currency: 'USD', symbol: '$',   locale: 'es-SV', taxRate: 0.00, decimals: 2 },
    GT: { currency: 'GTQ', symbol: 'Q',   locale: 'es-GT', taxRate: 0.07, decimals: 2 },
    HN: { currency: 'HNL', symbol: 'L',   locale: 'es-HN', taxRate: 0.06, decimals: 2 },
    PA: { currency: 'PAB', symbol: 'B/.', locale: 'es-PA', taxRate: 0.20, decimals: 2 }, // ITBMS + markup alto
    PY: { currency: 'PYG', symbol: 'Gs.', locale: 'es-PY', taxRate: 0.05, decimals: 0 },
    PR: { currency: 'USD', symbol: '$',   locale: 'es-PR', taxRate: 0.00, decimals: 2 },
    UY: { currency: 'UYU', symbol: '$',   locale: 'es-UY', taxRate: 0.06, decimals: 2 },
    VE: { currency: 'USD', symbol: '$',   locale: 'es-VE', taxRate: 0.00, decimals: 2 },
    GQ: { currency: 'USD', symbol: '$',   locale: 'es-GQ', taxRate: 0.00, decimals: 2 },
    US: { currency: 'USD', symbol: '$',   locale: 'en-US', taxRate: 0.00, decimals: 2 },
    PT: { currency: 'EUR', symbol: '€',   locale: 'pt-PT', taxRate: 0.04, decimals: 2 },
  };

  /**
   * Cotações de snapshot (base USD) usadas quando TODAS as APIs de câmbio falharem.
   * Atualizado em 17/05/2026. Substitua periodicamente para manter precisão.
   * @type {Record<string, number>}
   */
  const FALLBACK_RATES = {
    USD: 1,       BRL: 5.20,    MXN: 17.34,   COP: 3789.47,
    ARS: 1395,    PEN: 3.43,    EUR: 0.86,     CLP: 909,
    BOB: 6.92,    CRC: 454.48,  DOP: 59.86,    GTQ: 7.64,
    HNL: 26.65,   PYG: 6105.88, UYU: 40.08,   PAB: 1.00,
  };

  const CACHE_KEYS = {
    rates: 'priceConverter_rates',
    geo:   'priceConverter_geo',
  };

  const TTL = {
    rates: 6  * 60 * 60 * 1000,  // 6 horas
    geo:   24 * 60 * 60 * 1000,  // 24 horas
  };

  const GEO_API   = 'https://ipapi.co/json/';
  const RATE_APIS = [
    'https://api.exchangerate-api.com/v4/latest/USD',
    'https://open.er-api.com/v6/latest/USD',
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTADO INTERNO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * URL do hotmart-prices.json gerado pelo scraper GitHub Actions.
   * Pode ser definida via atributo data-live-prices-url na tag <script>
   * ou via PriceConverter.config({ livePricesUrl: '...' }).
   * Exemplo: 'https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/hotmart-prices.json'
   */
  const SCRIPT_TAG_URL = (function () {
    try {
      const scripts = document.querySelectorAll('script[src*="price-converter"]');
      const last = scripts[scripts.length - 1];
      return last ? (last.dataset.livePricesUrl || '') : '';
    } catch { return ''; }
  }());

  const SCRIPT_GEO_URL = (function () {
    try {
      const scripts = document.querySelectorAll('script[src*="price-converter"]');
      const last = scripts[scripts.length - 1];
      return last ? (last.dataset.geoUrl || '') : '';
    } catch { return ''; }
  }());

  // Preço base em USD que o scraper coletou (para calcular proporção de outros preços)
  const SCRIPT_BASE_USD = (function () {
    try {
      const scripts = document.querySelectorAll('script[src*="price-converter"]');
      const last = scripts[scripts.length - 1];
      return last ? (parseFloat(last.dataset.baseUsd) || null) : null;
    } catch { return null; }
  }());

  /** @type {{useGeoIP:boolean, psychologicalRounding:boolean, roundingMode:string, selector:string, fadeAnimation:boolean, fadeDuration:number, livePricesUrl:string}} */
  let _cfg = {
    useGeoIP:              true,
    psychologicalRounding: true,
    roundingMode:          'psychological', // 'nearest' | 'up' | 'down' | 'psychological'
    selector:              '.price-converter',
    fadeAnimation:         true,
    fadeDuration:          300,
    livePricesUrl:         SCRIPT_TAG_URL,  // URL do JSON do scraper Hotmart
    geoUrl:                SCRIPT_GEO_URL, // URL da API de geo (ex: /api/country do Vercel)
    basePriceUSD:          SCRIPT_BASE_USD, // preço base USD que o scraper coletou
  };

  /** @type {Record<string,number>|null} */
  let _rates = null;

  /** @type {string|null} */
  let _country = null;

  /** @type {Promise<void>|null} - garante inicialização única */
  let _initPromise = null;

  /**
   * Preços ao vivo coletados do checkout Hotmart pelo scraper.
   * Formato: { MX: { currency:'MXN', amount:200.99, formatted:'$200.99' }, ... }
   * @type {Record<string, {currency:string, amount:number, formatted:string}>|null}
   */
  let _livePrices = null;

  /** TTL do JSON de preços ao vivo: 7 horas (ligeiramente acima da coleta de 6h) */
  const LIVE_PRICES_TTL = 7 * 60 * 60 * 1000;
  const CACHE_KEY_LIVE  = 'priceConverter_live';

  // ═══════════════════════════════════════════════════════════════════════════
  // CACHE (localStorage)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lê um valor do cache se ainda estiver dentro do TTL.
   * @template T
   * @param {string} key
   * @param {number} ttl - tempo de vida em ms
   * @returns {T|null}
   */
  function cacheRead(key, ttl) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts > ttl) return null;
      return entry.value;
    } catch {
      return null;
    }
  }

  /**
   * Grava um valor no cache com timestamp atual.
   * @param {string} key
   * @param {*} value
   */
  function cacheWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }));
    } catch {
      // quota excedida ou modo privado — seguir sem cache
    }
  }

  /** Verifica se o parâmetro ?refreshPrices=1 está na URL. */
  function isForceRefresh() {
    try {
      return new URLSearchParams(location.search).has('refreshPrices');
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DETECÇÃO DE PAÍS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Infere o código de país a partir de navigator.language.
   * Exemplos: 'pt-BR' → 'BR', 'es-MX' → 'MX', 'es' → 'MX'.
   * @param {string} lang
   * @returns {string|null}
   */
  function inferCountryFromLang(lang) {
    if (!lang) return null;
    const parts = lang.split('-');

    // Tenta extrair código de país da segunda parte (ex: 'pt-BR' → 'BR')
    if (parts.length >= 2) {
      const code = parts[parts.length - 1].toUpperCase();
      if (COUNTRY_CONFIG[code]) return code;
    }

    // Fallbacks por idioma sem região explícita
    const langFallbacks = { pt: 'BR', es: 'MX', en: 'US' };
    return langFallbacks[parts[0].toLowerCase()] || null;
  }

  /**
   * Detecta o país do visitante via GeoIP (ipapi.co) com fallback para navigator.language.
   * Respeita o cache de 24h e a opção useGeoIP.
   * @returns {Promise<string>} Código ISO 3166-1 alpha-2 (ex: 'BR', 'MX')
   */
  async function detectCountry() {
    const force = isForceRefresh();

    if (!force) {
      const cached = cacheRead(CACHE_KEYS.geo, TTL.geo);
      if (cached) return cached;
    }

    // Fonte primária: /api/country do Vercel (usa cabeçalhos de geo reais do edge)
    if (_cfg.geoUrl) {
      try {
        const res = await fetch(_cfg.geoUrl, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const code = data.country || data.country_code;
        if (typeof code === 'string' && code.length === 2) {
          cacheWrite(CACHE_KEYS.geo, code);
          return code;
        }
        throw new Error('country ausente na resposta');
      } catch (err) {
        console.warn('[PriceConverter] geoUrl falhou, tentando ipapi.co:', err.message);
      }
    }

    // Fonte secundária: ipapi.co (GeoIP externo)
    if (_cfg.useGeoIP) {
      try {
        const res = await fetch(GEO_API, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { country_code } = await res.json();
        if (typeof country_code === 'string' && country_code.length === 2) {
          cacheWrite(CACHE_KEYS.geo, country_code);
          return country_code;
        }
        throw new Error('country_code ausente na resposta');
      } catch (err) {
        console.warn('[PriceConverter] GeoIP falhou, usando navigator.language como fallback:', err.message);
      }
    }

    const fallback = inferCountryFromLang(navigator.language) || 'US';
    cacheWrite(CACHE_KEYS.geo, fallback);
    return fallback;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PREÇOS AO VIVO (hotmart-prices.json do scraper)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Carrega o hotmart-prices.json gerado pelo GitHub Actions.
   * Usa cache de 7h para não bater na API a cada pageview.
   * Se falhar silenciosamente: o script cai para cálculo via câmbio.
   * @returns {Promise<Record<string,Object>|null>}
   */
  async function fetchLivePrices() {
    if (!_cfg.livePricesUrl) return null;

    const force = isForceRefresh();
    if (!force) {
      const cached = cacheRead(CACHE_KEY_LIVE, LIVE_PRICES_TTL);
      if (cached) return cached;
    }

    try {
      const res = await fetch(_cfg.livePricesUrl, {
        signal: AbortSignal.timeout(6000),
        // Cache-Control para garantir dados frescos no CDN do GitHub
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Valida estrutura mínima
      if (!data || !data.prices || typeof data.prices !== 'object') {
        throw new Error('Estrutura inválida no hotmart-prices.json');
      }
      if (data.updatedAt === null) {
        // Arquivo ainda não foi populado pelo scraper
        return null;
      }

      cacheWrite(CACHE_KEY_LIVE, data.prices);
      console.info(
        `[PriceConverter] Preços Hotmart carregados (${Object.keys(data.prices).length} países, ` +
        `atualizado: ${new Date(data.updatedAt).toLocaleString('pt-BR')})`,
      );
      return data.prices;
    } catch (err) {
      console.warn('[PriceConverter] hotmart-prices.json indisponível, usando cálculo de câmbio:', err.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COTAÇÕES DE CÂMBIO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Busca cotações USD→outras moedas com cascata de APIs e snapshot hardcoded de fallback.
   * Cascata: exchangerate-api.com → open.er-api.com → FALLBACK_RATES.
   * @returns {Promise<Record<string,number>>}
   */
  async function fetchRates() {
    const force = isForceRefresh();

    if (!force) {
      const cached = cacheRead(CACHE_KEYS.rates, TTL.rates);
      if (cached) return cached;
    }

    for (const url of RATE_APIS) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rates = data.rates;
        // Sanidade: verificar que retornou um objeto com ao menos EUR
        if (rates && typeof rates === 'object' && rates.EUR) {
          cacheWrite(CACHE_KEYS.rates, rates);
          return rates;
        }
        throw new Error('Formato de resposta inesperado');
      } catch (err) {
        console.warn(`[PriceConverter] API ${url} indisponível:`, err.message);
      }
    }

    console.warn('[PriceConverter] Todas as APIs de câmbio falharam. Usando snapshot de 17/05/2026.');
    return FALLBACK_RATES;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARREDONDAMENTO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Arredondamento psicológico:
   *   - Moedas com 2 casas decimais: arredonda para floor(value) + 0.99
   *     Ex: 200,95 → 200,99 | 173,23 → 173,99 | 8,94 → 8,99
   *   - Moedas sem decimais (CLP, PYG, COP): arredonda para o próximo múltiplo
   *     de 100 terminando em 99, acima do valor.
   *     Ex: 11.234 → 11.299 | 39.747 → 39.799 | 10.808 → 10.899
   * @param {number} value
   * @param {number} decimals
   * @returns {number}
   */
  function psychologicalRound(value, decimals) {
    if (decimals === 0) {
      // ceil para o próximo múltiplo de 100, depois subtrai 1 → termina em 99
      return Math.ceil(value / 100) * 100 - 1;
    }
    // Sempre leva para .99 do número inteiro abaixo
    return Math.floor(value) + 0.99;
  }

  /**
   * Aplica o modo de arredondamento configurado em _cfg.roundingMode.
   * Se psychologicalRounding for true, sempre usa 'psychological'.
   * @param {number} value
   * @param {number} decimals
   * @returns {number}
   */
  function applyRounding(value, decimals) {
    const mode = _cfg.psychologicalRounding ? 'psychological' : _cfg.roundingMode;
    const factor = Math.pow(10, decimals);

    switch (mode) {
      case 'psychological':
        return psychologicalRound(value, decimals);
      case 'up':
        return Math.ceil(value * factor) / factor;
      case 'down':
        return Math.floor(value * factor) / factor;
      case 'nearest':
      default:
        return Math.round(value * factor) / factor;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CÁLCULO DE PREÇO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} ConversionResult
   * @property {string}  country      - Código ISO do país detectado (ex: 'MX')
   * @property {string}  currency     - Código ISO da moeda (ex: 'MXN')
   * @property {number}  basePriceUSD - Preço original em USD
   * @property {number}  fxRate       - Cotação USD → moeda local
   * @property {number}  baseLocal    - Preço convertido antes dos impostos
   * @property {number}  taxRate      - Alíquota/markup aplicada (ex: 0.16)
   * @property {number}  taxAmount    - Valor do imposto/markup em moeda local
   * @property {number}  total        - Total final arredondado
   * @property {string}  formatted    - Preço formatado com símbolo e separadores locais
   * @property {string}  locale       - Locale BCP 47 usado (ex: 'es-MX')
   */

  /**
   * Executa o cálculo completo de conversão de preço.
   *
   * PRIORIDADE:
   *   1. Preço ao vivo do hotmart-prices.json (coletado do checkout real)
   *      → Apenas disponível quando o preço base é idêntico ao do produto scrapeado.
   *         Para múltiplos produtos com preços diferentes, o live price é proporcional.
   *   2. Cálculo via câmbio + alíquota local (padrão quando sem JSON)
   *
   * @param {number} basePriceUSD
   * @param {string} countryCode
   * @param {Record<string,number>} rates
   * @param {Record<string,Object>|null} livePrices
   * @returns {ConversionResult}
   */
  function calculate(basePriceUSD, countryCode, rates, livePrices) {
    const countryCfg = COUNTRY_CONFIG[countryCode] || {
      currency: 'USD', symbol: '$', locale: 'en-US', taxRate: 0, decimals: 2,
    };

    // ── Preço ao vivo: usa o valor exato coletado do checkout Hotmart ─────────
    // Para produtos com valor diferente do produto base do scraper,
    // calcula a proporção mantendo a mesma alíquota implícita observada.
    if (livePrices && livePrices[countryCode]) {
      const live = livePrices[countryCode];

      // Razão entre o preço base deste elemento e o preço base do scraper (em USD)
      // Hotmart guarda o preço scrapeado em live._basePriceUSD (se disponível)
      // Caso não tenha referência, usa o preço direto (para produto único)
      const baseRef   = live._basePriceUSD || _cfg.basePriceUSD || null;
      const ratio     = baseRef ? (basePriceUSD / baseRef) : 1;
      const rawTotal  = live.amount * ratio;
      const total     = applyRounding(rawTotal, countryCfg.decimals);
      const formatted = ratio === 1
        ? live.formatted  // preço exato do checkout para o produto original
        : formatCurrency(total, live.currency, countryCfg.locale, countryCfg.decimals, countryCfg.symbol);

      // Taxa implícita reversa (para informação no objeto de retorno)
      const fxRate    = rates[countryCfg.currency] || 1;
      const baseLocal = basePriceUSD * fxRate;

      return {
        country:      countryCode,
        currency:     live.currency || countryCfg.currency,
        basePriceUSD,
        fxRate,
        baseLocal:    +baseLocal.toFixed(4),
        taxRate:      countryCfg.taxRate,
        taxAmount:    +(baseLocal * countryCfg.taxRate).toFixed(4),
        total,
        formatted,
        locale:       countryCfg.locale,
        source:       'hotmart-live',  // indica que veio do JSON real
      };
    }

    // ── Cálculo via câmbio + alíquota ─────────────────────────────────────────
    const fxRate    = rates[countryCfg.currency] || 1;
    const baseLocal = basePriceUSD * fxRate;
    const taxAmount = baseLocal * countryCfg.taxRate;
    const rawTotal  = baseLocal + taxAmount;
    const total     = applyRounding(rawTotal, countryCfg.decimals);
    const formatted = formatCurrency(
      total,
      countryCfg.currency,
      countryCfg.locale,
      countryCfg.decimals,
      countryCfg.symbol,
    );

    return {
      country:      countryCode,
      currency:     countryCfg.currency,
      basePriceUSD,
      fxRate,
      baseLocal:    +baseLocal.toFixed(4),
      taxRate:      countryCfg.taxRate,
      taxAmount:    +taxAmount.toFixed(4),
      total,
      formatted,
      locale:       countryCfg.locale,
      source:       'calculated',  // indica que foi calculado (sem JSON ao vivo)
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMATAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Formata um valor numérico como string de moeda usando Intl.NumberFormat.
   * Se o locale/currency não for suportado pelo browser, usa formatação manual de fallback.
   * @param {number} value
   * @param {string} currency - ISO 4217 (ex: 'MXN')
   * @param {string} locale   - BCP 47 (ex: 'es-MX')
   * @param {number} decimals
   * @param {string} symbolFallback - símbolo usado se Intl falhar
   * @returns {string}
   */
  function formatCurrency(value, currency, locale, decimals, symbolFallback) {
    try {
      return new Intl.NumberFormat(locale, {
        style:                 'currency',
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
    } catch {
      // Fallback manual: símbolo + valor com ponto como separador decimal
      return `${symbolFallback} ${value.toFixed(decimals)}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MANIPULAÇÃO DO DOM
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Atualiza o textContent de um elemento com animação fade-out/fade-in.
   * @param {HTMLElement} el
   * @param {string} newText
   */
  function fadeUpdate(el, newText) {
    if (!_cfg.fadeAnimation || _cfg.fadeDuration <= 0) {
      el.textContent = newText;
      return;
    }
    const half = Math.round(_cfg.fadeDuration / 2);
    el.style.transition = `opacity ${half}ms ease`;
    el.style.opacity    = '0';
    setTimeout(() => {
      el.textContent  = newText;
      el.style.opacity = '1';
    }, half);
  }

  /**
   * Atualiza um elemento .price-converter com o preço convertido e dispara evento.
   * Suporta data-show-original="true" para exibir o valor em USD entre parênteses.
   * @param {HTMLElement} el
   * @param {ConversionResult} result
   */
  function updateElement(el, result) {
    let text = result.formatted;

    if (el.dataset.showOriginal === 'true' && result.currency !== 'USD') {
      text += ` (US$ ${result.basePriceUSD.toFixed(2)})`;
    }

    fadeUpdate(el, text);

    // Evento customizado para integração com analytics (GTM, GA4, etc.)
    el.dispatchEvent(
      new CustomEvent('priceConverted', {
        bubbles:    true,
        cancelable: false,
        detail:     result,
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Inicializa detecção de país, cotações e preços ao vivo em paralelo.
   * Executa apenas uma vez por carregamento de página (singleton via Promise).
   * @returns {Promise<void>}
   */
  function init() {
    if (_initPromise) return _initPromise;

    _initPromise = Promise.all([
      detectCountry(),
      fetchRates(),
      fetchLivePrices(),
    ])
      .then(([country, rates, livePrices]) => {
        _country    = country;
        _rates      = rates;
        _livePrices = livePrices; // pode ser null se URL não configurada ou falhar
      })
      .catch(err => {
        console.warn('[PriceConverter] Falha na inicialização:', err);
        _country = _country || 'US';
        _rates   = _rates   || FALLBACK_RATES;
      });

    return _initPromise;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Converte um valor em USD para a moeda local detectada do visitante.
   *
   * @param {number} usdAmount - Valor em dólares americanos
   * @returns {Promise<ConversionResult>}
   *
   * @example
   * const result = await PriceConverter.convert(9.99);
   * console.log(result.formatted); // "$200.99" (MX)
   */
  async function convert(usdAmount) {
    await init();
    return calculate(usdAmount, _country, _rates, _livePrices);
  }

  /**
   * Converte automaticamente todos os elementos que correspondem ao seletor configurado.
   * Padrão: todos os elementos com a classe `.price-converter` e atributo `data-usd`.
   *
   * @returns {Promise<void>}
   *
   * @example
   * // HTML: <span class="price-converter" data-usd="9.99">$9.99</span>
   * await PriceConverter.convertAll();
   */
  async function convertAll() {
    await init();
    const elements = document.querySelectorAll(_cfg.selector);
    elements.forEach(el => {
      const usd = parseFloat(el.dataset.usd);
      if (isNaN(usd)) {
        console.warn('[PriceConverter] Elemento sem data-usd válido:', el);
        return;
      }
      updateElement(el, calculate(usd, _country, _rates, _livePrices));
    });
  }

  /**
   * Atualiza as configurações do conversor em tempo de execução.
   * Alterar useGeoIP redefine a inicialização e redetecta o país.
   *
   * @param {{
   *   useGeoIP?:              boolean,
   *   psychologicalRounding?: boolean,
   *   roundingMode?:          'nearest'|'up'|'down'|'psychological',
   *   selector?:              string,
   *   fadeAnimation?:         boolean,
   *   fadeDuration?:          number
   * }} opts
   *
   * @example
   * PriceConverter.config({ useGeoIP: false, psychologicalRounding: true });
   */
  function config(opts) {
    if (!opts || typeof opts !== 'object') return;
    const resetGeo  = 'useGeoIP' in opts && opts.useGeoIP !== _cfg.useGeoIP;
    const resetLive = 'livePricesUrl' in opts && opts.livePricesUrl !== _cfg.livePricesUrl;
    Object.assign(_cfg, opts);
    if (resetGeo || resetLive) {
      _initPromise = null;
      _country     = null;
      _rates       = null;
      _livePrices  = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-EXECUÇÃO
  // ═══════════════════════════════════════════════════════════════════════════

  function autoRun() {
    if (document.querySelector(_cfg.selector)) {
      convertAll();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoRun);
  } else {
    // Página já carregada (script adicionado dinamicamente)
    setTimeout(autoRun, 0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO GLOBAL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Retorna uma tabela com o preço convertido para TODOS os países configurados.
   * Útil para exibir uma tabela de preços por país na página de vendas.
   * @param {number} usdAmount
   * @returns {Promise<Record<string, ConversionResult>>} objeto indexado por código de país
   */
  async function getPriceTable(usdAmount) {
    await init();
    const table = {};
    for (const [code] of Object.entries(COUNTRY_CONFIG)) {
      table[code] = calculate(usdAmount, code, _rates, _livePrices);
    }
    return table;
  }

  global.PriceConverter = {
    convert,
    convertAll,
    config,
    getPriceTable,
  };

}(window));
