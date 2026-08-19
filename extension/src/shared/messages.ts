// протокол обмена между content script, попапом и background
import type {
  DomSnapshot,
  Dossier,
  ExchangeAd,
  ExchangeReview,
  ExchangeStats,
  MessageTemplate,
  PanelState,
  ReviewRating,
  ReviewTag,
  Session,
  Settings,
} from './types.js';

export type RuntimeRequest =
  | { type: 'AUTH_ACTIVATE'; token: string; password: string; nickname?: string; binanceUid?: string }
  | { type: 'AUTH_LOGIN'; binanceUid?: string; password: string }
  | { type: 'AUTH_LOGOUT' }
  | { type: 'GET_SESSION' }
  | { type: 'GET_SETTINGS' }
  | {
      type: 'PROFILE_STATS';
      userNo: string;
      stats: ExchangeStats;
      reviews?: ExchangeReview[];
      ads?: ExchangeAd[];
    }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'GET_PANEL_STATE'; tabId?: number }
  | { type: 'REFRESH_DOSSIER' }
  | {
      type: 'SUBMIT_REVIEW';
      counterpartyId: string;
      rating: ReviewRating;
      tag: ReviewTag;
      text: string;
    }
  | { type: 'DELETE_REVIEW'; reviewId: string }
  | { type: 'SAVE_TEAM_NOTE'; counterpartyId: string; text: string }
  | { type: 'ADD_BLACKLIST'; counterpartyId: string; reason: string; severity: number; scope: 'GLOBAL' | 'TEAM' }
  | { type: 'REVOKE_BLACKLIST'; entryId: string }
  | { type: 'SYNC_ORDERS' }
  | { type: 'DETECT_ORDER'; orderId: string }
  | { type: 'WS_MESSAGE'; payload: unknown }
  // ответ приватного API, перехваченный на самой странице
  | {
      type: 'NET_CAPTURE';
      url: string;
      method: string;
      headers: Record<string, string>;
      requestBody: unknown;
      responseBody: unknown;
    }
  // что удалось прочитать из вёрстки страницы
  | { type: 'DOM_SNAPSHOT'; snapshot: DomSnapshot }
  // пользователь ввёл UID контрагента вручную
  | { type: 'MANUAL_LOOKUP'; uid: string }
  | { type: 'SEARCH_COUNTERPARTIES'; query: string }
  | { type: 'GET_OWN_UID' }
  | { type: 'SET_OWN_UID'; uid: string }
  // что расширение видит на активной вкладке
  | { type: 'GET_TAB_STATUS' }
  // создать свою команду и стать тимлидом
  | { type: 'CREATE_TEAM'; name: string }
  // вошёл ли пользователь в Binance и тем ли аккаунтом
  | { type: 'GET_BINANCE_SESSION' }
  // открыть настоящую страницу входа Binance
  | { type: 'OPEN_BINANCE_LOGIN' }
  // главный экран попапа: с кем недавно торговал и мои отзывы
  | { type: 'GET_RECENT_COUNTERPARTIES' }
  | { type: 'GET_MY_REVIEWS' }
  // досье из попапа, вне контекста ордера
  | { type: 'LOOKUP_COUNTERPARTY'; uid: string }
  | { type: 'GET_DOSSIER'; counterpartyId: string }
  // команда
  | { type: 'GET_TEAM' }
  | { type: 'JOIN_TEAM'; token: string }
  | { type: 'LEAVE_TEAM' }
  | { type: 'CREATE_TEAM_INVITE'; label?: string; maxUses: number; expiresInDays: number }
  // шаблоны быстрых ответов
  | { type: 'GET_TEMPLATES' }
  | { type: 'SAVE_TEMPLATE'; id?: string; title: string; body: string; shared: boolean }
  | { type: 'DELETE_TEMPLATE'; id: string };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// сообщения background → content script
export type PushMessage =
  | { type: 'PANEL_STATE'; state: PanelState }
  | { type: 'DOSSIER_UPDATED'; dossier: Dossier; templates: MessageTemplate[] };

export type SessionResponse = { session: Session | null; settings: Settings };

// обёртка sendMessage с типами и без исключений на закрытом порту
export async function sendMessage<T = unknown>(
  request: RuntimeRequest,
): Promise<RuntimeResponse<T>> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse<T> | undefined;
    if (!response) {
      return { ok: false, error: { code: 'NO_RESPONSE', message: 'Фоновый скрипт не ответил' } };
    }
    return response;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'RUNTIME_ERROR',
        message: err instanceof Error ? err.message : 'Ошибка обмена с расширением',
      },
    };
  }
}
