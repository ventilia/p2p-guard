// ширина блока панели на странице ордера
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flowWidth, floatingBox } from '../src/content/anchor.js';

const view = { width: 1440, height: 860 };
const column = { left: 24, width: 924 };
const chatLeft = 972;

describe('ширина блока в колонке ордера', () => {
  it('растягивается до заданной ширины', () => {
    assert.equal(flowWidth(column, chatLeft, 720, view), 720);
  });

  it('не выходит за свою колонку', () => {
    const width = flowWidth(column, 5000, 5000, view);

    assert.equal(width, column.width);
  });

  it('на реальных размерах ограничителем оказывается колонка', () => {
    const width = flowWidth(column, chatLeft, 5000, view);

    // 24 + 924 = 948, до чата на 972 остаётся запас
    assert.equal(width, column.width);
    assert.ok(column.left + width < chatLeft, 'правый край левее переписки');
  });

  it('широкая колонка не отменяет предел по чату', () => {
    // колонка шире, чем расстояние до чата: побеждает меньшее
    const wide = { left: 24, width: 2000 };
    const width = flowWidth(wide, chatLeft, 5000, view);

    assert.equal(wide.left + width, chatLeft - 16);
  });

  it('не бывает уже минимума', () => {
    assert.equal(flowWidth(column, chatLeft, 50, view), 320);
  });

  it('на узкой странице остаётся читаемой ширины', () => {
    // чат почти вплотную к колонке: ужимать панель до нуля нельзя
    assert.equal(flowWidth(column, 200, 720, view), 320);
  });

  it('без чата ограничивается своей колонкой', () => {
    assert.equal(flowWidth(column, 0, 5000, view), column.width);
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
