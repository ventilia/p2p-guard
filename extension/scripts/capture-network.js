/**
 * Перехват ответов Binance на странице ордера.
 *
 * Открыть ордер, F12 → Console, вставить весь файл, Enter.
 * Дальше поделать на странице то, что заставит её перезапросить данные:
 * открыть профиль контрагента, переключить вкладку ордера, нажать обновление
 * внутри страницы. Перезагружать страницу целиком НЕЛЬЗЯ — перехват слетит.
 *
 * Когда наберётся несколько запросов, выполнить в консоли:  pgDump()
 * Отчёт ляжет в буфер обмена.
 *
 * Токены, куки и подписи вырезаются, длинные строки обрезаются.
 */
(() => {
  if (window.__pgCapture) {
    console.log('%cПерехват уже стоит. Соберите данные и вызовите pgDump()', 'color:#b26a00');
    return;
  }

  const store = [];
  window.__pgCapture = store;

  const INTERESTING = /bapi|c2c|otc/i;
  const SECRET_KEY = /token|auth|cookie|secret|signature|session|password|jwt|csrf/i;

  // режем секреты и длинные хвосты: мне нужна форма ответа, а не его объём
  const clean = (value, depth = 0) => {
    if (depth > 6) return '…';
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
    if (Array.isArray(value)) return value.slice(0, 3).map((v) => clean(v, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = SECRET_KEY.test(k) ? '‹вырезано›' : clean(v, depth + 1);
      }
      return out;
    }
    return String(value);
  };

  const parse = (text) => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 200);
    }
  };

  const record = (method, url, requestBody, responseText) => {
    if (!INTERESTING.test(url)) return;
    let pathname = url;
    try {
      pathname = new URL(url, location.origin).pathname;
    } catch {
      // оставим как есть
    }
    store.push({
      method,
      path: pathname,
      request: clean(parse(requestBody)),
      response: clean(parse(responseText)),
    });
    console.log(`%c[pg] поймано: ${method} ${pathname}`, 'color:#1a7f37');
  };

  // ─────────────────────────── fetch ───────────────────────────

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      if (INTERESTING.test(url)) {
        const body = args[1]?.body;
        response
          .clone()
          .text()
          .then((text) => record(args[1]?.method ?? 'GET', url, typeof body === 'string' ? body : null, text))
          .catch(() => undefined);
      }
    } catch {
      // перехват не должен ломать страницу
    }
    return response;
  };

  // ─────────────────────────── XMLHttpRequest ───────────────────────────

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__pgMethod = method;
    this.__pgUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (INTERESTING.test(this.__pgUrl ?? '')) {
      this.addEventListener('load', () => {
        try {
          record(this.__pgMethod ?? 'GET', this.__pgUrl, typeof body === 'string' ? body : null, this.responseText);
        } catch {
          // игнорируем
        }
      });
    }
    return origSend.call(this, body);
  };

  // ─────────────────────────── выгрузка ───────────────────────────

  window.pgDump = () => {
    if (!store.length) {
      console.log('%cПока пусто. Поделайте что-нибудь на странице — но не перезагружайте её', 'color:#c62828');
      return null;
    }
    const text = JSON.stringify(store, null, 2);
    console.log(store);
    try {
      copy(text);
      console.log(`%cГотово: ${store.length} запросов скопировано в буфер`, 'color:#1a7f37;font-weight:600');
    } catch {
      console.log('Скопируйте вывод выше вручную');
    }
    return store;
  };

  console.log(
    '%cПерехват включён.%c Откройте профиль контрагента или переключите вкладку ордера,\n' +
      'затем выполните:  pgDump()\n' +
      'Страницу не перезагружайте — перехват слетит.',
    'color:#1a7f37;font-weight:600',
    'color:inherit',
  );
})();
