// тесты разбора ответов Binance. Здесь проверяется главное допущение
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectOrderId,
  extractFromPayload,
  findObjects,
  looksLikeFeedback,
  looksLikeOrder,
  normalizeFeedback,
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
    // мы покупаем → контрагент продавец, а покупатель — это мы
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

  // средний чек биржа готовым не отдаёт — его считаем сами, как и аналог
  it('считает общий средний чек из оборота и числа сделок', () => {
    const snapshot = normalizeUserDetail({
      userNo: 'avg-1',
      nickName: 'aminexh',
      userStatsRet: {
        totalFinishCount: 295,
        totalTradeAmount: 4_411_725,
      },
    });

    assert.equal(snapshot?.stats?.totalOrders, 295);
    assert.equal(snapshot?.stats?.avgAmountFiat, 14_955);
  });

  it('не делит на ноль, если сделок ещё не было', () => {
    const snapshot = normalizeUserDetail({
      userNo: 'avg-2',
      nickName: 'новичок',
      userStatsRet: { totalFinishCount: 0, totalTradeAmount: 0 },
    });

    assert.equal(snapshot?.stats?.avgAmountFiat, null);
  });

  // форма ответа profile-and-ads-list: профиль лежит в userDetailVo
  it('разбирает ответ profile-and-ads-list с userDetailVo', () => {
    const snapshot = normalizeUserDetail({
      userNo: 'adv-777',
      userDetailVo: {
        userNo: 'adv-777',
        nickName: 'sdwrus',
        countryCode: 'LKA',
        registerDays: 976,
        userType: 'MERCHANT',
        monthOrderCount: 12,
        monthFinishRate: 98.5,
        positiveRate: 0.98,
        completedOrderNumOfLatest30day: 12,
      },
    });

    assert.equal(snapshot?.externalId, 'adv-777');
    assert.equal(snapshot?.nickname, 'sdwrus');
    assert.equal(snapshot?.countryCode, 'LKA');
    assert.equal(snapshot?.stats?.registeredDays, 976);
    assert.equal(snapshot?.stats?.orders30d, 12);
    assert.equal(snapshot?.stats?.completionRate, 0.985);
    assert.equal(snapshot?.stats?.positiveRate, 0.98);
    assert.equal(snapshot?.stats?.merchantLevel, 'MERCHANT');
  });

  it('positiveRate в процентах тоже приводится к доле', () => {
    const snapshot = normalizeUserDetail({ userNo: 'p', nickName: 'n', positiveRate: 98 });
    assert.equal(snapshot?.stats?.positiveRate, 0.98);
  });

  it('firstOrderDays берётся напрямую, если биржа его отдала', () => {
    const snapshot = normalizeUserDetail({ userNo: 'f', nickName: 'n', firstOrderDays: 7 });
    assert.equal(snapshot?.stats?.firstOrderDays, 7);
  });
});

// статусы из официальной документации C2C (listUserOrderHistory)
describe('официальные статусы C2C покрыты', () => {
  const OFFICIAL = {
    PENDING: 'PENDING',
    TRADING: 'PENDING',
    BUYER_PAYED: 'PAID',
    DISTRIBUTING: 'PAID',
    COMPLETED: 'COMPLETED',
    IN_APPEAL: 'APPEALING',
    CANCELLED: 'CANCELLED',
    CANCELLED_BY_SYSTEM: 'CANCELLED',
  } as const;

  it('каждый документированный статус распознан', () => {
    for (const [raw, expected] of Object.entries(OFFICIAL)) {
      assert.equal(normalizeStatus(raw), expected, `статус ${raw}`);
    }
  });
});

// поля ордера из официальной документации listUserOrderHistory
describe('официальная форма ордера C2C', () => {
  it('разбирает запись истории сделок как есть', () => {
    const parsed = normalizeOrderDetail(
      {
        orderNumber: '22467508508467200000',
        advNo: '11111111111111111111',
        tradeType: 'SELL',
        asset: 'BTC',
        fiat: 'EUR',
        fiatSymbol: '€',
        amount: '0.00110000',
        totalPrice: '35.00',
        unitPrice: '31818.18',
        orderStatus: 'COMPLETED',
        createTime: 1619361369000,
        counterPartNickName: 'ab***',
        advertisementRole: 'TAKER',
      },
      null,
    );

    assert.equal(parsed.order.externalId, '22467508508467200000');
    assert.equal(parsed.order.side, 'SELL');
    assert.equal(parsed.order.status, 'COMPLETED');
    assert.equal(parsed.order.asset, 'BTC');
    assert.equal(parsed.order.fiat, 'EUR');
    assert.equal(parsed.order.amountFiat, 35);
    assert.equal(parsed.order.amountAsset, 0.0011);
    assert.equal(parsed.order.price, 31818.18);
    assert.equal(parsed.order.createdAtExchange, new Date(1619361369000).toISOString());
  });
});

describe('извлечение из перехваченного ответа', () => {
  // так выглядит типичная обёртка Binance: код, сообщение и вложенный data
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

// данные, которые видны в карточке контрагента на самой бирже: возраст
describe('карточка контрагента с биржи', () => {
  it('читает верификации, дату регистрации и исполнение за 30 дней', () => {
    const snapshot = normalizeUserDetail({
      userNo: 's1e7e25dcd7b43cfaad5f417fecc658f9',
      nickName: 'Jasik_2024',
      registerTime: 1_666_224_000_000,
      email: 'j***@mail.com',
      mobileVerified: true,
      kycVerified: 1,
      userStatsRet: {
        completedOrderNum: 637,
        tradeCountOfLast30day: 402,
        monthFinishRate: 99.3,
        avgReleaseTimeOfLast30day: 278,
        avgPayTimeOfLast30day: 167,
        positiveCount: 78,
        negativeCount: 3,
      },
    });

    assert.equal(snapshot?.stats?.totalOrders, 637);
    assert.equal(snapshot?.stats?.orders30d, 402);
    assert.equal(snapshot?.stats?.completionRate30d, 0.993);
    assert.equal(snapshot?.stats?.avgReleaseMinutes, 5);
    assert.equal(snapshot?.stats?.avgPayMinutes, 3);
    assert.equal(snapshot?.stats?.joinedAt, '2022-10-20T00:00:00.000Z');
    assert.equal(snapshot?.stats?.emailVerified, true);
    assert.equal(snapshot?.stats?.phoneVerified, true);
    assert.equal(snapshot?.stats?.kycVerified, true);
    // отзывов биржа отдельным числом не даёт, складываем плюсы и минусы
    assert.equal(snapshot?.stats?.feedbackCount, 81);
  });

  it('не выдумывает верификации, которых нет в ответе', () => {
    const snapshot = normalizeUserDetail({ userNo: 'x', nickName: 'y' });
    assert.equal(snapshot?.stats?.emailVerified, null);
    assert.equal(snapshot?.stats?.kycVerified, null);
  });
});

describe('отзывы биржи', () => {
  it('узнаёт отзыв по форме и различает знак оценки', () => {
    const payload = {
      data: [
        { appraiseType: 0, content: 'Тянул два часа', authorNickName: 'trader_kz', createTime: 1_754_126_040_000 },
        { appraiseType: 1, content: 'Всё быстро', authorNickName: 'usdt_hunter', createTime: 1_752_231_720_000 },
      ],
    };

    const found = findObjects(payload, looksLikeFeedback);
    assert.equal(found.length, 2);

    const negative = normalizeFeedback(found[0]!);
    assert.equal(negative.rating, 'NEGATIVE');
    assert.equal(negative.author, 'trader_kz');
    assert.equal(negative.text, 'Тянул два часа');

    assert.equal(normalizeFeedback(found[1]!).rating, 'POSITIVE');
  });

  it('понимает словесную оценку', () => {
    assert.equal(normalizeFeedback({ feedbackType: 'NEGATIVE', content: 'плохо' }).rating, 'NEGATIVE');
    assert.equal(normalizeFeedback({ feedbackType: 'positive', content: 'ок' }).rating, 'POSITIVE');
  });
});

// UID пользователя лежит вторым сегментом куки p20t (`web.<uid>.<хэш>`)
describe('UID из куки сессии', () => {
  const uidFrom = (value: string) => /^web\.(\d{4,20})\./.exec(value)?.[1] ?? null;

  it('достаёт номер аккаунта', () => {
    assert.equal(uidFrom('web.540652971.32AAE53C226391C984EB2AB5AFED3EED'), '540652971');
  });

  it('не принимает чужой формат за UID', () => {
    assert.equal(uidFrom('026085B099EEC5A7DB6D2A2948E88051'), null);
    assert.equal(uidFrom('web..abc'), null);
  });
});
