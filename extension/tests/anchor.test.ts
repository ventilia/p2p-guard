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

// размеры чата не заданы: подстраиваемся под высоту панели
const auto = { width: 0, height: 0 };

describe('размещение под чатом', () => {
  it('ужимает чат и встаёт ровно под ним', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 340 }, auto, view);

    assert.equal(placed.chat.height, 448);
    assert.equal(placed.box.top, chat.top + 448 + 8);
    assert.equal(placed.box.height, 340);
    // ширину и левый край берём у чата, чтобы получилась одна колонка
    assert.equal(placed.box.left, chat.left);
    assert.equal(placed.box.width, chat.width);
    // ширину чата не трогали, значит её не надо и переопределять
    assert.equal(placed.chat.width, null);
  });

  it('не съедает чат целиком под высокую панель', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 900 }, auto, view);

    assert.ok(placed.chat.height !== null && placed.chat.height >= 220);
    assert.ok(placed.box.height >= 160);
    assert.equal(placed.chat.height! + placed.box.height, chat.height - 8);
  });

  it('на низком экране оставляет чату минимум, а панели не меньше 160', () => {
    const short: AnchorBox = { top: 64, left: 1016, width: 408, height: 420 };
    const placed = placeBox('chat-bottom', short, { width: 384, height: 340 }, auto, view);

    assert.equal(placed.box.height, 192);
    assert.equal(placed.chat.height, 220);
  });

  it('панель и чат не накладываются друг на друга', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 340 }, auto, view);

    assert.ok(placed.box.top >= chat.top + placed.chat.height!, 'панель начинается после чата');
    assert.ok(placed.box.top + placed.box.height <= chat.top + chat.height, 'панель не вылезает за низ');
  });
});

describe('ползунки размеров чата', () => {
  it('заданная высота чата главнее высоты панели', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 340 }, { width: 0, height: 600 }, view);

    assert.equal(placed.chat.height, 600);
    assert.equal(placed.box.height, 796 - 8 - 600);
  });

  it('высоту чата не даёт задрать так, чтобы панель исчезла', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 340 }, { width: 0, height: 5000 }, view);

    assert.equal(placed.box.height, 160);
    assert.equal(placed.chat.height, 796 - 8 - 160);
  });

  it('высоту чата не даёт опустить ниже минимума', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 340 }, { width: 0, height: 40 }, view);

    assert.equal(placed.chat.height, 220);
  });

  it('шире чат — шире и панель, обе сдвигаются влево', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 340 }, { width: 560, height: 0 }, view);

    assert.equal(placed.chat.width, 560);
    assert.equal(placed.box.width, 560);
    // правый край остаётся на месте: столбец прижат к краю окна
    assert.equal(placed.box.left + placed.box.width, chat.left + chat.width);
  });

  it('ширину чата ограничивает шириной окна', () => {
    const placed = placeBox('chat-bottom', chat, { width: 384, height: 340 }, { width: 5000, height: 0 }, view);

    assert.equal(placed.chat.width, Math.round(view.width * 0.6));
  });
});

describe('размещение слева от чата', () => {
  it('прижимается к левому краю чата и не ужимает его', () => {
    const placed = placeBox('chat-left', chat, { width: 384, height: 340 }, auto, view);

    assert.equal(placed.chat.height, null);
    assert.equal(placed.box.left + placed.box.width + 8, chat.left);
    assert.equal(placed.box.top, chat.top);
  });

  it('учитывает, что расширенный чат сдвинул свой левый край', () => {
    const placed = placeBox('chat-left', chat, { width: 384, height: 340 }, { width: 560, height: 0 }, view);

    // чат стал шире на 152, его левый край уехал влево — панель следом
    assert.equal(placed.box.left + placed.box.width + 8, chat.left - 152);
  });

  it('не уходит за левый край, когда места мало', () => {
    const narrow: AnchorBox = { top: 64, left: 200, width: 408, height: 796 };
    const placed = placeBox('chat-left', narrow, { width: 384, height: 340 }, auto, view);

    assert.ok(placed.box.left >= 8, `left=${placed.box.left}`);
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
