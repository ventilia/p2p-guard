// оркестратор: ловит ордер, собирает контекст, ходит в бэкенд, пушит панель
// MV3 усыпляет воркер, поэтому состояние панели дублируется в storage.session
import { ApiError, apiRequest, authRequest } from './api.js';
import {
  BinanceApiError,
  detectOrderId,
  fetchOrderList,
  fetchOwnUserNo,
  fetchUserDetail,
  normalizeOrderDetail,
  normalizeUserDetail,
  readSessionState,
  rememberHeaders,
} from './binance.js';
import {
  clearCapture,
  getSelfHint,
  recordDomSnapshot,
  recordNetworkCapture,
  resolveManual,
  resolveOrderContext,
  type OrderContext,
} from './orderContext.js';
import type { RuntimeRequest, RuntimeResponse } from '../shared/messages.js';
import { extractRequisites, maskRequisite } from '../shared/parse.js';
import {
  getLastOrderSync,
  getSession,
  getSettings,
  setLastOrderSync,
  setSession,
  setSettings,
} from '../shared/storage.js';
import type {
  CounterpartySnapshot,
  Dossier,
  MessageTemplate,
  OrderSnapshot,
  PanelState,
  RequisiteType,
  Session,
  Settings,
} from '../shared/types.js';

const SYNC_ALARM = 'p2pguard.sync-orders';
const SYNC_INTERVAL_MINUTES = 15;
const OWN_UID_KEY = 'pg.ownUid';

// состояние панели по вкладкам
const panelStates = new Map<number, PanelState>();
// активный контрагент по вкладке, к нему привязываем реквизиты из чата
const activeCounterparty = new Map<number, string>();
// уже отправленные реквизиты, чтобы не слать одно и то же
const seenRequisites = new Map<number, Set<string>>();
// сумма открытого ордера по вкладке: без неё при обновлении досье пропадал бы
// фактор сравнения со средним чеком, и балл менялся бы сам собой
const activeOrderFiat = new Map<number, number>();

// путь к досье с суммой текущего ордера, если она известна
function dossierPath(tabId: number, counterpartyId: string): string {
  const amount = activeOrderFiat.get(tabId);
  const query = amount === undefined ? '' : `?orderFiat=${amount}`;
  return `/counterparties/${counterpartyId}/dossier${query}`;
}

let ownUserNoCache: string | null = null;

// ───────────────────────────── UID пользователя ─────────────────────────────

// нужен, чтобы понять, кто из двух сторон ордера контрагент
// источники по убыванию надёжности, до запроса к бирже доходит редко
async function getOwnUserNo(tabId?: number): Promise<string | null> {
  if (ownUserNoCache) return ownUserNoCache;

  // учётка расширения привязана к UID биржи — это и есть ответ
  const session = await getSession();
  if (session?.user.binanceUid) {
    ownUserNoCache = session.user.binanceUid;
    return ownUserNoCache;
  }

  // указан вручную: нужно на этапе активации, до входа
  const stored = await chrome.storage.local.get(OWN_UID_KEY);
  const manual = stored[OWN_UID_KEY] as string | undefined;
  if (manual) {
    ownUserNoCache = manual;
    return manual;
  }

  // подсмотрен в перехваченном ордере
  if (tabId !== undefined) {
    const hint = getSelfHint(tabId);
    if (hint) {
      ownUserNoCache = hint;
      return hint;
    }
  }

  // последний вариант — спросить у самой биржи
  const fetched = await fetchOwnUserNo();
  if (fetched) ownUserNoCache = fetched;
  return fetched;
}

async function setOwnUserNo(uid: string): Promise<void> {
  ownUserNoCache = uid;
  await chrome.storage.local.set({ [OWN_UID_KEY]: uid });
}

// ───────────────────────────── Состояние панели ─────────────────────────────

async function setPanelState(tabId: number, state: PanelState): Promise<void> {
  panelStates.set(tabId, state);
  await chrome.storage.session.set({ [`pg.panel.${tabId}`]: state });
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PANEL_STATE', state });
  } catch {
    // content script ещё не поднялся, он сам запросит состояние при старте
  }
}

async function getPanelState(tabId: number): Promise<PanelState> {
  const inMemory = panelStates.get(tabId);
  if (inMemory) return inMemory;
  const stored = await chrome.storage.session.get(`pg.panel.${tabId}`);
  return (stored[`pg.panel.${tabId}`] as PanelState | undefined) ?? { status: 'idle' };
}

function errorState(err: unknown, orderId?: string): PanelState {
  if (err instanceof ApiError) {
    if (err.code === 'NO_SESSION' || err.code === 'SESSION_EXPIRED') {
      return { status: 'unauthorized', message: 'Войдите в расширение, чтобы видеть досье' };
    }
    return { status: 'error', message: err.message, code: err.code, orderId };
  }
  if (err instanceof BinanceApiError) {
    return {
      status: 'error',
      message: err.message,
      code: err.code,
      orderId,
      // лечится ручным вводом UID контрагента
      canRetryManually:
        err.code === 'COUNTERPARTY_UNKNOWN' ||
        err.code === 'ORDER_SHAPE_UNKNOWN' ||
        err.code === 'BINANCE_UNREACHABLE',
    };
  }
  return {
    status: 'error',
    message: err instanceof Error ? err.message : 'Неизвестная ошибка',
    orderId,
    canRetryManually: true,
  };
}

// после смены команды роль и teamId в сессии устаревают, панель их не увидит
async function refreshProfile(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  try {
    const me = await apiRequest<{ user: Session['user'] }>('/me');
    await setSession({ ...session, user: me.user });
  } catch (err) {
    console.warn('[P2P Guard] не удалось обновить профиль', err);
  }
}

// чтобы смена темы в попапе доезжала до уже открытой панели
async function broadcastSettings(settings: Settings): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['https://*.binance.com/*'] });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings }).catch(() => undefined);
  }
}

async function loadTemplates(): Promise<MessageTemplate[]> {
  try {
    const data = await apiRequest<{ items: MessageTemplate[] }>('/templates');
    return data.items;
  } catch {
    return [];
  }
}

async function lookupDossier(
  counterparty: CounterpartySnapshot,
  order?: OrderSnapshot | null,
): Promise<Dossier> {
  return apiRequest<Dossier>('/counterparties/lookup', {
    method: 'POST',
    body: {
      exchange: 'BINANCE',
      externalId: counterparty.externalId,
      nickname: counterparty.nickname,
      countryCode: counterparty.countryCode,
      maskedPhone: counterparty.maskedPhone,
      stats: counterparty.stats,
      // ордер отправляем, только если он полноценный
      order: order?.externalId ? order : undefined,
    },
  });
}

// готовое состояние панели по контексту ордера
async function buildReadyState(
  tabId: number,
  orderId: string,
  context: OrderContext,
): Promise<PanelState> {
  const session = await getSession();
  const dossier = await lookupDossier(context.counterparty, context.order);

  activeCounterparty.set(tabId, dossier.counterparty.id);
  seenRequisites.delete(tabId);

  const orderFiat = context.order?.amountFiat;
  if (typeof orderFiat === 'number') activeOrderFiat.set(tabId, orderFiat);
  else activeOrderFiat.delete(tabId);

  const templates = await loadTemplates();

  return {
    status: 'ready',
    orderId,
    dossier,
    templates,
    source: context.source,
    role: session?.user.role ?? 'USER',
    hasTeam: Boolean(session?.user.teamId),
    requisiteAlert: null,
  };
}

// главный сценарий: открылась страница ордера
async function handleOrder(tabId: number, orderId: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.panelEnabled) return;

  const session = await getSession();
  if (!session) {
    await setPanelState(tabId, {
      status: 'unauthorized',
      message: 'Войдите в расширение, чтобы видеть досье контрагента',
    });
    return;
  }

  await setPanelState(tabId, { status: 'loading', orderId });

  try {
    const selfUserNo = await getOwnUserNo(tabId);
    const context = await resolveOrderContext(tabId, orderId, selfUserNo);
    await setPanelState(tabId, await buildReadyState(tabId, orderId, context));
  } catch (err) {
    console.warn('[P2P Guard] не удалось собрать досье', err);
    await setPanelState(tabId, errorState(err, orderId));
  }
}

// перезапрос досье для вкладки с тем же ордером
async function refreshTab(tabId: number): Promise<PanelState> {
  const state = await getPanelState(tabId);
  const orderId = 'orderId' in state ? state.orderId : undefined;

  // в ручном режиме ордера нет, обновляем досье по контрагенту
  if (!orderId) {
    const counterpartyId = activeCounterparty.get(tabId);
    if (!counterpartyId) return state;
    try {
      const dossier = await apiRequest<Dossier>(dossierPath(tabId, counterpartyId));
      if (state.status === 'ready') {
        const next: PanelState = { ...state, dossier };
        await setPanelState(tabId, next);
        return next;
      }
    } catch (err) {
      const next = errorState(err);
      await setPanelState(tabId, next);
      return next;
    }
    return state;
  }

  await handleOrder(tabId, orderId);
  return getPanelState(tabId);
}

// точечное обновление досье без повторного похода в Binance
async function refreshDossierOnly(tabId: number): Promise<PanelState> {
  const state = await getPanelState(tabId);
  const counterpartyId = activeCounterparty.get(tabId);
  if (state.status !== 'ready' || !counterpartyId) return refreshTab(tabId);

  try {
    const dossier = await apiRequest<Dossier>(`/counterparties/${counterpartyId}/dossier`);
    const next: PanelState = { ...state, dossier };
    await setPanelState(tabId, next);
    return next;
  } catch (err) {
    const next = errorState(err, state.orderId);
    await setPanelState(tabId, next);
    return next;
  }
}

// ───────────────────────────── Синхронизация ордеров ─────────────────────────

async function syncOrders(force = false): Promise<{ created: number; updated: number } | null> {
  const settings = await getSettings();
  if (!settings.autoSyncOrders && !force) return null;

  const session = await getSession();
  if (!session) return null;

  const last = await getLastOrderSync();
  if (!force && Date.now() - last < SYNC_INTERVAL_MINUTES * 60_000) return null;

  try {
    const selfUserNo = await getOwnUserNo();
    const raw = await fetchOrderList(1, 50);

    const items = raw
      .map((item) => {
        const { order, counterparty } = normalizeOrderDetail(item, selfUserNo);
        if (!order.externalId) return null;
        return {
          ...order,
          counterparty: counterparty
            ? {
                externalId: counterparty.externalId,
                nickname: counterparty.nickname,
                countryCode: counterparty.countryCode,
              }
            : undefined,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (!items.length) {
      await setLastOrderSync(Date.now());
      return { created: 0, updated: 0 };
    }

    const result = await apiRequest<{ created: number; updated: number }>('/orders/sync', {
      method: 'POST',
      body: { exchange: 'BINANCE', items },
    });

    await setLastOrderSync(Date.now());
    return result;
  } catch (err) {
    console.warn('[P2P Guard] синхронизация ордеров не удалась', err);
    return null;
  }
}

// ───────────────────────────── Чат: реквизиты ─────────────────────────────

// формат сообщений чата плавает, поэтому достаём текст мягко
function extractChatText(payload: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (typeof payload === 'string') return payload.length > 4000 ? null : payload;
  if (!payload || typeof payload !== 'object') return null;

  const obj = payload as Record<string, unknown>;
  for (const key of ['content', 'message', 'text', 'body', 'msg']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  if (Array.isArray(obj.data)) {
    const parts = obj.data.map((item) => extractChatText(item, depth + 1)).filter(Boolean);
    return parts.length ? parts.join('\n') : null;
  }
  if (obj.data && typeof obj.data === 'object') return extractChatText(obj.data, depth + 1);

  return null;
}

// карты и телефоны из чата: новый реквизит посреди сделки — классическая схема
async function handleChatPayload(tabId: number, payload: unknown): Promise<void> {
  const settings = await getSettings();
  if (!settings.captureChatRequisites) return;

  const counterpartyId = activeCounterparty.get(tabId);
  if (!counterpartyId) return;

  const text = extractChatText(payload);
  if (!text) return;

  const items = extractRequisites(text);
  if (!items.length) return;

  const seen = seenRequisites.get(tabId) ?? new Set<string>();
  const fresh = items.filter((item) => !seen.has(`${item.type}:${item.value}`));
  if (!fresh.length) return;

  for (const item of fresh) seen.add(`${item.type}:${item.value}`);
  seenRequisites.set(tabId, seen);

  try {
    await apiRequest('/requisites/observe', {
      method: 'POST',
      body: { counterpartyId, items: fresh },
    });

    const state = await getPanelState(tabId);
    if (state.status !== 'ready') return;

    const known = new Set(state.dossier.requisites.map((r) => r.mask));
    const firstItem = fresh[0];
    if (!firstItem) return;

    const mask = maskRequisite(firstItem.value);
    const isNew = !known.has(mask);

    const dossier = await apiRequest<Dossier>(`/counterparties/${counterpartyId}/dossier`);
    await setPanelState(tabId, {
      ...state,
      dossier,
      requisiteAlert: isNew ? { mask, type: firstItem.type as RequisiteType } : null,
    });
  } catch (err) {
    console.warn('[P2P Guard] не удалось сохранить реквизиты', err);
  }
}

// ───────────────────────────── События браузера ─────────────────────────────

function onNavigation(tabId: number, url: string | undefined): void {
  const orderId = detectOrderId(url);

  if (!orderId) {
    if (panelStates.has(tabId)) {
      void setPanelState(tabId, { status: 'idle' });
      activeCounterparty.delete(tabId);
    }
    return;
  }

  const current = panelStates.get(tabId);
  const alreadyShown =
    current &&
    (current.status === 'ready' || current.status === 'loading') &&
    current.orderId === orderId;

  if (!alreadyShown) void handleOrder(tabId, orderId);
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' || info.url) onNavigation(tabId, info.url ?? tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  panelStates.delete(tabId);
  activeCounterparty.delete(tabId);
  activeOrderFiat.delete(tabId);
  seenRequisites.delete(tabId);
  clearCapture(tabId);
  void chrome.storage.session.remove(`pg.panel.${tabId}`);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void syncOrders();
});

// ───────────────────────────── Обработка сообщений ─────────────────────────────

async function handleMessage(
  request: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const tabId = sender.tab?.id;

  switch (request.type) {
    case 'GET_SESSION':
      return { ok: true, data: { session: await getSession(), settings: await getSettings() } };

    case 'AUTH_ACTIVATE': {
      // указанный вручную UID приоритетнее: автоопределение работает,
      // только если пользователь уже вошёл на binance.com в этом браузере
      const uid = request.binanceUid?.trim() || (await getOwnUserNo(tabId));
      if (!uid) {
        return {
          ok: false,
          error: {
            code: 'BINANCE_UID_UNKNOWN',
            message:
              'Не удалось определить ваш UID Binance. Войдите на binance.com в этом браузере или впишите UID в поле ниже.',
          },
        };
      }
      if (request.binanceUid?.trim()) await setOwnUserNo(request.binanceUid.trim());
      const session = await authRequest('/auth/activate', {
        token: request.token,
        binanceUid: uid,
        password: request.password,
        nickname: request.nickname,
      });
      return { ok: true, data: session };
    }

    case 'AUTH_LOGIN': {
      const uid = request.binanceUid || (await getOwnUserNo(tabId));
      if (!uid) {
        return {
          ok: false,
          error: { code: 'BINANCE_UID_UNKNOWN', message: 'Укажите UID Binance вручную' },
        };
      }
      if (request.binanceUid) await setOwnUserNo(request.binanceUid);

      const session = await authRequest('/auth/login', {
        binanceUid: uid,
        password: request.password,
      });
      return { ok: true, data: session };
    }

    case 'AUTH_LOGOUT': {
      const session = await getSession();
      if (session) {
        try {
          await apiRequest('/auth/logout', {
            method: 'POST',
            auth: false,
            body: { refreshToken: session.refreshToken },
          });
        } catch {
          // выходим локально в любом случае
        }
      }
      await setSession(null);
      return { ok: true, data: { ok: true } };
    }

    case 'GET_SETTINGS':
      return { ok: true, data: await getSettings() };

    // вошёл ли пользователь в Binance и тем ли аккаунтом, что привязан к учётке
    case 'GET_BINANCE_SESSION': {
      const [state, session] = await Promise.all([readSessionState(), getSession()]);

      // UID из живой сессии браузера: он определяет, от чьего имени уйдут запросы
      // ограничиваем ожидание: без этого попап не показывал бы блок сессии
      // все те секунды, пока перебираются пути к недоступной бирже
      let browserUid: string | null = null;
      if (state.loggedIn) {
        browserUid = await Promise.race([
          fetchOwnUserNo().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);
      }

      const accountUid = session?.user.binanceUid ?? null;
      return {
        ok: true,
        data: {
          loggedIn: state.loggedIn,
          hasPageHeaders: state.hasPageHeaders,
          browserUid,
          accountUid,
          mismatch: Boolean(browserUid && accountUid && browserUid !== accountUid),
        },
      };
    }

    // пароль от биржи не спрашиваем: куку должен поставить сам Binance,
    // иначе запросы не пройдут антифрод
    case 'OPEN_BINANCE_LOGIN': {
      const tab = await chrome.tabs.create({ url: 'https://accounts.binance.com/ru/login' });
      return { ok: true, data: { tabId: tab.id ?? null } };
    }

    // что расширение видит на активной вкладке: сам ли поймало ордер
    case 'GET_TAB_STATUS': {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = active?.url ?? '';
      const isBinance = /^https:\/\/[^/]*\bbinance\.com\//i.test(url);
      const orderId = detectOrderId(url);

      let counterpartyNick: string | null = null;
      if (active?.id !== undefined) {
        const state = await getPanelState(active.id);
        if (state.status === 'ready') {
          counterpartyNick = state.dossier.counterparty.nickname ?? state.dossier.counterparty.externalId;
        }
      }

      return { ok: true, data: { isBinance, orderId, counterpartyNick } };
    }

    case 'SET_SETTINGS': {
      const next = await setSettings(request.patch);
      await broadcastSettings(next);
      return { ok: true, data: next };
    }

    case 'GET_PANEL_STATE': {
      const id = request.tabId ?? tabId;
      if (id === undefined) return { ok: true, data: { status: 'idle' } as PanelState };
      return { ok: true, data: await getPanelState(id) };
    }

    case 'REFRESH_DOSSIER': {
      if (tabId === undefined) {
        return { ok: false, error: { code: 'NO_TAB', message: 'Нет активной вкладки' } };
      }
      return { ok: true, data: await refreshTab(tabId) };
    }

    case 'MANUAL_LOOKUP': {
      if (tabId === undefined) {
        return { ok: false, error: { code: 'NO_TAB', message: 'Нет активной вкладки' } };
      }
      await setPanelState(tabId, { status: 'loading', orderId: request.uid });
      try {
        const context = await resolveManual(tabId, request.uid);
        const state = await buildReadyState(tabId, '', context);
        await setPanelState(tabId, state);
        return { ok: true, data: state };
      } catch (err) {
        const state = errorState(err);
        await setPanelState(tabId, state);
        return { ok: true, data: state };
      }
    }

    case 'SUBMIT_REVIEW': {
      await apiRequest('/reviews', {
        method: 'POST',
        body: {
          counterpartyId: request.counterpartyId,
          rating: request.rating,
          tag: request.tag,
          text: request.text,
        },
      });
      return { ok: true, data: tabId !== undefined ? await refreshDossierOnly(tabId) : null };
    }

    case 'DELETE_REVIEW': {
      await apiRequest(`/reviews/${request.reviewId}`, { method: 'DELETE' });
      return { ok: true, data: tabId !== undefined ? await refreshDossierOnly(tabId) : null };
    }

    case 'SAVE_TEAM_NOTE': {
      await apiRequest('/teams/notes', {
        method: 'PUT',
        body: { counterpartyId: request.counterpartyId, text: request.text },
      });
      return { ok: true, data: tabId !== undefined ? await refreshDossierOnly(tabId) : null };
    }

    case 'ADD_BLACKLIST': {
      await apiRequest('/blacklist', {
        method: 'POST',
        body: {
          counterpartyId: request.counterpartyId,
          reason: request.reason,
          severity: request.severity,
          scope: request.scope,
        },
      });
      return { ok: true, data: tabId !== undefined ? await refreshDossierOnly(tabId) : null };
    }

    case 'REVOKE_BLACKLIST': {
      await apiRequest(`/blacklist/${request.entryId}`, { method: 'DELETE' });
      return { ok: true, data: tabId !== undefined ? await refreshDossierOnly(tabId) : null };
    }

    case 'SYNC_ORDERS':
      return { ok: true, data: await syncOrders(true) };

    case 'SEARCH_COUNTERPARTIES': {
      const data = await apiRequest(
        `/counterparties/search?q=${encodeURIComponent(request.query)}`,
      );
      return { ok: true, data };
    }

    case 'DETECT_ORDER': {
      if (tabId === undefined) {
        return { ok: false, error: { code: 'NO_TAB', message: 'Нет активной вкладки' } };
      }
      const current = panelStates.get(tabId);
      const same =
        current &&
        (current.status === 'ready' || current.status === 'loading') &&
        current.orderId === request.orderId;
      if (!same) await handleOrder(tabId, request.orderId);
      return { ok: true, data: await getPanelState(tabId) };
    }

    case 'NET_CAPTURE': {
      rememberHeaders(request.headers);
      if (tabId !== undefined && request.responseBody) {
        recordNetworkCapture(tabId, request.responseBody, ownUserNoCache);
      }
      return { ok: true, data: null };
    }

    case 'DOM_SNAPSHOT': {
      if (tabId !== undefined) recordDomSnapshot(tabId, request.snapshot);
      return { ok: true, data: null };
    }

    case 'WS_MESSAGE': {
      if (tabId !== undefined) void handleChatPayload(tabId, request.payload);
      return { ok: true, data: null };
    }

    // досье из попапа: ордера нет, поэтому находим по UID и обогащаем профилем
    case 'LOOKUP_COUNTERPARTY': {
      let snapshot: CounterpartySnapshot = { externalId: request.uid };
      try {
        const raw = await fetchUserDetail(request.uid);
        const detail = raw ? normalizeUserDetail(raw) : null;
        if (detail) snapshot = detail;
      } catch {
        // биржа недоступна, покажем то, что есть в нашей базе
      }
      return { ok: true, data: await lookupDossier(snapshot, null) };
    }

    case 'GET_DOSSIER':
      return {
        ok: true,
        data: await apiRequest<Dossier>(`/counterparties/${request.counterpartyId}/dossier`),
      };

    case 'GET_TEAM':
      return { ok: true, data: await apiRequest('/teams/me') };

    case 'JOIN_TEAM': {
      const result = await apiRequest('/teams/join', {
        method: 'POST',
        body: { token: request.token },
      });
      // команда меняет права, сессию надо перечитать
      await refreshProfile();
      return { ok: true, data: result };
    }

    case 'CREATE_TEAM': {
      const result = await apiRequest('/teams', {
        method: 'POST',
        body: { name: request.name },
      });
      // создатель становится тимлидом, роль в сессии обязана обновиться
      await refreshProfile();
      return { ok: true, data: result };
    }

    case 'LEAVE_TEAM': {
      const result = await apiRequest('/teams/leave', { method: 'POST' });
      await refreshProfile();
      return { ok: true, data: result };
    }

    case 'CREATE_TEAM_INVITE':
      return {
        ok: true,
        data: await apiRequest('/teams/me/invites', {
          method: 'POST',
          body: {
            label: request.label,
            maxUses: request.maxUses,
            expiresInDays: request.expiresInDays,
          },
        }),
      };

    case 'GET_TEMPLATES':
      return { ok: true, data: { items: await loadTemplates() } };

    case 'SAVE_TEMPLATE': {
      const body = { title: request.title, body: request.body, shared: request.shared };
      const data = request.id
        ? await apiRequest(`/templates/${request.id}`, { method: 'PUT', body })
        : await apiRequest('/templates', { method: 'POST', body });
      return { ok: true, data };
    }

    case 'DELETE_TEMPLATE':
      return {
        ok: true,
        data: await apiRequest(`/templates/${request.id}`, { method: 'DELETE' }),
      };

    case 'GET_OWN_UID':
      return { ok: true, data: { uid: await getOwnUserNo(tabId) } };

    case 'SET_OWN_UID': {
      await setOwnUserNo(request.uid);
      return { ok: true, data: { uid: request.uid } };
    }

    default:
      return { ok: false, error: { code: 'UNKNOWN_MESSAGE', message: 'Неизвестный запрос' } };
  }
}

chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse) => {
  handleMessage(request, sender)
    .then(sendResponse)
    .catch((err: unknown) => {
      const error =
        err instanceof ApiError || err instanceof BinanceApiError
          ? { code: err.code, message: err.message }
          : {
              code: 'INTERNAL',
              message: err instanceof Error ? err.message : 'Внутренняя ошибка расширения',
            };
      sendResponse({ ok: false, error } satisfies RuntimeResponse);
    });

  // true: ответ придёт асинхронно
  return true;
});
