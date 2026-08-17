/**
 * Геометрия привязки панели к чату.
 *
 * Раскладка снята с живой страницы ордера: чат — фиксированный столбец справа
 * во всю высоту экрана. Поэтому «под чатом» обязано ужимать сам чат, иначе
 * панель просто накрывает переписку и поле ввода.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { floatingBox, placeBox, type AnchorBox } from '../src/content/anchor.js';

// столбец чата с реальной страницы: x=1016, ширина 408, от 64 до низа
const view = { width: 1440, height: 860 };
const chat: AnchorBox = { top: 64, left: 1016, width: 408, height: 796 };

describe('размещение под чатом', () => {
  it('ужимает чат и встаёт ровно под ним', () => {
    const { box, chatHeight } = placeBox('chat-bottom', chat, 384, 340, view);

    assert.equal(chatHeight, 448);
    assert.equal(box.top, chat.top + 448 + 8);
    assert.equal(box.height, 340);
    // ширину и левый край берём у чата, чтобы получилась одна колонка
    assert.equal(box.left, chat.left);
    assert.equal(box.width, chat.width);
  });

  it('не съедает чат целиком под высокую панель', () => {
    const { box, chatHeight } = placeBox('chat-bottom', chat, 384, 900, view);

    assert.ok(chatHeight !== null && chatHeight >= 220, `чату осталось ${chatHeight}px`);
    assert.ok(box.height >= 160);
    assert.equal(chatHeight! + box.height, chat.height - 8);
  });

  it('на низком экране оставляет чату минимум, а панели не меньше 160', () => {
    const short: AnchorBox = { top: 64, left: 1016, width: 408, height: 420 };
    const { box, chatHeight } = placeBox('chat-bottom', short, 384, 340, view);

    assert.equal(box.height, 192);
    assert.equal(chatHeight, 220);
  });

  it('панель и чат не накладываются друг на друга', () => {
    const { box, chatHeight } = placeBox('chat-bottom', chat, 384, 340, view);
    assert.ok(box.top >= chat.top + chatHeight!, 'панель начинается после чата');
    assert.ok(box.top + box.height <= chat.top + chat.height, 'панель не вылезает за низ экрана');
  });
});

describe('размещение слева от чата', () => {
  it('прижимается к левому краю чата и не ужимает его', () => {
    const { box, chatHeight } = placeBox('chat-left', chat, 384, 340, view);

    assert.equal(chatHeight, null);
    assert.equal(box.left + box.width + 8, chat.left);
    assert.equal(box.top, chat.top);
  });

  it('не уходит за левый край, когда места мало', () => {
    const narrow: AnchorBox = { top: 64, left: 200, width: 408, height: 796 };
    const { box } = placeBox('chat-left', narrow, 384, 340, view);

    assert.ok(box.left >= 8, `left=${box.left}`);
  });
});

describe('свободное размещение', () => {
  it('держится правого верха и влезает в экран', () => {
    const box = floatingBox(384, 900, view);

    assert.equal(box.left, view.width - 384 - 20);
    assert.equal(box.top, 76);
    assert.ok(box.top + box.height <= view.height, 'не вылезает за низ');
  });
});
