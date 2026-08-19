// извлечение реквизитов из чата: лучше пропустить сомнительное, чем выдумать
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractRequisites, isValidCard } from '../src/shared/parse.js';

describe('isValidCard', () => {
  it('принимает валидные по Луну номера', () => {
    assert.ok(isValidCard('4276380012345679'));
    assert.ok(isValidCard('5536913812345672'));
  });

  it('отвергает битые и слишком короткие', () => {
    // та же карта с испорченной контрольной цифрой
    assert.equal(isValidCard('4276380012345671'), false);
    assert.equal(isValidCard('1234'), false);
    assert.equal(isValidCard('12345678901234567890'), false);
  });
});

describe('extractRequisites', () => {
  it('находит карту с пробелами', () => {
    const found = extractRequisites('Переведи на 4276 3800 1234 5679, жду');
    assert.deepEqual(found, [{ type: 'CARD', value: '4276380012345679' }]);
  });

  it('находит телефон в разных форматах', () => {
    const found = extractRequisites('мой номер +7 (916) 123-45-67 сбер');
    assert.deepEqual(found, [{ type: 'PHONE', value: '79161234567' }]);
  });

  it('нормализует номер без кода страны', () => {
    const found = extractRequisites('номер 9161234567');
    assert.deepEqual(found, [{ type: 'PHONE', value: '79161234567' }]);
  });

  it('не принимает случайные числа за реквизиты', () => {
    assert.deepEqual(extractRequisites('курс 95.5, сумма 180000 рублей'), []);
    assert.deepEqual(extractRequisites('ордер 20812345678901234567'), []);
  });

  it('не дублирует одно и то же значение', () => {
    const found = extractRequisites('4276 3800 1234 5679 и ещё раз 4276380012345679');
    assert.equal(found.length, 1);
  });

  it('вытаскивает и карту, и телефон из одного сообщения', () => {
    const found = extractRequisites('Карта 4276380012345679, привязана к +79161234567');
    assert.equal(found.length, 2);
    assert.ok(found.some((r) => r.type === 'CARD'));
    assert.ok(found.some((r) => r.type === 'PHONE'));
  });

  it('не падает на пустоте и мусоре', () => {
    assert.deepEqual(extractRequisites(''), []);
    assert.deepEqual(extractRequisites('...'), []);
  });
});
