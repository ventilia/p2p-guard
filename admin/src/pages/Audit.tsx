import { useState } from 'react';
import { api } from '../api';
import type { AuditRow, Paged } from '../types';
import { ErrorBox, Loading, Pager, fmtDate, fmtInt, useAsync } from '../ui';

const LIMIT = 50;

const ACTION_LABEL: Record<string, string> = {
  'auth.activate': 'активация по токену',
  'auth.login': 'вход',
  'auth.password_changed': 'смена пароля',
  'auth.refresh_reuse_detected': 'повторное использование refresh-токена',
  'admin.user_blocked': 'блокировка пользователя',
  'admin.user_unblocked': 'разблокировка пользователя',
  'admin.user_updated': 'изменение пользователя',
  'admin.subscription_changed': 'изменение подписки',
  'admin.token_created': 'выдан токен доступа',
  'admin.token_revoked': 'отозван токен доступа',
  'admin.team_created': 'создана команда',
  'admin.team_updated': 'изменена команда',
  'admin.team_deleted': 'удалена команда',
  'team.invite_created': 'тимлид выдал инвайт',
  'team.member_removed': 'исключён участник',
  'blacklist.add': 'добавление в чёрный список',
  'blacklist.revoke': 'снятие из чёрного списка',
};

const FILTERS = [
  { value: '', label: 'все действия' },
  { value: 'admin.', label: 'только админские' },
  { value: 'auth.', label: 'авторизация' },
  { value: 'blacklist.', label: 'чёрный список' },
  { value: 'team.', label: 'команды' },
];

export function Audit() {
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);

  const list = useAsync(() => {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (action) params.set('action', action);
    return api<Paged<AuditRow>>(`/admin/audit?${params}`);
  }, [action, offset]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Аудит</h1>
        <span className="page-sub">кто, что и над кем сделал</span>
        <div className="spacer" />
        <select
          style={{ width: 200 }}
          value={action}
          onChange={(e) => {
            setOffset(0);
            setAction(e.target.value);
          }}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <button className="small" onClick={list.reload}>
          Обновить
        </button>
      </div>

      <div className="stack">
        <ErrorBox message={list.error} />

        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Кто</th>
                    <th>Действие</th>
                    <th>Объект</th>
                    <th>Детали</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.items ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="nowrap muted">{fmtDate(row.createdAt)}</td>
                      <td className="nowrap">
                        {row.actor ? (
                          <a href={`#/users/${row.actor.id}`} className="mono">
                            {row.actor.binanceUid}
                          </a>
                        ) : (
                          <span className="muted">система</span>
                        )}
                      </td>
                      <td>
                        {ACTION_LABEL[row.action] ?? row.action}
                        <div className="muted mono" style={{ fontSize: 10.5 }}>
                          {row.action}
                        </div>
                      </td>
                      <td className="nowrap muted">
                        {row.targetType ? (
                          <>
                            {row.targetType}
                            <div className="mono" style={{ fontSize: 10.5 }}>
                              {row.targetId ? `···${row.targetId.slice(-8)}` : ''}
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="mono muted" style={{ fontSize: 11, maxWidth: 320, wordBreak: 'break-word' }}>
                        {row.meta ? JSON.stringify(row.meta) : '—'}
                      </td>
                      <td className="nowrap muted mono" style={{ fontSize: 11 }}>
                        {row.ip ?? '—'}
                      </td>
                    </tr>
                  ))}
                  {list.data && list.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                        Записей нет
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <Pager total={list.data?.total ?? 0} limit={LIMIT} offset={offset} onOffset={setOffset} />
            <div className="stat-sub" style={{ marginTop: 8 }}>
              Всего записей: {fmtInt(list.data?.total ?? 0)}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
