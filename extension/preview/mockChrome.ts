// импортируется первым, чтобы к моменту работы Panel глобальный chrome уже был
// отвечает на те же сообщения, что и service worker, состояние держит в памяти
import { fixture } from './fixture';
import type {
  MessageTemplate,
  PanelState,
  ReviewRating,
  ReviewTag,
  Session,
  Settings,
} from '../src/shared/types.js';

type Listener = (message: unknown) => void;

const listeners = new Set<Listener>();

let panelState: PanelState = fixture.panelState;
let session: Session | null = fixture.session;
let settings: Settings = fixture.settings;
// копия, чтобы правки шаблонов не портили фикстуру
const templates: MessageTemplate[] = structuredClone(fixture.templates);

function push(state: PanelState): void {
  panelState = state;
  for (const listener of listeners) listener({ type: 'PANEL_STATE', state });
}

// пересобирает досье после действия, как это делает бэкенд
function patchDossier(mutate: (d: PanelState & { status: 'ready' }) => void): PanelState {
  if (panelState.status !== 'ready') return panelState;
  const next = structuredClone(panelState) as PanelState & { status: 'ready' };
  mutate(next);
  return next;
}

const nowIso = () => new Date().toISOString();
const newId = () => `demo-${Math.random().toString(36).slice(2, 10)}`;

type BinanceSessionMock = {
  loggedIn: boolean;
  hasPageHeaders: boolean;
  browserUid: string | null;
  accountUid: string | null;
  mismatch: boolean;
};

const LOGGED_IN: BinanceSessionMock = {
  loggedIn: true,
  hasPageHeaders: true,
  browserUid: '287431109',
  accountUid: '287431109',
  mismatch: false,
};

const LOGGED_OUT: BinanceSessionMock = {
  loggedIn: false,
  hasPageHeaders: false,
  browserUid: null,
  accountUid: '287431109',
  mismatch: false,
};

const WRONG_ACCOUNT: BinanceSessionMock = {
  loggedIn: true,
  hasPageHeaders: true,
  browserUid: '905512348',
  accountUid: '287431109',
  mismatch: true,
};

let binanceSession: BinanceSessionMock = { ...LOGGED_IN };

// переключение сценария сессии биржи
export function setBinanceSessionScenario(name: 'ok' | 'logged-out' | 'mismatch'): void {
  binanceSession =
    name === 'logged-out' ? { ...LOGGED_OUT } : name === 'mismatch' ? { ...WRONG_ACCOUNT } : { ...LOGGED_IN };
}

async function handle(request: Record<string, unknown>): Promise<unknown> {
  const type = request.type as string;

  switch (type) {
    case 'GET_PANEL_STATE':
      return { ok: true, data: panelState };

    case 'GET_SESSION':
      return { ok: true, data: { session, settings } };

    case 'GET_SETTINGS':
      return { ok: true, data: settings };

    case 'SET_SETTINGS':
      settings = { ...settings, ...(request.patch as Partial<Settings>) };
      // как и настоящий background: панель должна переехать без перезагрузки
      for (const listener of listeners) listener({ type: 'SETTINGS_CHANGED', settings });
      return { ok: true, data: settings };

    case 'AUTH_LOGOUT':
      session = null;
      return { ok: true, data: { ok: true } };

    case 'AUTH_LOGIN':
    case 'AUTH_ACTIVATE':
      session = fixture.session;
      return { ok: true, data: session };

    case 'REFRESH_DOSSIER':
      return { ok: true, data: panelState };

    case 'SUBMIT_REVIEW': {
      const next = patchDossier((state) => {
        const rating = request.rating as ReviewRating;
        const tag = request.tag as ReviewTag;
        const text = request.text as string;
        const own = state.dossier.reviews.find((r) => r.isOwn);
        if (own) {
          own.rating = rating;
          own.tag = tag;
          own.text = text;
          own.createdAt = nowIso();
        } else {
          state.dossier.reviews.unshift({
            id: newId(),
            rating,
            tag,
            text,
            createdAt: nowIso(),
            author: 'Ваш отзыв',
            isOwn: true,
            isTeam: true,
            canDelete: true,
          });
          const key = rating.toLowerCase() as 'positive' | 'neutral' | 'negative';
          state.dossier.reviewCounts[key] += 1;
        }
      });
      push(next);
      return { ok: true, data: next };
    }

    case 'DELETE_REVIEW': {
      const next = patchDossier((state) => {
        const index = state.dossier.reviews.findIndex((r) => r.id === request.reviewId);
        if (index >= 0) {
          const [removed] = state.dossier.reviews.splice(index, 1);
          if (removed) {
            const key = removed.rating.toLowerCase() as 'positive' | 'neutral' | 'negative';
            state.dossier.reviewCounts[key] = Math.max(0, state.dossier.reviewCounts[key] - 1);
          }
        }
      });
      push(next);
      return { ok: true, data: next };
    }

    case 'SAVE_TEAM_NOTE': {
      const next = patchDossier((state) => {
        const text = request.text as string;
        state.dossier.teamNote = text
          ? { text, updatedAt: nowIso(), author: '•••311' }
          : null;
      });
      push(next);
      return { ok: true, data: next };
    }

    case 'ADD_BLACKLIST': {
      const next = patchDossier((state) => {
        state.dossier.blacklist.unshift({
          id: newId(),
          scope: request.scope as 'GLOBAL' | 'TEAM',
          reason: request.reason as string,
          severity: request.severity as number,
          source: 'manual',
          createdAt: nowIso(),
          author: '•••311',
          canRevoke: true,
        });
      });
      push(next);
      return { ok: true, data: next };
    }

    case 'REVOKE_BLACKLIST': {
      const next = patchDossier((state) => {
        state.dossier.blacklist = state.dossier.blacklist.filter((b) => b.id !== request.entryId);
      });
      push(next);
      return { ok: true, data: next };
    }

    case 'SEARCH_COUNTERPARTIES': {
      const query = String(request.query ?? '').toLowerCase();
      const items = fixture.searchItems.filter(
        (item) =>
          item.externalId.toLowerCase().includes(query) ||
          (item.nickname ?? '').toLowerCase().includes(query),
      );
      return { ok: true, data: { items } };
    }

    case 'GET_DOSSIER': {
      const id = String(request.counterpartyId);
      const found = fixture.dossiers[id] ?? fixture.dossiers['cp-demo-scam'];
      return { ok: true, data: structuredClone(found) };
    }

    case 'LOOKUP_COUNTERPARTY':
      return { ok: true, data: structuredClone(fixture.dossiers['cp-demo-scam']) };

    case 'GET_TEAM':
      return { ok: true, data: structuredClone(fixture.team) };

    case 'JOIN_TEAM':
      if (session) session = { ...session, user: { ...session.user, teamId: 'team-demo' } };
      return { ok: true, data: { ok: true, team: fixture.team.team } };

    case 'CREATE_TEAM':
      if (session) {
        session = {
          ...session,
          user: { ...session.user, teamId: 'team-demo', role: 'TEAM_LEAD' },
        };
      }
      return {
        ok: true,
        data: {
          ok: true,
          team: { id: 'team-demo', name: String(request.name), slug: 'demo' },
          role: 'TEAM_LEAD',
        },
      };

    case 'LEAVE_TEAM':
      if (session) session = { ...session, user: { ...session.user, teamId: null } };
      return { ok: true, data: { ok: true } };

    case 'CREATE_TEAM_INVITE':
      return { ok: true, data: { token: 'DEMOxKq7Rt2Fv9LmPz4WbN8sYc1JhTgE' } };

    case 'GET_RECENT_COUNTERPARTIES':
      return { ok: true, data: { items: structuredClone(fixture.recentCounterparties) } };

    case 'GET_MY_REVIEWS':
      return { ok: true, data: { items: structuredClone(fixture.myReviews) } };

    case 'GET_TEMPLATES':
      return { ok: true, data: { items: templates } };

    case 'SAVE_TEMPLATE': {
      const id = String(request.id ?? '');
      const existing = templates.find((t) => t.id === id);
      if (existing) {
        existing.title = String(request.title);
        existing.body = String(request.body);
        existing.shared = Boolean(request.shared);
      } else {
        templates.push({
          id: newId(),
          title: String(request.title),
          body: String(request.body),
          position: templates.length,
          shared: Boolean(request.shared),
          canEdit: true,
        });
      }
      return { ok: true, data: { ok: true } };
    }

    case 'DELETE_TEMPLATE': {
      const index = templates.findIndex((t) => t.id === request.id);
      if (index >= 0) templates.splice(index, 1);
      return { ok: true, data: { ok: true } };
    }

    case 'GET_BINANCE_SESSION':
      return { ok: true, data: binanceSession };

    case 'OPEN_BINANCE_LOGIN':
      // на стенде вход просто включает сессию, биржи здесь нет
      binanceSession = { ...LOGGED_IN };
      return { ok: true, data: { tabId: null } };

    case 'GET_TAB_STATUS':
      // показываем удачный случай: ордер распознан сам
      return {
        ok: true,
        data: { isBinance: true, orderId: '20260814000001', counterpartyNick: 'aminexh' },
      };

    case 'SYNC_ORDERS':
      return { ok: true, data: { created: 3, updated: 12 } };

    case 'MANUAL_LOOKUP':
      push(fixture.panelState);
      return { ok: true, data: fixture.panelState };

    default:
      return { ok: true, data: null };
  }
}

const mock = {
  runtime: {
    sendMessage: (message: unknown) => handle(message as Record<string, unknown>),
    onMessage: {
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
    },
    getURL: (path: string) => path,
    lastError: undefined,
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    },
    // попап сохраняет сюда вкладку и досье, на стенде держим в памяти
    session: (() => {
      const memory = new Map<string, unknown>();
      return {
        get: async (key: string) => (memory.has(key) ? { [key]: memory.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) memory.set(k, v);
        },
        remove: async (key: string) => {
          memory.delete(key);
        },
      };
    })(),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = mock;

// переключение темы со стенда
export function setTheme(theme: Settings['theme']): void {
  settings = { ...settings, theme };
  // панель подписана на PANEL_STATE, дёргаем его, чтобы перечитала тему
  push(structuredClone(panelState));
  for (const listener of listeners) listener({ type: 'SETTINGS_CHANGED', settings });
}

// смена настроек со стенда, минуя попап
export function patchSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  for (const listener of listeners) listener({ type: 'SETTINGS_CHANGED', settings });
}

// сброс панели в исходное состояние
export function resetPanel(): void {
  push(structuredClone(fixture.panelState));
}

// переключение сценария панели
export function showScenario(name: 'scam' | 'clean' | 'unauthorized' | 'loading'): void {
  if (name === 'unauthorized') {
    push({ status: 'unauthorized', message: 'Войдите в расширение, чтобы видеть досье контрагента' });
    return;
  }
  if (name === 'loading') {
    push({ status: 'loading', orderId: '20260814000001' });
    return;
  }
  push(structuredClone(name === 'scam' ? fixture.panelState : fixture.cleanPanelState));
}
