// регион телефонного номера
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { phoneRegion } from '../src/shared/phone.js';

describe('регион номера', () => {
  it('хвост маски не участвует в определении кода страны', () => {
    // раньше давало «Казахстан»: 7 + 7712 начиналось с 77
    assert.equal(phoneRegion('+7••••••7712'), 'Россия или Казахстан');
    assert.equal(phoneRegion('+7••••••6012'), 'Россия или Казахстан');
  });

  it('под одним кодом +7 живут две страны, и мы этого не скрываем', () => {
    assert.equal(phoneRegion('+7••••••8169'), 'Россия или Казахстан');
  });

  it('когда вторая цифра видна, различает Россию и Казахстан', () => {
    assert.equal(phoneRegion('+7701••••234'), 'Казахстан');
    assert.equal(phoneRegion('+7916•••4567'), 'Россия');
    assert.equal(phoneRegion('+7495•••4567'), 'Россия');
  });

  it('узнаёт соседние коридоры', () => {
    assert.equal(phoneRegion('+994••••1234'), 'Азербайджан');
    assert.equal(phoneRegion('+998••••1234'), 'Узбекистан');
    assert.equal(phoneRegion('+380••••5566'), 'Украина');
    assert.equal(phoneRegion('+90••••7788'), 'Турция');
  });

  it('молчит, когда сказать нечего', () => {
    assert.equal(phoneRegion(null), null);
    assert.equal(phoneRegion(undefined), null);
    assert.equal(phoneRegion(''), null);
    // код страны скрыт целиком — гадать не по чему
    assert.equal(phoneRegion('••••••8169'), null);
    // неизвестный код лучше не выдумывать
    assert.equal(phoneRegion('+265••••1234'), null);
  });
});
