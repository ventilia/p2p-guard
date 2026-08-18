// статистика контрагента прямо из вёрстки страницы ордера
//
// это не запасной путь, а основной источник для половины карточки. Приватный
// C2C API отбивает прямые запросы антифродом, а из перехваченного ответа
// узнаются не все поля: имена там не документированы и меняются. Зато те же
// цифры биржа сама рисует в блоке «Обзор торговли» рядом с чатом — их и берём.
//
// Опираемся на подписи, а не на классы: подписи биржа меняет реже вёрстки.

import type { ExchangeStats } from '../shared/types.js';

// «4.64 Минут(-ы)», «99.26%», «885 Раз(а)», «1 234,56 ₸»
//
// вычищать лишние символы нельзя: дефис из «Минут(-ы)» оставался в строке и
// делал число нечитаемым. Берём первое числовое вхождение целиком.
function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;

  const token = /-?\d[\d  .,]*/.exec(raw.replace(/ /g, ' '))?.[0]?.trim();
  if (!token) return undefined;

  const digits = token.replace(/[\s]/g, '');
  // запятая бывает и разделителем групп, и дробной частью
  const normalized = digits.includes(',') && digits.includes('.')
    ? digits.replace(/,/g, '')
    : digits.replace(',', '.');

  const value = Number(normalized.replace(/[.,]$/, ''));
  return Number.isFinite(value) ? value : undefined;
}

type Rule = {
  key: keyof ExchangeStats;
  // подпись рядом со значением
  label: RegExp;
  parse: (raw: string) => number | string | undefined;
};

const percent = (raw: string) => {
  const n = toNumber(raw);
  return n === undefined ? undefined : n > 1 ? n / 100 : n;
};

const minutes = (raw: string) => {
  const n = toNumber(raw);
  if (n === undefined) return undefined;
  // биржа подписывает единицу рядом: «4.64 Минут», «45 сек»
  return /сек|second/i.test(raw) ? Math.round(n / 60) : Math.round(n);
};

const RULES: Rule[] = [
  { key: 'totalOrders', label: /^(все сделки|всего сделок|all trades|total orders)/i, parse: toNumber },
  { key: 'orders30d', label: /^(ордера за 30|сделок за 30|orders in 30|30d orders)/i, parse: toNumber },
  {
    key: 'completionRate30d',
    label: /^(выполненных заказов за 30|完成率|completion rate|completed orders in 30)/i,
    parse: percent,
  },
  { key: 'avgReleaseMinutes', label: /^(средн.* время перевода|avg.* release)/i, parse: minutes },
  { key: 'avgPayMinutes', label: /^(средн.* время оплаты|avg.* pay)/i, parse: minutes },
  { key: 'feedbackCount', label: /^(обратная связь|отзыв|feedback)/i, parse: toNumber },
  { key: 'followers', label: /^(подписчик|followers)/i, parse: toNumber },
];

const JOINED = /(?:присоединил|зарегистрирован|joined)\D{0,20}(\d{4}-\d{2}-\d{2})/i;

// значение обычно лежит соседним узлом, реже — внутри той же строки
function valueNear(el: Element): string {
  const own = (el.textContent ?? '').trim();

  const sibling = el.nextElementSibling?.textContent?.trim();
  if (sibling && /\d/.test(sibling)) return sibling;

  const parentText = (el.parentElement?.textContent ?? '').trim();
  const tail = parentText.slice(own.length).trim();
  if (/\d/.test(tail)) return tail;

  // подпись и значение бывают детьми одного блока в обратном порядке
  const prev = el.previousElementSibling?.textContent?.trim();
  return prev && /\d/.test(prev) ? prev : '';
}

/**
 * Ищет подписи по всей странице и берёт число рядом с каждой.
 * Возвращает только то, что удалось прочитать: пустые поля не затирают
 * данные, полученные другим путём.
 */
export function scrapeCounterpartyStats(): ExchangeStats | null {
  const stats: ExchangeStats = {};

  // подписи короткие, поэтому смотрим только на листовые узлы
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('div, span, p, td, dt, label'));

  for (const node of nodes) {
    if (node.children.length > 2) continue;
    const text = (node.textContent ?? '').trim();
    if (!text || text.length > 60) continue;

    for (const rule of RULES) {
      if (stats[rule.key] !== undefined && stats[rule.key] !== null) continue;
      if (!rule.label.test(text)) continue;

      // подпись отрезаем всегда: в ней самой бывают цифры («за 30д»), и без
      // этого «за 30д» + «480» слипались в 30480
      const rest = text.replace(rule.label, '').trim();
      const source = /\d/.test(rest) ? rest : valueNear(node);
      if (!source) continue;

      const value = rule.parse(source);
      if (value !== undefined) (stats as Record<string, unknown>)[rule.key] = value;
    }
  }

  const joined = JOINED.exec(document.body?.innerText?.slice(0, 40_000) ?? '');
  if (joined?.[1]) stats.joinedAt = new Date(`${joined[1]}T00:00:00.000Z`).toISOString();

  return Object.keys(stats).length ? stats : null;
}
