/**
 * Адаптер Binance P2P.
 *
 * Приватный C2C API не документирован, поэтому расширение НЕ полагается на
 * угаданные пути. Порядок источников данных:
 *
 *   1) Пассивный перехват — страница сама вызывает свой API, а page-hook
 *      отдаёт нам ответы. Работает независимо от того, как называются
 *      эндпоинты сегодня: мы распознаём данные по форме объекта.
 *   2) Активный запрос — если перехвата не случилось (страница взяла данные
 *      из кэша), пробуем известные пути, подставляя заголовки, которые
 *      страница использовала в своих запросах.
 *   3) Разбор DOM — последний рубеж: ник и UID видны на странице.
 *
 * Всё выполняется в браузере пользователя под его же сессией; cookie наружу
 * не передаётся.
 */
import type {
  CounterpartySnapshot,
  ExchangeStats,
  OrderSide,
  OrderSnapshot,
  OrderStatus,
} from '../shared/types.js';

const HOSTS = ['https://p2p.binance.com', 'https://c2c.binance.com', 'https://www.binance.com'] as const;

/** Кандидаты путей. Первый сработавший запоминается и идёт первым дальше. */
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
  userDetail: [
    '/bapi/c2c/v2/friendly/c2c/user/base-detail',
    '/bapi/c2c/v1/friendly/c2c/user/base-detail',
    '/bapi/c2c/v2/public/c2c/userCenter/getUserBaseDetail',
  ],
  selfProfile: [
    '/bapi/accounts/v1/private/account/user/base-detail',
    '/bapi/accounts/v1/protect/account/user/base-detail',
  ],
} as const;

type EndpointKind = keyof typeof ENDPOINT_CANDIDATES;

let preferredHost: string = HOSTS[0];
const preferredPath: Partial<Record<EndpointKind, string>> = {};

/** Заголовки, подсмотренные у самой страницы (csrftoken, device-info и т.п.). */
let borrowedHeaders: Record<string, string> = {};

export function rememberHeaders(headers: Record<string, string>): void {
  if (!headers || !Object.keys(headers).length) return;
  borrowedHeaders = { ...borrowedHeaders, ...headers };
}

export function getBorrowedHeaders(): Record<string, string> {
  return borrowedHeaders;
}

export class BinanceApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BinanceApiError';
    this.code = code;
  }
}

async function csrfFromCookies(): Promise<string | null> {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.binance.com' });
    for (const name of ['csrftoken', 'p20t', 'cr00']) {
      const cookie = cookies.find((c) => c.name === name);
      if (cookie?.value) return cookie.value;
    }
    return null;
  } catch {
    return null;
  }
}

async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    clienttype: 'web',
    ...borrowedHeaders,
  };
  if (!headers.csrftoken) {
    const csrf = await csrfFromCookies();
    if (csrf) headers.csrftoken = csrf;
  }
  return headers;
}

/** POST на первый рабочий (хост, путь) из кандидатов. */
async function post<T>(kind: EndpointKind, body: Record<string, unknown>): Promise<T> {
  const headers = await buildHeaders();

  const paths = [
    ...(preferredPath[kind] ? [preferredPath[kind]!] : []),
    ...ENDPOINT_CANDIDATES[kind].filter((p) => p !== preferredPath[kind]),
  ];
  const hosts = [preferredHost, ...HOSTS.filter((h) => h !== preferredHost)];

  let lastError: Error | null = null;

  for (const path of paths) {
    for (const host of hosts) {
      try {
        const response = await fetch(`${host}${path}`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body),
        });

        if (response.status === 401) {
          throw new BinanceApiError('BINANCE_UNAUTHORIZED', 'Вы не авторизованы на Binance');
        }
        if (response.status === 404 || response.status === 405) {
          lastError = new BinanceApiError('BINANCE_NOT_FOUND', `Путь ${path} недоступен`);
          break; // этот путь мёртв на всех хостах — пробуем следующий
        }
        if (!response.ok) {
          lastError = new BinanceApiError('BINANCE_HTTP', `Binance ответил ${response.status}`);
          continue;
        }

        const data = (await response.json()) as {
          success?: boolean;
          code?: string;
          message?: string;
          data?: T;
        };

        if (data.success === false) {
          lastError = new BinanceApiError(
            data.code ?? 'BINANCE_ERROR',
            data.message ?? 'Binance отклонил запрос',
          );
          continue;
        }

        preferredHost = host;
        preferredPath[kind] = path;
        return (data.data ?? (data as unknown)) as T;
      } catch (err) {
        if (err instanceof BinanceApiError && err.code === 'BINANCE_UNAUTHORIZED') throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastError ?? new BinanceApiError('BINANCE_UNREACHABLE', 'Binance недоступен');
}

// ───────────────────────────── Разбор URL ─────────────────────────────

const ORDER_ID_RE = /(?:orderNo|orderNumber|adOrderNo|orderId)=(\d{6,32})/i;

/**
 * Номер ордера из URL. Поддержаны все известные варианты страницы:
 *   /ru/fiatOrderDetail?orderNo=...
 *   /en/orderDetail?orderNo=...
 *   /trade/order/2081234...
 *   ...#/orderDetail?orderNo=...
 */
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

/**
 * Обходит произвольный JSON и собирает объекты, подходящие под предикат.
 * Так мы находим ордер или профиль независимо от того, во что биржа их
 * завернула на этой неделе.
 */
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

/** Похоже на ордер P2P: есть номер и хотя бы одна сторона сделки. */
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

/** Похоже на профиль пользователя C2C: есть userNo и статистика/ник. */
export const looksLikeUser = (obj: Record<string, unknown>): boolean =>
  hasAny(obj, ['userNo']) &&
  hasAny(obj, ['nickName', 'nickname', 'userStatsRet', 'registerDays', 'merchantLevel']);

// ───────────────────────────── Нормализация ─────────────────────────────

/**
 * Коды статусов Binance C2C. Числовые значения сверены с поведением
 * страницы; строковые варианты встречаются в части ответов.
 */
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

const daysSince = (ms: number | undefined): number | undefined =>
  ms && ms > 0 ? Math.max(0, Math.floor((Date.now() - ms) / 86_400_000)) : undefined;

export type ParsedOrder = {
  order: OrderSnapshot;
  counterparty: CounterpartySnapshot | null;
  /** UID самого пользователя, если его удалось вывести из ответа. */
  selfHint: string | null;
};

/**
 * Приводит «похожий на ордер» объект к нашей модели.
 * `selfUserNo` помогает понять, кто из buyer/seller — контрагент;
 * без него ориентируемся на сторону сделки.
 */
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
      // Мы покупаем → контрагент продавец, а покупатель — это мы.
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

export function normalizeUserDetail(raw: Record<string, unknown>): CounterpartySnapshot | null {
  const externalId = toText(pick(raw, ['userNo', 'userId']));
  if (!externalId) return null;

  const s = (isRecord(raw.userStatsRet) ? raw.userStatsRet : raw) as Record<string, unknown>;

  const orders30d = toNumber(pick(s, ['tradeCountOfLast30day', 'monthOrderCount', 'orderCount30d']));
  const amount30d = toNumber(pick(s, ['tradeAmountOfLast30day', 'monthTradeAmount']));
  const releaseSeconds = toNumber(pick(s, ['avgReleaseTimeOfLast30day', 'avgReleaseTime']));
  const paySeconds = toNumber(pick(s, ['avgPayTimeOfLast30day', 'avgPayTime']));

  let completionRate = toNumber(pick(s, ['finishRate', 'completionRate', 'monthFinishRate']));
  // Иногда приходит в процентах (97.5), иногда долей (0.975) — приводим к доле.
  if (completionRate !== undefined && completionRate > 1) completionRate /= 100;

  const stats: ExchangeStats = {
    registeredDays:
      toNumber(pick(raw, ['registerDays'])) ?? daysSince(toNumber(pick(raw, ['registerTime']))) ?? null,
    firstOrderDays: daysSince(toNumber(pick(raw, ['firstTradeTime', 'firstOrderTime']))) ?? null,
    completionRate: completionRate ?? null,
    totalOrders:
      toNumber(pick(s, ['completedOrderNum', 'totalOrderCount', 'orderCount'])) ?? null,
    orders30d: orders30d ?? null,
    avgAmount30dFiat: orders30d && amount30d ? Math.round(amount30d / orders30d) : null,
    avgReleaseMinutes: releaseSeconds !== undefined ? Math.round(releaseSeconds / 60) : null,
    avgPayMinutes: paySeconds !== undefined ? Math.round(paySeconds / 60) : null,
    positiveCount: toNumber(pick(s, ['positiveCount', 'goodAppraiseCount'])) ?? null,
    negativeCount: toNumber(pick(s, ['negativeCount', 'badAppraiseCount'])) ?? null,
    merchantLevel: toText(pick(raw, ['merchantLevel', 'userType'])) ?? null,
  };

  return {
    externalId,
    nickname: toText(pick(raw, ['nickName', 'nickname', 'userName'])),
    countryCode: toText(pick(raw, ['countryCode', 'country'])),
    stats,
  };
}

/** Достаёт ордер и/или профиль из любого перехваченного ответа. */
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
  try {
    const raw = await post<unknown>('selfProfile', {});
    const found = findObjects(raw, (obj) => hasAny(obj, ['userNo', 'userId', 'uid']))[0];
    return found ? (toText(pick(found, ['userNo', 'userId', 'uid'])) ?? null) : null;
  } catch {
    return null;
  }
}

export async function fetchOrderList(page = 1, rows = 50): Promise<Record<string, unknown>[]> {
  const raw = await post<unknown>('orderList', { page, rows });
  return findObjects(raw, looksLikeOrder);
}
