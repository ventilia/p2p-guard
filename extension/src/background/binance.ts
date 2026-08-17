// приватный C2C API не документирован, поэтому на угаданные пути не полагаемся:
// сначала перехват ответов страницы, потом свой запрос, потом разбор DOM
// всё идёт под сессией пользователя, cookie наружу не уходит
import type {
  CounterpartySnapshot,
  ExchangeReview,
  ExchangeStats,
  OrderSide,
  OrderSnapshot,
  OrderStatus,
} from '../shared/types.js';

const HOSTS = ['https://p2p.binance.com', 'https://c2c.binance.com', 'https://www.binance.com'] as const;

// первый сработавший путь запоминается и дальше идёт первым
const ENDPOINT_CANDIDATES = {
  orderDetail: [
    '/bapi/c2c/v2/private/c2c/order-match/order-detail',
    '/bapi/c2c/v1/private/c2c/order-match/order-detail',
    '/bapi/c2c/v2/private/c2c/orderMatch/getUserOrderDetail',
  ],
  orderList: [
    '/bapi/c2c/v1/private/c2c/order-match/order-list',
    '/bapi/c2c/v2/private/c2c/order-match/order-list',
    '/bapi/c2c/v1/private/c2c/orderMatch/listUserOrderHistory',
  ],
  // profile-and-ads-list подтверждён внешними источниками, поэтому первый
  userDetail: [
    '/bapi/c2c/v2/friendly/c2c/user/profile-and-ads-list',
    '/bapi/c2c/v2/friendly/c2c/user/base-detail',
    '/bapi/c2c/v1/friendly/c2c/user/base-detail',
    '/bapi/c2c/v2/public/c2c/userCenter/getUserBaseDetail',
  ],
  // отзывы биржи под карточкой контрагента, вкладка «Обратная связь»
  userReviews: [
    '/bapi/c2c/v2/friendly/c2c/user/feedback/list',
    '/bapi/c2c/v1/friendly/c2c/user/feedback/list',
    '/bapi/c2c/v2/friendly/c2c/user/feedback/search',
  ],
  // сняты с живой страницы ордера, а не подобраны
  selfProfile: [
    '/bapi/accounts/v1/private/account/get-user-base-info',
    '/bapi/c2c/v1/private/c2c/user/profile',
    '/bapi/accounts/v1/private/account/user/userInfo',
  ],
} as const;

type EndpointKind = keyof typeof ENDPOINT_CANDIDATES;

// свой профиль страница запрашивает методом GET, остальное — POST
const GET_KINDS = new Set<EndpointKind>(['selfProfile']);

// одиночный запрос не должен подвешивать всю проверку
const REQUEST_TIMEOUT_MS = 7000;

const ROUTE_KEY = 'pg.binance.route';

// выученный маршрут к API: рабочий хост, пути и заголовки со страницы
// хранится в storage, а не в модуле: MV3 усыпляет воркер, и после пробуждения
// перебор всех путей на всех хостах начинался бы заново
type Route = {
  host: string;
  paths: Partial<Record<EndpointKind, string>>;
  headers: Record<string, string>;
  // отпечаток сессии, которой принадлежат заголовки: после смены аккаунта
  // старый csrftoken приведёт к отказу биржи
  sessionKey?: string;
};

// по наличию этих кук судим, что пользователь вошёл на Binance
const SESSION_COOKIES = ['p20t', 'cr00', 'logined'] as const;
const CSRF_COOKIES = ['csrftoken', 'p20t', 'cr00'] as const;

// в этих куках биржа хранит значение вида web.<uid>.<хэш>
const UID_COOKIES = ['p20t', 'r20t', 'd1og', 'r2o1', 'f30l'] as const;

async function binanceCookies(): Promise<chrome.cookies.Cookie[]> {
  try {
    return await chrome.cookies.getAll({ domain: '.binance.com' });
  } catch {
    return [];
  }
}

/**
 * UID пользователя прямо из куки: значение p20t выглядит как
 * `web.540652971.<хэш>`, то есть номер аккаунта лежит вторым сегментом.
 * Раньше за ним ходили запросом, и на медленной сети попап успевал показать
 * «не удалось определить UID» — теперь сеть для этого не нужна вовсе.
 */
export async function readOwnUidFromCookies(): Promise<string | null> {
  const cookies = await binanceCookies();
  for (const name of UID_COOKIES) {
    const value = cookies.find((c) => c.name === name)?.value;
    const uid = /^web\.(\d{4,20})\./.exec(value ?? '')?.[1];
    if (uid) return uid;
  }
  return null;
}

// не криптография: нужен только чтобы заметить смену аккаунта
function sessionKeyOf(cookies: chrome.cookies.Cookie[]): string | null {
  for (const name of SESSION_COOKIES) {
    const value = cookies.find((c) => c.name === name)?.value;
    if (value) return `${name}:${value.slice(-12)}`;
  }
  return null;
}

let route: Route | null = null;
let routeLoading: Promise<Route> | null = null;

async function getRoute(): Promise<Route> {
  if (route) return route;
  if (!routeLoading) {
    routeLoading = (async () => {
      let saved: Partial<Route> | undefined;
      try {
        const stored = await chrome.storage.local.get(ROUTE_KEY);
        saved = stored[ROUTE_KEY] as Partial<Route> | undefined;
      } catch {
        // хранилище недоступно, поедем на значениях по умолчанию
      }
      route = {
        host: saved?.host ?? HOSTS[0],
        paths: saved?.paths ?? {},
        headers: saved?.headers ?? {},
      };
      return route;
    })();
  }
  return routeLoading;
}

// в фоне: результат запроса не должен ждать записи в storage
function persistRoute(): void {
  if (!route) return;
  void chrome.storage.local.set({ [ROUTE_KEY]: route }).catch(() => undefined);
}

export function rememberHeaders(headers: Record<string, string>): void {
  if (!headers || !Object.keys(headers).length) return;
  void (async () => {
    const current = await getRoute();
    current.headers = { ...current.headers, ...headers };
    // помечаем сессию, чтобы buildHeaders выбросил чужие заголовки
    const key = sessionKeyOf(await binanceCookies());
    if (key) current.sessionKey = key;
    persistRoute();
  })();
}

export async function getBorrowedHeaders(): Promise<Record<string, string>> {
  return (await getRoute()).headers;
}

// сброс выученного маршрута, если биржа переехала
export async function resetRoute(): Promise<void> {
  route = null;
  routeLoading = null;
  try {
    await chrome.storage.local.remove(ROUTE_KEY);
  } catch {
    // не критично
  }
}

export class BinanceApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BinanceApiError';
    this.code = code;
  }
}

// состояние сессии биржи: нужно, чтобы объяснить, почему запросы не проходят
export type BinanceSession = {
  loggedIn: boolean;
  // UID, под которым пользователь вошёл в браузере
  uid: string | null;
  // успели ли подсмотреть живые заголовки со страницы биржи
  hasPageHeaders: boolean;
};

export async function readSessionState(): Promise<Omit<BinanceSession, 'uid'>> {
  const cookies = await binanceCookies();
  const current = await getRoute();
  return {
    loggedIn: sessionKeyOf(cookies) !== null,
    hasPageHeaders: Object.keys(current.headers).length > 0,
  };
}

async function buildHeaders(): Promise<Record<string, string>> {
  const current = await getRoute();
  const cookies = await binanceCookies();
  const key = sessionKeyOf(cookies);

  // сессия сменилась, заголовки от прошлого аккаунта только навредят
  if (key !== null && current.sessionKey && current.sessionKey !== key) {
    current.headers = {};
    current.sessionKey = key;
    persistRoute();
  } else if (key !== null && !current.sessionKey) {
    current.sessionKey = key;
    persistRoute();
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    clienttype: 'web',
    // c2c-эндпоинты страница зовёт именно с этим заголовком
    c2ctype: 'c2c_web',
    ...current.headers,
  };

  if (!headers.csrftoken) {
    for (const name of CSRF_COOKIES) {
      const value = cookies.find((c) => c.name === name)?.value;
      if (value) {
        headers.csrftoken = value;
        break;
      }
    }
  }

  // антифрод-заголовки страницы: часть из них лежит в куках, её и подставляем
  const cookieHeaders: [string, string][] = [
    ['bnc-uuid', 'bnc-uuid'],
    ['fvideo-id', 'BNC_FV_KEY'],
    ['lang', 'lang'],
  ];
  for (const [header, cookie] of cookieHeaders) {
    if (headers[header]) continue;
    const value = cookies.find((c) => c.name === cookie)?.value;
    if (value) headers[header] = value;
  }

  return headers;
}

// одна попытка «хост + путь», бросает BinanceApiError если не вышло
async function attempt<T>(
  host: string,
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown> | null,
  signal: AbortSignal,
): Promise<{ host: string; data: T }> {
  const response = await fetch(`${host}${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    throw new BinanceApiError('BINANCE_UNAUTHORIZED', 'Вы не авторизованы на Binance');
  }
  if (response.status === 404 || response.status === 405) {
    throw new BinanceApiError('BINANCE_NOT_FOUND', `Путь ${path} недоступен`);
  }
  if (!response.ok) {
    throw new BinanceApiError('BINANCE_HTTP', `Binance ответил ${response.status}`);
  }

  const json = (await response.json()) as {
    success?: boolean;
    code?: string;
    message?: string;
    data?: T;
  };

  if (json.success === false) {
    // биржа ответила, но отказала — чаще всего такого пользователя нет
    const code = json.code ?? 'BINANCE_ERROR';
    const notFound = /not.?exist|no.?such|000002/i.test(`${code} ${json.message ?? ''}`);
    throw new BinanceApiError(
      notFound ? 'COUNTERPARTY_NOT_ON_EXCHANGE' : code,
      json.message ?? 'Binance отклонил запрос',
    );
  }

  return { host, data: (json.data ?? (json as unknown)) as T };
}

const isUnauthorized = (err: unknown) =>
  err instanceof BinanceApiError && err.code === 'BINANCE_UNAUTHORIZED';
const isNotOnExchange = (err: unknown) =>
  err instanceof BinanceApiError && err.code === 'COUNTERPARTY_NOT_ON_EXCHANGE';

// хосты для одного пути пробуем параллельно и берём первый успех
// выученную пару сохраняем, поэтому со второго раза запрос ровно один
async function post<T>(kind: EndpointKind, payload: Record<string, unknown>): Promise<T> {
  const [headers, current] = await Promise.all([buildHeaders(), getRoute()]);

  const body = GET_KINDS.has(kind) ? null : payload;
  const known = current.paths[kind];

  // маршрут выучен — идём одним запросом, без веера по хостам
  if (known) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const winner = await attempt<T>(current.host, known, headers, body, controller.signal);
      return winner.data;
    } catch (err) {
      if (isUnauthorized(err) || isNotOnExchange(err)) throw err;
      // не вышло — биржа могла переехать, ниже полный перебор
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  const paths = known
    ? [known, ...ENDPOINT_CANDIDATES[kind].filter((p) => p !== known)]
    : [...ENDPOINT_CANDIDATES[kind]];
  const hosts = [current.host, ...HOSTS.filter((h) => h !== current.host)];

  let lastError: Error | null = null;

  for (const path of paths) {
    const controllers = hosts.map(() => new AbortController());
    const timers = controllers.map((c) =>
      setTimeout(() => c.abort(new BinanceApiError('BINANCE_TIMEOUT', 'Binance не ответил')), REQUEST_TIMEOUT_MS),
    );

    try {
      const winner = await Promise.any(
        hosts.map((host, i) => attempt<T>(host, path, headers, body, controllers[i]!.signal)),
      );

      current.host = winner.host;
      current.paths[kind] = path;
      persistRoute();
      return winner.data;
    } catch (err) {
      const errors = err instanceof AggregateError ? err.errors : [err];
      // эти два случая перебором путей не лечатся, отвечаем сразу
      const fatal = errors.find((e) => isUnauthorized(e) || isNotOnExchange(e));
      if (fatal) throw fatal;
      lastError = (errors.find((e) => e instanceof BinanceApiError) as Error | undefined) ?? lastError;
    } finally {
      for (const t of timers) clearTimeout(t);
      for (const c of controllers) c.abort();
    }
  }

  throw lastError ?? new BinanceApiError('BINANCE_UNREACHABLE', 'Binance недоступен');
}

// ───────────────────────────── Разбор URL ─────────────────────────────

const ORDER_ID_RE = /(?:orderNo|orderNumber|adOrderNo|orderId)=(\d{6,32})/i;

// номер ордера из URL: query, хэш SPA-роутера или длинное число в пути
export function detectOrderId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)binance\.com$/i.test(parsed.hostname)) return null;

    const fromQuery = ORDER_ID_RE.exec(parsed.search) ?? ORDER_ID_RE.exec(parsed.hash);
    if (fromQuery?.[1]) return fromQuery[1];

    const fromPath = /\/(\d{15,32})(?:\/|$)/.exec(parsed.pathname);
    if (fromPath?.[1]) return fromPath[1];

    return null;
  } catch {
    return null;
  }
}

// ───────────────────────────── Распознавание данных ─────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ищем объект по форме, а не по пути — тогда обёртка ответа не важна
export function findObjects(
  root: unknown,
  predicate: (value: Record<string, unknown>) => boolean,
  maxDepth = 6,
): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];

  const walk = (node: unknown, depth: number) => {
    if (depth > maxDepth || found.length > 40) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;

    if (predicate(node)) found.push(node);
    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  walk(root, 0);
  return found;
}

const hasAny = (obj: Record<string, unknown>, keys: string[]) =>
  keys.some((key) => obj[key] !== undefined && obj[key] !== null && obj[key] !== '');

// похоже на ордер: есть номер и хотя бы одна сторона сделки
export const looksLikeOrder = (obj: Record<string, unknown>): boolean =>
  hasAny(obj, ['orderNumber', 'orderNo', 'advOrderNumber']) &&
  hasAny(obj, [
    'buyerNickname',
    'sellerNickname',
    'buyerName',
    'sellerName',
    'buyerUserNo',
    'sellerUserNo',
    'counterPartUserNo',
    'orderStatus',
    'tradeType',
  ]);

// похоже на профиль: есть userNo и статистика или ник
export const looksLikeUser = (obj: Record<string, unknown>): boolean =>
  hasAny(obj, ['userNo']) &&
  hasAny(obj, [
    'nickName',
    'nickname',
    'userStatsRet',
    'userDetailVo',
    'registerDays',
    'merchantLevel',
    'userType',
    'monthOrderCount',
    'monthFinishRate',
    'positiveRate',
  ]);

// похоже на отзыв биржи: есть оценка и что-то от автора
export const looksLikeFeedback = (obj: Record<string, unknown>): boolean =>
  hasAny(obj, ['appraiseType', 'feedbackType', 'positiveOrNegative', 'appraise']) &&
  hasAny(obj, ['content', 'remark', 'appraiseContent', 'authorNickName', 'nickName', 'createTime']);

// ───────────────────────────── Нормализация ─────────────────────────────

// числовые коды сверены с поведением страницы, строковые — с документацией C2C
const NUMERIC_STATUS: Record<number, OrderStatus> = {
  1: 'PENDING',
  2: 'PAID',
  3: 'APPEALING',
  4: 'COMPLETED',
  5: 'CANCELLED',
  6: 'CANCELLED',
  7: 'APPEALING',
  8: 'CANCELLED',
};

const STRING_STATUS: Record<string, OrderStatus> = {
  PENDING: 'PENDING',
  UNPAID: 'PENDING',
  TRADING: 'PENDING',
  BUYER_PAYED: 'PAID',
  PAID: 'PAID',
  PAY_SUCCESS: 'PAID',
  DISTRIBUTING: 'PAID',
  COMPLETED: 'COMPLETED',
  FINISHED: 'COMPLETED',
  SUCCESS: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
  CANCELLED_BY_SYSTEM: 'CANCELLED',
  APPEALING: 'APPEALING',
  IN_APPEAL: 'APPEALING',
};

export function normalizeStatus(raw: unknown): OrderStatus {
  if (typeof raw === 'number') return NUMERIC_STATUS[raw] ?? 'UNKNOWN';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) return NUMERIC_STATUS[Number(trimmed)] ?? 'UNKNOWN';
    return STRING_STATUS[trimmed.toUpperCase().replace(/[\s-]/g, '_')] ?? 'UNKNOWN';
  }
  return 'UNKNOWN';
}

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const toText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
};

const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

/**
 * Страна по коду телефона.
 *
 * Биржа отдаёт номер контрагента замаскированным, но международный префикс в
 * нём остаётся — этого хватает, чтобы назвать страну, даже когда страна
 * подтверждения в ответе не пришла. Список — коридоры, где реально идёт P2P.
 * Длинные коды стоят раньше коротких: +996 не должен совпасть с +9.
 */
const PHONE_COUNTRY: [string, string][] = [
  ['998', 'UZB'],
  ['996', 'KGZ'],
  ['995', 'GEO'],
  ['994', 'AZE'],
  ['993', 'TKM'],
  ['992', 'TJK'],
  ['971', 'ARE'],
  ['380', 'UKR'],
  ['374', 'ARM'],
  ['373', 'MDA'],
  ['375', 'BLR'],
  ['90', 'TUR'],
  ['77', 'KAZ'],
  ['76', 'KAZ'],
  ['7', 'RUS'],
];

export function countryFromPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, '');
  if (digits.length < 5) return null;

  for (const [prefix, code] of PHONE_COUNTRY) {
    if (digits.startsWith(prefix)) return code;
  }
  return null;
}

// коды приходят и двухбуквенными, и трёхбуквенными — не переводим, только чистим
const toCountry = (value: unknown): string | null => {
  const text = toText(value)?.toUpperCase().replace(/[^A-Z]/g, '');
  return text && text.length >= 2 && text.length <= 3 ? text : null;
};

// биржа отдаёт признаки верификации то булевыми, то строкой, то 1/0
const toFlag = (value: unknown): boolean | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (text === '1' || text === 'true' || text === 'y') return true;
  if (text === '0' || text === 'false' || text === 'n') return false;
  // непустая строка вроде замаскированной почты сама по себе означает «есть»
  return true;
};

const daysSince = (ms: number | undefined): number | undefined =>
  ms && ms > 0 ? Math.max(0, Math.floor((Date.now() - ms) / 86_400_000)) : undefined;

export type ParsedOrder = {
  order: OrderSnapshot;
  counterparty: CounterpartySnapshot | null;
  // UID самого пользователя, если удалось вывести из ответа
  selfHint: string | null;
};

// selfUserNo говорит, кто из buyer/seller контрагент, без него смотрим на сторону
export function normalizeOrderDetail(
  raw: Record<string, unknown>,
  selfUserNo: string | null,
): ParsedOrder {
  const externalId = toText(pick(raw, ['orderNumber', 'orderNo', 'advOrderNumber'])) ?? '';

  const tradeType = toText(pick(raw, ['tradeType', 'side', 'orderType']))?.toUpperCase();
  const side: OrderSide = tradeType === 'SELL' ? 'SELL' : 'BUY';

  const status = normalizeStatus(
    pick(raw, ['orderStatus', 'status', 'orderStatusName', 'statusName']),
  );

  const buyerNo = toText(pick(raw, ['buyerUserNo', 'buyerNo', 'buyerUserId']));
  const sellerNo = toText(pick(raw, ['sellerUserNo', 'sellerNo', 'sellerUserId']));
  const buyerNick = toText(pick(raw, ['buyerNickname', 'buyerName', 'buyerNickName']));
  const sellerNick = toText(pick(raw, ['sellerNickname', 'sellerName', 'sellerNickName']));
  const buyerPhone = toText(pick(raw, ['buyerMobilePhone', 'buyerPhone']));
  const sellerPhone = toText(pick(raw, ['sellerMobilePhone', 'sellerPhone']));

  let counterpartyNo = toText(pick(raw, ['counterPartUserNo', 'counterpartyUserNo']));
  let counterpartyNick = toText(pick(raw, ['counterPartNickName', 'counterpartyNickname']));
  let counterpartyPhone: string | undefined;
  let selfHint: string | null = null;

  const assignFromBuyer = () => {
    counterpartyNo = buyerNo;
    counterpartyNick = buyerNick;
    counterpartyPhone = buyerPhone;
  };
  const assignFromSeller = () => {
    counterpartyNo = sellerNo;
    counterpartyNick = sellerNick;
    counterpartyPhone = sellerPhone;
  };

  if (!counterpartyNo) {
    if (selfUserNo && buyerNo === selfUserNo) {
      assignFromSeller();
    } else if (selfUserNo && sellerNo === selfUserNo) {
      assignFromBuyer();
    } else if (side === 'BUY') {
      // мы покупаем, значит контрагент продавец
      assignFromSeller();
      selfHint = buyerNo ?? null;
    } else {
      assignFromBuyer();
      selfHint = sellerNo ?? null;
    }
  }

  const amountFiat = toNumber(pick(raw, ['totalPrice', 'amount', 'fiatAmount', 'totalAmount']));
  const createdAt = toNumber(pick(raw, ['createTime', 'createDate', 'orderCreateTime']));

  const order: OrderSnapshot = {
    externalId,
    side,
    status,
    asset: toText(pick(raw, ['asset', 'assetType', 'cryptoAsset'])),
    fiat: toText(pick(raw, ['fiatUnit', 'fiat', 'fiatSymbol', 'currencyCode'])),
    amountFiat,
    amountAsset: toNumber(pick(raw, ['amount', 'cryptoAmount', 'quantity'])),
    price: toNumber(pick(raw, ['price', 'unitPrice'])),
    createdAtExchange: createdAt ? new Date(createdAt).toISOString() : undefined,
  };

  const counterparty: CounterpartySnapshot | null = counterpartyNo
    ? {
        externalId: counterpartyNo,
        nickname: counterpartyNick,
        maskedPhone: counterpartyPhone,
      }
    : null;

  return { order, counterparty, selfHint };
}

// доля приходит и процентом (97.5), и дробью (0.975) — приводим к 0..1
function toShare(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value > 1 ? value / 100 : value;
}

export function normalizeUserDetail(raw: Record<string, unknown>): CounterpartySnapshot | null {
  const externalId = toText(pick(raw, ['userNo', 'userId']));
  if (!externalId) return null;

  // профиль лежит в userDetailVo, userStatsRet или плоско — поддерживаем всё
  const detail = (isRecord(raw.userDetailVo) ? raw.userDetailVo : raw) as Record<string, unknown>;
  const s = (isRecord(detail.userStatsRet) ? detail.userStatsRet : detail) as Record<string, unknown>;

  const orders30d = toNumber(
    pick(s, [
      'tradeCountOfLast30day',
      'monthOrderCount',
      'orderCount30d',
      'completedOrderNumOfLatest30day',
    ]),
  );
  const amount30d = toNumber(pick(s, ['tradeAmountOfLast30day', 'monthTradeAmount']));
  const releaseSeconds = toNumber(pick(s, ['avgReleaseTimeOfLast30day', 'avgReleaseTime']));
  const paySeconds = toNumber(pick(s, ['avgPayTimeOfLast30day', 'avgPayTime']));

  const completionRate = toShare(
    toNumber(pick(s, ['finishRate', 'completionRate', 'monthFinishRate'])),
  );
  const positiveRate = toShare(toNumber(pick(s, ['positiveRate', 'goodRate'])));

  const positiveCount = toNumber(pick(s, ['positiveCount', 'goodAppraiseCount']));
  const negativeCount = toNumber(pick(s, ['negativeCount', 'badAppraiseCount']));

  const registerTime = toNumber(pick(detail, ['registerTime', 'registerDate', 'createTime']));

  // страна подтверждения: сперва то, что назвала биржа, иначе код телефона
  const fromExchange = toCountry(
    pick(detail, [
      'kycCountryCode',
      'kycCountry',
      'certifiedCountry',
      'residentCountryCode',
      'countryCode',
      'country',
      'nationality',
    ]),
  );
  const kycCountry =
    fromExchange ??
    countryFromPhone(toText(pick(detail, ['mobilePhone', 'maskedPhone', 'mobile', 'phone'])));

  const totalOrders = toNumber(
    pick(s, ['completedOrderNum', 'totalFinishCount', 'totalOrderCount', 'orderCount']),
  );
  // средний чек биржа не отдаёт, считаем сами: оборот на число сделок
  const totalAmount = toNumber(
    pick(s, ['totalTradeAmount', 'tradeAmount', 'allTradeAmount', 'finishAmount']),
  );
  const avgAmountFiat =
    totalOrders && totalAmount ? Math.round(totalAmount / totalOrders) : undefined;

  const stats: ExchangeStats = {
    registeredDays:
      toNumber(pick(detail, ['registerDays'])) ??
      daysSince(toNumber(pick(detail, ['registerTime']))) ??
      null,
    firstOrderDays:
      toNumber(pick(detail, ['firstOrderDays'])) ??
      daysSince(toNumber(pick(detail, ['firstTradeTime', 'firstOrderTime']))) ??
      null,
    completionRate: completionRate ?? null,
    totalOrders: totalOrders ?? null,
    orders30d: orders30d ?? null,
    avgAmountFiat: avgAmountFiat ?? null,
    avgAmount30dFiat: orders30d && amount30d ? Math.round(amount30d / orders30d) : null,
    avgReleaseMinutes: releaseSeconds !== undefined ? Math.round(releaseSeconds / 60) : null,
    avgPayMinutes: paySeconds !== undefined ? Math.round(paySeconds / 60) : null,
    positiveRate: positiveRate ?? null,
    positiveCount: positiveCount ?? null,
    negativeCount: negativeCount ?? null,
    merchantLevel: toText(pick(detail, ['merchantLevel', 'userType'])) ?? null,
    // всё, что карточка контрагента показывает на самой бирже
    completionRate30d:
      toShare(toNumber(pick(s, ['monthFinishRate', 'finishRateOfLast30day']))) ?? null,
    joinedAt: registerTime ? new Date(registerTime).toISOString() : null,
    emailVerified: toFlag(pick(detail, ['emailVerified', 'email'])),
    phoneVerified: toFlag(pick(detail, ['mobileVerified', 'smsVerified', 'mobile'])),
    kycVerified: toFlag(pick(detail, ['kycVerified', 'identityVerified', 'realNameVerified'])),
    feedbackCount:
      toNumber(pick(s, ['feedbackCount', 'appraiseCount'])) ??
      (positiveCount !== undefined && negativeCount !== undefined
        ? positiveCount + negativeCount
        : null),
    followers: toNumber(pick(s, ['followerCount', 'followers'])) ?? null,
    blockedBy: toNumber(pick(s, ['blockedCount', 'blackListCount'])) ?? null,
    kycCountry,
    kycCountrySource: kycCountry ? (fromExchange ? 'exchange' : 'phone') : null,
    totalVolumeFiat: totalAmount ?? null,
    volume30dFiat: amount30d ?? null,
  };

  return {
    externalId,
    nickname: toText(pick(detail, ['nickName', 'nickname', 'userName'])),
    countryCode: toText(pick(detail, ['countryCode', 'country'])),
    stats,
  };
}

// биржа кодирует оценку по-разному: 1/0, 'positive'/'negative', true/false
export function normalizeFeedback(raw: Record<string, unknown>): ExchangeReview {
  const rawRating = pick(raw, ['appraiseType', 'feedbackType', 'positiveOrNegative', 'appraise']);
  const asText = String(rawRating ?? '').toLowerCase();
  const negative = asText === '0' || asText === '2' || asText === 'false' || /neg|bad|плох/.test(asText);

  const createdAt = toNumber(pick(raw, ['createTime', 'createDate', 'updateTime']));

  return {
    rating: negative ? 'NEGATIVE' : 'POSITIVE',
    text: toText(pick(raw, ['content', 'remark', 'appraiseContent'])) ?? null,
    author: toText(pick(raw, ['authorNickName', 'nickName', 'nickname', 'userNo'])) ?? null,
    createdAt: createdAt ? new Date(createdAt).toISOString() : null,
  };
}

// достаёт ордер и профиль из любого перехваченного ответа
export function extractFromPayload(
  payload: unknown,
  selfUserNo: string | null,
): { order?: ParsedOrder; users: CounterpartySnapshot[] } {
  const orders = findObjects(payload, looksLikeOrder);
  const users = findObjects(payload, looksLikeUser);

  return {
    order: orders[0] ? normalizeOrderDetail(orders[0], selfUserNo) : undefined,
    users: users
      .map((u) => normalizeUserDetail(u))
      .filter((u): u is CounterpartySnapshot => u !== null),
  };
}

// ───────────────────────────── Активные вызовы ─────────────────────────────

export async function fetchOrderDetail(orderNo: string): Promise<Record<string, unknown>> {
  const raw = await post<unknown>('orderDetail', { adOrderNo: orderNo, orderNo, orderNumber: orderNo });
  const found = findObjects(raw, looksLikeOrder)[0];
  if (!found) throw new BinanceApiError('ORDER_SHAPE_UNKNOWN', 'Не удалось разобрать ответ по ордеру');
  return found;
}

export async function fetchUserDetail(userNo: string): Promise<Record<string, unknown> | null> {
  const raw = await post<unknown>('userDetail', { userNo });
  return findObjects(raw, looksLikeUser)[0] ?? null;
}

export async function fetchOwnUserNo(): Promise<string | null> {
  // кука отвечает мгновенно и не зависит от доступности биржи
  const fromCookie = await readOwnUidFromCookies();
  if (fromCookie) return fromCookie;

  try {
    const raw = await post<unknown>('selfProfile', {});
    const found = findObjects(raw, (obj) => hasAny(obj, ['userNo', 'userId', 'uid']))[0];
    return found ? (toText(pick(found, ['userNo', 'userId', 'uid'])) ?? null) : null;
  } catch {
    return null;
  }
}

// отзывы биржи; путь пока не подтверждён живым ответом, поэтому молча пустой
// список вместо ошибки — досье должно собираться и без них
export async function fetchUserReviews(userNo: string): Promise<ExchangeReview[]> {
  try {
    const raw = await post<unknown>('userReviews', { userNo, page: 1, rows: 20 });
    return findObjects(raw, looksLikeFeedback).map(normalizeFeedback).slice(0, 20);
  } catch {
    return [];
  }
}

export async function fetchOrderList(page = 1, rows = 50): Promise<Record<string, unknown>[]> {
  const raw = await post<unknown>('orderList', { page, rows });
  return findObjects(raw, looksLikeOrder);
}
