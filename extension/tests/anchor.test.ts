/**
 * Геометрия привязки панели к чату.
 *
 * Раскладка снята с живой страницы ордера: чат — фиксированный столбец справа
 * во всю высоту экрана. Поэтому «под чатом» обязано ужимать сам чат, иначе
 * панель просто накрывает переписку и поле ввода.
 *
 * Расчёт намеренно разделён надвое: planLayout решает, каким сделать чат, а
 * panelPosition ставит панель по УЖЕ изменённому прямоугольнику. Раньше позиция
 * предсказывалась заранее, и после смены ширины панель разъезжалась с чатом.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { floatingBox, panelPosition, planLayout, type AnchorBox } from '../src/content/anchor.js';

// столбец чата с реальной страницы: x=1016, ширина 408, от 64 до низа
const view = { width: 1440, height: 860 };
const natural = { width: 408, height: 796 };
const chatRect: AnchorBox = { top: 64, left: 1016, width: 408, height: 796 };

// размеры чата не заданы: подстраиваемся под высоту панели
const auto = { width: 0, height: 0 };

describe('размещение под чатом', () => {
  it('делит столбец между чатом и панелью', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 340 }, auto, view);

    assert.equal(plan.chat.height, 448);
    assert.equal(plan.panel.height, 340);
    assert.equal(plan.chat.height! + 8 + plan.panel.height, natural.height);
    // ширину чата не просили — значит не переопределяем
    assert.equal(plan.chat.width, null);
  });

  it('ставит панель вплотную под изменённым чатом', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 340 }, auto, view);
    // так выглядит столбец после применения плана
    const resized: AnchorBox = { ...chatRect, height: plan.chat.height! };
    const box = panelPosition('chat-bottom', resized, plan.panel, view);

    assert.equal(box.top, resized.top + resized.height + 8);
    assert.equal(box.left, resized.left);
    assert.equal(box.width, resized.width);
    assert.equal(box.top + box.height, chatRect.top + chatRect.height);
  });

  it('не съедает чат целиком под высокую панель', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 900 }, auto, view);

    assert.ok(plan.chat.height !== null && plan.chat.height >= 220);
    assert.ok(plan.panel.height >= 160);
  });

  it('на низком экране оставляет чату минимум, а панели не меньше 160', () => {
    const short = { width: 408, height: 420 };
    const plan = planLayout('chat-bottom', short, { width: 384, height: 340 }, auto, view);

    assert.equal(plan.chat.height, 220);
    assert.equal(plan.panel.height, 192);
  });
});

describe('ползунки размеров чата', () => {
  it('заданная высота чата главнее высоты панели', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 340 }, { width: 0, height: 600 }, view);

    assert.equal(plan.chat.height, 600);
    assert.equal(plan.panel.height, 796 - 8 - 600);
  });

  it('высоту чата не даёт задрать так, чтобы панель исчезла', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 340 }, { width: 0, height: 5000 }, view);

    assert.equal(plan.panel.height, 160);
    assert.equal(plan.chat.height, 796 - 8 - 160);
  });

  it('высоту чата не даёт опустить ниже минимума', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 340 }, { width: 0, height: 40 }, view);

    assert.equal(plan.chat.height, 220);
  });

  it('шире чат — шире и панель', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 340 }, { width: 560, height: 0 }, view);

    assert.equal(plan.chat.width, 560);
    assert.equal(plan.panel.width, 560);
  });

  it('ширину чата ограничивает шириной окна', () => {
    const plan = planLayout('chat-bottom', natural, { width: 384, height: 340 }, { width: 5000, height: 0 }, view);

    assert.equal(plan.chat.width, Math.round(view.width * 0.6));
  });

  it('панель встаёт по фактическому краю расширенного чата, а не по расчётному', () => {
    // столбец прижат к правому краю: став шире, он уезжает влево
    const widened: AnchorBox = { top: 64, left: 880, width: 560, height: 448 };
    const box = panelPosition('chat-bottom', widened, { width: 560, height: 340 }, view);

    assert.equal(box.left, 880);
    assert.equal(box.width, 560);
  });

  it('и по фактическому краю чата, который расширился вправо', () => {
    // а этот прижат к левому краю: левый край остался на месте
    const widened: AnchorBox = { top: 64, left: 1016, width: 560, height: 448 };
    const box = panelPosition('chat-bottom', widened, { width: 560, height: 340 }, view);

    assert.equal(box.left, 1016);
  });
});

describe('размещение слева от чата', () => {
  it('прижимается к левому краю чата и не ужимает его', () => {
    const plan = planLayout('chat-left', natural, { width: 384, height: 340 }, auto, view);
    assert.equal(plan.chat.height, null);

    const box = panelPosition('chat-left', chatRect, plan.panel, view);
    assert.equal(box.left + box.width + 8, chatRect.left);
    assert.equal(box.top, chatRect.top);
  });

  it('высоту чата зажимает по его собственной колонке, а не по высоте окна', () => {
    const plan = planLayout('chat-left', natural, { width: 384, height: 340 }, { width: 0, height: 5000 }, view);

    // столбец начинается на y=64, поэтому предел — 796, а не 860
    assert.equal(plan.chat.height, natural.height);
    assert.ok(chatRect.top + plan.chat.height! <= view.height, 'не вылезает за нижний край экрана');
  });

  it('не уходит за левый край, когда места мало', () => {
    const narrow: AnchorBox = { top: 64, left: 200, width: 408, height: 796 };
    const box = panelPosition('chat-left', narrow, { width: 384, height: 340 }, view);

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
