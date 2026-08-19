// одна вёрстка на панель и попап: контрагента проверяют и до открытия ордера
import { useEffect, useState } from 'react';
import {
  IconAlert,
  IconBan,
  IconCard,
  IconCheck,
  IconClock,
  IconClose,
  IconNote,
  IconPencil,
  IconPhone,
  IconStar,
  IconTelegram,
  IconThumbDown,
  IconThumbUp,
  IconUser,
  TAG_ICON,
} from '../shared/icons.js';
import {
  STATUS_LABEL,
  fmtDate,
  fmtMinutes,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  initialOf,
} from '../shared/format.js';
import { phoneRegion } from '../shared/phone.js';
import { REVIEW_TAG_LABEL, type Dossier, type ReviewRating, type ReviewTag } from '../shared/types.js';

const RISK_LABEL: Record<string, string> = {
  LOW: 'Низкий риск',
  MEDIUM: 'Средний риск',
  HIGH: 'Высокий риск',
  CRITICAL: 'Критический риск',
};

// категории, которые считаем обвинением, а не мнением
const HEAVY_TAGS: ReviewTag[] = ['SCAM', 'DIRTY', 'PAINTER', 'FREEZE'];

// что стало с шаблоном; null — поле ввода на странице не нашлось
export type TemplateResult = 'inserted' | 'sent' | 'not-sent' | null;

const TEMPLATE_LABEL: Record<'inserted' | 'sent' | 'not-sent' | 'none', string> = {
  inserted: 'вставлено',
  sent: 'отправлено',
  'not-sent': 'не ушло, отправьте вручную',
  none: 'поле чата не найдено',
};

export type DossierActions = {
  busy: boolean;
  onReview: (rating: ReviewRating, tag: ReviewTag, text: string) => void;
  onDeleteReview: (id: string) => void;
  onTeamNote: (text: string) => void;
  onBlacklist: (reason: string, severity: number, scope: 'GLOBAL' | 'TEAM') => void;
  onRevokeBlacklist: (id: string) => void;
  isAdmin: boolean;
  hasTeam: boolean;
  // вставка шаблона в чат биржи, есть только в панели ордера
  // null означает, что поле ввода на странице не нашлось
  onUseTemplate?: (body: string) => Promise<TemplateResult>;
};

// ───────────────────────────── Мелочи ─────────────────────────────

// биржа фото не отдаёт, а рисовать несуществующее лицо нечестно
export function Avatar({ nickname, uid, size = 40 }: { nickname: string | null; uid: string; size?: number }) {
  const letter = initialOf(nickname, uid);
  return (
    <div className="avatar" style={{ width: size, height: size }} title="Аватар биржей не передаётся">
      {letter === '?' ? <IconUser size={Math.round(size * 0.5)} /> : <span className="initial">{letter}</span>}
    </div>
  );
}

// ───────────────────────────── Риск ─────────────────────────────

export function RiskCard({ dossier }: { dossier: Dossier }) {
  const { risk } = dossier;
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? risk.factors : risk.factors.slice(0, 4);
  const hidden = risk.factors.length - visible.length;

  const tone =
    risk.level === 'LOW' ? 'good' : risk.level === 'MEDIUM' ? 'warn' : 'bad';

  return (
    <div
      className="risk"
      style={
        {
          '--risk-bg': `var(--${tone}-bg)`,
          '--risk-line': `var(--${tone}-line)`,
          '--risk-text': `var(--${tone})`,
        } as React.CSSProperties
      }
    >
      <div className="risk-score">{risk.score}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="risk-label">{RISK_LABEL[risk.level] ?? risk.level}</div>
        <div className="risk-sub">почему такой балл:</div>
        <div className="factors">
          {visible.map((f) => (
            <div className="factor" key={f.code}>
              <span className={`impact ${f.impact > 0 ? 'bad' : f.impact < 0 ? 'good' : 'zero'}`}>
                {f.impact > 0 ? `+${f.impact}` : f.impact === 0 ? '·' : f.impact}
              </span>
              <span>
                {f.label}
                {f.detail ? <span className="detail"> · {f.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
        {hidden > 0 || expanded ? (
          <button className="more-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'свернуть' : `ещё ${hidden}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────────── Кто перед нами ─────────────────────────────

export function IdentityCard({ dossier }: { dossier: Dossier }) {
  const { counterparty, blacklist, tagCounts } = dossier;
  const global = blacklist.filter((b) => b.scope === 'GLOBAL').length;
  const team = blacklist.filter((b) => b.scope === 'TEAM').length;
  const scam = tagCounts.SCAM ?? 0;
  const freeze = tagCounts.FREEZE ?? 0;
  const region = phoneRegion(counterparty.maskedPhone);

  // «мошенник» важнее «мороза»
  const ourStatus =
    global > 0 || scam > 0
      ? { cls: 'bad', label: 'Мошенник', Icon: IconBan }
      : team > 0
        ? { cls: 'bad', label: 'В ЧС команды', Icon: IconBan }
        : freeze > 0
          ? { cls: 'warn', label: 'Мороз', Icon: IconAlert }
          : { cls: '', label: 'Не в ЧС', Icon: IconCheck };

  return (
    <div className="card">
      <div className="who">
        <Avatar nickname={counterparty.nickname} uid={counterparty.externalId} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nick">{counterparty.nickname ?? 'Без ника'}</div>
          <div className="meta-row">
            {/* явно подписываем: UID здесь биржевой, внутренний ID ниже */}
            <span className="uid">
              UID Binance <b className="mono">{counterparty.externalId}</b>
            </span>
            {counterparty.countryCode ? <span className="badge">{counterparty.countryCode}</span> : null}
          </div>
          {counterparty.maskedPhone ? (
            <div className="uid">
              {counterparty.maskedPhone}
              {/* регион номера — не страна аккаунта, поэтому подписан отдельно */}
              {region ? (
                <span className="muted" title="Регион телефонного номера, а не страна регистрации аккаунта">
                  {' '}
                  · регион номера: {region}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="status-grid">
        <div className={`status-cell ${ourStatus.cls}`}>
          <span className="k">База P2P Guard</span>
          <span className="v">
            <ourStatus.Icon size={14} />
            {ourStatus.label}
          </span>
        </div>
        <div className="status-cell">
          <span className="k">Telegram ЧС</span>
          <span className="v" style={{ color: 'var(--muted)' }} title="Источник появится после импорта баз">
            <IconTelegram size={14} />
            Не проверено
          </span>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 8 }}>
        Впервые в базе: {fmtDate(counterparty.firstSeenAt)} · внутренний ID P2P Guard{' '}
        <span className="mono">{counterparty.id}</span>
      </div>
    </div>
  );
}

// ярлыки категорий жалоб со счётчиками
export function TagsCard({ dossier }: { dossier: Dossier }) {
  const entries = (Object.entries(dossier.tagCounts) as [ReviewTag, number][])
    .filter(([tag, count]) => count > 0 && tag !== 'COMMENT')
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) return null;

  return (
    <div className="card">
      <div className="card-title">Жалобы трейдеров</div>
      <div className="tag-row">
        {entries.map(([tag, count]) => {
          const Icon = TAG_ICON[tag];
          const heavy = HEAVY_TAGS.includes(tag);
          return (
            <span className={`tag-chip ${heavy ? '' : 'mild'}`} key={tag}>
              <Icon size={13} />
              {REVIEW_TAG_LABEL[tag]}
              <span className="n">{count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── Статистика биржи ─────────────────────────────

export function ExchangeStatsCard({ dossier }: { dossier: Dossier }) {
  const s = dossier.exchangeStats;
  const has = Object.values(s).some((v) => v !== null && v !== undefined);
  if (!has) {
    return (
      <div className="card">
        <div className="card-title">Статистика Binance</div>
        <div className="muted">Биржа не отдала статистику по этому контрагенту</div>
      </div>
    );
  }

  const codes = new Set(dossier.risk.factors.map((f) => f.code));
  const positive = s.positiveCount ?? 0;
  const negative = s.negativeCount ?? 0;
  const total = positive + negative;
  const rate = s.positiveRate ?? (total ? positive / total : null);

  // биржа не всегда отдаёт признаки верификации, показываем только известные
  const verifications: [string, boolean][] = (
    [
      ['Почта', s.emailVerified],
      ['SMS', s.phoneVerified],
      ['Личность', s.kycVerified],
    ] as [string, boolean | null | undefined][]
  )
    .filter(([, ok]) => typeof ok === 'boolean')
    .map(([label, ok]) => [label, ok as boolean]);

  return (
    <div className="card">
      <div className="card-title">
        Статистика Binance
        <span className="spacer" style={{ flex: 1 }} />
        <span className="badge">
          <IconStar size={12} /> {fmtPercent(s.completionRate)}
        </span>
        {total ? (
          <>
            <span className="badge ok">
              <IconThumbUp size={12} /> {fmtNumber(positive)} ({fmtPercent(rate)})
            </span>
            {negative ? (
              <span className="badge bad">
                <IconThumbDown size={12} /> {fmtNumber(negative)}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="stats-grid">
        <div className={`stat ${codes.has('TICKET_MISMATCH') || codes.has('ORDER_VS_AVG_TICKET') ? 'flag' : ''}`}>
          <div className="stat-name">Средний чек</div>
          <div className="stat-pair">
            <span className="stat-k">Общий</span>
            <span className="stat-v">{fmtMoney(s.avgAmountFiat)}</span>
          </div>
          <div className="stat-pair">
            <span className="stat-k">30 дней</span>
            <span className="stat-v">{fmtMoney(s.avgAmount30dFiat)}</span>
          </div>
        </div>

        <div className={`stat ${codes.has('RECENT_ORDER_BURST') ? 'flag' : ''}`}>
          <div className="stat-name">Ордеров</div>
          <div className="stat-pair">
            <span className="stat-k">Всего</span>
            <span className="stat-v">{fmtNumber(s.totalOrders)}</span>
          </div>
          <div className="stat-pair">
            <span className="stat-k">30 дней</span>
            <span className="stat-v">{fmtNumber(s.orders30d)}</span>
          </div>
        </div>

        <div className={`stat ${codes.has('YOUNG_ACCOUNT') || codes.has('FIRST_ORDER_RECENT') ? 'flag' : ''}`}>
          <div className="stat-name">Дней с</div>
          <div className="stat-pair">
            <span className="stat-k">Регистрации</span>
            <span className="stat-v">{fmtNumber(s.registeredDays)}</span>
          </div>
          <div className="stat-pair">
            <span className="stat-k">1-го ордера</span>
            <span className="stat-v">{fmtNumber(s.firstOrderDays)}</span>
          </div>
        </div>

        <div className={`stat ${codes.has('SLOW_RELEASE') ? 'flag' : ''}`}>
          <div className="stat-name">Среднее время</div>
          <div className="stat-pair">
            <span className="stat-k">Перевода</span>
            <span className="stat-v">{fmtMinutes(s.avgReleaseMinutes)}</span>
          </div>
          <div className="stat-pair">
            <span className="stat-k">Оплаты</span>
            <span className="stat-v">{fmtMinutes(s.avgPayMinutes)}</span>
          </div>
        </div>

        <div className="stat">
          <div className="stat-name">Исполнение</div>
          <div className="stat-pair">
            <span className="stat-k">Всё время</span>
            <span className="stat-v">{fmtPercent(s.completionRate)}</span>
          </div>
          <div className="stat-pair">
            <span className="stat-k">30 дней</span>
            <span className="stat-v">{fmtPercent(s.completionRate30d)}</span>
          </div>
        </div>

        <div className="stat">
          <div className="stat-name">Аккаунт</div>
          <div className="stat-pair">
            <span className="stat-k">Создан</span>
            <span className="stat-v">{s.joinedAt ? fmtDate(s.joinedAt) : '—'}</span>
          </div>
          <div className="stat-pair">
            <span className="stat-k">Отзывов</span>
            <span className="stat-v">{fmtNumber(s.feedbackCount)}</span>
          </div>
        </div>

      </div>

      {/* биржа средний чек не отдаёт, и придумывать его нельзя */}
      <div className="hint" style={{ marginTop: 8 }}>
        Средний чек считается по сделкам базы.
      </div>

      <div className="verify">
        <span
          className={`badge ${s.kycCountry ? 'accent' : ''}`}
          title={
            s.kycCountry
              ? 'Страна регистрации аккаунта по данным Binance'
              : 'Binance не отдала страну регистрации по этому контрагенту'
          }
        >
          Регистрация: {s.kycCountry ?? 'неизвестна'}
        </span>
        {s.merchantLevel ? <span className="badge">{s.merchantLevel}</span> : null}
        {verifications.map(([label, ok]) => (
          <span key={label} className={`badge ${ok ? 'ok' : 'bad'}`}>
            {ok ? '✓' : '✕'} {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// отзывы самой биржи, отдельным блоком
export function ExchangeReviewsCard({ dossier }: { dossier: Dossier }) {
  const s = dossier.exchangeStats;
  const negative = s.negativeCount ?? 0;
  // сначала отрицательные: ради них карточку и открывают
  const items = [...(dossier.exchangeReviews ?? [])]
    .sort((a, b) => Number(b.rating === 'NEGATIVE') - Number(a.rating === 'NEGATIVE'))
    .slice(0, 6);

  return (
    <div className="card">
      <div className="card-title">Отзывы Binance</div>
      {negative > 0 ? (
        <div className="alert bad">
          <IconThumbDown size={15} />
          <span>
            Плохих отзывов на бирже: <b>{fmtNumber(negative)}</b>
            {s.positiveCount ? ` из ${fmtNumber((s.positiveCount ?? 0) + negative)}` : ''}
          </span>
        </div>
      ) : (
        <div className="muted">Плохие отзывы отсутствуют</div>
      )}

      {items.length ? (
        <div className="reviews" style={{ marginTop: 9 }}>
          {items.map((r, i) => (
            <div key={`${r.author ?? 'anon'}-${i}`} className="review">
              <div className="review-head">
                <span className={`badge ${r.rating === 'NEGATIVE' ? 'bad' : 'ok'}`}>
                  {r.rating === 'NEGATIVE' ? <IconThumbDown size={12} /> : <IconThumbUp size={12} />}
                  {r.author ?? 'Аноним'}
                </span>
                <span className="spacer" style={{ flex: 1 }} />
                {r.createdAt ? <span className="muted mono">{fmtDate(r.createdAt)}</span> : null}
              </div>
              {r.text ? <div className="review-text">{r.text}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Ордеры ─────────────────────────────

function OrdersTable({
  rows,
  showTrader,
}: {
  rows: Dossier['orders']['recent'];
  showTrader: boolean;
}) {
  if (!rows.length) return <div className="muted">Записей нет</div>;

  return (
    <div className="scroll-y">
      <table>
        <thead>
          <tr>
            <th>Тип</th>
            <th>{showTrader ? 'Ник' : 'ID'}</th>
            <th style={{ textAlign: 'right' }}>Сумма</th>
            <th>Время</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td className={o.side === 'BUY' ? 'buy' : 'sell'}>{o.side}</td>
              <td className="mono">{showTrader ? (o.traderNickname ?? o.trader) : o.externalId}</td>
              <td className="num">{fmtNumber(o.amountFiat)}</td>
              <td className="mono">{fmtDate(o.createdAt)}</td>
              <td>
                <span className={`status-chip ${o.status}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrdersCard({ dossier }: { dossier: Dossier }) {
  const { market, team, own, recent } = dossier.orders;
  const teamRows = recent.filter((o) => o.isTeam);

  return (
    <>
      <div className="card">
        <div className="card-title">
          Ордеры
          <span className="legend">
            <span>
              <i className="dot-ok" /> Успешно
            </span>
            <span>
              <i className="dot-bad" /> Отменено
            </span>
          </span>
        </div>
        <div className="counters">
          <div className="counter">
            <b>{market.active}</b>
            <span className="k">Активные</span>
          </div>
          <div className="counter">
            <b>
              <span className="ok">{market.completed}</span>
              <span className="sep">·</span>
              <span className="bad">{market.cancelled}</span>
            </b>
            <span className="k">Всего</span>
          </div>
          <div className="counter">
            <b>
              <span className="ok">{team.completed}</span>
              <span className="sep">·</span>
              <span className="bad">{team.cancelled}</span>
            </b>
            <span className="k">Команда</span>
          </div>
          <div className="counter">
            <b>
              <span className="ok">{own.completed}</span>
              <span className="sep">·</span>
              <span className="bad">{own.cancelled}</span>
            </b>
            <span className="k">Ваших</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Общие <span className="count">{recent.length}</span>
        </div>
        <OrdersTable rows={recent} showTrader={false} />
      </div>

      {teamRows.length ? (
        <div className="card">
          <div className="card-title">
            Команда <span className="count">{teamRows.length}</span>
          </div>
          <OrdersTable rows={teamRows} showTrader />
        </div>
      ) : null}
    </>
  );
}

// ───────────────────────────── Реквизиты ─────────────────────────────

export function RequisitesCard({ dossier }: { dossier: Dossier }) {
  return (
    <div className="card">
      <div className="card-title">Реквизиты из чата</div>
      {dossier.requisites.length ? (
        dossier.requisites.map((r) => (
          <div className="req-row" key={r.id}>
            {r.type === 'CARD' ? <IconCard size={15} /> : <IconPhone size={15} />}
            <span className="req-mask mono">{r.value}</span>
            {r.blacklisted ? (
              <span className="badge bad" title={`Замечен также у: ${r.alsoUsedBy.join(', ')}`}>
                <IconBan size={12} /> в ЧС
              </span>
            ) : null}
            <span className="muted">×{r.timesSeen}</span>
          </div>
        ))
      ) : (
        <div className="muted">Реквизиты не найдены</div>
      )}
    </div>
  );
}

// ───────────────────────────── Чёрный список ─────────────────────────────

export function BlacklistCard({
  dossier,
  actions,
}: {
  dossier: Dossier;
  actions: Pick<DossierActions, 'busy' | 'onRevokeBlacklist'>;
}) {
  if (!dossier.blacklist.length) return null;

  return (
    <div className="card">
      <div className="card-title">Чёрный список</div>
      {dossier.blacklist.map((entry) => (
        <div className="review" key={entry.id}>
          <div className="review-head">
            <span className={`badge ${entry.scope === 'GLOBAL' ? 'bad' : 'warn'}`}>
              {entry.scope === 'GLOBAL' ? 'Общий' : 'Команда'}
            </span>
            <span>{fmtDate(entry.createdAt)}</span>
            {entry.author ? <span>· {entry.author}</span> : null}
            <span style={{ flex: 1 }} />
            {entry.canRevoke ? (
              <button
                className="icon-btn"
                title="Снять запись"
                disabled={actions.busy}
                onClick={() => actions.onRevokeBlacklist(entry.id)}
              >
                <IconClose size={13} />
              </button>
            ) : null}
          </div>
          <div className="review-text">{entry.reason}</div>
        </div>
      ))}
    </div>
  );
}

export function BlacklistForm({ dossier, actions }: { dossier: Dossier; actions: DossierActions }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState(2);
  const [scope, setScope] = useState<'GLOBAL' | 'TEAM'>(actions.hasTeam ? 'TEAM' : 'GLOBAL');

  useEffect(() => {
    setOpen(false);
    setReason('');
  }, [dossier.counterparty.id]);

  if (!actions.hasTeam && !actions.isAdmin) {
    return (
      <div className="hint">
        Добавление в чёрный список доступно участникам команды. Попросите тимлида выдать доступ.
      </div>
    );
  }

  if (!open) {
    return (
      <div className="actions">
        <button className="btn danger block" onClick={() => setOpen(true)}>
          <IconBan size={15} /> В чёрный список
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Причина добавления в ЧС</div>
      <textarea
        rows={2}
        value={reason}
        placeholder="Что именно произошло"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="actions" style={{ marginTop: 7 }}>
        <select value={severity} onChange={(e) => setSeverity(Number(e.target.value))} style={{ flex: 1 }}>
          <option value={1}>Низкая тяжесть</option>
          <option value={2}>Средняя</option>
          <option value={3}>Высокая</option>
        </select>
        {actions.isAdmin ? (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'GLOBAL' | 'TEAM')}
            style={{ flex: 1 }}
          >
            {actions.hasTeam ? <option value="TEAM">Только команда</option> : null}
            <option value="GLOBAL">Общий список</option>
          </select>
        ) : null}
      </div>
      <div className="actions" style={{ marginTop: 7 }}>
        <button
          className="btn danger"
          disabled={actions.busy || reason.trim().length < 3}
          onClick={() => {
            actions.onBlacklist(reason.trim(), severity, scope);
            setOpen(false);
          }}
        >
          Добавить
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
      {!actions.isAdmin ? (
        <div className="hint" style={{ marginTop: 6 }}>
          Запись увидит только ваша команда. В общий ЧС добавляет администратор.
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Заметка команды ─────────────────────────────

export function TeamNoteCard({ dossier, actions }: { dossier: Dossier; actions: DossierActions }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(dossier.teamNote?.text ?? '');

  useEffect(() => {
    setText(dossier.teamNote?.text ?? '');
    setEditing(false);
  }, [dossier.teamNote?.text, dossier.counterparty.id]);

  return (
    <div className="card">
      <div className="card-title">
        <IconNote size={13} /> Заметка команды
        <span style={{ flex: 1 }} />
        {!editing ? (
          <button className="icon-btn" onClick={() => setEditing(true)} title="Изменить">
            <IconPencil size={13} />
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
          <div className="actions" style={{ marginTop: 7 }}>
            <button
              className="btn primary"
              disabled={actions.busy}
              onClick={() => {
                actions.onTeamNote(text.trim());
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
        <>
          <div className="review-text">{dossier.teamNote.text}</div>
          <div className="hint" style={{ marginTop: 5 }}>
            {dossier.teamNote.author ?? 'команда'} · {fmtDate(dossier.teamNote.updatedAt)}
          </div>
        </>
      ) : (
        <div className="muted">Заметки нет. Она будет видна всей вашей команде.</div>
      )}
    </div>
  );
}

// ───────────────────────────── Отзывы ─────────────────────────────

const TAG_ORDER: ReviewTag[] = ['SCAM', 'FREEZE', 'DIRTY', 'TERMS', 'PAINTER', 'RUDE', 'COMMENT'];

export function ReviewsCard({ dossier, actions }: { dossier: Dossier; actions: DossierActions }) {
  const own = dossier.reviews.find((r) => r.isOwn);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<ReviewRating>(own?.rating ?? 'NEGATIVE');
  const [tag, setTag] = useState<ReviewTag>(own?.tag ?? 'SCAM');
  const [text, setText] = useState(own?.text ?? '');

  useEffect(() => {
    setOpen(false);
    setRating(own?.rating ?? 'NEGATIVE');
    setTag(own?.tag ?? 'SCAM');
    setText(own?.text ?? '');
  }, [dossier.counterparty.id, own?.id, own?.rating, own?.tag, own?.text]);

  // положительный отзыв обвинением быть не может, тег схлопывается
  useEffect(() => {
    if (rating === 'POSITIVE') setTag('COMMENT');
  }, [rating]);

  const { positive, neutral, negative } = dossier.reviewCounts;

  return (
    <div className="card">
      <div className="card-title">
        Отзывы <span className="count">{positive + neutral + negative}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={() => setOpen((v) => !v)} title={own ? 'Изменить свой' : 'Оставить отзыв'}>
          {open ? <IconClose size={14} /> : own ? <IconPencil size={14} /> : <IconPencil size={14} />}
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
                {r === 'POSITIVE' ? <IconThumbUp size={13} /> : r === 'NEGATIVE' ? <IconThumbDown size={13} /> : null}
                {r === 'POSITIVE' ? 'Хорошо' : r === 'NEUTRAL' ? 'Нейтрально' : 'Плохо'}
              </button>
            ))}
          </div>

          {rating !== 'POSITIVE' ? (
            <div className="tag-picker">
              {TAG_ORDER.map((t) => {
                const Icon = TAG_ICON[t];
                return (
                  <button
                    key={t}
                    className={`tag-opt ${tag === t ? 'active' : ''} ${t === 'COMMENT' ? 'neutral' : ''}`}
                    onClick={() => setTag(t)}
                  >
                    <Icon size={14} />
                    {REVIEW_TAG_LABEL[t]}
                  </button>
                );
              })}
            </div>
          ) : null}

          <textarea
            rows={3}
            value={text}
            placeholder="Что произошло? Отзыв увидят все пользователи P2P Guard"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions" style={{ marginTop: 7 }}>
            <button
              className="btn primary"
              disabled={actions.busy || text.trim().length < 3}
              onClick={() => {
                actions.onReview(rating, tag, text.trim());
                setOpen(false);
              }}
            >
              {own ? 'Обновить отзыв' : 'Опубликовать'}
            </button>
            {own ? (
              <button className="btn danger" disabled={actions.busy} onClick={() => actions.onDeleteReview(own.id)}>
                Удалить
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {dossier.reviews.length ? (
        dossier.reviews.slice(0, 20).map((r) => {
          const Icon = TAG_ICON[r.tag] ?? TAG_ICON.COMMENT;
          return (
            <div className="review" key={r.id}>
              <div className="review-head">
                <span className="review-ava">
                  <Icon size={12} />
                </span>
                <span className="review-author">{r.isOwn ? 'Ваш отзыв' : r.author}</span>
                {r.tag !== 'COMMENT' ? (
                  <span className={`badge ${HEAVY_TAGS.includes(r.tag) ? 'bad' : 'warn'}`}>
                    {REVIEW_TAG_LABEL[r.tag]}
                  </span>
                ) : null}
                {r.isTeam && !r.isOwn ? <span className="badge">команда</span> : null}
                <span style={{ flex: 1 }} />
                <span>{fmtDate(r.createdAt)}</span>
              </div>
              <div className="review-text">{r.text}</div>
            </div>
          );
        })
      ) : (
        <div className="muted">Отзывы отсутствуют</div>
      )}
    </div>
  );
}

// ───────────────────────────── Быстрые ответы ─────────────────────────────

export function TemplatesCard({
  templates,
  onUse,
}: {
  templates: { id: string; title: string; body: string }[];
  onUse?: (body: string) => Promise<TemplateResult>;
}) {
  const [done, setDone] = useState<{ id: string; label: string } | null>(null);
  if (!templates.length) return null;

  const use = async (id: string, body: string) => {
    // в ордере пишем прямо в поле чата, вне его остаётся буфер обмена
    if (onUse) {
      setDone({ id, label: '…' });
      setDone({ id, label: TEMPLATE_LABEL[(await onUse(body)) ?? 'none'] });
    } else {
      try {
        await navigator.clipboard.writeText(body);
        setDone({ id, label: 'скопировано' });
      } catch {
        setDone(null);
        return;
      }
    }
    setTimeout(() => setDone(null), 1600);
  };

  return (
    <div className="card">
      <div className="card-title">Быстрые ответы</div>
      <div className="templates">
        {templates.map((t) => (
          <button key={t.id} className="template-chip" onClick={() => void use(t.id, t.body)}>
            {done?.id === t.id ? (
              <>
                <IconCheck size={12} /> {done.label}
              </>
            ) : (
              t.title
            )}
          </button>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        <IconClock size={11} />{' '}
        {onUse
          ? 'Клик подставляет текст в чат Binance — режим настраивается в расширении'
          : 'Клик копирует текст в буфер обмена'}
      </div>
    </div>
  );
}

// полное досье одним блоком: и в панели, и в попапе
export function DossierView({
  dossier,
  actions,
  templates,
}: {
  dossier: Dossier;
  actions: DossierActions;
  templates?: { id: string; title: string; body: string }[];
}) {
  return (
    <>
      <RiskCard dossier={dossier} />
      <IdentityCard dossier={dossier} />
      <TagsCard dossier={dossier} />
      <BlacklistCard dossier={dossier} actions={actions} />
      {actions.hasTeam ? <TeamNoteCard dossier={dossier} actions={actions} /> : null}
      <ReviewsCard dossier={dossier} actions={actions} />
      <ExchangeStatsCard dossier={dossier} />
      <ExchangeReviewsCard dossier={dossier} />
      <OrdersCard dossier={dossier} />
      <RequisitesCard dossier={dossier} />
      <BlacklistForm dossier={dossier} actions={actions} />
      {templates?.length ? <TemplatesCard templates={templates} onUse={actions.onUseTemplate} /> : null}
    </>
  );
}
