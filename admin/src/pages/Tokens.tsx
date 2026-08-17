import { useState } from 'react';
import { api } from '../api';
import type { InviteTokenRow, Paged, TeamRow } from '../types';
import { ErrorBox, Loading, Modal, Pager, RoleBadge, errText, fmtDate, fmtInt, useAsync } from '../ui';

const LIMIT = 25;

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  ACTIVE: { cls: 'badge ok', label: 'активен' },
  USED: { cls: 'badge', label: 'исчерпан' },
  EXPIRED: { cls: 'badge warn', label: 'просрочен' },
  REVOKED: { cls: 'badge bad', label: 'отозван' },
};

export function Tokens() {
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const teams = useAsync(() => api<{ items: TeamRow[] }>('/admin/teams'), []);
  const list = useAsync(
    () => api<Paged<InviteTokenRow>>(`/admin/tokens?limit=${LIMIT}&offset=${offset}`),
    [offset],
  );

  const revoke = async (id: string) => {
    if (!window.confirm('Отозвать токен? Активировать расширение по нему станет нельзя.')) return;
    setActionError(null);
    try {
      await api(`/admin/tokens/${id}`, { method: 'DELETE' });
      list.reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Токены доступа</h1>
        <span className="page-sub">по ним пользователи активируют расширение</span>
        <div className="spacer" />
        <button className="primary small" onClick={() => setCreateOpen(true)}>
          Выдать токен
        </button>
      </div>

      <div className="stack">
        <ErrorBox message={actionError} onClose={() => setActionError(null)} />
        <ErrorBox message={list.error} />

        {issued ? (
          <div className="card">
            <div className="card-title">Новый токен — скопируйте сейчас</div>
            <div className="token-reveal">{issued}</div>
            <div className="inline" style={{ marginTop: 10 }}>
              <button
                className="small"
                onClick={() => {
                  void navigator.clipboard.writeText(issued);
                }}
              >
                Скопировать
              </button>
              <button className="small ghost" onClick={() => setIssued(null)}>
                Скрыть
              </button>
              <span className="stat-sub">
                В базе хранится только хэш — показать значение повторно невозможно.
              </span>
            </div>
          </div>
        ) : null}

        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Метка</th>
                    <th>Роль</th>
                    <th>Команда</th>
                    <th className="num">Использований</th>
                    <th>Статус</th>
                    <th>Активировал</th>
                    <th>Действует до</th>
                    <th>Создан</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.items ?? []).map((t) => {
                    const badge = STATUS_BADGE[t.status] ?? STATUS_BADGE.ACTIVE!;
                    return (
                      <tr key={t.id}>
                        <td>{t.label ?? <span className="muted">без метки</span>}</td>
                        <td>
                          <RoleBadge role={t.role} />
                        </td>
                        <td className="nowrap">{t.team?.name ?? <span className="muted">—</span>}</td>
                        <td className="num">
                          {t.uses} / {t.maxUses}
                        </td>
                        <td>
                          <span className={badge.cls}>{badge.label}</span>
                        </td>
                        <td className="nowrap">
                          {t.usedBy ? (
                            <span className="mono">{t.usedBy.binanceUid}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="nowrap muted">{t.expiresAt ? fmtDate(t.expiresAt) : 'бессрочно'}</td>
                        <td className="nowrap muted">{fmtDate(t.createdAt)}</td>
                        <td>
                          {t.status === 'ACTIVE' ? (
                            <button className="small danger" onClick={() => void revoke(t.id)}>
                              Отозвать
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {list.data && list.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                        Токенов ещё не выдавали
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

      {createOpen ? (
        <CreateTokenModal
          teams={teams.data?.items ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={(token) => {
            setIssued(token);
            setCreateOpen(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function CreateTokenModal({
  teams,
  onClose,
  onCreated,
}: {
  teams: TeamRow[];
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [role, setRole] = useState('USER');
  const [teamId, setTeamId] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ token: string }>('/admin/tokens', {
        method: 'POST',
        body: {
          label: label.trim() || undefined,
          role,
          teamId: teamId || null,
          maxUses,
          expiresInDays,
        },
      });
      onCreated(result.token);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Выдать токен доступа" onClose={onClose}>
      <div className="stack">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <div className="field">
          <label>Метка (для себя)</label>
          <input value={label} placeholder="напр. «команда Альфа, набор»" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label>Роль, которую получит пользователь</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
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
        <div className="row">
          <div className="field">
            <label>Использований</label>
            <input type="number" min={1} max={500} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Срок, дней</label>
            <input
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="inline">
          <button className="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Создаём…' : 'Создать'}
          </button>
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}
