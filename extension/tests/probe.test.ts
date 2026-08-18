/**
 * Прогон scripts/probe-binance.js в подставном окружении.
 *
 * Скрипт запускают вручную в чужой консоли, где отладки не будет, поэтому
 * проверяем его целиком. Главное здесь — сообщение биржи при 400: путь
 * существует, но параметры не те, и подобрать их можно только по её ответу.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../scripts/probe-binance.js'), 'utf8');

const PROFILE = '/bapi/c2c/v2/friendly/c2c/user/profile-and-ads-list';

type Attempt = {
  label: string;
  status: number;
  code: string | null;
  message: string | null;
  good: boolean;
  body: Record<string, unknown> | null;
  data: Record<string, any> | null;
};

type Report = {
  userNo: string;
  tries: Attempt[];
  pathsPageUsedItself: string[];
};

type Call = { path: string; body: Record<string, unknown> | null; headers: Record<string, string> };

/**
 * @param accept тело, на которое подставная биржа отвечает успехом;
 *               остальным она отдаёт 400 с объяснением, как настоящая
 */
async function run(accept?: (body: Record<string, unknown>) => boolean) {
  const calls: Call[] = [];

  const sandbox: Record<string, unknown> = {
    console: { log: () => undefined, table: () => undefined },
    location: {
      hostname: 'c2c.binance.com',
      origin: 'https://c2c.binance.com',
      href: 'https://c2c.binance.com/ru/advertiserDetail?advertiserNo=sc424767c736735d9af156d1965971886',
    },
    document: {
      cookie: 'lang=ru; csrftoken=SECRET_CSRF; bnc-uuid=UUID-1; BNC_FV_KEY=FVKEY-1',
      body: { innerHTML: '' },
      createElement: () => ({ style: {}, select() {}, remove() {} }),
      execCommand: () => true,
    },
    performance: {
      getEntriesByType: () => [
        { name: 'https://c2c.binance.com/bapi/c2c/v1/private/c2c/chat/ping-by-type' },
        { name: 'https://c2c.binance.com/bapi/c2c/v2/friendly/c2c/user/detail?userNo=abc&lang=ru' },
        { name: 'https://c2c.binance.com/static/img.png' },
      ],
    },
    window: {},
    encodeURIComponent,
    URL,
    JSON,
    Array,
    Object,
    String,
    Boolean,
    Set,
    Error,
    Promise,
    fetch: async (url: string, init: { headers: Record<string, string>; body?: string }) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ path: new URL(url).pathname, body, headers: init.headers });

      if (accept && body && accept(body)) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              success: true,
              data: {
                userDetailVo: {
                  userNo: 'sc424767c736735d9af156d1965971886',
                  nickName: 'Jasik_2024',
                  csrfToken: 'секрет',
                  userStatsRet: { completedOrderNum: 637 },
                },
              },
            }),
        };
      }
      return {
        status: 400,
        text: async () =>
          JSON.stringify({ success: false, code: '000002', message: 'Illegal parameter: tradeType' }),
      };
    },
  };
  sandbox.globalThis = sandbox;

  const report = (await vm.runInContext(source, vm.createContext(sandbox))) as Report;
  return { report, calls };
}

describe('probe-binance.js', () => {
  it('находит контрагента в адресе профиля', async () => {
    const { report } = await run();
    assert.equal(report.userNo, 'sc424767c736735d9af156d1965971886');
  });

  it('перебирает варианты тела по одному и тому же пути', async () => {
    const { report, calls } = await run();

    assert.ok(report.tries.length >= 6, `вариантов всего ${report.tries.length}`);
    assert.ok(calls.every((c) => c.path === PROFILE), 'все запросы идут в найденный путь');
    // пустое тело идёт первым: по жалобе на него видно, какое поле обязательно
    // объект пришёл из песочницы, поэтому сверяем содержимое, а не прототип
    assert.equal(Object.keys(report.tries[0]!.body!).length, 0);
  });

  it('показывает, чем именно биржа недовольна', async () => {
    const { report } = await run();

    assert.ok(report.tries.every((t) => t.status === 400));
    assert.equal(report.tries[0]!.code, '000002');
    assert.equal(report.tries[0]!.message, 'Illegal parameter: tradeType');
    assert.ok(report.tries.every((t) => !t.good));
  });

  it('узнаёт подошедший вариант и сохраняет его ответ', async () => {
    const { report } = await run((b) => b.tradeType === 'BUY' && b.asset === 'USDT');

    const winner = report.tries.filter((t) => t.good);
    assert.ok(winner.length >= 1, 'ни один вариант не признан рабочим');
    assert.equal(winner[0]!.data!.userDetailVo.userStatsRet.completedOrderNum, 637);
    // тело победителя нужно, чтобы повторить запрос из расширения
    assert.equal(winner[0]!.body!.asset, 'USDT');
  });

  it('шлёт заголовки, которые биржа ждёт от своей же страницы', async () => {
    const { calls } = await run();
    const h = calls[0]!.headers;

    assert.equal(h.csrftoken, 'SECRET_CSRF');
    assert.equal(h.c2ctype, 'c2c_web');
    assert.equal(h.clienttype, 'web');
    assert.equal(h['fvideo-id'], 'FVKEY-1');
  });

  it('не утаскивает секреты в отчёт', async () => {
    const { report } = await run((b) => b.tradeType === 'BUY' && b.asset === 'USDT');
    const winner = report.tries.find((t) => t.good)!;

    assert.equal(winner.data!.userDetailVo.csrfToken, '‹вырезано›');

    const dump = JSON.stringify(report);
    assert.ok(!dump.includes('SECRET_CSRF'), 'csrf-кука утекла');
    assert.ok(!dump.includes('FVKEY-1'), 'антифрод-ключ утёк');
  });

  it('собирает пути страницы вместе с именами параметров', async () => {
    const { report } = await run();
    const paths = report.pathsPageUsedItself;

    assert.equal(paths.length, 2, `лишнее в списке: ${paths}`);
    assert.ok(paths.includes('/bapi/c2c/v1/private/c2c/chat/ping-by-type'));
    // значения параметров не нужны, а имена подсказывают форму запроса
    assert.ok(paths.includes('/bapi/c2c/v2/friendly/c2c/user/detail?userNo&lang'));
  });
});
