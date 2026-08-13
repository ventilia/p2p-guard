import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from '../shared/messages.js';
import type {
  ContextSource,
  Dossier,
  MessageTemplate,
  PanelState,
  ReviewRating,
} from '../shared/types.js';

const fmtNumber = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const RISK_LABEL: Record<string, string> = {
  LOW: 'Низкий риск',
  MEDIUM: 'Средний риск',
  HIGH: 'Высокий риск',
  CRITICAL: 'Критический риск',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидает',
  PAID: 'Оплачен',
  COMPLETED: 'Успешно',
  CANCELLED: 'Отменён',
  APPEALING: 'Апелляция',
  UNKNOWN: '—',
};

/** Единая точка вызова background с обработкой ответа-состояния. */
function usePanelAction(applyState: (state: PanelState) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (request: Parameters<typeof sendMessage>[0]) => {
      setBusy(true);
      setError(null);
      const response = await sendMessage<PanelState | null>(request);
      setBusy(false);

      if (!response.ok) {
        setError(response.error.message);
        return false;
      }
      if (response.data && typeof response.data === 'object' && 'status' in response.data) {
        applyState(response.data);
      }
      return true;
    },
    [applyState],
  );

  return { run, busy, error, setError };
}

// ───────────────────────────── Карточки ─────────────────────────────

function RiskCard({ dossier }: { dossier: Dossier }) {
  const { risk } = dossier;
  return (
    <div className={`risk ${risk.level}`}>
      <div className="risk-score">{risk.score}</div>
      <div style={{ flex: 1 }}>
        <div className="risk-label">{RISK_LABEL[risk.level] ?? risk.level}</div>
        <div className="factors">
          {risk.factors.slice(0, 4).map((f) => (
            <div className="factor" key={f.code}>
              <span className={`impact ${f.impact > 0 ? 'bad' : f.impact < 0 ? 'good' : ''}`}>
                {f.impact > 0 ? `+${f.impact}` : f.impact === 0 ? '·' : f.impact}
              </span>
              <span>{f.label}</span>
              {f.detail ? <span className="detail">· {f.detail}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeaderCard({ dossier }: { dossier: Dossier }) {
  const { counterparty, blacklist, reviewCounts } = dossier;
  const global = blacklist.filter((b) => b.scope === 'GLOBAL').length;
  const team = blacklist.filter((b) => b.scope === 'TEAM').length;

  return (
    <div className="card">
      <div className="nick-row">
        <span className="nick">{counterparty.nickname ?? 'Без ника'}</span>
        <span className="uid">UID {counterparty.externalId}</span>
        {counterparty.countryCode ? <span className="uid">{counterparty.countryCode}</span> : null}
      </div>
      {counterparty.maskedPhone ? (
        <div className="uid" style={{ marginTop: 2 }}>
          {counterparty.maskedPhone}
        </div>
      ) : null}

      <div className="badges" style={{ marginTop: 8 }}>
        <span className={`badge ${global ? 'danger' : 'ok'}`}>
          {global ? `🚫 Общий ЧС · ${global}` : '✓ Не в общем ЧС'}
        </span>
        <span className={`badge ${team ? 'danger' : ''}`}>
          {team ? `🚫 ЧС команды · ${team}` : 'Не в ЧС команды'}
        </span>
        {reviewCounts.negative > 0 ? (
          <span className="badge warn">👎 {reviewCounts.negative}</span>
        ) : null}
        {reviewCounts.positive > 0 ? (
          <span className="badge ok">👍 {reviewCounts.positive}</span>
        ) : null}
      </div>

      <div className="hint">
        Впервые в базе: {fmtDate(counterparty.firstSeenAt)}
      </div>
    </div>
  );
}

function BlacklistCard({
  dossier,
  onRevoke,
  busy,
}: {
  dossier: Dossier;
  onRevoke: (id: string) => void;
  busy: boolean;
}) {
  if (!dossier.blacklist.length) return null;

  return (
    <div className="card">
      <div className="card-title">Чёрный список</div>
      {dossier.blacklist.map((entry) => (
        <div className="review" key={entry.id}>
          <div className="review-head">
            <span className={`badge ${entry.scope === 'GLOBAL' ? 'danger' : 'warn'}`}>
              {entry.scope === 'GLOBAL' ? 'Общий' : 'Команда'}
            </span>
            <span>{fmtDate(entry.createdAt)}</span>
            {entry.author ? <span>· {entry.author}</span> : null}
            <span className="spacer" style={{ flex: 1 }} />
            {entry.canRevoke ? (
              <button
                className="icon-btn"
                title="Снять запись"
                disabled={busy}
                onClick={() => onRevoke(entry.id)}
              >
                ✕
              </button>
            ) : null}
          </div>
          <div className="review-text">{entry.reason}</div>
        </div>
      ))}
    </div>
  );
}

function TeamNoteCard({
  dossier,
  onSave,
  busy,
}: {
  dossier: Dossier;
  onSave: (text: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(dossier.teamNote?.text ?? '');

  useEffect(() => {
    setText(dossier.teamNote?.text ?? '');
    setEditing(false);
  }, [dossier.teamNote?.text, dossier.counterparty.id]);

  return (
    <div className="card">
      <div className="card-title">
        Заметка команды
        {!editing ? (
          <button className="icon-btn" onClick={() => setEditing(true)} title="Изменить">
            ✎
          </button>
        ) : null}
      </div>

      {editing ? (
        <>
          <textarea
            rows={3}
            value={text}
            placeholder="Видна только вашей команде"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions" style={{ marginTop: 6 }}>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => {
                onSave(text.trim());
                setEditing(false);
              }}
            >
              Сохранить
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </>
      ) : dossier.teamNote ? (
        <div className="review-text">{dossier.teamNote.text}</div>
      ) : (
        <div className="muted">Заметки нет. Она будет видна всей вашей команде.</div>
      )}
    </div>
  );
}

function ExchangeStatsCard({ dossier }: { dossier: Dossier }) {
  const s = dossier.exchangeStats;
  const hasData = Object.values(s).some((v) => v !== null && v !== undefined);
  if (!hasData) return null;

  const completion = s.completionRate !== null && s.completionRate !== undefined
    ? Math.round(s.completionRate * 100)
    : null;

  return (
    <div className="card">
      <div className="card-title">Статистика Binance</div>
      <div className="stats-grid">
        <div className={`stat ${completion !== null && completion < 90 ? 'danger' : ''}`}>
          <div className="stat-label">Завершено</div>
          <div className="stat-value">{completion === null ? '—' : `${completion}%`}</div>
          <div className="stat-sub">всего сделок: {fmtNumber(s.totalOrders)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">За 30 дней</div>
          <div className="stat-value">{fmtNumber(s.orders30d)}</div>
          <div className="stat-sub">ср. чек: {fmtNumber(s.avgAmount30dFiat)}</div>
        </div>
        <div className={`stat ${s.registeredDays !== null && (s.registeredDays ?? 999) < 30 ? 'danger' : ''}`}>
          <div className="stat-label">Дней с регистрации</div>
          <div className="stat-value">{fmtNumber(s.registeredDays)}</div>
          <div className="stat-sub">1-й ордер: {fmtNumber(s.firstOrderDays)} дн.</div>
        </div>
        <div className="stat">
          <div className="stat-label">Среднее время</div>
          <div className="stat-value">{fmtNumber(s.avgReleaseMinutes)} мин</div>
          <div className="stat-sub">оплата: {fmtNumber(s.avgPayMinutes)} мин</div>
        </div>
      </div>
    </div>
  );
}

function OrdersCard({ dossier }: { dossier: Dossier }) {
  const { market, team, own, recent } = dossier.orders;

  return (
    <div className="card">
      <div className="card-title">Ордеры по нашей базе</div>
      <div className="counters">
        <div className="counter">
          <b>{market.active}</b>
          <span>Активные</span>
        </div>
        <div className="counter good">
          <b>
            {market.completed} · <span style={{ color: '#ff8080' }}>{market.cancelled}</span>
          </b>
          <span>Всего</span>
        </div>
        <div className="counter">
          <b>
            {team.completed} · {team.cancelled}
          </b>
          <span>Команда</span>
        </div>
        <div className="counter">
          <b>
            {own.completed} · {own.cancelled}
          </b>
          <span>Ваши</span>
        </div>
      </div>

      {recent.length ? (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Тип</th>
              <th>Сумма</th>
              <th>Время</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {recent.slice(0, 8).map((o) => (
              <tr key={o.id}>
                <td className={o.side === 'BUY' ? 'buy' : 'sell'}>{o.side}</td>
                <td>{fmtNumber(o.amountFiat)}</td>
                <td>{fmtDate(o.createdAt)}</td>
                <td>
                  <span className={`status-chip ${o.status}`}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted" style={{ marginTop: 8 }}>
          Сделок с этим контрагентом ещё не было
        </div>
      )}
    </div>
  );
}

function RequisitesCard({ dossier }: { dossier: Dossier }) {
  if (!dossier.requisites.length) return null;

  return (
    <div className="card">
      <div className="card-title">Реквизиты, замеченные в чате</div>
      {dossier.requisites.map((r) => (
        <div className="req-row" key={r.id}>
          <span className="badge">{r.type === 'CARD' ? 'Карта' : r.type === 'PHONE' ? 'Телефон' : r.type}</span>
          <span style={{ flex: 1 }}>{r.mask}</span>
          {r.blacklisted ? (
            <span className="badge danger" title={r.alsoUsedBy.join(', ')}>
              в ЧС
            </span>
          ) : null}
          <span className="muted">×{r.timesSeen}</span>
        </div>
      ))}
    </div>
  );
}

function ReviewsCard({
  dossier,
  onSubmit,
  onDelete,
  busy,
}: {
  dossier: Dossier;
  onSubmit: (rating: ReviewRating, text: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const own = dossier.reviews.find((r) => r.isOwn);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<ReviewRating>(own?.rating ?? 'NEGATIVE');
  const [text, setText] = useState(own?.text ?? '');

  useEffect(() => {
    setOpen(false);
    setRating(own?.rating ?? 'NEGATIVE');
    setText(own?.text ?? '');
  }, [dossier.counterparty.id, own?.id, own?.rating, own?.text]);

  return (
    <div className="card">
      <div className="card-title">
        Отзывы · {dossier.reviews.length}
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={() => setOpen((v) => !v)}>
          {open ? '−' : own ? '✎' : '+'}
        </button>
      </div>

      {open ? (
        <div style={{ marginBottom: 10 }}>
          <div className="rating-row">
            {(['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as ReviewRating[]).map((r) => (
              <button
                key={r}
                className={`rating-btn ${r} ${rating === r ? 'active' : ''}`}
                onClick={() => setRating(r)}
              >
                {r === 'POSITIVE' ? '👍 Хорошо' : r === 'NEUTRAL' ? '· Нейтр.' : '👎 Плохо'}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={text}
            placeholder="Что произошло? Отзыв увидят все пользователи P2P Guard"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions" style={{ marginTop: 6 }}>
            <button
              className="btn primary"
              disabled={busy || text.trim().length < 3}
              onClick={() => {
                onSubmit(rating, text.trim());
                setOpen(false);
              }}
            >
              {own ? 'Обновить отзыв' : 'Опубликовать'}
            </button>
            {own ? (
              <button className="btn danger" disabled={busy} onClick={() => onDelete(own.id)}>
                Удалить
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {dossier.reviews.length ? (
        dossier.reviews.slice(0, 12).map((r) => (
          <div className="review" key={r.id}>
            <div className="review-head">
              <span className={`dot ${r.rating}`} />
              <span className="review-author">{r.isOwn ? 'Ваш отзыв' : r.author}</span>
              {r.isTeam && !r.isOwn ? <span className="badge">команда</span> : null}
              <span style={{ flex: 1 }} />
              <span>{fmtDate(r.createdAt)}</span>
            </div>
            <div className="review-text">{r.text}</div>
          </div>
        ))
      ) : (
        <div className="muted">Отзывов пока нет</div>
      )}
    </div>
  );
}

function BlacklistForm({
  dossier,
  onAdd,
  busy,
  isAdmin,
  hasTeam,
}: {
  dossier: Dossier;
  onAdd: (reason: string, severity: number, scope: 'GLOBAL' | 'TEAM') => void;
  busy: boolean;
  isAdmin: boolean;
  hasTeam: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState(2);
  const [scope, setScope] = useState<'GLOBAL' | 'TEAM'>(hasTeam ? 'TEAM' : 'GLOBAL');

  useEffect(() => {
    setOpen(false);
    setReason('');
  }, [dossier.counterparty.id]);

  // Без команды обычному пользователю писать некуда: общий ЧС ведёт админ.
  if (!hasTeam && !isAdmin) {
    return (
      <div className="hint">
        Добавление в чёрный список доступно участникам команды. Попросите тимлида
        выдать доступ.
      </div>
    );
  }

  if (!open) {
    return (
      <div className="actions">
        <button className="btn danger" onClick={() => setOpen(true)}>
          🚫 В чёрный список
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Добавить в чёрный список</div>
      <textarea
        rows={2}
        value={reason}
        placeholder="Причина: что именно произошло"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="actions" style={{ marginTop: 6 }}>
        <select value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
          <option value={1}>Низкая тяжесть</option>
          <option value={2}>Средняя</option>
          <option value={3}>Высокая</option>
        </select>
        {isAdmin ? (
          <select value={scope} onChange={(e) => setScope(e.target.value as 'GLOBAL' | 'TEAM')}>
            {hasTeam ? <option value="TEAM">Только команда</option> : null}
            <option value="GLOBAL">Общий список</option>
          </select>
        ) : null}
      </div>
      <div className="actions" style={{ marginTop: 6 }}>
        <button
          className="btn danger"
          disabled={busy || reason.trim().length < 3}
          onClick={() => {
            onAdd(reason.trim(), severity, scope);
            setOpen(false);
          }}
        >
          Добавить
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
      {!isAdmin ? (
        <div className="hint">Запись увидит только ваша команда. В общий ЧС добавляет админ.</div>
      ) : null}
    </div>
  );
}

const SOURCE_LABEL: Record<ContextSource, { text: string; hint: string }> = {
  intercept: { text: 'данные ордера', hint: 'прочитано из ответа самой страницы Binance' },
  api: { text: 'запрос к Binance', hint: 'страница не отдала данные, запросили сами' },
  dom: { text: 'разбор страницы', hint: 'API недоступен, ник и UID взяты со страницы' },
  manual: { text: 'UID указан вручную', hint: 'ордер не привязан' },
};

/** Честно показываем, откуда взялись данные: от этого зависит их полнота. */
function SourceBadge({ source }: { source: ContextSource }) {
  const info = SOURCE_LABEL[source];
  return (
    <div className="badges">
      <span className="badge" title={info.hint}>
        источник: {info.text}
      </span>
    </div>
  );
}

/** Спасательный сценарий: контрагент не определился автоматически. */
function ManualLookup({ busy, onLookup }: { busy: boolean; onLookup: (uid: string) => void }) {
  const [uid, setUid] = useState('');

  return (
    <div className="card">
      <div className="card-title">Указать контрагента вручную</div>
      <input
        value={uid}
        placeholder="UID контрагента с Binance"
        onChange={(e) => setUid(e.target.value.trim())}
      />
      <div className="actions" style={{ marginTop: 6 }}>
        <button className="btn primary" disabled={busy || uid.length < 4} onClick={() => onLookup(uid)}>
          Показать досье
        </button>
      </div>
      <div className="hint">
        UID виден в профиле контрагента: ссылка «advertiserNo» на странице объявления.
      </div>
    </div>
  );
}

function TemplatesCard({ templates }: { templates: MessageTemplate[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!templates.length) return null;

  const copy = async (template: MessageTemplate) => {
    try {
      await navigator.clipboard.writeText(template.body);
      setCopied(template.id);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="card">
      <div className="card-title">Быстрые ответы</div>
      <div className="templates">
        {templates.map((t) => (
          <button key={t.id} className="template-chip" onClick={() => void copy(t)}>
            {copied === t.id ? '✓ скопировано' : t.title}
          </button>
        ))}
      </div>
      <div className="hint">Клик копирует текст в буфер обмена</div>
    </div>
  );
}

// ───────────────────────────── Панель ─────────────────────────────

export function Panel() {
  const [state, setState] = useState<PanelState>({ status: 'idle' });
  const [collapsed, setCollapsed] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  const applyState = useCallback((next: PanelState) => setState(next), []);
  const { run, busy, error, setError } = usePanelAction(applyState);

  // Подписка на пуши background + запрос текущего состояния при монтировании.
  useEffect(() => {
    let alive = true;

    const listener = (message: { type?: string; state?: PanelState }) => {
      if (message?.type === 'PANEL_STATE' && message.state) setState(message.state);
    };
    chrome.runtime.onMessage.addListener(listener);

    void sendMessage<PanelState>({ type: 'GET_PANEL_STATE' }).then((response) => {
      if (alive && response.ok && response.data) setState(response.data);
    });

    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // Перетаскивание за шапку.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setOffset({
        x: drag.baseX + (e.clientX - drag.startX),
        y: drag.baseY + (e.clientY - drag.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
  };

  if (state.status === 'idle') return null;

  const transform = `translate(${offset.x}px, ${offset.y}px)`;
  const ready = state.status === 'ready' ? state : null;

  if (collapsed) {
    const level = state.status === 'ready' ? state.dossier.risk.level : null;
    return (
      <button className="fab" style={{ transform }} onClick={() => setCollapsed(false)} title="P2P Guard">
        PG
        {level ? <span className={`fab-dot ${level}`} /> : null}
      </button>
    );
  }

  const dossier = ready?.dossier ?? null;
  const isAdmin = ready?.role === 'ADMIN';
  const hasTeam = ready?.hasTeam ?? false;

  return (
    <div className="root" style={{ transform }}>
      <div className="header" onMouseDown={startDrag}>
        <div className="logo">PG</div>
        <div className="title">P2P Guard</div>
        <div className="spacer" />
        {state.status === 'ready' ? (
          <button
            className="icon-btn"
            title="Обновить"
            disabled={busy}
            onClick={() => void run({ type: 'REFRESH_DOSSIER' })}
          >
            ⟳
          </button>
        ) : null}
        <button className="icon-btn" title="Свернуть" onClick={() => setCollapsed(true)}>
          −
        </button>
      </div>

      <div className="body">
        {error ? (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        ) : null}

        {state.status === 'loading' ? (
          <div className="center">
            <div className="spinner" />
            <div className="muted">Собираем досье…</div>
          </div>
        ) : null}

        {state.status === 'unauthorized' ? (
          <div className="center">
            <div className="muted">{state.message}</div>
            <div className="hint">Откройте значок расширения и войдите</div>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <>
            <div className="error">{state.message}</div>
            <div className="actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => void run({ type: 'REFRESH_DOSSIER' })}
              >
                Повторить
              </button>
            </div>
            {state.canRetryManually ? (
              <ManualLookup busy={busy} onLookup={(uid) => void run({ type: 'MANUAL_LOOKUP', uid })} />
            ) : null}
          </>
        ) : null}

        {ready?.requisiteAlert ? (
          <div className="error">
            ⚠ В чате появился новый реквизит: <b>{ready.requisiteAlert.mask}</b>. Убедитесь, что
            платите по тем же данным, что в ордере.
          </div>
        ) : null}

        {dossier ? (
          <>
            <SourceBadge source={ready?.source ?? 'api'} />
            <RiskCard dossier={dossier} />
            <HeaderCard dossier={dossier} />
            <BlacklistCard
              dossier={dossier}
              busy={busy}
              onRevoke={(entryId) => void run({ type: 'REVOKE_BLACKLIST', entryId })}
            />
            {hasTeam ? (
              <TeamNoteCard
                dossier={dossier}
                busy={busy}
                onSave={(text) =>
                  void run({
                    type: 'SAVE_TEAM_NOTE',
                    counterpartyId: dossier.counterparty.id,
                    text,
                  })
                }
              />
            ) : null}
            <ReviewsCard
              dossier={dossier}
              busy={busy}
              onSubmit={(rating, text) =>
                void run({
                  type: 'SUBMIT_REVIEW',
                  counterpartyId: dossier.counterparty.id,
                  rating,
                  text,
                })
              }
              onDelete={(reviewId) => void run({ type: 'DELETE_REVIEW', reviewId })}
            />
            <ExchangeStatsCard dossier={dossier} />
            <OrdersCard dossier={dossier} />
            <RequisitesCard dossier={dossier} />
            <BlacklistForm
              dossier={dossier}
              busy={busy}
              isAdmin={isAdmin}
              hasTeam={hasTeam}
              onAdd={(reason, severity, scope) =>
                void run({
                  type: 'ADD_BLACKLIST',
                  counterpartyId: dossier.counterparty.id,
                  reason,
                  severity,
                  scope,
                })
              }
            />
            {ready ? <TemplatesCard templates={ready.templates} /> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
