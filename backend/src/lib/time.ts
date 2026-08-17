// «15m», «2h», «30d» в секунды: TTL задан в .env, клиент должен получить то же
// значение, с которым подписан JWT
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
