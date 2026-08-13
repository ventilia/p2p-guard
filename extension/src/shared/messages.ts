/** Протокол обмена между content script / popup и background. */
import type {
  DomSnapshot,
  Dossier,
  MessageTemplate,
  PanelState,
  ReviewRating,
  Session,
  Settings,
} from './types.js';

export type RuntimeRequest =
  | { type: 'AUTH_ACTIVATE'; token: string; password: string; nickname?: string }
  | { type: 'AUTH_LOGIN'; binanceUid?: string; password: string }
  | { type: 'AUTH_LOGOUT' }
  | { type: 'GET_SESSION' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'GET_PANEL_STATE'; tabId?: number }
  | { type: 'REFRESH_DOSSIER' }
  | { type: 'SUBMIT_REVIEW'; counterpartyId: string; rating: ReviewRating; text: string }
  | { type: 'DELETE_REVIEW'; reviewId: string }
  | { type: 'SAVE_TEAM_NOTE'; counterpartyId: string; text: string }
  | { type: 'ADD_BLACKLIST'; counterpartyId: string; reason: string; severity: number; scope: 'GLOBAL' | 'TEAM' }
  | { type: 'REVOKE_BLACKLIST'; entryId: string }
  | { type: 'SYNC_ORDERS' }
  | { type: 'DETECT_ORDER'; orderId: string }
  | { type: 'WS_MESSAGE'; payload: unknown }
  /** Ответ приватного API, перехваченный на самой странице. */
  | {
      type: 'NET_CAPTURE';
      url: string;
      method: string;
      headers: Record<string, string>;
      requestBody: unknown;
      responseBody: unknown;
    }
  /** Что удалось прочитать из вёрстки страницы. */
  | { type: 'DOM_SNAPSHOT'; snapshot: DomSnapshot }
  /** Пользователь ввёл UID контрагента вручную. */
  | { type: 'MANUAL_LOOKUP'; uid: string }
  | { type: 'SEARCH_COUNTERPARTIES'; query: string }
  | { type: 'GET_OWN_UID' }
  | { type: 'SET_OWN_UID'; uid: string };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** Сообщения background → content script. */
export type PushMessage =
  | { type: 'PANEL_STATE'; state: PanelState }
  | { type: 'DOSSIER_UPDATED'; dossier: Dossier; templates: MessageTemplate[] };

export type SessionResponse = { session: Session | null; settings: Settings };

/** Обёртка sendMessage с типами и без исключений на закрытом порту. */
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
