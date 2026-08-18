/**
 * Чтение статистики контрагента из вёрстки страницы ордера.
 *
 * Это основной источник половины карточки: приватный C2C API отбивает прямые
 * запросы, а из перехваченного ответа узнаются не все поля. Разметка взята с
 * живой страницы — блок «Обзор торговли» рядом с чатом.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

let scrapeCounterpartyStats: typeof import('../src/content/statsScrape.js').scrapeCounterpartyStats;

// узкая заглушка DOM: нужен обход элементов и их текст, больше ничего
class El {
  tag: string;
  children: El[] = [];
  parentElement: El | null = null;
  private own = '';

  constructor(tag: string, text = '') {
    this.tag = tag;
    this.own = text;
  }

  add(child: El): El {
    child.parentElement = this;
    this.children.push(child);
    return this;
  }

  get textContent(): string {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this.own;
  }

  get nextElementSibling(): El | null {
    const kids = this.parentElement?.children ?? [];
    return kids[kids.indexOf(this) + 1] ?? null;
  }

  get previousElementSibling(): El | null {
    const kids = this.parentElement?.children ?? [];
    return kids[kids.indexOf(this) - 1] ?? null;
  }

  flatten(): El[] {
    return [this, ...this.children.flatMap((c) => c.flatten())];
  }
}

const pair = (label: string, value: string) =>
  new El('div').add(new El('span', label)).add(new El('b', value));

// как на живой странице: подпись слева, значение справа
function buildPage(): El {
  const root = new El('div');
  root.add(new El('h4', 'Обзор торговли'));
  root.add(pair('Все сделки', '885 Раз(а)'));
  root.add(pair('Ордера за 30д', '480 раз(а)'));
  root.add(pair('Выполненных заказов за 30д (%)', '99.26%'));
  root.add(pair('Средн. время перевода', '4.64 Минут(-ы)'));
  root.add(pair('Средн. время оплаты', '2.79 Минут(-ы)'));
  root.add(new El('div', 'Обратная связь (81)'));
  root.add(new El('div', 'Присоединился 2022-10-20'));
  return root;
}

function installDom(root: El, bodyText: string) {
  const all = root.flatten();
  (globalThis as any).document = {
    querySelectorAll: (sel: string) => {
      const tags = sel.split(',').map((s) => s.trim());
      return all.filter((e) => tags.includes(e.tag));
    },
    body: { innerText: bodyText },
  };
}

before(async () => {
  installDom(buildPage(), 'Присоединился 2022-10-20 · Был(а) 22 мин. назад');
  ({ scrapeCounterpartyStats } = await import('../src/content/statsScrape.js'));
});

after(() => {
  delete (globalThis as any).document;
});

describe('статистика со страницы ордера', () => {
  it('читает числа рядом с подписями', () => {
    const s = scrapeCounterpartyStats()!;

    assert.equal(s.totalOrders, 885);
    assert.equal(s.orders30d, 480);
  });

  it('приводит проценты к доле', () => {
    assert.equal(scrapeCounterpartyStats()!.completionRate30d, 0.9926);
  });

  it('округляет время до минут', () => {
    const s = scrapeCounterpartyStats()!;

    assert.equal(s.avgReleaseMinutes, 5);
    assert.equal(s.avgPayMinutes, 3);
  });

  it('берёт число из самой подписи, если оно там', () => {
    assert.equal(scrapeCounterpartyStats()!.feedbackCount, 81);
  });

  it('разбирает дату регистрации', () => {
    assert.equal(scrapeCounterpartyStats()!.joinedAt, '2022-10-20T00:00:00.000Z');
  });

  it('молчит на странице без этих подписей', () => {
    const empty = new El('div');
    empty.add(new El('span', 'Переведите оплату в течение'));
    empty.add(new El('b', '20:25'));
    installDom(empty, 'Переведите оплату');

    assert.equal(scrapeCounterpartyStats(), null);
  });

  it('не принимает время за проценты и наоборот', () => {
    const page = new El('div');
    page.add(pair('Средн. время перевода', '45 сек'));
    installDom(page, '');

    // секунды приводятся к минутам, а не берутся как есть
    assert.equal(scrapeCounterpartyStats()!.avgReleaseMinutes, 1);
  });
});
