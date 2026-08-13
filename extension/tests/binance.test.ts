/**
 * Тесты разбора ответов Binance. Здесь проверяется главное допущение
 * расширения: мы узнаём ордер и профиль по ФОРМЕ объекта, а не по имени
 * эндпоинта — значит переживём переименование путей и обёрток.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectOrderId,
  extractFromPayload,
  findObjects,
  looksLikeOrder,
  normalizeOrderDetail,
  normalizeStatus,
  normalizeUserDetail,
} from '../src/background/binance.js';

describe('detectOrderId', () => {
  it('берёт номер из query', () => {
    assert.equal(
      detectOrderId('https://p2p.binance.com/ru/fiatOrderDetail?orderNo=20812345678901234567'),
      '20812345678901234567',
    );
  });

  it('понимает orderNumber и adOrderNo', () => {
    assert.equal(detectOrderId('https://c2c.binance.com/en/orderDetail?orderNumber=123456789'), '123456789');
    assert.equal(detectOrderId('https://www.binance.com/ru/order?adOrderNo=987654321'), '987654321');
  });

  it('находит номер в хэше SPA-роутера', () => {
    assert.equal(
      detectOrderId('https://p2p.binance.com/ru/trade#/orderDetail?orderNo=20899999999999999999'),
      '20899999999999999999',
    );
  });

  it('берёт длинное число из пути', () => {
    assert.equal(
      detectOrderId('https://p2p.binance.com/ru/order/208123456789012345/detail'),
      '208123456789012345',
    );
  });

  it('игнорирует чужие домены и мусор', () => {
    assert.equal(detectOrderId('https://binance-fake.com/ru/fiatOrderDetail?orderNo=123456789'), null);
    assert.equal(detectOrderId('https://p2p.binance.com/ru/trade'), null);
    assert.equal(detectOrderId(undefined), null);
    assert.equal(detectOrderId('не-урл'), null);
  });
});

describe('normalizeStatus', () => {
  it('понимает числовые коды', () => {
    assert.equal(normalizeStatus(1), 'PENDING');
    assert.equal(normalizeStatus(2), 'PAID');
    assert.equal(normalizeStatus(4), 'COMPLETED');
    assert.equal(normalizeStatus(5), 'CANCELLED');
  });

  it('понимает строковые и числа-строки', () => {
    assert.equal(normalizeStatus('COMPLETED'), 'COMPLETED');
    assert.equal(normalizeStatus('buyer_payed'), 'PAID');
    assert.equal(normalizeStatus('IN APPEAL'), 'APPEALING');
    assert.equal(normalizeStatus('4'), 'COMPLETED');
  });

  it('не падает на неизвестном', () => {
    assert.equal(normalizeStatus(null), 'UNKNOWN');
    assert.equal(normalizeStatus('черт-те что'), 'UNKNOWN');
  });
});

describe('normalizeOrderDetail', () => {
  const raw = {
    orderNumber: '20812345678901234567',
    tradeType: 'BUY',
    orderStatus: 4,
    asset: 'USDT',
    fiatUnit: 'RUB',
    totalPrice: '180000',
    price: '95.5',
    createTime: 1_772_000_000_000,
    buyerUserNo: 'me-123',
    sellerUserNo: 'them-456',
    buyerNickname: 'my_nick',
    sellerNickname: 'aminexh',
    sellerMobilePhone: '+7******8169',
  };

  it('определяет контрагента по своему UID', () => {
    const parsed = normalizeOrderDetail(raw, 'me-123');
    assert.equal(parsed.counterparty?.externalId, 'them-456');
    assert.equal(parsed.counterparty?.nickname, 'aminexh');
    assert.equal(parsed.order.status, 'COMPLETED');
    assert.equal(parsed.order.amountFiat, 180000);
    assert.equal(parsed.order.fiat, 'RUB');
  });

  it('без своего UID опирается на сторону сделки и подсказывает свой UID', () => {
    const parsed = normalizeOrderDetail(raw, null);
    // Мы покупаем → контрагент продавец, а покупатель — это мы.
    assert.equal(parsed.counterparty?.externalId, 'them-456');
    assert.equal(parsed.selfHint, 'me-123');
  });

  it('для продажи контрагент — покупатель', () => {
    const parsed = normalizeOrderDetail({ ...raw, tradeType: 'SELL' }, null);
    assert.equal(parsed.counterparty?.externalId, 'me-123');
    assert.equal(parsed.selfHint, 'them-456');
  });

  it('уважает явное поле контрагента', () => {
    const parsed = normalizeOrderDetail(
      { ...raw, counterPartUserNo: 'explicit-1', counterPartNickName: 'Lev207' },
      'me-123',
    );
    assert.equal(parsed.counterparty?.externalId, 'explicit-1');
    assert.equal(parsed.counterparty?.nickname, 'Lev207');
  });

  it('переживает альтернативные имена полей', () => {
    const parsed = normalizeOrderDetail(
      {
        orderNo: '999888777',
        side: 'SELL',
        status: 'CANCELLED',
        currencyCode: 'KZT',
        fiatAmount: 55000,
        buyerNo: 'buyer-1',
        buyerName: 'ProDavan',
      },
      null,
    );
    assert.equal(parsed.order.externalId, '999888777');
    assert.equal(parsed.order.status, 'CANCELLED');
    assert.equal(parsed.order.fiat, 'KZT');
    assert.equal(parsed.order.amountFiat, 55000);
    assert.equal(parsed.counterparty?.externalId, 'buyer-1');
  });
});

describe('normalizeUserDetail', () => {
  it('разбирает вложенную статистику', () => {
    const snapshot = normalizeUserDetail({
      userNo: 'them-456',
      nickName: 'aminexh',
      countryCode: 'MAR',
      registerDays: 495,
      userStatsRet: {
        completedOrderNum: 295,
        finishRate: 0.97,
        tradeCountOfLast30day: 24,
        tradeAmountOfLast30day: 264_648,
        avgReleaseTimeOfLast30day: 1440,
        avgPayTimeOfLast30day: 120,
        positiveCount: 30,
      },
    });

    assert.equal(snapshot?.externalId, 'them-456');
    assert.equal(snapshot?.stats?.totalOrders, 295);
    assert.equal(snapshot?.stats?.completionRate, 0.97);
    assert.equal(snapshot?.stats?.avgAmount30dFiat, 11027);
    assert.equal(snapshot?.stats?.avgReleaseMinutes, 24);
    assert.equal(snapshot?.stats?.avgPayMinutes, 2);
  });

  it('приводит процент завершения к доле', () => {
    const snapshot = normalizeUserDetail({
      userNo: 'x',
      nickname: 'y',
      userStatsRet: { finishRate: 97.5 },
    });
    assert.equal(snapshot?.stats?.completionRate, 0.975);
  });

  it('работает и с плоской статистикой', () => {
    const snapshot = normalizeUserDetail({
      userNo: 'flat-1',
      nickName: 'Lev207',
      completionRate: 100,
      totalOrderCount: 257,
    });
    assert.equal(snapshot?.stats?.completionRate, 1);
    assert.equal(snapshot?.stats?.totalOrders, 257);
  });

  it('без userNo возвращает null', () => {
    assert.equal(normalizeUserDetail({ nickName: 'нет UID' }), null);
  });
});

describe('извлечение из перехваченного ответа', () => {
  // Так выглядит типичная обёртка Binance: код, сообщение и вложенный data.
  const payload = {
    code: '000000',
    message: null,
    success: true,
    data: {
      orderDetailVO: {
        orderNumber: '20855555555555555555',
        tradeType: 'SELL',
        orderStatus: 2,
        fiatUnit: 'RUB',
        totalPrice: 15003.04,
        buyerUserNo: 'buyer-9',
        buyerNickname: 'VitcoinoV',
        sellerUserNo: 'self-1',
      },
      counterPartyVO: {
        userNo: 'buyer-9',
        nickName: 'VitcoinoV',
        registerDays: 118,
        userStatsRet: { finishRate: 0.9, completedOrderNum: 60 },
      },
    },
  };

  it('находит ордер и профиль внутри вложенной структуры', () => {
    const result = extractFromPayload(payload, 'self-1');
    assert.equal(result.order?.order.externalId, '20855555555555555555');
    assert.equal(result.order?.counterparty?.externalId, 'buyer-9');
    assert.equal(result.order?.order.status, 'PAID');

    const user = result.users.find((u) => u.externalId === 'buyer-9');
    assert.equal(user?.stats?.totalOrders, 60);
    assert.equal(user?.stats?.registeredDays, 118);
  });

  it('не находит лишнего в постороннем ответе', () => {
    const result = extractFromPayload({ data: { balance: '100', asset: 'USDT' } }, null);
    assert.equal(result.order, undefined);
    assert.equal(result.users.length, 0);
  });

  it('находит все ордера в списке истории', () => {
    const list = {
      data: [
        { orderNumber: '1', orderStatus: 4, buyerUserNo: 'a', sellerUserNo: 'b', tradeType: 'BUY' },
        { orderNumber: '2', orderStatus: 5, buyerUserNo: 'c', sellerUserNo: 'd', tradeType: 'SELL' },
      ],
    };
    assert.equal(findObjects(list, looksLikeOrder).length, 2);
  });

  it('не уходит в бесконечную рекурсию на циклической ссылке', () => {
    const cyclic: Record<string, unknown> = { orderNumber: '7', tradeType: 'BUY' };
    cyclic.self = cyclic;
    assert.doesNotThrow(() => findObjects(cyclic, looksLikeOrder));
  });
});
