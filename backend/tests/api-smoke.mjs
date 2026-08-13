/**
 * Сквозной тест API по живому серверу.
 *
 * Запуск: node tests/api-smoke.mjs   (сервер должен быть поднят)
 *
 * Тест идемпотентен: все идентификаторы уникальны для прогона, поэтому его
 * можно гонять по одной и той же базе сколько угодно раз.
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4000/v1';
const ADMIN_UID = process.env.SEED_ADMIN_UID ?? '100000001';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

const run = Date.now().toString().slice(-9);
const uid = (suffix) => `9${run}${suffix}`.slice(0, 19);
const traderUid = uid('1');
const otherUid = uid('2');
const cpUid = `cp-${run}`;
const orderNo = `20${run}0001`;

let failures = 0;

async function call(path, { method = 'GET', body, token, uid: headerUid } = {}) {
  const headers = { accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (headerUid) headers['x-binance-uid'] = headerUid;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function check(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}`, JSON.stringify(extra ?? {}).slice(0, 300));
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ───────────────────────────── Авторизация ─────────────────────────────

section('Авторизация');

const health = await fetch(BASE.replace(/\/v1$/, '/health')).then((r) => r.json());
check('health', health.ok === true, health);

const login = await call('/auth/login', {
  method: 'POST',
  body: { binanceUid: ADMIN_UID, password: ADMIN_PASSWORD },
});
check('логин админа', login.status === 200 && !!login.json.accessToken, login.json);
const admin = login.json;
const A = { token: admin.accessToken, uid: admin.user.binanceUid };

check(
  'expiresIn совпадает с TTL из конфига',
  admin.expiresIn === 900,
  { expiresIn: admin.expiresIn },
);
check('внутренний id refresh-токена наружу не отдаётся', admin.refreshTokenId === undefined, {
  keys: Object.keys(admin),
});

const badLogin = await call('/auth/login', {
  method: 'POST',
  body: { binanceUid: ADMIN_UID, password: 'wrongpass1' },
});
check('неверный пароль → 401', badLogin.status === 401, badLogin.json);

// ───────────────────────────── Команды и токены ─────────────────────────────

section('Команды и токены доступа');

const team = await call('/admin/teams', {
  method: 'POST',
  ...A,
  body: { name: `Alpha ${run}` },
});
check('создание команды', team.status === 200 && !!team.json.id, team.json);

const invite = await call('/admin/tokens', {
  method: 'POST',
  ...A,
  body: { label: 'smoke', role: 'USER', teamId: team.json.id, maxUses: 2 },
});
check('создание токена', invite.status === 200 && !!invite.json.token, invite.json);

const trader = await call('/auth/activate', {
  method: 'POST',
  body: {
    token: invite.json.token,
    binanceUid: traderUid,
    password: 'traderpass1',
    nickname: `trader-${run}`,
  },
});
check(
  'активация трейдера в команду',
  trader.status === 200 && trader.json.user.teamId === team.json.id,
  trader.json,
);
const T = { token: trader.json.accessToken, uid: traderUid };

const dup = await call('/auth/activate', {
  method: 'POST',
  body: { token: invite.json.token, binanceUid: traderUid, password: 'traderpass1' },
});
check('повторная активация того же UID → 409', dup.status === 409, dup.json);

// Второй трейдер — нужен, чтобы проверить изоляцию чужих ордеров.
const other = await call('/auth/activate', {
  method: 'POST',
  body: { token: invite.json.token, binanceUid: otherUid, password: 'otherpass1' },
});
check('второй трейдер активирован', other.status === 200, other.json);
const O = { token: other.json.accessToken, uid: otherUid };

const exhausted = await call('/auth/activate', {
  method: 'POST',
  body: { token: invite.json.token, binanceUid: uid('3'), password: 'thirdpass1' },
});
check('лимит использований токена соблюдается', exhausted.status === 401, exhausted.json);

const mismatch = await call('/me', { ...T, uid: '999999999' });
check(
  'UID_MISMATCH при чужом заголовке',
  mismatch.status === 409 && mismatch.json.error.code === 'UID_MISMATCH',
  mismatch.json,
);

// ───────────────────────────── Досье ─────────────────────────────

section('Досье контрагента');

const lookup = await call('/counterparties/lookup', {
  method: 'POST',
  ...T,
  body: {
    externalId: cpUid,
    nickname: 'aminexh',
    countryCode: 'MAR',
    stats: {
      registeredDays: 12,
      completionRate: 0.82,
      totalOrders: 15,
      avgAmountFiat: 90000,
      avgReleaseMinutes: 34,
    },
    order: {
      externalId: orderNo,
      side: 'BUY',
      status: 'COMPLETED',
      asset: 'USDT',
      fiat: 'RUB',
      amountFiat: 180000,
      createdAtExchange: new Date().toISOString(),
    },
  },
});
check('lookup досье', lookup.status === 200 && !!lookup.json.counterparty?.id, lookup.json);
const cpId = lookup.json.counterparty?.id;

const factors = (lookup.json.risk?.factors ?? []).map((f) => f.code);
check(
  'риск учёл молодой аккаунт, низкий completion и крупный чек',
  ['YOUNG_ACCOUNT', 'LOW_COMPLETION_RATE', 'LOW_VOLUME_HIGH_TICKET'].every((c) =>
    factors.includes(c),
  ),
  factors,
);
check(
  'такой профиль даёт высокий риск',
  lookup.json.risk?.level === 'HIGH',
  lookup.json.risk,
);
check('ордер записан в личную статистику', lookup.json.orders?.own?.completed === 1, lookup.json.orders);

// Тот же ордер глазами другого трейдера: запись не должна сменить владельца.
const foreignLookup = await call('/counterparties/lookup', {
  method: 'POST',
  ...O,
  body: {
    externalId: cpUid,
    order: { externalId: orderNo, side: 'BUY', status: 'CANCELLED' },
  },
});
check('lookup чужого ордера отработал', foreignLookup.status === 200, foreignLookup.json);
check(
  'чужой ордер не присвоен и не перезаписан',
  foreignLookup.json.orders?.own?.total === 0 && foreignLookup.json.orders?.market?.completed === 1,
  foreignLookup.json.orders,
);

// ───────────────────────────── Отзывы, ЧС, заметки ─────────────────────────

section('Отзывы, чёрный список, заметки');

const review = await call('/reviews', {
  method: 'POST',
  ...T,
  body: { counterpartyId: cpId, rating: 'NEGATIVE', text: 'Пропал по середине залива' },
});
check('создание отзыва', review.status === 200, review.json);

const reviewAgain = await call('/reviews', {
  method: 'POST',
  ...T,
  body: { counterpartyId: cpId, rating: 'NEGATIVE', text: 'Обновлённый текст' },
});
check(
  'повторный отзыв правит существующий',
  reviewAgain.status === 200 && reviewAgain.json.id === review.json.id,
  reviewAgain.json,
);

const otherReview = await call('/reviews', {
  method: 'POST',
  ...O,
  body: { counterpartyId: cpId, rating: 'POSITIVE', text: 'Со мной всё прошло нормально' },
});
check('второй пользователь оставил свой отзыв', otherReview.status === 200, otherReview.json);

const foreignDelete = await call(`/reviews/${otherReview.json.id}`, { method: 'DELETE', ...T });
check('чужой отзыв удалить нельзя', foreignDelete.status === 403, foreignDelete.json);

const bl = await call('/blacklist', {
  method: 'POST',
  ...T,
  body: { counterpartyId: cpId, reason: 'Скам, не работать', severity: 3, scope: 'TEAM' },
});
check('добавление в ЧС команды', bl.status === 200, bl.json);

const blGlobal = await call('/blacklist', {
  method: 'POST',
  ...T,
  body: { counterpartyId: cpId, reason: 'test', scope: 'GLOBAL' },
});
check('GLOBAL ЧС запрещён обычному пользователю', blGlobal.status === 403, blGlobal.json);

const note = await call('/teams/notes', {
  method: 'PUT',
  ...T,
  body: { counterpartyId: cpId, text: 'Заметка команды' },
});
check('заметка команды', note.status === 200, note.json);

const req = await call('/requisites/observe', {
  method: 'POST',
  ...T,
  body: {
    counterpartyId: cpId,
    items: [
      { type: 'CARD', value: '4276 3800 1234 5679' },
      { type: 'PHONE', value: '+7 916 123-45-67' },
    ],
  },
});
check('реквизиты сохранены', req.status === 200 && req.json.saved === 2, req.json);

const dossier = (await call(`/counterparties/${cpId}/dossier`, T)).json;
check('досье: оба отзыва видны', dossier.reviews?.length === 2, dossier.reviews?.length);
check(
  'досье: счётчики отзывов считаются по всей базе',
  dossier.reviewCounts?.negative === 1 && dossier.reviewCounts?.positive === 1,
  dossier.reviewCounts,
);
check('досье: автор замаскирован', dossier.reviews?.[0]?.author?.includes('•••'), dossier.reviews?.[0]);
check('досье: ЧС команды виден', dossier.blacklist?.length === 1, dossier.blacklist);
check('досье: заметка команды на месте', !!dossier.teamNote?.text, dossier.teamNote);
check(
  'досье: реквизиты с маской',
  dossier.requisites?.some((r) => r.mask.includes('•')),
  dossier.requisites,
);
check('досье: риск стал критическим', dossier.risk?.level === 'CRITICAL', dossier.risk);

const foreignDossier = (await call(`/counterparties/${cpId}/dossier`, O)).json;
check(
  'чужая команда не видит наш ЧС и заметку',
  foreignDossier.blacklist?.length === 0 && foreignDossier.teamNote === null,
  { bl: foreignDossier.blacklist?.length, note: foreignDossier.teamNote },
);

// ───────────────────────────── Ордера ─────────────────────────────

section('Синхронизация ордеров');

const syncBody = {
  items: [
    {
      externalId: `${orderNo}-a`,
      side: 'SELL',
      status: 'CANCELLED',
      amountFiat: 5000,
      counterparty: { externalId: cpUid },
    },
    {
      externalId: `${orderNo}-b`,
      side: 'BUY',
      status: 'COMPLETED',
      amountFiat: 15000,
      counterparty: { externalId: `${cpUid}-other`, nickname: 'Lev207' },
    },
  ],
};

const sync = await call('/orders/sync', { method: 'POST', ...T, body: syncBody });
check('sync создал ордера', sync.status === 200 && sync.json.created === 2, sync.json);

const syncAgain = await call('/orders/sync', { method: 'POST', ...T, body: syncBody });
check(
  'повторный sync идемпотентен',
  syncAgain.json.created === 0 && syncAgain.json.updated === 2,
  syncAgain.json,
);

const foreignSync = await call('/orders/sync', {
  method: 'POST',
  ...O,
  body: { items: [{ externalId: `${orderNo}-a`, side: 'BUY', status: 'COMPLETED', amountFiat: 999 }] },
});
check('чужие ордера пропускаются', foreignSync.json.skipped === 1, foreignSync.json);

// ───────────────────────────── Поиск ─────────────────────────────

section('Поиск');

const search = await call('/counterparties/search?q=aminexh', T);
check(
  'поиск по нику находит и помечает ЧС',
  search.json.items?.some((i) => i.externalId === cpUid && i.blacklisted === true),
  search.json.items?.slice(0, 2),
);

const searchByCard = await call('/counterparties/search?q=4276380012345679', T);
check(
  'поиск по номеру карты',
  searchByCard.json.items?.some((i) => i.externalId === cpUid),
  searchByCard.json.items?.slice(0, 2),
);

// ───────────────────────────── Команда и админка ─────────────────────────────

section('Команда и админка');

const teamMe = await call('/teams/me', T);
check(
  'состав команды со статистикой',
  teamMe.json.members?.length === 2 &&
    teamMe.json.members.some((m) => m.binanceUid === traderUid && m.stats.completed >= 1),
  teamMe.json.members?.map((m) => ({ uid: m.binanceUid, stats: m.stats })),
);

const userCard = await call(`/admin/users/${trader.json.user.id}`, A);
check(
  'админ видит объём торгов',
  userCard.json.stats?.volumeFiat === 195000,
  userCard.json.stats,
);
check('админ видит, с кем торговал', userCard.json.partners?.length === 2, userCard.json.partners);
check(
  'партнёр в ЧС помечен',
  userCard.json.partners?.some((p) => p.externalId === cpUid && p.blacklisted === true),
  userCard.json.partners,
);

const block = await call(`/admin/users/${trader.json.user.id}/block`, {
  method: 'POST',
  ...A,
  body: { reason: 'Продажа доступа' },
});
check('блокировка', block.status === 200, block.json);
check('заблокированный теряет доступ', (await call('/me', T)).status === 403);
check(
  'refresh заблокированного отозван',
  (await call('/auth/refresh', { method: 'POST', body: { refreshToken: trader.json.refreshToken } }))
    .status === 401,
);
await call(`/admin/users/${trader.json.user.id}/unblock`, { method: 'POST', ...A });

const sub = await call(`/admin/users/${trader.json.user.id}/subscription`, {
  method: 'POST',
  ...A,
  body: { action: 'extend', days: 30, plan: 'PRO' },
});
check('продление подписки', sub.status === 200 && sub.json.subscription.plan === 'PRO', sub.json);

const cancel = await call(`/admin/users/${trader.json.user.id}/subscription`, {
  method: 'POST',
  ...A,
  body: { action: 'cancel' },
});
check('отмена подписки', cancel.json.subscription.status === 'CANCELLED', cancel.json);

const relogin = await call('/auth/login', {
  method: 'POST',
  body: { binanceUid: traderUid, password: 'traderpass1' },
});
const expired = await call('/counterparties/search?q=aminexh', {
  token: relogin.json.accessToken,
  uid: traderUid,
});
check('отменённая подписка → 402', expired.status === 402, expired.json);

await call(`/admin/users/${trader.json.user.id}/subscription`, {
  method: 'POST',
  ...A,
  body: { action: 'set', plan: 'FREE' },
});

// ───────────────────────────── Сессии ─────────────────────────────

section('Сессии');

const r1 = await call('/auth/refresh', {
  method: 'POST',
  body: { refreshToken: relogin.json.refreshToken },
});
check(
  'ротация refresh выдаёт новый токен',
  r1.status === 200 && r1.json.refreshToken !== relogin.json.refreshToken,
  r1.json,
);

const reuse = await call('/auth/refresh', {
  method: 'POST',
  body: { refreshToken: relogin.json.refreshToken },
});
check(
  'повторное использование старого refresh → 401',
  reuse.status === 401 && reuse.json.error.code === 'REFRESH_REUSED',
  reuse.json,
);

const afterReuse = await call('/auth/refresh', {
  method: 'POST',
  body: { refreshToken: r1.json.refreshToken },
});
check('вся семья токенов отозвана', afterReuse.status === 401, afterReuse.json);

// ───────────────────────────── Права ─────────────────────────────

section('Права доступа');

const relogin2 = await call('/auth/login', {
  method: 'POST',
  body: { binanceUid: traderUid, password: 'traderpass1' },
});
const forbidden = await call('/admin/users', {
  token: relogin2.json.accessToken,
  uid: traderUid,
});
check('пользователь не попадает в админку', forbidden.status === 403, forbidden.json);

const overview = await call('/admin/overview', A);
check('сводка админки считается', overview.json.users >= 2, overview.json);

const audit = await call('/admin/audit?limit=5&action=admin.', A);
check('аудит пишет админские действия', audit.json.items?.length > 0, audit.json.total);

console.log(
  failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
