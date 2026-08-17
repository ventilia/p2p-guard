import { useCallback, useEffect, useState } from 'react';
import { sendMessage } from '../shared/messages.js';
import {
  IconAlert,
  IconCheck,
  IconCopy,
  IconInfo,
  IconLogout,
  IconNote,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconStar,
  IconTrash,
  IconUser,
  IconUsers,
  LogoMark,
} from '../shared/icons.js';
import { clearPopupState, loadPopupState, savePopupState, type PopupTab } from './state.js';
import { fmtDate, fmtMoney, fmtNumber, initialOf } from '../shared/format.js';
import {
  REVIEW_TAG_LABEL,
  REVIEW_TAG_ORDER,
  type MessageTemplate,
  type ReviewRating,
  type ReviewTag,
  type Session,
  type Settings,
} from '../shared/types.js';

type SessionResponse = { session: Session | null; settings: Settings };

type TabStatusData = {
  isBinance: boolean;
  orderId: string | null;
  counterpartyNick: string | null;
};

type BinanceSessionData = {
  loggedIn: boolean;
  hasPageHeaders: boolean;
  browserUid: string | null;
  accountUid: string | null;
  mismatch: boolean;
};

type Tab = PopupTab;

const TABS: { key: Tab; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { key: 'review', label: 'Оценить', Icon: IconStar },
  { key: 'settings', label: 'Настройки', Icon: IconSettings },
];

type RecentItem = {
  counterparty: { id: string; externalId: string; nickname: string | null; countryCode: string | null };
  lastOrder: {
    externalId: string;
    side: 'BUY' | 'SELL';
    status: string;
    fiat: string | null;
    amountFiat: number | null;
    createdAt: string;
  };
  myReview: { id: string; rating: ReviewRating; tag: ReviewTag; text: string; updatedAt: string } | null;
};

type MyReview = {
  id: string;
  rating: ReviewRating;
  tag: ReviewTag;
  text: string;
  updatedAt: string;
  counterparty: { id: string; externalId: string; nickname: string | null };
};

export function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTabState] = useState<Tab>('review');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    savePopupState({ tab: next });
  }, []);

  const reload = useCallback(async () => {
    const response = await sendMessage<SessionResponse>({ type: 'GET_SESSION' });
    if (response.ok) {
      setSession(response.data.session);
      setSettings(response.data.settings);
    } else {
      setError(response.error.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // параллельно: попап должен открываться сразу, а не в два ожидания
    void Promise.all([reload(), loadPopupState()]).then(([, saved]) => setTabState(saved.tab));
  }, [reload]);

  // попап — обычная страница, Shadow DOM тут нет, тема живёт на <html>
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'light';
  }, [settings?.theme]);

  const patchSettings = async (patch: Partial<Settings>) => {
    const response = await sendMessage<Settings>({ type: 'SET_SETTINGS', patch });
    if (response.ok) setSettings(response.data);
  };

  if (loading) {
    return (
      <div className="center">
        <div className="spinner" />
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="shell">
        <Top />
        <div className="content">
          <AuthForm
            settings={settings}
            onSettings={patchSettings}
            onDone={async () => {
              setNotice('Готово, панель включена');
              await reload();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Top />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <t.Icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="content">
        {error ? (
          <div className="alert bad" onClick={() => setError(null)}>
            <IconAlert size={15} />
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="alert ok" onClick={() => setNotice(null)}>
            <IconCheck size={15} />
            <span>{notice}</span>
          </div>
        ) : null}

        {tab === 'review' ? (
          <>
            <BinanceSessionCard
              accountUid={session.user.binanceUid}
              isAdmin={session.user.role === 'ADMIN'}
            />
            <TabStatus
              panelEnabled={settings?.panelEnabled ?? false}
              onEnable={() => {
                void patchSettings({ panelEnabled: true });
                setNotice('Панель включена. Обновите страницу ордера.');
              }}
            />
            <ReviewTab onError={setError} onNotice={setNotice} />
          </>
        ) : null}
        {tab === 'settings' ? (
          <SettingsTab
            session={session}
            settings={settings}
            onSettings={patchSettings}
            onError={setError}
            onNotice={setNotice}
            onReloadSession={reload}
            onLogout={async () => {
              await sendMessage({ type: 'AUTH_LOGOUT' });
              // кэш привязан к аккаунту, чужие данные показывать нельзя
              await clearPopupState();
              setSession(null);
              setNotice('Вы вышли из аккаунта');
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function Top() {
  return (
    <div className="top">
      <LogoMark size={28} />
      <div>
        <div className="brand-name">P2P Guard</div>
        <div className="brand-sub">досье контрагентов Binance P2P</div>
      </div>
    </div>
  );
}

// без сессии биржи статистики не будет, и это надо показать явно
// пароль не спрашиваем: кнопка ведёт на настоящую страницу входа Binance
function BinanceSessionCard({ accountUid, isAdmin }: { accountUid: string; isAdmin: boolean }) {
  const [state, setState] = useState<BinanceSessionData | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const r = await sendMessage<BinanceSessionData>({ type: 'GET_BINANCE_SESSION' });
    setChecking(false);
    if (r.ok) setState(r.data);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (!state) return null;

  if (!state.loggedIn) {
    return (
      <div className="card">
        <div className="card-title">
          <IconAlert size={13} /> Вы не вошли в Binance
        </div>
        <div className="hint" style={{ marginBottom: 9 }}>
          Расширение запрашивает статистику контрагентов под вашей сессией биржи. Пока вы не вошли
          на binance.com, биржа не отдаст ни средний чек, ни число сделок — останутся только наши
          отзывы и чёрный список.
        </div>
        <button
          className="btn primary block"
          onClick={() => void sendMessage({ type: 'OPEN_BINANCE_LOGIN' })}
        >
          Войти в Binance
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          Откроется настоящая страница входа Binance. Пароль от биржи мы не спрашиваем и не храним.
        </div>
        <button className="btn ghost block" style={{ marginTop: 6 }} disabled={checking} onClick={() => void check()}>
          <IconRefresh size={14} /> {checking ? 'Проверяем…' : 'Я вошёл, проверить'}
        </button>
      </div>
    );
  }

  if (state.mismatch) {
    return (
      <div className="card">
        <div className="card-title">
          <IconAlert size={13} /> Разные аккаунты
        </div>
        <div className="hint">
          В браузере вы вошли в Binance под UID <b className="mono">{state.browserUid}</b>, а учётная
          запись расширения привязана к <b className="mono">{accountUid}</b>. Запросы к бирже уйдут
          от первого, а отзывы и сделки запишутся на второй.
        </div>
        {isAdmin ? (
          // учётка из seed: её UID синтетический и с биржей совпасть не может
          <div className="hint" style={{ marginTop: 7 }}>
            Похоже, вы вошли <b>учётной записью администратора</b> — она только для админ-панели, её
            UID не относится к бирже. Для торговли заведите отдельную учётку: выйдите и активируйте
            расширение по токену доступа, тогда UID подставится ваш настоящий.
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 7 }}>
            Войдите в Binance тем же аккаунтом — или попросите администратора перепривязать учётку.
          </div>
        )}
        <button className="btn block" style={{ marginTop: 9 }} disabled={checking} onClick={() => void check()}>
          <IconRefresh size={14} /> {checking ? 'Проверяем…' : 'Проверить снова'}
        </button>
      </div>
    );
  }

  return (
    <div className="status-line ok">
      <IconCheck size={14} />
      <span style={{ flex: 1 }}>
        Сессия Binance активна
        {state.browserUid ? (
          <>
            {' '}
            — UID <b className="mono">{state.browserUid}</b>
          </>
        ) : null}
        {state.hasPageHeaders ? '' : '. Откройте страницу ордера, чтобы данные приходили полнее'}
      </span>
    </div>
  );
}

// отвечает на вопрос «оно вообще работает и само ли ловит ордер»
function TabStatus({ panelEnabled, onEnable }: { panelEnabled: boolean; onEnable: () => void }) {
  const [status, setStatus] = useState<TabStatusData | null>(null);

  useEffect(() => {
    void sendMessage<TabStatusData>({ type: 'GET_TAB_STATUS' }).then((r) => {
      if (r.ok) setStatus(r.data);
    });
  }, []);

  if (!status) return null;

  if (!status.isBinance) {
    return (
      <div className="status-line">
        <IconInfo size={14} />
        <span>
          Открытая вкладка — не Binance. Проверить контрагента можно и отсюда: введите UID, ник или
          номер карты.
        </span>
      </div>
    );
  }

  if (!panelEnabled) {
    return (
      <div className="status-line warn">
        <IconAlert size={14} />
        <span style={{ flex: 1 }}>
          Вы на Binance, но панель поверх страницы выключена.
        </span>
        <button className="btn small" onClick={onEnable}>
          Включить
        </button>
      </div>
    );
  }

  if (!status.orderId) {
    return (
      <div className="status-line">
        <IconInfo size={14} />
        <span>Панель включена. Откройте страницу ордера — досье появится само.</span>
      </div>
    );
  }

  return (
    <div className={`status-line ${status.counterpartyNick ? 'ok' : ''}`}>
      <IconCheck size={14} />
      <span>
        Ордер <b className="mono">···{status.orderId.slice(-6)}</b> определён автоматически
        {status.counterpartyNick ? (
          <>
            , контрагент <b>{status.counterpartyNick}</b>
          </>
        ) : (
          ', контрагента уточняем'
        )}
        .
      </span>
    </div>
  );
}

// ───────────────────────────── Авторизация ─────────────────────────────

function AuthForm({
  settings,
  onSettings,
  onDone,
}: {
  settings: Settings | null;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'activate' | 'login'>('activate');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState(settings?.apiBaseUrl ?? '');
  const [showApi, setShowApi] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);

    if (apiUrl && apiUrl !== settings?.apiBaseUrl) await onSettings({ apiBaseUrl: apiUrl.trim() });

    const response =
      mode === 'activate'
        ? await sendMessage<Session>({
            type: 'AUTH_ACTIVATE',
            token: token.trim(),
            password,
            nickname: nickname.trim() || undefined,
            binanceUid: uid.trim() || undefined,
          })
        : await sendMessage<Session>({
            type: 'AUTH_LOGIN',
            binanceUid: uid.trim() || undefined,
            password,
          });

    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    await onDone();
  };

  return (
    <>
      {error ? (
        <div className="alert bad" onClick={() => setError(null)}>
          <IconAlert size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="seg">
        <button className={mode === 'activate' ? 'active' : ''} onClick={() => setMode('activate')}>
          Активация
        </button>
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Вход
        </button>
      </div>

      <div className="card">
        {mode === 'activate' ? (
          <>
            <label>Токен доступа от администратора</label>
            <input value={token} autoFocus placeholder="Вставьте токен" onChange={(e) => setToken(e.target.value)} />
            <label>Ник (необязательно)</label>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            <label>Придумайте пароль</label>
            <input
              type="password"
              value={password}
              placeholder="минимум 8 символов"
              onChange={(e) => setPassword(e.target.value)}
            />
            <label>UID Binance (пусто — определить автоматически)</label>
            <input value={uid} placeholder="например 123456789" onChange={(e) => setUid(e.target.value)} />
            <div className="hint" style={{ marginTop: 9 }}>
              Если вы вошли на binance.com в этом браузере, UID подставится сам. Иначе впишите его
              вручную: он виден в профиле Binance.
            </div>
          </>
        ) : (
          <>
            <label>UID Binance (пусто — определить автоматически)</label>
            <input value={uid} placeholder="например 123456789" onChange={(e) => setUid(e.target.value)} />
            <label>Пароль</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}

        <button
          className="btn primary block"
          style={{ marginTop: 12 }}
          disabled={busy || password.length < 8 || (mode === 'activate' && token.trim().length < 10)}
          onClick={() => void submit()}
        >
          {busy ? 'Подождите…' : mode === 'activate' ? 'Активировать' : 'Войти'}
        </button>
      </div>

      <button className="btn ghost small" onClick={() => setShowApi((v) => !v)}>
        {showApi ? 'Скрыть адрес сервера' : 'Адрес сервера'}
      </button>
      {showApi ? (
        <div className="card">
          <label>Адрес API</label>
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          <div className="hint" style={{ marginTop: 6 }}>
            Локально: http://localhost:4000/v1
          </div>
        </div>
      ) : null}
    </>
  );
}


// ───────────────────────────── Оценить контрагента ─────────────────────────────

// главный экран попапа: оценить того, с кем только что закрыл ордер
function ReviewTab({
  onError,
  onNotice,
}: {
  onError: (m: string) => void;
  onNotice: (m: string) => void;
}) {
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [mine, setMine] = useState<MyReview[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      sendMessage<{ items: RecentItem[] }>({ type: 'GET_RECENT_COUNTERPARTIES' }),
      sendMessage<{ items: MyReview[] }>({ type: 'GET_MY_REVIEWS' }),
    ]);
    if (r.ok) setRecent(r.data.items);
    else onError(r.error.message);
    if (m.ok) setMine(m.data.items);
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!recent) {
    return (
      <div className="center">
        <div className="spinner" />
        <div className="muted">Загружаем…</div>
      </div>
    );
  }

  const picked = recent.find((r) => r.counterparty.id === pickedId) ?? recent[0] ?? null;

  return (
    <>
      {picked ? (
        <>
          {recent.length > 1 ? (
            <div className="card">
              <div className="card-title">Последние сделки</div>
              <div className="templates">
                {recent.map((item) => (
                  <button
                    key={item.counterparty.id}
                    className={`template-chip ${item.counterparty.id === picked.counterparty.id ? 'active' : ''}`}
                    onClick={() => setPickedId(item.counterparty.id)}
                  >
                    {item.counterparty.nickname ?? item.counterparty.externalId}
                    {item.myReview ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <QuickReview
            key={picked.counterparty.id}
            item={picked}
            busy={busy}
            setBusy={setBusy}
            onDone={async (message) => {
              onNotice(message);
              await load();
            }}
            onError={onError}
          />
        </>
      ) : (
        <div className="card">
          <div className="card-title">
            <IconStar size={13} /> Пока некого оценивать
          </div>
          <div className="hint">
            Здесь появятся контрагенты, с которыми у вас были сделки. Полное досье и проверка до
            сделки — в панели на странице ордера.
          </div>
        </div>
      )}

      <MyReviews items={mine} />
    </>
  );
}

// форма оценки: рейтинг, категория, текст
function QuickReview({
  item,
  busy,
  setBusy,
  onDone,
  onError,
}: {
  item: RecentItem;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onDone: (message: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const own = item.myReview;
  const [rating, setRating] = useState<ReviewRating>(own?.rating ?? 'POSITIVE');
  const [tag, setTag] = useState<ReviewTag>(own?.tag ?? 'COMMENT');
  const [text, setText] = useState(own?.text ?? '');

  // положительный отзыв обвинением быть не может
  useEffect(() => {
    if (rating === 'POSITIVE') setTag('COMMENT');
  }, [rating]);

  const submit = async () => {
    setBusy(true);
    const response = await sendMessage({
      type: 'SUBMIT_REVIEW',
      counterpartyId: item.counterparty.id,
      rating,
      tag,
      text: text.trim(),
    });
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    await onDone(own ? 'Отзыв обновлён' : 'Отзыв опубликован');
  };

  return (
    <div className="card">
      <div className="card-title">
        <IconStar size={13} /> {own ? 'Ваш отзыв' : 'Оценить контрагента'}
      </div>

      <div className="who" style={{ marginBottom: 10 }}>
        <div className="avatar">
          <span className="initial">
            {initialOf(item.counterparty.nickname, item.counterparty.externalId)}
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="nick">{item.counterparty.nickname ?? 'без ника'}</div>
          <div className="uid">
            UID {item.counterparty.externalId}
            {item.counterparty.countryCode ? ` · ${item.counterparty.countryCode}` : ''}
          </div>
          <div className="hint" style={{ marginTop: 3 }}>
            {item.lastOrder.side === 'BUY' ? 'покупка' : 'продажа'}
            {item.lastOrder.amountFiat
              ? ` ${fmtNumber(item.lastOrder.amountFiat)} ${item.lastOrder.fiat ?? ''}`
              : ''}
            {' · '}
            {fmtDate(item.lastOrder.createdAt)}
          </div>
        </div>
      </div>

      <div className="rating-row">
        {(['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as ReviewRating[]).map((r) => (
          <button
            key={r}
            className={`rating-btn ${r} ${rating === r ? 'active' : ''}`}
            onClick={() => setRating(r)}
          >
            {r === 'POSITIVE' ? 'Хорошо' : r === 'NEUTRAL' ? 'Нейтрально' : 'Плохо'}
          </button>
        ))}
      </div>

      {rating !== 'POSITIVE' ? (
        <div className="tag-picker">
          {REVIEW_TAG_ORDER.map((t) => (
            <button
              key={t}
              className={`tag-opt ${tag === t ? 'active' : ''} ${t === 'COMMENT' ? 'neutral' : ''}`}
              onClick={() => setTag(t)}
            >
              {REVIEW_TAG_LABEL[t]}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        rows={3}
        value={text}
        placeholder="Что произошло? Отзыв увидят все пользователи P2P Guard"
        onChange={(e) => setText(e.target.value)}
      />

      <button
        className="btn primary block"
        style={{ marginTop: 9 }}
        disabled={busy || text.trim().length < 3}
        onClick={() => void submit()}
      >
        {own ? 'Обновить отзыв' : 'Опубликовать'}
      </button>
    </div>
  );
}

// мои отзывы списком
function MyReviews({ items }: { items: MyReview[] | null }) {
  if (!items?.length) return null;

  return (
    <div className="card">
      <div className="card-title">
        Мои отзывы <span className="count">{items.length}</span>
      </div>
      {items.slice(0, 20).map((r) => (
        <div className="review" key={r.id}>
          <div className="review-head">
            <span className={`dot ${r.rating}`} />
            <span className="review-author">
              {r.counterparty.nickname ?? r.counterparty.externalId}
            </span>
            {r.tag !== 'COMMENT' ? (
              <span className="badge warn">{REVIEW_TAG_LABEL[r.tag]}</span>
            ) : null}
            <span style={{ flex: 1 }} />
            <span>{fmtDate(r.updatedAt)}</span>
          </div>
          <div className="review-text">{r.text}</div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Команда ─────────────────────────────

type TeamResponse = {
  team: { id: string; name: string; slug: string; ownerId: string };
  isLead: boolean;
  members: {
    id: string;
    binanceUid: string;
    nickname: string | null;
    role: string;
    status: string;
    isOwner: boolean;
    lastSeenAt: string | null;
    stats: { total: number; completed: number; cancelled: number; volumeFiat: number };
  }[];
};

function TeamTab({
  session,
  onError,
  onNotice,
  onReload,
}: {
  session: Session;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onReload: () => Promise<void>;
}) {
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [teamName, setTeamName] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session.user.teamId) {
      setTeam(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const response = await sendMessage<TeamResponse>({ type: 'GET_TEAM' });
    setLoading(false);
    if (response.ok) setTeam(response.data);
    else onError(response.error.message);
  }, [session.user.teamId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = async () => {
    setBusy(true);
    const response = await sendMessage({ type: 'JOIN_TEAM', token: token.trim() });
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    setToken('');
    onNotice('Вы в команде');
    await onReload();
    await load();
  };

  const leave = async () => {
    setBusy(true);
    const response = await sendMessage({ type: 'LEAVE_TEAM' });
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    onNotice('Вы вышли из команды');
    await onReload();
    await load();
  };

  const createInvite = async () => {
    setBusy(true);
    const response = await sendMessage<{ token: string }>({
      type: 'CREATE_TEAM_INVITE',
      maxUses: 1,
      expiresInDays: 14,
    });
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    setInvite(response.data.token);
  };

  const createTeam = async () => {
    setBusy(true);
    const response = await sendMessage({ type: 'CREATE_TEAM', name: teamName.trim() });
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    setTeamName('');
    onNotice('Команда создана, вы её тимлид');
    await onReload();
    await load();
  };

  if (!session.user.teamId) {
    return (
      <>
        <div className="muted">
          Команда даёт общий чёрный список, заметки по контрагентам и общую статистику сделок.
          Состоять можно только в одной.
        </div>

        <div className="seg">
          <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
            Вступить
          </button>
          <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
            Создать свою
          </button>
        </div>

        {mode === 'join' ? (
          <>
            <div className="card">
              <div className="card-title">
                <IconUsers size={13} /> Вступить в команду
              </div>
              <label>Токен приглашения от тимлида</label>
              <input value={token} placeholder="Вставьте токен" onChange={(e) => setToken(e.target.value)} />
              <button
                className="btn primary block"
                style={{ marginTop: 10 }}
                disabled={busy || token.trim().length < 10}
                onClick={() => void join()}
              >
                {busy ? 'Проверяем…' : 'Вступить'}
              </button>
            </div>
            <div className="hint">
              Токен выдаёт тимлид у себя во вкладке «Команда» или администратор в админ-панели.
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-title">
                <IconPlus size={13} /> Создать команду
              </div>
              <label>Название</label>
              <input
                value={teamName}
                placeholder="например «Альфа»"
                onChange={(e) => setTeamName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && teamName.trim().length >= 2 && void createTeam()}
              />
              <button
                className="btn primary block"
                style={{ marginTop: 10 }}
                disabled={busy || teamName.trim().length < 2}
                onClick={() => void createTeam()}
              >
                {busy ? 'Создаём…' : 'Создать'}
              </button>
            </div>
            <div className="hint">
              Вы станете тимлидом: сможете выдавать токены на вступление, вести общий чёрный список
              и заметки, видеть статистику всех участников.
            </div>
          </>
        )}
      </>
    );
  }

  if (loading) {
    return (
      <div className="center">
        <div className="spinner" />
        <div className="muted">Загружаем команду…</div>
      </div>
    );
  }

  if (!team) return <div className="muted">Не удалось загрузить команду</div>;

  return (
    <>
      <div className="card">
        <div className="card-title">
          <IconUsers size={13} /> {team.team.name}
          <span style={{ flex: 1 }} />
          <span className="badge">{team.members.length} чел.</span>
        </div>

        {team.members.map((m) => (
          <div className="member" key={m.id}>
            <div className="avatar" style={{ width: 28, height: 28 }}>
              <span className="initial">{initialOf(m.nickname, m.binanceUid)}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="n">
                {m.nickname ?? 'без ника'}
                {m.isOwner ? <span className="badge accent" style={{ marginLeft: 6 }}>тимлид</span> : null}
                {m.id === session.user.id ? <span className="badge" style={{ marginLeft: 6 }}>вы</span> : null}
              </div>
              <div className="s mono">UID {m.binanceUid}</div>
            </div>
            <div className="stat">
              <b>{fmtMoney(m.stats.volumeFiat)}</b>
              {fmtNumber(m.stats.completed)} / {fmtNumber(m.stats.cancelled)}
            </div>
          </div>
        ))}
      </div>

      {team.isLead ? (
        <div className="card">
          <div className="card-title">Пригласить в команду</div>
          {invite ? (
            <>
              <div className="token-reveal">{invite}</div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button
                  className="btn small"
                  onClick={() => {
                    void navigator.clipboard.writeText(invite);
                  }}
                >
                  <IconCopy size={13} /> Скопировать
                </button>
                <button className="btn ghost small" onClick={() => setInvite(null)}>
                  Скрыть
                </button>
              </div>
              <div className="hint" style={{ marginTop: 7 }}>
                В базе хранится только хэш — показать значение повторно нельзя.
              </div>
            </>
          ) : (
            <button className="btn block" disabled={busy} onClick={() => void createInvite()}>
              <IconPlus size={14} /> Создать токен (1 использование, 14 дней)
            </button>
          )}
        </div>
      ) : null}

      {team.team.ownerId !== session.user.id ? (
        <button className="btn danger block" disabled={busy} onClick={() => void leave()}>
          Выйти из команды
        </button>
      ) : (
        <div className="hint">
          Вы владелец команды. Чтобы выйти, сначала назначьте другого тимлида в админ-панели.
        </div>
      )}
    </>
  );
}

// ───────────────────────────── Шаблоны ─────────────────────────────

function TemplatesTab({ onError, onNotice }: { onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MessageTemplate | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await sendMessage<{ items: MessageTemplate[] }>({ type: 'GET_TEMPLATES' });
    setLoading(false);
    if (response.ok) setItems(response.data.items);
    else onError(response.error.message);
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (tpl: MessageTemplate | 'new') => {
    setEditing(tpl);
    setTitle(tpl === 'new' ? '' : tpl.title);
    setBody(tpl === 'new' ? '' : tpl.body);
    setShared(tpl === 'new' ? false : tpl.shared);
  };

  const save = async () => {
    setBusy(true);
    const response = await sendMessage({
      type: 'SAVE_TEMPLATE',
      id: editing && editing !== 'new' ? editing.id : undefined,
      title: title.trim(),
      body: body.trim(),
      shared,
    });
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    setEditing(null);
    onNotice('Шаблон сохранён');
    await load();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const response = await sendMessage({ type: 'DELETE_TEMPLATE', id });
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    await load();
  };

  if (editing) {
    return (
      <div className="card">
        <div className="card-title">{editing === 'new' ? 'Новый шаблон' : 'Изменить шаблон'}</div>
        <label>Название</label>
        <input value={title} autoFocus placeholder="Реквизиты" onChange={(e) => setTitle(e.target.value)} />
        <label>Текст</label>
        <textarea
          rows={4}
          value={body}
          placeholder="Отправьте, пожалуйста, реквизиты для перевода."
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="switch" style={{ marginTop: 9 }}>
          <div>
            <div className="k">Шаблон команды</div>
            <div className="d">виден всем участникам, создаёт тимлид</div>
          </div>
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            disabled={busy || title.trim().length < 1 || body.trim().length < 1}
            onClick={() => void save()}
          >
            Сохранить
          </button>
          <button className="btn ghost" onClick={() => setEditing(null)}>
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-title">
          Быстрые ответы <span className="count">{items.length}</span>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" title="Добавить" onClick={() => startEdit('new')}>
            <IconPlus size={15} />
          </button>
        </div>

        {loading ? (
          <div className="muted">Загружаем…</div>
        ) : items.length ? (
          items.map((t) => (
            <div className="tpl" key={t.id}>
              <div className="tpl-head">
                <span className="tpl-title">{t.title}</span>
                {t.shared ? <span className="badge">команда</span> : null}
                <button
                  className="icon-btn"
                  title="Скопировать"
                  onClick={() => {
                    void navigator.clipboard.writeText(t.body);
                    onNotice('Текст скопирован');
                  }}
                >
                  <IconCopy size={14} />
                </button>
                {t.canEdit ? (
                  <>
                    <button className="icon-btn" title="Изменить" onClick={() => startEdit(t)}>
                      <IconNote size={14} />
                    </button>
                    <button className="icon-btn" title="Удалить" disabled={busy} onClick={() => void remove(t.id)}>
                      <IconTrash size={14} />
                    </button>
                  </>
                ) : null}
              </div>
              <div className="tpl-body">{t.body}</div>
            </div>
          ))
        ) : (
          <div className="muted">Шаблонов пока нет. Добавьте первый — он появится в панели ордера.</div>
        )}
      </div>
    </>
  );
}

// ───────────────────────────── Настройки ─────────────────────────────

function SettingsTab({
  session,
  settings,
  onSettings,
  onError,
  onNotice,
  onLogout,
  onReloadSession,
}: {
  session: Session;
  settings: Settings | null;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onLogout: () => Promise<void>;
  onReloadSession: () => Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);
  const [apiUrl, setApiUrl] = useState(settings?.apiBaseUrl ?? '');

  const sync = async () => {
    setSyncing(true);
    const response = await sendMessage<{ created: number; updated: number } | null>({ type: 'SYNC_ORDERS' });
    setSyncing(false);

    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    if (!response.data) {
      onNotice('Синхронизация недоступна: проверьте, что вы вошли на binance.com');
      return;
    }
    onNotice(`Синхронизировано: новых ${response.data.created}, обновлено ${response.data.updated}`);
  };

  return (
    <>
      <div className="card">
        <div className="card-title">
          <IconUser size={13} /> Аккаунт
        </div>
        <div className="kv">
          <span>UID Binance</span>
          <b className="mono">{session.user.binanceUid}</b>
        </div>
        <div className="kv">
          <span>Ник</span>
          <b>{session.user.nickname ?? '—'}</b>
        </div>
        <div className="kv">
          <span>Роль</span>
          <span className="badge accent">
            {session.user.role === 'ADMIN' ? 'админ' : session.user.role === 'TEAM_LEAD' ? 'тимлид' : 'юзер'}
          </span>
        </div>
        <div className="kv">
          <span>Команда</span>
          <span className={`badge ${session.user.teamId ? 'ok' : ''}`}>
            {session.user.teamId ? 'подключена' : 'нет'}
          </span>
        </div>
        <div className="kv">
          <span>Подписка</span>
          <span className="badge ok">
            {session.user.subscription.plan === 'FREE' ? 'бесплатно' : session.user.subscription.plan}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Тема</div>
        <div className="seg">
          {(['light', 'dark', 'auto'] as const).map((t) => (
            <button
              key={t}
              className={settings?.theme === t ? 'active' : ''}
              onClick={() => void onSettings({ theme: t })}
            >
              {t === 'light' ? 'Светлая' : t === 'dark' ? 'Тёмная' : 'Как в системе'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Поведение</div>
        <div className="switch">
          <div>
            <div className="k">Панель на странице ордера</div>
            <div className="d">
              карточка контрагента поверх Binance. Пока выключено, расширение на страницу биржи не
              выводит ничего — проверять можно отсюда, через «Проверку»
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings?.panelEnabled ?? false}
            onChange={(e) => void onSettings({ panelEnabled: e.target.checked })}
          />
        </div>
        <div className="switch">
          <div>
            <div className="k">Синхронизировать мои ордера</div>
            <div className="d">пополняет общую статистику сделок</div>
          </div>
          <input
            type="checkbox"
            checked={settings?.autoSyncOrders ?? true}
            onChange={(e) => void onSettings({ autoSyncOrders: e.target.checked })}
          />
        </div>
        <div className="switch">
          <div>
            <div className="k">Собирать реквизиты из чата</div>
            <div className="d">ловит подмену карты в процессе сделки</div>
          </div>
          <input
            type="checkbox"
            checked={settings?.captureChatRequisites ?? true}
            onChange={(e) => void onSettings({ captureChatRequisites: e.target.checked })}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Панель в ордере</div>
        <div className="seg">
          {(
            [
              ['chat-bottom', 'Под чатом'],
              ['chat-left', 'Слева от чата'],
              ['floating', 'Свободно'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={settings?.panelPlacement === value ? 'active' : ''}
              onClick={() => void onSettings({ panelPlacement: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="d" style={{ marginTop: 6 }}>
          «Под чатом» ужимает окно переписки Binance и занимает освободившееся место, ничего не
          перекрывая
        </div>

        <label className="range">
          <span>
            Высота панели <b className="mono">{settings?.panelHeight ?? 340} px</b>
          </span>
          <input
            type="range"
            min={200}
            max={640}
            step={20}
            value={settings?.panelHeight ?? 340}
            onChange={(e) => void onSettings({ panelHeight: Number(e.target.value) })}
          />
        </label>

        {settings?.panelPlacement !== 'chat-bottom' ? (
          <label className="range">
            <span>
              Ширина панели <b className="mono">{settings?.panelWidth ?? 384} px</b>
            </span>
            <input
              type="range"
              min={280}
              max={560}
              step={8}
              value={settings?.panelWidth ?? 384}
              onChange={(e) => void onSettings({ panelWidth: Number(e.target.value) })}
            />
          </label>
        ) : null}
      </div>

      <div className="card">
        <div className="card-title">Шаблоны ответов</div>
        <div className="seg">
          {(
            [
              ['insert', 'Вставлять в поле'],
              ['send', 'Сразу отправлять'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={(settings?.templateMode ?? 'insert') === value ? 'active' : ''}
              onClick={() => void onSettings({ templateMode: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="d" style={{ marginTop: 6 }}>
          {settings?.templateMode === 'send'
            ? 'Нажатие на шаблон отправит сообщение контрагенту немедленно'
            : 'Текст подставится в поле ввода Binance — отправите сами'}
        </div>
      </div>

      <button className="btn block" disabled={syncing} onClick={() => void sync()}>
        <IconRefresh size={14} /> {syncing ? 'Синхронизация…' : 'Синхронизировать ордера'}
      </button>

      {/* команда и шаблоны — редкие операции, поэтому свёрнуты: главный экран
          попапа занят тем, что нужно после каждой сделки */}
      <details className="advanced">
        <summary>
          <IconUsers size={13} /> Команда
        </summary>
        <div style={{ marginTop: 8 }}>
          <TeamTab session={session} onError={onError} onNotice={onNotice} onReload={onReloadSession} />
        </div>
      </details>

      <details className="advanced">
        <summary>
          <IconNote size={13} /> Шаблоны быстрых ответов
        </summary>
        <div style={{ marginTop: 8 }}>
          <TemplatesTab onError={onError} onNotice={onNotice} />
        </div>
      </details>

      {/* Адрес сервера рядовому пользователю менять незачем: общая база отзывов
          и ЧС живёт на одном адресе для всех. Прячем и объясняем, что это. */}
      <details className="advanced">
        <summary>Для администратора</summary>
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-title">Куда расширение отправляет данные</div>
          <div className="hint" style={{ marginBottom: 8 }}>
            Адрес сервера P2P Guard — там лежит общая база отзывов, чёрного списка и сделок.
            Менять нужно, только если сервер развёрнут не по стандартному адресу. Сессия Binance
            туда не отправляется никогда.
          </div>
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          <button
            className="btn block"
            style={{ marginTop: 8 }}
            disabled={!apiUrl.trim() || apiUrl === settings?.apiBaseUrl}
            onClick={() => void onSettings({ apiBaseUrl: apiUrl.trim() }).then(() => onNotice('Адрес сохранён'))}
          >
            Сохранить адрес
          </button>
        </div>
      </details>

      <button className="btn ghost block" onClick={() => void onLogout()}>
        <IconLogout size={14} /> Выйти
      </button>
    </>
  );
}
