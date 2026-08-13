import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateRisk, type RiskInput } from '../src/lib/risk.js';
import { maskRequisite, maskUid } from '../src/lib/crypto.js';
import { parseDurationSeconds } from '../src/lib/time.js';

const base: RiskInput = {
  globalBlacklist: 0,
  teamBlacklist: 0,
  blacklistedRequisites: 0,
  reviews: { positive: 0, neutral: 0, negative: 0 },
  orders: { total: 0, completed: 0, cancelled: 0 },
  teamOrders: { total: 0, completed: 0 },
  exchange: {},
};

describe('calculateRisk', () => {
  it('без данных даёт низкий риск и честно об этом говорит', () => {
    const result = calculateRisk(base);
    assert.equal(result.score, 0);
    assert.equal(result.level, 'LOW');
    assert.equal(result.factors[0]?.code, 'NO_DATA');
  });

  it('глобальный ЧС сразу выводит в критический', () => {
    const result = calculateRisk({ ...base, globalBlacklist: 1 });
    assert.equal(result.level, 'CRITICAL');
    assert.ok(result.factors.some((f) => f.code === 'BLACKLIST_GLOBAL'));
  });

  it('командный ЧС — высокий риск, но не критический сам по себе', () => {
    const result = calculateRisk({ ...base, teamBlacklist: 1 });
    assert.equal(result.level, 'HIGH');
  });

  it('совпадение реквизита с ЧС весомо', () => {
    const result = calculateRisk({ ...base, blacklistedRequisites: 1 });
    assert.equal(result.level, 'HIGH');
    assert.ok(result.factors.some((f) => f.code === 'REQUISITE_BLACKLISTED'));
  });

  it('хорошая репутация уводит балл в ноль, а не в минус', () => {
    const result = calculateRisk({
      ...base,
      reviews: { positive: 10, neutral: 0, negative: 0 },
      teamOrders: { total: 30, completed: 30 },
    });
    assert.equal(result.score, 0);
    assert.equal(result.level, 'LOW');
  });

  it('негатив повышает балл пропорционально доле', () => {
    const few = calculateRisk({ ...base, reviews: { positive: 20, neutral: 0, negative: 1 } });
    const many = calculateRisk({ ...base, reviews: { positive: 0, neutral: 0, negative: 5 } });
    assert.ok(many.score > few.score);
  });

  it('учитывает молодой аккаунт и низкий процент завершения', () => {
    const result = calculateRisk({
      ...base,
      exchange: { registeredDays: 12, completionRate: 0.82, totalOrders: 15, avgAmountFiat: 90_000 },
    });
    const codes = result.factors.map((f) => f.code);
    assert.ok(codes.includes('YOUNG_ACCOUNT'));
    assert.ok(codes.includes('LOW_COMPLETION_RATE'));
    assert.ok(codes.includes('LOW_VOLUME_HIGH_TICKET'));
    assert.equal(result.level, 'HIGH');
  });

  it('высокая доля отмен по нашей базе учитывается', () => {
    const result = calculateRisk({
      ...base,
      orders: { total: 10, completed: 4, cancelled: 6 },
    });
    assert.ok(result.factors.some((f) => f.code === 'HIGH_CANCEL_RATE'));
  });

  it('балл никогда не выходит за 0…100', () => {
    const worst = calculateRisk({
      globalBlacklist: 3,
      teamBlacklist: 2,
      blacklistedRequisites: 4,
      reviews: { positive: 0, neutral: 0, negative: 20 },
      orders: { total: 20, completed: 2, cancelled: 18 },
      teamOrders: { total: 0, completed: 0 },
      exchange: { registeredDays: 1, completionRate: 0.1, totalOrders: 2, avgAmountFiat: 500_000, avgReleaseMinutes: 90 },
    });
    assert.equal(worst.score, 100);
    assert.equal(worst.level, 'CRITICAL');
  });

  it('факторы отсортированы по значимости', () => {
    const result = calculateRisk({
      ...base,
      globalBlacklist: 1,
      exchange: { registeredDays: 5 },
    });
    const impacts = result.factors.map((f) => Math.abs(f.impact));
    assert.deepEqual(impacts, [...impacts].sort((a, b) => b - a));
  });
});

describe('маскирование', () => {
  it('прячет середину реквизита', () => {
    assert.equal(maskRequisite('4276380012345679'), '4276••••••••5679');
    assert.equal(maskRequisite('79161234567'), '7916•••4567');
  });

  it('UID показывает только хвостом', () => {
    assert.equal(maskUid('421044135'), '•••135');
    assert.equal(maskUid('12'), '•••12');
  });
});

describe('parseDurationSeconds', () => {
  it('разбирает привычные форматы', () => {
    assert.equal(parseDurationSeconds('15m'), 900);
    assert.equal(parseDurationSeconds('2h'), 7200);
    assert.equal(parseDurationSeconds('30d'), 2_592_000);
    assert.equal(parseDurationSeconds('45s'), 45);
  });

  it('число трактует как секунды, мусор — как значение по умолчанию', () => {
    assert.equal(parseDurationSeconds('120'), 120);
    assert.equal(parseDurationSeconds('черт-те что'), 900);
  });
});
