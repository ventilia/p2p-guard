/**
 * Место для панели на странице ордера.
 *
 * Панель — самостоятельный блок документа под чатом. Раньше она была накладкой
 * поверх и ужимала переписку, чтобы влезть в её колонку: снаружи это читалось
 * как часть чата и разъезжалось на некоторых размерах. Теперь вёрстку биржи не
 * трогаем, а координаты считаем в документе, чтобы блок прокручивался вместе
 * со страницей.
 */
import assert from 'node:assert/strict';
import { documentBox, floatingBox, type AnchorBox } from '../src/content/anchor.js';
import { describe, it } from 'node:test';

// столбец чата с живой страницы: x=1016, ширина 408, от 64 до низа окна
const view = { width: 1440, height: 860 };
const chat: AnchorBox = { top: 64, left: 1016, width: 408, height: 796 };
const panel = { width: 720, height: 720 };

describe('блок под чатом', () => {
  it('встаёт ниже чата с отступом', () => {
    const box = documentBox(chat, panel, { x: 0, y: 0 }, view);

    assert.equal(box.top, chat.top + chat.height + 12);
    assert.equal(box.height, panel.height);
  });

  it('живёт в координатах документа, а не окна', () => {
    const scrolled = documentBox(chat, panel, { x: 0, y: 500 }, view);
    const top = documentBox(chat, panel, { x: 0, y: 0 }, view);

    // чат фиксированный: при прокрутке его top в окне не меняется, а блок
    // обязан уехать вместе со страницей
    assert.equal(scrolled.top, top.top + 500);
  });

  it('прижат правым краем к чату и растёт влево', () => {
    const box = documentBox(chat, panel, { x: 0, y: 0 }, view);

    assert.equal(box.width, 720);
    assert.equal(box.left + box.width, chat.left + chat.width);
  });

  it('не бывает уже колонки чата', () => {
    const box = documentBox(chat, { width: 100, height: 720 }, { x: 0, y: 0 }, view);

    assert.equal(box.width, chat.width);
  });

  it('не вылезает за левый край страницы', () => {
    const box = documentBox(chat, { width: 5000, height: 720 }, { x: 0, y: 0 }, view);

    assert.ok(box.left >= 12, `left=${box.left}`);
    assert.ok(box.left + box.width <= chat.left + chat.width);
  });

  it('учитывает горизонтальную прокрутку', () => {
    const box = documentBox(chat, panel, { x: 200, y: 0 }, view);
    const base = documentBox(chat, panel, { x: 0, y: 0 }, view);

    assert.equal(box.left, base.left + 200);
  });
});

describe('свободное размещение', () => {
  it('держится правого верха и влезает в окно', () => {
    const box = floatingBox(384, 900, view);

    assert.equal(box.left, view.width - 384 - 20);
    assert.equal(box.top, 76);
    assert.ok(box.top + box.height <= view.height, 'не вылезает за низ');
  });
});
