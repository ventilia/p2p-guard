/**
 * Перехват ответов Binance на странице ордера или профиля контрагента.
 *
 * F12 → Console → вставить весь файл → Enter. Появится зелёная строка «перехват включён».
 * Дальше кликать по странице (профиль контрагента, «Инфо P2P», вкладка отзывов).
 * Перезагружать страницу нельзя — перехват слетит.
 *
 * Когда в консоли набежит несколько строк «поймано», выполнить:  pgDump()
 * Отчёт ляжет в буфер обмена.
 *
 * Токены, куки и подписи вырезаются, длинные строки обрезаются.
 */
(() => {
  if (window.__pgCapture) {
    console.log('%cПерехват уже стоит. Соберите данные и вызовите pgDump()', 'color:#b26a00');
    return window.__pgCapture.control;
  }

  const store = [];
  const seen = new Set();

  // ловим всё, что похоже на внутренний api биржи, а не только c2c
  const INTERESTING = /\/bapi\/|c2c|otc|\/gateway-api\//i;
  const SECRET_KEY = /token|auth|cookie|secret|signature|session|password|jwt|csrf|device/i;

  // режем секреты и длинные хвосты: нужна форма ответа, а не его объём
  const clean = (value, depth = 0) => {
    if (depth > 7) return '…';
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
      return typeof text === 'string' ? text.slice(0, 200) : null;
    }
  };

  const record = (method, url, requestBody, responseText) => {
    if (!url || !INTERESTING.test(url)) return;

    let path = url;
    let query = null;
    try {
      const parsed = new URL(url, location.origin);
      path = parsed.pathname;
      if (parsed.search) {
        query = {};
        for (const [k, v] of parsed.searchParams) {
          query[k] = SECRET_KEY.test(k) ? '‹вырезано›' : v.slice(0, 80);
        }
      }
    } catch {
      // оставим как есть
    }

    // один и тот же путь второй раз ничего нового не расскажет
    const key = `${method} ${path}`;
    if (seen.has(key)) return;
    seen.add(key);

    store.push({ method, path, query, request: clean(parse(requestBody)), response: clean(parse(responseText)) });
    console.log(`%c[pg ${store.length}] поймано: ${key}`, 'color:#1a7f37');
  };

  // ─────────────────────────── fetch ───────────────────────────

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = origFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (INTERESTING.test(url)) {
        const init = args[1] || {};
        const method = init.method || (input && input.method) || 'GET';
        const body = typeof init.body === 'string' ? init.body : null;
        promise
          .then((response) =>
            response
              .clone()
              .text()
              .then((text) => record(method, url, body, text)),
          )
          .catch(() => undefined);
      }
    } catch {
      // перехват не должен ломать страницу
    }
    return promise;
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
    if (INTERESTING.test(this.__pgUrl || '')) {
      this.addEventListener('load', () => {
        try {
          record(this.__pgMethod || 'GET', this.__pgUrl, typeof body === 'string' ? body : null, this.responseText);
        } catch {
          // игнорируем
        }
      });
    }
    return origSend.call(this, body);
  };

  // ─────────────────────────── выгрузка ───────────────────────────

  // copy() есть не всегда, поэтому свой запасной путь через скрытое поле
  const toClipboard = (text) => {
    try {
      copy(text);
      return true;
    } catch {
      // ниже
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  };

  // пути, которые страница уже дёргала до включения перехвата: тел нет, но
  // сам список эндпоинтов тоже полезен
  const earlierPaths = () => {
    const out = new Set();
    for (const entry of performance.getEntriesByType('resource')) {
      if (!INTERESTING.test(entry.name)) continue;
      try {
        out.add(new URL(entry.name).pathname);
      } catch {
        out.add(entry.name.slice(0, 120));
      }
    }
    return [...out].slice(0, 40);
  };

  window.pgDump = () => {
    const report = {
      page: location.pathname + location.search.replace(/=[^&]+/g, '=…'),
      captured: store,
      pathsSeenEarlier: earlierPaths(),
    };
    const text = JSON.stringify(report, null, 2);

    if (!store.length) {
      console.log(
        '%cТел ответов пока нет — страница ничего не перезапрашивала.\n' +
          'Кликните по нику контрагента, откройте «Инфо P2P» или вкладку «Обратная связь».\n' +
          'Список путей всё равно собран, его тоже можно прислать.',
        'color:#b26a00',
      );
    }

    console.log(report);
    if (toClipboard(text)) {
      console.log(
        `%cГотово: ${store.length} ответов + ${report.pathsSeenEarlier.length} путей скопировано в буфер`,
        'color:#1a7f37;font-weight:600',
      );
    } else {
      console.log('Не скопировалось. Правый клик по объекту выше → Copy object');
    }
    return report;
  };

  window.pgStatus = () => {
    console.log(`Поймано ответов: ${store.length}. Пути: ${[...seen].join(', ') || '—'}`);
    return store.length;
  };

  const control = { store, dump: () => window.pgDump(), status: () => window.pgStatus() };
  window.__pgCapture = { store, control };

  console.log(
    '%c✓ Перехват включён.%c\n' +
      '1. Кликните по нику контрагента, откройте «Инфо P2P» или «Обратная связь»\n' +
      '2. Выполните:  pgDump()\n' +
      'Страницу не перезагружайте.',
    'color:#1a7f37;font-weight:600;font-size:13px',
    'color:inherit',
  );

  return control;
})();
