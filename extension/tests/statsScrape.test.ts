/**
 * Чтение статистики контрагента из вёрстки Binance.
 *
 * Разметка здесь повторяет живую страницу профиля: подпись и значение лежат в
 * РАЗНЫХ ветках карточки, а число и его единица — отдельными узлами
 * (span «376» + span «Раз(-а)»). Рядом с подписью висит подсказка, в которой
 * тоже есть цифры — попасть в неё нельзя.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

let scrape: typeof import('../src/content/statsScrape.js').scrapeCounterpartyStats;

// узкая заглушка DOM: нужен обход детей и текст, больше ничего
class El {
  tag: string;
  children: El[] = [];
  parentElement: El | null = null;
  private own = '';

  constructor(tag: string, text = '') {
    this.tag = tag;
    this.own = text;
  }

  add(...kids: El[]): El {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }

  get textContent(): string {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this.own;
  }

  flatten(): El[] {
    return [this, ...this.children.flatMap((c) => c.flatten())];
  }
}

const el = (tag: string, text = '') => new El(tag, text);

/** Карточка статистики: подпись с подсказкой слева, число с единицей справа. */
function card(label: string, value: string, unit: string, hint = ''): El {
  return el('div').add(
    el('div').add(el('div').add(el('div', label), el('div', hint))),
    el('div').add(el('div').add(el('span', value), el('span', unit))),
  );
}

function profilePage(): El {
  const root = el('div');
  root.add(card('Все сделки', '376', 'Раз(-а)', 'Покупка: 63 / Продажа: 313'));
  root.add(card('Ордера за 30д', '87', 'Раз(-а)', 'Ордеров за последние 30 дней'));
  root.add(card('Выполненных заказов за 30д (%)', '98.90', '%', 'сделки/ордера за 30 дн. * 100%'));
  root.add(card('Средн. время перевода', '6.94', 'Минут(-ы)', 'за последние 30 дней'));
  root.add(card('Средн. время оплаты', '2.15', 'Минут(-ы)', 'за последние 30 дней'));
  root.add(el('div').add(el('div', 'Почта'), el('div', 'SMS'), el('div', 'Подтверждение личности')));
  return root;
}

const PAGE_TEXT =
  'Aqniyet Yerkebulankyzy Был(а) 49 мин. назад Присоединился 2024-10-26 ' +
  'Почта SMS Подтверждение личности Активные объявления Обратная связь (21)';

function installDom(root: El, bodyText: string, url: string) {
  const all = root.flatten();
  (globalThis as any).location = {
    pathname: url.split('?')[0],
    search: url.includes('?') ? `?${url.split('?')[1]}` : '',
    href: `https://c2c.binance.com${url}`,
  };
  (globalThis as any).document = {
    querySelectorAll: (sel: string) => {
      const tags = sel.split(',').map((s) => s.trim());
      return all.filter((e) => tags.includes(e.tag));
    },
    body: { innerText: bodyText },
  };
}

const PROFILE_URL = '/ru/advertiserDetail?advertiserNo=s614c56fbce66306eacb3f22406cf3ba7';
const ORDER_URL = '/ru/fiatOrderDetail?orderNo=22923118198088511488';

before(async () => {
  installDom(profilePage(), PAGE_TEXT, PROFILE_URL);
  ({ scrapeCounterpartyStats: scrape } = await import('../src/content/statsScrape.js'));
});

after(() => {
  delete (globalThis as any).document;
  delete (globalThis as any).location;
});

describe('статистика профиля', () => {
  it('берёт числа из карточек, а не из подсказок рядом', () => {
    installDom(profilePage(), PAGE_TEXT, PROFILE_URL);
    const s = scrape()!;

    assert.equal(s.totalOrders, 376);
    // в подсказке «за последние 30 дней» тоже есть 30 — она не должна победить
    assert.equal(s.orders30d, 87);
  });

  it('приводит проценты к доле', () => {
    installDom(profilePage(), PAGE_TEXT, PROFILE_URL);
    assert.equal(scrape()!.completionRate30d, 0.989);
  });

  it('округляет время до минут', () => {
    installDom(profilePage(), PAGE_TEXT, PROFILE_URL);
    const s = scrape()!;

    assert.equal(s.avgReleaseMinutes, 7);
    assert.equal(s.avgPayMinutes, 2);
  });

  it('читает дату регистрации и число отзывов', () => {
    installDom(profilePage(), PAGE_TEXT, PROFILE_URL);
    const s = scrape()!;

    assert.equal(s.joinedAt, '2024-10-26T00:00:00.000Z');
    assert.equal(s.feedbackCount, 21);
  });

  it('отмечает пройденные проверки аккаунта', () => {
    installDom(profilePage(), PAGE_TEXT, PROFILE_URL);
    const s = scrape()!;

    assert.equal(s.emailVerified, true);
    assert.equal(s.phoneVerified, true);
    assert.equal(s.kycVerified, true);
  });

  it('в ордере проверки не выдумывает: там их не показывают', () => {
    installDom(profilePage(), PAGE_TEXT, ORDER_URL);
    const s = scrape()!;

    assert.equal(s.kycVerified, undefined);
    // а цифры в ордере читаются так же
    assert.equal(s.totalOrders, 376);
  });

  it('молчит на странице без этих подписей', () => {
    const empty = el('div').add(el('div', 'Переведите оплату в течение'), el('div', '20:25'));
    installDom(empty, 'Переведите оплату', ORDER_URL);

    assert.equal(scrape(), null);
  });

  it('секунды приводит к минутам, а не берёт как есть', () => {
    const page = el('div').add(card('Средн. время перевода', '45', 'сек'));
    installDom(page, '', ORDER_URL);

    assert.equal(scrape()!.avgReleaseMinutes, 1);
  });
});
