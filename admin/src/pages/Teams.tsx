import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import type { TeamRow } from '../types';
import { ErrorBox, Loading, Modal, errText, fmtDate, fmtInt, fmtMoney, useAsync } from '../ui';

export function Teams() {
  const list = useAsync(() => api<{ items: TeamRow[] }>('/admin/teams'), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = async (team: TeamRow) => {
    if (team.members > 0) {
      setActionError('Сначала уберите всех участников из команды');
      return;
    }
    if (!window.confirm(`Удалить команду «${team.name}»?`)) return;
    setActionError(null);
    try {
      await api(`/admin/teams/${team.id}`, { method: 'DELETE' });
      list.reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Команды</h1>
        <div className="spacer" />
        <button className="primary small" onClick={() => setCreateOpen(true)}>
          Создать команду
        </button>
      </div>

      <div className="stack">
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
                    <th>Название</th>
                    <th>Slug</th>
                    <th>Тимлид</th>
                    <th className="num">Участников</th>
                    <th className="num">Сделок</th>
                    <th className="num">Оборот</th>
                    <th className="num">Заметок</th>
                    <th>Создана</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.items ?? []).map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.name}</td>
                      <td className="mono muted">{t.slug}</td>
                      <td className="nowrap">
                        {t.owner ? (
                          <>
                            <span className="mono">{t.owner.binanceUid}</span>
                            <div className="muted" style={{ fontSize: 11.5 }}>
                              {t.owner.nickname ?? 'без ника'}
                            </div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        {t.members > 0 ? (
                          <a href={`#/users`} onClick={() => navigate('#/users')}>
                            {fmtInt(t.members)}
                          </a>
                        ) : (
                          fmtInt(t.members)
                        )}
                      </td>
                      <td className="num">{fmtInt(t.orders)}</td>
                      <td className="num">{fmtMoney(t.volumeFiat)}</td>
                      <td className="num">{fmtInt(t.notes)}</td>
                      <td className="nowrap muted">{fmtDate(t.createdAt)}</td>
                      <td className="nowrap">
                        <button className="small" onClick={() => setEditing(t)}>
                          Изменить
                        </button>{' '}
                        <button className="small danger" onClick={() => void remove(t)}>
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                  {list.data && list.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                        Команд ещё нет
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {createOpen ? (
        <TeamModal
          title="Создать команду"
          onClose={() => setCreateOpen(false)}
          onSubmit={async (body) => {
            await api('/admin/teams', { method: 'POST', body });
            setCreateOpen(false);
            list.reload();
          }}
        />
      ) : null}

      {editing ? (
        <TeamModal
          title={`Команда «${editing.name}»`}
          initialName={editing.name}
          hideSlug
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            await api(`/admin/teams/${editing.id}`, {
              method: 'PATCH',
              body: { name: body.name, ownerUid: body.ownerUid },
            });
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

type TeamBody = { name: string; slug?: string; ownerUid?: string };

function TeamModal({
  title,
  initialName = '',
  hideSlug = false,
  onClose,
  onSubmit,
}: {
  title: string;
  initialName?: string;
  hideSlug?: boolean;
  onClose: () => void;
  onSubmit: (body: TeamBody) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState('');
  const [ownerUid, setOwnerUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        slug: slug.trim() || undefined,
        ownerUid: ownerUid.trim() || undefined,
      });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <div className="field">
          <label>Название</label>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        {!hideSlug ? (
          <div className="field">
            <label>Slug (пусто — сгенерируется из названия)</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
        ) : null}
        <div className="field">
          <label>UID тимлида (получит роль TEAM_LEAD и войдёт в команду)</label>
          <input value={ownerUid} placeholder="напр. 123456789" onChange={(e) => setOwnerUid(e.target.value)} />
        </div>
        <div className="inline">
          <button className="primary" disabled={busy || name.trim().length < 2} onClick={() => void submit()}>
            Сохранить
          </button>
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
        <div className="stat-sub">
          Если UID не указать при создании, владельцем останется текущий администратор.
        </div>
      </div>
    </Modal>
  );
}
