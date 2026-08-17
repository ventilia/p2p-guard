/**
 * Прогон scripts/probe-binance.js в подставном окружении.
 *
 * Этот скрипт — единственное, чем можно узнать форму ответов биржи, и запускают
 * его вручную в чужой консоли, где отладки не будет. Поэтому проверяем его
 * целиком: находит ли контрагента, те ли шлёт заголовки, не путает ли пустой
 * ответ с рабочим и не утаскивает ли в отчёт куки.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../scripts/probe-binance.js'), 'utf8');

type Call = { path: string; method: string; headers: Record<string, string>; body?: string };

type Report = {
  userNo: string;
  loggedIn: boolean;
  working: { method: string; path: string }[];
  results: { path: string; response: Record<string, any> }[];
  pathsPageUsedItself: string[];
};

const PROFILE = '/bapi/c2c/v2/friendly/c2c/user/profile-and-ads-list';
const FEEDBACK_V1 = '/bapi/c2c/v1/friendly/c2c/user/feedback/list';
const FEEDBACK_V2 = '/bapi/c2c/v2/friendly/c2c/user/feedback/list';

// один путь отдаёт профиль, один — отзывы, один отвечает успехом но пустотой
const RESPONSES: Record<string, unknown> = {
  [PROFILE]: {
    success: true,
    data: {
      userDetailVo: {
        userNo: 's1e7e25dcd7b43cfaad5f417fecc658f9',
        nickName: 'Jasik_2024',
        countryCode: 'KZ',
        csrfToken: 'секрет-не-должен-попасть-в-отчёт',
        userStatsRet: { completedOrderNum: 637, monthFinishRate: 99.3 },
      },
    },
  },
  [FEEDBACK_V1]: {
    success: true,
    data: [{ appraiseType: 0, content: 'Тянул два часа', authorNickName: 'trader_kz' }],
  },
  [FEEDBACK_V2]: { success: true, data: [] },
};

async function run(overrides: { href?: string; cookie?: string } = {}) {
  const calls: Call[] = [];

  const sandbox: Record<string, unknown> = {
    console: { log: () => undefined },
    location: {
      hostname: 'c2c.binance.com',
      origin: 'https://c2c.binance.com',
      pathname: '/ru/advertiserDetail',
      href:
        overrides.href ??
        'https://c2c.binance.com/ru/advertiserDetail?advertiserNo=s1e7e25dcd7b43cfaad5f417fecc658f9',
    },
    document: {
      cookie:
        overrides.cookie ??
        'lang=ru; csrftoken=SECRET_CSRF; bnc-uuid=UUID-1; BNC_FV_KEY=FVKEY-1; logined=y',
      querySelectorAll: () => [],
      body: { innerHTML: '' },
      createElement: () => ({ style: {}, select() {}, remove() {} }),
      execCommand: () => true,
    },
    performance: {
      getEntriesByType: () => [
        { name: 'https://c2c.binance.com/bapi/c2c/v1/private/c2c/chat/ping-by-type' },
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
    fetch: async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method, headers: init.headers, body: init.body });
      const hit = RESPONSES[path];
      return hit
        ? { status: 200, text: async () => JSON.stringify(hit) }
        : { status: 404, text: async () => JSON.stringify({ success: false, code: '404' }) };
    },
  };
  sandbox.globalThis = sandbox;

  const report = (await vm.runInContext(source, vm.createContext(sandbox))) as Report;
  return { report, calls };
}

describe('probe-binance.js', () => {
  it('находит контрагента в адресе страницы', async () => {
    const { report } = await run();
    assert.equal(report.userNo, 's1e7e25dcd7b43cfaad5f417fecc658f9');
    assert.equal(report.loggedIn, true);
  });

  it('рабочим считает только путь, вернувший данные', async () => {
    const { report } = await run();
    const paths = report.working.map((w) => w.path);

    assert.ok(paths.includes(PROFILE), `нет профиля: ${paths}`);
    assert.ok(paths.includes(FEEDBACK_V1), `нет отзывов: ${paths}`);
    // успех с пустым списком — это не рабочий путь, иначе я пойду чинить не то
    assert.ok(!paths.includes(FEEDBACK_V2), `пустой ответ попал в рабочие: ${paths}`);
  });

  it('шлёт заголовки, которые биржа ждёт от своей же страницы', async () => {
    const { calls } = await run();
    const headers = calls[0]!.headers;

    assert.equal(headers.csrftoken, 'SECRET_CSRF');
    assert.equal(headers.c2ctype, 'c2c_web');
    assert.equal(headers.clienttype, 'web');
    assert.equal(headers['fvideo-id'], 'FVKEY-1');
    assert.ok(calls[0]!.body?.includes('s1e7e25'), 'номер контрагента ушёл в теле запроса');
  });

  it('сохраняет цифры, но вырезает секреты', async () => {
    const { report } = await run();
    const profile = report.results.find((r) => r.path === PROFILE)!;

    assert.equal(profile.response.data.userDetailVo.userStatsRet.completedOrderNum, 637);
    assert.equal(profile.response.data.userDetailVo.csrfToken, '‹вырезано›');

    const dump = JSON.stringify(report);
    assert.ok(!dump.includes('SECRET_CSRF'), 'значение csrf-куки утекло в отчёт');
    assert.ok(!dump.includes('FVKEY-1'), 'антифрод-ключ утёк в отчёт');
  });

  it('прикладывает пути, которые страница дёргала сама', async () => {
    const { report } = await run();

    // массив пришёл из песочницы: сравниваем содержимое, а не прототипы
    assert.equal(report.pathsPageUsedItself.length, 1);
    assert.equal(report.pathsPageUsedItself[0], '/bapi/c2c/v1/private/c2c/chat/ping-by-type');
  });

  it('замечает, что пользователь не вошёл на биржу', async () => {
    const { report } = await run({ cookie: 'lang=ru' });
    assert.equal(report.loggedIn, false);
  });
});
