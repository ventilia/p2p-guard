/**
 * Риск-скор контрагента.
 *
 * Модель намеренно простая и аддитивная: каждый фактор возвращается наружу
 * вместе с вкладом в баллах. Трейдер должен видеть, ПОЧЕМУ карточка красная,
 * иначе он перестанет доверять оценке и будет её игнорировать.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RiskFactor = {
  code: string;
  label: string;
  /** Вклад в итоговый балл: положительный — хуже, отрицательный — лучше. */
  impact: number;
  detail?: string;
};

export type RiskInput = {
  globalBlacklist: number;
  teamBlacklist: number;
  blacklistedRequisites: number;
  reviews: { positive: number; neutral: number; negative: number };
  /** Ордера всех пользователей нашей базы с этим контрагентом. */
  orders: { total: number; completed: number; cancelled: number };
  /** Ордера только моей команды. */
  teamOrders: { total: number; completed: number };
  /** Публичная статистика с биржи (может отсутствовать). */
  exchange: {
    registeredDays?: number | null;
    /** Доля успешных сделок, 0..1 */
    completionRate?: number | null;
    totalOrders?: number | null;
    avgReleaseMinutes?: number | null;
    avgPayMinutes?: number | null;
    avgAmountFiat?: number | null;
  };
};

export type RiskResult = {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function calculateRisk(input: RiskInput): RiskResult {
  const factors: RiskFactor[] = [];

  if (input.globalBlacklist > 0) {
    factors.push({
      code: 'BLACKLIST_GLOBAL',
      label: 'В общем чёрном списке',
      impact: 70,
      detail: `записей: ${input.globalBlacklist}`,
    });
  }

  if (input.teamBlacklist > 0) {
    factors.push({
      code: 'BLACKLIST_TEAM',
      label: 'В чёрном списке вашей команды',
      impact: 55,
      detail: `записей: ${input.teamBlacklist}`,
    });
  }

  if (input.blacklistedRequisites > 0) {
    factors.push({
      code: 'REQUISITE_BLACKLISTED',
      label: 'Реквизит совпал с реквизитом из ЧС',
      impact: 45,
      detail: `совпадений: ${input.blacklistedRequisites}`,
    });
  }

  const { positive, neutral, negative } = input.reviews;
  const reviewsTotal = positive + neutral + negative;

  if (negative > 0) {
    // Доля негатива важнее абсолютного числа, но одиночный негатив тоже весит.
    const share = negative / Math.max(1, reviewsTotal);
    const impact = clamp(Math.round(share * 25 + Math.min(negative, 5) * 2), 5, 35);
    factors.push({
      code: 'NEGATIVE_REVIEWS',
      label: 'Негативные отзывы',
      impact,
      detail: `${negative} из ${reviewsTotal}`,
    });
  }

  if (positive >= 3 && negative === 0) {
    factors.push({
      code: 'POSITIVE_REVIEWS',
      label: 'Только положительные отзывы',
      impact: -20,
      detail: `${positive} шт.`,
    });
  }

  if (input.orders.total >= 5) {
    const cancelRate = input.orders.cancelled / input.orders.total;
    if (cancelRate > 0.3) {
      factors.push({
        code: 'HIGH_CANCEL_RATE',
        label: 'Много отмен по нашей базе',
        impact: clamp(Math.round(cancelRate * 25), 6, 20),
        detail: `${Math.round(cancelRate * 100)}% отмен из ${input.orders.total}`,
      });
    }
  }

  if (input.teamOrders.completed >= 5) {
    factors.push({
      code: 'TEAM_HISTORY_GOOD',
      label: 'Успешная история с вашей командой',
      impact: -15,
      detail: `${input.teamOrders.completed} успешных сделок`,
    });
  }

  const ex = input.exchange;

  if (typeof ex.registeredDays === 'number' && ex.registeredDays >= 0 && ex.registeredDays < 30) {
    factors.push({
      code: 'YOUNG_ACCOUNT',
      label: 'Молодой аккаунт биржи',
      impact: 15,
      detail: `${ex.registeredDays} дн. с регистрации`,
    });
  }

  if (typeof ex.completionRate === 'number' && ex.completionRate < 0.9) {
    // У живых мерчантов Binance этот показатель 95–100%. Всё, что заметно ниже,
    // означает либо массовые отмены, либо споры — признак сильный, вес высокий.
    factors.push({
      code: 'LOW_COMPLETION_RATE',
      label: 'Низкий процент завершённых сделок на бирже',
      impact: clamp(Math.round((0.97 - ex.completionRate) * 100), 8, 28),
      detail: `${Math.round(ex.completionRate * 100)}%`,
    });
  }

  if (
    typeof ex.totalOrders === 'number' &&
    typeof ex.avgAmountFiat === 'number' &&
    ex.totalOrders < 20 &&
    ex.avgAmountFiat > 50_000
  ) {
    factors.push({
      code: 'LOW_VOLUME_HIGH_TICKET',
      label: 'Мало сделок при большом среднем чеке',
      impact: 12,
      detail: `${ex.totalOrders} сделок, средний чек ${Math.round(ex.avgAmountFiat)}`,
    });
  }

  if (typeof ex.avgReleaseMinutes === 'number' && ex.avgReleaseMinutes > 20) {
    factors.push({
      code: 'SLOW_RELEASE',
      label: 'Долгое среднее время перевода',
      impact: 8,
      detail: `${Math.round(ex.avgReleaseMinutes)} мин`,
    });
  }

  if (factors.length === 0) {
    factors.push({
      code: 'NO_DATA',
      label: 'Нет данных о нарушениях',
      impact: 0,
      detail: 'Контрагент не встречался в наших базах',
    });
  }

  const score = clamp(
    factors.reduce((sum, f) => sum + f.impact, 0),
    0,
    100,
  );

  const level: RiskLevel =
    score >= 70 ? 'CRITICAL' : score >= 40 ? 'HIGH' : score >= 15 ? 'MEDIUM' : 'LOW';

  // Самые весомые факторы — первыми: UI показывает верхние 3-4.
  factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return { score, level, factors };
}
