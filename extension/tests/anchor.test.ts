/**
 * Ширина блока панели на странице ордера.
 *
 * Панель — обычный элемент страницы под блоком ордера. В полосу чата она не
 * заходит: тот у биржи position:fixed и прибит к окну, поэтому любой блок в
 * его полосе при прокрутке проходит сквозь него. Отсюда единственное
 * ограничение — правый край не дальше левого края переписки.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flowWidth, floatingBox } from '../src/content/anchor.js';

// раскладка живой страницы: контейнер от 24, чат начинается на 1016
const view = { width: 1440, height: 860 };
const left = 24;
const chatLeft = 1016;

describe('ширина блока под ордером', () => {
  it('растягивается до заданной ширины', () => {
    assert.equal(flowWidth(left, chatLeft, 720, view), 720);
  });

  it('не заходит в полосу чата', () => {
    const width = flowWidth(left, chatLeft, 5000, view);

    assert.equal(left + width, chatLeft - 16);
    assert.ok(left + width < chatLeft, 'правый край левее переписки');
  });

  it('широкий контейнер не отменяет ограничение', () => {
    // контейнер тянется на всю страницу, но панель всё равно упирается в чат
    const width = flowWidth(0, chatLeft, 5000, view);

    assert.equal(width, chatLeft - 16);
  });

  it('не бывает уже минимума', () => {
    assert.equal(flowWidth(left, chatLeft, 50, view), 320);
  });

  it('на узкой странице остаётся читаемой ширины', () => {
    // чат почти вплотную к краю: ужимать панель до нуля нельзя
    const width = flowWidth(left, 200, 720, view);

    assert.equal(width, 320);
  });

  it('без чата ограничивается шириной окна', () => {
    const width = flowWidth(left, 0, 5000, view);

    assert.equal(left + width, view.width - 16);
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
