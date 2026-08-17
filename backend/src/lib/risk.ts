// аддитивная модель: каждый фактор отдаётся наружу со своим вкладом, чтобы
// трейдер видел, из чего сложился балл, и не игнорировал оценку

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RiskFactor = {
  code: string;
  label: string;
  // положительный вклад — хуже, отрицательный — лучше
  impact: number;
  detail?: string;
};

export type ReviewTag = 'SCAM' | 'FREEZE' | 'DIRTY' | 'TERMS' | 'PAINTER' | 'RUDE' | 'COMMENT';

export type RiskInput = {
  globalBlacklist: number;
  teamBlacklist: number;
  blacklistedRequisites: number;
  reviews: { positive: number; neutral: number; negative: number };
  reviewTags?: Partial<Record<ReviewTag, number>>;
  // ордера всех пользователей нашей базы с этим контрагентом
  orders: { total: number; completed: number; cancelled: number };
  teamOrders: { total: number; completed: number };
  // сумма открытого сейчас ордера, сравнивается со средним чеком
  currentOrderFiat?: number | null;
  // публичная статистика биржи, может отсутствовать целиком
  exchange: {
    registeredDays?: number | null;
    firstOrderDays?: number | null;
    // доля успешных сделок, 0..1
    completionRate?: number | null;
    totalOrders?: number | null;
    orders30d?: number | null;
    avgReleaseMinutes?: number | null;
    avgPayMinutes?: number | null;
    avgAmountFiat?: number | null;
    avgAmount30dFiat?: number | null;
    positiveCount?: number | null;
    negativeCount?: number | null;
  };
};

// во сколько баллов обходится один отзыв такой категории
const TAG_WEIGHT: Record<ReviewTag, number> = {
  SCAM: 14,
  DIRTY: 12,
  PAINTER: 12,
  FREEZE: 8,
  TERMS: 5,
  RUDE: 2,
  COMMENT: 0,
};

const TAG_LABEL: Record<ReviewTag, string> = {
  SCAM: 'мошенник',
  DIRTY: 'грязь',
  PAINTER: 'художник',
  FREEZE: 'мороз',
  TERMS: 'невыполнение условий',
  RUDE: 'неадекват',
  COMMENT: 'комментарий',
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
    // доля негатива важнее абсолютного числа, но одиночный негатив тоже весит
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

  // «пропал с деньгами» и «нахамил» нельзя смешивать в одном счётчике негатива
  const tags = input.reviewTags ?? {};
  const heavy = (Object.entries(tags) as [ReviewTag, number][])
    .filter(([tag, count]) => count > 0 && TAG_WEIGHT[tag] >= 8)
    .sort((a, b) => TAG_WEIGHT[b[0]] * b[1] - TAG_WEIGHT[a[0]] * a[1]);

  if (heavy.length) {
    const raw = heavy.reduce((sum, [tag, count]) => sum + TAG_WEIGHT[tag] * Math.min(count, 3), 0);
    factors.push({
      code: 'SEVERE_COMPLAINTS',
      label: 'Тяжёлые жалобы от трейдеров',
      impact: clamp(raw, 8, 40),
      detail: heavy.map(([tag, count]) => `${TAG_LABEL[tag]} × ${count}`).join(', '),
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
    // у живых мерчантов 95–100%, заметно ниже — массовые отмены или споры
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

  // аккаунт мог «отлежаться» после регистрации, поэтому важна первая сделка
  if (typeof ex.firstOrderDays === 'number' && ex.firstOrderDays >= 0 && ex.firstOrderDays < 30) {
    factors.push({
      code: 'FIRST_ORDER_RECENT',
      label: 'Первая сделка меньше месяца назад',
      impact: 12,
      detail: `${ex.firstOrderDays} дн. с 1-го ордера`,
    });
  }

  const exPositive = ex.positiveCount ?? 0;
  const exNegative = ex.negativeCount ?? 0;
  const exTotal = exPositive + exNegative;
  if (exTotal >= 5) {
    const share = exPositive / exTotal;
    if (share < 0.6) {
      factors.push({
        code: 'LOW_POSITIVE_SHARE',
        label: 'Мало положительных отзывов на бирже',
        impact: clamp(Math.round((0.6 - share) * 45) + 8, 8, 22),
        detail: `${Math.round(share * 100)}% позитива из ${exTotal}`,
      });
    }
  }

  // во сколько раз одно больше другого, ноль и мусор расхождением не считаем
  const ratio = (a: number, b: number) => (a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) : 1);

  // резкая смена среднего чека — признак «разгона» аккаунта перед скамом
  if (typeof ex.avgAmountFiat === 'number' && typeof ex.avgAmount30dFiat === 'number') {
    const k = ratio(ex.avgAmountFiat, ex.avgAmount30dFiat);
    if (k > 2) {
      factors.push({
        code: 'TICKET_MISMATCH',
        label: 'Средний чек за 30 дней резко отличается от общего',
        impact: 12,
        detail: `в ${k.toFixed(1)}× (${Math.round(ex.avgAmount30dFiat)} против ${Math.round(ex.avgAmountFiat)})`,
      });
    }
  }

  const avgTicket = ex.avgAmount30dFiat ?? ex.avgAmountFiat;
  if (typeof input.currentOrderFiat === 'number' && typeof avgTicket === 'number') {
    const k = ratio(input.currentOrderFiat, avgTicket);
    if (k > 2) {
      factors.push({
        code: 'ORDER_VS_AVG_TICKET',
        label: 'Сумма этой сделки не похожа на его обычную',
        impact: 14,
        detail: `в ${k.toFixed(1)}× от среднего чека (${Math.round(avgTicket)})`,
      });
    }
  }

  if (
    typeof ex.totalOrders === 'number' &&
    typeof ex.orders30d === 'number' &&
    ex.totalOrders >= 10 &&
    ex.orders30d / ex.totalOrders > 0.5
  ) {
    factors.push({
      code: 'RECENT_ORDER_BURST',
      label: 'Почти все сделки сделаны за последний месяц',
      impact: 10,
      detail: `${ex.orders30d} из ${ex.totalOrders}`,
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

  // весомые первыми: UI показывает только верхние
  factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return { score, level, factors };
}
