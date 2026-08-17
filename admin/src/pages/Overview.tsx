import { api } from '../api';
import type { Overview as OverviewData } from '../types';
import { ErrorBox, Loading, Stat, fmtInt, fmtMoney, useAsync } from '../ui';

const ORDER_ROWS: { key: string; label: string; tone?: 'good' | 'bad' | 'warn' }[] = [
  { key: 'COMPLETED', label: 'Успешно', tone: 'good' },
  { key: 'CANCELLED', label: 'Отменено', tone: 'bad' },
  { key: 'APPEALING', label: 'Апелляции', tone: 'warn' },
  { key: 'PENDING', label: 'Ожидают' },
  { key: 'PAID', label: 'Оплачены' },
  { key: 'UNKNOWN', label: 'Без статуса' },
];

export function Overview() {
  const { data, loading, error, reload } = useAsync(() => api<OverviewData>('/admin/overview'), []);

  if (loading && !data) return <Loading what="Считаем сводку…" />;

  const orders = data?.orders ?? {};
  const totalOrders = Object.values(orders).reduce((sum, n) => sum + (n ?? 0), 0);
  const completed = orders.COMPLETED ?? 0;
  const cancelled = orders.CANCELLED ?? 0;
  const successRate = completed + cancelled > 0 ? Math.round((completed / (completed + cancelled)) * 100) : null;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Сводка</h1>
        <div className="spacer" />
        <button className="small" onClick={reload}>
          Обновить
        </button>
      </div>

      <ErrorBox message={error} />

      {data ? (
        <div className="stack">
          <div className="grid cols-4">
            <Stat
              label="Пользователи"
              value={fmtInt(data.users)}
              sub={`активны за 30 дней: ${fmtInt(data.activeUsers30d)}`}
            />
            <Stat
              label="Заблокированы"
              value={fmtInt(data.blocked)}
              tone={data.blocked > 0 ? 'bad' : undefined}
              sub={`команд: ${fmtInt(data.teams)}`}
            />
            <Stat label="Оборот" value={fmtMoney(data.volumeFiat)} sub="по завершённым сделкам" tone="accent" />
            <Stat
              label="Сделки"
              value={fmtInt(totalOrders)}
              sub={successRate === null ? 'ещё нет данных' : `успешных ${successRate}%`}
            />
          </div>

          <div className="grid cols-3">
            <Stat label="Контрагенты в базе" value={fmtInt(data.counterparties)} />
            <Stat label="Отзывы" value={fmtInt(data.reviews)} />
            <Stat
              label="Записи в чёрном списке"
              value={fmtInt(data.blacklist)}
              tone={data.blacklist > 0 ? 'bad' : undefined}
              sub="действующие"
            />
          </div>

          <div className="card">
            <div className="card-title">Сделки по статусам</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Статус</th>
                    <th className="num">Количество</th>
                    <th className="num">Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDER_ROWS.map((row) => {
                    const count = orders[row.key as keyof typeof orders] ?? 0;
                    const share = totalOrders ? Math.round((count / totalOrders) * 100) : 0;
                    return (
                      <tr key={row.key}>
                        <td>
                          <span className={row.tone ? `badge ${row.tone === 'warn' ? 'warn' : row.tone}` : 'badge'}>
                            {row.label}
                          </span>
                        </td>
                        <td className="num">{fmtInt(count)}</td>
                        <td className="num muted">{totalOrders ? `${share}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalOrders === 0 ? (
              <div className="stat-sub" style={{ marginTop: 10 }}>
                Сделок пока нет. Они появятся, когда расширение синхронизирует ордера пользователей.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
