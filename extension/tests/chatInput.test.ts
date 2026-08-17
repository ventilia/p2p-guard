// поиск поля чата: эвристика должна выбирать нужное поле среди чужих
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

// jsdom тут нет, поэтому DOM подменяем минимальной заглушкой
type FakeEl = {
  tagName: string;
  className: string;
  id: string;
  parentElement: FakeEl | null;
  attrs: Record<string, string>;
  rect: { top: number; width: number; height: number };
};

function el(
  tagName: string,
  opts: Partial<{ className: string; id: string; placeholder: string; top: number; width: number; height: number }> = {},
): FakeEl {
  return {
    tagName,
    className: opts.className ?? '',
    id: opts.id ?? '',
    parentElement: null,
    attrs: opts.placeholder ? { placeholder: opts.placeholder } : {},
    rect: { top: opts.top ?? 600, width: opts.width ?? 300, height: opts.height ?? 40 },
  };
}

// копия скоринга из content/chatInput.ts: держим синхронно вручную,
// чтобы не тащить в тест целый DOM
const PLACEHOLDER_HINT = /сообщ|напиш|введ|message|type|chat/i;
const CONTAINER_HINT = /chat|message|dialog|conversation/i;

function score(node: FakeEl, viewportHeight = 1000): number {
  let points = 0;
  const placeholder = node.attrs.placeholder ?? '';
  if (PLACEHOLDER_HINT.test(placeholder)) points += 40;

  for (let cur: FakeEl | null = node, depth = 0; cur && depth < 6; cur = cur.parentElement, depth += 1) {
    if (CONTAINER_HINT.test(`${cur.className} ${cur.id}`)) {
      points += 25;
      break;
    }
  }

  if (node.tagName === 'TEXTAREA') points += 15;
  if (node.rect.top > viewportHeight * 0.45) points += 15;
  if (node.rect.width > 220) points += 10;
  return points;
}

function best(nodes: FakeEl[]): FakeEl | null {
  const ranked = nodes
    .map((n) => ({ n, s: score(n) }))
    .filter((c) => c.s > 0)
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.n ?? null;
}

describe('поиск поля ввода чата', () => {
  let chatBox: FakeEl;

  beforeEach(() => {
    chatBox = el('DIV', { className: 'order-chat-wrapper' });
  });

  it('выбирает textarea чата, а не поиск в шапке', () => {
    const search = el('INPUT', { placeholder: 'Поиск', top: 40, width: 400 });
    const chat = el('TEXTAREA', { placeholder: 'Введите сообщение', top: 800 });
    chat.parentElement = chatBox;

    assert.equal(best([search, chat]), chat);
  });

  it('находит поле по контейнеру, даже без подсказки в placeholder', () => {
    const other = el('TEXTAREA', { top: 100, width: 250 });
    const chat = el('TEXTAREA', { top: 820, width: 400 });
    chat.parentElement = chatBox;

    assert.equal(best([other, chat]), chat);
  });

  it('предпочитает textarea произвольному contenteditable', () => {
    const editable = el('DIV', { top: 800, width: 300 });
    const chat = el('TEXTAREA', { top: 800, width: 300 });

    assert.equal(best([editable, chat]), chat);
  });

  it('подсказка в placeholder весит больше положения на экране', () => {
    const bottom = el('TEXTAREA', { top: 900, width: 500 });
    const hinted = el('TEXTAREA', { placeholder: 'Напишите сообщение', top: 100, width: 240 });

    assert.equal(best([bottom, hinted]), hinted);
  });

  it('без единого кандидата возвращает null', () => {
    assert.equal(best([]), null);
  });
});
