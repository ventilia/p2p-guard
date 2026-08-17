/**
 * Сбор ответов Binance по контрагенту.
 *
 * ВАЖНО, ПРОЧТИТЕ ЭТИ ТРИ СТРОКИ:
 *   1. Chrome блокирует вставку кода в консоль. Сначала наберите руками
 *      allow pasting
 *      и нажмите Enter. Только потом вставляйте скрипт.
 *   2. Открывать нужно страницу профиля контрагента:
 *      c2c.binance.com/ru/advertiserDetail?advertiserNo=...
 *      (кликните по нику контрагента в ордере)
 *   3. Скрипт сам сделает запросы под вашей сессией и напечатает результат.
 *      Ждать, пока страница что-то запросит, не нужно.
 *
 * Дальше просто смотрите на вывод. Отчёт лягyт в буфер обмена сам.
 * Если не лёг — правый клик по строке «ОТЧЁТ» → Copy string contents.
 *
 * Скрипт только читает. Куки, токены и подписи в отчёт не попадают.
 */
(async () => {
  const log = (msg, css = '') => console.log(`%c${msg}`, css || 'color:inherit');
  const ok = (m) => log(m, 'color:#1a7f37;font-weight:600');
  const warn = (m) => log(m, 'color:#b26a00;font-weight:600');
  const bad = (m) => log(m, 'color:#c62828;font-weight:600');

  if (!/binance\.com$/.test(location.hostname)) {
    bad('Это не страница Binance. Откройте профиль контрагента на c2c.binance.com и повторите.');
    return;
  }

  // ─────────────────────── кто контрагент ───────────────────────

  const cookie = (name) =>
    document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';

  function findUserNo() {
    const fromUrl = /(?:advertiserNo|userNo|advertiserId)=([A-Za-z0-9]{8,64})/.exec(location.href);
    if (fromUrl) return fromUrl[1];

    for (const a of document.querySelectorAll('a[href]')) {
      const m = /(?:advertiserNo|userNo)=([A-Za-z0-9]{8,64})/.exec(a.getAttribute('href') ?? '');
      if (m) return m[1];
    }
    // последняя попытка: длинный hex где-нибудь в разметке страницы
    const m = /"(?:userNo|advertiserNo)"\s*:\s*"([A-Za-z0-9]{16,64})"/.exec(document.body.innerHTML);
    return m ? m[1] : null;
  }

  const userNo = findUserNo();
  if (!userNo) {
    bad('Не нашёл номер контрагента на этой странице.');
    log('Откройте профиль контрагента — в адресе должно быть advertiserNo=...');
    log('Либо задайте вручную:  window.__pgUser = "s1e7e25..."  и запустите скрипт заново');
    if (!window.__pgUser) return;
  }

  const target = userNo ?? window.__pgUser;
  ok(`Контрагент: ${target}`);
  log('Опрашиваю биржу, это займёт несколько секунд…');

  // ─────────────────────── очистка ───────────────────────

  const SECRET = /token|auth|cookie|secret|signature|session|password|jwt|csrf|device|fvideo/i;

  const clean = (value, depth = 0) => {
    if (depth > 8) return '…';
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
    if (Array.isArray(value)) return value.slice(0, 4).map((v) => clean(v, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? '‹вырезано›' : clean(v, depth + 1);
      return out;
    }
    return String(value);
  };

  // ─────────────────────── запрос ───────────────────────

  // заголовки страницы: csrftoken и антифрод лежат в куках, остальное статично
  const headers = {
    'content-type': 'application/json',
    clienttype: 'web',
    c2ctype: 'c2c_web',
    lang: cookie('lang') || 'ru',
  };
  if (cookie('csrftoken')) headers.csrftoken = cookie('csrftoken');
  if (cookie('bnc-uuid')) headers['bnc-uuid'] = cookie('bnc-uuid');
  if (cookie('BNC_FV_KEY')) headers['fvideo-id'] = cookie('BNC_FV_KEY');

  async function call(method, path, body) {
    const url = `${location.origin}${path}`;
    try {
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers,
        body: method === 'POST' ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = text.slice(0, 300);
      }

      const success = json && typeof json === 'object' ? json.success !== false : false;
      const payload = json && typeof json === 'object' ? json.data : null;
      const empty = payload === null || payload === undefined ||
        (Array.isArray(payload) && payload.length === 0);

      return {
        method,
        path,
        status: response.status,
        success,
        code: json?.code ?? null,
        message: typeof json?.message === 'string' ? json.message.slice(0, 120) : null,
        hasData: !empty,
        response: clean(json),
      };
    } catch (err) {
      return { method, path, status: 0, success: false, error: String(err).slice(0, 160) };
    }
  }

  // ─────────────────────── что спрашиваем ───────────────────────

  const withUser = { userNo: target };
  const withPage = { userNo: target, page: 1, rows: 20 };

  const CANDIDATES = [
    // профиль и статистика
    ['POST', '/bapi/c2c/v2/friendly/c2c/user/profile-and-ads-list', withUser],
    ['POST', '/bapi/c2c/v2/friendly/c2c/user/base-detail', withUser],
    ['POST', '/bapi/c2c/v1/friendly/c2c/user/base-detail', withUser],
    ['GET', `/bapi/c2c/v2/friendly/c2c/user/base-detail?userNo=${encodeURIComponent(target)}`],
    ['GET', `/bapi/c2c/v2/public/c2c/userCenter/getUserBaseDetail?userNo=${encodeURIComponent(target)}`],
    ['POST', '/bapi/c2c/v1/friendly/c2c/user/user-statistics', withUser],

    // отзывы
    ['POST', '/bapi/c2c/v2/friendly/c2c/user/feedback/list', withPage],
    ['POST', '/bapi/c2c/v1/friendly/c2c/user/feedback/list', withPage],
    ['POST', '/bapi/c2c/v2/friendly/c2c/user/feedback/search', withPage],
    ['POST', '/bapi/c2c/v1/private/c2c/user-feedback/list', withPage],
    ['POST', '/bapi/c2c/v2/private/c2c/user-feedback/list', withPage],
    ['GET', `/bapi/c2c/v1/friendly/c2c/user/feedback/count?userNo=${encodeURIComponent(target)}`],

    // объявления контрагента: там же лежат его условия и лимиты
    ['POST', '/bapi/c2c/v2/friendly/c2c/adv/search-by-advertiser', { ...withPage, advertiserNo: target }],
  ];

  const results = [];
  for (const [method, path, body] of CANDIDATES) {
    const r = await call(method, path, body);
    results.push(r);

    const mark = r.success && r.hasData ? '✓' : r.status === 404 || r.status === 405 ? '·' : '✗';
    const color = r.success && r.hasData ? 'color:#1a7f37' : mark === '·' ? 'color:#999' : 'color:#c62828';
    log(`${mark} ${r.status} ${method} ${path.split('?')[0]}`, color);
  }

  const working = results.filter((r) => r.success && r.hasData);

  // ─────────────────────── что уже загрузила сама страница ───────────────────────

  const seen = [
    ...new Set(
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => /\/bapi\/.*(c2c|otc)/i.test(u))
        .map((u) => {
          try {
            return new URL(u).pathname;
          } catch {
            return u.slice(0, 120);
          }
        }),
    ),
  ].slice(0, 90);

  // ─────────────────────── отчёт ───────────────────────

  const report = {
    page: location.pathname,
    userNo: target,
    loggedIn: Boolean(cookie('logined') || cookie('p20t')),
    working: working.map((r) => ({ method: r.method, path: r.path.split('?')[0] })),
    results,
    pathsPageUsedItself: seen,
  };

  const text = JSON.stringify(report, null, 2);
  console.log(report);

  let copied = false;
  try {
    copy(text);
    copied = true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(area);
      area.select();
      copied = document.execCommand('copy');
      area.remove();
    } catch {
      copied = false;
    }
  }

  console.log('%cОТЧЁТ', 'font-weight:600', text);

  if (working.length) {
    ok(`Сработало путей: ${working.length}. ${copied ? 'Отчёт в буфере — вставляйте в чат.' : ''}`);
  } else if (!report.loggedIn) {
    bad('Похоже, вы не вошли в Binance в этом браузере — биржа отказала во всех запросах.');
  } else {
    warn('Ни один путь не ответил данными. Всё равно пришлите отчёт: в нём список путей,');
    warn('которые страница дёргает сама, — по ним я найду правильный.');
  }

  if (!copied) {
    log('Скопировать вручную: правый клик по строке ОТЧЁТ выше → Copy string contents');
  }

  window.__pgReport = report;
  return report;
})();
