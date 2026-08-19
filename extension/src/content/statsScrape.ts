// статистика контрагента из вёрстки: приватный API отбивает прямые запросы,
// зато биржа рисует все цифры сама
// опираемся на подписи и форму значения, а не на классы — они генерируемые

import type { ExchangeAd, ExchangeReview, ExchangeStats, OrderSide } from '../shared/types.js';

// «6.94», «98.90», «1 234,56» — значение всегда лежит отдельным узлом
const PURE_NUMBER = /^[\d\u00a0 .,]+$/;

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;

  const token = /-?\d[\d\u00a0 .,]*/.exec(raw.replace(/\u00a0/g, ' '))?.[0]?.trim();
  if (!token) return undefined;

  const digits = token.replace(/\s/g, '');
  // запятая бывает и разделителем групп, и дробной частью
  const normalized =
    digits.includes(',') && digits.includes('.')
      ? digits.replace(/,/g, '')
      : digits.replace(',', '.');

  const value = Number(normalized.replace(/[.,]$/, ''));
  return Number.isFinite(value) ? value : undefined;
}

// листовые узлы в порядке обхода: значение и его единица стоят рядом
function leaves(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (node: Element) => {
    if (!node.children.length) {
      out.push(node);
      return;
    }
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(root);
  return out;
}

// значение, относящееся к подписи
function valueFor(label: Element): { value: string; unit: string } | null {
  let node: Element | null = label.parentElement;

  for (let depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
    const list = leaves(node);
    const index = list.findIndex((el) => {
      const text = (el.textContent ?? '').trim();
      return text.length > 0 && text.length < 20 && PURE_NUMBER.test(text) && /\d/.test(text);
    });
    if (index < 0) continue;

    const value = (list[index]!.textContent ?? '').trim();
    const next = (list[index + 1]?.textContent ?? '').trim();
    return { value, unit: next.length <= 16 ? next : '' };
  }

  return null;
}

type Rule = {
  key: keyof ExchangeStats;
  label: RegExp;
  parse: (value: string, unit: string) => number | undefined;
};

const asNumber = (value: string) => toNumber(value);

const asShare = (value: string) => {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  // 98.90 / 100 даёт 0.9890000000000001 — в базу такое пускать незачем
  return Math.round((n > 1 ? n / 100 : n) * 10_000) / 10_000;
};

// единица подписана рядом со значением: «Минут(-ы)», «сек»
const asMinutes = (value: string, unit: string) => {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  return /сек|second/i.test(unit) ? Math.max(1, Math.round(n / 60)) : Math.round(n);
};

const RULES: Rule[] = [
  { key: 'totalOrders', label: /^все сделки$|^all trades$/i, parse: asNumber },
  { key: 'orders30d', label: /^ордера за 30|^orders in 30/i, parse: asNumber },
  { key: 'completionRate30d', label: /^выполненных заказов за 30|^completion rate/i, parse: asShare },
  { key: 'avgReleaseMinutes', label: /^средн.* время перевода|^avg.* release/i, parse: asMinutes },
  { key: 'avgPayMinutes', label: /^средн.* время оплаты|^avg.* pay/i, parse: asMinutes },
];

// то, что стоит отдельной строкой, а не парой «подпись — значение»
const JOINED = /(?:присоединил|joined)\D{0,20}(\d{4}-\d{2}-\d{2})/i;
const FEEDBACK_TAB = /(?:обратная связь|feedback)\s*\((\d+)\)/i;

// проверки аккаунта перечислены только в профиле
// отсутствие подписи означает «не знаем», а не «не пройдена»
const VERIFICATIONS: [keyof ExchangeStats, RegExp][] = [
  ['emailVerified', /^почта$|^e-?mail$/i],
  ['phoneVerified', /^sms$|^телефон$/i],
  ['kycVerified', /^подтверждение личности$|^identity/i],
];

export function onProfilePage(): boolean {
  return /advertiserDetail|userCenter\/profile/i.test(location.pathname + location.search);
}

export function profileUserNo(): string | null {
  return /(?:advertiserNo|userNo)=([A-Za-z0-9]{8,64})/.exec(location.href)?.[1] ?? null;
}

// читает всё, что биржа нарисовала на текущей странице
export function scrapeCounterpartyStats(): ExchangeStats | null {
  const stats: ExchangeStats = {};
  const profile = onProfilePage();

  const nodes = Array.from(document.querySelectorAll<HTMLElement>('div, span, p, td, dt, label'));

  for (const node of nodes) {
    if (node.children.length) continue;

    const text = (node.textContent ?? '').trim();
    if (!text || text.length > 60) continue;

    for (const rule of RULES) {
      if (stats[rule.key] !== undefined && stats[rule.key] !== null) continue;
      if (!rule.label.test(text)) continue;

      const found = valueFor(node);
      if (!found) continue;

      const parsed = rule.parse(found.value, found.unit);
      if (parsed !== undefined) (stats as Record<string, unknown>)[rule.key] = parsed;
    }

    if (profile) {
      for (const [key, marker] of VERIFICATIONS) {
        if (stats[key] === undefined && marker.test(text)) {
          (stats as Record<string, unknown>)[key] = true;
        }
      }
    }
  }

  // именно textContent, а не innerText: innerText требует раскладки, а её
  // Chrome в фоновой вкладке не делает — дата регистрации и число отзывов
  // из профиля тогда не читались вовсе
  const pageText = (document.body?.textContent ?? '').slice(0, 60_000);

  const joined = JOINED.exec(pageText);
  if (joined?.[1]) stats.joinedAt = new Date(`${joined[1]}T00:00:00.000Z`).toISOString();

  const feedback = FEEDBACK_TAB.exec(pageText);
  if (feedback?.[1]) stats.feedbackCount = Number(feedback[1]);

  return Object.keys(stats).length ? stats : null;
}

// вкладка отзывов закрыта: пока по ней не кликнешь, списка в DOM нет
export function openReviewsTab(): boolean {
  const tab =
    document.querySelector<HTMLElement>('#bn-tab-reviews') ??
    Array.from(document.querySelectorAll<HTMLElement>('[id^="bn-tab-"]')).find((el) =>
      FEEDBACK_TAB.test(el.textContent ?? ''),
    );

  if (!tab || tab.className.includes('active')) return false;
  tab.click();
  return true;
}

const POSITIVE = /положительн|нравится|good|positive/i;
const NEGATIVE = /отрицательн|не нравится|bad|negative/i;
const REVIEW_DATE = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/;

// отзывы из открытой вкладки «Обратная связь»
export function scrapeExchangeReviews(): ExchangeReview[] {
  const out: ExchangeReview[] = [];
  const seen = new Set<string>();

  for (const node of Array.from(document.querySelectorAll<HTMLElement>('div, li'))) {
    if (node.children.length === 0 || node.children.length > 8) continue;

    const text = (node.textContent ?? '').trim();
    if (text.length < 8 || text.length > 400) continue;

    const positive = POSITIVE.test(text);
    const negative = NEGATIVE.test(text);
    if (!positive && !negative) continue;

    const date = REVIEW_DATE.exec(text);
    if (!date) continue;

    // комментарий — самый длинный лист, не совпадающий с оценкой и датой
    const comment = leaves(node)
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => t.length > 3 && !POSITIVE.test(t) && !NEGATIVE.test(t) && !REVIEW_DATE.test(t))
      .sort((a, b) => b.length - a.length)[0];

    const key = `${date[1]}|${comment ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      rating: negative ? 'NEGATIVE' : 'POSITIVE',
      text: comment ?? null,
      author: null,
      createdAt: new Date(`${date[1]}T${date[2] ?? '00:00'}:00.000Z`).toISOString(),
    });

    if (out.length >= 20) break;
  }

  return out;
}

// заголовки над списками объявлений на странице профиля
const ADS_BUY = /активные объявления на покупку|buy ads/i;
const ADS_SELL = /активные объявления на продажу|sell ads/i;

// тикер актива, а не код валюты: иначе KZT или RUB попадут в колонку «актив»
const ASSETS = /^(USDT|USDC|FDUSD|BTC|ETH|BNB|DAI|TUSD|XRP|SOL)$/;
const METHODS = /bank|kaspi|сбер|тинькоф|каспи|halyk|jusan|freedom|альфа|райф|мир/i;

// «552.00 KZT», «USDT», «Kaspi Bank» — карточка объявления собирается из листьев
function adFrom(node: Element, side: OrderSide): ExchangeAd | null {
  const texts = leaves(node)
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);

  const asset = texts.find((t) => ASSETS.test(t)) ?? null;
  const priceIndex = texts.findIndex((t) => PURE_NUMBER.test(t) && /\d/.test(t));
  const price = priceIndex < 0 ? null : (toNumber(texts[priceIndex]) ?? null);
  const fiat = priceIndex < 0 ? null : (texts[priceIndex + 1]?.match(/^[A-Z]{3}$/)?.[0] ?? null);

  // лимиты идут парой чисел после подписи «Лимит ордера»
  const limitAt = texts.findIndex((t) => /лимит ордера|order limit/i.test(t));
  const limits =
    limitAt < 0
      ? []
      : texts
          .slice(limitAt + 1, limitAt + 8)
          .map(toNumber)
          .filter((n): n is number => n !== undefined);

  const methods = texts.filter((t) => METHODS.test(t)).slice(0, 4);

  // без цены это не карточка объявления, а соседний блок вёрстки
  if (price === null) return null;

  return {
    side,
    asset,
    price,
    fiat,
    minFiat: limits[0] ?? null,
    maxFiat: limits[1] ?? null,
    methods,
  };
}

// объявления контрагента: цена, лимиты и способы оплаты
export function scrapeExchangeAds(): ExchangeAd[] {
  const out: ExchangeAd[] = [];

  for (const heading of Array.from(document.querySelectorAll<HTMLElement>('div, h2, h3, h4'))) {
    if (heading.children.length) continue;

    const text = (heading.textContent ?? '').trim();
    const side: OrderSide | null = ADS_BUY.test(text) ? 'BUY' : ADS_SELL.test(text) ? 'SELL' : null;
    if (!side) continue;

    // список идёт следом за заголовком, внутри общего блока
    const section = heading.parentElement;
    if (!section) continue;

    // обход ограничен: на профиле тысячи узлов, а объявлений единицы
    for (const row of Array.from(section.querySelectorAll<HTMLElement>('div')).slice(0, 400)) {
      if (row.children.length < 2 || row.children.length > 12) continue;

      const ad = adFrom(row, side);
      if (!ad) continue;

      const same = out.some((x) => x.side === ad.side && x.price === ad.price && x.asset === ad.asset);
      if (!same) out.push(ad);
      if (out.length >= 10) return out;
    }
  }

  return out;
}
