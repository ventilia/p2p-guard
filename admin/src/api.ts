// токены в localStorage: админка — SPA на своём домене, cookie не разделяет
// при 401 один раз пробуем refresh, параллельные вызовы делят один запрос
import type { Session } from './types';

const STORAGE_KEY = 'pg.admin.session';
const API_BASE_KEY = 'pg.admin.apiBase';

export const DEFAULT_API_BASE = 'http://localhost:4000/v1';

export function getApiBase(): string {
  return (localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE).replace(/\/+$/, '');
}

export function setApiBase(value: string): void {
  localStorage.setItem(API_BASE_KEY, value.trim().replace(/\/+$/, ''));
}

export function getSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session | null): void {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// App подписывается, чтобы вернуть экран входа
const logoutListeners = new Set<() => void>();

export function onLogout(listener: () => void): () => void {
  logoutListeners.add(listener);
  return () => logoutListeners.delete(listener);
}

function forceLogout(): void {
  setSession(null);
  for (const listener of logoutListeners) listener();
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `Ошибка ${response.status}`;
  try {
    const data = (await response.json()) as { error?: { code?: string; message?: string } };
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
    }
  } catch {
    // тело не JSON, оставляем дефолт
  }
  return new ApiError(response.status, code, message);
}

let refreshPromise: Promise<Session | null> | null = null;

async function refreshSession(): Promise<Session | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const session = getSession();
    if (!session?.refreshToken) return null;

    try {
      const response = await fetch(`${getApiBase()}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!response.ok) {
        forceLogout();
        return null;
      }
      const data = (await response.json()) as Session;
      const next: Session = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      };
      setSession(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  retried?: boolean;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, retried = false } = options;

  const session = getSession();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (session) {
    headers.authorization = `Bearer ${session.accessToken}`;
    // бэкенд сверяет UID из заголовка с учёткой, иначе 409
    headers['x-binance-uid'] = session.user.binanceUid;
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Сервер P2P Guard недоступен. Запущен ли бэкенд?');
  }

  if (response.status === 401 && session && !retried) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...options, retried: true });
    throw new ApiError(401, 'SESSION_EXPIRED', 'Сессия истекла, войдите заново');
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// роль проверяем сразу: обычному пользователю тут делать нечего
export async function login(binanceUid: string, password: string): Promise<Session> {
  const response = await fetch(`${getApiBase()}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ binanceUid, password }),
  });
  if (!response.ok) throw await parseError(response);

  const data = (await response.json()) as Session;
  if (data.user.role !== 'ADMIN') {
    throw new ApiError(403, 'NOT_ADMIN', 'Эта учётная запись не администратор');
  }

  const session: Session = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
  };
  setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const session = getSession();
  if (session) {
    try {
      await fetch(`${getApiBase()}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
    } catch {
      // выходим локально в любом случае
    }
  }
  forceLogout();
}
