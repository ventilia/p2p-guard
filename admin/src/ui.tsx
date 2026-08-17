// переиспользуемые куски интерфейса и форматтеры
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api';

// ───────────────────────────── Форматирование ─────────────────────────────

export const fmtInt = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : value.toLocaleString('ru-RU');

// объёмы крупные, точность тут не нужна
export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс`;
  return Math.round(value).toLocaleString('ru-RU');
}

export const fmtDate = (iso: string | null | undefined): string =>
  !iso
    ? '—'
    : new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

export const fmtDateOnly = (iso: string | null | undefined): string =>
  !iso ? '—' : new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const errText = (err: unknown): string =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Неизвестная ошибка';

// ───────────────────────────── Загрузка данных ─────────────────────────────

export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

// гонки гасим флагом: ответ устаревшего запроса не должен перетереть свежий
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err: unknown) => {
        if (alive) setError(errText(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload };
}

// ───────────────────────────── Компоненты ─────────────────────────────

export function ErrorBox({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div className="error" onClick={onClose}>
      {message}
    </div>
  );
}

export function Loading({ what = 'Загружаем…' }: { what?: string }) {
  return (
    <div className="center">
      <div className="spinner" />
      <div className="muted">{what}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'bad' | 'accent';
}) {
  const color =
    tone === 'good' ? 'var(--good-text)' : tone === 'bad' ? 'var(--bad-text)' : tone === 'accent' ? 'var(--accent)' : undefined;
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Esc закрывает, привычка любого админ-интерфейса
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function Pager({
  total,
  limit,
  offset,
  onOffset,
}: {
  total: number;
  limit: number;
  offset: number;
  onOffset: (next: number) => void;
}) {
  if (total <= limit) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div className="pager">
      <button className="small" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
        ← Назад
      </button>
      <span className="muted">
        {from}–{to} из {total}
      </span>
      <button className="small" disabled={to >= total} onClick={() => onOffset(offset + limit)}>
        Вперёд →
      </button>
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const cls = role === 'ADMIN' ? 'badge accent' : role === 'TEAM_LEAD' ? 'badge warn' : 'badge';
  const label = role === 'ADMIN' ? 'админ' : role === 'TEAM_LEAD' ? 'тимлид' : 'юзер';
  return <span className={cls}>{label}</span>;
}

export function StatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  return status === 'BLOCKED' ? (
    <span className="badge bad" title={reason ?? undefined}>
      заблокирован
    </span>
  ) : (
    <span className="badge ok">активен</span>
  );
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидает',
  PAID: 'Оплачен',
  COMPLETED: 'Успешно',
  CANCELLED: 'Отменён',
  APPEALING: 'Апелляция',
  UNKNOWN: '—',
};

export function OrderStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'COMPLETED' ? 'badge ok' : status === 'CANCELLED' ? 'badge bad' : status === 'APPEALING' ? 'badge warn' : 'badge';
  return <span className={cls}>{ORDER_STATUS_LABEL[status] ?? status}</span>;
}
