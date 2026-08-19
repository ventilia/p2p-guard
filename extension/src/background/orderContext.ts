// контекст ордера по приоритету: перехват, свой запрос, разбор DOM
// source отдаём наружу, чтобы в панели было видно, откуда взялись данные
import {
  BinanceApiError,
  extractFromPayload,
  fetchOrderDetail,
  fetchUserDetail,
  fetchUserReviews,
  normalizeOrderDetail,
  normalizeUserDetail,
} from './binance.js';
import { readProfileStats, startProfileProbe } from './profileProbe.js';
import { getSettings } from '../shared/storage.js';
import type { CounterpartySnapshot, DomSnapshot, ExchangeStats, OrderSnapshot } from '../shared/types.js';

export type ContextSource = 'intercept' | 'api' | 'dom' | 'manual';

export type OrderContext = {
  order: OrderSnapshot | null;
  counterparty: CounterpartySnapshot;
  source: ContextSource;
};

type TabCapture = {
  // ордера из перехвата, ключ — номер ордера
  orders: Map<string, { order: OrderSnapshot; counterparty: CounterpartySnapshot | null }>;
  // профили пользователей, ключ — userNo
  users: Map<string, CounterpartySnapshot>;
  dom: DomSnapshot | null;
  selfHint: string | null;
  updatedAt: number;
};

const captures = new Map<number, TabCapture>();

// разрешаются, как только нужный ордер появится в перехвате
const waiters = new Map<number, { orderId: string; resolve: () => void }[]>();

const CAPTURE_TTL_MS = 10 * 60_000;

function getCapture(tabId: number): TabCapture {
  const existing = captures.get(tabId);
  if (existing && Date.now() - existing.updatedAt < CAPTURE_TTL_MS) return existing;

  const fresh: TabCapture = {
    orders: new Map(),
    users: new Map(),
    dom: null,
    selfHint: null,
    updatedAt: Date.now(),
  };
  captures.set(tabId, fresh);
  return fresh;
}

export function clearCapture(tabId: number): void {
  captures.delete(tabId);
  waiters.delete(tabId);
}

// пришёл перехваченный ответ страницы, раскладываем по полочкам
export function recordNetworkCapture(
  tabId: number,
  payload: unknown,
  selfUserNo: string | null,
): void {
  const parsed = extractFromPayload(payload, selfUserNo);
  if (!parsed.order && !parsed.users.length) return;

  const capture = getCapture(tabId);
  capture.updatedAt = Date.now();

  for (const user of parsed.users) {
    const previous = capture.users.get(user.externalId);
    capture.users.set(user.externalId, {
      ...previous,
      ...user,
      stats: { ...previous?.stats, ...user.stats },
    });
  }

  if (parsed.order?.order.externalId) {
    const { order, counterparty, selfHint } = parsed.order;
    capture.orders.set(order.externalId, { order, counterparty });
    if (selfHint && !capture.selfHint) capture.selfHint = selfHint;

    const pending = waiters.get(tabId);
    if (pending?.length) {
      const stillWaiting = pending.filter((w) => {
        if (w.orderId === order.externalId) {
          w.resolve();
          return false;
        }
        return true;
      });
      waiters.set(tabId, stillWaiting);
    }
  }
}

// снимок DOM от content script, запасной источник
export function recordDomSnapshot(tabId: number, snapshot: DomSnapshot): void {
  const capture = getCapture(tabId);
  capture.dom = snapshot;
  capture.updatedAt = Date.now();
}

export function getSelfHint(tabId: number): string | null {
  return captures.get(tabId)?.selfHint ?? null;
}

function waitForCapture(tabId: number, orderId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const list = waiters.get(tabId) ?? [];
    const entry = { orderId, resolve: () => resolve() };
    list.push(entry);
    waiters.set(tabId, list);

    setTimeout(() => {
      const current = waiters.get(tabId);
      if (current) waiters.set(tabId, current.filter((w) => w !== entry));
      resolve();
    }, timeoutMs);
  });
}

// догружает статистику профиля, если её ещё нет
async function enrich(
  tabId: number,
  counterparty: CounterpartySnapshot,
): Promise<CounterpartySnapshot> {
  const capture = getCapture(tabId);
  const captured = capture.users.get(counterparty.externalId);

  let result: CounterpartySnapshot = captured
    ? {
        ...counterparty,
        nickname: counterparty.nickname ?? captured.nickname,
        countryCode: counterparty.countryCode ?? captured.countryCode,
        stats: { ...captured.stats, ...counterparty.stats },
      }
    : counterparty;

  // считаем ДО подмешивания страницы: иначе прочитанные с вёрстки цифры
  // выглядели бы как готовый профиль и запрос к бирже больше не уходил бы
  const hasStats = result.stats && Object.values(result.stats).some((v) => v !== null && v !== undefined);

  // профиль и отзывы биржи тянем параллельно: отзывы нужны, даже когда
  // статистика уже пришла из перехвата
  const [detail, reviews] = await Promise.all([
    hasStats
      ? Promise.resolve(null)
      : fetchUserDetail(result.externalId)
          .then((raw) => (raw ? normalizeUserDetail(raw) : null))
          .catch((err) => {
            console.warn('[P2P Guard] профиль контрагента недоступен', err);
            return null;
          }),
    fetchUserReviews(result.externalId),
  ]);

  if (detail) {
    result = {
      ...result,
      nickname: result.nickname ?? detail.nickname,
      countryCode: detail.countryCode ?? result.countryCode,
      stats: detail.stats,
    };
  }
  if (reviews.length) result = { ...result, exchangeReviews: reviews };

  // цифры со страницы: биржа рисует их сама, и это источник, не зависящий от
  // имён полей в недокументированном ответе. Данные биржи главнее, поэтому
  // страница только дополняет пустые места
  const fromPage = capture.dom?.stats;
  if (fromPage) {
    const merged = { ...fromPage };
    for (const [key, value] of Object.entries(result.stats ?? {})) {
      if (value !== null && value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
    result = { ...result, stats: merged };
  }

  // кэшируем только настоящие данные биржи: производное значение здесь
  // выглядело бы как готовая статистика, и профиль перестал бы запрашиваться
  // проверки аккаунта и дата регистрации есть только в профиле
  const cached = await readProfileStats(result.externalId);
  if (cached) {
    result = { ...result, stats: fill(result.stats, cached.stats) };
    // отзывы и объявления есть только в профиле, из ордера их не видно
    if (cached.reviews?.length && !result.exchangeReviews?.length) {
      result = { ...result, exchangeReviews: cached.reviews };
    }
    if (cached.ads?.length) result = { ...result, exchangeAds: cached.ads };
  }

  // за недостающим идём фоновой вкладкой и НЕ ждём её: панель должна
  // появиться сразу, поля дозаполнятся, когда страница отчитается
  // без кэша идём всегда: объявлений и отзывов биржи в ордере нет вовсе
  if (!cached || needsProfile(result.stats)) {
    void getSettings().then(({ enrichFromProfile }) => {
      if (enrichFromProfile) void startProfileProbe(result.externalId);
    });
  }

  if (detail || reviews.length) capture.users.set(result.externalId, result);

  return result;
}

// поля, ради которых стоит открывать профиль: в ордере их не показывают
const PROFILE_ONLY: (keyof ExchangeStats)[] = ['joinedAt', 'kycVerified', 'totalOrders'];

function needsProfile(stats: ExchangeStats | undefined): boolean {
  return PROFILE_ONLY.some((key) => stats?.[key] === undefined || stats?.[key] === null);
}

// то, что уже знаем, важнее: профиль только заполняет пустые места
function fill(base: ExchangeStats | undefined, extra: ExchangeStats): ExchangeStats {
  const merged: ExchangeStats = { ...extra };
  for (const [key, value] of Object.entries(base ?? {})) {
    if (value !== null && value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

// ждём перехват и параллельно пробуем API, берём что сработало раньше
export async function resolveOrderContext(
  tabId: number,
  orderId: string,
  selfUserNo: string | null,
  options: { waitMs?: number } = {},
): Promise<OrderContext> {
  const waitMs = options.waitMs ?? 3500;
  const capture = getCapture(tabId);

  // уже перехвачено
  const cached = capture.orders.get(orderId);
  if (cached?.counterparty) {
    return {
      order: cached.order,
      counterparty: await enrich(tabId, cached.counterparty),
      source: 'intercept',
    };
  }

  // гонка: ждём перехват и одновременно спрашиваем API сами
  let apiError: unknown = null;
  const apiAttempt = fetchOrderDetail(orderId)
    .then((raw) => normalizeOrderDetail(raw, selfUserNo ?? capture.selfHint))
    .catch((err: unknown) => {
      apiError = err;
      return null;
    });

  await Promise.race([waitForCapture(tabId, orderId, waitMs), apiAttempt]);

  const afterWait = capture.orders.get(orderId);
  if (afterWait?.counterparty) {
    return {
      order: afterWait.order,
      counterparty: await enrich(tabId, afterWait.counterparty),
      source: 'intercept',
    };
  }

  const fromApi = await apiAttempt;
  if (fromApi?.counterparty) {
    if (fromApi.selfHint && !capture.selfHint) capture.selfHint = fromApi.selfHint;
    capture.orders.set(orderId, { order: fromApi.order, counterparty: fromApi.counterparty });
    return {
      order: fromApi.order,
      counterparty: await enrich(tabId, fromApi.counterparty),
      source: 'api',
    };
  }

  // из DOM: ника и UID достаточно, чтобы показать досье
  const dom = capture.dom;
  if (dom?.counterpartyUid) {
    return {
      order: dom.orderId
        ? {
            externalId: dom.orderId,
            side: dom.side ?? 'BUY',
            status: dom.status ?? 'UNKNOWN',
            fiat: dom.fiat,
            amountFiat: dom.amountFiat,
          }
        : null,
      counterparty: await enrich(tabId, {
        externalId: dom.counterpartyUid,
        nickname: dom.counterpartyNickname,
      }),
      source: 'dom',
    };
  }

  if (apiError instanceof BinanceApiError) throw apiError;
  throw new BinanceApiError(
    'COUNTERPARTY_UNKNOWN',
    'Не удалось определить контрагента. Обновите страницу ордера или укажите UID вручную.',
  );
}

// пользователь сам ввёл UID контрагента
export async function resolveManual(tabId: number, uid: string): Promise<OrderContext> {
  return {
    order: null,
    counterparty: await enrich(tabId, { externalId: uid }),
    source: 'manual',
  };
}
