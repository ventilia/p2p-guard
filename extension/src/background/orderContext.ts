/**
 * Сбор контекста ордера из нескольких источников.
 *
 * Приоритет:
 *   1) перехват сетевых ответов самой страницы (самый надёжный — не зависит
 *      от того, как сегодня называются эндпоинты);
 *   2) собственный запрос к приватному API (если страница взяла данные из кэша);
 *   3) разбор DOM (ник и UID видны на странице).
 *
 * Возвращаем ещё и `source`, чтобы в панели было честно видно, откуда данные.
 */
import {
  BinanceApiError,
  extractFromPayload,
  fetchOrderDetail,
  fetchUserDetail,
  normalizeOrderDetail,
  normalizeUserDetail,
} from './binance.js';
import type { CounterpartySnapshot, DomSnapshot, OrderSnapshot } from '../shared/types.js';

export type ContextSource = 'intercept' | 'api' | 'dom' | 'manual';

export type OrderContext = {
  order: OrderSnapshot | null;
  counterparty: CounterpartySnapshot;
  source: ContextSource;
};

type TabCapture = {
  /** Ордера, увиденные в перехвате: ключ — номер ордера. */
  orders: Map<string, { order: OrderSnapshot; counterparty: CounterpartySnapshot | null }>;
  /** Профили пользователей: ключ — userNo. */
  users: Map<string, CounterpartySnapshot>;
  dom: DomSnapshot | null;
  selfHint: string | null;
  updatedAt: number;
};

const captures = new Map<number, TabCapture>();

/** Ожидающие перехвата: разрешаются, как только нужный ордер появится. */
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

/** Пришёл перехваченный ответ страницы — раскладываем по полочкам. */
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

/** Снимок DOM от content script — запасной источник. */
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

/** Догружает статистику профиля, если её ещё нет. */
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

  const hasStats = result.stats && Object.values(result.stats).some((v) => v !== null && v !== undefined);
  if (hasStats) return result;

  // Профиль в перехвате не встретился — спросим сами. Не критично, если не выйдет.
  try {
    const raw = await fetchUserDetail(result.externalId);
    const detail = raw ? normalizeUserDetail(raw) : null;
    if (detail) {
      result = {
        ...result,
        nickname: result.nickname ?? detail.nickname,
        countryCode: detail.countryCode ?? result.countryCode,
        stats: detail.stats,
      };
      capture.users.set(result.externalId, result);
    }
  } catch (err) {
    console.warn('[P2P Guard] профиль контрагента недоступен', err);
  }

  return result;
}

/**
 * Главный резолвер. Ждёт перехват и параллельно пробует API — берём то,
 * что сработало раньше.
 */
export async function resolveOrderContext(
  tabId: number,
  orderId: string,
  selfUserNo: string | null,
  options: { waitMs?: number } = {},
): Promise<OrderContext> {
  const waitMs = options.waitMs ?? 3500;
  const capture = getCapture(tabId);

  // 1. Уже перехвачено.
  const cached = capture.orders.get(orderId);
  if (cached?.counterparty) {
    return {
      order: cached.order,
      counterparty: await enrich(tabId, cached.counterparty),
      source: 'intercept',
    };
  }

  // 2. Гонка: ждём перехват и одновременно спрашиваем API сами.
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

  // 3. DOM: ника и UID достаточно, чтобы показать досье.
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

/** Ручной сценарий: пользователь сам ввёл UID контрагента. */
export async function resolveManual(tabId: number, uid: string): Promise<OrderContext> {
  return {
    order: null,
    counterparty: await enrich(tabId, { externalId: uid }),
    source: 'manual',
  };
}
