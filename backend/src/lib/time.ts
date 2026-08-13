/**
 * Разбор длительностей вида «15m», «2h», «30d», «45s» в секунды.
 * Нужен, чтобы TTL access-токена задавался в одном месте (.env) и клиент
 * получал ровно то же значение, с которым подписан JWT.
 */
const UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

export function parseDurationSeconds(value: string, fallbackSeconds = 900): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(value.trim());
  if (!match) {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) && asNumber > 0 ? Math.floor(asNumber) : fallbackSeconds;
  }

  const amount = Number(match[1]);
  const unit = UNITS[(match[2] ?? 's').toLowerCase()] ?? 1;
  return amount * unit;
}
