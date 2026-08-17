import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import type { TeamRow, UserDetail } from '../types';
import {
  ErrorBox,
  Loading,
  Modal,
  OrderStatusBadge,
  RoleBadge,
  Stat,
  StatusBadge,
  errText,
  fmtDate,
  fmtDateOnly,
  fmtInt,
  fmtMoney,
  useAsync,
} from '../ui';

export function UserCard({ id }: { id: string }) {
  const { data, loading, error, reload } = useAsync(() => api<UserDetail>(`/admin/users/${id}`), [id]);
  const teams = useAsync(() => api<{ items: TeamRow[] }>('/admin/teams'), []);

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      if (message) setNotice(message);
      reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  if (loading && !data) return <Loading what="Открываем карточку…" />;
  if (!data) return <ErrorBox message={error ?? 'Пользователь не найден'} />;

  const { user, stats, partners, recentOrders } = data;
  const successRate =
    stats.completed + stats.cancelled > 0
      ? Math.round((stats.completed / (stats.completed + stats.cancelled)) * 100)
      : null;

  return (
    <>
      <div className="page-head">
        <button className="small ghost" onClick={() => navigate('#/users')}>
          ← Пользователи
        </button>
        <h1 className="page-title" style={{ fontSize: 18 }}>
          <span className="mono">{user.binanceUid}</span>{' '}
          <span className="muted" style={{ fontWeight: 400 }}>
            {user.nickname ?? 'без ника'}
          </span>
        </h1>
        <RoleBadge role={user.role} />
        <StatusBadge status={user.status} reason={user.blockReason} />
        <div className="spacer" />
        <button className="small" onClick={() => setEditOpen(true)}>
          Изменить
        </button>
        <button className="small" onClick={() => setSubOpen(true)}>
          Подписка
        </button>
        {user.status === 'BLOCKED' ? (
          <button
            className="small"
            onClick={() =>
              void act(() => api(`/admin/users/${id}/unblock`, { method: 'POST' }), 'Пользователь разблокирован')
            }
          >
            Разблокировать
          </button>
        ) : (
          <button
            className="small danger"
            onClick={() => {
              const reason = window.prompt('Причина блокировки (её увидит пользователь):');
              if (!reason || reason.trim().length < 3) return;
              void act(
                () => api(`/admin/users/${id}/block`, { method: 'POST', body: { reason: reason.trim() } }),
                'Пользователь заблокирован, все его сессии закрыты',
              );
            }}
          >
            Заблокировать
          </button>
        )}
      </div>

      <div className="stack">
        <ErrorBox message={actionError} onClose={() => setActionError(null)} />
        {notice ? <div className="ok-box">{notice}</div> : null}
        {user.blockReason && user.status === 'BLOCKED' ? (
          <div className="error" style={{ cursor: 'default' }}>
            Заблокирован: {user.blockReason}
          </div>
        ) : null}

        <div className="grid cols-4">
          <Stat
            label="Оборот"
            value={fmtMoney(stats.volumeFiat)}
            sub={`за 30 дней: ${fmtMoney(stats.volume30dFiat)}`}
            tone="accent"
          />
          <Stat
            label="Успешные сделки"
            value={fmtInt(stats.completed)}
            sub={successRate === null ? 'нет данных' : `${successRate}% успеха`}
            tone="good"
          />
          <Stat
            label="Отменённые"
            value={fmtInt(stats.cancelled)}
            sub={`всего сделок: ${fmtInt(stats.totalOrders)}`}
            tone={stats.cancelled > 0 ? 'bad' : undefined}
          />
          <Stat label="Средний чек" value={fmtMoney(stats.avgTicketFiat)} sub={`сделок за 30 дней: ${fmtInt(stats.completed30d)}`} />
        </div>

        <div className="grid cols-2">
          <div className="card">
            <div className="card-title">Учётная запись</div>
            <table>
              <tbody>
                <tr>
                  <td className="muted">Команда</td>
                  <td>{user.team?.name ?? <span className="muted">не состоит</span>}</td>
                </tr>
                <tr>
                  <td className="muted">Подписка</td>
                  <td>
                    <span className={`badge ${user.subscription.status === 'ACTIVE' ? 'ok' : 'bad'}`}>
                      {user.subscription.plan}
                    </span>{' '}
                    {user.subscription.until ? (
                      <span className="muted">до {fmtDateOnly(user.subscription.until)}</span>
                    ) : (
                      <span className="muted">бессрочно</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Регистрация</td>
                  <td>{fmtDate(user.createdAt)}</td>
                </tr>
                <tr>
                  <td className="muted">Последняя активность</td>
                  <td>{fmtDate(user.lastSeenAt)}</td>
                </tr>
                <tr>
                  <td className="muted">Активных сессий</td>
                  <td>{fmtInt(user.activeSessions)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-title">С кем торговал</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Контрагент</th>
                    <th className="num">Сделок</th>
                    <th className="num">Объём</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p) => (
                    <tr key={p.counterpartyId ?? p.externalId}>
                      <td>
                        {p.nickname ?? <span className="muted">без ника</span>}{' '}
                        {p.blacklisted ? <span className="badge bad">в ЧС</span> : null}
                        <div className="muted mono" style={{ fontSize: 11 }}>
                          {p.externalId} {p.countryCode ? `· ${p.countryCode}` : ''}
                        </div>
                      </td>
                      <td className="num">{fmtInt(p.orders)}</td>
                      <td className="num">{fmtMoney(p.volumeFiat)}</td>
                    </tr>
                  ))}
                  {partners.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                        Сделок ещё не было
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Последние сделки</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ордер</th>
                  <th>Тип</th>
                  <th className="num">Сумма</th>
                  <th>Контрагент</th>
                  <th>Статус</th>
                  <th>Время</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono muted">···{o.externalId.slice(-6)}</td>
                    <td style={{ color: o.side === 'BUY' ? 'var(--good-text)' : 'var(--bad-text)', fontWeight: 600 }}>
                      {o.side}
                    </td>
                    <td className="num">
                      {o.amountFiat === null ? '—' : fmtInt(Math.round(o.amountFiat))} <span className="muted">{o.fiat ?? ''}</span>
                    </td>
                    <td>{o.counterparty?.nickname ?? o.counterparty?.externalId ?? <span className="muted">—</span>}</td>
                    <td>
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="nowrap muted">{fmtDate(o.createdAt)}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                      Сделок ещё не было
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editOpen ? (
        <EditUserModal
          user={user}
          teams={teams.data?.items ?? []}
          onClose={() => setEditOpen(false)}
          onSave={async (body) => {
            await act(() => api(`/admin/users/${id}`, { method: 'PATCH', body }), 'Изменения сохранены');
            setEditOpen(false);
          }}
        />
      ) : null}

      {subOpen ? (
        <SubscriptionModal
          onClose={() => setSubOpen(false)}
          onSave={async (body) => {
            await act(
              () => api(`/admin/users/${id}/subscription`, { method: 'POST', body }),
              'Подписка обновлена',
            );
            setSubOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

// ───────────────────────────── Модалки ─────────────────────────────

type EditBody = { role?: string; teamId?: string | null; nickname?: string | null; password?: string };

function EditUserModal({
  user,
  teams,
  onClose,
  onSave,
}: {
  user: UserDetail['user'];
  teams: TeamRow[];
  onClose: () => void;
  onSave: (body: EditBody) => Promise<void>;
}) {
  const [role, setRole] = useState(user.role);
  const [teamId, setTeamId] = useState(user.team?.id ?? '');
  const [nickname, setNickname] = useState(user.nickname ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const body: EditBody = {
      role,
      // пустая строка в селекте значит «убрать из команды», это null
      teamId: teamId || null,
      nickname: nickname.trim() || null,
    };
    if (password) body.password = password;
    await onSave(body);
    setBusy(false);
  };

  return (
    <Modal title="Изменить пользователя" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label>Роль</label>
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="USER">юзер</option>
            <option value="TEAM_LEAD">тимлид</option>
            <option value="ADMIN">админ</option>
          </select>
        </div>
        <div className="field">
          <label>Команда</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">без команды</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Ник</label>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <div className="field">
          <label>Новый пароль (пусто — не менять)</label>
          <input
            type="password"
            value={password}
            placeholder="минимум 8 символов"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="inline">
          <button className="primary" disabled={busy || (password.length > 0 && password.length < 8)} onClick={() => void submit()}>
            Сохранить
          </button>
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SubscriptionModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (body: { action: string; plan?: string; days?: number }) => Promise<void>;
}) {
  const [action, setAction] = useState<'extend' | 'set' | 'cancel'>('extend');
  const [plan, setPlan] = useState('PRO');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const body: { action: string; plan?: string; days?: number } = { action };
    if (action !== 'cancel') {
      body.plan = plan;
      if (action === 'extend' || days) body.days = days;
    }
    await onSave(body);
    setBusy(false);
  };

  return (
    <Modal title="Подписка" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label>Действие</label>
          <select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
            <option value="extend">продлить</option>
            <option value="set">выдать план</option>
            <option value="cancel">отменить</option>
          </select>
        </div>

        {action !== 'cancel' ? (
          <>
            <div className="field">
              <label>План</label>
              <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="FREE">FREE</option>
                <option value="PRO">PRO</option>
              </select>
            </div>
            <div className="field">
              <label>Дней</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </div>
          </>
        ) : (
          <div className="stat-sub">Подписка перейдёт в статус CANCELLED.</div>
        )}

        <div className="inline">
          <button className="primary" disabled={busy} onClick={() => void submit()}>
            Применить
          </button>
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
        <div className="stat-sub">
          Сейчас все пользователи на плане FREE и ограничения не применяются — поля заложены на будущее.
        </div>
      </div>
    </Modal>
  );
}
