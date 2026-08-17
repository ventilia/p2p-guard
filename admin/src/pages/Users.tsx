import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import type { AdminUser, Paged, TeamRow } from '../types';
import {
  ErrorBox,
  Loading,
  Pager,
  RoleBadge,
  StatusBadge,
  errText,
  fmtDate,
  fmtInt,
  fmtMoney,
  useAsync,
} from '../ui';

const LIMIT = 25;

export function Users() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [teamId, setTeamId] = useState('');
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const teams = useAsync(() => api<{ items: TeamRow[] }>('/admin/teams'), []);

  const list = useAsync(() => {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (applied) params.set('q', applied);
    if (status) params.set('status', status);
    if (role) params.set('role', role);
    if (teamId) params.set('teamId', teamId);
    return api<Paged<AdminUser>>(`/admin/users?${params}`);
  }, [applied, status, role, teamId, offset]);

  const search = () => {
    setOffset(0);
    setApplied(q.trim());
  };

  const toggleBlock = async (user: AdminUser) => {
    setActionError(null);
    try {
      if (user.status === 'BLOCKED') {
        await api(`/admin/users/${user.id}/unblock`, { method: 'POST' });
      } else {
        const reason = window.prompt('Причина блокировки (её увидит пользователь):');
        if (!reason || reason.trim().length < 3) return;
        await api(`/admin/users/${user.id}/block`, { method: 'POST', body: { reason: reason.trim() } });
      }
      list.reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Пользователи</h1>
        <span className="page-sub">{list.data ? `всего ${fmtInt(list.data.total)}` : null}</span>
        <div className="spacer" />
        <button className="small" onClick={list.reload}>
          Обновить
        </button>
      </div>

      <div className="stack">
        <div className="card">
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <label>Поиск по UID или нику</label>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            </div>
            <div className="field">
              <label>Статус</label>
              <select
                value={status}
                onChange={(e) => {
                  setOffset(0);
                  setStatus(e.target.value);
                }}
              >
                <option value="">любой</option>
                <option value="ACTIVE">активные</option>
                <option value="BLOCKED">заблокированные</option>
              </select>
            </div>
            <div className="field">
              <label>Роль</label>
              <select
                value={role}
                onChange={(e) => {
                  setOffset(0);
                  setRole(e.target.value);
                }}
              >
                <option value="">любая</option>
                <option value="USER">юзер</option>
                <option value="TEAM_LEAD">тимлид</option>
                <option value="ADMIN">админ</option>
              </select>
            </div>
            <div className="field">
              <label>Команда</label>
              <select
                value={teamId}
                onChange={(e) => {
                  setOffset(0);
                  setTeamId(e.target.value);
                }}
              >
                <option value="">любая</option>
                {(teams.data?.items ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={search}>Найти</button>
          </div>
        </div>

        <ErrorBox message={actionError} onClose={() => setActionError(null)} />
        <ErrorBox message={list.error} />

        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>UID / ник</th>
                    <th>Роль</th>
                    <th>Команда</th>
                    <th>Статус</th>
                    <th className="num">Сделок</th>
                    <th className="num">Успешных</th>
                    <th className="num">Оборот</th>
                    <th className="num">Отзывов</th>
                    <th>Заходил</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.items ?? []).map((u) => (
                    <tr key={u.id}>
                      <td>
                        <a href={`#/users/${u.id}`} className="mono">
                          {u.binanceUid}
                        </a>
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {u.nickname ?? 'без ника'}
                        </div>
                      </td>
                      <td>
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="nowrap">{u.team?.name ?? <span className="muted">—</span>}</td>
                      <td>
                        <StatusBadge status={u.status} reason={u.blockReason} />
                      </td>
                      <td className="num">{fmtInt(u.orders)}</td>
                      <td className="num">{fmtInt(u.completedOrders)}</td>
                      <td className="num">{fmtMoney(u.volumeFiat)}</td>
                      <td className="num">{fmtInt(u.reviews)}</td>
                      <td className="nowrap muted">{fmtDate(u.lastSeenAt)}</td>
                      <td className="nowrap">
                        <button className="small" onClick={() => navigate(`#/users/${u.id}`)}>
                          Карточка
                        </button>{' '}
                        <button
                          className={`small ${u.status === 'BLOCKED' ? '' : 'danger'}`}
                          onClick={() => void toggleBlock(u)}
                        >
                          {u.status === 'BLOCKED' ? 'Разблокировать' : 'Заблокировать'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {list.data && list.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                        Никого не нашлось
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <Pager
              total={list.data?.total ?? 0}
              limit={LIMIT}
              offset={offset}
              onOffset={setOffset}
            />
          </div>
        )}
      </div>
    </>
  );
}
