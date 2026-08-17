// живёт только в service worker: так токен не попадает в контекст страницы биржи
import { getSession, getSettings, setSession } from '../shared/storage.js';
import type { Session } from '../shared/types.js';

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

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  // запрос уже повторялся после refresh
  retried?: boolean;
};

let refreshPromise: Promise<Session | null> | null = null;

async function baseUrl(): Promise<string> {
  const settings = await getSettings();
  return settings.apiBaseUrl.replace(/\/+$/, '');
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

// параллельные вызовы разделяют один запрос за токеном
async function refreshSession(): Promise<Session | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const session = await getSession();
    if (!session?.refreshToken) return null;

    try {
      const response = await fetch(`${await baseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      if (!response.ok) {
        // refresh невалиден, чистим сессию
        await setSession(null);
        return null;
      }

      const data = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
        user: Session['user'];
      };
      const next: Session = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      };
      await setSession(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retried = false } = options;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let session: Session | null = null;
  if (auth) {
    session = await getSession();
    if (!session) throw new ApiError(401, 'NO_SESSION', 'Нужно войти в расширение');
    headers.authorization = `Bearer ${session.accessToken}`;
    headers['x-binance-uid'] = session.user.binanceUid;
  }

  let response: Response;
  try {
    response = await fetch(`${await baseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Сервер P2P Guard недоступен');
  }

  if (response.status === 401 && auth && !retried) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(path, { ...options, retried: true });
    throw new ApiError(401, 'SESSION_EXPIRED', 'Сессия истекла, войдите заново');
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// логин и активация не требуют токена и сами сохраняют сессию
export async function authRequest(
  path: '/auth/login' | '/auth/activate',
  body: Record<string, unknown>,
): Promise<Session> {
  const response = await fetch(`${await baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw await parseError(response);

  const data = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    user: Session['user'];
  };
  const session: Session = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
  };
  await setSession(session);
  return session;
}
