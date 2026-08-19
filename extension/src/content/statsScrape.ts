// статистика контрагента из вёрстки Binance
//
// приватный C2C API отбивает прямые запросы антифродом, а имена полей в
// перехваченных ответах не документированы. Зато биржа сама рисует все цифры:
// часть — рядом с чатом в ордере, остальное — на странице профиля.
//
// Опираемся на подписи и на форму значения, а не на классы: подписи биржа
// меняет реже, а классы у неё генерируемые (css-vurnku, bn-flex и подобные).

import type { ExchangeReview, ExchangeStats } from '../shared/types.js';

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

/**
 * Значение, относящееся к подписи.
 *
 * Подпись и число лежат в разных ветках карточки, поэтому поднимаемся вверх и
 * ищем лист, ВЕСЬ текст которого — число. Так мимо проходят подсказки вроде
 * «за последние 30 дней»: цифры там есть, но узел не числовой.
 */
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

/**
 * Читает всё, что биржа нарисовала на текущей странице.
 * Возвращает только распознанное: пустые поля не затирают данные из других
 * источников.
 */
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

// ───────────────────────────── Отзывы биржи ─────────────────────────────

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

/**
 * Отзывы из открытой вкладки «Обратная связь».
 *
 * Разметку списка разведка не показала, поэтому ищем по форме: блок, где рядом
 * стоят оценка и дата. Что не распозналось — просто не попадёт в список.
 */
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
