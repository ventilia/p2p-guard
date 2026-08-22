// форматтеры, общие для панели и попапа

export const fmtNumber = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });

// суммы крупные: 180 000 читается хуже, чем 180 тыс
export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн`;
  }
  if (abs >= 100_000) return `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс`;
  return Math.round(value).toLocaleString('ru-RU');
}

export const fmtPercent = (share: number | null | undefined): string =>
  share === null || share === undefined ? '—' : `${Math.round(share * 100)}%`;

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

// от часа минуты в чистом виде читаются плохо
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидает',
  PAID: 'Оплачен',
  COMPLETED: 'Успешно',
  CANCELLED: 'Отменён',
  APPEALING: 'Апелляция',
  UNKNOWN: '—',
};

// первая буква ника для заглушки аватара
export const initialOf = (nickname: string | null | undefined, fallback: string): string =>
  (nickname?.trim()?.[0] ?? fallback.trim()[0] ?? '?').toUpperCase();
