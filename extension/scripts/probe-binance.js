/**
 * Подбор рабочего запроса к Binance по контрагенту.
 *
 * Chrome блокирует вставку в консоль: сначала наберите руками  allow pasting
 * и нажмите Enter, только потом вставляйте файл.
 *
 * Открыть нужно страницу профиля контрагента (advertiserNo в адресе).
 *
 * КРАСНЫЕ СТРОКИ В КОНСОЛИ — ЭТО НОРМАЛЬНО. Chrome так показывает любой ответ
 * не-200, а мы намеренно перебираем варианты. Ждите итоговую таблицу внизу.
 *
 * Скрипт только читает. Куки и подписи в отчёт не попадают.
 */
(async () => {
  const c = (m, css) => console.log(`%c${m}`, css);
  const ok = (m) => c(m, 'color:#1a7f37;font-weight:600');
  const bad = (m) => c(m, 'color:#c62828;font-weight:600');

  if (!/binance\.com$/.test(location.hostname)) {
    bad('Откройте профиль контрагента на c2c.binance.com');
    return;
  }

  const cookie = (n) =>
    document.cookie.split('; ').find((x) => x.startsWith(`${n}=`))?.slice(n.length + 1) ?? '';

  const userNo =
    /(?:advertiserNo|userNo)=([A-Za-z0-9]{8,64})/.exec(location.href)?.[1] ??
    /"(?:userNo|advertiserNo)"\s*:\s*"([A-Za-z0-9]{16,64})"/.exec(document.body.innerHTML)?.[1] ??
    window.__pgUser;

  if (!userNo) {
    bad('Не нашёл номер контрагента. Нужен адрес с advertiserNo=...');
    return;
  }

  // ─────────── 1. что страница запрашивала сама ───────────
  // это главное: страница уже нарисовала статистику, значит нужный путь тут

  const own = [
    ...new Set(
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => /\/bapi\//i.test(u))
        .map((u) => {
          try {
            const p = new URL(u);
            return p.pathname + (p.search ? '?' + [...p.searchParams.keys()].join('&') : '');
          } catch {
            return u.slice(0, 140);
          }
        }),
    ),
  ];

  // ─────────── 2. подбор тела для найденного пути ───────────

  const SECRET = /token|auth|cookie|secret|signature|session|password|jwt|csrf|device|fvideo/i;
  const clean = (v, d = 0) => {
    if (d > 8) return '…';
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v;
    if (Array.isArray(v)) return v.slice(0, 4).map((x) => clean(x, d + 1));
    if (typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = SECRET.test(k) ? '‹вырезано›' : clean(x, d + 1);
      return o;
    }
    return String(v);
  };

  const headers = {
    'content-type': 'application/json',
    clienttype: 'web',
    c2ctype: 'c2c_web',
    lang: cookie('lang') || 'ru',
  };
  if (cookie('csrftoken')) headers.csrftoken = cookie('csrftoken');
  if (cookie('bnc-uuid')) headers['bnc-uuid'] = cookie('bnc-uuid');
  if (cookie('BNC_FV_KEY')) headers['fvideo-id'] = cookie('BNC_FV_KEY');

  async function attempt(label, path, body) {
    try {
      const r = await fetch(location.origin + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'include',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let j = null;
      try {
        j = JSON.parse(text);
      } catch {
        j = text.slice(0, 200);
      }
      const good = r.status === 200 && j && j.success !== false && j.data != null;
      return {
        label,
        path,
        body: body ?? null,
        status: r.status,
        // ради этого всё и затевалось: биржа сама говорит, чего ей не хватило
        code: j?.code ?? null,
        message: typeof j?.message === 'string' ? j.message.slice(0, 200) : null,
        good,
        data: good ? clean(j.data) : null,
      };
    } catch (e) {
      return { label, path, status: 0, good: false, message: String(e).slice(0, 140) };
    }
  }

  // путь ответил 400, а не 404 — он существует, ошибаемся в параметрах
  const PROFILE = '/bapi/c2c/v2/friendly/c2c/user/profile-and-ads-list';

  const variants = [
    ['пустое тело', {}],
    ['userNo', { userNo }],
    ['userNo + постранично', { userNo, page: 1, rows: 20 }],
    ['advertiserNo', { advertiserNo: userNo }],
    ['advertiserNo + постранично', { advertiserNo: userNo, page: 1, rows: 20 }],
    ['userNo + тип объявления', { userNo, page: 1, rows: 20, publisherType: null, tradeType: 'BUY' }],
    ['userNo + актив и валюта', { userNo, page: 1, rows: 10, asset: 'USDT', fiat: 'KZT', tradeType: 'BUY' }],
    ['всё вместе', { userNo, advertiserNo: userNo, page: 1, rows: 20, tradeType: 'BUY', asset: 'USDT', fiat: 'KZT', publisherType: null }],
  ];

  const tries = [];
  for (const [label, body] of variants) tries.push(await attempt(label, PROFILE, body));

  // ─────────── 3. итог ───────────

  console.log('\n');
  c('══════════ ИТОГ ══════════', 'font-weight:700;font-size:14px');

  console.table(
    tries.map((t) => ({ вариант: t.label, статус: t.status, код: t.code, сообщение: t.message })),
  );

  c('\nПути, которые страница запрашивала сама:', 'font-weight:600');
  own.forEach((p) => console.log('   ' + p));

  const winner = tries.find((t) => t.good);
  if (winner) ok(`\n✓ Сработал вариант: ${winner.label}`);
  else c('\nНи один вариант не подошёл — смотрите столбец «сообщение» выше', 'color:#b26a00;font-weight:600');

  const report = { userNo, host: location.hostname, tries, pathsPageUsedItself: own };
  const text = JSON.stringify(report, null, 2);

  let copied = false;
  try {
    copy(text);
    copied = true;
  } catch {
    try {
      const a = document.createElement('textarea');
      a.value = text;
      a.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(a);
      a.select();
      copied = document.execCommand('copy');
      a.remove();
    } catch {
      copied = false;
    }
  }

  console.log('%cОТЧЁТ', 'font-weight:700', text);
  if (copied) ok('Отчёт скопирован в буфер — вставляйте в чат');
  else c('Правый клик по строке ОТЧЁТ выше → Copy string contents', 'color:#b26a00');

  window.__pgReport = report;
  return report;
})();
