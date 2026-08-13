import { useEffect, useState } from 'react';
import { sendMessage } from '../shared/messages.js';
import type { Session, Settings } from '../shared/types.js';

type SessionResponse = { session: Session | null; settings: Settings };

export function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => {
    const response = await sendMessage<SessionResponse>({ type: 'GET_SESSION' });
    if (response.ok) {
      setSession(response.data.session);
      setSettings(response.data.settings);
    } else {
      setError(response.error.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  const patchSettings = async (patch: Partial<Settings>) => {
    const response = await sendMessage<Settings>({ type: 'SET_SETTINGS', patch });
    if (response.ok) setSettings(response.data);
  };

  if (loading) {
    return (
      <div className="wrap">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="head">
        <div className="logo">PG</div>
        <div>
          <div className="title">P2P Guard</div>
          <div className="muted">Досье контрагентов Binance P2P</div>
        </div>
      </div>

      {error ? <div className="error" onClick={() => setError(null)}>{error}</div> : null}
      {notice ? <div className="ok" onClick={() => setNotice(null)}>{notice}</div> : null}

      {session ? (
        <Account
          session={session}
          settings={settings}
          onSettings={patchSettings}
          onNotice={setNotice}
          onError={setError}
          onLogout={async () => {
            await sendMessage({ type: 'AUTH_LOGOUT' });
            setSession(null);
            setNotice('Вы вышли из аккаунта');
          }}
        />
      ) : (
        <AuthForm
          settings={settings}
          onSettings={patchSettings}
          onError={setError}
          onSuccess={async () => {
            setError(null);
            setNotice('Готово, панель включена');
            await reload();
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────── Авторизация ─────────────────────────────

function AuthForm({
  settings,
  onSettings,
  onError,
  onSuccess,
}: {
  settings: Settings | null;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onError: (message: string) => void;
  onSuccess: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'activate'>('activate');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrl] = useState(settings?.apiBaseUrl ?? '');
  const [showApi, setShowApi] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError('');

    if (apiUrl && apiUrl !== settings?.apiBaseUrl) {
      await onSettings({ apiBaseUrl: apiUrl.trim() });
    }

    const response =
      mode === 'activate'
        ? await sendMessage<Session>({
            type: 'AUTH_ACTIVATE',
            token: token.trim(),
            password,
            nickname: nickname.trim() || undefined,
          })
        : await sendMessage<Session>({
            type: 'AUTH_LOGIN',
            binanceUid: uid.trim() || undefined,
            password,
          });

    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    await onSuccess();
  };

  return (
    <>
      <div className="tabs">
        <div
          className={`tab ${mode === 'activate' ? 'active' : ''}`}
          onClick={() => setMode('activate')}
        >
          Активация
        </div>
        <div className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>
          Вход
        </div>
      </div>

      <div className="card">
        {mode === 'activate' ? (
          <>
            <div className="card-title">Токен доступа от администратора</div>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Вставьте токен"
              autoFocus
            />
            <label>Ник (необязательно)</label>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            <label>Придумайте пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="минимум 8 символов"
            />
            <div className="hint" style={{ marginTop: 8 }}>
              UID Binance подставится автоматически — сначала войдите на binance.com в этом браузере.
            </div>
          </>
        ) : (
          <>
            <div className="card-title">Вход</div>
            <label>UID Binance (оставьте пустым для автоопределения)</label>
            <input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="напр. 123456789" />
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={busy || password.length < 8 || (mode === 'activate' && token.length < 10)}
            onClick={() => void submit()}
          >
            {busy ? 'Подождите…' : mode === 'activate' ? 'Активировать' : 'Войти'}
          </button>
        </div>
      </div>

      <button className="ghost" onClick={() => setShowApi((v) => !v)}>
        {showApi ? 'Скрыть настройки сервера' : 'Настройки сервера'}
      </button>
      {showApi ? (
        <div className="card">
          <div className="card-title">Адрес API</div>
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          <div className="hint" style={{ marginTop: 6 }}>
            Локально: http://localhost:4000/v1
          </div>
        </div>
      ) : null}
    </>
  );
}

// ───────────────────────────── Аккаунт ─────────────────────────────

function Account({
  session,
  settings,
  onSettings,
  onLogout,
  onNotice,
  onError,
}: {
  session: Session;
  settings: Settings | null;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onLogout: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    const response = await sendMessage<{ created: number; updated: number } | null>({
      type: 'SYNC_ORDERS',
    });
    setSyncing(false);

    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    if (!response.data) {
      onNotice('Синхронизация недоступна: проверьте вход на Binance');
      return;
    }
    onNotice(`Синхронизировано: +${response.data.created}, обновлено ${response.data.updated}`);
  };

  return (
    <>
      <div className="card">
        <div className="card-title">Аккаунт</div>
        <div className="kv">
          <span>UID Binance</span>
          <b>{session.user.binanceUid}</b>
        </div>
        <div className="kv">
          <span>Роль</span>
          <span className="badge">{session.user.role}</span>
        </div>
        <div className="kv">
          <span>Команда</span>
          <span>{session.user.teamId ? 'подключена' : 'нет'}</span>
        </div>
        <div className="kv">
          <span>Подписка</span>
          <span className="badge ok">
            {session.user.subscription.plan === 'FREE' ? 'бесплатно' : session.user.subscription.plan}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Настройки</div>
        <div className="switch">
          <span>Показывать панель на ордере</span>
          <input
            type="checkbox"
            checked={settings?.panelEnabled ?? true}
            onChange={(e) => void onSettings({ panelEnabled: e.target.checked })}
          />
        </div>
        <div className="switch">
          <span>Синхронизировать мои ордера</span>
          <input
            type="checkbox"
            checked={settings?.autoSyncOrders ?? true}
            onChange={(e) => void onSettings({ autoSyncOrders: e.target.checked })}
          />
        </div>
        <div className="switch">
          <span>Собирать реквизиты из чата</span>
          <input
            type="checkbox"
            checked={settings?.captureChatRequisites ?? true}
            onChange={(e) => void onSettings({ captureChatRequisites: e.target.checked })}
          />
        </div>
      </div>

      <SearchCard onError={onError} />

      <div className="row">
        <button disabled={syncing} onClick={() => void sync()}>
          {syncing ? 'Синхронизация…' : 'Синхронизировать ордера'}
        </button>
        <button className="ghost" onClick={() => void onLogout()}>
          Выйти
        </button>
      </div>

      <div className="hint">
        Панель появляется автоматически на странице ордера Binance P2P.
      </div>
    </>
  );
}

// ───────────────────────────── Поиск по базе ─────────────────────────────

type SearchItem = {
  id: string;
  externalId: string;
  nickname: string | null;
  countryCode: string | null;
  reviews: number;
  orders: number;
  blacklisted: boolean;
};

/** Проверка контрагента до сделки: по UID, нику или реквизиту. */
function SearchCard({ onError }: { onError: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const value = query.trim();
    if (value.length < 2) return;

    setBusy(true);
    const response = await sendMessage<{ items: SearchItem[] }>({
      type: 'SEARCH_COUNTERPARTIES',
      query: value,
    });
    setBusy(false);

    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    setItems(response.data.items);
  };

  return (
    <div className="card">
      <div className="card-title">Проверить контрагента</div>
      <div className="row">
        <input
          placeholder="UID, ник или номер карты"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button style={{ flex: '0 0 auto' }} disabled={busy || query.trim().length < 2} onClick={() => void search()}>
          {busy ? '…' : 'Найти'}
        </button>
      </div>

      {items?.length ? (
        <div style={{ marginTop: 10 }}>
          {items.slice(0, 8).map((item) => (
            <div key={item.id} className="kv" style={{ alignItems: 'flex-start' }}>
              <span>
                <b style={{ color: '#e8ecf3' }}>{item.nickname ?? 'без ника'}</b>
                <div style={{ fontSize: 11 }}>UID {item.externalId}</div>
              </span>
              <span style={{ textAlign: 'right' }}>
                {item.blacklisted ? (
                  <span className="badge" style={{ color: '#ff8080', borderColor: 'rgba(240,68,68,.4)' }}>
                    в ЧС
                  </span>
                ) : (
                  <span className="badge ok">чисто</span>
                )}
                <div style={{ fontSize: 11 }}>
                  отзывов: {item.reviews} · сделок: {item.orders}
                </div>
              </span>
            </div>
          ))}
        </div>
      ) : items ? (
        <div className="hint" style={{ marginTop: 8 }}>
          В базе никого не нашлось — контрагент нам ещё не встречался.
        </div>
      ) : null}
    </div>
  );
}
