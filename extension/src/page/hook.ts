/**
 * Хук страницы (page world).
 *
 * Ключевая идея: не угадывать приватный API Binance, а слушать то, что
 * страница делает сама. Пока пользователь открывает ордер, фронтенд биржи
 * уже запрашивает и детали ордера, и профиль контрагента, и историю чата —
 * мы читаем эти ответы «по дороге».
 *
 * Что перехватываем:
 *   • fetch  — основной транспорт bapi;
 *   • XMLHttpRequest — часть старых вызовов всё ещё идёт через него;
 *   • WebSocket — чат ордера (реквизиты, смена статуса);
 *   • history.pushState/replaceState — SPA-навигация между ордерами.
 *
 * Заголовки запросов запоминаем и отдаём в расширение: с ними наши
 * собственные (резервные) вызовы выглядят для биржи ровно так же, как
 * запросы самой страницы, и не ломаются на подписи/csrf.
 *
 * Ничего не отправляем и не модифицируем — только чтение.
 */
(() => {
  const CHANNEL = 'p2p-guard';
  const MAX_BODY = 300_000;

  const marker = window as unknown as { __p2pGuardHooked?: boolean };
  if (marker.__p2pGuardHooked) return;
  marker.__p2pGuardHooked = true;

  const post = (type: string, payload: unknown) => {
    try {
      window.postMessage({ source: CHANNEL, type, payload }, window.location.origin);
    } catch {
      // неклонируемые структуры просто пропускаем
    }
  };

  /** Интересуют только вызовы бизнес-API биржи. */
  const isInteresting = (url: string) =>
    url.includes('/bapi/c2c/') ||
    url.includes('/bapi/accounts/') ||
    url.includes('/bapi/asset/') ||
    url.includes('c2c/order') ||
    url.includes('c2c/user');

  const safeParse = (text: string): unknown => {
    if (!text || text.length > MAX_BODY) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  /** Заголовки нужны, чтобы резервные запросы расширения выглядели как запросы страницы. */
  const collectHeaders = (init?: HeadersInit, request?: Request): Record<string, string> => {
    const result: Record<string, string> = {};
    const keep = [
      'csrftoken',
      'clienttype',
      'client-type',
      'device-info',
      'bnc-uuid',
      'fvideo-id',
      'fvideo-token',
      'x-passthrough-token',
      'x-trace-id',
      'x-ui-request-trace',
      'lang',
      'x-nx-context',
    ];

    const put = (key: string, value: string) => {
      const name = key.toLowerCase();
      if (keep.includes(name) && value) result[name] = value;
    };

    if (request) request.headers.forEach((value, key) => put(key, value));

    if (init) {
      if (init instanceof Headers) init.forEach((value, key) => put(key, value));
      else if (Array.isArray(init)) init.forEach(([key, value]) => put(String(key), String(value)));
      else Object.entries(init).forEach(([key, value]) => put(key, String(value)));
    }

    return result;
  };

  const report = (
    url: string,
    method: string,
    headers: Record<string, string>,
    requestBody: unknown,
    responseBody: unknown,
  ) => {
    if (!responseBody && !Object.keys(headers).length) return;
    post('NET_CAPTURE', { url, method, headers, requestBody, responseBody });
  };

  // ───────────────────────────── fetch ─────────────────────────────

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const response = await nativeFetch.call(this, input as RequestInfo, init);

      try {
        const request = input instanceof Request ? input : undefined;
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : request?.url ?? '';

        if (url && isInteresting(url)) {
          const headers = collectHeaders(init?.headers, request);
          const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

          let requestBody: unknown = null;
          if (typeof init?.body === 'string') requestBody = safeParse(init.body);

          // Клонируем, чтобы не «съесть» тело у самой страницы.
          response
            .clone()
            .text()
            .then((text) => report(url, method, headers, requestBody, safeParse(text)))
            .catch(() => undefined);
        }
      } catch {
        // перехват не должен ломать работу страницы ни при каких условиях
      }

      return response;
    };
  }

  // ───────────────────────────── XMLHttpRequest ─────────────────────────────

  type Tracked = XMLHttpRequest & {
    __pgUrl?: string;
    __pgMethod?: string;
    __pgHeaders?: Record<string, string>;
    __pgBody?: unknown;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function open(
    this: Tracked,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__pgUrl = typeof url === 'string' ? url : url.href;
    this.__pgMethod = method;
    this.__pgHeaders = {};
    // eslint-disable-next-line prefer-rest-params
    return nativeOpen.apply(this, arguments as never);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(
    this: Tracked,
    name: string,
    value: string,
  ) {
    if (this.__pgHeaders) this.__pgHeaders[name.toLowerCase()] = value;
    return nativeSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function send(this: Tracked, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      if (this.__pgUrl && isInteresting(this.__pgUrl)) {
        if (typeof body === 'string') this.__pgBody = safeParse(body);

        this.addEventListener('load', () => {
          try {
            if (this.responseType && this.responseType !== 'text' && this.responseType !== 'json') return;
            const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
            report(
              this.__pgUrl ?? '',
              (this.__pgMethod ?? 'GET').toUpperCase(),
              this.__pgHeaders ?? {},
              this.__pgBody,
              safeParse(text),
            );
          } catch {
            // игнорируем
          }
        });
      }
    } catch {
      // игнорируем
    }

    return nativeSend.call(this, body ?? null);
  };

  // ───────────────────────────── WebSocket (чат) ─────────────────────────────

  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    const HookedWebSocket = new Proxy(NativeWebSocket, {
      construct(target, args: [string | URL, (string | string[])?]) {
        const socket = new target(...args);
        socket.addEventListener('message', (event: MessageEvent) => {
          if (typeof event.data !== 'string') return;
          const parsed = safeParse(event.data);
          post('WS_INTERCEPT', parsed ?? event.data);
        });
        return socket;
      },
    });
    window.WebSocket = HookedWebSocket as unknown as typeof WebSocket;
  }

  // ───────────────────────────── SPA-навигация ─────────────────────────────

  const notifyUrl = () => post('URL_CHANGED', { url: window.location.href });

  const wrapHistory = (method: 'pushState' | 'replaceState') => {
    const native = history[method];
    history[method] = function patched(this: History, ...args: unknown[]) {
      const result = native.apply(this, args as never);
      notifyUrl();
      return result;
    } as History[typeof method];
  };

  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', notifyUrl);
})();
