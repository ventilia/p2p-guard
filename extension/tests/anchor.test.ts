/**
 * Ширина блока панели на странице ордера.
 *
 * Панель — обычный элемент колонки ордера. В полосу чата она не заходит: тот у
 * биржи position:fixed и прибит к окну, поэтому любой блок в его полосе при
 * прокрутке проходит сквозь него. Отсюда единственное ограничение — правый
 * край не дальше левого края переписки.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flowWidth, floatingBox } from '../src/content/anchor.js';

// раскладка живой страницы: колонка ордера от 24, чат начинается на 1016
const view = { width: 1440, height: 860 };
const column = { left: 24, width: 588 };
const chatLeft = 1016;

describe('ширина блока в колонке ордера', () => {
  it('растягивается до заданной ширины', () => {
    assert.equal(flowWidth(column, chatLeft, 720, view), 720);
  });

  it('не заходит в полосу чата', () => {
    const width = flowWidth(column, chatLeft, 5000, view);

    assert.equal(column.left + width, chatLeft - 16);
    assert.ok(column.left + width < chatLeft, 'правый край левее переписки');
  });

  it('не бывает уже своей колонки', () => {
    assert.equal(flowWidth(column, chatLeft, 100, view), column.width);
  });

  it('на узкой колонке всё равно занимает её целиком', () => {
    const narrow = { left: 24, width: 900 };
    const width = flowWidth(narrow, chatLeft, 300, view);

    assert.equal(width, 900);
  });

  it('без чата ограничивается шириной окна', () => {
    const width = flowWidth(column, 0, 5000, view);

    assert.equal(column.left + width, view.width - 16);
  });

  it('не зависит от прокрутки: её учитывает браузер', () => {
    const a = flowWidth(column, chatLeft, 720, view);
    const b = flowWidth(column, chatLeft, 720, view);

    assert.equal(a, b);
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
