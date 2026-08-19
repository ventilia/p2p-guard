/**
 * Раскладка панели на странице ордера.
 *
 * Панель встраивается в вёрстку биржи обычным блоком. Координаты считать
 * нельзя: столбец чата у Binance position:fixed, в потоке места не занимает, и
 * его top при прокрутке не меняется. Позиция, посчитанная от него и сложенная
 * с прокруткой, убегала вниз вместе со страницей — панель мелькала и пропадала.
 * Поэтому здесь только размеры и отступы, а раскладывает браузер.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flowStyle, floatingBox } from '../src/content/anchor.js';

// столбец чата с живой страницы: ширина 408, во всю высоту окна
const view = { width: 1440, height: 860 };
const chat = { width: 408, height: 796 };
const panel = { width: 720, height: 720 };

describe('блок под чатом', () => {
  it('опускается ровно под переписку', () => {
    const style = flowStyle(chat, panel, view);

    assert.equal(style.marginTop, chat.height + 12);
    assert.equal(style.maxHeight, panel.height);
  });

  it('шире колонки чата и уходит влево отрицательным отступом', () => {
    const style = flowStyle(chat, panel, view);

    assert.equal(style.width, 720);
    // правый край остаётся на правом крае чата
    assert.equal(style.marginLeft, chat.width - style.width);
    assert.ok(style.marginLeft < 0, 'панель шире колонки — отступ обязан быть отрицательным');
  });

  it('уже колонки чата не становится', () => {
    const style = flowStyle(chat, { width: 100, height: 720 }, view);

    assert.equal(style.width, chat.width);
    assert.equal(style.marginLeft, 0);
  });

  it('не вылезает за пределы окна при огромной ширине', () => {
    const style = flowStyle(chat, { width: 9000, height: 720 }, view);

    assert.ok(style.width <= view.width - 24, `width=${style.width}`);
  });

  it('на узком окне остаётся хотя бы шириной с чат', () => {
    const narrow = { width: 360, height: 800 };
    const style = flowStyle(chat, panel, narrow);

    assert.ok(style.width >= chat.width, `width=${style.width}`);
  });

  it('не зависит от прокрутки: в потоке её учитывает браузер', () => {
    const a = flowStyle(chat, panel, view);
    const b = flowStyle(chat, panel, view);

    assert.deepEqual({ ...a }, { ...b });
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
